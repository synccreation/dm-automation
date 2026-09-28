export type SettingKey =
  | "ig_access_token"
  | "ig_token_refreshed_at"
  | "ig_token_error"
  | "ig_user_id"
  | "ig_username"
  | "oauth_state"
  | "last_webhook_at"
  | "last_sweep_at";

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: SettingKey, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: D1Database, key: SettingKey): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}
