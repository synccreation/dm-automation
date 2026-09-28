import { describe, expect, it } from "vitest";
import { parseNewRule, parseRulePatch } from "../src/rule-input";

const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Hey {name}!", button_label: "Get it" };

describe("parseNewRule", () => {
  it("applies defaults to a minimal rule", () => {
    expect(parseNewRule(minimal)).toEqual({
      ok: true,
      value: {
        ...minimal, scope: "all", on_comment: true, on_story_reply: false, public_replies: [],
        follow_gate: false, not_following_text: "", link_text: "", link_button_label: "Open", active: true,
      },
    });
  });

  it.each([
    [{ ...minimal, name: undefined }, "name is required"],
    [{ ...minimal, surprise: 1 }, 'unknown field "surprise"'],
    [{ ...minimal, keywords: ["🔥"] }, "emoji-only"],
    [{ ...minimal, keywords: [] }, "keywords must be a non-empty list"],
    [{ ...minimal, link_url: "ftp://x" }, "link_url must be an http(s) URL"],
    [{ ...minimal, button_label: "x".repeat(21) }, "button_label must be at most 20 characters"],
    [{ ...minimal, scope: [] }, "scope must be"],
    [{ ...minimal, public_replies: [""] }, "public_replies"],
    ["nope", "body must be a JSON object"],
  ])("rejects %j", (body, message) => {
    const result = parseNewRule(body);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(message);
  });
});

describe("parseRulePatch", () => {
  it("accepts a partial update without applying defaults", () => {
    expect(parseRulePatch({ active: false })).toEqual({ ok: true, value: { active: false } });
  });
  it("still validates the fields it gets", () => {
    expect(parseRulePatch({ active: "no" })).toEqual({ ok: false, error: "active must be true or false" });
  });
});
