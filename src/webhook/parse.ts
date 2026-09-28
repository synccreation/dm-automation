export type WebhookEvent =
  | {
      kind: "comment";
      accountId: string;
      commentId: string;
      text: string;
      fromId: string;
      fromUsername: string | null;
      mediaId: string;
    }
  | {
      kind: "message";
      accountId: string;
      mid: string;
      senderId: string;
      text: string;
      attachmentTypes: string[];
      storyId: string | null;
    }
  | { kind: "echo"; accountId: string; mid: string; recipientId: string; text: string }
  | { kind: "postback"; accountId: string; mid: string; senderId: string; payload: string };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** IDs may arrive as strings or numbers; empty strings count as missing. */
function id(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function field(obj: unknown, key: string): unknown {
  return isObj(obj) ? obj[key] : undefined;
}

export function parseWebhook(body: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  if (!isObj(body) || body.object !== "instagram" || !Array.isArray(body.entry)) return events;

  for (const entry of body.entry) {
    const accountId = id(field(entry, "id"));
    if (!isObj(entry) || !accountId) continue;

    const changes: unknown[] = Array.isArray(entry.changes)
      ? entry.changes
      : typeof entry.field === "string"
        ? [{ field: entry.field, value: entry.value }]
        : [];
    for (const change of changes) {
      if (field(change, "field") !== "comments") continue;
      const value = field(change, "value");
      const commentId = id(field(value, "id"));
      const fromId = id(field(field(value, "from"), "id"));
      const mediaId = id(field(field(value, "media"), "id")) ?? id(field(value, "media_id"));
      if (!commentId || !fromId || !mediaId) continue;
      events.push({
        kind: "comment", accountId, commentId, text: text(field(value, "text")), fromId,
        fromUsername: id(field(field(value, "from"), "username")), mediaId,
      });
    }

    const messaging: unknown[] = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      if (!isObj(item)) continue;
      const senderId = id(field(item.sender, "id"));
      const recipientId = id(field(item.recipient, "id"));

      if (isObj(item.postback)) {
        const mid = id(item.postback.mid);
        const payload = id(item.postback.payload);
        if (senderId && mid && payload && senderId !== accountId) {
          events.push({ kind: "postback", accountId, mid, senderId, payload });
        }
        continue;
      }

      const message = item.message;
      if (!isObj(message)) continue; // reactions, read receipts, etc.
      const mid = id(message.mid);
      if (!mid || message.is_deleted === true || message.is_unsupported === true) continue;

      if (message.is_echo === true) {
        if (recipientId) events.push({ kind: "echo", accountId, mid, recipientId, text: text(message.text) });
        continue;
      }
      if (!senderId || senderId === accountId) continue;
      const attachmentTypes = Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => id(field(attachment, "type")) ?? "unknown")
        : [];
      events.push({
        kind: "message", accountId, mid, senderId, text: text(message.text), attachmentTypes,
        storyId: id(field(field(message.reply_to, "story"), "id")),
      });
    }
  }
  return events;
}
