import { IG_USER_ID } from "./helpers";

export function commentPayload(o: {
  commentId?: string; text?: string; fromId?: string; username?: string; mediaId?: string;
} = {}) {
  return {
    object: "instagram",
    entry: [{
      id: IG_USER_ID,
      time: 1_727_500_000,
      changes: [{
        field: "comments",
        value: {
          id: o.commentId ?? "c-1",
          from: { id: o.fromId ?? "user-1", username: o.username ?? "anna" },
          text: o.text ?? "GUIDE please",
          media: { id: o.mediaId ?? "media-1", media_product_type: "REELS" },
        },
      }],
    }],
  };
}

export function messagingPayload(messaging: Record<string, unknown>[]) {
  return { object: "instagram", entry: [{ id: IG_USER_ID, time: 1_727_500_000_000, messaging }] };
}

export function textMessage(o: { mid?: string; senderId?: string; text?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    message: { mid: o.mid ?? "m-1", text: o.text ?? "hello" },
  };
}

export function storyReply(o: { mid?: string; senderId?: string; text?: string; storyId?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    message: {
      mid: o.mid ?? "m-story",
      text: o.text ?? "GUIDE",
      reply_to: { story: { url: "https://cdn.example/story.jpg", id: o.storyId ?? "story-1" } },
    },
  };
}

export function echoMessage(o: { mid?: string; recipientId?: string; text?: string } = {}) {
  return {
    sender: { id: IG_USER_ID },
    recipient: { id: o.recipientId ?? "user-1" },
    timestamp: 1_727_500_000_000,
    message: { mid: o.mid ?? "m-echo", text: o.text ?? "thanks!", is_echo: true },
  };
}

export function postbackEvent(o: { mid?: string; senderId?: string; payload?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    postback: { mid: o.mid ?? "m-pb", title: "Get the guide", payload: o.payload ?? "GET:1" },
  };
}
