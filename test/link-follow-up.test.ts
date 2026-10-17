import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction, getAction, type ActionRow } from "../src/db/actions";
import { getTrigger, insertTrigger, type LinkState } from "../src/db/events";
import { insertLink } from "../src/db/links";
import { insertRule } from "../src/db/rules";
import { runScheduler } from "../src/scheduler";
import { DAY, HOUR, MINUTE } from "../src/time";
import { ZernioError, type ZernioClient } from "../src/zernio";
import { newRule } from "./factories";
import { commentEvent } from "./fixtures";
import { ACCOUNT_ID, jsonResponse, postWebhook, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv } from "./helpers";

// Some Instagram threads never reach Zernio (no echo, no reply webhook), so the
// bot can't rely on the reply webhook alone to know when to send the link.

const NOW = 1_700_000_000_000;
const REFUSED = new ZernioError("Instagram refused the message", 400, "platform_api_error", false);

/** A fake Zernio whose sendDm outcomes are scripted in order; unscripted sends succeed. */
function fakeZernio(sendDmOutcomes: ("ok" | Error)[] = []) {
  const dms: { conversationId: string; message: unknown; key: string }[] = [];
  const zernio: ZernioClient = {
    async privateReply() { return { messageId: "mid-opening" }; },
    async replyToComment() { return { commentId: "reply-1" }; },
    async sendDm(conversationId, message, key) {
      dms.push({ conversationId, message, key });
      const outcome = sendDmOutcomes.shift() ?? "ok";
      if (outcome !== "ok") throw outcome;
      return { messageId: `dm-${dms.length}` };
    },
    async listPosts() { return []; },
    async listComments() { return []; },
  };
  return { zernio, dms };
}

/** A commenter whose opening DM is due at NOW, waiting for their link. */
async function seedOpening(linkState: LinkState = "awaiting_reply"): Promise<number> {
  const db = testEnv.DB;
  const link = await insertLink(db, "abc123", "https://example.com/guide", "Guide", NOW);
  const rule = await insertRule(db, newRule({ link_id: linkState === "none" ? null : link.id, link_text: "Here's your guide 👇" }), NOW);
  const triggerId = (await insertTrigger(db, {
    rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
    comment_id: "c1", comment_at: NOW, created_at: NOW, link_state: linkState,
  }))!;
  await enqueueAction(db, {
    triggerId, contactIgsid: "u1", sendAt: NOW,
    payload: { kind: "private_reply", mediaId: "m1", commentId: "c1", text: "Reply and I'll send it" },
  }, NOW);
  return triggerId;
}

async function linkDms(): Promise<ActionRow[]> {
  const { results } = await testEnv.DB.prepare("SELECT id FROM actions WHERE type = 'dm' ORDER BY id").all<{ id: number }>();
  return Promise.all(results.map(async ({ id }) => (await getAction(testEnv.DB, id))!));
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("link follow-up", () => {
  it("end to end: comment, opening DM, then the link posted to the commenter's IGSID with no reply webhook", async () => {
    await seedConnectedAccount();
    const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
    await insertRule(testEnv.DB, newRule({ link_id: link.id, link_text: "Here's your guide 👇" }), Date.now());
    await postWebhook(commentEvent({ fromId: "user-1" }));
    const calls = stubGlobalFetch(() => jsonResponse({ success: true, messageId: "mid-1", data: { messageId: "mid-2" } }));

    const start = Date.now();
    await runScheduler(testEnv, start + 2 * MINUTE); // opening DM
    await runScheduler(testEnv, start + 4 * MINUTE + 1); // link, two minutes later

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/v1/inbox/comments/media-1/c-1/private-reply",
      "/api/v1/inbox/conversations/user-1/messages",
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      accountId: ACCOUNT_ID,
      message: "Here's your guide 👇",
      buttons: [{ type: "url", title: "Get the guide", url: "https://dm.test/l/abc123?c=user-1" }],
    });
    expect(calls[1]!.headers.get("Idempotency-Key")).toMatch(/^action-\d+-try-1$/);
  });

  it("queues the link two minutes after the opening DM goes out", async () => {
    const triggerId = await seedOpening();
    await runScheduler(testEnv, NOW, fakeZernio());

    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "pending", trigger_id: triggerId, contact_igsid: "u1", send_at: NOW + 2 * MINUTE });
    expect(dm!.payload).toEqual({
      kind: "dm",
      conversationId: "u1",
      message: {
        text: "Here's your guide 👇",
        buttons: [{ type: "web_url", title: "Get the guide", url: "https://dm.test/l/abc123?c=u1" }],
      },
      retryUntil: NOW + 7 * DAY,
    });
  });

  it("sends the link straight to the commenter when no reply webhook ever arrives", async () => {
    const triggerId = await seedOpening();
    const { zernio, dms } = fakeZernio();
    await runScheduler(testEnv, NOW, { zernio });
    await runScheduler(testEnv, NOW + 2 * MINUTE, { zernio });

    expect(dms).toHaveLength(1);
    expect(dms[0]!.conversationId).toBe("u1");
    expect((await linkDms())[0]).toMatchObject({ status: "sent", sent_mid: "dm-1" });
    expect((await getTrigger(testEnv.DB, triggerId))!.link_state).toBe("delivered");
  });

  it("keeps trying while Instagram refuses, with a fresh idempotency key each time", async () => {
    const triggerId = await seedOpening();
    const { zernio, dms } = fakeZernio([REFUSED]);
    await runScheduler(testEnv, NOW, { zernio });
    await runScheduler(testEnv, NOW + 2 * MINUTE, { zernio });

    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "pending", attempts: 1, send_at: NOW + 7 * MINUTE });
    expect(dm!.last_error).toContain("refused");
    expect((await getTrigger(testEnv.DB, triggerId))!.link_state).toBe("awaiting_reply");

    await runScheduler(testEnv, NOW + 7 * MINUTE, { zernio });
    expect((await linkDms())[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect((await getTrigger(testEnv.DB, triggerId))!.link_state).toBe("delivered");
    expect(new Set(dms.map((dm) => dm.key)).size).toBe(2);
  });

  it("waits longer between tries as the days go by", async () => {
    await seedOpening();
    const { zernio } = fakeZernio([REFUSED]);
    await runScheduler(testEnv, NOW, { zernio });
    const [queued] = await linkDms();
    await testEnv.DB.prepare("UPDATE actions SET attempts = 9, send_at = ? WHERE id = ?").bind(NOW + DAY, queued!.id).run();

    await runScheduler(testEnv, NOW + DAY, { zernio });
    expect((await getAction(testEnv.DB, queued!.id))).toMatchObject({ status: "pending", send_at: NOW + DAY + 12 * HOUR });
  });

  it("gives up once the next try would land past the 7-day window", async () => {
    const triggerId = await seedOpening();
    const { zernio } = fakeZernio([REFUSED]);
    await runScheduler(testEnv, NOW, { zernio });
    const [queued] = await linkDms();
    const late = NOW + 7 * DAY - HOUR;
    await testEnv.DB.prepare("UPDATE actions SET attempts = 9, send_at = ? WHERE id = ?").bind(late, queued!.id).run();

    const report = await runScheduler(testEnv, late, { zernio });
    expect(report).toMatchObject({ dropped: 1, failed: 0 });
    expect(await getAction(testEnv.DB, queued!.id)).toMatchObject({ status: "dropped" });
    expect((await getTrigger(testEnv.DB, triggerId))!.link_state).toBe("awaiting_reply");
  });

  it("does not send the link twice when the reply webhook already sent it", async () => {
    const triggerId = await seedOpening();
    const { zernio, dms } = fakeZernio();
    await runScheduler(testEnv, NOW, { zernio });
    await testEnv.DB.prepare("UPDATE triggers SET link_state = 'delivered' WHERE id = ?").bind(triggerId).run();

    const report = await runScheduler(testEnv, NOW + 2 * MINUTE, { zernio });
    expect(dms).toHaveLength(0);
    expect(report.dropped).toBe(1);
  });

  it("queues nothing when the rule has no link", async () => {
    await seedOpening("none");
    await runScheduler(testEnv, NOW, fakeZernio());
    expect(await linkDms()).toHaveLength(0);
  });

  it("queues nothing when the opening DM could not be sent", async () => {
    await seedOpening();
    const failing = fakeZernio();
    failing.zernio.privateReply = () => Promise.reject(REFUSED);
    await runScheduler(testEnv, NOW, { zernio: failing.zernio });
    expect(await linkDms()).toHaveLength(0);
  });
});
