import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfill } from "../src/backfill";
import { insertLink } from "../src/db/links";
import { insertRule } from "../src/db/rules";
import { app } from "../src/index";
import { DAY } from "../src/time";
import { parseCli } from "../scripts/cli-core";
import { newRule } from "./factories";
import { jsonResponse, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const comment = (id: string, text: string, from: { id: string; username: string; isOwner?: boolean }, at = NOW - 3600_000) =>
  ({ id, message: text, createdTime: iso(at), from, replies: [] as unknown[] });

function commentsApi(pages: unknown[][]) {
  return (call: FetchCall): Response => {
    const url = new URL(call.url);
    if (!url.pathname.startsWith("/api/v1/inbox/comments/media-1")) return jsonResponse({ error: "unexpected" }, 500);
    const page = Number(url.searchParams.get("cursor") ?? "0");
    return jsonResponse({ comments: pages[page], pagination: { hasMore: page + 1 < pages.length, cursor: String(page + 1) } });
  };
}

async function count(sql: string): Promise<number> {
  return (await testEnv.DB.prepare(sql).first<{ n: number }>())!.n;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
  const link = await insertLink(testEnv.DB, "abc123", "https://example.com", "Guide", NOW);
  await insertRule(testEnv.DB, newRule({ keywords: ["agent"], scope: ["media-1"], link_id: link.id, public_replies: ["Sent!"] }), NOW);
});
afterEach(() => vi.restoreAllMocks());

describe("runBackfill", () => {
  it("queues the flow for existing keyword comments across pages, once", async () => {
    const calls = stubGlobalFetch(commentsApi([
      [comment("c1", "agent", { id: "u1", username: "anna" }), comment("c2", "nice video", { id: "u2", username: "bob" })],
      [{ ...comment("c3", "love it", { id: "u3", username: "cat" }), replies: [comment("c4", "Agent pls", { id: "u4", username: "dan" })] }],
    ]));
    const result = await runBackfill(testEnv, "media-1", NOW);
    expect(result).toEqual({ scanned: 4, triggered: 2 });
    expect(calls[0]!.url).toContain("accountId=");
    expect(await count("SELECT COUNT(*) AS n FROM actions WHERE type = 'private_reply'")).toBe(2);

    expect(await runBackfill(testEnv, "media-1", NOW)).toEqual({ scanned: 4, triggered: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM actions")).toBe(4);
  });

  it("skips the creator's own comments and comments older than 7 days", async () => {
    stubGlobalFetch(commentsApi([[
      comment("c1", "agent", { id: "me", username: "creator", isOwner: true }),
      comment("c2", "agent", { id: "u2", username: "old" }, NOW - 8 * DAY),
    ]]));
    expect(await runBackfill(testEnv, "media-1", NOW)).toEqual({ scanned: 2, triggered: 0 });
  });
});

describe("POST /admin/backfill and the CLI", () => {
  it("runs the backfill for a post", async () => {
    stubGlobalFetch(commentsApi([[comment("c1", "agent", { id: "u1", username: "anna" })]]));
    const res = await app.request("/admin/backfill", {
      method: "POST", body: JSON.stringify({ mediaId: "media-1" }),
      headers: { Authorization: "Bearer test-admin-token", "Content-Type": "application/json" },
    }, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scanned: 1, triggered: 1 });
  });

  it("maps `backfill <postId>`", () => {
    expect(parseCli(["backfill", "123"])).toEqual({ ok: true, request: { method: "POST", path: "/admin/backfill", body: { mediaId: "123" } } });
    expect(parseCli(["backfill"]).ok).toBe(false);
  });
});
