import { enqueueAction, type ActionRow } from "./db/actions";
import { getTrigger } from "./db/events";
import { getLinkById, type LinkRow } from "./db/links";
import { getRule, type RuleRow } from "./db/rules";
import type { AppEnv } from "./env";
import { trackedUrl } from "./links";
import type { OutgoingMessage } from "./messages";
import { LINK_FOLLOW_UP_DELAY_MS, LINK_WINDOW_MS } from "./time";

const DEFAULT_LINK_TEXT = "Here you go 👇";

/** The DM that delivers a rule's link to one commenter. */
export function linkMessage(publicUrl: string, rule: RuleRow, link: LinkRow, contactIgsid: string): OutgoingMessage {
  return {
    text: rule.link_text || DEFAULT_LINK_TEXT,
    buttons: [{ type: "web_url", title: rule.button_label, url: trackedUrl(publicUrl, link.code, contactIgsid) }],
  };
}

/**
 * Queues a direct try at the link once the opening DM is out. Instagram sometimes never
 * tells Zernio about a commenter's thread (no echo, no reply webhook), so waiting for
 * the reply alone leaves those people without their link.
 */
export async function queueLinkFollowUp(env: AppEnv, triggerId: number, now: number): Promise<void> {
  const trigger = await getTrigger(env.DB, triggerId);
  if (trigger?.link_state !== "awaiting_reply") return;
  const rule = await getRule(env.DB, trigger.rule_id);
  const link = rule?.link_id != null ? await getLinkById(env.DB, rule.link_id) : null;
  if (!rule || !link) return;
  await enqueueAction(env.DB, {
    triggerId, contactIgsid: trigger.contact_igsid, sendAt: now + LINK_FOLLOW_UP_DELAY_MS,
    payload: {
      kind: "dm",
      // Zernio accepts the commenter's IGSID as the conversation, even for a thread it never saw.
      conversationId: trigger.contact_igsid,
      message: linkMessage(env.PUBLIC_URL, rule, link, trigger.contact_igsid),
      retryUntil: trigger.created_at + LINK_WINDOW_MS,
    },
  }, now);
}

/** The trigger and deadline of a link follow-up action, or null for any other action. */
export function linkFollowUpOf(action: ActionRow): { triggerId: number; retryUntil: number } | null {
  const { payload } = action;
  if (payload.kind !== "dm" || payload.retryUntil === undefined || action.trigger_id === null) return null;
  return { triggerId: action.trigger_id, retryUntil: payload.retryUntil };
}
