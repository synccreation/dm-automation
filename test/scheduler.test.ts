import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actionsDb from "../src/db/actions";
import { enqueueAction, getAction, type ActionPayload } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertRule } from "../src/db/rules";
import { runScheduler, sendActionNow } from "../src/scheduler";
import { DAY, MINUTE } from "../src/time";
import { ZernioError, type ZernioClient } from "../src/zernio";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const NOW = 1_700_000_000_000;

function fakeZernio(fail?: () => Promise<never>) {
  const sent: unknown[][] = [];
  const zernio: ZernioClient = {
    async privateReply(mediaId, commentId, text) {
      sent.push(["privateReply", mediaId, commentId, text]);
      if (fail) return fail();
      return { messageId: `mid-${sent.length}` };
    },
    async replyToComment(mediaId, commentId, text, key) {
      sent.push(["replyToComment", mediaId, commentId, text, key]);
      if (fail) return fail();
      return { commentId: `reply-${sent.length}` };
    },
    async sendDm(conversationId, message, key) {
      sent.push(["sendDm", conversationId, message, key]);
      if (fail) return fail();
      return { messageId: `dm-${sent.length}` };
    },
    async listPosts() { return []; },
  };
  return { zernio, sent };
}

const privateReply = (commentId: string): ActionPayload => ({ kind: "private_reply", mediaId: "m1", commentId, text: "hi" });
const dmTo = (conversationId: string): ActionPayload => ({ kind: "dm", conversationId, message: { text: "hi" } });
const enqueue = (payload: ActionPayload, sendAt = NOW - 1, triggerId: number | null = null) =>
  enqueueAction(testEnv.DB, { triggerId, contactIgsid: "u1", payload, sendAt }, NOW - 1);

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("runScheduler", () => {
  it("does nothing and loses nothing before Zernio is set up", async () => {
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW);
    expect(report.skippedNoToken).toBe(true);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends due actions with idempotency keys and leaves future ones queued", async () => {
    const { zernio, sent } = fakeZernio();
    const dm = await enqueue(privateReply("c1"));
    const reply = await enqueue({ kind: "public_reply", mediaId: "m1", commentId: "c1", text: "Sent!" });
    const later = await enqueue(dmTo("conv-1"), NOW + MINUTE);

    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report).toMatchObject({ sent: 2, failed: 0, retried: 0 });
    expect(sent).toEqual([
      ["privateReply", "m1", "c1", "hi"],
      ["replyToComment", "m1", "c1", "Sent!", `action-${reply}`],
    ]);
    expect(await getAction(testEnv.DB, dm)).toMatchObject({ status: "sent", sent_mid: "mid-1" });
    expect(await getAction(testEnv.DB, reply)).toMatchObject({ status: "sent", sent_mid: "reply-2" });
    expect(await getAction(testEnv.DB, later)).toMatchObject({ status: "pending" });
  });

  it("caps comment replies at 12 and DMs at 20 per run", async () => {
    const { zernio } = fakeZernio();
    for (let i = 0; i < 15; i++) await enqueue(privateReply(`c${i}`));
    for (let i = 0; i < 25; i++) await enqueue(dmTo(`conv-${i}`));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.sent).toBe(32);
    const pending = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").first<{ n: number }>();
    expect(pending!.n).toBe(8);
  });

  it("retries a transient failure a minute later", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("down", 500, null, true)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.retried).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 1, send_at: NOW + MINUTE });
  });

  it("gives up after the fourth transient failure", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("down", 500, null, true)));
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET attempts = 3 WHERE id = ?").bind(id).run();
    await runScheduler(testEnv, NOW, { zernio });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("fails a permanent error immediately and keeps the reason", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("Instagram refused this private reply", 400, "platform_api_error", false)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.failed).toBe(1);
    expect((await getAction(testEnv.DB, id))!.last_error).toContain("refused");
  });

  it("drops a private reply to a comment older than 7 days", async () => {
    const { zernio, sent } = fakeZernio();
    const rule = await insertRule(testEnv.DB, newRule(), NOW);
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW - 8 * DAY, created_at: NOW - 8 * DAY, link_state: "none",
    });
    const id = await enqueue(privateReply("c1"), NOW - 1, triggerId);
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.dropped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "dropped" });
  });

  it("never resends a message that was delivered but could not be recorded", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(privateReply("c1"));
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduler(testEnv, NOW, { zernio });
    await runScheduler(testEnv, NOW + MINUTE, { zernio });
    expect(sent).toHaveLength(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "sending" });
  });

  it("keeps working through the batch when one row's bookkeeping fails", async () => {
    const { zernio, sent } = fakeZernio();
    await enqueue(privateReply("c1"), NOW - 2);
    const second = await enqueue(privateReply("c2"), NOW - 1);
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(actionsDb, "markRetry").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduler(testEnv, NOW, { zernio });
    expect(sent).toHaveLength(2);
    expect(await getAction(testEnv.DB, second)).toMatchObject({ status: "sent" });
  });

  it("fails actions stuck in sending for over 10 minutes", async () => {
    const { zernio } = fakeZernio();
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending', claimed_at = ? WHERE id = ?").bind(NOW - 11 * MINUTE, id).run();
    await runScheduler(testEnv, NOW, { zernio });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
  });
});

describe("sendActionNow", () => {
  it("sends one queued action immediately, with its idempotency key", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(dmTo("conv-1"), NOW);
    expect(await sendActionNow(testEnv, id, NOW, { zernio })).toBe(true);
    expect(sent).toEqual([["sendDm", "conv-1", { text: "hi" }, `action-${id}`]]);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "sent", sent_mid: "dm-1" });
  });

  it("does nothing when the scheduler already claimed the action", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(dmTo("conv-1"), NOW);
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending' WHERE id = ?").bind(id).run();
    expect(await sendActionNow(testEnv, id, NOW, { zernio })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
