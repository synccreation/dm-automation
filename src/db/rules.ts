import type { Scope } from "../rules";

export interface RuleRow {
  id: number;
  name: string;
  keywords: string[];
  scope: Scope;
  on_comment: boolean;
  on_story_reply: boolean;
  public_replies: string[];
  opening_text: string;
  button_label: string;
  follow_gate: boolean;
  not_following_text: string;
  link_text: string;
  link_button_label: string;
  link_id: number | null;
  active: boolean;
  created_at: number;
}

export type NewRule = Omit<RuleRow, "id" | "created_at">;

interface RawRule {
  id: number;
  name: string;
  keywords: string;
  scope: string;
  on_comment: number;
  on_story_reply: number;
  public_replies: string;
  opening_text: string;
  button_label: string;
  follow_gate: number;
  not_following_text: string;
  link_text: string;
  link_button_label: string;
  link_id: number | null;
  active: number;
  created_at: number;
}

const COLUMNS = [
  "name", "keywords", "scope", "on_comment", "on_story_reply", "public_replies",
  "opening_text", "button_label", "follow_gate", "not_following_text", "link_text",
  "link_button_label", "link_id", "active",
] as const satisfies readonly (keyof NewRule)[];

function toRule(raw: RawRule): RuleRow {
  return {
    ...raw,
    keywords: JSON.parse(raw.keywords) as string[],
    scope: raw.scope === "all" ? "all" : (JSON.parse(raw.scope) as string[]),
    on_comment: raw.on_comment === 1,
    on_story_reply: raw.on_story_reply === 1,
    public_replies: JSON.parse(raw.public_replies) as string[],
    follow_gate: raw.follow_gate === 1,
    active: raw.active === 1,
  };
}

function toColumnValue(key: keyof NewRule, value: unknown): string | number | null {
  if (key === "scope") return value === "all" ? "all" : JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as string | number | null;
}

export async function insertRule(db: D1Database, rule: NewRule, now: number): Promise<RuleRow> {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const raw = await db
    .prepare(`INSERT INTO rules (${COLUMNS.join(", ")}, created_at) VALUES (${placeholders}, ?) RETURNING *`)
    .bind(...COLUMNS.map((key) => toColumnValue(key, rule[key])), now)
    .first<RawRule>();
  if (!raw) throw new Error("insertRule returned no row");
  return toRule(raw);
}

export async function updateRule(db: D1Database, id: number, patch: Partial<NewRule>): Promise<RuleRow | null> {
  const keys = COLUMNS.filter((key) => patch[key] !== undefined);
  if (keys.length === 0) return getRule(db, id);
  const raw = await db
    .prepare(`UPDATE rules SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ? RETURNING *`)
    .bind(...keys.map((key) => toColumnValue(key, patch[key])), id)
    .first<RawRule>();
  return raw ? toRule(raw) : null;
}

export async function getRule(db: D1Database, id: number): Promise<RuleRow | null> {
  const raw = await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RawRule>();
  return raw ? toRule(raw) : null;
}

export async function listRules(db: D1Database): Promise<RuleRow[]> {
  const { results } = await db.prepare("SELECT * FROM rules ORDER BY id").all<RawRule>();
  return results.map(toRule);
}

export async function listActiveRules(db: D1Database): Promise<RuleRow[]> {
  const { results } = await db.prepare("SELECT * FROM rules WHERE active = 1 ORDER BY id").all<RawRule>();
  return results.map(toRule);
}
