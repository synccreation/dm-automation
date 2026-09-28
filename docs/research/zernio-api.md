# Zernio API reference (for the Instagram comment-to-DM bot)

Researched 2026-09-28 from the live docs. The primary sources are the OpenAPI spec and the docs site:

- OpenAPI spec: https://zernio.com/openapi.yaml (`info.version: "1.142.0"`, OpenAPI 3.1, about 3.5 MB). This is the authoritative source for shapes.
- LLM index: https://docs.zernio.com/llms.txt, with the full dump at https://docs.zernio.com/llms-full.txt.
- Every docs page is also served as raw MDX at `https://docs.zernio.com/<path>.mdx`.

Scope: one creator's Instagram professional account, connected with Instagram Login (no Facebook Page), replacing direct Meta Graph calls from a Cloudflare Worker.

Where a JSON example is marked "verbatim", it is copied from the docs. Where it is marked "from spec YAML", it was converted field for field from the spec's `examples:` block. Anything that is not a doc quote is labelled **inference** or listed in section 9.

Zernio was formerly "Late" (getlate). That is why the legacy header aliases below are `X-Late-*`.

---

## 0. Key findings (read first)

1. **Webhooks.** Endpoints are created by API (`POST /v1/webhooks/settings`) or in the dashboard.
   - **Signature:** `X-Zernio-Signature` is the lowercase hex HMAC-SHA256 of the raw body, keyed by a secret that *you* supply. No timestamp is signed.
   - **Dedupe:** use the stable event id in `payload.id`, which is also sent as the `X-Zernio-Event-Id` header.
   - **Delivery:** at least once, up to 7 attempts spread over about 51 h. You must return 2xx within 5 s.
2. **Relevant events:**
   - `comment.received` (real time for Instagram)
   - `message.received`, which carries DMs, story replies (`metadata.storyReply`), story mentions (`metadata.isStoryMention`), postback taps (`metadata.postbackPayload` / `postbackTitle`), quick-reply taps (`metadata.quickReplyPayload`) and referrals
   - `message.sent`, which covers outgoing messages, including echoes (see section 9)
   - `message.read` (Instagram supported)
   - `message.edited`, `message.deleted`, `reaction.received`, `referral.received`, `conversation.started`
   - `account.connected` / `account.disconnected`
   - `message.delivered` is **not** emitted for Instagram.
3. **Private reply:** `POST /v1/inbox/comments/{postId}/{commentId}/private-reply`.
   - It supports 1-3 `buttons` (`url` or `postback`, sent via Meta's `button_template`) or up to 13 `quickReplies`, but not both.
   - **Since late August 2026, Instagram refuses buttons, cards and attachments in a private reply to a commenter who does not follow the account.** The call fails with a non-retryable 400 (Meta code 2, subcode 1545133), and the failed call **still consumes the comment's single private reply**.
   - Zernio's own advice: send plain text to non-followers, and add buttons once they reply.
   - The follow status of a first-time commenter is usually unknowable, because Meta reveals it only for users who have messaged the account.
4. **Built-in automation:** Zernio has server-side comment-to-DM automations (`/v1/comment-automations`). They support:
   - keywords, with `contains` / `word` / `exact` matching, exclusions and typo tolerance
   - `dmDelaySeconds` and `commentReplyDelaySeconds` (0-86400)
   - public-reply text plus up to 5 random variants
   - DM text variants
   - `url` / `postback` buttons or a product-card template
   - link click tracking
   - follower gating (`audience` plus a `followGate` "I'm following" confirm button)
   - story-reply triggers, and `alsoMatchInDms`
   - logs and stats

   Together these cover most of our milestone-1 trigger logic. They inherit the same non-follower button restriction, however, and the interaction between the follow gate and that restriction is undocumented (section 6).
5. **Free plan and metering:** 2 connected accounts are free, with 60 API requests per minute. Outbound messages are metered starting 1 Oct 2026: 10,000 per month free per team, then $1 per 10,000. Without a card on file, the send that would pass 10,000 fails with a 403 (`message_allowance_exceeded`). Comment replies are not metered.

---

## 1. Auth, base URL and versioning

| Fact | Value | Source |
|---|---|---|
| Base URL | `https://zernio.com/api/v1`. The spec server is `https://zernio.com/api` and paths start with `/v1/...`. | https://docs.zernio.com/ (Quickstart); openapi.yaml `servers` |
| Auth header | `Authorization: Bearer <key>` | Quickstart; spec `securitySchemes.bearerAuth` (http bearer) |
| Key format | "A key is `sk_` followed by 64 hex characters (67 in total)". Zernio stores only a SHA-256 hash, so the key is shown once. | https://docs.zernio.com/ (Quickstart) |
| Restricted keys | A key with any resource group disabled is minted with the `zrk_` prefix. It gets a 403 `insufficient_permissions` (with `required_group`) on operations in a disabled group. Each operation's group is published as `x-resource-group` (for example `messages`, `engagement`, `webhooks`, `accounts`). | llms-full.txt (API keys pages); https://docs.zernio.com/guides/error-handling |
| Key creation | Dashboard at https://zernio.com/dashboard/api-keys, or via the API-keys endpoints | Quickstart |
| SDK env var | `ZERNIO_API_KEY` (packages `@zernio/node` and `zernio-sdk` for Python) | Quickstart |
| Versioning | "all endpoints are versioned in the URL path (current version: /v1). Breaking changes only ship in a new path version". Deprecations are marked `deprecated: true` and announced in the changelog. | openapi.yaml `info.description`; https://docs.zernio.com/changelog |
| Request id | Responses carry an `X-Request-Id` header. "A valid x-request-id you send is reused as that id." | openapi.yaml `info.description` |
| Unknown params | "Unknown keys are dropped instead of rejected". Use camelCase: `profile_id` is silently ignored. | https://docs.zernio.com/guides/error-handling |

The second auth scheme, `X-Connect-Token`, is a short-lived (15 min) token that only the OAuth selection endpoints accept. We do not need it (openapi.yaml `securitySchemes.connectToken`).

---

## 2. Connecting the Instagram account

### Profiles

- A profile groups accounts. Every team starts with a profile named "Default", and every connected account lives in exactly one profile.
- **A profile holds at most one account per platform.** Starting the connect flow again for Instagram on the same profile *replaces* the existing connection.
- Profiles are free.
- `POST /v1/profiles` with `{"name": ...}` returns 201. The response is verbatim:

  ```json
  { "message": "Profile created successfully", "profile": { "_id": "66a1f0c2a4b9d3e8f1a2b3c4", "name": "My first profile" } }
  ```

- Every id is a 24-character string in an `_id` field.

Sources: https://docs.zernio.com/guides/profiles and https://docs.zernio.com/ (Quickstart).

### Connect flow via the API

`GET /v1/connect/instagram?profileId=<id>&redirect_url=<abs url>&loginMethod=instagram_login` returns 200:

```json
{ "authUrl": "https://www.facebook.com/v21.0/dialog/oauth?client_id=...", "state": "user123-profile456-1234567890-https://yourdomain.com/callback" }
```

The shape above is from the spec example. That example shows a Facebook dialog URL; for `instagram_login` the URL is presumably Instagram's own dialog, which we did not verify.

- **`loginMethod`** is `instagram_login` (the default) or `facebook_login`. The spec says: "`instagram_login` (the default...): the Instagram Login dialog. The user authorizes their Instagram professional account directly, no Facebook Page required." "The default `instagram_login` has no selection step, so it connects the account directly."
- **Success redirect:** `redirect_url` receives `connected=instagram&profileId=...&accountId=...&username=...`, plus `request_id` and `stage`.
- **Failure redirect:** `?error=<slug>&platform=instagram` plus optional `error_message`, `is_user_fixable`, `error_reason` and `platform_error*`. Unknown slugs must be treated as generic failures.
- **Login-method mismatch:** `instagram_login_method_mismatch` means an Instagram Login authorization landed on a profile whose Instagram account is connected through Facebook Login.
- **Omitted `redirect_url`:** the flow returns to the Zernio dashboard. The spec says "(or the dashboard when omitted)".
- **402 `PAYMENT_REQUIRED`:** returned with `reason: free_tier_exceeded` when a team without a card on file would exceed 2 accounts.

Sources: https://docs.zernio.com/connect/get-connect-url, https://docs.zernio.com/guides/connecting-accounts and https://docs.zernio.com/platforms/instagram#connect.

### Instagram Login scopes

| Scope | What it enables |
|---|---|
| `instagram_business_basic` | Account identity |
| `instagram_business_content_publish` | Publishing |
| `instagram_business_manage_insights` | Insights |
| `instagram_business_manage_comments` | "Read and reply to comments" |
| `instagram_business_manage_messages` | "Instagram DMs in the inbox" |

The account must be Business or Creator. Features that require Facebook Login are catalog audio, the paid-partnership label and comment likes. **Comments and the inbox work with either login method.**

Source: https://docs.zernio.com/platforms/instagram.

### Dashboard connection

The docs show dashboard usage only indirectly:

- the "Platforms" heading with a profile switcher (https://docs.zernio.com/guides/profiles)
- `.../dashboard/connections` appearing in a spec state example
- "Reconnect from the dashboard" in error tables

The docs contain no step-by-step dashboard connect guide. For a single creator, the API connect URL (or the dashboard) is a one-time manual step either way.

### IDs you get

| ID | Where it comes from | Notes |
|---|---|---|
| `profileId` | `profile._id` | Stable. Zernio recommends routing and scoping webhooks by profile because "an account id changes when the account is reconnected, a profile does not" (https://docs.zernio.com/webhooks) |
| `accountId` | `accounts[]._id`, the `accountId` query param on the connect redirect, or `account.accountId` on `account.connected` | 24-character Zernio id, used in all API bodies. **It changes on reconnect**, so re-read `GET /v1/accounts` after a reconnect |
| Instagram user id (IG business id) | Not exposed on the `SocialAccount` list schema | See section 9 |
| Commenter / DM sender id | `comment.author.id` or `message.sender.id` | The Instagram-scoped id (IGSID). Follow status accepts it (https://docs.zernio.com/accounts/get-instagram-follow-status) |

### Listing accounts

`GET /v1/accounts?profileId=&platform=instagram&status=connected|disconnected` (plus optional `page` and `limit`, which must be sent together).

- Required response fields: `accounts[]` (`_id`, `platform`, `profileId`, `isActive`) and `hasAnalyticsAccess`.
- Optional fields include `username`, `displayName`, `profilePicture`, `profileUrl`, `needsReconnection`, `enabled` and `metadata`.
- For Instagram, `metadata.loginMethod` is `"facebook_login"` only for accounts connected through Facebook Login; it is absent for Instagram Login accounts.

Example, from spec YAML:

```json
{ "accounts": [ { "_id": "64e1...", "platform": "twitter", "profileId": { "_id": "64f0...", "name": "My Brand", "slug": "my-brand" }, "username": "@acme", "displayName": "Acme", "profileUrl": "https://x.com/acme", "isActive": true } ], "hasAnalyticsAccess": false }
```

Health checks: `GET /v1/accounts/health` and `GET /v1/accounts/{accountId}/health` return `tokenValid`, `needsReconnect` and `issues`.

Sources: https://docs.zernio.com/accounts/list-accounts and https://docs.zernio.com/guides/error-handling.

**Replayed history on connect.** When the account connects, Zernio replays up to 500 conversations and 500 messages per conversation from Meta. **The replay fires no webhooks** and is stored as already read (https://docs.zernio.com/platforms/instagram#webhooks and https://docs.zernio.com/webhooks/inbox).

---

## 3. Webhooks

### 3.1 Registering an endpoint

You can register by API or in the dashboard at https://zernio.com/dashboard/webhooks. Limits: at most 50 endpoints per user, and `name` is 1-50 characters.

`POST /v1/webhooks/settings`, example from spec YAML (abridged event list):

```json
{
  "name": "My Production Webhook",
  "url": "https://example.com/webhook",
  "secret": "your-secret-key",
  "events": ["message.received", "message.sent", "message.edited", "message.deleted", "message.delivered", "message.read", "message.failed", "comment.received"],
  "isActive": true
}
```

Optional fields:

- `customHeaders`: an object of string-to-string headers added to every delivery
- `disabledResourceGroups`: for example `["messages","contacts"]`
- `profileIds`: at most 50
- `accountIds`: at most 50

Response (verbatim):

```json
{
  "success": true,
  "webhook": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Production",
    "url": "https://example.com/webhooks/zernio",
    "events": ["post.published", "post.failed", "message.received"],
    "isActive": true,
    "failureCount": 0
  }
}
```

- **The secret is yours.** "The secret Zernio signs deliveries with is the `secret` you send in that call; Zernio never generates one for you."
- **Other operations:**
  - list: `GET /v1/webhooks/settings`
  - update: `PUT /v1/webhooks/settings` with `webhookId` in the body; the deprecated `_id` is still accepted
  - delete: `DELETE /v1/webhooks/settings?webhookId=`
  - test: `POST /v1/webhooks/test` `{"webhookId": "..."}` sends a `webhook.test` event once, synchronously, never retried, and regardless of the subscribed `events`
- **Logs:** `GET /v1/webhooks/logs?status=&event=&webhookId=&eventId=&limit=&skip=` keeps 30 days of logs. Each row includes `attemptNumber`, `statusCode`, `requestPayload` and `responseBody`.
- **Redelivery:** `POST /v1/webhooks/logs/redeliver` with `{"webhookId": "...", "eventId": "..."}` replays the same payload byte for byte, with the same event id, within the 30-day window.
- **Inbox gate:** subscribing to inbox events without inbox access gives a 403 `feature_not_available`. Only legacy AppSumo plans lack the inbox.

Sources: https://docs.zernio.com/webhooks, https://docs.zernio.com/webhooks/create-webhook-settings, https://docs.zernio.com/webhooks/get-webhook-logs, https://docs.zernio.com/webhooks/redeliver-webhook-event and https://docs.zernio.com/webhooks/inbox.

### 3.2 Headers and signature

Delivery request, verbatim (this is a `webhook.test` delivery):

```http
POST /webhooks/zernio HTTP/1.1
Content-Type: application/json
User-Agent: Zernio-Webhooks/1.0
X-Zernio-Event: webhook.test
X-Zernio-Event-Id: 3f0c1c2e-6c4a-4d3e-9b1f-2a7d8e9f0a1b
X-Zernio-Signature: 5d41402abc4b2a76b9719d911017c592e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9
```

```json
{ "id": "3f0c1c2e-6c4a-4d3e-9b1f-2a7d8e9f0a1b", "event": "webhook.test", "message": "This is a test webhook from Zernio", "timestamp": "2027-01-01T17:00:00Z" }
```

- **Signature:** "`X-Zernio-Signature` is the lowercase hex HMAC-SHA256 of the raw request body keyed by that secret; `X-Late-Signature` is the legacy alias with the same value."
- **When deliveries are signed:** "Zernio signs every delivery when the endpoint has a `secret`." Without a secret, no signature is sent.
- **What is signed:** only the raw body. The signature includes no timestamp or nonce, so replay protection is the event-id dedupe.
- **Documented verification:** the docs' Node sample uses `crypto.createHmac("sha256", secret).update(rawBody).digest("hex")` and a string compare. The Python sample uses `hmac.compare_digest`.
- **Worker implementation (inference, not from the docs):** in a Cloudflare Worker, use WebCrypto `crypto.subtle.importKey` / `sign('HMAC', ...)` over `await req.text()`, then compare the hex in constant time.
- **Source IPs and mTLS:** no source IP list and no mTLS are documented. `customHeaders` can add a second shared-secret header.

Source: https://docs.zernio.com/webhooks#signatures.

### 3.3 Delivery, retry and dedupe semantics

- **Timeout:** "Return any `2xx` within 5 seconds." The docs advise persisting the event, returning 2xx, and processing on a background worker (for us, a Queue or `ctx.waitUntil`).
- **Retry schedule:** 7 attempts in total, counting the first. The backoff is exponential, capped at 24 h, and measured from the end of the previous attempt.

  | Attempt | Delay before it | Cumulative |
  |---|---|---|
  | 1 | immediate | 0 |
  | 2 | 10 s | ~10 s |
  | 3 | 1 m 40 s | ~1 m 50 s |
  | 4 | 16 m 40 s | ~18 m 30 s |
  | 5 | 2 h 46 m 40 s | ~3 h 5 m |
  | 6 | 24 h | ~27 h 5 m |
  | 7 | 24 h | ~51 h 5 m |

- **Dead letters:** after the 7th failure the event moves to a dead-letter queue and can be redelivered manually.
- **Queue back-pressure:** "If that queue briefly refuses a delivery ... Zernio parks it and re-sends it to the queue every minute for up to 24 hours". Events can therefore arrive late, but they are not dropped.
- **At least once:** "The same event can arrive twice when a previous attempt's response was lost or your endpoint took longer than 5 seconds to answer, so your handler must be idempotent."
- **Stable event id:** `payload.id` (a UUID) = the `X-Zernio-Event-Id` header = the legacy `X-Late-Event-Id` header. It is "identical on every retry and redelivery". It identifies the event only, never an account or resource.
  - Note: one guide example shows `"id": "evt_5f8e2a1c"`. Treat the id as an opaque string.
- **`timestamp`:** the UTC time the event was generated. It is kept unchanged on retries.
- **Auto-disable:** an endpoint is disabled only after 3 days with no successful delivery **and** either 20 consecutive terminal failures or 3 days of continuous failure. The owner is emailed. Re-enable with `isActive: true`.
- **Content dedupe:** Zernio does not deduplicate by content beyond the stable event id. Dedupe is your job, for example with a KV or D1 unique key on `payload.id`.
- **Account routing:** for `message.*`, `comment.received`, `reaction.received`, `referral.received` and `conversation.*`, the account is `account.accountId` (`account.id` carries the same value).

Source: https://docs.zernio.com/webhooks#how-it-behaves.

### 3.4 Events relevant to Instagram

| Event | Instagram? | Meaning / notes |
|---|---|---|
| `comment.received` | Yes, real time ("Instagram, Facebook and TikTok arrive in real time from the platform's own webhook") | A new comment "on a tracked post". `comment.author.isOwnAccount` flags the account's own replies, which Meta re-delivers as comments. |
| `message.received` | Yes | Inbound DM. Also carries postback and quick-reply taps, story replies, story mentions and referrals in `metadata`. |
| `message.sent` | Yes | Outgoing message. `message.sentVia` shows its origin: `human` / `api` / `broadcast` / `sequence` / `workflow` / `comment_automation` / `bulk-api` / `null`. `null` covers "a message sent from the platform's own app" (see section 9). |
| `message.read` | Yes | An outgoing message was read (Instagram `messaging_seen`) |
| `message.delivered` | **No** | Covers WhatsApp, Messenger, SMS and RCS only. "IG emits no delivery receipt" |
| `message.failed` | **No** | WhatsApp, SMS and RCS only |
| `message.edited` | Yes | Includes `editHistory` |
| `message.deleted` | Yes (incoming unsend only) | Keeps the pre-delete text |
| `reaction.received` | Yes | Accounts connected before August 2026 need a reconnect to receive it |
| `referral.received` | Yes | An ig.me `ref` link opened an existing thread with no message |
| `conversation.started` | Yes | Fires once per conversation, in either direction. Never fires for replayed history |
| `account.connected` / `account.disconnected` | n/a | `disconnectionType` is `intentional` or `unintentional` (token expired or revoked) |

Sources: https://docs.zernio.com/webhooks/inbox, https://docs.zernio.com/platforms (the webhooks table lists Instagram: comment.received Yes, message.received Yes, message.sent Yes, edited Yes, deleted Yes, delivered No, read Yes, failed No) and openapi.yaml `webhooks:`.

"Interactive replies ride on `message.received`": "Zernio delivers button and list taps, flow responses, orders and referrals that arrive with a message under `metadata` on `message.received`" (https://docs.zernio.com/webhooks/inbox#interactive-replies-ride-on-messagereceived).

### 3.5 Payloads

#### `message.received`

Verbatim example from https://docs.zernio.com/multi-tenant/inbox. The guide trims the payload; the full required set is listed below it.

```json
{
  "id": "evt_5f8e2a1c",
  "event": "message.received",
  "message": {
    "id": "66d4a1b2c3e4f5a6b7c8d9e1",
    "conversationId": "66c3d2ae7b4f6c8d0e1f2a3b",
    "platform": "instagram",
    "direction": "incoming",
    "text": "Hi, is this still available?",
    "sender": { "id": "17841400000000000", "name": "Jane", "username": "jane_doe" }
  },
  "conversation": { "id": "66c3d2ae7b4f6c8d0e1f2a3b", "status": "active" },
  "account": { "id": "66b2e19d8c3f5a7e9d0b1c2d", "accountId": "66b2e19d8c3f5a7e9d0b1c2d", "profileId": "66a1f0c2a4b9d3e8f1a2b3c4", "platform": "instagram" },
  "timestamp": "2027-01-04T14:00:03Z"
}
```

Full schema (`WebhookPayloadMessage` in openapi.yaml; https://docs.zernio.com/webhooks/inbox#messagereceived).

Top-level fields, required: `id`, `event`, `message`, `conversation`, `account` and `timestamp`. `metadata` is optional and may be null.

`message` required fields:

- `id`: the internal message id
- `conversationId`: the internal conversation id
- `platform`
- `platformMessageId`: the Instagram `mid`
- `direction`: `incoming` or `outgoing`
- `text`: string or null
- `attachments[]`: `type`, `originalType`, `mimeType`, `url`, `payload`
- `sender`
- `sentAt`: ISO time, millisecond precision on Instagram. Use it as the ordering key
- `isRead`
- `sentVia`: always `null` on this event

`message.sender` fields:

- `id`: the IGSID
- `contactId`, `name`, `username`, `picture`
- `instagramProfile`: `{ isFollower, isFollowing, followerCount, isVerified }`. Each value is a boolean/integer or null. The object is "Only present for Instagram conversations."

`conversation` (`InboxWebhookConversation`):

- `id`: Zernio's internal id
- `platformConversationId`: "on Instagram and Messenger it is the participant's IGSID / PSID ... Also accepted by the conversation endpoints"
- `participantId`, `participantName`, `participantUsername`, `participantPicture`
- `status`: `active` or `archived`
- `contactId`

`account` (`InboxWebhookAccount`): `id`, `accountId`, `profileId`, `platform`, `username` and `displayName`.

`metadata` fields relevant to Instagram (from the spec):

| Field | Type | Meaning |
|---|---|---|
| `postbackPayload` | string | "Payload from a postback button tap (Facebook/Instagram Messenger)." |
| `postbackTitle` | string | "Title of the tapped postback button" |
| `quickReplyPayload` | string | "Payload from a quick reply tap" |
| `storyReply` | `{ storyId (required), storyUrl }` | "Populated when an IG user replies to one of the account's stories (Meta `messaging_story_replies`)". `storyUrl` expires about 24 h after the story posted |
| `isStoryMention` | boolean | The user mentioned the account in their own story. The attachment then arrives as `type: "share"` with `originalType: "story_mention"` |
| `quotedMessageId` | string | Instagram `reply_to.mid` of the message being quote-replied to |
| `referral` | object or null | `ref`, `source`, `type`, `ad_id`, `ads_context_data`. Present on the first message after an ig.me or ad click. "Instagram delivers ig.me refs on new threads only when the account has at least one Ice Breaker configured" |
| `noRenderableContent` | boolean | Meta withheld the content (`is_unsupported`) |

For RCS the docs state that on a button tap "`text` is the button label" (verbatim example on the RCS receiving page):

```json
{ "event": "message.received", "message": { "platform": "rcs", "text": "Change address", "sender": { "id": "+13125550188", "phoneNumber": "+13125550188" }, "metadata": { "postbackPayload": "change_address_4821", "postbackTitle": "Change address" } } }
```

The docs contain no Instagram-specific postback example (section 9).

#### `message.sent`

Schema: `WebhookPayloadMessageSent` (https://docs.zernio.com/webhooks/inbox#messagesent). It has the same outer shape as `message.received`, with these differences:

- **`message.sender` is the business.** Its `id` is the Zernio account id. The docs warn: "Do not read these to name or update a contact". The other party is `conversation.participantId` / `participantName` / `participantUsername`.
- **`message.sentVia` shows which Zernio surface sent the message:**
  - values: `human`, `api`, `broadcast`, `sequence`, `workflow`, `comment_automation`, `bulk-api` or `null`
  - "Always present, and `null` whenever the lineage is unknown: a message sent from the platform's own app, and every message stored before this field shipped (2026-08). ... treat `null` as 'unknown', never as 'sent by a human'."
- **`metadata.metaInteractive`** (Instagram and Facebook only): "The buttons, quickReplies and/or template this outgoing message carried, as sent (tracked urls included when link tracking wrapped a button)."
- **`metadata.quotedMessageId`:** "Not delivered on Instagram echoes ... a reply the operator quoted in the Instagram app arrives with no `quotedMessageId`."

#### `message.read`, `message.delivered` and `message.failed`

Schema: `WebhookPayloadMessageDeliveryStatus`.

- Required: `id`, `event`, `message` (`InboxWebhookMessage`), `statusAt`, `conversation`, `account` and `timestamp`.
- `error` (`code`, `title`, `message`, `details`, `href`, `explanation`) is populated only on `message.failed`.

#### `comment.received`

Schema: `WebhookPayloadComment` (https://docs.zernio.com/webhooks/inbox#commentreceived).

Top-level fields: `id`, `event: "comment.received"` and `timestamp`, plus the `comment`, `post` and `account` objects below.

`comment` fields:

- `id`: the platform comment id
- `postId`: Zernio post id, or null if the post was not published through Zernio
- `platformPostId`: the Instagram media id
- `platform`
- `text`
- `createdAt`
- `isReply` and `parentCommentId` (string or null)
- `ad`: `{ id, title }`, present only on paid content
- `author`:
  - `id`: the IGSID
  - `username`, `name`, `picture`
  - `isOwnAccount`: "True when this comment was authored by the connected account itself ... Absent means not evaluated, never 'not the account'"
  - `instagramProfile`: `{ isFollower, isFollowing, followerCount, isVerified }`. Present **only** for commenters who have messaged the account before

`post` fields:

- `id`
- `platformPostId`
- `content`: "from our synced copy ... null when the post was never synced"
- `imageUrl`
- `permalink`

`account` fields: `id`, `accountId`, `platform` and `username`.

The docs contain no full verbatim JSON example for `comment.received`; the field list above is from the schema.

#### `account.connected` and `account.disconnected`

- `account.connected`: `{ id, event, account: { accountId, profileId, platform, username, displayName }, timestamp }`
- `account.disconnected`: the same shape, plus `account.disconnectionType` and `account.reason`

Source: openapi.yaml `WebhookPayloadAccountConnected` / `...Disconnected`; https://docs.zernio.com/webhooks/accounts.

---

## 4. Sending

### 4a. Private reply to a comment (Meta "private replies")

`POST /v1/inbox/comments/{postId}/{commentId}/private-reply`

- `postId` is the Instagram media id (use `comment.platformPostId`).
- `commentId` is the comment id.
- The resource group is `messages`.

Source: https://docs.zernio.com/comments/send-private-reply-to-comment (spec `sendPrivateReplyToComment`).

**Request body:**

- Required: `accountId` and `message`.
- Optional: `quickReplies` (max 13; each `{title ≤20, payload, imageUrl?}`) **or** `buttons` (1-3). The two are mutually exclusive.
- Button shapes:
  - `{type:"url", title ≤20, url}`
  - `{type:"postback", title ≤20, payload}`
  - `{type:"phone", ...}`, Facebook only

**Rules, quoted from the spec description:**

- "One reply per comment, must be sent within 7 days."
- Buttons are "rendered in the same bubble via Meta's button_template".
- "Chips do not render in the Instagram Message Requests folder" (non-followers' DMs land there). Buttons *are* visible there.
- "**Since late August 2026 Instagram refuses buttons, cards and attachments to commenters who do not follow the account** (Meta code 2, subcode 1545133, returned here as a non-retryable 400 that says so), **and the failed call still consumes the comment's single private reply. To reach non-followers send plain text and add buttons once they reply.**"
- "When the comment's single private reply is spent (by this call or an earlier one) the 400 carries `details.privateReplyConsumed: true`; never retry it."
- The changelog announced this restriction as a "Breaking Change" on 2026-09-02.

**Private replies do not accept an `Idempotency-Key`.** The idempotency guide lists send-inbox-message and reply-to-comment, but not private reply (https://docs.zernio.com/guides/idempotency).

Request examples, from spec YAML:

```json
{ "accountId": "507f1f77bcf86cd799439011", "message": "Hi! Thanks for your comment. I wanted to reach out privately to help with your question." }
```

```json
{ "accountId": "507f1f77bcf86cd799439011", "message": "Thanks for commenting! Want me to send the link?",
  "quickReplies": [ { "title": "Yes, send it", "payload": "SEND_LINK" }, { "title": "No thanks", "payload": "DECLINE" } ] }
```

```json
{ "accountId": "507f1f77bcf86cd799439011", "message": "Thanks for commenting! Tap below to grab the link.",
  "buttons": [ { "type": "url", "title": "Get the link", "url": "https://tribenest.co/landing" },
               { "type": "postback", "title": "Remind me later", "payload": "REMIND_LATER" } ] }
```

**Response 200** (the spec gives a schema only, no example): `{ "status": "success", "messageId": "<string>", "commentId": "<string>", "platform": "instagram" }`.

**Error 400** uses the canonical envelope. Examples from spec YAML:

`followGated` (the reply is consumed):

```json
{
  "error": "Instagram refused this private reply because it carries a card, buttons or an attachment and the commenter does not follow this account. Meta delivers only plain text to non-followers. This attempt consumed the comment's single private reply, so do not retry it; send a text-only private reply to reach non-followers.",
  "type": "platform_error",
  "code": "platform_api_error",
  "platform": "instagram",
  "platformError": { "code": 2, "error_subcode": 1545133, "is_transient": false, "message": "Service temporarily unavailable", "error_user_title": "Your message can't be delivered", "error_user_msg": "You can't send media to Jejum de Daniel unless they follow you." },
  "details": { "privateReplyConsumed": true }
}
```

`alreadyReplied` (Meta subcode 2534023):

```json
{ "error": "A private reply has already been sent to this comment. Instagram only allows one private reply per comment.", "type": "platform_error", "code": "platform_api_error", "platform": "instagram", "details": { "privateReplyConsumed": true } }
```

`commentTooOld`:

```json
{ "error": "The comment is older than 7 days. Instagram only allows private replies within 7 days of the comment being posted.", "type": "platform_error", "code": "platform_api_error", "platform": "instagram" }
```

`declinedByMeta` (subcode 2534066; the reply is **not** consumed, but retrying does not help):

```json
{ "error": "Instagram declined this private reply (Meta error 2534066). Despite Meta's wording, the token and permissions are fine and the comment ID is valid, so reconnecting the account or retrying this comment will not change the result.", "type": "platform_error", "code": "platform_api_error", "platform": "instagram",
  "platformError": { "code": 200, "error_subcode": 2534066, "type": "IGApiException", "message": "Please check if access token has enough IG permissions granular scopes for IG private reply. Or, verify if the comment ID is valid" } }
```

Other statuses: 401, 403 ("Inbox addon required"), 404 ("Account not found").

The automation logs describe `privateReplyConsumed` as true for "Instagram subcode 1545133 or 2534023, or Meta code 10900 on Instagram and Facebook" (https://docs.zernio.com/comment-automations/list-comment-automation-logs).

### 4b. Public reply to a comment

`POST /v1/inbox/comments/{postId}` with an optional `Idempotency-Key` header (retained 24 h; same key and body replays the response; a different body gives 422; a key still in flight gives 409).

- Body: `{ "accountId": "...", "message": "...", "commentId": "<comment to reply to>" }`. Omit `commentId` to post a top-level comment. The docs conflict on whether Instagram supports that: the platforms table shows "Post: No", "Reply: Yes", while the Instagram page lists "Post a new top-level comment: Yes". We only need replies.
- Response 200: `{ "success": true, "data": { "commentId": "<new id>", "isReply": true, "cid": null } }` (the shape is from the schema).
- Errors: 400, 401, 403 ("Inbox addon required, or the connected account is not permitted to comment"), 409, 422 and 429.

Related actions:

- hide: `POST` / `DELETE /v1/inbox/comments/{postId}/{commentId}/hide`
- delete: `DELETE /v1/inbox/comments/{postId}` (see the spec for parameters)
- edit: `PATCH /v1/inbox/comments/{postId}/{commentId}`

Sources: https://docs.zernio.com/comments/reply-to-inbox-post and https://docs.zernio.com/platforms.

### 4c. DM a user (inside the 24 h window) with buttons, templates or quick replies

`POST /v1/inbox/conversations/{conversationId}/messages` with an optional `Idempotency-Key` header.

- **`conversationId`:** "Opaque conversation identifier, accepted verbatim from the list endpoint or from the conversationId on inbox webhooks." For Instagram, the IGSID (`platformConversationId`) is also accepted. The docs do not say what happens when no thread exists yet (section 9).
- **Starting a thread by recipient id is not supported for Instagram.** `POST /v1/inbox/conversations` supports "X, Bluesky, Reddit, WhatsApp, SMS, Slack, and iMessage. Other platforms return PLATFORM_NOT_SUPPORTED." On Instagram, a thread therefore exists only once the user has messaged the account, or after the private reply (section 9).

Instagram-relevant JSON body fields (spec `sendInboxMessage`):

| Field | Notes |
|---|---|
| `accountId` (required) | |
| `message` | text |
| `attachmentUrl`, `attachmentType` (`image`/`video`/`audio`/`file`) | "Facebook/Instagram ... when an attachment and text were both requested ... the send is two Meta messages under the hood" (response `messageIds`) |
| `quickReplies` | max 13 `{title ≤20, payload, imageUrl?}`. Mutually exclusive with `buttons` |
| `buttons` | max 3 `{type: url/postback/phone, title ≤20, url?, payload?}`. "Instagram / Facebook: also mutually exclusive with `template`" (sending both is a 400) |
| `template` | `{ type: "generic", elements: [ {title ≤80 (required), subtitle, imageUrl, buttons[≤3 url/postback]} ] }`, up to 10 elements (a carousel). `imageAspectRatio` is a 400 on Instagram |
| `messagingType` / `messageTag` | "Instagram only supports HUMAN_AGENT". To message outside the 24 h window, send `messageTag: "HUMAN_AGENT"` with `messagingType: "MESSAGE_TAG"` (https://docs.zernio.com/platforms/instagram) |
| `replyTo` | Ignored on Instagram; the response then carries a `warnings[]` entry `ignored_field` |

A multipart/form-data variant exists for binary uploads.

Response 200, verbatim from https://docs.zernio.com/multi-tenant/inbox:

```json
{
  "success": true,
  "data": {
    "messageId": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx",
    "conversationId": "66c3d2ae7b4f6c8d0e1f2a3b"
  }
}
```

Schema notes:

- `data.messageId` is the platform id of the sent message (the Instagram `mid`).
- `data.conversationId` is the Zernio conversation id. "for Facebook, Instagram ... [the list] endpoint returns the platform thread id instead, so do not correlate the two by equality".
- Optional fields: `data.attachments[]`, `data.messageIds[]` and `data.partialFailure`, plus top-level `warnings[]`.

Errors:

- **400:** `code` is one of `PLATFORM_LIMITATION`, `MISSING_PARTICIPANT` or `platform_api_error` (the latter with `platform` and `platformError{code, subcode, fbtraceId, type}`).
- **403:** "Inbox addon required, or Meta rejected the send outside the messaging window".
- **409 / 422:** idempotency conflicts.
- **429:** upstream quota (`rate_limited`, with `Retry-After`).
- **500:** "Zernio does NOT retry a send internally ... Retrying this request may deliver the message twice."

**Idempotency rules:** "Only successful (2xx) responses are stored for replay". After an ambiguous failure, list the conversation's messages before retrying.

Sources: https://docs.zernio.com/messages/send-inbox-message, https://docs.zernio.com/messages/create-inbox-conversation and https://docs.zernio.com/guides/idempotency.

Related endpoints:

- typing indicator: `POST /v1/inbox/conversations/{id}/typing`
- mark read: `POST /v1/inbox/conversations/{id}/read`
- reactions: `POST` / `DELETE .../messages/{messageId}/reactions`
- ice breakers: `PUT /v1/accounts/{accountId}/instagram-ice-breakers` (max 4, question ≤80 characters)

### 4d. IDs returned by the send endpoints

| Call | Message id field |
|---|---|
| Private reply | top-level `messageId` (plus `commentId` and `platform`) |
| Public comment reply | `data.commentId` |
| DM send | `data.messageId` (the Instagram `mid`, which equals `message.platformMessageId` on webhooks and `messages[].id` on the list endpoint) and `data.conversationId` |

---

## 5. Reading

**Recent media.** `GET /v1/accounts/{accountId}/posts` returns "the 25 most recent posts that exist on the platform ... read live from the platform API ... including posts that were never created through Zernio."

- Each post carries `id` (the Instagram media id), `platform`, `message` (the caption), `createdTime`, `permalink`, `picture`, `mediaType`, `commentCount` and `likeCount`, plus a top-level `lastUpdated`.
- A 401 `TOKEN_EXPIRED` means the account must be reconnected.
- The endpoint has **no pagination parameter**; it returns 25 posts only.

Source: https://docs.zernio.com/accounts/get-account-posts.

**Posts with comment counts.** `GET /v1/inbox/comments?accountId=&platform=instagram&since=&minComments=&limit(≤100)=&cursor=`

- Response: `data[]` with `id`, `platform`, `accountId`, `content`, `permalink`, `createdTime`, `commentCount` and more, plus pagination via `nextCursor`. Instagram supports following `nextCursor` beyond the first page.
- "**Responses are cached for up to 10 minutes**".

Source: https://docs.zernio.com/comments/list-inbox-comments.

**Comments on one media (missed-comment sweep).** `GET /v1/inbox/comments/{postId}?accountId=&limit(1-100, default 25)=&cursor=&commentId=`

Each `comments[]` entry has:

- `id`, `message` (the comment text), `createdTime`
- `from` `{id, name, username, picture, isOwner}`
- `likeCount`, `replyCount`, `replies[]`
- `canReply`, `canHide`, `isHidden`
- `parentId`: present on reply entries

Pagination is `pagination {hasMore, cursor}`. Pass `commentId` to fetch the replies to one comment.

- **"Responses are cached for up to 10 minutes ... Do not poll this endpoint for real-time updates: subscribe to the `comment.received` webhook"**. Your own writes refresh the cache immediately.
- Instagram Login accounts return hidden comments with `isHidden: true`.

Source: https://docs.zernio.com/comments/get-inbox-post-comments.

**Active stories.** `GET /v1/accounts/{accountId}/instagram/stories` returns `data[]` with `id` (the story media id), `mediaType`, `mediaProductType`, `mediaUrl`, `permalink`, `thumbnailUrl` and `timestamp`. Only live stories (24 h) are returned (https://docs.zernio.com/instagram/list-instagram-stories).

**User profile and follow status.** `GET /v1/accounts/{accountId}/follow-status/{userId}?refresh=true|false`, where `userId` is the IGSID from `sender.id` or `comment.author.id`.

- "**Meta only answers for people who have MESSAGED the account.** Commenting grants no consent."
- Unresolvable users still get a 200, with `isFollower: null` and `unavailableReason` set to `consent_required`, `dm_access_disabled`, `not_messageable` or `error`.
- Answers are cached briefly. Pass `refresh=true` right after asking someone to follow.

Example, from spec YAML:

```json
{ "userId": "1312733120229708", "accountId": "6977a34e77637c5c857c816c", "isFollower": true, "isFollowedByAccount": false, "followerCount": 25, "isVerified": false, "username": "to.bias8262", "name": "Tobi Ma", "unavailableReason": null }
```

This is the Zernio equivalent of Meta's `is_user_follow_business`; the underlying Meta field name is not stated. The same data also rides on `message.sender.instagramProfile`, on conversation list rows (`instagramProfile` plus `fetchedAt`), and on `comment.author.instagramProfile` for users who have DMed before.

Source: https://docs.zernio.com/accounts/get-instagram-follow-status.

**Inbox.**

- `GET /v1/inbox/conversations?accountId=&platform=instagram&status=&limit(≤100)=&cursor=`
  - Each row has `id` (for Instagram, the platform thread id), `participantId`, `participantName`, `lastMessage`, `updatedTime`, `unreadCount` and `instagramProfile`.
  - The response also carries `pagination` and `meta.accountsFailed` / `failedAccounts`.
- `GET /v1/inbox/conversations/{conversationId}/messages?accountId=&sortOrder=asc|desc&cursor=`
  - Each message has `id` (the Instagram `mid`), `message`, `senderId`, `direction`, `createdAt`, `attachments`, `deliveryStatus`, `readAt`, `metadata` (including `metaInteractive`, `storyReply` and `isStoryMention`) and `sentVia`.
  - The endpoint does not mark messages read.
- The docs recommend a scheduled sweep of both endpoints "to catch anything a missed webhook left behind".

Sources: https://docs.zernio.com/messages/list-inbox-conversations, https://docs.zernio.com/messages/get-inbox-conversation-messages and https://docs.zernio.com/multi-tenant/inbox.

---

## 6. Built-in comment-to-DM automation (server side)

Zernio's automation endpoints:

- create: `POST /v1/comment-automations`
- list: `GET /v1/comment-automations?profileId=`
- get / update / delete: `GET`, `PATCH`, `DELETE /v1/comment-automations/{automationId}`
- logs: `GET /v1/comment-automations/{automationId}/logs`

Sources: https://docs.zernio.com/comment-automations/create-comment-automation and https://docs.zernio.com/platforms/instagram#comment-to-dm-automations.

**Create fields** (required: `profileId`, `accountId`, `name`, `dmMessage`):

| Field | Behaviour |
|---|---|
| `trigger` | `comment` (the default) or `story_reply`, which fires on a keyword reply to an Instagram story |
| `platformPostId` / `postId` | Scope to one media or story. Omit for account-wide: "You can stack unlimited account-wide automations ... Per-post automations take priority on their post." Only one *active per-post* automation is allowed per post (409 otherwise) |
| `keywords[]` | An empty list means any comment triggers |
| `matchMode` | `contains` (the default, and it matches inside words: "keyword 'app' fires on 'happy'"), `word` or `exact` |
| `excludeKeywords[]`, `typoTolerance` | Typo tolerance works only with `word` mode: 1 edit for 4-7 character keywords, 2 edits from 8 characters up |
| `dmMessage` | Max 640 characters with buttons, about 1000 without |
| `dmMessageVariations[]` | Up to 5 alternates, picked at random |
| `buttons[]` | 1-3 buttons: `url`, `postback` or `phone` (Facebook only). Sent via `button_template` |
| `template` | A generic product card (up to 10 elements). Replaces the text bubble; mutually exclusive with `buttons`. Renders on the Instagram mobile app only |
| `commentReply`, `commentReplyVariations[]` | Public reply plus up to 5 random variants |
| `dmDelaySeconds` | 0-86400. "The trigger is still matched and deduplicated the moment the comment arrives, so a delay only moves when the response is sent." |
| `commentReplyDelaySeconds` | 0-86400. "The reply never goes out before the DM, so a value below dmDelaySeconds is raised to it." Ignored for `story_reply` |
| `linkTracking` | Default true. Wraps URL buttons in a tracked redirect |
| `clickTag` | Tags contacts who click |
| `alsoMatchInDms` | Also fires on keyword DMs. "each door is deduplicated separately". Not allowed with `story_reply` |
| `audience` | Instagram only: `followerStatus` (`any` / `follower` / `non_follower`), `minFollowerCount`, and `whenUnknown` (`send` by default, `skip` or `verify`) |
| `followGate` | `message` (≤640), `buttonLabel` (≤20, default "I'm following") and `notFollowingMessage` (≤1000). With `verify`, "Tapping it is a message, which grants consent, so the re-check on the tap resolves and the real DM (or `followGate.notFollowingMessage`) follows automatically." |
| Postback `zernio:workflow:<workflowId>` | A button with this payload starts a Zernio workflow on tap |

**Automation behaviour:**

- The first DM is a private reply: "a comment gets exactly one private reply, so the card and the text cannot both be delivered."
- The public reply is skipped if the DM fails: `commentReplyStatus` is 'skipped' "if the DM failed (the public reply is not attempted in that case)".

**Logs** (`GET .../logs?status=pending|sent|failed|skipped|gated`). Each row includes:

- `commentId`, `commenterId`, `commenterName`, `commentText`
- `source`: `comment`, `story_reply` or `dm`
- `status`, `audienceOutcome`, `commenterIsFollower`
- `error`, `platformError{code, subcode}`, `privateReplyConsumed`
- `commentReplyStatus`, `nextDueAt`, `createdAt`

The response also includes a `misses` sample of non-matching comments.

**Stats** (on the list endpoint): `triggered`, `dmsSent`, `dmsFailed`, `uniqueContacts`, `trackedSends`, `linkClicks`, `uniqueClicks`, `delivered` ("Messenger; IG emits no delivery receipt") and `read`.

**Outgoing sends:** automation DMs are labelled `sentVia: "comment_automation"` on `message.sent`.

**Workflows** (`/v1/workflows`) are DM-triggered graphs for Instagram, WhatsApp and other platforms.

- Trigger types: `inbound_message` (keywords with `any` / `contains` / `exact` / `regex`; `onlyFirstMessage`) or `api_call`.
- Node types include `send_message`, `condition`, `delay`, `wait_for_reply`, `webhook` (calls your URL), `ai` and `handoff`.
- They need inbox access.

Source: https://docs.zernio.com/workflows.

### Could Zernio's automation replace our trigger logic? (assessment)

- **Covered natively.**
  - Keyword match with exclusions, on per-post or account-wide scope.
  - About a 1-minute delay (`dmDelaySeconds: 60`), with the public reply after the DM (`commentReplyDelaySeconds`) and random public-reply and DM variants.
  - Link button with click tracking.
  - Follow gating, dedupe per comment, story-reply keyword triggers and keyword DMs.
  - Logs and stats.
- **Not covered, or unknown:**
  1. **Non-follower buttons.** Buttons are refused for non-followers, which is most first-time commenters, and the failed call burns the private reply. The docs neither show nor mention an automatic text-only fallback in automations. They also do not reconcile `followGate` (a confirm *button* sent as the private reply) with the 1545133 rule. This must be tested before relying on it.
  2. **Ordering.** The public reply is posted after the DM, never before, and is skipped when the DM fails. Our current order (public reply and DM at about 1 min) would need to fit that.
  3. **Custom logic.** Per-user state, milestone-2 approvals, inbox moderation and custom copy per tap are better kept in our Worker, driven by the `message.received` postbacks. A postback can also jump into a Zernio workflow (`zernio:workflow:<id>`).
- **Hybrid option (inference):** let a Zernio automation handle comment → delayed public reply + DM, and let the Worker consume `message.received` (postbacks, story replies, DMs), `message.sent` (`sentVia` to tell automation, API and app sends apart) and the automation logs.

---

## 7. Errors, rate limits and pricing

### Error envelope

Example, verbatim:

```json
{ "error": "budgetAmount is required", "type": "invalid_request_error", "code": "missing_required_field", "param": "budgetAmount" }
```

- **Fields:** `error` (unstable text, never branch on it), `type` (stable), `code` (stable), `param`, `details`, and on platform errors `platform` and `platformError` (raw Meta payload: `error_subcode`, `error_user_title`, `error_user_msg`).
- **Types:** `invalid_request_error`, `authentication_error` (401), `permission_error` (403 or 402), `not_found`, `rate_limit_error` (429), `platform_error` (the platform's 4xx, or 502) and `api_error` (500 or 503 `temporarily_unavailable` with `Retry-After`).
- **Legacy shapes:** "A handful of responses predate the envelope": the API-key 429 carries only `error` and `details`.
- **401:** `{"error":"Unauthorized"}`.
- **404 on an account id:** can mean the account was disconnected and removed.

Source: https://docs.zernio.com/guides/error-handling.

### Zernio API rate limits

Limits use a sliding per-minute window, set by the team's connected-account count:

| Connected accounts | Requests per minute |
|---|---|
| 0-2 (free) | 60 |
| 3-2,000 | 600 |
| 2,001+ | 1,200 |

- Analytics endpoints use a per-second window instead.
- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; 429 responses add `Retry-After`.
- The 429 body is verbatim:

  ```json
  { "error": "Rate limit exceeded. Please retry after 12 seconds.", "details": { "currentCount": 601, "limit": 600, "retryAfterSeconds": 12 } }
  ```

- **Platform 429/5xx retries:** "A 429 or 5xx from a platform is retried up to 3 times". This does **not** apply to message sends: "Zernio does NOT retry a send internally".

Sources: https://docs.zernio.com/guides/rate-limits and openapi.yaml `x-documentation`.

### Meta limits

The docs contain **no statement of Meta's Instagram private-reply or messaging rate limits** (for example "750 private replies/hour"). Zernio sends through its own Meta app ("Zernio talks to the platform as one application"). Upstream Meta 429s surface as `rate_limited` or `platform_error`. See section 9.

### Pricing and the free plan

- **Accounts:** 1-2 connected accounts are free with no card ("The first 2 connected accounts are free without a card", except X). Accounts 3-10 cost $6 each per month.
- **Free-account features:** "Every account, free or paid, includes full API access, unlimited posts ... analytics, inbox and ads."
- **Free credit:** the allowance is a $12 monthly credit against the connected-accounts line.
- **One Instagram account counts once.**

Sources: https://docs.zernio.com/pricing and https://docs.zernio.com/billing.

### Outbound message meter

The meter starts **1 October 2026**. "Every message Zernio delivers to a recipient on your behalf meters, whichever endpoint sends it: the Inbox API, the Broadcasts API, sequences, workflows and the per-platform send endpoints."

- **Rates:** the first 10,000 per month are free (per **team**, resetting 00:00 UTC on the 1st, no rollover). After that, $0.0001 per message.
- **What counts:**

  | Action | Metered? |
  |---|---|
  | "DM sent, on any channel except X and SMS (Facebook, Instagram, ...)" | Yes |
  | "Comment reply, review reply" | No |
  | "Any message received" | No |
  | Reads, typing indicators, mark read | No |
  | A failed send | No |

- **Tracking:** "No endpoint reports the running count today". Without a card, Zernio emails the owner at 7,500, and "the send that would pass 10,000 fails with `403`, code `message_allowance_exceeded`". With a card, nothing pauses.
- **Private replies and automation DMs** are DMs, so they almost certainly count, but they are not listed by name (section 9).

Source: https://docs.zernio.com/pricing/messages.

---

## 8. Terms of service

Zernio ToS at https://zernio.com/tos. The page shows "Last updated: September 28, 2026", which is the fetch date and possibly auto-generated.

- **Operator:** ZERNIO SOFTWARE SL (Spain). Governing law: Spain.
- **§3 API use:** "Your use of our API is subject to rate limits and usage quotas ... You agree not to exceed these limits or attempt to circumvent them. Abuse of the API may result in immediate suspension of your account."
- **§6 Acceptable use:** "only for lawful purposes ... You may not use the Service to post content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable."
- **§8 Termination:** "We may terminate or suspend your account ... for any reason whatsoever".
- **Third-party terms:** YouTube's ToS is incorporated by reference. **Meta/Instagram terms are not mentioned.**
- **No automated-DM or anti-spam clause** exists beyond the above, and **nothing restricts using Zernio for your own single account**. The product is explicitly aimed at both own-account and multi-tenant use.
- **Meta platform rules still apply** because the messages go out through Meta: the 24 h window, one private reply per comment within 7 days, HUMAN_AGENT only on Instagram, and plain text only to non-followers. The docs also warn about "Automation detection" ("Instagram blocked your request") for publishing.

---

## 9. Unverified / not found

1. **Echoes of messages typed in the Instagram app.** The docs never state plainly that a DM the creator types in the native app fires `message.sent`. The evidence points strongly that way:
   - The platforms webhook table marks Instagram `message.sent` as Yes.
   - `sentVia` is documented as `null` for "a message sent from the platform's own app".
   - `quotedMessageId` is described as "Not delivered on Instagram echoes ... a reply the operator quoted in the Instagram app arrives with no `quotedMessageId`".

   Against that, the schema's own description says it fires "when a message is sent via the API, or from the WhatsApp Business app on Coexistence numbers". Whether an echo could instead arrive as `message.received` with `direction: "outgoing"` (the enum allows it) is also undocumented. **Verify empirically.** The planned detection rule is `message.sent` with `sentVia == null` = typed in the app.
2. **Instagram postback payload shape.** The docs contain no verbatim Instagram example; only the RCS example exists. `metadata.postbackPayload` and `postbackTitle` are documented for "Facebook/Instagram Messenger". What `message.text` holds on an Instagram postback (the title or null) is unverified.
3. **Private-reply response.** There is no verbatim example (schema only), and the format of `messageId` is not shown. Whether a private reply fires `message.sent` or creates a conversation row before the user replies is also undocumented.
4. **Sending when no thread exists.** Can you DM an IGSID with no existing conversation by passing the IGSID as `conversationId`? The docs say the IGSID "is accepted by the conversation endpoints" but also that create-conversation does not support Instagram. Treat it as working only after the user has messaged.
5. **Meta messaging and private-reply rate limits** (for example 750/hour) are not documented by Zernio. Whether Zernio's shared Meta app pools any limits across customers is not stated for Instagram messaging (it is stated for Reddit, TikTok and Google Ads).
6. **The follow gate under the 1545133 rule.** The gate is a private reply with a confirm button. The docs do not say how it behaves for non-followers, given that Instagram refuses buttons to non-followers. There is also no documented automatic text-only fallback for automations.
7. **"Tracked post".** `comment.received` fires for comments "on a tracked post", which the docs never define. `comment.postId` is null for posts not published through Zernio, which implies native posts are covered. Not verified for posts older than the connection.
8. **Instagram business user id.** The Instagram-side id of the connected account is not in the `GET /v1/accounts` schema. It may appear in `metadata` or in the health endpoint; unverified.
9. **Metering of private replies and automation DMs.** Presumed metered, but not listed by name.
10. **`authUrl` host for Instagram Login.** The spec example shows a facebook.com dialog.
11. **Dashboard connect UI.** It exists by implication, but there is no documented walkthrough.
12. **`@zernio/node` in Cloudflare Workers.** Compatibility is not verified. Plain `fetch` works per the curl examples.
13. **Webhook source IPs, mTLS and timestamped signatures:** none documented.
14. **The ToS "Last updated" date** may be rendered dynamically. The docs have no separate Acceptable Use or anti-spam policy page; https://zernio.com/privacy-policy exists but was not reviewed.

---

## 10. Mapping from our current Meta calls to Zernio

| Current (Meta Graph) | Zernio |
|---|---|
| Webhook `comments` field | `comment.received` (dedupe on `id`; skip `comment.author.isOwnAccount === true`) |
| `POST /{ig-id}/messages` with `recipient.comment_id` (private reply) | `POST /v1/inbox/comments/{mediaId}/{commentId}/private-reply` |
| `POST /{comment-id}/replies` | `POST /v1/inbox/comments/{mediaId}` with `commentId` |
| `messaging_postbacks` | `message.received` → `metadata.postbackPayload` |
| `messaging` (DMs) / story replies | `message.received` (`metadata.storyReply.storyId`) |
| `message_echoes` | `message.sent` (`sentVia` null = app-typed; unverified, see section 9) |
| `messaging_seen` | `message.read` |
| `GET /{igsid}?fields=is_user_follow_business` | `GET /v1/accounts/{accountId}/follow-status/{igsid}` |
| `POST /{ig-id}/messages` with `recipient.id` | `POST /v1/inbox/conversations/{conversationId or IGSID}/messages` |
| `GET /{ig-id}/media` | `GET /v1/accounts/{accountId}/posts` (25 most recent only) |
| `GET /{media-id}/comments` | `GET /v1/inbox/comments/{mediaId}?accountId=` (cached up to 10 min) |
| `X-Hub-Signature-256` (app secret) | `X-Zernio-Signature` (hex HMAC-SHA256 of the raw body with your own secret, no `sha256=` prefix) |
