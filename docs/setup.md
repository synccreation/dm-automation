# Setup

You need:
- an Instagram **Business or Creator** account (the one to automate)
- a second Instagram account for testing
- a Facebook login for developers.facebook.com
- a free Cloudflare account

## 1. Cloudflare

1. Log in to Cloudflare: `npx wrangler login` (a browser window opens).
2. Create the database: `npx wrangler d1 create dm-automation`, then copy the printed `database_id` into `wrangler.jsonc`.
3. Create the tables: `npx wrangler d1 migrations apply dm-automation --remote`
4. Deploy once to get your URL: `npm run deploy`. Note the `https://dm-automation.<subdomain>.workers.dev` URL.
5. In `wrangler.jsonc`, set `PUBLIC_URL` to that URL (no trailing slash) and `CONTACT_EMAIL` to the address shown on your privacy page. Then run `npm run deploy` again.
6. Generate two random secrets. Run `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"` twice.
7. Store them:
   - `npx wrangler secret put ADMIN_TOKEN` (paste the first value)
   - `npx wrangler secret put WEBHOOK_VERIFY_TOKEN` (paste the second value)
8. Copy `.env.example` to `.env`, then set `DM_WORKER_URL` to your URL and `DM_ADMIN_TOKEN` to the first value.
9. Check it: `npm run cli -- health` should print `"connected": false`.

## 2. Meta app

1. At developers.facebook.com, go to **My Apps → Create app**. Pick the use case **"Manage messaging & content on Instagram"** (Instagram API with Instagram Login) and finish the wizard.
2. Open **Instagram → API setup with Instagram login**. Copy the **Instagram app ID** and **Instagram app secret** (not the Facebook app ones):
   - `npx wrangler secret put IG_APP_ID`
   - `npx wrangler secret put IG_APP_SECRET`
3. Add yourself as a tester:
   - Go to **App roles → Roles → Instagram testers**, and add your Business/Creator username.
   - Then, **in a desktop browser**, go to instagram.com → Settings → Apps and websites → **Tester invites** → Accept. The invite can't be accepted on a phone.
4. Set up the login redirect. Under **Set up Instagram business login → Business login settings**, add the OAuth redirect URI `https://<your-url>/auth/callback` exactly, with no trailing slash.
5. Configure the webhook:
   - **Callback URL:** `https://<your-url>/webhook`
   - **Verify token:** the `WEBHOOK_VERIFY_TOKEN` value
   - Click **Verify and save**.
   - Subscribe to `comments`, `messages` and `messaging_postbacks`.
6. Fill in **App settings → Basic**:
   - Privacy policy URL: `https://<your-url>/privacy`
   - Terms of service URL: `https://<your-url>/terms`
   - User data deletion: `https://<your-url>/data-deletion`
   - A category
   - If asked, an app icon (any 1024×1024 image)
7. **Publish** the app (switch it to Live). In Development mode, only the dashboard's "Test" button delivers webhooks.
8. In the **Instagram app** on your phone, go to Settings → Messages and story replies → Message controls → **Connected tools → Allow access to messages**, and turn it on.

## 3. Connect and create a test rule

1. Run `npm run cli -- connect`, open the printed link, and approve. The page should say "Connected as @you".
2. Run `npm run cli -- health`. It should show `"connected": true`.
3. Run `npm run cli -- media` and copy the `id` of the post you'll test on.
4. Create the rule:

   ```bash
   npm run cli -- rules add --json '{"name":"Go/no-go test","keywords":["guide"],"scope":["<MEDIA_ID>"],"public_replies":["Sent! Check your DMs 👀","Just sent it 🙌"],"opening_text":"Hey {name}! Here is the guide 👇","button_label":"Open the guide","link_url":"https://example.com"}'
   ```

## 4. Go/no-go test

1. From the **second account** (which has **no role** on the Meta app), comment `guide` on the test post.
2. Wait 1–2 minutes. Check:
   - a public reply appears under the comment
   - a DM arrives in the second account's Requests folder, with an **Open the guide** button
3. Tap the button. It should open your link, and `npm run cli -- actions` should show both actions as `sent`.

**Result:**
- **DM and reply arrived:** GO. Automating your own account works without App Review. Continue to milestone 2.
- **`actions` shows errors about permissions or "Advanced Access":** NO-GO. Stop and decide between App Review, a connection provider (Zernio), or a hosted tool.
- **Nothing happens:**
  - Check `npm run cli -- health`. If `lastWebhookAt` is still null, Meta isn't delivering. Recheck that the app is Live, that you're subscribed to `comments`, and the callback URL.
  - Check `npx wrangler tail` for errors while you comment again.
