import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { handshakeChallenge, hmacSha256Hex, verifySignature } from "../src/webhook/verify";
import { testEnv } from "./helpers";

describe("handshakeChallenge", () => {
  const params = (mode: string, token: string) =>
    new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "12345" });

  it("returns the challenge for a valid subscribe request", () => {
    expect(handshakeChallenge(params("subscribe", "tok"), "tok")).toBe("12345");
  });
  it("rejects a wrong token or mode", () => {
    expect(handshakeChallenge(params("subscribe", "nope"), "tok")).toBeNull();
    expect(handshakeChallenge(params("unsubscribe", "tok"), "tok")).toBeNull();
  });
});

describe("signatures", () => {
  it("computes a standard HMAC-SHA256", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"))
      .toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("accepts a correct signature from any configured secret", async () => {
    const body = '{"object":"instagram"}';
    const header = `sha256=${await hmacSha256Hex("second", body)}`;
    expect(await verifySignature(body, header, ["first", "second"])).toBe(true);
  });

  it("rejects tampered bodies, missing headers and wrong prefixes", async () => {
    const header = `sha256=${await hmacSha256Hex("s", "a")}`;
    expect(await verifySignature("b", header, ["s"])).toBe(false);
    expect(await verifySignature("a", null, ["s"])).toBe(false);
    expect(await verifySignature("a", header.replace("sha256=", "sha1="), ["s"])).toBe(false);
  });
});

describe("GET /webhook", () => {
  it("echoes the challenge for Meta's verification request", async () => {
    const qs = "hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=987";
    const res = await app.request(`/webhook?${qs}`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("987");
  });

  it("returns 403 for a wrong verify token", async () => {
    const res = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1", {}, testEnv);
    expect(res.status).toBe(403);
  });
});
