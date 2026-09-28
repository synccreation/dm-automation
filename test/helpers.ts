import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { hmacSha256Hex } from "../src/webhook/verify";
import { ACCOUNT_ID, PROFILE_ID } from "./fixtures";

export { ACCOUNT_ID, PROFILE_ID };
export const testEnv = env as unknown as AppEnv;

// Child tables first so foreign keys never block the delete.
const TABLES = [
  "clicks", "actions", "triggers", "messages", "conversations",
  "processed_events", "contacts", "rules", "links", "settings",
];

export async function resetDb(): Promise<void> {
  await testEnv.DB.batch(TABLES.map((table) => testEnv.DB.prepare(`DELETE FROM ${table}`)));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

export function fakeFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const call: FetchCall = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body ? await request.text() : null,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Replace global fetch for code paths that can't take an injected fetch (routes). */
export function stubGlobalFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const { fetch: impl, calls } = fakeFetch(handler);
  vi.spyOn(globalThis, "fetch").mockImplementation(impl);
  return calls;
}

export async function seedConnectedAccount(): Promise<void> {
  const rows: [string, string][] = [
    ["zernio_account_id", ACCOUNT_ID],
    ["zernio_profile_id", PROFILE_ID],
    ["zernio_webhook_id", "wh-1"],
    ["ig_username", "creator"],
  ];
  await testEnv.DB.batch(
    rows.map(([key, value]) =>
      testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(key, value),
    ),
  );
}

/** POSTs a signed Zernio delivery and waits for any work it deferred with waitUntil. */
export async function postWebhookRaw(raw: string, secret = "test-webhook-secret"): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request("/webhook", {
    method: "POST",
    body: raw,
    headers: { "Content-Type": "application/json", "X-Zernio-Signature": await hmacSha256Hex(secret, raw) },
  }, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function postWebhook(body: unknown, secret?: string): Promise<Response> {
  return postWebhookRaw(JSON.stringify(body), secret);
}
