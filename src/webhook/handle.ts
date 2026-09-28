import { enqueueAction, enqueueActionOnce } from "../db/actions";
import { upsertContact } from "../db/contacts";
import { claimAwaitingTriggers, findTriggerId, insertTrigger, isProcessed, markProcessed } from "../db/events";
import { getLinkById } from "../db/links";
import { getRule, listActiveRules, type RuleRow } from "../db/rules";
import { getSetting } from "../db/settings";
import type { AppEnv } from "../env";
import { trackedUrl } from "../links";
import { fillTemplate, findMatchingRule } from "../rules";
import { sendActionNow } from "../scheduler";
import { DAY, openingSendAt } from "../time";
import type { WebhookEvent } from "./parse";

type CommentEvent = Extract<WebhookEvent, { kind: "comment" }>;
type MessageEvent = Extract<WebhookEvent, { kind: "message" }>;

export interface HandleOptions {
  now: number;
  random?: () => number;
  /** Runs work after the webhook is acknowledged (ctx.waitUntil); Zernio wants a reply within 5 s. */
  defer: (task: Promise<unknown>) => void;
}

const LINK_WINDOW_MS = 7 * DAY;
const DEFAULT_LINK_TEXT = "Here you go 👇";

export async function handleEvent(env: AppEnv, event: WebhookEvent, options: HandleOptions): Promise<void> {
  const key = `event:${event.eventId}`;
  if (await isProcessed(env.DB, key)) return;
  if (event.kind === "comment") await handleComment(env, event, options);
  if (event.kind === "message") await handleMessage(env, event, options);
  // Echoes feed the milestone 2 inbox. Marked last: if anything above throws, Zernio
  // redelivers (same event id) and the retry only fills in what the failed attempt missed.
  await markProcessed(env.DB, key, options.now);
}

async function handleComment(env: AppEnv, event: CommentEvent, options: HandleOptions): Promise<void> {
  const ownUsername = await getSetting(env.DB, "ig_username");
  const byCreator =
    event.isOwn || (ownUsername !== null && event.fromUsername?.toLowerCase() === ownUsername.toLowerCase());
  if (byCreator) return;
  const rule = findMatchingRule(await listActiveRules(env.DB), event.text, event.mediaId, "comment");
  if (rule) await triggerCommentRule(env, rule, event, options);
}

async function triggerCommentRule(
  env: AppEnv, rule: RuleRow, event: CommentEvent, { now, random = Math.random }: HandleOptions,
): Promise<void> {
  await upsertContact(env.DB, { igsid: event.fromId, username: event.fromUsername }, now);
  const triggerId =
    (await insertTrigger(env.DB, {
      rule_id: rule.id, contact_igsid: event.fromId, media_id: event.mediaId, source: "comment",
      comment_id: event.commentId, comment_at: now, created_at: now,
      // Instagram refuses buttons in a private reply to non-followers, so the opening DM is plain
      // text asking them to reply; the link follows once they do (handleMessage).
      link_state: rule.link_id === null ? "none" : "awaiting_reply",
    })) ?? (await findTriggerId(env.DB, rule.id, event.fromId, event.mediaId));
  if (triggerId === null) throw new Error(`trigger for rule ${rule.id} vanished`);

  // enqueueActionOnce keeps one of each per trigger, so repeat comments and
  // redeliveries never queue a second DM or reply.
  const sendAt = openingSendAt(now, random);
  if (rule.public_replies.length > 0) {
    const text = rule.public_replies[Math.floor(random() * rule.public_replies.length)]!;
    await enqueueActionOnce(env.DB, {
      triggerId, contactIgsid: event.fromId, sendAt,
      payload: { kind: "public_reply", mediaId: event.mediaId, commentId: event.commentId, text },
    }, now);
  }
  await enqueueActionOnce(env.DB, {
    triggerId, contactIgsid: event.fromId, sendAt,
    payload: {
      kind: "private_reply", mediaId: event.mediaId, commentId: event.commentId,
      text: fillTemplate(rule.opening_text, { name: event.fromUsername ?? "there" }),
    },
  }, now);
}

async function handleMessage(env: AppEnv, event: MessageEvent, options: HandleOptions): Promise<void> {
  // Replying opened the conversation, so buttons are allowed now: send each waiting link.
  const triggers = await claimAwaitingTriggers(env.DB, event.senderId, options.now - LINK_WINDOW_MS);
  for (const trigger of triggers) {
    const rule = await getRule(env.DB, trigger.rule_id);
    const link = rule?.link_id != null ? await getLinkById(env.DB, rule.link_id) : null;
    if (!rule || !link) continue;
    const actionId = await enqueueAction(env.DB, {
      triggerId: trigger.id, contactIgsid: event.senderId, sendAt: options.now,
      payload: {
        kind: "dm",
        conversationId: event.conversationId,
        message: {
          text: rule.link_text || DEFAULT_LINK_TEXT,
          buttons: [{ type: "web_url", title: rule.button_label, url: trackedUrl(env.PUBLIC_URL, link.code, event.senderId) }],
        },
      },
    }, options.now);
    // Queued first, then sent at once; if the immediate send fails or never runs,
    // the minute scheduler picks the queued action up.
    options.defer(sendActionNow(env, actionId, options.now));
  }
}
