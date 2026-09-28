export type Scope = "all" | string[];
export type TriggerSource = "comment" | "story_reply";

export interface MatchableRule {
  id: number;
  keywords: string[];
  scope: Scope;
  on_comment: boolean;
  on_story_reply: boolean;
  active: boolean;
}

/** Lower-case, and turn everything that isn't a letter or digit (punctuation, emoji) into spaces. */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Whole-word (or whole-phrase) match; "guide" matches "Guide!" but not "guidebook". */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = normalizeText(keyword);
  if (needle === "") return false;
  return ` ${normalizeText(text)} `.includes(` ${needle} `);
}

function inScope(scope: Scope, mediaId: string): boolean {
  return scope === "all" || scope.includes(mediaId);
}

export function findMatchingRule<R extends MatchableRule>(
  rules: R[],
  text: string,
  mediaId: string,
  source: TriggerSource,
): R | null {
  const ordered = [...rules].sort((a, b) => a.id - b.id);
  for (const rule of ordered) {
    if (!rule.active) continue;
    if (source === "comment" ? !rule.on_comment : !rule.on_story_reply) continue;
    if (!inScope(rule.scope, mediaId)) continue;
    if (rule.keywords.some((keyword) => matchesKeyword(text, keyword))) return rule;
  }
  return null;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
