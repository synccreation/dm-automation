import type { OutgoingMessage } from "../messages";

export type ActionType = "private_reply" | "public_reply" | "dm";
export type ActionStatus = "pending" | "sending" | "sent" | "failed" | "dropped";

export type ActionPayload =
  | { kind: "private_reply"; commentId: string; message: OutgoingMessage }
  | { kind: "public_reply"; commentId: string; text: string }
  | { kind: "dm"; igsid: string; message: OutgoingMessage };

export interface ActionRow {
  id: number;
  type: ActionType;
  trigger_id: number | null;
  contact_igsid: string;
  payload: ActionPayload;
  send_at: number;
  status: ActionStatus;
  attempts: number;
  last_error: string | null;
  claimed_at: number | null;
  sent_at: number | null;
  sent_mid: string | null;
  created_at: number;
}

type RawAction = Omit<ActionRow, "payload"> & { payload: string };

function toAction(raw: RawAction): ActionRow {
  return { ...raw, payload: JSON.parse(raw.payload) as ActionPayload };
}

export interface NewAction {
  triggerId: number | null;
  contactIgsid: string;
  payload: ActionPayload;
  sendAt: number;
}

export async function enqueueAction(db: D1Database, action: NewAction, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO actions (type, trigger_id, contact_igsid, payload, send_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(action.payload.kind, action.triggerId, action.contactIgsid, JSON.stringify(action.payload), action.sendAt, now)
    .first<{ id: number }>();
  if (!row) throw new Error("enqueueAction returned no row");
  return row.id;
}

/** Atomically moves due actions to 'sending' (one UPDATE…RETURNING), so no action is claimed twice. */
export async function claimDueActions(
  db: D1Database, now: number, types: ActionType[], limit: number,
): Promise<ActionRow[]> {
  if (types.length === 0 || limit <= 0) return [];
  const placeholders = types.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `UPDATE actions SET status = 'sending', attempts = attempts + 1, claimed_at = ?
       WHERE id IN (
         SELECT id FROM actions
         WHERE status = 'pending' AND send_at <= ? AND type IN (${placeholders})
         ORDER BY send_at, id LIMIT ?
       )
       RETURNING *`,
    )
    .bind(now, now, ...types, limit)
    .all<RawAction>();
  return results.map(toAction).sort((a, b) => a.send_at - b.send_at || a.id - b.id);
}

export async function markSent(db: D1Database, id: number, mid: string | null, now: number): Promise<void> {
  await db
    .prepare("UPDATE actions SET status = 'sent', sent_at = ?, sent_mid = ?, last_error = NULL WHERE id = ?")
    .bind(now, mid, id)
    .run();
}

export async function markRetry(db: D1Database, id: number, sendAt: number, error: string): Promise<void> {
  await db
    .prepare("UPDATE actions SET status = 'pending', send_at = ?, last_error = ? WHERE id = ?")
    .bind(sendAt, error, id)
    .run();
}

export async function markFailed(db: D1Database, id: number, error: string): Promise<void> {
  await db.prepare("UPDATE actions SET status = 'failed', last_error = ? WHERE id = ?").bind(error, id).run();
}

export async function markDropped(db: D1Database, id: number, reason: string): Promise<void> {
  await db.prepare("UPDATE actions SET status = 'dropped', last_error = ? WHERE id = ?").bind(reason, id).run();
}

export async function failStuckActions(db: D1Database, claimedBefore: number): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE actions SET status = 'failed', last_error = 'interrupted while sending' WHERE status = 'sending' AND claimed_at < ?",
    )
    .bind(claimedBefore)
    .run();
  return result.meta.changes;
}

export async function countActions(db: D1Database, status: ActionStatus, since?: number): Promise<number> {
  const row =
    since === undefined
      ? await db.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = ?").bind(status).first<{ n: number }>()
      : await db
          .prepare("SELECT COUNT(*) AS n FROM actions WHERE status = ? AND COALESCE(claimed_at, created_at) >= ?")
          .bind(status, since)
          .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAction(db: D1Database, id: number): Promise<ActionRow | null> {
  const raw = await db.prepare("SELECT * FROM actions WHERE id = ?").bind(id).first<RawAction>();
  return raw ? toAction(raw) : null;
}

export async function recentActions(db: D1Database, limit: number): Promise<ActionRow[]> {
  const { results } = await db.prepare("SELECT * FROM actions ORDER BY id DESC LIMIT ?").bind(limit).all<RawAction>();
  return results.map(toAction);
}
