import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionRow } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { DAY, MINUTE } from "../src/time";
import { newRule } from "./factories";
import { commentEvent, messageEvent } from "./fixtures";
import { ACCOUNT_ID, jsonResponse, postWebhook, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv } from "./helpers";

const SENT = () => jsonResponse({ success: true, data: { messageId: "mid-link", conversationId: "conv-1" } });

async function seedLead(overrides: Partial<NewRule> = {}) {
  const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
  const rule = await insertRule(testEnv.DB, newRule({ link_id: link.id, link_text: "Here's your guide 👇", ...overrides }), Date.now());
  await postWebhook(commentEvent());
  return rule;
}

async function linkDms(): Promise<ActionRow[]> {
  const { results } = await testEnv.DB.prepare("SELECT * FROM actions WHERE type = 'dm' ORDER BY id").all<ActionRow>();
  return results;
}

async function linkState(): Promise<string | undefined> {
  return (await testEnv.DB.prepare("SELECT link_state FROM triggers").first<{ link_state: string }>())?.link_state;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /webhook: replies", () => {
  it("sends the link with a button as soon as the commenter replies", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    const before = Date.now();
    await postWebhook(messageEvent({ text: "send it" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://zernio.com/api/v1/inbox/conversations/conv-1/messages");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      accountId: ACCOUNT_ID,
      message: "Here's your guide 👇",
      buttons: [{ type: "url", title: "Get the guide", url: "https://dm.test/l/abc123?c=user-1" }],
    });
    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "sent", sent_mid: "mid-link" });
    expect(dm!.send_at).toBeGreaterThanOrEqual(before);
    expect(await linkState()).toBe("delivered");
  });

  it("uses a default message when the rule has no link text", async () => {
    await seedLead({ link_text: "" });
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent());
    expect(JSON.parse(calls[0]!.body!).message).toBe("Here you go 👇");
  });

  it("sends the link only once when they reply twice", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent({ messageId: "mid-a" }));
    await postWebhook(messageEvent({ messageId: "mid-b" }));
    expect(calls).toHaveLength(1);
    expect(await linkDms()).toHaveLength(1);
  });

  it("sends the link only once when Zernio delivers the reply twice", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    const reply = messageEvent();
    await postWebhook(reply);
    await postWebhook(reply);
    expect(calls).toHaveLength(1);
  });

  it("ignores messages from people who aren't waiting for a link", async () => {
    const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
    await insertRule(testEnv.DB, newRule({ link_id: link.id }), Date.now());
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent({ senderId: "stranger" }));
    expect(calls).toHaveLength(0);
    expect(await linkDms()).toHaveLength(0);
  });

  it("keeps the link queued for the scheduler when the immediate send fails", async () => {
    await seedLead();
    stubGlobalFetch(() => jsonResponse({ error: "busy", type: "api_error" }, 503));
    const before = Date.now();
    await postWebhook(messageEvent());
    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "pending", attempts: 1 });
    expect(dm!.send_at).toBeGreaterThanOrEqual(before + MINUTE);
    expect(await linkState()).toBe("delivered");
  });

  it("does not send a link for a comment older than 7 days", async () => {
    const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
    const rule = await insertRule(testEnv.DB, newRule({ link_id: link.id }), Date.now());
    const old = Date.now() - 8 * DAY;
    await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "user-1", media_id: "media-1", source: "comment",
      comment_id: "c-1", comment_at: old, created_at: old, link_state: "awaiting_reply",
    });
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent());
    expect(calls).toHaveLength(0);
  });
});
