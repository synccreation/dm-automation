export interface LinkRow {
  id: number;
  code: string;
  target_url: string;
  label: string | null;
  created_at: number;
}

export async function insertLink(
  db: D1Database, code: string, targetUrl: string, label: string | null, now: number,
): Promise<LinkRow> {
  const row = await db
    .prepare("INSERT INTO links (code, target_url, label, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(code, targetUrl, label, now)
    .first<LinkRow>();
  if (!row) throw new Error("insertLink returned no row");
  return row;
}

export async function getLinkByCode(db: D1Database, code: string): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE code = ?").bind(code).first<LinkRow>();
}

export async function getLinkById(db: D1Database, id: number): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
}

export async function insertClick(
  db: D1Database, linkId: number, contactIgsid: string | null, now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO clicks (link_id, contact_igsid, clicked_at) VALUES (?, ?, ?)")
    .bind(linkId, contactIgsid, now)
    .run();
}

export async function countClicks(db: D1Database, linkId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?").bind(linkId).first<{ n: number }>();
  return row?.n ?? 0;
}
