# dm-automation

Instagram comment-to-DM bot for one creator account. A Cloudflare Worker (Hono, D1) receives Zernio webhooks, matches comments against keyword rules, and sends replies through the Zernio API. The owner usually doesn't code: do the work for them, and explain results in plain words.

## First-time setup

Follow [docs/setup.md](docs/setup.md) step by step. Run every command yourself. Stop only when the owner must act: signing in to Cloudflare or Zernio, connecting Instagram, creating the Zernio API key, or commenting from their test account. Never print secrets back to them.

## Operating the bot

Everything goes through `npm run cli -- <command>`, which reads `DM_WORKER_URL` and `DM_ADMIN_TOKEN` from `.env`.

| Task | Command |
|---|---|
| Is it working? | `health`: `connected` and `webhookRegistered` should be true, `failedLast24h` 0 |
| Find a post's ID | `media`: recent posts with captions and IDs |
| See rules | `rules list` |
| Add a rule | `rules add --file rule.json` |
| Change or turn off a rule | `rules update <id> --json '{"active":false}'` |
| Answer comments posted before the rule existed | `backfill <postId>` |
| Did people get their DMs? | `actions`: the 20 most recent sends with errors |

`rule.json` is gitignored, so it's the place to write a rule before adding it.

## Rule fields

```json
{
  "name": "Setup guide (auto)",
  "keywords": ["auto"],
  "scope": ["<post ID from media>"],
  "public_replies": ["Sent! Check your DMs 👀", "Just sent it your way 🙌"],
  "opening_text": "Hey {name}! 👋 Reply \"auto\" and I'll send it right over.",
  "link_text": "Here's the full setup 👇",
  "button_label": "Get the setup",
  "link_url": "https://example.com"
}
```

- `keywords`: whole-word, case-insensitive. Punctuation and emoji are ignored.
- `scope`: a list of post IDs, or `"all"`. When several rules match, the one with the lowest ID wins.
- `opening_text` (up to 640 characters): the first DM, sent about a minute after the comment. `{name}` becomes their username. **Never put the link here.** Instagram refuses buttons in a first DM to non-followers, and a refused send uses up the one private reply Instagram allows per comment.
- `link_text`, `button_label` (up to 20 characters), `link_url`: the DM with the link button. It goes out when they reply, or 2 minutes after the opening DM if their reply never arrives.
- Setting `link_url` in `rules update` swaps the link. Click counts start over for the new link.

**Post not live yet?** Add the rule with `"scope": ["pending-<short-name>"]` and `"active": false`. Once the post is up, find its ID with `media`, run `rules update <id> --json '{"scope":["<post ID>"],"active":true}'`, then `backfill <post ID>` so early commenters are answered too. Instagram only allows a private reply within 7 days of a comment.

## Changing the code

- Run `npm test` and `npm run typecheck` before every deploy, then `npm run deploy`.
- Schema changes go in a new file in `migrations/`. Apply it with `npx wrangler d1 migrations apply dm-automation --remote` before deploying.
- Zernio API details and quirks: [docs/research/zernio-api.md](docs/research/zernio-api.md).

## When something goes wrong

1. Run `health`. If `lastWebhookAt` is old or null, check Zernio's dashboard → Webhooks → logs.
2. Run `actions`. A `failed` row quotes Instagram's reason.
3. Run `npx wrangler tail`, then comment again from the test account. `"webhook":"rejected"` means the webhook secret doesn't match: run `setup` again.
4. A comment that never shows up in the webhook logs never reached Zernio. That's upstream of this bot.
