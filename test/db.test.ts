import { beforeEach, describe, expect, it } from "vitest";
import {
  claimActionById, claimDueActions, countActions, enqueueAction, enqueueActionOnce, failStuckActions, getAction,
  markRetry, recentActions, type ActionPayload,
} from "../src/db/actions";
import { getContact, upsertContact } from "../src/db/contacts";
import {
  claimAwaitingTriggers, findTriggerId, getTrigger, insertTrigger, isProcessed, markProcessed,
} from "../src/db/events";
import { countClicks, getLinkByCode, insertClick, insertLink } from "../src/db/links";
import { getRule, insertRule, listActiveRules, listRules, updateRule } from "../src/db/rules";
import { deleteSetting, getSetting, setSetting } from "../src/db/settings";
import { DAY } from "../src/time";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const db = () => testEnv.DB;
const NOW = 1_700_000_000_000;

beforeEach(resetDb);

async function trigger(overrides: Partial<Parameters<typeof insertTrigger>[1]> = {}) {
  const rule = await insertRule(db(), newRule(), NOW);
  return insertTrigger(db(), {
    rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
    comment_id: "c1", comment_at: NOW, created_at: NOW, link_state: "none", ...overrides,
  });
}

describe("settings", () => {
  it("stores, overwrites and deletes values", async () => {
    expect(await getSetting(db(), "ig_username")).toBeNull();
    await setSetting(db(), "ig_username", "a");
    await setSetting(db(), "ig_username", "b");
    expect(await getSetting(db(), "ig_username")).toBe("b");
    await deleteSetting(db(), "ig_username");
    expect(await getSetting(db(), "ig_username")).toBeNull();
  });
});

describe("rules", () => {
  it("round-trips JSON and boolean columns", async () => {
    const rule = await insertRule(db(), newRule({ scope: ["m1", "m2"], public_replies: ["Sent!"] }), NOW);
    expect(rule).toMatchObject({
      keywords: ["guide"], scope: ["m1", "m2"], public_replies: ["Sent!"],
      on_comment: true, follow_gate: false, active: true, created_at: NOW,
    });
    expect(await getRule(db(), rule.id)).toEqual(rule);
  });

  it("lists only active rules for matching", async () => {
    await insertRule(db(), newRule({ name: "on" }), NOW);
    await insertRule(db(), newRule({ name: "off", active: false }), NOW);
    expect((await listRules(db())).map((r) => r.name)).toEqual(["on", "off"]);
    expect((await listActiveRules(db())).map((r) => r.name)).toEqual(["on"]);
  });

  it("updates only the given fields and returns null for unknown ids", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const updated = await updateRule(db(), rule.id, { active: false, keywords: ["pdf"] });
    expect(updated).toMatchObject({ active: false, keywords: ["pdf"], name: "Guide" });
    expect(await updateRule(db(), 999_999, { active: false })).toBeNull();
  });
});

describe("contacts", () => {
  it("keeps a known username when a later event has none", async () => {
    await upsertContact(db(), { igsid: "u1", username: "anna" }, NOW);
    await upsertContact(db(), { igsid: "u1", username: null }, NOW + 1);
    expect(await getContact(db(), "u1")).toMatchObject({ username: "anna", first_seen_at: NOW, follows_me: null });
    await upsertContact(db(), { igsid: "u1", username: "anna2" }, NOW + 2);
    expect((await getContact(db(), "u1"))?.username).toBe("anna2");
  });
});

describe("events and triggers", () => {
  it("marks events processed idempotently", async () => {
    expect(await isProcessed(db(), "event:1")).toBe(false);
    await markProcessed(db(), "event:1", NOW);
    await markProcessed(db(), "event:1", NOW);
    expect(await isProcessed(db(), "event:1")).toBe(true);
  });

  it("returns null for a duplicate trigger and can find the existing one", async () => {
    const id = await trigger({ link_state: "awaiting_reply" });
    expect(id).not.toBeNull();
    const again = await insertTrigger(db(), {
      rule_id: (await getTrigger(db(), id!))!.rule_id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c2", comment_at: NOW, created_at: NOW, link_state: "awaiting_reply",
    });
    expect(again).toBeNull();
    const row = await getTrigger(db(), id!);
    expect(row).toMatchObject({ comment_id: "c1", link_state: "awaiting_reply" });
    expect(await findTriggerId(db(), row!.rule_id, "u1", "m1")).toBe(id);
    expect(await findTriggerId(db(), row!.rule_id, "u2", "m1")).toBeNull();
  });

  it("claims a contact's recent awaiting links exactly once", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const base = { rule_id: rule.id, contact_igsid: "u1", source: "comment" as const, comment_id: "c", comment_at: NOW };
    const recent = await insertTrigger(db(), { ...base, media_id: "m1", created_at: NOW, link_state: "awaiting_reply" });
    await insertTrigger(db(), { ...base, media_id: "m2", created_at: NOW - 8 * DAY, link_state: "awaiting_reply" });
    await insertTrigger(db(), { ...base, media_id: "m3", created_at: NOW, link_state: "none" });
    await insertTrigger(db(), { ...base, contact_igsid: "u2", media_id: "m1", created_at: NOW, link_state: "awaiting_reply" });

    const claimed = await claimAwaitingTriggers(db(), "u1", NOW - 7 * DAY);
    expect(claimed.map((t) => [t.id, t.link_state])).toEqual([[recent, "delivered"]]);
    expect(await claimAwaitingTriggers(db(), "u1", NOW - 7 * DAY)).toEqual([]);
  });
});

describe("actions", () => {
  const dm = (n: string): ActionPayload => ({ kind: "dm", conversationId: `conv-${n}`, message: { text: "hi" } });
  const privateReply: ActionPayload = { kind: "private_reply", mediaId: "m1", commentId: "c1", text: "hi" };

  it("claims only due actions of the requested types, up to the limit", async () => {
    const due1 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW - 2, payload: dm("1") }, NOW);
    const due2 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW - 1, payload: dm("2") }, NOW);
    await enqueueAction(db(), { triggerId: null, contactIgsid: "u3", sendAt: NOW + 60_000, payload: dm("3") }, NOW);
    await enqueueAction(db(), {
      triggerId: null, contactIgsid: "u4", sendAt: NOW - 5,
      payload: { kind: "public_reply", mediaId: "m4", commentId: "c4", text: "Sent!" },
    }, NOW);

    const claimed = await claimDueActions(db(), NOW, ["dm"], 1);
    expect(claimed.map((a) => a.id)).toEqual([due1]);
    expect(claimed[0]).toMatchObject({ status: "sending", attempts: 1, claimed_at: NOW, payload: dm("1") });
    expect((await claimDueActions(db(), NOW, ["dm"], 10)).map((a) => a.id)).toEqual([due2]);
  });

  it("claims one specific pending action, only once", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    expect(await claimActionById(db(), id, NOW)).toMatchObject({ id, status: "sending", attempts: 1 });
    expect(await claimActionById(db(), id, NOW)).toBeNull();
  });

  it("enqueues at most one opening DM and one public reply per trigger", async () => {
    const triggerId = await trigger();
    const reply = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: privateReply };
    expect(await enqueueActionOnce(db(), reply, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), reply, NOW)).toBeNull();
    const followUp = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: dm("1") };
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
  });

  it("puts a retried action back in the queue", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    await markRetry(db(), id, NOW + 60_000, "boom");
    expect(await getAction(db(), id)).toMatchObject({ status: "pending", send_at: NOW + 60_000, last_error: "boom", attempts: 1 });
  });

  it("fails actions stuck in sending", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    expect(await failStuckActions(db(), NOW + 1)).toBe(1);
    expect(await getAction(db(), id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
    expect(await countActions(db(), "failed")).toBe(1);
    expect(await countActions(db(), "failed", NOW + 10)).toBe(0);
  });

  it("lists recent actions newest first", async () => {
    const a = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    const b = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW, payload: dm("2") }, NOW);
    expect((await recentActions(db(), 10)).map((x) => x.id)).toEqual([b, a]);
  });
});

describe("links", () => {
  it("stores links and counts clicks", async () => {
    const link = await insertLink(db(), "abc123", "https://example.com", "Guide", NOW);
    expect(await getLinkByCode(db(), "abc123")).toEqual(link);
    await insertClick(db(), link.id, "u1", NOW);
    await insertClick(db(), link.id, null, NOW);
    expect(await countClicks(db(), link.id)).toBe(2);
    expect(await getLinkByCode(db(), "nope")).toBeNull();
  });
});
