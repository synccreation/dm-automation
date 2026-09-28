import { beforeEach, describe, expect, it } from "vitest";
import {
  claimDueActions, countActions, enqueueAction, enqueueActionOnce, failStuckActions, getAction, markRetry, recentActions,
} from "../src/db/actions";
import { getContact, upsertContact } from "../src/db/contacts";
import { findTriggerId, getTrigger, insertTrigger, isProcessed, markProcessed } from "../src/db/events";
import { countClicks, getLinkByCode, insertClick, insertLink } from "../src/db/links";
import { getRule, insertRule, listActiveRules, listRules, updateRule } from "../src/db/rules";
import { deleteSetting, getSetting, setSetting } from "../src/db/settings";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const db = () => testEnv.DB;
const NOW = 1_700_000_000_000;

beforeEach(resetDb);

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
    expect(await isProcessed(db(), "comment:1")).toBe(false);
    await markProcessed(db(), "comment:1", NOW);
    await markProcessed(db(), "comment:1", NOW);
    expect(await isProcessed(db(), "comment:1")).toBe(true);
  });

  it("returns null for a duplicate trigger (same rule, person, post)", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const trigger = {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment" as const,
      comment_id: "c1", comment_at: NOW, created_at: NOW,
    };
    const id = await insertTrigger(db(), trigger);
    expect(id).not.toBeNull();
    expect(await insertTrigger(db(), { ...trigger, comment_id: "c2" })).toBeNull();
    expect(await getTrigger(db(), id!)).toMatchObject({ comment_id: "c1", source: "comment" });
  });
});

describe("actions", () => {
  const dm = (igsid: string) => ({ kind: "dm" as const, igsid, message: { text: "hi" } });
  const privateReplyPayload = { kind: "private_reply" as const, commentId: "c1", message: { text: "hi" } };

  it("claims only due actions of the requested types, up to the limit", async () => {
    const due1 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW - 2, payload: dm("u1") }, NOW);
    const due2 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW - 1, payload: dm("u2") }, NOW);
    await enqueueAction(db(), { triggerId: null, contactIgsid: "u3", sendAt: NOW + 60_000, payload: dm("u3") }, NOW);
    await enqueueAction(db(), {
      triggerId: null, contactIgsid: "u4", sendAt: NOW - 5,
      payload: { kind: "public_reply", commentId: "c4", text: "Sent!" },
    }, NOW);

    const claimed = await claimDueActions(db(), NOW, ["dm"], 1);
    expect(claimed.map((a) => a.id)).toEqual([due1]);
    expect(claimed[0]).toMatchObject({ status: "sending", attempts: 1, claimed_at: NOW, payload: dm("u1") });

    const next = await claimDueActions(db(), NOW, ["dm"], 10);
    expect(next.map((a) => a.id)).toEqual([due2]);
  });

  it("puts a retried action back in the queue", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    await markRetry(db(), id, NOW + 60_000, "boom");
    expect(await getAction(db(), id)).toMatchObject({ status: "pending", send_at: NOW + 60_000, last_error: "boom", attempts: 1 });
  });

  it("fails actions stuck in sending", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    expect(await failStuckActions(db(), NOW + 1)).toBe(1);
    expect(await getAction(db(), id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
    expect(await countActions(db(), "failed")).toBe(1);
    expect(await countActions(db(), "failed", NOW + 10)).toBe(0);
  });

  it("enqueues at most one opening DM and one public reply per trigger", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const triggerId = await insertTrigger(db(), {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW, created_at: NOW,
    });
    const reply = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: privateReplyPayload };
    expect(await enqueueActionOnce(db(), reply, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), reply, NOW)).toBeNull();
    // DMs are not limited: milestone 2 sends several per trigger (follow-gate prompts).
    const followUp = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") };
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
  });

  it("finds an existing trigger by rule, person and media", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const id = await insertTrigger(db(), {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW, created_at: NOW,
    });
    expect(await findTriggerId(db(), rule.id, "u1", "m1")).toBe(id);
    expect(await findTriggerId(db(), rule.id, "u2", "m1")).toBeNull();
  });

  it("lists recent actions newest first", async () => {
    const a = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    const b = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW, payload: dm("u2") }, NOW);
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
