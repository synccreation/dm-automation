import { zernioFromSettings } from "./account";
import { countTriggersForMedia } from "./db/events";
import type { AppEnv } from "./env";
import { DAY } from "./time";
import { handleEvent } from "./webhook/handle";

export interface BackfillResult {
  scanned: number;
  triggered: number;
}

/**
 * Runs a post's existing comments through the rules, as if each had just arrived. Safe to
 * repeat: triggers are unique per person and post, so nobody is messaged twice. Comments
 * older than 7 days are skipped because Instagram no longer accepts a private reply to them.
 */
export async function runBackfill(env: AppEnv, mediaId: string, now: number): Promise<BackfillResult> {
  const zernio = await zernioFromSettings(env);
  if (!zernio) throw new Error("Not set up yet. Run: npm run cli -- setup");
  const comments = await zernio.listComments(mediaId);
  const countTriggers = () => countTriggersForMedia(env.DB, mediaId);
  const before = await countTriggers();
  for (const comment of comments) {
    const createdAt = comment.createdTime ? Date.parse(comment.createdTime) : now;
    if (now - createdAt > 7 * DAY) continue;
    await handleEvent(env, {
      kind: "comment", eventId: `backfill:${comment.id}`, commentId: comment.id, mediaId, text: comment.text,
      fromId: comment.fromId, fromUsername: comment.fromUsername, isOwn: comment.isOwner,
    }, { now, defer: () => {} });
  }
  return { scanned: comments.length, triggered: (await countTriggers()) - before };
}
