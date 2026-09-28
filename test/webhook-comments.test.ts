import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRow } from "../src/db/actions";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { getSetting } from "../src/db/settings";
import { app } from "../src/index";
import { hmacSha256Hex } from "../src/webhook/verify";
import { newRule } from "./factories";
import { commentPayload, messagingPayload } from "./fixtures";
import { IG_USER_ID, resetDb, seedConnectedAccount, testEnv } from "./helpers";

const VARIANTS = ["Sent! Check your DMs 👀", "Just sent it 🙌"];

async function postWebhook(body: unknown, secret = "test-app-secret"): Promise<Response> {
  const raw = JSON.stringify(body);
  return app.request("/webhook", {
    method: "POST",
    body: raw,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(secret, raw)}` },
  }, testEnv);
}

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

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});

describe("POST /webhook: comments", () => {
  it("rejects an invalid signature and stores nothing", async () => {
    await seedRule();
    const res = await postWebhook(commentPayload(), "wrong-secret");
    expect(res.status).toBe(401);
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(0);
  });

  it("queues a public reply and an opening DM about a minute out", async () => {
    await seedRule();
    const before = Date.now();
    const res = await postWebhook(commentPayload());
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EVENT_RECEIVED");
    expect(await count("triggers")).toBe(1);

    const [publicReply, privateReply] = await actions();
    expect(publicReply!.type).toBe("public_reply");
    expect(VARIANTS).toContain((publicReply!.payload as { text: string }).text);
    expect(privateReply!.type).toBe("private_reply");
    expect(privateReply!.payload).toEqual({
      kind: "private_reply",
      commentId: "c-1",
      message: {
        text: "Hey anna! Here you go 👇",
        buttons: [{ type: "web_url", title: "Get the guide", url: "https://dm.test/l/abc123?c=user-1" }],
      },
    });
    for (const action of [publicReply!, privateReply!]) {
      expect(action.status).toBe("pending");
      expect(action.send_at).toBeGreaterThanOrEqual(before + 60_000);
      expect(action.send_at).toBeLessThan(after + 70_000);
    }
  });

  it("queues only the DM when the rule has no public replies", async () => {
    await seedRule({ public_replies: [] });
    await postWebhook(commentPayload());
    expect((await actions()).map((a) => a.type)).toEqual(["private_reply"]);
  });

  it("sends plain text when the rule has no link", async () => {
    await insertRule(testEnv.DB, newRule(), Date.now());
    await postWebhook(commentPayload({ username: "" }));
    const [dm] = await actions();
    expect(dm!.payload).toEqual({ kind: "private_reply", commentId: "c-1", message: { text: "Hey there! Here you go 👇" } });
  });

  it("does nothing for a comment without a keyword, but remembers it", async () => {
    await seedRule();
    await postWebhook(commentPayload({ text: "love this" }));
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(1);
  });

  it("ignores the creator's own comments", async () => {
    await seedRule();
    await postWebhook(commentPayload({ fromId: IG_USER_ID, text: "guide is in bio" }));
    expect(await count("actions")).toBe(0);
  });

  it("sends one DM when Meta delivers the same webhook twice", async () => {
    await seedRule();
    await postWebhook(commentPayload());
    await postWebhook(commentPayload());
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("sends one DM when the same person comments the keyword again on the same post", async () => {
    await seedRule();
    await postWebhook(commentPayload({ commentId: "c-1" }));
    await postWebhook(commentPayload({ commentId: "c-2", text: "GUIDE!!" }));
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("records when the last webhook arrived, even with no events", async () => {
    const res = await postWebhook(messagingPayload([]));
    expect(res.status).toBe(200);
    expect(Number(await getSetting(testEnv.DB, "last_webhook_at"))).toBeGreaterThan(0);
  });
});
