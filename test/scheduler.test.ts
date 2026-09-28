import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actionsDb from "../src/db/actions";
import { enqueueAction, getAction, type ActionPayload } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertRule } from "../src/db/rules";
import { InstagramError, type InstagramClient } from "../src/instagram";
import { runScheduler } from "../src/scheduler";
import { DAY, MINUTE } from "../src/time";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const NOW = 1_700_000_000_000;

function fakeIg(sendImpl?: () => Promise<{ messageId: string }>) {
  const sent: unknown[][] = [];
  const ig: InstagramClient = {
    async sendMessage(recipient, message) {
      sent.push(["sendMessage", recipient, message]);
      return sendImpl ? sendImpl() : { messageId: `mid-${sent.length}` };
    },
    async replyToComment(commentId, text) {
      sent.push(["replyToComment", commentId, text]);
      return { id: `reply-${sent.length}` };
    },
    async listMedia() { return []; },
    async subscribeWebhooks() {},
  };
  return { ig, sent };
}

const privateReply = (commentId: string): ActionPayload => ({ kind: "private_reply", commentId, message: { text: "hi" } });
const enqueue = (payload: ActionPayload, sendAt = NOW - 1, triggerId: number | null = null) =>
  enqueueAction(testEnv.DB, { triggerId, contactIgsid: "u1", payload, sendAt }, NOW - 1);

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("runScheduler", () => {
  it("does nothing and loses nothing before Instagram is connected", async () => {
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW);
    expect(report.skippedNoToken).toBe(true);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends due actions and leaves future ones queued", async () => {
    const { ig, sent } = fakeIg();
    const dm = await enqueue(privateReply("c1"));
    const reply = await enqueue({ kind: "public_reply", commentId: "c1", text: "Sent!" });
    const later = await enqueue({ kind: "dm", igsid: "u1", message: { text: "later" } }, NOW + MINUTE);

    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report).toMatchObject({ sent: 2, failed: 0, retried: 0 });
    expect(sent).toHaveLength(2);
    expect(await getAction(testEnv.DB, dm)).toMatchObject({ status: "sent", sent_mid: "mid-1" });
    expect(await getAction(testEnv.DB, reply)).toMatchObject({ status: "sent", sent_mid: null });
    expect(await getAction(testEnv.DB, later)).toMatchObject({ status: "pending" });
  });

  it("caps comment replies at 12 per run but still sends DMs", async () => {
    const { ig } = fakeIg();
    for (let i = 0; i < 15; i++) await enqueue(privateReply(`c${i}`));
    for (let i = 0; i < 3; i++) await enqueue({ kind: "dm", igsid: `u${i}`, message: { text: "hi" } });
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.sent).toBe(15);
    const pending = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").first<{ n: number }>();
    expect(pending!.n).toBe(3);
  });

  it("retries a transient failure a minute later", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("down", 500, 2, true)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.retried).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 1, send_at: NOW + MINUTE });
  });

  it("gives up after the fourth transient failure", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("down", 500, 2, true)));
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET attempts = 3 WHERE id = ?").bind(id).run();
    await runScheduler(testEnv, NOW, { ig });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("fails a permanent error immediately", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("User blocked", 400, 100, false)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.failed).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed" });
    expect((await getAction(testEnv.DB, id))!.last_error).toContain("User blocked");
  });

  it("drops a private reply to a comment older than 7 days", async () => {
    const { ig, sent } = fakeIg();
    const rule = await insertRule(testEnv.DB, newRule(), NOW);
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW - 8 * DAY, created_at: NOW - 8 * DAY,
    });
    const id = await enqueue(privateReply("c1"), NOW - 1, triggerId);
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.dropped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "dropped" });
  });

  it("never resends a message that was delivered but could not be recorded", async () => {
    const { ig, sent } = fakeIg();
    const id = await enqueue(privateReply("c1"));
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    await runScheduler(testEnv, NOW, { ig });
    await runScheduler(testEnv, NOW + MINUTE, { ig });
    expect(sent).toHaveLength(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "sending" });
  });

  it("keeps working through the batch when one row's bookkeeping fails", async () => {
    const { ig, sent } = fakeIg();
    await enqueue(privateReply("c1"), NOW - 2);
    const second = await enqueue(privateReply("c2"), NOW - 1);
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(actionsDb, "markRetry").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduler(testEnv, NOW, { ig });
    expect(sent).toHaveLength(2);
    expect(await getAction(testEnv.DB, second)).toMatchObject({ status: "sent" });
  });

  it("fails actions stuck in sending for over 10 minutes", async () => {
    const { ig } = fakeIg();
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending', claimed_at = ? WHERE id = ?").bind(NOW - 11 * MINUTE, id).run();
    await runScheduler(testEnv, NOW, { ig });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
  });
});
