import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction, type ActionRow } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { getSetting } from "../src/db/settings";
import { newRule } from "./factories";
import { commentEvent } from "./fixtures";
import { postWebhook, postWebhookRaw, resetDb, seedConnectedAccount, testEnv } from "./helpers";

const VARIANTS = ["Sent! Check your DMs 👀", "Just sent it 🙌"];
const PROMPT = "Hey anna! Reply to this message and I'll send you the guide 👇";

async function seedRule(overrides: Partial<NewRule> = {}) {
  const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
  return insertRule(testEnv.DB, newRule({ link_id: link.id, public_replies: VARIANTS, ...overrides }), Date.now());
}

async function actions(): Promise<ActionRow[]> {
  const { results } = await testEnv.DB.prepare("SELECT * FROM actions ORDER BY id").all<ActionRow & { payload: string }>();
  return results.map((row) => ({ ...row, payload: JSON.parse(row.payload as unknown as string) }));
}

async function count(table: string): Promise<number> {
  return (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

async function linkState(): Promise<string | undefined> {
  return (await testEnv.DB.prepare("SELECT link_state FROM triggers").first<{ link_state: string }>())?.link_state;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /webhook: comments", () => {
  it("rejects an invalid signature, stores nothing and logs why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedRule();
    const res = await postWebhook(commentEvent(), "wrong-secret");
    expect(res.status).toBe(401);
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad signature"));
  });

  it("queues a public reply and a text-only opening DM about a minute out", async () => {
    await seedRule();
    const before = Date.now();
    const res = await postWebhook(commentEvent());
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await linkState()).toBe("awaiting_reply");

    const [publicReply, privateReply] = await actions();
    expect(publicReply!.payload).toMatchObject({ kind: "public_reply", mediaId: "media-1", commentId: "c-1" });
    expect(VARIANTS).toContain((publicReply!.payload as { text: string }).text);
    expect(privateReply!.payload).toEqual({ kind: "private_reply", mediaId: "media-1", commentId: "c-1", text: PROMPT });
    for (const action of [publicReply!, privateReply!]) {
      expect(action.status).toBe("pending");
      expect(action.send_at).toBeGreaterThanOrEqual(before + 60_000);
      expect(action.send_at).toBeLessThan(after + 70_000);
    }
  });

  it("queues only the DM when the rule has no public replies", async () => {
    await seedRule({ public_replies: [] });
    await postWebhook(commentEvent());
    expect((await actions()).map((a) => a.type)).toEqual(["private_reply"]);
  });

  it("needs no follow-up when the rule has no link", async () => {
    await insertRule(testEnv.DB, newRule({ opening_text: "Thanks {name}!" }), Date.now());
    await postWebhook(commentEvent({ username: "" }));
    expect((await actions())[0]!.payload).toEqual({ kind: "private_reply", mediaId: "media-1", commentId: "c-1", text: "Thanks there!" });
    expect(await linkState()).toBe("none");
  });

  it("does nothing for a comment without a keyword, but remembers the event", async () => {
    await seedRule();
    await postWebhook(commentEvent({ text: "love this" }));
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(1);
  });

  it("ignores comments by the creator's own account", async () => {
    await seedRule();
    await postWebhook(commentEvent({ commentId: "c-own-1", isOwn: true }));
    await postWebhook(commentEvent({ commentId: "c-own-2", fromId: "someone", username: "Creator" }));
    expect(await count("actions")).toBe(0);
  });

  it("sends one DM when Zernio delivers the same event twice", async () => {
    await seedRule();
    const event = commentEvent();
    await postWebhook(event);
    await postWebhook(event);
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("sends one DM when the same person comments the keyword again on the same post", async () => {
    await seedRule();
    await postWebhook(commentEvent({ commentId: "c-1" }));
    await postWebhook(commentEvent({ commentId: "c-2", text: "GUIDE!!" }));
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("finishes a delivery that failed halfway when Zernio retries", async () => {
    const rule = await seedRule();
    // State left by a first delivery that crashed after saving the trigger and the public reply.
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "user-1", media_id: "media-1", source: "comment",
      comment_id: "c-1", comment_at: Date.now(), created_at: Date.now(), link_state: "awaiting_reply",
    });
    await enqueueAction(testEnv.DB, {
      triggerId, contactIgsid: "user-1", sendAt: Date.now(),
      payload: { kind: "public_reply", mediaId: "media-1", commentId: "c-1", text: "Sent!" },
    }, Date.now());

    await postWebhook(commentEvent());
    expect((await actions()).map((a) => a.type)).toEqual(["public_reply", "private_reply"]);
  });

  it("acknowledges events it doesn't act on and records the time", async () => {
    const res = await postWebhook({ id: "evt-read", event: "message.read" });
    expect(res.status).toBe(200);
    expect(Number(await getSetting(testEnv.DB, "last_webhook_at"))).toBeGreaterThan(0);
  });

  it("rejects a body that isn't JSON", async () => {
    expect((await postWebhookRaw("not json")).status).toBe(400);
  });
});
