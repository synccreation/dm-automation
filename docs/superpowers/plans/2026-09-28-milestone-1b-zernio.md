# Milestone 1b: Switch to Zernio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct Meta integration with Zernio, and deliver links with the two-step flow. The flow: a keyword comment gets a public reply plus a plain-text DM about a minute later; when the commenter replies, they get the link DM with a button right away.

**Architecture:** Same Worker, database and scheduler. The Meta Graph client, OAuth and Meta webhook give way to a Zernio REST client, a Zernio webhook parser and verifier, and a `POST /admin/setup` that registers the Zernio webhook. A new `link_state` on triggers drives the reply-to-get-link step.

**Tech Stack:** TypeScript, Hono 4, Wrangler 4, D1, Vitest 4.1 + `@cloudflare/vitest-plugin`, tsx.

**Spec:** `docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md` (Amendment A is authoritative where it conflicts). API facts: `docs/research/zernio-api.md`.

## Global Constraints

- Zernio base URL `https://zernio.com/api/v1`, `Authorization: Bearer <ZERNIO_API_KEY>`.
- Webhook signature: `X-Zernio-Signature` = lowercase hex HMAC-SHA256 of the raw body with `ZERNIO_WEBHOOK_SECRET`, with no `sha256=` prefix.
- Subscribed webhook events: `comment.received`, `message.received`, `message.sent`.
- The private reply (opening DM) is **plain text only**; buttons go only in DMs sent after the person has replied.
- Opening DM and public reply: `send_at = now + 60s + random(0–10s)`.
- Per scheduler run: at most 12 comment replies (`private_reply` + `public_reply`) and 20 DMs.
- Retries after 1, 5 and 15 minutes. Private replies older than 7 days are dropped. Link follow-ups are only for triggers from the last 7 days.
- Secrets: `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `ADMIN_TOKEN`. Vars: `PUBLIC_URL`, `CONTACT_EMAIL`.
- Only `src/zernio.ts` calls Zernio. Only `src/db/*` issues SQL (test helpers excepted).
- Timestamps are epoch ms.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Instagram refuses a button in the opening DM for non-followers:** the opening DM never carries buttons. (Task 3 test asserts a text-only private reply.)
2. **The commenter replies twice, or Zernio delivers the same reply event twice:** exactly one link DM. (Task 4 tests.)
3. **The immediate link send fails:** the link stays queued and the scheduler retries it; it isn't lost. (Task 4 test.)
4. **Someone who never commented DMs the account:** no link is sent. (Task 4 test.)
5. **More than one Instagram account, or none, is connected in Zernio when running setup:** a clear 409 that names what to do, instead of picking the wrong one. (Task 3 tests.)

---

### Task 1: Zernio REST client

**Files:**
- Create: `src/zernio.ts`
- Test: `test/zernio.test.ts`

**Interfaces:**
- Consumes: `Button` and `OutgoingMessage` from `src/messages.ts`, and `fakeFetch` and `jsonResponse` from `test/helpers.ts`.
- Produces:
  - `ZERNIO_API`
  - `WEBHOOK_EVENTS`
  - `class ZernioError { status: number; code: string | null; transient: boolean }`
  - `zernioRequest<T>(apiKey, method, path, options)`
  - `interface MediaItem { id; caption; mediaType; timestamp; permalink }`
  - `interface ZernioClient`:
    - `privateReply(mediaId, commentId, text) → { messageId }`
    - `replyToComment(mediaId, commentId, text, idempotencyKey) → { commentId }`
    - `sendDm(conversationId, message, idempotencyKey) → { messageId }`
    - `listPosts() → MediaItem[]`
  - `createZernioClient({ apiKey, accountId, fetch? })`
  - `interface ZernioAccount { id; profileId; username }`
  - `listInstagramAccounts(apiKey, fetch?)`
  - `upsertWebhook(apiKey, { webhookId, url, secret, profileId }, fetch?) → webhookId`

- [ ] **Step 1: Write the failing test `test/zernio.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ZernioError, createZernioClient, listInstagramAccounts, upsertWebhook } from "../src/zernio";
import { fakeFetch, jsonResponse, type FetchCall } from "./helpers";

const API = "https://zernio.com/api/v1";

function client(handler: (call: FetchCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  return { zernio: createZernioClient({ apiKey: "sk_test", accountId: "acc1", fetch: fake.fetch }), calls: fake.calls };
}

async function errorFrom(promise: Promise<unknown>): Promise<ZernioError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ZernioError);
  return error as ZernioError;
}

describe("ZernioClient", () => {
  it("sends a text-only private reply", async () => {
    const { zernio, calls } = client(() => jsonResponse({ status: "success", messageId: "m1", commentId: "c1", platform: "instagram" }));
    await expect(zernio.privateReply("media-1", "c1", "Reply to get the guide")).resolves.toEqual({ messageId: "m1" });
    expect(calls[0]!.url).toBe(`${API}/inbox/comments/media-1/c1/private-reply`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("Authorization")).toBe("Bearer sk_test");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ accountId: "acc1", message: "Reply to get the guide" });
  });

  it("replies publicly to a comment with an idempotency key", async () => {
    const { zernio, calls } = client(() => jsonResponse({ success: true, data: { commentId: "r1", isReply: true } }));
    await expect(zernio.replyToComment("media-1", "c1", "Sent!", "action-7")).resolves.toEqual({ commentId: "r1" });
    expect(calls[0]!.url).toBe(`${API}/inbox/comments/media-1`);
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("action-7");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ accountId: "acc1", message: "Sent!", commentId: "c1" });
  });

  it("sends a DM with url and postback buttons within Instagram's limits", async () => {
    const { zernio, calls } = client(() => jsonResponse({ success: true, data: { messageId: "mid-9", conversationId: "conv-1" } }));
    const result = await zernio.sendDm("conv-1", {
      text: "x".repeat(700),
      buttons: [
        { type: "web_url", title: "A very long button title", url: "https://e.com" },
        { type: "postback", title: "Later", payload: "LATER" },
      ],
    }, "action-8");
    expect(result).toEqual({ messageId: "mid-9" });
    expect(calls[0]!.url).toBe(`${API}/inbox/conversations/conv-1/messages`);
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe("action-8");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      accountId: "acc1",
      message: "x".repeat(640),
      buttons: [
        { type: "url", title: "A very long button t", url: "https://e.com" },
        { type: "postback", title: "Later", payload: "LATER" },
      ],
    });
  });

  it("lists recent posts", async () => {
    const { zernio, calls } = client(() => jsonResponse({
      posts: [{ id: "m1", message: "My reel", createdTime: "2026-09-01T00:00:00Z", permalink: "https://instagram.com/p/1", mediaType: "VIDEO" }],
    }));
    await expect(zernio.listPosts()).resolves.toEqual([
      { id: "m1", caption: "My reel", mediaType: "VIDEO", timestamp: "2026-09-01T00:00:00Z", permalink: "https://instagram.com/p/1" },
    ]);
    expect(calls[0]!.url).toBe(`${API}/accounts/acc1/posts`);
  });

  it("never retries a private reply Instagram refused, and keeps Instagram's reason", async () => {
    const { zernio } = client(() => jsonResponse({
      error: "Instagram refused this private reply", type: "platform_error", code: "platform_api_error",
      platformError: { code: 2, error_subcode: 1545133, is_transient: false, error_user_msg: "You can't send media unless they follow you." },
      details: { privateReplyConsumed: true },
    }, 400));
    const error = await errorFrom(zernio.privateReply("m", "c", "hi"));
    expect(error.transient).toBe(false);
    expect(error.message).toContain("unless they follow you");
  });

  it.each([
    [429, { error: "Rate limit exceeded", details: { retryAfterSeconds: 12 } }],
    [500, { error: "boom", type: "api_error" }],
    [503, { error: "busy", type: "api_error", code: "temporarily_unavailable" }],
  ])("treats HTTP %i as transient", async (status, body) => {
    const { zernio } = client(() => jsonResponse(body, status));
    expect((await errorFrom(zernio.sendDm("c", { text: "hi" }, "k"))).transient).toBe(true);
  });

  it("treats validation errors as permanent", async () => {
    const { zernio } = client(() => jsonResponse({ error: "bad", type: "invalid_request_error", code: "missing_required_field" }, 400));
    const error = await errorFrom(zernio.sendDm("c", { text: "hi" }, "k"));
    expect(error.transient).toBe(false);
    expect(error.code).toBe("missing_required_field");
  });

  it("treats network failures as transient", async () => {
    const { zernio } = client(() => { throw new TypeError("fetch failed"); });
    expect((await errorFrom(zernio.listPosts())).transient).toBe(true);
  });
});

describe("account setup calls", () => {
  it("lists connected Instagram accounts", async () => {
    const fake = fakeFetch(() => jsonResponse({
      accounts: [
        { _id: "acc1", platform: "instagram", profileId: { _id: "prof1", name: "Default" }, username: "@creator", isActive: true },
        { _id: "acc2", platform: "instagram", profileId: "prof2", username: "other", isActive: true },
        { _id: "acc3", platform: "instagram", profileId: "prof3", isActive: false },
        { _id: "acc4", platform: "twitter", profileId: "prof4", isActive: true },
      ],
    }));
    await expect(listInstagramAccounts("sk_test", fake.fetch)).resolves.toEqual([
      { id: "acc1", profileId: "prof1", username: "creator" },
      { id: "acc2", profileId: "prof2", username: "other" },
    ]);
    expect(fake.calls[0]!.url).toBe(`${API}/accounts?platform=instagram`);
  });

  it("creates the webhook when none is stored", async () => {
    const fake = fakeFetch(() => jsonResponse({ success: true, webhook: { _id: "wh1" } }));
    const id = await upsertWebhook("sk_test", { webhookId: null, url: "https://dm.test/webhook", secret: "s3", profileId: "prof1" }, fake.fetch);
    expect(id).toBe("wh1");
    expect(fake.calls[0]!.method).toBe("POST");
    expect(fake.calls[0]!.url).toBe(`${API}/webhooks/settings`);
    expect(JSON.parse(fake.calls[0]!.body!)).toEqual({
      name: "dm-automation", url: "https://dm.test/webhook", secret: "s3",
      events: ["comment.received", "message.received", "message.sent"], profileIds: ["prof1"], isActive: true,
    });
  });

  it("updates the stored webhook, and recreates it if it was deleted", async () => {
    const update = fakeFetch(() => jsonResponse({ success: true }));
    await expect(upsertWebhook("sk_test", { webhookId: "wh1", url: "u", secret: "s", profileId: "p" }, update.fetch)).resolves.toBe("wh1");
    expect(update.calls[0]!.method).toBe("PUT");
    expect(JSON.parse(update.calls[0]!.body!)).toMatchObject({ webhookId: "wh1", url: "u" });

    const recreate = fakeFetch((call) =>
      call.method === "PUT" ? jsonResponse({ error: "Not found", type: "not_found" }, 404) : jsonResponse({ webhook: { _id: "wh2" } }),
    );
    await expect(upsertWebhook("sk_test", { webhookId: "wh1", url: "u", secret: "s", profileId: "p" }, recreate.fetch)).resolves.toBe("wh2");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/zernio.test.ts`
Expected: FAIL, because `../src/zernio` is not found.

- [ ] **Step 3: Implement `src/zernio.ts`**

```ts
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
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run test/zernio.test.ts && npm run typecheck`
Expected: PASS (13 tests); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/zernio.ts test/zernio.test.ts
git commit -m "feat: add Zernio REST client"
```

---

### Task 2: Zernio webhook signature and event parsing

**Files:**
- Modify: `src/webhook/verify.ts` (add `verifyZernioSignature`; the Meta functions are removed in Task 3)
- Create: `src/webhook/zernio-parse.ts` (moved over `parse.ts` in Task 3)
- Create: `test/zernio-fixtures.ts`
- Test: `test/zernio-webhook.test.ts`

**Interfaces:**
- Produces:
  - `verifyZernioSignature(rawBody, header: string | null, secret: string): Promise<boolean>`
  - `type ZernioEvent` (`comment | message | echo | ignored`, fields as in the code below)
  - `parseZernioEvent(body): ZernioEvent | null`
  - Fixtures: `ACCOUNT_ID`, `PROFILE_ID`, `commentEvent()`, `messageEvent()`, `sentEvent()`

- [ ] **Step 1: Write the fixtures and the failing test**

`test/zernio-fixtures.ts` (shapes from Zernio's webhook schemas, `docs/research/zernio-api.md` §3.5):
```ts
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
```

`test/zernio-webhook.test.ts`:
```ts
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
    expect(await verifyZernioSignature("a", await hmacSha256Hex("", "a"), "")).toBe(false);
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/zernio-webhook.test.ts`
Expected: FAIL, because `verifyZernioSignature` and `../src/webhook/zernio-parse` do not exist.

- [ ] **Step 3: Add `verifyZernioSignature` to `src/webhook/verify.ts`**

Append:
```ts
/** Zernio signs the raw body: `X-Zernio-Signature: <lowercase hex HMAC-SHA256>` (no prefix). */
export async function verifyZernioSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  return constantTimeEqual(header.trim().toLowerCase(), await hmacSha256Hex(secret, rawBody));
}
```

- [ ] **Step 4: Create `src/webhook/zernio-parse.ts`**

```ts
export type ZernioEvent =
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
export function parseZernioEvent(body: unknown): ZernioEvent | null {
  const eventId = str(field(body, "id"));
  const event = str(field(body, "event"));
  if (!eventId || !event) return null;
  const ignored: ZernioEvent = { kind: "ignored", eventId, event };

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
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run test/zernio-webhook.test.ts && npm run typecheck`
Expected: PASS (9 tests); typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/webhook/verify.ts src/webhook/zernio-parse.ts test/zernio-fixtures.ts test/zernio-webhook.test.ts
git commit -m "feat: verify and parse Zernio webhooks"
```

---

### Task 3: Swap the Worker onto Zernio

This task replaces the Meta path wholesale, so its tests change together. It ends with the full suite green.

**Files:**
- Create:
  - `migrations/0003_link_state.sql`
  - `src/setup.ts`
- Modify:
  - Config: `src/env.ts`, `wrangler.jsonc`, `vitest.config.ts`
  - Data layer: `src/db/settings.ts`, `src/db/events.ts`, `src/db/actions.ts`
  - Worker code: `src/account.ts`, `src/actions.ts`, `src/scheduler.ts`, `src/health.ts`, `src/admin.ts`, `src/index.ts`, `src/rule-input.ts`, `src/pages.ts`, `src/webhook/handle.ts`
- Move: `src/webhook/zernio-parse.ts` → `src/webhook/parse.ts` (replacing it), and `test/zernio-fixtures.ts` → `test/fixtures.ts` (replacing it)
- Delete:
  - `src/instagram.ts`, `src/auth.ts`
  - `test/instagram.test.ts`, `test/auth.test.ts`, `test/webhook-verify.test.ts`, `test/webhook-parse.test.ts`
- Tests:
  - Rewrite: `test/helpers.ts`, `test/factories.ts`, `test/db.test.ts`, `test/scheduler.test.ts`, `test/webhook-comments.test.ts`, `test/admin.test.ts`
  - Modify: `test/zernio-webhook.test.ts` (imports), `test/rule-input.test.ts` (max lengths)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `AppEnv { DB, ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET, ADMIN_TOKEN, PUBLIC_URL, CONTACT_EMAIL }`
  - `SettingKey = "zernio_account_id" | "zernio_profile_id" | "zernio_webhook_id" | "ig_username" | "last_webhook_at" | "last_sweep_at"`
  - `LinkState = "none" | "awaiting_reply" | "delivered"` and `TriggerRow.link_state`
  - `claimAwaitingTriggers(db, contactIgsid, createdSince): Promise<TriggerRow[]>`
  - `ActionPayload`:
    - `private_reply { mediaId, commentId, text }`
    - `public_reply { mediaId, commentId, text }`
    - `dm { conversationId, message }`
  - `claimActionById(db, id, now): Promise<ActionRow | null>`
  - `executeAction(zernio, action: ActionRow): Promise<string | null>`
  - `zernioFromSettings(env): Promise<ZernioClient | null>`
  - `runScheduler(env, now, deps?: { zernio?: ZernioClient })`
  - `sendActionNow(env, actionId, now, deps?): Promise<boolean>`
  - `runSetup(env, requestedAccountId | null, fetch?): Promise<SetupResult>`
  - `handleEvent(env, event, { now, random?, defer })`
  - Test helpers: `postWebhook(body, secret?)`, `postWebhookRaw(raw, secret?)`, `ACCOUNT_ID`, `PROFILE_ID`
  - `Health { connected, username, webhookRegistered, lastWebhookAt, pendingActions, failedLast24h }`
  - Admin: `POST /admin/setup {accountId?}`. `/admin/auth/start`, `GET /webhook` and `/auth/callback` are removed.

- [ ] **Step 1: Config, env and migration**

`migrations/0003_link_state.sql`:
```sql
-- Instagram refuses buttons in a private reply to non-followers (since Aug 2026), so the
-- link goes out in a follow-up DM once the commenter replies. link_state tracks that step:
-- none (rule has no link) | awaiting_reply | delivered.
ALTER TABLE triggers ADD COLUMN link_state TEXT NOT NULL DEFAULT 'none';
CREATE INDEX triggers_awaiting ON triggers (contact_igsid, link_state);
```

`src/env.ts`:
```ts
export interface AppEnv {
  DB: D1Database;
  ZERNIO_API_KEY: string;
  /** Our own secret; Zernio signs webhook deliveries with it (registered by `setup`). */
  ZERNIO_WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  PUBLIC_URL: string;
  CONTACT_EMAIL: string;
}
```

In `wrangler.jsonc`, delete the `"GRAPH_API_VERSION": "v25.0",` line from `vars`.

In `vitest.config.ts`, replace the `bindings` object with:
```ts
          bindings: {
            TEST_MIGRATIONS: migrations,
            ZERNIO_API_KEY: "sk_test",
            ZERNIO_WEBHOOK_SECRET: "test-webhook-secret",
            ADMIN_TOKEN: "test-admin-token",
            PUBLIC_URL: "https://dm.test",
            CONTACT_EMAIL: "creator@example.com",
          },
```

`src/db/settings.ts`: replace the `SettingKey` type with:
```ts
export type SettingKey =
  | "zernio_account_id"
  | "zernio_profile_id"
  | "zernio_webhook_id"
  | "ig_username"
  | "last_webhook_at"
  | "last_sweep_at";
```

Run: `npx wrangler types`

- [ ] **Step 2: Data layer changes**

`src/db/events.ts`:
- Add after the imports:
  ```ts
  export type LinkState = "none" | "awaiting_reply" | "delivered";
  ```
- Add `link_state: LinkState;` to `TriggerRow` (after `created_at`).
- Replace `insertTrigger` with:
  ```ts
  /** Returns the new trigger id, or null if this person already triggered this rule on this media. */
  export async function insertTrigger(db: D1Database, trigger: Omit<TriggerRow, "id">): Promise<number | null> {
    const row = await db
      .prepare(
        `INSERT INTO triggers (rule_id, contact_igsid, media_id, source, comment_id, comment_at, created_at, link_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (rule_id, contact_igsid, media_id) DO NOTHING
         RETURNING id`,
      )
      .bind(
        trigger.rule_id, trigger.contact_igsid, trigger.media_id, trigger.source,
        trigger.comment_id, trigger.comment_at, trigger.created_at, trigger.link_state,
      )
      .first<{ id: number }>();
    return row?.id ?? null;
  }
  ```
- Append:
  ```ts
  /**
   * Atomically marks a contact's recent awaiting links as delivered and returns them, so two
   * replies (or a redelivered event) can never send the same link twice.
   */
  export async function claimAwaitingTriggers(
    db: D1Database, contactIgsid: string, createdSince: number,
  ): Promise<TriggerRow[]> {
    const { results } = await db
      .prepare(
        `UPDATE triggers SET link_state = 'delivered'
         WHERE contact_igsid = ? AND link_state = 'awaiting_reply' AND created_at >= ?
         RETURNING *`,
      )
      .bind(contactIgsid, createdSince)
      .all<TriggerRow>();
    return results.sort((a, b) => a.id - b.id);
  }
  ```

`src/db/actions.ts`:
- Replace `ActionPayload` with:
  ```ts
  export type ActionPayload =
    | { kind: "private_reply"; mediaId: string; commentId: string; text: string }
    | { kind: "public_reply"; mediaId: string; commentId: string; text: string }
    | { kind: "dm"; conversationId: string; message: OutgoingMessage };
  ```
- Add after `claimDueActions`:
  ```ts
  /** Claims one specific pending action (for an immediate send); null if someone else has it. */
  export async function claimActionById(db: D1Database, id: number, now: number): Promise<ActionRow | null> {
    const raw = await db
      .prepare(
        "UPDATE actions SET status = 'sending', attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = 'pending' RETURNING *",
      )
      .bind(now, id)
      .first<RawAction>();
    return raw ? toAction(raw) : null;
  }
  ```

- [ ] **Step 3: Rewrite the test helpers, factories and fixtures**

```bash
git mv -f test/zernio-fixtures.ts test/fixtures.ts
git mv -f src/webhook/zernio-parse.ts src/webhook/parse.ts
git rm -q src/instagram.ts src/auth.ts test/instagram.test.ts test/auth.test.ts test/webhook-verify.test.ts test/webhook-parse.test.ts
```

In `src/webhook/parse.ts`, rename `ZernioEvent` to `WebhookEvent`, which is the name the rest of the Worker uses. In `test/zernio-webhook.test.ts`, change the parse import to `from "../src/webhook/parse"` and the fixtures import to `from "./fixtures"`. Keep the `hmacSha256Hex` known-vector test by appending it to the first `describe` there:
```ts
  it("computes a standard HMAC-SHA256", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"))
      .toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
```

`test/helpers.ts` (full file):
```ts
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { hmacSha256Hex } from "../src/webhook/verify";
import { ACCOUNT_ID, PROFILE_ID } from "./fixtures";

export { ACCOUNT_ID, PROFILE_ID };
export const testEnv = env as unknown as AppEnv;

// Child tables first so foreign keys never block the delete.
const TABLES = [
  "clicks", "actions", "triggers", "messages", "conversations",
  "processed_events", "contacts", "rules", "links", "settings",
];

export async function resetDb(): Promise<void> {
  await testEnv.DB.batch(TABLES.map((table) => testEnv.DB.prepare(`DELETE FROM ${table}`)));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

export function fakeFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const call: FetchCall = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body ? await request.text() : null,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Replace global fetch for code paths that can't take an injected fetch (routes). */
export function stubGlobalFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const { fetch: impl, calls } = fakeFetch(handler);
  vi.spyOn(globalThis, "fetch").mockImplementation(impl);
  return calls;
}

export async function seedConnectedAccount(): Promise<void> {
  const rows: [string, string][] = [
    ["zernio_account_id", ACCOUNT_ID],
    ["zernio_profile_id", PROFILE_ID],
    ["zernio_webhook_id", "wh-1"],
    ["ig_username", "creator"],
  ];
  await testEnv.DB.batch(
    rows.map(([key, value]) =>
      testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(key, value),
    ),
  );
}

/** POSTs a signed Zernio delivery and waits for any work it deferred with waitUntil. */
export async function postWebhookRaw(raw: string, secret = "test-webhook-secret"): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.request("/webhook", {
    method: "POST",
    body: raw,
    headers: { "Content-Type": "application/json", "X-Zernio-Signature": await hmacSha256Hex(secret, raw) },
  }, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function postWebhook(body: unknown, secret?: string): Promise<Response> {
  return postWebhookRaw(JSON.stringify(body), secret);
}
```

In `test/factories.ts`, change the default `opening_text` to `"Hey {name}! Reply to this message and I'll send you the guide 👇"`.

- [ ] **Step 4: Rewrite `test/db.test.ts` for the new payloads and link state**

Full file:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimActionById, claimDueActions, countActions, enqueueAction, enqueueActionOnce, failStuckActions, getAction,
  markRetry, recentActions, type ActionPayload,
} from "../src/db/actions";
import { getContact, upsertContact } from "../src/db/contacts";
import {
  claimAwaitingTriggers, findTriggerId, getTrigger, insertTrigger, isProcessed, markProcessed,
} from "../src/db/events";
import { countClicks, getLinkByCode, insertClick, insertLink } from "../src/db/links";
import { getRule, insertRule, listActiveRules, listRules, updateRule } from "../src/db/rules";
import { deleteSetting, getSetting, setSetting } from "../src/db/settings";
import { DAY } from "../src/time";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const db = () => testEnv.DB;
const NOW = 1_700_000_000_000;

beforeEach(resetDb);

async function trigger(overrides: Partial<Parameters<typeof insertTrigger>[1]> = {}) {
  const rule = await insertRule(db(), newRule(), NOW);
  return insertTrigger(db(), {
    rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
    comment_id: "c1", comment_at: NOW, created_at: NOW, link_state: "none", ...overrides,
  });
}

describe("settings", () => {
  it("stores, overwrites and deletes values", async () => {
    expect(await getSetting(db(), "ig_username")).toBeNull();
    await setSetting(db(), "ig_username", "a");
    await setSetting(db(), "ig_username", "b");
    expect(await getSetting(db(), "ig_username")).toBe("b");
    await deleteSetting(db(), "ig_username");
    expect(await getSetting(db(), "ig_username")).toBeNull();
  });
});

describe("rules", () => {
  it("round-trips JSON and boolean columns", async () => {
    const rule = await insertRule(db(), newRule({ scope: ["m1", "m2"], public_replies: ["Sent!"] }), NOW);
    expect(rule).toMatchObject({
      keywords: ["guide"], scope: ["m1", "m2"], public_replies: ["Sent!"],
      on_comment: true, follow_gate: false, active: true, created_at: NOW,
    });
    expect(await getRule(db(), rule.id)).toEqual(rule);
  });

  it("lists only active rules for matching", async () => {
    await insertRule(db(), newRule({ name: "on" }), NOW);
    await insertRule(db(), newRule({ name: "off", active: false }), NOW);
    expect((await listRules(db())).map((r) => r.name)).toEqual(["on", "off"]);
    expect((await listActiveRules(db())).map((r) => r.name)).toEqual(["on"]);
  });

  it("updates only the given fields and returns null for unknown ids", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const updated = await updateRule(db(), rule.id, { active: false, keywords: ["pdf"] });
    expect(updated).toMatchObject({ active: false, keywords: ["pdf"], name: "Guide" });
    expect(await updateRule(db(), 999_999, { active: false })).toBeNull();
  });
});

describe("contacts", () => {
  it("keeps a known username when a later event has none", async () => {
    await upsertContact(db(), { igsid: "u1", username: "anna" }, NOW);
    await upsertContact(db(), { igsid: "u1", username: null }, NOW + 1);
    expect(await getContact(db(), "u1")).toMatchObject({ username: "anna", first_seen_at: NOW, follows_me: null });
    await upsertContact(db(), { igsid: "u1", username: "anna2" }, NOW + 2);
    expect((await getContact(db(), "u1"))?.username).toBe("anna2");
  });
});

describe("events and triggers", () => {
  it("marks events processed idempotently", async () => {
    expect(await isProcessed(db(), "event:1")).toBe(false);
    await markProcessed(db(), "event:1", NOW);
    await markProcessed(db(), "event:1", NOW);
    expect(await isProcessed(db(), "event:1")).toBe(true);
  });

  it("returns null for a duplicate trigger and can find the existing one", async () => {
    const id = await trigger({ link_state: "awaiting_reply" });
    expect(id).not.toBeNull();
    const again = await insertTrigger(db(), {
      rule_id: (await getTrigger(db(), id!))!.rule_id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c2", comment_at: NOW, created_at: NOW, link_state: "awaiting_reply",
    });
    expect(again).toBeNull();
    const row = await getTrigger(db(), id!);
    expect(row).toMatchObject({ comment_id: "c1", link_state: "awaiting_reply" });
    expect(await findTriggerId(db(), row!.rule_id, "u1", "m1")).toBe(id);
    expect(await findTriggerId(db(), row!.rule_id, "u2", "m1")).toBeNull();
  });

  it("claims a contact's recent awaiting links exactly once", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const base = { rule_id: rule.id, contact_igsid: "u1", source: "comment" as const, comment_id: "c", comment_at: NOW };
    const recent = await insertTrigger(db(), { ...base, media_id: "m1", created_at: NOW, link_state: "awaiting_reply" });
    await insertTrigger(db(), { ...base, media_id: "m2", created_at: NOW - 8 * DAY, link_state: "awaiting_reply" });
    await insertTrigger(db(), { ...base, media_id: "m3", created_at: NOW, link_state: "none" });
    await insertTrigger(db(), { ...base, contact_igsid: "u2", media_id: "m1", created_at: NOW, link_state: "awaiting_reply" });

    const claimed = await claimAwaitingTriggers(db(), "u1", NOW - 7 * DAY);
    expect(claimed.map((t) => [t.id, t.link_state])).toEqual([[recent, "delivered"]]);
    expect(await claimAwaitingTriggers(db(), "u1", NOW - 7 * DAY)).toEqual([]);
  });
});

describe("actions", () => {
  const dm = (n: string): ActionPayload => ({ kind: "dm", conversationId: `conv-${n}`, message: { text: "hi" } });
  const privateReply: ActionPayload = { kind: "private_reply", mediaId: "m1", commentId: "c1", text: "hi" };

  it("claims only due actions of the requested types, up to the limit", async () => {
    const due1 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW - 2, payload: dm("1") }, NOW);
    const due2 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW - 1, payload: dm("2") }, NOW);
    await enqueueAction(db(), { triggerId: null, contactIgsid: "u3", sendAt: NOW + 60_000, payload: dm("3") }, NOW);
    await enqueueAction(db(), {
      triggerId: null, contactIgsid: "u4", sendAt: NOW - 5,
      payload: { kind: "public_reply", mediaId: "m4", commentId: "c4", text: "Sent!" },
    }, NOW);

    const claimed = await claimDueActions(db(), NOW, ["dm"], 1);
    expect(claimed.map((a) => a.id)).toEqual([due1]);
    expect(claimed[0]).toMatchObject({ status: "sending", attempts: 1, claimed_at: NOW, payload: dm("1") });
    expect((await claimDueActions(db(), NOW, ["dm"], 10)).map((a) => a.id)).toEqual([due2]);
  });

  it("claims one specific pending action, only once", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    expect(await claimActionById(db(), id, NOW)).toMatchObject({ id, status: "sending", attempts: 1 });
    expect(await claimActionById(db(), id, NOW)).toBeNull();
  });

  it("enqueues at most one opening DM and one public reply per trigger", async () => {
    const triggerId = await trigger();
    const reply = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: privateReply };
    expect(await enqueueActionOnce(db(), reply, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), reply, NOW)).toBeNull();
    const followUp = { triggerId, contactIgsid: "u1", sendAt: NOW, payload: dm("1") };
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
    expect(await enqueueActionOnce(db(), followUp, NOW)).not.toBeNull();
  });

  it("puts a retried action back in the queue", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    await markRetry(db(), id, NOW + 60_000, "boom");
    expect(await getAction(db(), id)).toMatchObject({ status: "pending", send_at: NOW + 60_000, last_error: "boom", attempts: 1 });
  });

  it("fails actions stuck in sending", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    expect(await failStuckActions(db(), NOW + 1)).toBe(1);
    expect(await getAction(db(), id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
    expect(await countActions(db(), "failed")).toBe(1);
    expect(await countActions(db(), "failed", NOW + 10)).toBe(0);
  });

  it("lists recent actions newest first", async () => {
    const a = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("1") }, NOW);
    const b = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW, payload: dm("2") }, NOW);
    expect((await recentActions(db(), 10)).map((x) => x.id)).toEqual([b, a]);
  });
});

describe("links", () => {
  it("stores links and counts clicks", async () => {
    const link = await insertLink(db(), "abc123", "https://example.com", "Guide", NOW);
    expect(await getLinkByCode(db(), "abc123")).toEqual(link);
    await insertClick(db(), link.id, "u1", NOW);
    await insertClick(db(), link.id, null, NOW);
    expect(await countClicks(db(), link.id)).toBe(2);
    expect(await getLinkByCode(db(), "nope")).toBeNull();
  });
});
```

- [ ] **Step 5: Rewrite `test/scheduler.test.ts`**

Full file:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actionsDb from "../src/db/actions";
import { enqueueAction, getAction, type ActionPayload } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertRule } from "../src/db/rules";
import { runScheduler, sendActionNow } from "../src/scheduler";
import { DAY, MINUTE } from "../src/time";
import { ZernioError, type ZernioClient } from "../src/zernio";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const NOW = 1_700_000_000_000;

function fakeZernio(fail?: () => Promise<never>) {
  const sent: unknown[][] = [];
  const zernio: ZernioClient = {
    async privateReply(mediaId, commentId, text) {
      sent.push(["privateReply", mediaId, commentId, text]);
      if (fail) return fail();
      return { messageId: `mid-${sent.length}` };
    },
    async replyToComment(mediaId, commentId, text, key) {
      sent.push(["replyToComment", mediaId, commentId, text, key]);
      if (fail) return fail();
      return { commentId: `reply-${sent.length}` };
    },
    async sendDm(conversationId, message, key) {
      sent.push(["sendDm", conversationId, message, key]);
      if (fail) return fail();
      return { messageId: `dm-${sent.length}` };
    },
    async listPosts() { return []; },
  };
  return { zernio, sent };
}

const privateReply = (commentId: string): ActionPayload => ({ kind: "private_reply", mediaId: "m1", commentId, text: "hi" });
const dmTo = (conversationId: string): ActionPayload => ({ kind: "dm", conversationId, message: { text: "hi" } });
const enqueue = (payload: ActionPayload, sendAt = NOW - 1, triggerId: number | null = null) =>
  enqueueAction(testEnv.DB, { triggerId, contactIgsid: "u1", payload, sendAt }, NOW - 1);

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("runScheduler", () => {
  it("does nothing and loses nothing before Zernio is set up", async () => {
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW);
    expect(report.skippedNoToken).toBe(true);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends due actions with idempotency keys and leaves future ones queued", async () => {
    const { zernio, sent } = fakeZernio();
    const dm = await enqueue(privateReply("c1"));
    const reply = await enqueue({ kind: "public_reply", mediaId: "m1", commentId: "c1", text: "Sent!" });
    const later = await enqueue(dmTo("conv-1"), NOW + MINUTE);

    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report).toMatchObject({ sent: 2, failed: 0, retried: 0 });
    expect(sent).toEqual([
      ["privateReply", "m1", "c1", "hi"],
      ["replyToComment", "m1", "c1", "Sent!", `action-${reply}`],
    ]);
    expect(await getAction(testEnv.DB, dm)).toMatchObject({ status: "sent", sent_mid: "mid-1" });
    expect(await getAction(testEnv.DB, reply)).toMatchObject({ status: "sent", sent_mid: "reply-2" });
    expect(await getAction(testEnv.DB, later)).toMatchObject({ status: "pending" });
  });

  it("caps comment replies at 12 and DMs at 20 per run", async () => {
    const { zernio } = fakeZernio();
    for (let i = 0; i < 15; i++) await enqueue(privateReply(`c${i}`));
    for (let i = 0; i < 25; i++) await enqueue(dmTo(`conv-${i}`));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.sent).toBe(32);
    const pending = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").first<{ n: number }>();
    expect(pending!.n).toBe(8);
  });

  it("retries a transient failure a minute later", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("down", 500, null, true)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.retried).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 1, send_at: NOW + MINUTE });
  });

  it("gives up after the fourth transient failure", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("down", 500, null, true)));
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET attempts = 3 WHERE id = ?").bind(id).run();
    await runScheduler(testEnv, NOW, { zernio });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("fails a permanent error immediately and keeps the reason", async () => {
    const { zernio } = fakeZernio(() => Promise.reject(new ZernioError("Instagram refused this private reply", 400, "platform_api_error", false)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.failed).toBe(1);
    expect((await getAction(testEnv.DB, id))!.last_error).toContain("refused");
  });

  it("drops a private reply to a comment older than 7 days", async () => {
    const { zernio, sent } = fakeZernio();
    const rule = await insertRule(testEnv.DB, newRule(), NOW);
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW - 8 * DAY, created_at: NOW - 8 * DAY, link_state: "none",
    });
    const id = await enqueue(privateReply("c1"), NOW - 1, triggerId);
    const report = await runScheduler(testEnv, NOW, { zernio });
    expect(report.dropped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "dropped" });
  });

  it("never resends a message that was delivered but could not be recorded", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(privateReply("c1"));
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduler(testEnv, NOW, { zernio });
    await runScheduler(testEnv, NOW + MINUTE, { zernio });
    expect(sent).toHaveLength(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "sending" });
  });

  it("keeps working through the batch when one row's bookkeeping fails", async () => {
    const { zernio, sent } = fakeZernio();
    await enqueue(privateReply("c1"), NOW - 2);
    const second = await enqueue(privateReply("c2"), NOW - 1);
    vi.spyOn(actionsDb, "markSent").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(actionsDb, "markRetry").mockRejectedValueOnce(new Error("D1 blip"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runScheduler(testEnv, NOW, { zernio });
    expect(sent).toHaveLength(2);
    expect(await getAction(testEnv.DB, second)).toMatchObject({ status: "sent" });
  });

  it("fails actions stuck in sending for over 10 minutes", async () => {
    const { zernio } = fakeZernio();
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending', claimed_at = ? WHERE id = ?").bind(NOW - 11 * MINUTE, id).run();
    await runScheduler(testEnv, NOW, { zernio });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
  });
});

describe("sendActionNow", () => {
  it("sends one queued action immediately, with its idempotency key", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(dmTo("conv-1"), NOW);
    expect(await sendActionNow(testEnv, id, NOW, { zernio })).toBe(true);
    expect(sent).toEqual([["sendDm", "conv-1", { text: "hi" }, `action-${id}`]]);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "sent", sent_mid: "dm-1" });
  });

  it("does nothing when the scheduler already claimed the action", async () => {
    const { zernio, sent } = fakeZernio();
    const id = await enqueue(dmTo("conv-1"), NOW);
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending' WHERE id = ?").bind(id).run();
    expect(await sendActionNow(testEnv, id, NOW, { zernio })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Rewrite `test/webhook-comments.test.ts`**

Full file:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction, type ActionRow } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { getSetting } from "../src/db/settings";
import { newRule } from "./factories";
import { commentEvent } from "./fixtures";
import { postWebhook, postWebhookRaw, resetDb, seedConnectedAccount, testEnv } from "./helpers";

const VARIANTS = ["Sent! Check your DMs 👀", "Just sent it 🙌"];
const PROMPT = "Hey anna! Reply to this message and I'll send you the guide 👇";

async function seedRule(overrides: Partial<NewRule> = {}) {
  const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
  return insertRule(testEnv.DB, newRule({ link_id: link.id, public_replies: VARIANTS, ...overrides }), Date.now());
}

async function actions(): Promise<ActionRow[]> {
  const { results } = await testEnv.DB.prepare("SELECT * FROM actions ORDER BY id").all<ActionRow & { payload: string }>();
  return results.map((row) => ({ ...row, payload: JSON.parse(row.payload as unknown as string) }));
}

async function count(table: string): Promise<number> {
  return (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

async function linkState(): Promise<string | undefined> {
  return (await testEnv.DB.prepare("SELECT link_state FROM triggers").first<{ link_state: string }>())?.link_state;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /webhook: comments", () => {
  it("rejects an invalid signature, stores nothing and logs why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedRule();
    const res = await postWebhook(commentEvent(), "wrong-secret");
    expect(res.status).toBe(401);
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad signature"));
  });

  it("queues a public reply and a text-only opening DM about a minute out", async () => {
    await seedRule();
    const before = Date.now();
    const res = await postWebhook(commentEvent());
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await linkState()).toBe("awaiting_reply");

    const [publicReply, privateReply] = await actions();
    expect(publicReply!.payload).toMatchObject({ kind: "public_reply", mediaId: "media-1", commentId: "c-1" });
    expect(VARIANTS).toContain((publicReply!.payload as { text: string }).text);
    expect(privateReply!.payload).toEqual({ kind: "private_reply", mediaId: "media-1", commentId: "c-1", text: PROMPT });
    for (const action of [publicReply!, privateReply!]) {
      expect(action.status).toBe("pending");
      expect(action.send_at).toBeGreaterThanOrEqual(before + 60_000);
      expect(action.send_at).toBeLessThan(after + 70_000);
    }
  });

  it("queues only the DM when the rule has no public replies", async () => {
    await seedRule({ public_replies: [] });
    await postWebhook(commentEvent());
    expect((await actions()).map((a) => a.type)).toEqual(["private_reply"]);
  });

  it("needs no follow-up when the rule has no link", async () => {
    await insertRule(testEnv.DB, newRule({ opening_text: "Thanks {name}!" }), Date.now());
    await postWebhook(commentEvent({ username: "" }));
    expect((await actions())[0]!.payload).toEqual({ kind: "private_reply", mediaId: "media-1", commentId: "c-1", text: "Thanks there!" });
    expect(await linkState()).toBe("none");
  });

  it("does nothing for a comment without a keyword, but remembers the event", async () => {
    await seedRule();
    await postWebhook(commentEvent({ text: "love this" }));
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(1);
  });

  it("ignores comments by the creator's own account", async () => {
    await seedRule();
    await postWebhook(commentEvent({ commentId: "c-own-1", isOwn: true }));
    await postWebhook(commentEvent({ commentId: "c-own-2", fromId: "someone", username: "Creator" }));
    expect(await count("actions")).toBe(0);
  });

  it("sends one DM when Zernio delivers the same event twice", async () => {
    await seedRule();
    const event = commentEvent();
    await postWebhook(event);
    await postWebhook(event);
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("sends one DM when the same person comments the keyword again on the same post", async () => {
    await seedRule();
    await postWebhook(commentEvent({ commentId: "c-1" }));
    await postWebhook(commentEvent({ commentId: "c-2", text: "GUIDE!!" }));
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("finishes a delivery that failed halfway when Zernio retries", async () => {
    const rule = await seedRule();
    // State left by a first delivery that crashed after saving the trigger and the public reply.
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "user-1", media_id: "media-1", source: "comment",
      comment_id: "c-1", comment_at: Date.now(), created_at: Date.now(), link_state: "awaiting_reply",
    });
    await enqueueAction(testEnv.DB, {
      triggerId, contactIgsid: "user-1", sendAt: Date.now(),
      payload: { kind: "public_reply", mediaId: "media-1", commentId: "c-1", text: "Sent!" },
    }, Date.now());

    await postWebhook(commentEvent());
    expect((await actions()).map((a) => a.type)).toEqual(["public_reply", "private_reply"]);
  });

  it("acknowledges events it doesn't act on and records the time", async () => {
    const res = await postWebhook({ id: "evt-read", event: "message.read" });
    expect(res.status).toBe(200);
    expect(Number(await getSetting(testEnv.DB, "last_webhook_at"))).toBeGreaterThan(0);
  });

  it("rejects a body that isn't JSON", async () => {
    expect((await postWebhookRaw("not json")).status).toBe(400);
  });
});
```

- [ ] **Step 7: Rewrite `test/admin.test.ts`**

Full file:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction } from "../src/db/actions";
import { getLinkById } from "../src/db/links";
import { getSetting, setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { jsonResponse, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

const AUTH = { Authorization: "Bearer test-admin-token" };
const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Reply and I'll send it!", button_label: "Get it" };
const ZERNIO = "https://zernio.com/api/v1";

function adminRequest(path: string, init: RequestInit = {}) {
  return app.request(`/admin${path}`, {
    ...init,
    headers: { ...AUTH, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, testEnv);
}

function zernioAccounts(accounts: unknown[]) {
  return (call: FetchCall): Response => {
    if (call.url === `${ZERNIO}/accounts?platform=instagram`) return jsonResponse({ accounts });
    if (call.url === `${ZERNIO}/webhooks/settings` && call.method === "POST") return jsonResponse({ success: true, webhook: { _id: "wh-new" } });
    if (call.url === `${ZERNIO}/webhooks/settings` && call.method === "PUT") return jsonResponse({ success: true });
    return jsonResponse({ error: `unexpected ${call.method} ${call.url}` }, 500);
  };
}

const ACCOUNT = { _id: "acc1", platform: "instagram", profileId: { _id: "prof1", name: "Default" }, username: "creator", isActive: true };

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("admin auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await app.request("/admin/health", {}, testEnv)).status).toBe(401);
    expect((await app.request("/admin/health", { headers: { Authorization: "Bearer nope" } }, testEnv)).status).toBe(401);
  });
});

describe("GET /admin/health", () => {
  it("reports a system that isn't set up yet", async () => {
    expect(await (await adminRequest("/health")).json()).toEqual({
      connected: false, username: null, webhookRegistered: false, lastWebhookAt: null, pendingActions: 0, failedLast24h: 0,
    });
  });

  it("reports connection, webhook and queue counts", async () => {
    await seedConnectedAccount();
    await setSetting(testEnv.DB, "last_webhook_at", "1234");
    await enqueueAction(testEnv.DB, {
      triggerId: null, contactIgsid: "u1", sendAt: Date.now(), payload: { kind: "dm", conversationId: "conv-1", message: { text: "x" } },
    }, Date.now());
    expect(await (await adminRequest("/health")).json()).toMatchObject({
      connected: true, username: "creator", webhookRegistered: true, lastWebhookAt: 1234, pendingActions: 1,
    });
  });
});

describe("POST /admin/setup", () => {
  it("links the only Instagram account and registers the webhook", async () => {
    const calls = stubGlobalFetch(zernioAccounts([ACCOUNT]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: "creator", accountId: "acc1", webhookId: "wh-new" });
    expect(await getSetting(testEnv.DB, "zernio_account_id")).toBe("acc1");
    expect(await getSetting(testEnv.DB, "zernio_profile_id")).toBe("prof1");
    expect(await getSetting(testEnv.DB, "zernio_webhook_id")).toBe("wh-new");
    expect(await getSetting(testEnv.DB, "ig_username")).toBe("creator");
    const webhookCall = calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(webhookCall.body!)).toMatchObject({
      url: "https://dm.test/webhook", secret: "test-webhook-secret", profileIds: ["prof1"],
      events: ["comment.received", "message.received", "message.sent"],
    });
    expect(webhookCall.headers.get("Authorization")).toBe("Bearer sk_test");
  });

  it("updates the existing webhook on a re-run", async () => {
    await seedConnectedAccount();
    const calls = stubGlobalFetch(zernioAccounts([ACCOUNT]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(((await res.json()) as { webhookId: string }).webhookId).toBe("wh-1");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  it("explains what to do when no Instagram account is connected in Zernio", async () => {
    stubGlobalFetch(zernioAccounts([]));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("zernio.com");
    expect(await getSetting(testEnv.DB, "zernio_account_id")).toBeNull();
  });

  it("asks which account to use when several are connected, then uses the chosen one", async () => {
    const second = { ...ACCOUNT, _id: "acc2", profileId: "prof2", username: "brand" };
    stubGlobalFetch(zernioAccounts([ACCOUNT, second]));
    const ask = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(ask.status).toBe(409);
    expect(((await ask.json()) as { accounts: unknown[] }).accounts).toHaveLength(2);

    const chosen = await adminRequest("/setup", { method: "POST", body: JSON.stringify({ accountId: "acc2" }) });
    expect(chosen.status).toBe(200);
    expect(await getSetting(testEnv.DB, "zernio_profile_id")).toBe("prof2");
  });

  it("returns 502 with Zernio's message when the API key is wrong", async () => {
    stubGlobalFetch(() => jsonResponse({ error: "Unauthorized" }, 401));
    const res = await adminRequest("/setup", { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Unauthorized");
  });
});

describe("rules", () => {
  it("creates a rule with a tracked link", async () => {
    const res = await adminRequest("/rules", {
      method: "POST",
      body: JSON.stringify({ ...minimal, link_url: "https://example.com/guide" }),
    });
    expect(res.status).toBe(201);
    const rule = (await res.json()) as { id: number; link_id: number; active: boolean };
    expect(rule.active).toBe(true);
    expect((await getLinkById(testEnv.DB, rule.link_id))?.target_url).toBe("https://example.com/guide");
    expect((await (await adminRequest("/rules")).json()) as unknown[]).toHaveLength(1);
  });

  it("returns 400 with the validation error", async () => {
    const res = await adminRequest("/rules", { method: "POST", body: JSON.stringify({ ...minimal, keywords: ["🔥"] }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("emoji-only");
  });

  it("pauses a rule and swaps its link", async () => {
    const created = (await (await adminRequest("/rules", { method: "POST", body: JSON.stringify(minimal) })).json()) as { id: number };
    const res = await adminRequest(`/rules/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false, link_url: "https://example.com/new" }),
    });
    const rule = (await res.json()) as { active: boolean; link_id: number };
    expect(rule.active).toBe(false);
    expect((await getLinkById(testEnv.DB, rule.link_id))?.target_url).toBe("https://example.com/new");
  });

  it("returns 404 for an unknown rule and 400 for a bad id", async () => {
    expect((await adminRequest("/rules/99999", { method: "PATCH", body: "{}" })).status).toBe(404);
    expect((await adminRequest("/rules/abc", { method: "PATCH", body: "{}" })).status).toBe(400);
  });
});

describe("GET /admin/media", () => {
  it("explains how to set up when Zernio isn't linked yet", async () => {
    const res = await adminRequest("/media");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("setup");
  });

  it("lists recent posts through Zernio", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ posts: [{ id: "m1", message: "Reel", createdTime: "2026-09-01T00:00:00Z" }] }));
    const res = await adminRequest("/media");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "m1", caption: "Reel", mediaType: null, timestamp: "2026-09-01T00:00:00Z", permalink: null }]);
  });

  it("returns 502 with Zernio's message when it errors", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ error: "Token expired", code: "TOKEN_EXPIRED" }, 401));
    const res = await adminRequest("/media");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Token expired");
  });
});

describe("GET /admin/actions/recent", () => {
  it("lists the newest actions first", async () => {
    for (const igsid of ["u1", "u2"]) {
      await enqueueAction(testEnv.DB, {
        triggerId: null, contactIgsid: igsid, sendAt: 1, payload: { kind: "dm", conversationId: `conv-${igsid}`, message: { text: "x" } },
      }, 1);
    }
    const list = (await (await adminRequest("/actions/recent")).json()) as { contact_igsid: string }[];
    expect(list.map((a) => a.contact_igsid)).toEqual(["u2", "u1"]);
  });
});
```

In `test/rule-input.test.ts`, no change is needed: `opening_text` stays ≤ 640 to be safe for all Instagram clients.

- [ ] **Step 8: Run the suite and confirm it fails**

Run: `npx vitest run`
Expected: many failures: the old `src/*` still imports the deleted `instagram.ts` / `auth.ts`, and the old payload shapes and missing functions don't match the new tests.

- [ ] **Step 9: Implement the Worker changes**

`src/account.ts` (full file):
```ts
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { createZernioClient, type ZernioClient } from "./zernio";

/** The Zernio client for the linked Instagram account, or null until `npm run cli -- setup`. */
export async function zernioFromSettings(env: AppEnv): Promise<ZernioClient | null> {
  const accountId = await getSetting(env.DB, "zernio_account_id");
  if (!accountId || !env.ZERNIO_API_KEY) return null;
  return createZernioClient({ apiKey: env.ZERNIO_API_KEY, accountId });
}
```

`src/actions.ts` (full file):
```ts
import type { ActionRow } from "./db/actions";
import type { ZernioClient } from "./zernio";

/** Sends one queued action. Returns the id of what was created (message or comment). */
export async function executeAction(zernio: ZernioClient, action: ActionRow): Promise<string | null> {
  const payload = action.payload;
  // Idempotency keys make Zernio replay instead of re-sending if we retry after a lost response.
  const key = `action-${action.id}`;
  switch (payload.kind) {
    case "private_reply":
      return (await zernio.privateReply(payload.mediaId, payload.commentId, payload.text)).messageId;
    case "public_reply":
      return (await zernio.replyToComment(payload.mediaId, payload.commentId, payload.text, key)).commentId;
    case "dm":
      return (await zernio.sendDm(payload.conversationId, payload.message, key)).messageId;
  }
}
```

`src/scheduler.ts` (full file):
```ts
import { zernioFromSettings } from "./account";
import { executeAction } from "./actions";
import {
  claimActionById, claimDueActions, failStuckActions, markDropped, markFailed, markRetry, markSent, type ActionRow,
} from "./db/actions";
import { getTrigger } from "./db/events";
import type { AppEnv } from "./env";
import { MINUTE, isPrivateReplyExpired, retryDelayMs } from "./time";
import { ZernioError, type ZernioClient } from "./zernio";

/** Comment replies per run (the cron runs every minute): 720/hour, under Meta's 750/hour cap. */
export const COMMENT_REPLY_BUDGET = 12;
/** Keeps a run well under Zernio's free-plan limit of 60 API calls a minute. */
const DM_BATCH = 20;
const STUCK_AFTER_MS = 10 * MINUTE;

export interface SchedulerReport {
  sent: number;
  retried: number;
  failed: number;
  dropped: number;
  skippedNoToken: boolean;
}

const emptyReport = (): SchedulerReport => ({ sent: 0, retried: 0, failed: 0, dropped: 0, skippedNoToken: false });

export async function runScheduler(
  env: AppEnv, now: number, deps: { zernio?: ZernioClient } = {},
): Promise<SchedulerReport> {
  const report = emptyReport();
  await failStuckActions(env.DB, now - STUCK_AFTER_MS);

  const zernio = deps.zernio ?? (await zernioFromSettings(env));
  if (!zernio) {
    report.skippedNoToken = true;
    return report;
  }

  const due = [
    ...(await claimDueActions(env.DB, now, ["private_reply", "public_reply"], COMMENT_REPLY_BUDGET)),
    ...(await claimDueActions(env.DB, now, ["dm"], DM_BATCH)),
  ];
  for (const action of due) await processSafely(env, zernio, action, now, report);
  return report;
}

/** Sends one queued action right away (e.g. the link after someone replies). */
export async function sendActionNow(
  env: AppEnv, actionId: number, now: number, deps: { zernio?: ZernioClient } = {},
): Promise<boolean> {
  const zernio = deps.zernio ?? (await zernioFromSettings(env));
  if (!zernio) return false;
  const action = await claimActionById(env.DB, actionId, now);
  if (!action) return false; // the scheduler already has it
  const report = emptyReport();
  await processSafely(env, zernio, action, now, report);
  return report.sent === 1;
}

async function processSafely(
  env: AppEnv, zernio: ZernioClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  try {
    await processAction(env, zernio, action, now, report);
  } catch (err) {
    // A failed bookkeeping write on one row must not strand the rest of the batch.
    // The row stays 'sending' and is failed by failStuckActions, never resent.
    console.error(JSON.stringify({ scheduler: "action error", actionId: action.id, error: String(err) }));
  }
}

async function processAction(
  env: AppEnv, zernio: ZernioClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  if (action.type === "private_reply" && action.trigger_id !== null) {
    const trigger = await getTrigger(env.DB, action.trigger_id);
    if (trigger?.comment_at != null && isPrivateReplyExpired(trigger.comment_at, now)) {
      await markDropped(env.DB, action.id, "comment is older than 7 days");
      report.dropped++;
      return;
    }
  }

  let mid: string | null;
  try {
    mid = await executeAction(zernio, action);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = err instanceof ZernioError ? err.transient : true;
    const delay = transient ? retryDelayMs(action.attempts) : null;
    if (delay !== null) {
      await markRetry(env.DB, action.id, now + delay, message);
      report.retried++;
    } else {
      await markFailed(env.DB, action.id, message);
      report.failed++;
    }
    return;
  }
  // Outside the send's try: the message is already delivered, so a failed write
  // here must never be treated as a send failure and retried.
  await markSent(env.DB, action.id, mid, now);
  report.sent++;
}
```

`src/webhook/handle.ts` (full file):
```ts
import { enqueueAction, enqueueActionOnce } from "../db/actions";
import { upsertContact } from "../db/contacts";
import { claimAwaitingTriggers, findTriggerId, insertTrigger, isProcessed, markProcessed } from "../db/events";
import { getLinkById } from "../db/links";
import { getRule, listActiveRules, type RuleRow } from "../db/rules";
import { getSetting } from "../db/settings";
import type { AppEnv } from "../env";
import { trackedUrl } from "../links";
import { fillTemplate, findMatchingRule } from "../rules";
import { sendActionNow } from "../scheduler";
import { DAY, openingSendAt } from "../time";
import type { WebhookEvent } from "./parse";

type CommentEvent = Extract<WebhookEvent, { kind: "comment" }>;
type MessageEvent = Extract<WebhookEvent, { kind: "message" }>;

export interface HandleOptions {
  now: number;
  random?: () => number;
  /** Runs work after the webhook is acknowledged (ctx.waitUntil); Zernio wants a reply within 5 s. */
  defer: (task: Promise<unknown>) => void;
}

const LINK_WINDOW_MS = 7 * DAY;
const DEFAULT_LINK_TEXT = "Here you go 👇";

export async function handleEvent(env: AppEnv, event: WebhookEvent, options: HandleOptions): Promise<void> {
  const key = `event:${event.eventId}`;
  if (await isProcessed(env.DB, key)) return;
  if (event.kind === "comment") await handleComment(env, event, options);
  if (event.kind === "message") await handleMessage(env, event, options);
  // Echoes feed the milestone 2 inbox. Marked last: if anything above throws, Zernio
  // redelivers (same event id) and the retry only fills in what the failed attempt missed.
  await markProcessed(env.DB, key, options.now);
}

async function handleComment(env: AppEnv, event: CommentEvent, options: HandleOptions): Promise<void> {
  const ownUsername = await getSetting(env.DB, "ig_username");
  const byCreator =
    event.isOwn || (ownUsername !== null && event.fromUsername?.toLowerCase() === ownUsername.toLowerCase());
  if (byCreator) return;
  const rule = findMatchingRule(await listActiveRules(env.DB), event.text, event.mediaId, "comment");
  if (rule) await triggerCommentRule(env, rule, event, options);
}

async function triggerCommentRule(
  env: AppEnv, rule: RuleRow, event: CommentEvent, { now, random = Math.random }: HandleOptions,
): Promise<void> {
  await upsertContact(env.DB, { igsid: event.fromId, username: event.fromUsername }, now);
  const triggerId =
    (await insertTrigger(env.DB, {
      rule_id: rule.id, contact_igsid: event.fromId, media_id: event.mediaId, source: "comment",
      comment_id: event.commentId, comment_at: now, created_at: now,
      // Instagram refuses buttons in a private reply to non-followers, so the opening DM is plain
      // text asking them to reply; the link follows once they do (handleMessage).
      link_state: rule.link_id === null ? "none" : "awaiting_reply",
    })) ?? (await findTriggerId(env.DB, rule.id, event.fromId, event.mediaId));
  if (triggerId === null) throw new Error(`trigger for rule ${rule.id} vanished`);

  // enqueueActionOnce keeps one of each per trigger, so repeat comments and
  // redeliveries never queue a second DM or reply.
  const sendAt = openingSendAt(now, random);
  if (rule.public_replies.length > 0) {
    const text = rule.public_replies[Math.floor(random() * rule.public_replies.length)]!;
    await enqueueActionOnce(env.DB, {
      triggerId, contactIgsid: event.fromId, sendAt,
      payload: { kind: "public_reply", mediaId: event.mediaId, commentId: event.commentId, text },
    }, now);
  }
  await enqueueActionOnce(env.DB, {
    triggerId, contactIgsid: event.fromId, sendAt,
    payload: {
      kind: "private_reply", mediaId: event.mediaId, commentId: event.commentId,
      text: fillTemplate(rule.opening_text, { name: event.fromUsername ?? "there" }),
    },
  }, now);
}

async function handleMessage(env: AppEnv, event: MessageEvent, options: HandleOptions): Promise<void> {
  // Replying opened the conversation, so buttons are allowed now: send each waiting link.
  const triggers = await claimAwaitingTriggers(env.DB, event.senderId, options.now - LINK_WINDOW_MS);
  for (const trigger of triggers) {
    const rule = await getRule(env.DB, trigger.rule_id);
    const link = rule?.link_id != null ? await getLinkById(env.DB, rule.link_id) : null;
    if (!rule || !link) continue;
    const actionId = await enqueueAction(env.DB, {
      triggerId: trigger.id, contactIgsid: event.senderId, sendAt: options.now,
      payload: {
        kind: "dm",
        conversationId: event.conversationId,
        message: {
          text: rule.link_text || DEFAULT_LINK_TEXT,
          buttons: [{ type: "web_url", title: rule.button_label, url: trackedUrl(env.PUBLIC_URL, link.code, event.senderId) }],
        },
      },
    }, options.now);
    // Queued first, then sent at once; if the immediate send fails or never runs,
    // the minute scheduler picks the queued action up.
    options.defer(sendActionNow(env, actionId, options.now));
  }
}
```

`src/setup.ts` (full file):
```ts
import { deleteSetting, getSetting, setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { listInstagramAccounts, upsertWebhook, type ZernioAccount } from "./zernio";

export type SetupResult =
  | { ok: true; username: string | null; accountId: string; webhookId: string }
  | { ok: false; error: string; accounts?: ZernioAccount[] };

/** Links the Instagram account connected in Zernio and points Zernio's webhook at this Worker. */
export async function runSetup(
  env: AppEnv, requestedAccountId: string | null, fetchFn?: typeof fetch,
): Promise<SetupResult> {
  const accounts = await listInstagramAccounts(env.ZERNIO_API_KEY, fetchFn);
  if (accounts.length === 0) {
    return {
      ok: false,
      error: "No Instagram account is connected in Zernio yet. Connect it at zernio.com (choose Instagram login), then run setup again.",
    };
  }
  const account = requestedAccountId
    ? accounts.find((a) => a.id === requestedAccountId)
    : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) {
    return {
      ok: false,
      error: requestedAccountId
        ? "That id isn't one of the Instagram accounts connected in Zernio."
        : "Several Instagram accounts are connected in Zernio. Run setup again with the id of the one to use.",
      accounts,
    };
  }

  const webhookId = await upsertWebhook(env.ZERNIO_API_KEY, {
    webhookId: await getSetting(env.DB, "zernio_webhook_id"),
    url: `${env.PUBLIC_URL}/webhook`,
    secret: env.ZERNIO_WEBHOOK_SECRET,
    profileId: account.profileId,
  }, fetchFn);

  await setSetting(env.DB, "zernio_account_id", account.id);
  await setSetting(env.DB, "zernio_profile_id", account.profileId);
  await setSetting(env.DB, "zernio_webhook_id", webhookId);
  if (account.username) await setSetting(env.DB, "ig_username", account.username);
  else await deleteSetting(env.DB, "ig_username");
  return { ok: true, username: account.username, accountId: account.id, webhookId };
}
```

`src/health.ts` (full file):
```ts
import { countActions } from "./db/actions";
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { DAY } from "./time";

export interface Health {
  connected: boolean;
  username: string | null;
  webhookRegistered: boolean;
  lastWebhookAt: number | null;
  pendingActions: number;
  failedLast24h: number;
}

export async function getHealth(env: AppEnv, now: number): Promise<Health> {
  const [accountId, username, webhookId, lastWebhookAt, pendingActions, failedLast24h] = await Promise.all([
    getSetting(env.DB, "zernio_account_id"),
    getSetting(env.DB, "ig_username"),
    getSetting(env.DB, "zernio_webhook_id"),
    getSetting(env.DB, "last_webhook_at"),
    countActions(env.DB, "pending"),
    countActions(env.DB, "failed", now - DAY),
  ]);
  return {
    connected: accountId !== null && Boolean(env.ZERNIO_API_KEY),
    username,
    webhookRegistered: webhookId !== null,
    lastWebhookAt: lastWebhookAt === null ? null : Number(lastWebhookAt),
    pendingActions,
    failedLast24h,
  };
}
```

`src/admin.ts` (full file):
```ts
import { Hono, type Context } from "hono";
import { zernioFromSettings } from "./account";
import { recentActions } from "./db/actions";
import { getRule, insertRule, listRules, updateRule, type NewRule } from "./db/rules";
import type { AppEnv } from "./env";
import { getHealth } from "./health";
import { createTrackedLink } from "./links";
import { parseNewRule, parseRulePatch } from "./rule-input";
import { runSetup } from "./setup";
import { constantTimeEqual } from "./webhook/verify";
import { ZernioError } from "./zernio";

export const admin = new Hono<{ Bindings: AppEnv }>();

admin.use("*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  if (!c.env.ADMIN_TOKEN || !constantTimeEqual(header, `Bearer ${c.env.ADMIN_TOKEN}`)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

admin.post("/setup", async (c) => {
  const body = await readJson(c);
  const requested = (body as { accountId?: unknown } | undefined)?.accountId;
  try {
    const result = await runSetup(c.env, typeof requested === "string" ? requested : null);
    return result.ok ? c.json(result) : c.json(result, 409);
  } catch (err) {
    if (err instanceof ZernioError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

admin.get("/health", async (c) => c.json(await getHealth(c.env, Date.now())));

admin.get("/rules", async (c) => c.json(await listRules(c.env.DB)));

admin.post("/rules", async (c) => {
  const parsed = parseNewRule(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { link_url, ...rule } = parsed.value;
  const now = Date.now();
  const link = link_url ? await createTrackedLink(c.env.DB, link_url, rule.name, now) : null;
  return c.json(await insertRule(c.env.DB, { ...rule, link_id: link?.id ?? null }, now), 201);
});

admin.patch("/rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  const parsed = parseRulePatch(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const existing = await getRule(c.env.DB, id);
  if (!existing) return c.json({ error: "rule not found" }, 404);
  const { link_url, ...rest } = parsed.value;
  const patch: Partial<NewRule> = { ...rest };
  if (link_url) patch.link_id = (await createTrackedLink(c.env.DB, link_url, rest.name ?? existing.name, Date.now())).id;
  return c.json(await updateRule(c.env.DB, id, patch));
});

admin.get("/media", async (c) => {
  const zernio = await zernioFromSettings(c.env);
  if (!zernio) return c.json({ error: "Not set up yet. Run: npm run cli -- setup" }, 409);
  try {
    return c.json(await zernio.listPosts());
  } catch (err) {
    if (err instanceof ZernioError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

admin.get("/actions/recent", async (c) => c.json(await recentActions(c.env.DB, 20)));
```

`src/index.ts` (full file):
```ts
import { Hono } from "hono";
import { admin } from "./admin";
import { setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { handleLinkRedirect } from "./links";
import { dataDeletionPage, privacyPage, termsPage } from "./pages";
import { runScheduler } from "./scheduler";
import { handleEvent } from "./webhook/handle";
import { parseWebhook } from "./webhook/parse";
import { verifyZernioSignature } from "./webhook/verify";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  if (!(await verifyZernioSignature(raw, c.req.header("X-Zernio-Signature") ?? null, c.env.ZERNIO_WEBHOOK_SECRET))) {
    // Logged, not stored: unauthenticated requests must not cost D1 writes. Shows up in `wrangler tail`.
    console.warn(JSON.stringify({
      webhook: "rejected",
      reason: "bad signature",
      hint: "ZERNIO_WEBHOOK_SECRET doesn't match the secret registered by `npm run cli -- setup`",
    }));
    return c.text("invalid signature", 401);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("invalid JSON", 400);
  }
  const now = Date.now();
  await setSetting(c.env.DB, "last_webhook_at", String(now));
  const event = parseWebhook(body);
  // Errors propagate as a 500 so Zernio redelivers; handleEvent is idempotent.
  if (event) await handleEvent(c.env, event, { now, defer: (task) => c.executionCtx.waitUntil(task) });
  return c.text("ok");
});

app.get("/l/:code", (c) =>
  handleLinkRedirect(c.env.DB, c.req.param("code"), c.req.query("c") ?? null, Date.now()),
);
app.get("/privacy", (c) => c.html(privacyPage(c.env.CONTACT_EMAIL)));
app.get("/terms", (c) => c.html(termsPage(c.env.CONTACT_EMAIL)));
app.get("/data-deletion", (c) => c.html(dataDeletionPage(c.env.CONTACT_EMAIL)));

app.route("/admin", admin);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduler(env, controller.scheduledTime).then((report) => {
        if (report.sent + report.retried + report.failed + report.dropped > 0) {
          console.log(JSON.stringify({ scheduler: report }));
        }
      }),
    );
  },
} satisfies ExportedHandler<AppEnv>;
```

In `src/webhook/parse.ts`, rename the exported function `parseZernioEvent` to `parseWebhook`, and update `test/zernio-webhook.test.ts` to import and call `parseWebhook`.

In `src/webhook/verify.ts`, delete `handshakeChallenge` and `verifySignature`, which were Meta-only. Keep `hmacSha256Hex`, `constantTimeEqual` and `verifyZernioSignature`.

In `src/pages.ts`, change the privacy page's storage sentence to:
```
<p>Messages are sent and received through Zernio (Zernio Software SL), our Instagram messaging provider,
and stored with Cloudflare. To have your data deleted, see <a href="/data-deletion">data deletion</a>
or email <a href="mailto:${mail}">${mail}</a>.</p>
```

- [ ] **Step 10: Run the suite and typecheck**

Run: `npx wrangler types && npx vitest run && npm run typecheck`
Expected: every test file passes; typecheck exits 0. If `test/public-routes.test.ts`, `test/rules.test.ts`, `test/time.test.ts`, `test/rule-input.test.ts` or `test/cli-core.test.ts` fail, it's only because of imports of deleted modules; fix those imports, not the behaviour.

- [ ] **Step 11: Commit**

```bash
git add -A src test migrations wrangler.jsonc vitest.config.ts worker-configuration.d.ts
git commit -m "feat: run the bot through Zernio with a text-only opening DM"
```

---

### Task 4: Send the link when the commenter replies

**Files:**
- Test: `test/webhook-messages.test.ts`. The behaviour is already implemented by `handleMessage`, `claimAwaitingTriggers` and `sendActionNow` in Task 3. This task adds its end-to-end tests. If a test fails, fix the code in Task 3's files.

**Interfaces:**
- Consumes: `postWebhook`, `stubGlobalFetch`, `seedConnectedAccount`, `commentEvent`, `messageEvent`, `ACCOUNT_ID`.

- [ ] **Step 1: Write the test**

`test/webhook-messages.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionRow } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { DAY, MINUTE } from "../src/time";
import { newRule } from "./factories";
import { commentEvent, messageEvent } from "./fixtures";
import { ACCOUNT_ID, jsonResponse, postWebhook, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv } from "./helpers";

const SENT = () => jsonResponse({ success: true, data: { messageId: "mid-link", conversationId: "conv-1" } });

async function seedLead(overrides: Partial<NewRule> = {}) {
  const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
  const rule = await insertRule(testEnv.DB, newRule({ link_id: link.id, link_text: "Here's your guide 👇", ...overrides }), Date.now());
  await postWebhook(commentEvent());
  return rule;
}

async function linkDms(): Promise<ActionRow[]> {
  const { results } = await testEnv.DB.prepare("SELECT * FROM actions WHERE type = 'dm' ORDER BY id").all<ActionRow>();
  return results;
}

async function linkState(): Promise<string | undefined> {
  return (await testEnv.DB.prepare("SELECT link_state FROM triggers").first<{ link_state: string }>())?.link_state;
}

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /webhook: replies", () => {
  it("sends the link with a button as soon as the commenter replies", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    const before = Date.now();
    await postWebhook(messageEvent({ text: "send it" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://zernio.com/api/v1/inbox/conversations/conv-1/messages");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      accountId: ACCOUNT_ID,
      message: "Here's your guide 👇",
      buttons: [{ type: "url", title: "Get the guide", url: "https://dm.test/l/abc123?c=user-1" }],
    });
    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "sent", sent_mid: "mid-link" });
    expect(dm!.send_at).toBeGreaterThanOrEqual(before);
    expect(await linkState()).toBe("delivered");
  });

  it("uses a default message when the rule has no link text", async () => {
    await seedLead({ link_text: "" });
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent());
    expect(JSON.parse(calls[0]!.body!).message).toBe("Here you go 👇");
  });

  it("sends the link only once when they reply twice", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent({ messageId: "mid-a" }));
    await postWebhook(messageEvent({ messageId: "mid-b" }));
    expect(calls).toHaveLength(1);
    expect(await linkDms()).toHaveLength(1);
  });

  it("sends the link only once when Zernio delivers the reply twice", async () => {
    await seedLead();
    const calls = stubGlobalFetch(SENT);
    const reply = messageEvent();
    await postWebhook(reply);
    await postWebhook(reply);
    expect(calls).toHaveLength(1);
  });

  it("ignores messages from people who aren't waiting for a link", async () => {
    const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
    await insertRule(testEnv.DB, newRule({ link_id: link.id }), Date.now());
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent({ senderId: "stranger" }));
    expect(calls).toHaveLength(0);
    expect(await linkDms()).toHaveLength(0);
  });

  it("keeps the link queued for the scheduler when the immediate send fails", async () => {
    await seedLead();
    stubGlobalFetch(() => jsonResponse({ error: "busy", type: "api_error" }, 503));
    const before = Date.now();
    await postWebhook(messageEvent());
    const [dm] = await linkDms();
    expect(dm).toMatchObject({ status: "pending", attempts: 1 });
    expect(dm!.send_at).toBeGreaterThanOrEqual(before + MINUTE);
    expect(await linkState()).toBe("delivered");
  });

  it("does not send a link for a comment older than 7 days", async () => {
    const link = await insertLink(testEnv.DB, "abc123", "https://example.com/guide", "Guide", Date.now());
    const rule = await insertRule(testEnv.DB, newRule({ link_id: link.id }), Date.now());
    const old = Date.now() - 8 * DAY;
    await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "user-1", media_id: "media-1", source: "comment",
      comment_id: "c-1", comment_at: old, created_at: old, link_state: "awaiting_reply",
    });
    const calls = stubGlobalFetch(SENT);
    await postWebhook(messageEvent());
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `npx vitest run test/webhook-messages.test.ts`
Expected: PASS (7 tests). The behaviour was built in Task 3, so this task is a test-after check. Prove each test can fail with a mutation check: temporarily set `LINK_WINDOW_MS` to `0` in `handle.ts` and confirm the first test fails, then restore it.

- [ ] **Step 3: Commit**

```bash
git add test/webhook-messages.test.ts
git commit -m "test: cover the reply-to-get-link flow end to end"
```

---

### Task 5: CLI `setup` command, docs, deploy and live test

**Files:**
- Modify: `scripts/cli-core.ts`, `scripts/dm-cli.ts`, `test/cli-core.test.ts`, `docs/setup.md`, `docs/examples/go-no-go-rule.json`, `README.md`, `.dev.vars.example`

- [ ] **Step 1: Update the CLI test (failing first)**

In `test/cli-core.test.ts`:
- Replace the `connect` mapping row with:
  ```ts
      [["setup"], { method: "POST", path: "/admin/setup", body: {} }],
      [["setup", "acc2"], { method: "POST", path: "/admin/setup", body: { accountId: "acc2" } }],
  ```
- Add this row to the rejects table:
  ```ts
      [["connect"], 'unknown command "connect"'],
  ```

Run: `npx vitest run test/cli-core.test.ts`
Expected: FAIL. `setup` is unknown, and `connect` still maps.

- [ ] **Step 2: Implement**

In `scripts/cli-core.ts`:
- Replace the `case "connect":` branch with:
  ```ts
      case "setup":
        return request("POST", "/admin/setup", sub === undefined ? {} : { accountId: sub });
  ```
- In `USAGE`, replace the `connect` line with:
  ```
    setup [accountId]                     Link your Zernio Instagram account and register the webhook
  ```

In `scripts/dm-cli.ts`, delete the `/admin/auth/start` special case: the whole `if (response.ok && path === "/admin/auth/start" ...) { ... }` block.

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 3: Rewrite `docs/setup.md` for Zernio**

Full file:
````markdown
# Setup

You need:
- an Instagram **Business or Creator** account
- a second Instagram account for testing
- a free Cloudflare account
- a free Zernio account
- Node.js 24+, with `npm install` run once in this folder

Commands are for Git Bash. **Secrets:** `npx wrangler secret put NAME` asks for the value. If that prompt hangs in Git Bash, pipe the value in instead: `printf '%s' 'the-value' | npx wrangler secret put NAME`.

## 1. Cloudflare (one time)

1. Run `npx wrangler login`.
2. Create the database: `npx wrangler d1 create dm-automation`, then copy the printed `database_id` into `wrangler.jsonc`.
3. Deploy: `npm run deploy`. In `wrangler.jsonc`, set `PUBLIC_URL` to the printed `workers.dev` URL and `CONTACT_EMAIL` to your address, then deploy again.
4. Set the secrets (both are random values you generate):
   - `ADMIN_TOKEN`
   - `ZERNIO_WEBHOOK_SECRET`

   Generate each with `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`.
5. Copy `.env.example` to `.env`, then fill in `DM_WORKER_URL` and `DM_ADMIN_TOKEN`.

## 2. Zernio

1. Sign up at zernio.com (free, no card needed).
2. Connect your Instagram account and choose **Instagram login**. No Facebook is needed.
3. Create an API key under Dashboard → API keys, then run `npx wrangler secret put ZERNIO_API_KEY`.

## 3. Link them

1. Apply any new database changes: `npx wrangler d1 migrations apply dm-automation --remote`
2. Deploy: `npm run deploy`
3. Link: `npm run cli -- setup`. It prints your Instagram username and the webhook id. If several accounts are connected, it lists them. Run `npm run cli -- setup <id>` with the one to use.
4. Check: `npm run cli -- health` should show `"connected": true` and `"webhookRegistered": true`.

## 4. Test rule and live test

1. Run `npm run cli -- media` and copy the `id` of the post you'll test on.
2. Copy `docs/examples/go-no-go-rule.json` to `rule.json`, replace `<MEDIA_ID>` with that id, then run `npm run cli -- rules add --file rule.json`.
3. From the **second account**, comment `guide` on that post.
4. Within about 1–2 minutes, check that:
   - a public reply appears under the comment
   - a DM arrives (in Requests, if the second account doesn't follow you) asking them to reply
5. Reply to that DM from the second account. The **Open the guide** button should arrive within seconds.
6. Tap it. `npm run cli -- actions` should show every action as `sent`.

**If nothing happens:**
- If `npm run cli -- health` still shows `lastWebhookAt: null`, open Zernio's dashboard → Webhooks → logs. Failed deliveries show there with the response the Worker gave.
- Run `npx wrangler tail`, then comment again:
  - `"webhook":"rejected"` means the secrets don't match. Run `npm run cli -- setup` again.
  - Anything else showing errors: send it to Claude.
- If `npm run cli -- actions` shows `failed` with an Instagram reason, that reason is quoted there. Send it to Claude.
````

`docs/examples/go-no-go-rule.json`:
```json
{
  "name": "Go/no-go test",
  "keywords": ["guide"],
  "scope": ["<MEDIA_ID>"],
  "public_replies": ["Sent! Check your DMs 👀", "Just sent it 🙌"],
  "opening_text": "Hey {name}! 👋 Reply to this message with anything and I'll send you the guide.",
  "link_text": "Here's your guide 👇",
  "button_label": "Open the guide",
  "link_url": "https://example.com"
}
```

`README.md`: change the first paragraph to:
```
Self-hosted, $0/month Instagram comment-to-DM automation on Cloudflare Workers — a ManyChat replacement
for one creator account, connected to Instagram through Zernio (no Facebook needed). Replies to DMs are
drafted with Claude Code (`/dms`, milestone 2) and sent only after you approve them.
```

`.dev.vars.example`:
```
# For `npm run dev` (wrangler dev). Copy to .dev.vars (never committed).
ZERNIO_API_KEY=
ZERNIO_WEBHOOK_SECRET=
ADMIN_TOKEN=
```

- [ ] **Step 4: Commit**

```bash
git add scripts test/cli-core.test.ts docs README.md .dev.vars.example
git commit -m "feat: add setup command and Zernio setup guide"
```

- [ ] **Step 5: Deploy and link (Claude runs these; the user has already set `ZERNIO_API_KEY`)**

```bash
printf '%s' "$(node -e "console.log(crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''))")" | npx wrangler secret put ZERNIO_WEBHOOK_SECRET
npx wrangler d1 migrations apply dm-automation --remote
npm run deploy
npm run cli -- setup
npm run cli -- health
```
Expected:
- the migration applies `0003_link_state.sql`
- `setup` prints `"ok": true` with the username
- `health` shows `connected` and `webhookRegistered` as true

If `setup` returns 409 with no accounts, the user still needs to connect Instagram in Zernio.

- [ ] **Step 6: Live test with the user (section 4 of `docs/setup.md`) and record the result**

Append a `## Live test result (YYYY-MM-DD)` section to `docs/setup.md` covering what arrived, the timings, and any `actions` errors. Also record what `message.sent` echoes looked like for a DM typed in the Instagram app, which milestone 2 needs. Commit it with `git commit -m "docs: record live test result"`.
