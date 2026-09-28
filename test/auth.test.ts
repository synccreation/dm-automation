import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAuth } from "../src/auth";
import { getSetting, setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { IG_USER_ID, jsonResponse, resetDb, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

function metaHappyPath(call: FetchCall): Response {
  if (call.url === "https://api.instagram.com/oauth/access_token") return jsonResponse({ access_token: "short-token", user_id: 123 });
  if (call.url.startsWith("https://graph.instagram.com/v25.0/access_token?")) {
    return jsonResponse({ access_token: "long-token", token_type: "bearer", expires_in: 5_184_000 });
  }
  if (call.url.startsWith("https://graph.instagram.com/v25.0/me?")) return jsonResponse({ user_id: IG_USER_ID, username: "creator" });
  if (call.url === `https://graph.instagram.com/v25.0/${IG_USER_ID}/subscribed_apps`) return jsonResponse({ success: true });
  return jsonResponse({ error: { message: `unexpected ${call.url}` } }, 500);
}

async function stateFrom(url: string): Promise<string> {
  return new URL(url).searchParams.get("state")!;
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("POST /admin/auth/start", () => {
  it("returns an Instagram authorize URL and stores the state", async () => {
    const res = await app.request("/admin/auth/start", { method: "POST", headers: { Authorization: "Bearer test-admin-token" } }, testEnv);
    const { url } = (await res.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-app-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://dm.test/auth/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    );
    expect(await getSetting(testEnv.DB, "oauth_state")).toContain(parsed.searchParams.get("state")!);
  });
});

describe("GET /auth/callback", () => {
  it("exchanges the code, stores the account and subscribes webhooks", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    const calls = stubGlobalFetch(metaHappyPath);
    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("@creator");

    expect(await getSetting(testEnv.DB, "ig_access_token")).toBe("long-token");
    expect(await getSetting(testEnv.DB, "ig_user_id")).toBe(IG_USER_ID);
    expect(await getSetting(testEnv.DB, "ig_username")).toBe("creator");
    expect(Number(await getSetting(testEnv.DB, "ig_token_refreshed_at"))).toBeGreaterThan(0);
    expect(await getSetting(testEnv.DB, "oauth_state")).toBeNull();
    expect(await getSetting(testEnv.DB, "webhook_subscription_error")).toBeNull();

    const exchange = new URLSearchParams(calls[0]!.body!);
    expect(exchange.get("code")).toBe("abc");
    expect(exchange.get("redirect_uri")).toBe("https://dm.test/auth/callback");
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(JSON.parse(calls[3]!.body!)).toEqual({ subscribed_fields: ["comments", "messages", "messaging_postbacks"] });
  });

  it("still connects, and says so, when the webhook subscription is refused", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    stubGlobalFetch((call) =>
      call.url.endsWith("/subscribed_apps")
        ? jsonResponse({ error: { message: "Unsupported request", code: 100 } }, 400)
        : metaHappyPath(call),
    );
    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("@creator");
    expect(html).toContain("subscription failed");
    expect(await getSetting(testEnv.DB, "ig_access_token")).toBe("long-token");
    expect(await getSetting(testEnv.DB, "webhook_subscription_error")).toContain("Unsupported request");
  });

  it("rejects a wrong state without calling Meta, and states are single-use", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    const calls = stubGlobalFetch(metaHappyPath);
    expect((await app.request("/auth/callback?code=abc&state=wrong", {}, testEnv)).status).toBe(400);
    expect((await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects an expired state", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now() - 11 * 60_000));
    stubGlobalFetch(metaHappyPath);
    expect((await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv)).status).toBe(400);
  });

  it("explains a cancelled login", async () => {
    const res = await app.request("/auth/callback?error=access_denied&error_description=User+denied", {}, testEnv);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cancelled");
  });

  it("shows Meta's error and stores nothing when the code exchange fails", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    stubGlobalFetch(() => jsonResponse({ error_type: "OAuthException", code: 400, error_message: "Invalid redirect_uri" }, 400));
    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid redirect_uri");
    expect(await getSetting(testEnv.DB, "ig_access_token")).toBeNull();
  });

  it("keeps an existing connection when a reconnect fails", async () => {
    await setSetting(testEnv.DB, "ig_access_token", "old-token");
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    stubGlobalFetch(() => jsonResponse({ error_message: "nope" }, 400));
    await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(await getSetting(testEnv.DB, "ig_access_token")).toBe("old-token");
  });
});
