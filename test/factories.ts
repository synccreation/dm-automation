import type { NewRule } from "../src/db/rules";

export function newRule(overrides: Partial<NewRule> = {}): NewRule {
  return {
    name: "Guide",
    keywords: ["guide"],
    scope: "all",
    on_comment: true,
    on_story_reply: false,
    public_replies: [],
    opening_text: "Hey {name}! Reply to this message and I'll send you the guide 👇",
    button_label: "Get the guide",
    follow_gate: false,
    not_following_text: "",
    link_text: "",
    link_button_label: "Open",
    link_id: null,
    active: true,
    ...overrides,
  };
}
