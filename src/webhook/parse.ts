export type WebhookEvent =
  | {
      kind: "comment";
      eventId: string;
      commentId: string;
      mediaId: string;
      text: string;
      fromId: string;
      fromUsername: string | null;
      isOwn: boolean;
    }
  | {
      kind: "message";
      eventId: string;
      messageId: string;
      conversationId: string;
      senderId: string;
      senderUsername: string | null;
      text: string;
      storyId: string | null;
      postbackPayload: string | null;
      quickReplyPayload: string | null;
    }
  | {
      kind: "echo";
      eventId: string;
      messageId: string;
      conversationId: string;
      recipientId: string | null;
      text: string;
      sentVia: string | null;
    }
  | { kind: "ignored"; eventId: string; event: string };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(obj: unknown, key: string): unknown {
  return isObj(obj) ? obj[key] : undefined;
}

/** IDs may arrive as strings or numbers; empty strings count as missing. */
function str(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function username(value: unknown): string | null {
  const name = str(value);
  return name ? name.replace(/^@/, "") : null;
}

/** One Zernio webhook delivery → a typed event; null when it has no event id or type. */
export function parseWebhook(body: unknown): WebhookEvent | null {
  const eventId = str(field(body, "id"));
  const event = str(field(body, "event"));
  if (!eventId || !event) return null;
  const ignored: WebhookEvent = { kind: "ignored", eventId, event };

  if (event === "comment.received") {
    const comment = field(body, "comment");
    const author = field(comment, "author");
    const commentId = str(field(comment, "id"));
    const mediaId = str(field(comment, "platformPostId")) ?? str(field(field(body, "post"), "platformPostId"));
    const fromId = str(field(author, "id"));
    if (!commentId || !mediaId || !fromId) return ignored;
    return {
      kind: "comment", eventId, commentId, mediaId, text: text(field(comment, "text")), fromId,
      fromUsername: username(field(author, "username")), isOwn: field(author, "isOwnAccount") === true,
    };
  }

  if (event === "message.received" || event === "message.sent") {
    const message = field(body, "message");
    const conversation = field(body, "conversation");
    const messageId = str(field(message, "platformMessageId")) ?? str(field(message, "id"));
    const conversationId = str(field(message, "conversationId")) ?? str(field(conversation, "id"));
    if (!messageId || !conversationId) return ignored;

    if (event === "message.sent" || field(message, "direction") === "outgoing") {
      const sentVia = field(message, "sentVia");
      return {
        kind: "echo", eventId, messageId, conversationId, recipientId: str(field(conversation, "participantId")),
        text: text(field(message, "text")), sentVia: typeof sentVia === "string" ? sentVia : null,
      };
    }

    const sender = field(message, "sender");
    const senderId = str(field(sender, "id"));
    if (!senderId) return ignored;
    const metadata = isObj(field(body, "metadata")) ? field(body, "metadata") : field(message, "metadata");
    return {
      kind: "message", eventId, messageId, conversationId, senderId,
      senderUsername: username(field(sender, "username")), text: text(field(message, "text")),
      storyId: str(field(field(metadata, "storyReply"), "storyId")),
      postbackPayload: str(field(metadata, "postbackPayload")),
      quickReplyPayload: str(field(metadata, "quickReplyPayload")),
    };
  }

  return ignored;
}
