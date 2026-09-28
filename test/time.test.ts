import { describe, expect, it } from "vitest";
import { DAY, MINUTE, isPrivateReplyExpired, openingSendAt, retryDelayMs } from "../src/time";

describe("openingSendAt", () => {
  it("is 60 seconds after now with zero jitter", () => {
    expect(openingSendAt(1_000, () => 0)).toBe(61_000);
  });
  it("adds less than 10 seconds of jitter", () => {
    expect(openingSendAt(1_000, () => 0.999999)).toBe(1_000 + 60_000 + 9_999);
  });
});

describe("isPrivateReplyExpired", () => {
  it("still allows a reply at exactly 7 days", () => {
    expect(isPrivateReplyExpired(0, 7 * DAY)).toBe(false);
  });
  it("expires after 7 days", () => {
    expect(isPrivateReplyExpired(0, 7 * DAY + 1)).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("backs off 1, 5 and 15 minutes, then gives up", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([MINUTE, 5 * MINUTE, 15 * MINUTE, null]);
  });
});
