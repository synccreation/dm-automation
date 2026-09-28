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
