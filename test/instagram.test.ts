import { describe, expect, it } from "vitest";
import { InstagramError, createInstagramClient } from "../src/instagram";
import { fakeFetch, jsonResponse, type FetchCall } from "./helpers";

function client(handler: (call: FetchCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  const ig = createInstagramClient({ accessToken: "tok", igUserId: "178400", version: "v25.0", fetch: fake.fetch });
  return { ig, calls: fake.calls };
}

describe("InstagramClient", () => {
  it("sends a plain-text private reply", async () => {
    const { ig, calls } = client(() => jsonResponse({ recipient_id: "1", message_id: "mid.1" }));
    await expect(ig.sendMessage({ comment_id: "c1" }, { text: "hi" })).resolves.toEqual({ messageId: "mid.1" });
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/178400/messages");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ recipient: { comment_id: "c1" }, message: { text: "hi" } });
  });

  it("sends buttons as a button template within Meta's length limits", async () => {
    const { ig, calls } = client(() => jsonResponse({ message_id: "mid.2" }));
    await ig.sendMessage({ id: "u1" }, {
      text: "x".repeat(700),
      buttons: [{ type: "web_url", title: "A very long button title", url: "https://e.com" }],
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      recipient: { id: "u1" },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "x".repeat(640),
            buttons: [{ type: "web_url", title: "A very long button t", url: "https://e.com" }],
          },
        },
      },
    });
  });

  it("replies publicly to a comment", async () => {
    const { ig, calls } = client(() => jsonResponse({ id: "r1" }));
    await expect(ig.replyToComment("c1", "Sent!")).resolves.toEqual({ id: "r1" });
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/c1/replies");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ message: "Sent!" });
  });

  it("lists recent media", async () => {
    const { ig, calls } = client(() => jsonResponse({ data: [{ id: "m1", timestamp: "2026-09-01T00:00:00+0000" }] }));
    await expect(ig.listMedia(25)).resolves.toEqual([{ id: "m1", timestamp: "2026-09-01T00:00:00+0000" }]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v25.0/me/media");
    expect(url.searchParams.get("fields")).toBe("id,caption,media_product_type,timestamp,permalink");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("subscribes the account to webhook fields", async () => {
    const { ig, calls } = client(() => jsonResponse({ success: true }));
    await ig.subscribeWebhooks(["comments", "messages"]);
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/178400/subscribed_apps");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ subscribed_fields: ["comments", "messages"] });
  });

  it.each([
    [500, { error: { message: "down", code: 2 } }],
    [400, { error: { message: "rate", code: 4 } }],
    [429, {}],
    [400, { error: { message: "blip", code: 100, is_transient: true } }],
  ])("classifies HTTP %i %j as transient", async (status, body) => {
    const { ig } = client(() => jsonResponse(body, status));
    const error = await ig.sendMessage({ id: "u1" }, { text: "hi" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstagramError);
    expect((error as InstagramError).transient).toBe(true);
  });

  it("classifies other errors as permanent and keeps Meta's message", async () => {
    const { ig } = client(() => jsonResponse({ error: { message: "User blocked", code: 100, error_subcode: 2534014 } }, 400));
    const error = (await ig.sendMessage({ id: "u1" }, { text: "hi" }).catch((e: unknown) => e)) as InstagramError;
    expect(error.transient).toBe(false);
    expect(error.code).toBe(100);
    expect(error.message).toContain("User blocked");
  });

  it("treats network failures as transient", async () => {
    const { ig } = client(() => { throw new TypeError("fetch failed"); });
    const error = (await ig.replyToComment("c1", "x").catch((e: unknown) => e)) as InstagramError;
    expect(error).toBeInstanceOf(InstagramError);
    expect(error.transient).toBe(true);
  });
});
