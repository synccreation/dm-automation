import type { OutgoingMessage } from "./messages";

export type Recipient = { comment_id: string } | { id: string };

export interface MediaItem {
  id: string;
  caption?: string;
  media_product_type?: string;
  timestamp: string;
  permalink?: string;
}

export interface InstagramClient {
  sendMessage(recipient: Recipient, message: OutgoingMessage): Promise<{ messageId: string }>;
  replyToComment(commentId: string, text: string): Promise<{ id: string }>;
  listMedia(limit: number): Promise<MediaItem[]>;
  subscribeWebhooks(fields: string[]): Promise<void>;
}

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "InstagramError";
  }
}

// Meta error codes that mean "try again later": unknown/temporary errors and rate limits.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export function buildMessageBody(message: OutgoingMessage): Record<string, unknown> {
  if (!message.buttons || message.buttons.length === 0) return { text: message.text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: message.text.slice(0, 640),
        buttons: message.buttons.slice(0, 3).map((button) => ({ ...button, title: button.title.slice(0, 20) })),
      },
    },
  };
}

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
}

export function createInstagramClient(options: {
  accessToken: string;
  igUserId: string;
  version: string;
  fetch?: typeof fetch;
}): InstagramClient {
  const base = `https://graph.instagram.com/${options.version}`;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(
    method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Authorization: `Bearer ${options.accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new InstagramError(`Network error calling ${path}: ${String(err)}`, 0, null, true);
    }

    const data = (await response.json().catch(() => ({}))) as { error?: GraphError } & Record<string, unknown>;
    if (!response.ok || data.error) {
      const error = data.error ?? {};
      const code = typeof error.code === "number" ? error.code : null;
      const transient =
        response.status >= 500 ||
        response.status === 429 ||
        error.is_transient === true ||
        (code !== null && TRANSIENT_CODES.has(code));
      throw new InstagramError(
        `${error.message ?? `HTTP ${response.status}`} (${path}) [code=${code ?? "-"} subcode=${error.error_subcode ?? "-"}]`,
        response.status,
        code,
        transient,
      );
    }
    return data as T;
  }

  return {
    async sendMessage(recipient, message) {
      const result = await call<{ message_id: string }>("POST", `${options.igUserId}/messages`, {
        recipient,
        message: buildMessageBody(message),
      });
      return { messageId: result.message_id };
    },
    async replyToComment(commentId, text) {
      const result = await call<{ id: string }>("POST", `${commentId}/replies`, { message: text });
      return { id: result.id };
    },
    async listMedia(limit) {
      const result = await call<{ data?: MediaItem[] }>("GET", "me/media", undefined, {
        fields: "id,caption,media_product_type,timestamp,permalink",
        limit: String(limit),
      });
      return result.data ?? [];
    },
    async subscribeWebhooks(fields) {
      await call("POST", `${options.igUserId}/subscribed_apps`, { subscribed_fields: fields });
    },
  };
}
