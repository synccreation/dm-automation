import { instagramFromSettings } from "./account";
import { executeAction } from "./actions";
import {
  claimDueActions, failStuckActions, markDropped, markFailed, markRetry, markSent, type ActionRow,
} from "./db/actions";
import { getTrigger } from "./db/events";
import type { AppEnv } from "./env";
import { InstagramError, type InstagramClient } from "./instagram";
import { MINUTE, isPrivateReplyExpired, retryDelayMs } from "./time";

/** Comment replies per run (the cron runs every minute): 720/hour, under Meta's 750/hour cap. */
export const COMMENT_REPLY_BUDGET = 12;
const DM_BATCH = 50;
const STUCK_AFTER_MS = 10 * MINUTE;

export interface SchedulerReport {
  sent: number;
  retried: number;
  failed: number;
  dropped: number;
  skippedNoToken: boolean;
}

export async function runScheduler(
  env: AppEnv, now: number, deps: { ig?: InstagramClient } = {},
): Promise<SchedulerReport> {
  const report: SchedulerReport = { sent: 0, retried: 0, failed: 0, dropped: 0, skippedNoToken: false };
  await failStuckActions(env.DB, now - STUCK_AFTER_MS);

  const ig = deps.ig ?? (await instagramFromSettings(env));
  if (!ig) {
    report.skippedNoToken = true;
    return report;
  }

  const due = [
    ...(await claimDueActions(env.DB, now, ["private_reply", "public_reply"], COMMENT_REPLY_BUDGET)),
    ...(await claimDueActions(env.DB, now, ["dm"], DM_BATCH)),
  ];
  for (const action of due) await processAction(env, ig, action, now, report);
  return report;
}

async function processAction(
  env: AppEnv, ig: InstagramClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  if (action.type === "private_reply" && action.trigger_id !== null) {
    const trigger = await getTrigger(env.DB, action.trigger_id);
    if (trigger?.comment_at != null && isPrivateReplyExpired(trigger.comment_at, now)) {
      await markDropped(env.DB, action.id, "comment is older than 7 days");
      report.dropped++;
      return;
    }
  }

  try {
    const mid = await executeAction(ig, action.payload);
    await markSent(env.DB, action.id, mid, now);
    report.sent++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = err instanceof InstagramError ? err.transient : true;
    const delay = transient ? retryDelayMs(action.attempts) : null;
    if (delay !== null) {
      await markRetry(env.DB, action.id, now + delay, message);
      report.retried++;
    } else {
      await markFailed(env.DB, action.id, message);
      report.failed++;
    }
  }
}
