import type { ActionRow } from "./db/actions";
import type { ZernioClient } from "./zernio";

/** Sends one queued action. Returns the id of what was created (message or comment). */
export async function executeAction(zernio: ZernioClient, action: ActionRow): Promise<string | null> {
  const payload = action.payload;
  // Idempotency keys make Zernio replay instead of re-sending if we retry after a lost response.
  // A link follow-up may be refused until the commenter replies, so each try gets its own key:
  // a replayed refusal would block the try that should go through.
  const key = payload.kind === "dm" && payload.retryUntil !== undefined
    ? `action-${action.id}-try-${action.attempts}`
    : `action-${action.id}`;
  switch (payload.kind) {
    case "private_reply":
      return (await zernio.privateReply(payload.mediaId, payload.commentId, payload.text)).messageId;
    case "public_reply":
      return (await zernio.replyToComment(payload.mediaId, payload.commentId, payload.text, key)).commentId;
    case "dm":
      return (await zernio.sendDm(payload.conversationId, payload.message, key)).messageId;
  }
}
