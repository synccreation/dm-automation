import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction } from "../src/db/actions";
import { getLinkById } from "../src/db/links";
import { setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { jsonResponse, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv } from "./helpers";

const AUTH = { Authorization: "Bearer test-admin-token" };
const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Hey {name}!", button_label: "Get it" };

function adminRequest(path: string, init: RequestInit = {}) {
  return app.request(`/admin${path}`, {
    ...init,
    headers: { ...AUTH, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, testEnv);
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("admin auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await app.request("/admin/health", {}, testEnv)).status).toBe(401);
    expect((await app.request("/admin/health", { headers: { Authorization: "Bearer nope" } }, testEnv)).status).toBe(401);
  });
});

describe("GET /admin/health", () => {
  it("reports a disconnected, empty system", async () => {
    const res = await adminRequest("/health");
    expect(await res.json()).toEqual({
      connected: false, username: null, tokenRefreshedAt: null, tokenError: null,
      lastWebhookAt: null, pendingActions: 0, failedLast24h: 0,
    });
  });

  it("reports connection, webhook time and queue counts", async () => {
    await seedConnectedAccount();
    await setSetting(testEnv.DB, "last_webhook_at", "1234");
    await enqueueAction(testEnv.DB, {
      triggerId: null, contactIgsid: "u1", sendAt: Date.now(), payload: { kind: "dm", igsid: "u1", message: { text: "x" } },
    }, Date.now());
    const body = (await (await adminRequest("/health")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ connected: true, username: "creator", lastWebhookAt: 1234, pendingActions: 1 });
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
    const list = (await (await adminRequest("/rules")).json()) as unknown[];
    expect(list).toHaveLength(1);
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
  it("explains how to connect when Instagram is not connected", async () => {
    const res = await adminRequest("/media");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("connect");
  });

  it("lists recent media from Instagram", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ data: [{ id: "m1", caption: "Reel", timestamp: "2026-09-01T00:00:00+0000" }] }));
    const res = await adminRequest("/media");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "m1", caption: "Reel", timestamp: "2026-09-01T00:00:00+0000" }]);
  });

  it("returns 502 with Meta's message when Instagram errors", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ error: { message: "Invalid token", code: 190 } }, 400));
    const res = await adminRequest("/media");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Invalid token");
  });
});

describe("GET /admin/actions/recent", () => {
  it("lists the newest actions first", async () => {
    for (const igsid of ["u1", "u2"]) {
      await enqueueAction(testEnv.DB, {
        triggerId: null, contactIgsid: igsid, sendAt: 1, payload: { kind: "dm", igsid, message: { text: "x" } },
      }, 1);
    }
    const list = (await (await adminRequest("/actions/recent")).json()) as { contact_igsid: string }[];
    expect(list.map((a) => a.contact_igsid)).toEqual(["u2", "u1"]);
  });
});
