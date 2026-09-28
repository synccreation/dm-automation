import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction } from "../src/db/actions";
import { getLinkById } from "../src/db/links";
import { getSetting, setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { jsonResponse, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

const AUTH = { Authorization: "Bearer test-admin-token" };
const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Reply and I'll send it!", button_label: "Get it" };
const ZERNIO = "https://zernio.com/api/v1";

function adminRequest(path: string, init: RequestInit = {}) {
  return app.request(`/admin${path}`, {
    ...init,
    headers: { ...AUTH, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, testEnv);
}

function zernioAccounts(accounts: unknown[]) {
  return (call: FetchCall): Response => {
    if (call.url === `${ZERNIO}/accounts?platform=instagram`) return jsonResponse({ accounts });
    if (call.url === `${ZERNIO}/webhooks/settings` && call.method === "POST") return jsonResponse({ success: true, webhook: { _id: "wh-new" } });
    if (call.url === `${ZERNIO}/webhooks/settings` && call.method === "PUT") return jsonResponse({ success: true });
    return jsonResponse({ error: `unexpected ${call.method} ${call.url}` }, 500);
  };
}

const ACCOUNT = { _id: "acc1", platform: "instagram", profileId: { _id: "prof1", name: "Default" }, username: "creator", isActive: true };

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("admin auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await app.request("/admin/health", {}, testEnv)).status).toBe(401);
    expect((await app.request("/admin/health", { headers: { Authorization: "Bearer nope" } }, testEnv)).status).toBe(401);
  });
});

describe("GET /admin/health", () => {
  it("reports a system that isn't set up yet", async () => {
    expect(await (await adminRequest("/health")).json()).toEqual({
      connected: false, username: null, webhookRegistered: false, lastWebhookAt: null, pendingActions: 0, failedLast24h: 0,
    });
  });

  it("reports connection, webhook and queue counts", async () => {
    await seedConnectedAccount();
    await setSetting(testEnv.DB, "last_webhook_at", "1234");
    await enqueueAction(testEnv.DB, {
      triggerId: null, contactIgsid: "u1", sendAt: Date.now(), payload: { kind: "dm", conversationId: "conv-1", message: { text: "x" } },
    }, Date.now());
    expect(await (await adminRequest("/health")).json()).toMatchObject({
      connected: true, username: "creator", webhookRegistered: true, lastWebhookAt: 1234, pendingActions: 1,
    });
  });
});

describe("POST /admin/setup", () => {
  it("links the only Instagram account and registers the webhook", async () => {
    const calls = stubGlobalFetch(zernioAccounts([ACCOUNT]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: "creator", accountId: "acc1", webhookId: "wh-new" });
    expect(await getSetting(testEnv.DB, "zernio_account_id")).toBe("acc1");
    expect(await getSetting(testEnv.DB, "zernio_profile_id")).toBe("prof1");
    expect(await getSetting(testEnv.DB, "zernio_webhook_id")).toBe("wh-new");
    expect(await getSetting(testEnv.DB, "ig_username")).toBe("creator");
    const webhookCall = calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(webhookCall.body!)).toMatchObject({
      url: "https://dm.test/webhook", secret: "test-webhook-secret", profileIds: ["prof1"],
      events: ["comment.received", "message.received", "message.sent"],
    });
    expect(webhookCall.headers.get("Authorization")).toBe("Bearer sk_test");
  });

  it("updates the existing webhook on a re-run", async () => {
    await seedConnectedAccount();
    const calls = stubGlobalFetch(zernioAccounts([ACCOUNT]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(((await res.json()) as { webhookId: string }).webhookId).toBe("wh-1");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  it("explains what to do when no Instagram account is connected in Zernio", async () => {
    stubGlobalFetch(zernioAccounts([]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("zernio.com");
    expect(await getSetting(testEnv.DB, "zernio_account_id")).toBeNull();
  });

  it("asks which account to use when several are connected, then uses the chosen one", async () => {
    const second = { ...ACCOUNT, _id: "acc2", profileId: "prof2", username: "brand" };
    stubGlobalFetch(zernioAccounts([ACCOUNT, second]));
    const ask = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(ask.status).toBe(409);
    expect(((await ask.json()) as { accounts: unknown[] }).accounts).toHaveLength(2);

    const chosen = await adminRequest("/setup", { method: "POST", body: JSON.stringify({ accountId: "acc2" }) });
    expect(chosen.status).toBe(200);
    expect(await getSetting(testEnv.DB, "zernio_profile_id")).toBe("prof2");
  });

  it("returns 502 with Zernio's message when the API key is wrong", async () => {
    stubGlobalFetch(() => jsonResponse({ error: "Unauthorized" }, 401));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Unauthorized");
  });
});

describe("rules", () => {
  it("creates a rule with a tracked link", async () => {
    const res = await adminRequest("/rules", {
      method: "POST",
      body: JSON.stringify({ ...minimal, link_url: "https://example.com/guide" }),
    });
    expect(res.status).toBe(201);
    const rule = (await res.json()) as { id: number; link_id: number; active: boolean };
    expect(rule.active).toBe(true);
    expect((await getLinkById(testEnv.DB, rule.link_id))?.target_url).toBe("https://example.com/guide");
    expect((await (await adminRequest("/rules")).json()) as unknown[]).toHaveLength(1);
  });

  it("returns 400 with the validation error", async () => {
    const res = await adminRequest("/rules", { method: "POST", body: JSON.stringify({ ...minimal, keywords: ["🔥"] }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("emoji-only");
  });

  it("pauses a rule and swaps its link", async () => {
    const created = (await (await adminRequest("/rules", { method: "POST", body: JSON.stringify(minimal) })).json()) as { id: number };
    const res = await adminRequest(`/rules/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false, link_url: "https://example.com/new" }),
    });
    const rule = (await res.json()) as { active: boolean; link_id: number };
    expect(rule.active).toBe(false);
    expect((await getLinkById(testEnv.DB, rule.link_id))?.target_url).toBe("https://example.com/new");
  });

  it("returns 404 for an unknown rule and 400 for a bad id", async () => {
    expect((await adminRequest("/rules/99999", { method: "PATCH", body: "{}" })).status).toBe(404);
    expect((await adminRequest("/rules/abc", { method: "PATCH", body: "{}" })).status).toBe(400);
  });
});

describe("GET /admin/media", () => {
  it("explains how to set up when Zernio isn't linked yet", async () => {
    const res = await adminRequest("/media");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("setup");
  });

  it("lists recent posts through Zernio", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ posts: [{ id: "m1", message: "Reel", createdTime: "2026-09-01T00:00:00Z" }] }));
    const res = await adminRequest("/media");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "m1", caption: "Reel", mediaType: null, timestamp: "2026-09-01T00:00:00Z", permalink: null }]);
  });

  it("returns 502 with Zernio's message when it errors", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ error: "Token expired", code: "TOKEN_EXPIRED" }, 401));
    const res = await adminRequest("/media");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Token expired");
  });
});

describe("GET /admin/actions/recent", () => {
  it("lists the newest actions first", async () => {
    for (const igsid of ["u1", "u2"]) {
      await enqueueAction(testEnv.DB, {
        triggerId: null, contactIgsid: igsid, sendAt: 1, payload: { kind: "dm", conversationId: `conv-${igsid}`, message: { text: "x" } },
      }, 1);
    }
    const list = (await (await adminRequest("/actions/recent")).json()) as { contact_igsid: string }[];
    expect(list.map((a) => a.contact_igsid)).toEqual(["u2", "u1"]);
  });
});
