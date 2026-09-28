import type { TriggerSource } from "../rules";

export async function isProcessed(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS hit FROM processed_events WHERE event_key = ?").bind(key).first();
  return row !== null;
}

export async function markProcessed(db: D1Database, key: string, now: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO processed_events (event_key, received_at) VALUES (?, ?)").bind(key, now).run();
}

export interface TriggerRow {
  id: number;
  rule_id: number;
  contact_igsid: string;
  media_id: string;
  source: TriggerSource;
  comment_id: string | null;
  comment_at: number | null;
  created_at: number;
}

/** Returns the new trigger id, or null if this person already triggered this rule on this media. */
export async function insertTrigger(db: D1Database, trigger: Omit<TriggerRow, "id">): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO triggers (rule_id, contact_igsid, media_id, source, comment_id, comment_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (rule_id, contact_igsid, media_id) DO NOTHING
       RETURNING id`,
    )
    .bind(
      trigger.rule_id, trigger.contact_igsid, trigger.media_id, trigger.source,
      trigger.comment_id, trigger.comment_at, trigger.created_at,
    )
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function findTriggerId(
  db: D1Database, ruleId: number, contactIgsid: string, mediaId: string,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM triggers WHERE rule_id = ? AND contact_igsid = ? AND media_id = ?")
    .bind(ruleId, contactIgsid, mediaId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function getTrigger(db: D1Database, id: number): Promise<TriggerRow | null> {
  return db.prepare("SELECT * FROM triggers WHERE id = ?").bind(id).first<TriggerRow>();
}
