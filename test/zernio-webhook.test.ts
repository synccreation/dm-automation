import { describe, expect, it } from "vitest";
import { hmacSha256Hex, verifyZernioSignature } from "../src/webhook/verify";
import { parseZernioEvent } from "../src/webhook/zernio-parse";
import { commentEvent, messageEvent, sentEvent } from "./zernio-fixtures";

describe("verifyZernioSignature", () => {
  it("accepts the hex HMAC of the raw body, in either case", async () => {
    const body = '{"id":"e1"}';
    const signature = await hmacSha256Hex("s3cret", body);
    expect(await verifyZernioSignature(body, signature, "s3cret")).toBe(true);
    expect(await verifyZernioSignature(body, signature.toUpperCase(), "s3cret")).toBe(true);
  });

  it("rejects tampered bodies, missing headers and an unset secret", async () => {
    const signature = await hmacSha256Hex("s3cret", "a");
    expect(await verifyZernioSignature("b", signature, "s3cret")).toBe(false);
    expect(await verifyZernioSignature("a", null, "s3cret")).toBe(false);
    expect(await verifyZernioSignature("a", signature, "")).toBe(false);
  });
});

describe("parseZernioEvent", () => {
  it("parses a comment", () => {
    expect(parseZernioEvent(commentEvent({ eventId: "e1" }))).toEqual({
      kind: "comment", eventId: "e1", commentId: "c-1", mediaId: "media-1", text: "GUIDE please",
      fromId: "user-1", fromUsername: "anna", isOwn: false,
    });
  });

  it("flags the account's own comments and strips @ from usernames", () => {
    const event = commentEvent({ isOwn: true, username: "@creator" });
    expect(parseZernioEvent(event)).toMatchObject({ isOwn: true, fromUsername: "creator" });
  });

  it("falls back to the post's media id", () => {
    const event = commentEvent();
    (event.comment as { platformPostId: string | null }).platformPostId = null;
    expect(parseZernioEvent(event)).toMatchObject({ mediaId: "media-1" });
  });

  it("parses an incoming DM with story-reply and postback metadata", () => {
    expect(parseZernioEvent(messageEvent({ eventId: "e2", storyId: "story-9", postbackPayload: "GET:1" }))).toEqual({
      kind: "message", eventId: "e2", messageId: "mid-1", conversationId: "conv-1", senderId: "user-1",
      senderUsername: "anna", text: "send it", storyId: "story-9", postbackPayload: "GET:1", quickReplyPayload: null,
    });
  });

  it("reads metadata nested inside the message too", () => {
    const event = messageEvent();
    Object.assign(event.message, { metadata: { postbackPayload: "GET:2" } });
    expect(parseZernioEvent(event)).toMatchObject({ postbackPayload: "GET:2" });
  });

  it("parses outgoing messages as echoes", () => {
    expect(parseZernioEvent(sentEvent({ eventId: "e3", sentVia: null }))).toEqual({
      kind: "echo", eventId: "e3", messageId: "mid-out", conversationId: "conv-1", recipientId: "user-1", text: "thanks!", sentVia: null,
    });
    const outgoingReceived = messageEvent();
    outgoingReceived.message.direction = "outgoing";
    expect(parseZernioEvent(outgoingReceived)?.kind).toBe("echo");
  });

  it("marks other or incomplete events as ignored, and rejects bodies with no id", () => {
    expect(parseZernioEvent({ id: "e4", event: "message.read" })).toEqual({ kind: "ignored", eventId: "e4", event: "message.read" });
    expect(parseZernioEvent({ id: "e5", event: "comment.received", comment: {} })).toEqual({ kind: "ignored", eventId: "e5", event: "comment.received" });
    expect(parseZernioEvent({ event: "comment.received" })).toBeNull();
    expect(parseZernioEvent("nope")).toBeNull();
  });
});
