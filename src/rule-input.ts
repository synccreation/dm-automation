import type { NewRule } from "./db/rules";
import { isHttpUrl } from "./links";
import { normalizeText } from "./rules";

export type RuleInput = Omit<NewRule, "link_id"> & { link_url?: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Check = (value: unknown) => string | null;

const text = (max: number, allowEmpty = false): Check => (value) => {
  if (typeof value !== "string") return "must be a string";
  if (!allowEmpty && value.trim() === "") return "must not be empty";
  return value.length > max ? `must be at most ${max} characters` : null;
};
const bool: Check = (value) => (typeof value === "boolean" ? null : "must be true or false");

const CHECKS: Record<keyof RuleInput, Check> = {
  name: text(100),
  keywords: (value) => {
    if (!Array.isArray(value) || value.length === 0) return "must be a non-empty list";
    return value.some((k) => typeof k !== "string" || normalizeText(k) === "")
      ? "each need a letter or number (emoji-only keywords are not supported)"
      : null;
  },
  scope: (value) =>
    value === "all" ||
    (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.trim() !== ""))
      ? null
      : 'must be "all" or a non-empty list of media IDs',
  on_comment: bool,
  on_story_reply: bool,
  follow_gate: bool,
  active: bool,
  public_replies: (value) => {
    if (!Array.isArray(value) || value.length > 10) return "must be a list of at most 10 replies";
    return value.some((r) => typeof r !== "string" || r.trim() === "" || r.length > 300)
      ? "must each be 1–300 characters"
      : null;
  },
  opening_text: text(640),
  button_label: text(20),
  not_following_text: text(640, true),
  link_text: text(640, true),
  link_button_label: text(20),
  link_url: (value) => (typeof value === "string" && isHttpUrl(value) ? null : "must be an http(s) URL"),
};

const DEFAULTS = {
  scope: "all",
  on_comment: true,
  on_story_reply: false,
  public_replies: [],
  follow_gate: false,
  not_following_text: "",
  link_text: "",
  link_button_label: "Open",
  active: true,
} satisfies Partial<RuleInput>;

const REQUIRED = ["name", "keywords", "opening_text", "button_label"] as const;

function validate(body: unknown): ParseResult<Record<string, unknown>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const input = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(CHECKS, key)) return { ok: false, error: `unknown field "${key}"` };
    const error = CHECKS[key as keyof RuleInput](value);
    if (error) return { ok: false, error: `${key} ${error}` };
  }
  return { ok: true, value: input };
}

export function parseNewRule(body: unknown): ParseResult<RuleInput> {
  const result = validate(body);
  if (!result.ok) return result;
  for (const key of REQUIRED) {
    if (result.value[key] === undefined) return { ok: false, error: `${key} is required` };
  }
  // Every field was validated above and the required ones are present.
  return { ok: true, value: { ...DEFAULTS, ...result.value } as unknown as RuleInput };
}

export function parseRulePatch(body: unknown): ParseResult<Partial<RuleInput>> {
  const result = validate(body);
  return result.ok ? { ok: true, value: result.value as Partial<RuleInput> } : result;
}
