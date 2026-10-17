import { zernioFromSettings } from "./account";
import { executeAction } from "./actions";
import {
  claimActionById, claimDueActions, failStuckActions, markDropped, markFailed, markRetry, markSent, type ActionRow,
} from "./db/actions";
import { claimTriggerLink, getTrigger, releaseTriggerLink } from "./db/events";
import type { AppEnv } from "./env";
import { linkFollowUpOf, queueLinkFollowUp } from "./link-delivery";
import { MINUTE, isPrivateReplyExpired, linkFollowUpDelayMs, retryDelayMs } from "./time";
import { ZernioError, type ZernioClient } from "./zernio";

/** Comment replies per run (the cron runs every minute): 720/hour, under Meta's 750/hour cap. */
export const COMMENT_REPLY_BUDGET = 12;
/** Keeps a run well under Zernio's free-plan limit of 60 API calls a minute. */
const DM_BATCH = 20;
const STUCK_AFTER_MS = 10 * MINUTE;

export interface SchedulerReport {
  sent: number;
  retried: number;
  failed: number;
  dropped: number;
  skippedNoToken: boolean;
}

const emptyReport = (): SchedulerReport => ({ sent: 0, retried: 0, failed: 0, dropped: 0, skippedNoToken: false });

export async function runScheduler(
  env: AppEnv, now: number, deps: { zernio?: ZernioClient } = {},
): Promise<SchedulerReport> {
  const report = emptyReport();
  await failStuckActions(env.DB, now - STUCK_AFTER_MS);

  const zernio = deps.zernio ?? (await zernioFromSettings(env));
  if (!zernio) {
    report.skippedNoToken = true;
    return report;
  }

  const due = [
    ...(await claimDueActions(env.DB, now, ["private_reply", "public_reply"], COMMENT_REPLY_BUDGET)),
    ...(await claimDueActions(env.DB, now, ["dm"], DM_BATCH)),
  ];
  for (const action of due) await processSafely(env, zernio, action, now, report);
  return report;
}

/** Sends one queued action right away (e.g. the link after someone replies). */
export async function sendActionNow(
  env: AppEnv, actionId: number, now: number, deps: { zernio?: ZernioClient } = {},
): Promise<boolean> {
  const zernio = deps.zernio ?? (await zernioFromSettings(env));
  if (!zernio) return false;
  const action = await claimActionById(env.DB, actionId, now);
  if (!action) return false; // the scheduler already has it
  const report = emptyReport();
  await processSafely(env, zernio, action, now, report);
  return report.sent === 1;
}

async function processSafely(
  env: AppEnv, zernio: ZernioClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  try {
    await processAction(env, zernio, action, now, report);
  } catch (err) {
    // A failed bookkeeping write on one row must not strand the rest of the batch.
    // The row stays 'sending' and is failed by failStuckActions, never resent.
    console.error(JSON.stringify({ scheduler: "action error", actionId: action.id, error: String(err) }));
  }
}

async function processAction(
  env: AppEnv, zernio: ZernioClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  if (action.type === "private_reply" && action.trigger_id !== null) {
    const trigger = await getTrigger(env.DB, action.trigger_id);
    if (trigger?.comment_at != null && isPrivateReplyExpired(trigger.comment_at, now)) {
      await markDropped(env.DB, action.id, "comment is older than 7 days");
      report.dropped++;
      return;
    }
  }

  // Claimed before sending so the reply webhook can't send the same link meanwhile.
  const followUp = linkFollowUpOf(action);
  if (followUp && !(await claimTriggerLink(env.DB, followUp.triggerId))) {
    await markDropped(env.DB, action.id, "link already sent after their reply");
    report.dropped++;
    return;
  }

  let mid: string | null;
  try {
    mid = await executeAction(zernio, action);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (followUp) {
      // Instagram may refuse until the commenter replies, so any error just means "not yet".
      await releaseTriggerLink(env.DB, followUp.triggerId);
      const nextTry = now + linkFollowUpDelayMs(action.attempts);
      if (nextTry <= followUp.retryUntil) {
        await markRetry(env.DB, action.id, nextTry, message);
        report.retried++;
      } else {
        await markDropped(env.DB, action.id, `no reply within 7 days (last error: ${message})`);
        report.dropped++;
      }
      return;
    }
    const transient = err instanceof ZernioError ? err.transient : true;
    const delay = transient ? retryDelayMs(action.attempts) : null;
    if (delay !== null) {
      await markRetry(env.DB, action.id, now + delay, message);
      report.retried++;
    } else {
      await markFailed(env.DB, action.id, message);
      report.failed++;
    }
    return;
  }
  // Outside the send's try: the message is already delivered, so a failed write
  // here must never be treated as a send failure and retried.
  await markSent(env.DB, action.id, mid, now);
  report.sent++;
  if (action.type === "private_reply" && action.trigger_id !== null) {
    await queueLinkFollowUp(env, action.trigger_id, now);
  }
}
