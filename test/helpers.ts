import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { AppEnv } from "../src/env";

export const testEnv = env as unknown as AppEnv;
export const IG_USER_ID = "17840000000000001";

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
    ["ig_access_token", "test-token"],
    ["ig_user_id", IG_USER_ID],
    ["ig_username", "creator"],
  ];
  await testEnv.DB.batch(
    rows.map(([key, value]) =>
      testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(key, value),
    ),
  );
}
