import type { ActionPayload } from "./db/actions";
import type { InstagramClient } from "./instagram";

/** Sends one queued action. Returns the Instagram message id for DMs, null for public replies. */
export async function executeAction(ig: InstagramClient, payload: ActionPayload): Promise<string | null> {
  switch (payload.kind) {
    case "private_reply":
      return (await ig.sendMessage({ comment_id: payload.commentId }, payload.message)).messageId;
    case "public_reply":
      await ig.replyToComment(payload.commentId, payload.text);
      return null;
    case "dm":
      return (await ig.sendMessage({ id: payload.igsid }, payload.message)).messageId;
  }
}
