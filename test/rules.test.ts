import { describe, expect, it } from "vitest";
import { fillTemplate, findMatchingRule, matchesKeyword, type MatchableRule } from "../src/rules";

describe("matchesKeyword", () => {
  it.each([
    ["guide", "guide"],
    ["Guide!", "guide"],
    ["GUIDE 🙏", "guide"],
    ["send me the guide please", "guide"],
    ["Free-guide pls", "free guide"],
    ["GUÍA", "guía"],
  ])("matches %j for keyword %j", (text, keyword) => {
    expect(matchesKeyword(text, keyword)).toBe(true);
  });

  it.each([
    ["guidebook", "guide"],
    ["gui de", "guide"],
    ["", "guide"],
    ["🔥🔥", "🔥"],
  ])("does not match %j for keyword %j", (text, keyword) => {
    expect(matchesKeyword(text, keyword)).toBe(false);
  });
});

describe("findMatchingRule", () => {
  const rule = (overrides: Partial<MatchableRule>): MatchableRule => ({
    id: 1, keywords: ["guide"], scope: "all", on_comment: true, on_story_reply: false, active: true,
    ...overrides,
  });

  it("returns the lowest-id matching rule", () => {
    const rules = [rule({ id: 7 }), rule({ id: 3 })];
    expect(findMatchingRule(rules, "guide", "m1", "comment")?.id).toBe(3);
  });

  it("skips inactive rules", () => {
    expect(findMatchingRule([rule({ active: false })], "guide", "m1", "comment")).toBeNull();
  });

  it("respects the media scope", () => {
    const scoped = rule({ scope: ["m2"] });
    expect(findMatchingRule([scoped], "guide", "m1", "comment")).toBeNull();
    expect(findMatchingRule([scoped], "guide", "m2", "comment")?.id).toBe(1);
  });

  it("respects the trigger source", () => {
    expect(findMatchingRule([rule({})], "guide", "s1", "story_reply")).toBeNull();
    expect(findMatchingRule([rule({ on_story_reply: true })], "guide", "s1", "story_reply")?.id).toBe(1);
  });
});

describe("fillTemplate", () => {
  it("replaces known variables and leaves unknown ones", () => {
    expect(fillTemplate("Hi {name}, {x}", { name: "anna" })).toBe("Hi anna, {x}");
  });
});
