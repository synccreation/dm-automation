export interface ContactRow {
  igsid: string;
  username: string | null;
  name: string | null;
  follows_me: boolean | null;
  follows_checked_at: number | null;
  first_seen_at: number;
  last_inbound_at: number | null;
}

type RawContact = Omit<ContactRow, "follows_me"> & { follows_me: number | null };

export async function upsertContact(
  db: D1Database, contact: { igsid: string; username: string | null }, now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contacts (igsid, username, first_seen_at) VALUES (?, ?, ?)
       ON CONFLICT (igsid) DO UPDATE SET username = COALESCE(excluded.username, contacts.username)`,
    )
    .bind(contact.igsid, contact.username, now)
    .run();
}

export async function getContact(db: D1Database, igsid: string): Promise<ContactRow | null> {
  const raw = await db.prepare("SELECT * FROM contacts WHERE igsid = ?").bind(igsid).first<RawContact>();
  if (!raw) return null;
  return { ...raw, follows_me: raw.follows_me === null ? null : raw.follows_me === 1 };
}
