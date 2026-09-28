export const ACCOUNT_ID = "66b2e19d8c3f5a7e9d0b1c2d";
export const PROFILE_ID = "66a1f0c2a4b9d3e8f1a2b3c4";

let counter = 0;
const nextEventId = () => `evt-${++counter}`;
const account = { id: ACCOUNT_ID, accountId: ACCOUNT_ID, profileId: PROFILE_ID, platform: "instagram", username: "creator" };

export function commentEvent(o: {
  eventId?: string; commentId?: string; mediaId?: string; text?: string; fromId?: string; username?: string; isOwn?: boolean;
} = {}) {
  return {
    id: o.eventId ?? nextEventId(),
    event: "comment.received",
    comment: {
      id: o.commentId ?? "c-1",
      postId: null,
      platformPostId: o.mediaId ?? "media-1",
      platform: "instagram",
      text: o.text ?? "GUIDE please",
      createdAt: "2026-09-28T12:00:00Z",
      isReply: false,
      parentCommentId: null,
      author: { id: o.fromId ?? "user-1", username: o.username ?? "anna", name: "Anna", ...(o.isOwn ? { isOwnAccount: true } : {}) },
    },
    post: { id: "p-1", platformPostId: o.mediaId ?? "media-1", content: null, permalink: "https://instagram.com/p/x" },
    account,
    timestamp: "2026-09-28T12:00:01Z",
  };
}

export function messageEvent(o: {
  eventId?: string; messageId?: string; conversationId?: string; senderId?: string; username?: string; text?: string;
  storyId?: string; postbackPayload?: string;
} = {}) {
  const metadata = {
    ...(o.storyId ? { storyReply: { storyId: o.storyId, storyUrl: "https://cdn.example/s.jpg" } } : {}),
    ...(o.postbackPayload ? { postbackPayload: o.postbackPayload, postbackTitle: "Tap" } : {}),
  };
  return {
    id: o.eventId ?? nextEventId(),
    event: "message.received",
    message: {
      id: "internal-1",
      conversationId: o.conversationId ?? "conv-1",
      platform: "instagram",
      platformMessageId: o.messageId ?? "mid-1",
      direction: "incoming",
      text: o.text ?? "send it",
      attachments: [],
      sender: { id: o.senderId ?? "user-1", username: o.username ?? "anna", name: "Anna" },
      sentAt: "2026-09-28T12:05:00.000Z",
      isRead: false,
      sentVia: null,
    },
    conversation: { id: o.conversationId ?? "conv-1", platformConversationId: o.senderId ?? "user-1", participantId: o.senderId ?? "user-1", status: "active" },
    account,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    timestamp: "2026-09-28T12:05:01Z",
  };
}

export function sentEvent(o: { eventId?: string; messageId?: string; recipientId?: string; text?: string; sentVia?: string | null } = {}) {
  return {
    id: o.eventId ?? nextEventId(),
    event: "message.sent",
    message: {
      id: "internal-2",
      conversationId: "conv-1",
      platform: "instagram",
      platformMessageId: o.messageId ?? "mid-out",
      direction: "outgoing",
      text: o.text ?? "thanks!",
      sender: { id: ACCOUNT_ID },
      sentVia: o.sentVia === undefined ? null : o.sentVia,
    },
    conversation: { id: "conv-1", participantId: o.recipientId ?? "user-1", status: "active" },
    account,
    timestamp: "2026-09-28T12:06:00Z",
  };
}
