import { describe, expect, it } from "vitest";
import { parseWebhook } from "../src/webhook/parse";
import {
  commentPayload, echoMessage, messagingPayload, postbackEvent, storyReply, textMessage,
} from "./fixtures";
import { IG_USER_ID } from "./helpers";

describe("parseWebhook", () => {
  it("parses a comment from entry.changes", () => {
    expect(parseWebhook(commentPayload())).toEqual([{
      kind: "comment", accountId: IG_USER_ID, commentId: "c-1", text: "GUIDE please",
      fromId: "user-1", fromUsername: "anna", mediaId: "media-1",
    }]);
  });

  it("parses a comment sent in the flat entry.field/value form with numeric ids", () => {
    const payload = {
      object: "instagram",
      entry: [{
        id: IG_USER_ID, time: 1, field: "comments",
        value: { id: 111, from: { id: 222 }, text: "guide", media: { id: 333 } },
      }],
    };
    expect(parseWebhook(payload)).toEqual([{
      kind: "comment", accountId: IG_USER_ID, commentId: "111", text: "guide",
      fromId: "222", fromUsername: null, mediaId: "333",
    }]);
  });

  it("parses text messages, story replies, echoes and postbacks", () => {
    const events = parseWebhook(messagingPayload([textMessage(), storyReply(), echoMessage(), postbackEvent()]));
    expect(events).toEqual([
      { kind: "message", accountId: IG_USER_ID, mid: "m-1", senderId: "user-1", text: "hello", attachmentTypes: [], storyId: null },
      { kind: "message", accountId: IG_USER_ID, mid: "m-story", senderId: "user-1", text: "GUIDE", attachmentTypes: [], storyId: "story-1" },
      { kind: "echo", accountId: IG_USER_ID, mid: "m-echo", recipientId: "user-1", text: "thanks!" },
      { kind: "postback", accountId: IG_USER_ID, mid: "m-pb", senderId: "user-1", payload: "GET:1" },
    ]);
  });

  it("skips reactions, read receipts, deleted messages and malformed items", () => {
    const events = parseWebhook(messagingPayload([
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, reaction: { mid: "m", action: "react", emoji: "❤️" } },
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, read: { mid: "m" } },
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, message: { mid: "m-del", is_deleted: true } },
      { sender: { id: "user-1" }, message: {} },
      "not an object" as unknown as Record<string, unknown>,
    ]));
    expect(events).toEqual([]);
  });

  it("ignores payloads that are not for Instagram", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: "instagram", entry: "nope" })).toEqual([]);
  });
});
