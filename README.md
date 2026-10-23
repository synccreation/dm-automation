# dm-automation

Free comment-to-DM automation for Instagram, a ManyChat replacement for one creator account.

Someone comments a keyword under your post, gets a DM about a minute later, replies, and the link drops. It runs on free plans: [Zernio](https://zernio.com) connects to your Instagram (no Facebook Page needed), and a Cloudflare Worker runs the bot. You set it up and change it by talking to [Claude Code](https://www.claude.com/product/claude-code).

## What it does

- **Keyword rules** for one post, several posts or all of them. Matching is by whole word, so `auto` matches "Auto!" but not "automatic".
- **Public reply** under the comment, picked at random from your list.
- **Opening DM** about a minute after the comment. It's plain text that asks them to reply, because Instagram blocks buttons in a first DM to people who don't follow you.
- **Link button** as soon as they reply. Instagram doesn't always pass a reply on, so the bot also tries sending the link directly 2 minutes after the opening DM, and keeps trying for 7 days.
- **Click tracking** on every link.
- **Backfill**: answers comments posted before you made the rule, up to 7 days back.
- **No double messages**: each person is messaged once per post, however many times they comment.

## What it costs

$0 a month for one creator account.

- **Zernio**: free for up to 2 connected accounts and 10,000 DMs a month.
- **Cloudflare**: the free Workers and D1 plans are enough.

## Set it up (about 30 minutes)

You need an Instagram Business or Creator account, a second Instagram account for testing, and Node.js 24 or newer.

1. Get the code:

   ```bash
   git clone https://github.com/synccreation/dm-automation.git
   cd dm-automation
   npm install
   ```

2. Open the folder in Claude Code and say: **"Set this up for me by following docs/setup.md. Stop and ask me whenever you need me to sign in or paste something."**

Prefer to do it by hand? Follow [docs/setup.md](docs/setup.md).

## Day to day

Tell Claude Code what you want, for example:

- "My new reel is up. When someone comments `guide`, send them https://example.com"
- "Turn off the `guide` rule"
- "Did everyone who commented on my last reel get the link?"

[CLAUDE.md](CLAUDE.md) tells Claude Code how to do each of these. The same commands work by hand:

```bash
npm run cli -- help
```

## For developers

- `npm test`, `npm run typecheck`, `npm run deploy`
- Design: [docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md](docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md)
- Zernio API notes: [docs/research/zernio-api.md](docs/research/zernio-api.md)

Made by [@synccreation](https://www.instagram.com/synccreation/). MIT license.
