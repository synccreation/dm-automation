import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfill } from "../src/backfill";
import { insertLink } from "../src/db/links";
import { getRule, insertRule, type NewRule } from "../src/db/rules";
import { captionAsksFor } from "../src/rules";
import { newRule } from "./factories";
import { commentEvent } from "./fixtures";
import { jsonResponse, postWebhook, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

const KIMI_CAPTION = "kimi just made blender optional\n\ncomment “KIMI” and i’ll send you the setup";

function zernioApi(posts: { id: string; message: string | null }[], comments: unknown[] = []) {
  return (call: FetchCall): Response => {
    const path = new URL(call.url).pathname;
    if (path.endsWith("/posts")) return jsonResponse({ posts });
    if (path.startsWith("/api/v1/inbox/comments/")) return jsonResponse({ comments, pagination: { hasMore: false } });
    return jsonResponse({ error: "unexpected" }, 500);
  };
}

const postsCalls = (calls: FetchCall[]) => calls.filter((c) => new URL(c.url).pathname.endsWith("/posts")).length;

async function seedRule(overrides: Partial<NewRule> = {}) {
  const link = await insertLink(testEnv.DB, `l${Math.random()}`.slice(0, 8), "https://example.com/setup", "Setup", Date.now());
  return insertRule(testEnv.DB, newRule({ keywords: ["kimi"], scope: [], auto_scope: true, link_id: link.id, ...overrides }), Date.now());
}

async function privateReplies(): Promise<number> {
  return (await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM actions WHERE type = 'private_reply'").first<{ n: number }>())!.n;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("captionAsksFor", () => {
  it.each([
    ["comment “KIMI” and i’ll send you the setup", "kimi", true],
    ["comment STACK and i’ll send you every tool", "stack", true],
    ["Comment the word guide below", "guide", true],
    ["comment “3D MAKE” for the setup", "3d make", true],
    ["kimi 3d make is wild", "kimi", false],
    ["comment below what you think about kimi", "kimi", false],
    ["comment “gif” and ill send you the link", "kimi", false],
  ])("%j asks for %j: %s", (caption, keyword, expected) => {
    expect(captionAsksFor(caption, keyword)).toBe(expected);
  });
});

describe("auto scope", () => {
  it("adds a post whose caption asks for the keyword, then answers the comment", async () => {
    const rule = await seedRule();
    const calls = stubGlobalFetch(zernioApi([{ id: "reel-1", message: KIMI_CAPTION }, { id: "old", message: "hi" }]));
    await postWebhook(commentEvent({ mediaId: "reel-1", text: "KIMI 🔥" }));
    expect((await getRule(testEnv.DB, rule.id))!.scope).toEqual(["reel-1"]);
    expect(await privateReplies()).toBe(1);

    // Now in scope: the next comment needs no caption lookup.
    await postWebhook(commentEvent({ mediaId: "reel-1", commentId: "c-2", fromId: "user-2", text: "kimi" }));
    expect(await privateReplies()).toBe(2);
    expect(postsCalls(calls)).toBe(1);
  });

  it("uses the caption Zernio sends with the comment when it has one", async () => {
    const rule = await seedRule();
    const calls = stubGlobalFetch(zernioApi([]));
    await postWebhook(commentEvent({ mediaId: "reel-2", text: "kimi", caption: KIMI_CAPTION }));
    expect((await getRule(testEnv.DB, rule.id))!.scope).toEqual(["reel-2"]);
    expect(postsCalls(calls)).toBe(0);
  });

  it("leaves posts alone when the caption doesn't ask, and caches the caption", async () => {
    const rule = await seedRule();
    const calls = stubGlobalFetch(zernioApi([{ id: "reel-3", message: "kimi 3d make is wild" }]));
    await postWebhook(commentEvent({ mediaId: "reel-3", text: "kimi" }));
    await postWebhook(commentEvent({ mediaId: "reel-3", commentId: "c-2", fromId: "user-2", text: "kimi" }));
    expect((await getRule(testEnv.DB, rule.id))!.scope).toEqual([]);
    expect(await privateReplies()).toBe(0);
    expect(postsCalls(calls)).toBe(1);
  });

  it("gives the post to the newest rule with that keyword", async () => {
    const older = await seedRule({ name: "old kimi", scope: ["reel-0"] });
    const newer = await seedRule({ name: "new kimi" });
    stubGlobalFetch(zernioApi([{ id: "reel-4", message: KIMI_CAPTION }]));
    await postWebhook(commentEvent({ mediaId: "reel-4", text: "kimi" }));
    expect((await getRule(testEnv.DB, newer.id))!.scope).toEqual(["reel-4"]);
    expect((await getRule(testEnv.DB, older.id))!.scope).toEqual(["reel-0"]);
  });

  it("never looks up captions for rules with auto_scope off, or inactive rules", async () => {
    await seedRule({ auto_scope: false, scope: ["reel-0"] });
    await seedRule({ active: false });
    const calls = stubGlobalFetch(zernioApi([{ id: "reel-5", message: KIMI_CAPTION }]));
    await postWebhook(commentEvent({ mediaId: "reel-5", text: "kimi" }));
    expect(calls).toHaveLength(0);
    expect(await privateReplies()).toBe(0);
  });

  it("lets backfill attach a post too", async () => {
    const rule = await seedRule();
    const at = new Date(Date.now() - 3600_000).toISOString();
    stubGlobalFetch(zernioApi([{ id: "reel-6", message: KIMI_CAPTION }], [
      { id: "c1", message: "Kimi!", createdTime: at, from: { id: "u1", username: "anna" }, replies: [] },
    ]));
    expect(await runBackfill(testEnv, "reel-6", Date.now())).toEqual({ scanned: 1, triggered: 1 });
    expect((await getRule(testEnv.DB, rule.id))!.scope).toEqual(["reel-6"]);
  });
});
