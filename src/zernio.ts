import type { Button, OutgoingMessage } from "./messages";

export const ZERNIO_API = "https://zernio.com/api/v1";
export const WEBHOOK_EVENTS = ["comment.received", "message.received", "message.sent"];

type Fetch = typeof fetch;

export class ZernioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "ZernioError";
  }
}

interface ErrorBody {
  error?: string;
  type?: string;
  code?: string;
  details?: { privateReplyConsumed?: boolean };
  platformError?: { is_transient?: boolean; error_user_msg?: string };
}

// Zernio's stable error types that mean "try again later".
const TRANSIENT_TYPES = new Set(["rate_limit_error", "api_error"]);

export async function zernioRequest<T>(
  apiKey: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  options: { body?: unknown; query?: Record<string, string>; idempotencyKey?: string; fetch?: Fetch } = {},
): Promise<T> {
  const url = new URL(`${ZERNIO_API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));

  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    throw new ZernioError(`Network error calling ${method} ${path}: ${String(err)}`, 0, null, true);
  }

  const data = (await response.json().catch(() => ({}))) as ErrorBody & Record<string, unknown>;
  if (!response.ok) {
    // A spent private reply can never succeed, whatever the status says.
    const consumed = data.details?.privateReplyConsumed === true;
    const transient =
      !consumed &&
      (response.status >= 500 ||
        response.status === 429 ||
        TRANSIENT_TYPES.has(data.type ?? "") ||
        data.platformError?.is_transient === true);
    const instagramSays = data.platformError?.error_user_msg ? ` (Instagram: ${data.platformError.error_user_msg})` : "";
    throw new ZernioError(
      `${data.error ?? `HTTP ${response.status}`}${instagramSays} [${method} ${path}, code=${data.code ?? "-"}]`,
      response.status,
      data.code ?? null,
      transient,
    );
  }
  return data as T;
}

export interface MediaItem {
  id: string;
  caption: string | null;
  mediaType: string | null;
  timestamp: string | null;
  permalink: string | null;
}

export interface ZernioClient {
  privateReply(mediaId: string, commentId: string, text: string): Promise<{ messageId: string | null }>;
  replyToComment(mediaId: string, commentId: string, text: string, idempotencyKey: string): Promise<{ commentId: string | null }>;
  sendDm(conversationId: string, message: OutgoingMessage, idempotencyKey: string): Promise<{ messageId: string | null }>;
  listPosts(): Promise<MediaItem[]>;
}

interface RawPost {
  id?: string;
  message?: string | null;
  createdTime?: string;
  permalink?: string;
  mediaType?: string;
}

function toZernioButton(button: Button): Record<string, string> {
  const title = button.title.slice(0, 20);
  return button.type === "web_url"
    ? { type: "url", title, url: button.url }
    : { type: "postback", title, payload: button.payload };
}

export function createZernioClient(options: { apiKey: string; accountId: string; fetch?: Fetch }): ZernioClient {
  const { apiKey, accountId } = options;
  const call = <T>(
    method: "GET" | "POST",
    path: string,
    extra: { body?: unknown; idempotencyKey?: string } = {},
  ) => zernioRequest<T>(apiKey, method, path, { ...extra, fetch: options.fetch });
  const seg = encodeURIComponent;

  return {
    async privateReply(mediaId, commentId, text) {
      // Text only: Instagram refuses buttons here for non-followers (spec Amendment A).
      const result = await call<{ messageId?: string }>(
        "POST", `/inbox/comments/${seg(mediaId)}/${seg(commentId)}/private-reply`,
        { body: { accountId, message: text.slice(0, 1000) } },
      );
      return { messageId: result.messageId ?? null };
    },
    async replyToComment(mediaId, commentId, text, idempotencyKey) {
      const result = await call<{ data?: { commentId?: string } }>(
        "POST", `/inbox/comments/${seg(mediaId)}`,
        { body: { accountId, message: text, commentId }, idempotencyKey },
      );
      return { commentId: result.data?.commentId ?? null };
    },
    async sendDm(conversationId, message, idempotencyKey) {
      const buttons = (message.buttons ?? []).slice(0, 3).map(toZernioButton);
      const body = buttons.length > 0
        ? { accountId, message: message.text.slice(0, 640), buttons }
        : { accountId, message: message.text.slice(0, 1000) };
      const result = await call<{ data?: { messageId?: string } }>(
        "POST", `/inbox/conversations/${seg(conversationId)}/messages`, { body, idempotencyKey },
      );
      return { messageId: result.data?.messageId ?? null };
    },
    async listPosts() {
      const result = await call<{ posts?: RawPost[]; data?: RawPost[] }>("GET", `/accounts/${seg(accountId)}/posts`);
      return (result.posts ?? result.data ?? [])
        .filter((post): post is RawPost & { id: string } => typeof post.id === "string")
        .map((post) => ({
          id: post.id,
          caption: post.message ?? null,
          mediaType: post.mediaType ?? null,
          timestamp: post.createdTime ?? null,
          permalink: post.permalink ?? null,
        }));
    },
  };
}

export interface ZernioAccount {
  id: string;
  profileId: string;
  username: string | null;
}

interface RawAccount {
  _id?: string;
  platform?: string;
  profileId?: string | { _id?: string };
  username?: string;
  isActive?: boolean;
}

export async function listInstagramAccounts(apiKey: string, fetchFn?: Fetch): Promise<ZernioAccount[]> {
  const result = await zernioRequest<{ accounts?: RawAccount[] }>(apiKey, "GET", "/accounts", {
    query: { platform: "instagram" },
    fetch: fetchFn,
  });
  return (result.accounts ?? []).flatMap((raw) => {
    const profileId = typeof raw.profileId === "string" ? raw.profileId : raw.profileId?._id;
    if (!raw._id || !profileId || raw.isActive === false) return [];
    if (raw.platform && raw.platform !== "instagram") return [];
    return [{ id: raw._id, profileId, username: raw.username ? raw.username.replace(/^@/, "") : null }];
  });
}

export async function upsertWebhook(
  apiKey: string,
  options: { webhookId: string | null; url: string; secret: string; profileId: string },
  fetchFn?: Fetch,
): Promise<string> {
  const settings = {
    name: "dm-automation",
    url: options.url,
    secret: options.secret,
    events: WEBHOOK_EVENTS,
    profileIds: [options.profileId],
    isActive: true,
  };
  if (options.webhookId) {
    try {
      await zernioRequest(apiKey, "PUT", "/webhooks/settings", {
        body: { webhookId: options.webhookId, ...settings },
        fetch: fetchFn,
      });
      return options.webhookId;
    } catch (err) {
      if (!(err instanceof ZernioError && err.status === 404)) throw err; // deleted in the dashboard: create anew
    }
  }
  const result = await zernioRequest<{ webhook?: { _id?: string } }>(apiKey, "POST", "/webhooks/settings", {
    body: settings,
    fetch: fetchFn,
  });
  if (!result.webhook?._id) throw new ZernioError("Zernio created the webhook but returned no id", 200, null, false);
  return result.webhook._id;
}
