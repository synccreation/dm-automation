import { enqueueAction } from "../db/actions";
import { upsertContact } from "../db/contacts";
import { insertTrigger, isProcessed, markProcessed } from "../db/events";
import { getLinkById } from "../db/links";
import { listActiveRules, type RuleRow } from "../db/rules";
import { getSetting } from "../db/settings";
import type { AppEnv } from "../env";
import { trackedUrl } from "../links";
import type { OutgoingMessage } from "../messages";
import { fillTemplate, findMatchingRule } from "../rules";
import { openingSendAt } from "../time";
import type { WebhookEvent } from "./parse";

type CommentEvent = Extract<WebhookEvent, { kind: "comment" }>;

export interface HandleOptions {
  now: number;
  random?: () => number;
}

export async function handleEvents(env: AppEnv, events: WebhookEvent[], options: HandleOptions): Promise<void> {
  for (const event of events) {
    // Messages, echoes and postbacks are handled in milestone 2.
    if (event.kind === "comment") await handleComment(env, event, options);
  }
}

async function handleComment(env: AppEnv, event: CommentEvent, options: HandleOptions): Promise<void> {
  const key = `comment:${event.commentId}`;
  if (await isProcessed(env.DB, key)) return;

  const ownId = await getSetting(env.DB, "ig_user_id");
  const isOwnComment = event.fromId === event.accountId || event.fromId === ownId;
  if (!isOwnComment) {
    const rule = findMatchingRule(await listActiveRules(env.DB), event.text, event.mediaId, "comment");
    if (rule) await triggerCommentRule(env, rule, event, options);
  }
  // Marked last: if anything above throws, Meta retries the webhook, and the
  // triggers table's unique key stops the retry from sending a second DM.
  await markProcessed(env.DB, key, options.now);
}

async function triggerCommentRule(
  env: AppEnv, rule: RuleRow, event: CommentEvent, { now, random = Math.random }: HandleOptions,
): Promise<void> {
  await upsertContact(env.DB, { igsid: event.fromId, username: event.fromUsername }, now);
  const triggerId = await insertTrigger(env.DB, {
    rule_id: rule.id, contact_igsid: event.fromId, media_id: event.mediaId, source: "comment",
    comment_id: event.commentId, comment_at: now, created_at: now,
  });
  if (triggerId === null) return; // already triggered for this person on this post

  const sendAt = openingSendAt(now, random);
  if (rule.public_replies.length > 0) {
    const text = rule.public_replies[Math.floor(random() * rule.public_replies.length)]!;
    await enqueueAction(env.DB, {
      triggerId, contactIgsid: event.fromId, sendAt,
      payload: { kind: "public_reply", commentId: event.commentId, text },
    }, now);
  }
  await enqueueAction(env.DB, {
    triggerId, contactIgsid: event.fromId, sendAt,
    payload: { kind: "private_reply", commentId: event.commentId, message: await openingMessage(env, rule, event) },
  }, now);
}

async function openingMessage(env: AppEnv, rule: RuleRow, event: CommentEvent): Promise<OutgoingMessage> {
  const text = fillTemplate(rule.opening_text, { name: event.fromUsername ?? "there" });
  const link = rule.link_id === null ? null : await getLinkById(env.DB, rule.link_id);
  if (!link) return { text };
  return {
    text,
    buttons: [{ type: "web_url", title: rule.button_label, url: trackedUrl(env.PUBLIC_URL, link.code, event.fromId) }],
  };
}
