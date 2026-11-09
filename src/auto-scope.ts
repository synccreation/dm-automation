import { zernioFromSettings } from "./account";
import { addToScope, type RuleRow } from "./db/rules";
import type { AppEnv } from "./env";
import { captionAsksFor, matchesKeyword } from "./rules";

const FOUND_TTL = 60 * 60_000;
// A post missing from the live list is re-checked sooner, in case it was just published.
const MISSING_TTL = 5 * 60_000;

interface CommentOnPost {
  mediaId: string;
  text: string;
  caption: string | null;
}

/**
 * For a comment no rule's scope covers: when the comment has a rule's keyword and the post's
 * caption asks for it, adds the post to that rule's scope and returns the rule. The newest
 * such rule wins, since it was made for the newest reel. Zernio errors propagate so the
 * webhook is redelivered.
 */
export async function attachByCaption(env: AppEnv, rules: RuleRow[], comment: CommentOnPost, now: number): Promise<RuleRow | null> {
  const candidates = rules
    .filter((rule) =>
      rule.active && rule.auto_scope && rule.on_comment && rule.scope !== "all" &&
      !rule.scope.includes(comment.mediaId) &&
      rule.keywords.some((keyword) => matchesKeyword(comment.text, keyword)))
    .sort((a, b) => b.id - a.id);
  if (candidates.length === 0) return null;

  const caption = comment.caption ?? (await postCaption(env, comment.mediaId, now));
  if (!caption) return null;
  const rule = candidates.find((r) => r.keywords.some((keyword) => captionAsksFor(caption, keyword)));
  if (!rule) return null;
  const updated = await addToScope(env.DB, rule.id, comment.mediaId);
  console.log(JSON.stringify({ autoScope: { rule: rule.id, mediaId: comment.mediaId } }));
  return updated ?? rule;
}

async function postCaption(env: AppEnv, mediaId: string, now: number): Promise<string | null> {
  const cached = await env.DB
    .prepare("SELECT caption, fetched_at FROM post_captions WHERE media_id = ?")
    .bind(mediaId)
    .first<{ caption: string | null; fetched_at: number }>();
  if (cached && now - cached.fetched_at < (cached.caption === null ? MISSING_TTL : FOUND_TTL)) return cached.caption;

  const zernio = await zernioFromSettings(env);
  if (!zernio) return cached?.caption ?? null;
  const posts = await zernio.listPosts();
  const upsert = env.DB.prepare(
    `INSERT INTO post_captions (media_id, caption, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (media_id) DO UPDATE SET caption = excluded.caption, fetched_at = excluded.fetched_at`,
  );
  const found = posts.find((post) => post.id === mediaId);
  const rows = posts.map((post) => upsert.bind(post.id, post.caption, now));
  if (!found) rows.push(upsert.bind(mediaId, null, now));
  if (rows.length > 0) await env.DB.batch(rows);
  return found?.caption ?? null;
}
