import { describe, expect, it } from "vitest";
import { ZernioError, createZernioClient, listInstagramAccounts, upsertWebhook } from "../src/zernio";
import { fakeFetch, jsonResponse, type FetchCall } from "./helpers";

const API = "https://zernio.com/api/v1";

function client(handler: (call: FetchCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return { zernio: createZernioClient({ apiKey: "sk_test", accountId: "acc1", fetch: fake.fetch }), calls: fake.calls };
}

async function errorFrom(promise: Promise<unknown>): Promise<ZernioError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ZernioError);
  return error as ZernioError;
}

describe("ZernioClient", () => {
  it("sends a text-only private reply", async () => {
    const { zernio, calls } = client(() => jsonResponse({ status: "success", messageId: "m1", commentId: "c1", platform: "instagram" }));
    await expect(zernio.privateReply("media-1", "c1", "Reply to get the guide")).resolves.toEqual({ messageId: "m1" });
    expect(calls[0]!.url).toBe(`${API}/inbox/comments/media-1/c1/private-reply`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("Authorization")).toBe("Bearer sk_test");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ accountId: "acc1", message: "Reply to get the guide" });
  });

  it("replies publicly to a comment with an idempotency key", async () => {
    const { zernio, calls } = client(() => jsonResponse({ success: true, data: { commentId: "r1", isReply: true } }));
    await expect(zernio.replyToComment("media-1", "c1", "Sent!", "action-7")).resolves.toEqual({ commentId: "r1" });
    expect(calls[0]!.url).toBe(`${API}/inbox/comments/media-1`);
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("action-7");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ accountId: "acc1", message: "Sent!", commentId: "c1" });
  });

  it("sends a DM with url and postback buttons within Instagram's limits", async () => {
    const { zernio, calls } = client(() => jsonResponse({ success: true, data: { messageId: "mid-9", conversationId: "conv-1" } }));
    const result = await zernio.sendDm("conv-1", {
      text: "x".repeat(700),
      buttons: [
        { type: "web_url", title: "A very long button title", url: "https://e.com" },
        { type: "postback", title: "Later", payload: "LATER" },
      ],
    }, "action-8");
    expect(result).toEqual({ messageId: "mid-9" });
    expect(calls[0]!.url).toBe(`${API}/inbox/conversations/conv-1/messages`);
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("action-8");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      accountId: "acc1",
      message: "x".repeat(640),
      buttons: [
        { type: "url", title: "A very long button t", url: "https://e.com" },
        { type: "postback", title: "Later", payload: "LATER" },
      ],
    });
  });

  it("lists recent posts", async () => {
    const { zernio, calls } = client(() => jsonResponse({
      posts: [{ id: "m1", message: "My reel", createdTime: "2026-09-01T00:00:00Z", permalink: "https://instagram.com/p/1", mediaType: "VIDEO" }],
    }));
    await expect(zernio.listPosts()).resolves.toEqual([
      { id: "m1", caption: "My reel", mediaType: "VIDEO", timestamp: "2026-09-01T00:00:00Z", permalink: "https://instagram.com/p/1" },
    ]);
    expect(calls[0]!.url).toBe(`${API}/accounts/acc1/posts`);
  });

  it("never retries a private reply Instagram refused, and keeps Instagram's reason", async () => {
    const { zernio } = client(() => jsonResponse({
      error: "Instagram refused this private reply", type: "platform_error", code: "platform_api_error",
      platformError: { code: 2, error_subcode: 1545133, is_transient: false, error_user_msg: "You can't send media unless they follow you." },
      details: { privateReplyConsumed: true },
    }, 400));
    const error = await errorFrom(zernio.privateReply("m", "c", "hi"));
    expect(error.transient).toBe(false);
    expect(error.message).toContain("unless they follow you");
  });

  it.each([
    [429, { error: "Rate limit exceeded", details: { retryAfterSeconds: 12 } }],
    [500, { error: "boom", type: "api_error" }],
    [503, { error: "busy", type: "api_error", code: "temporarily_unavailable" }],
  ])("treats HTTP %i as transient", async (status, body) => {
    const { zernio } = client(() => jsonResponse(body, status));
    expect((await errorFrom(zernio.sendDm("c", { text: "hi" }, "k"))).transient).toBe(true);
  });

  it("treats validation errors as permanent", async () => {
    const { zernio } = client(() => jsonResponse({ error: "bad", type: "invalid_request_error", code: "missing_required_field" }, 400));
    const error = await errorFrom(zernio.sendDm("c", { text: "hi" }, "k"));
    expect(error.transient).toBe(false);
    expect(error.code).toBe("missing_required_field");
  });

  it("treats network failures as transient", async () => {
    const { zernio } = client(() => { throw new TypeError("fetch failed"); });
    expect((await errorFrom(zernio.listPosts())).transient).toBe(true);
  });
});

describe("account setup calls", () => {
  it("lists connected Instagram accounts", async () => {
    const fake = fakeFetch(() => jsonResponse({
      accounts: [
        { _id: "acc1", platform: "instagram", profileId: { _id: "prof1", name: "Default" }, username: "@creator", isActive: true },
        { _id: "acc2", platform: "instagram", profileId: "prof2", username: "other", isActive: true },
        { _id: "acc3", platform: "instagram", profileId: "prof3", isActive: false },
        { _id: "acc4", platform: "twitter", profileId: "prof4", isActive: true },
      ],
    }));
    await expect(listInstagramAccounts("sk_test", fake.fetch)).resolves.toEqual([
      { id: "acc1", profileId: "prof1", username: "creator" },
      { id: "acc2", profileId: "prof2", username: "other" },
    ]);
    expect(fake.calls[0]!.url).toBe(`${API}/accounts?platform=instagram`);
  });

  it("creates the webhook when none is stored", async () => {
    const fake = fakeFetch(() => jsonResponse({ success: true, webhook: { _id: "wh1" } }));
    const id = await upsertWebhook("sk_test", { webhookId: null, url: "https://dm.test/webhook", secret: "s3", profileId: "prof1" }, fake.fetch);
    expect(id).toBe("wh1");
    expect(fake.calls[0]!.method).toBe("POST");
    expect(fake.calls[0]!.url).toBe(`${API}/webhooks/settings`);
    expect(JSON.parse(fake.calls[0]!.body!)).toEqual({
      name: "dm-automation", url: "https://dm.test/webhook", secret: "s3",
      events: ["comment.received", "message.received", "message.sent"], profileIds: ["prof1"], isActive: true,
    });
  });

  it("updates the stored webhook, and recreates it if it was deleted", async () => {
    const update = fakeFetch(() => jsonResponse({ success: true }));
    await expect(upsertWebhook("sk_test", { webhookId: "wh1", url: "u", secret: "s", profileId: "p" }, update.fetch)).resolves.toBe("wh1");
    expect(update.calls[0]!.method).toBe("PUT");
    expect(JSON.parse(update.calls[0]!.body!)).toMatchObject({ webhookId: "wh1", url: "u" });

    const recreate = fakeFetch((call) =>
      call.method === "PUT" ? jsonResponse({ error: "Not found", type: "not_found" }, 404) : jsonResponse({ webhook: { _id: "wh2" } }),
    );
    await expect(upsertWebhook("sk_test", { webhookId: "wh1", url: "u", secret: "s", profileId: "p" }, recreate.fetch)).resolves.toBe("wh2");
  });
});
