# Viral / widely-shared "build your own ManyChat" repos, templates and tutorials (2025–2026)

Research date: 2026-09-27. Star/fork counts come from the GitHub REST search/repos API on 2026-09-27 unless stated otherwise. Counts are a point-in-time snapshot. Unauthenticated GitHub API rate limits stopped some per-repo metadata lookups, so some fork/issue counts are missing. Reddit's JSON API was blocked, and `site:reddit.com` web searches returned no Reddit threads (see Gaps).

## Q1. Which repos/templates are the most-shared "ManyChat alternative / clone / free comment-to-DM" projects, and what do they actually do?

### Takeaway
One repo is far ahead of the rest: **diwenne/openreply**, with about 2,460 stars and about 970 forks in roughly 10 weeks. It went viral on Instagram itself, via a reel asking people to "comment open" for the link, and the reel's DMs were sent by OpenReply. It is almost certainly the repo the user saw. It uses the official Meta Instagram API. It was not built with Claude, but its README includes a Claude Code/Cursor setup prompt. Every other repo in this space has under about 850 stars. Most have fewer than 60.

### Ranked list (most-shared first)

| # | Repo | Stars / forks (2026-09-27) | Created | API used | Claude? | Real project or marketing? |
|---|---|---|---|---|---|---|
| 1 | [diwenne/openreply](https://github.com/diwenne/openreply) | 2,462 / 967 | 2026-07-17 | Official Instagram API (Instagram Login), or optional paid Zernio | Not in build; README has an AI-assistant (Claude Code/Cursor) setup prompt | Real, actively maintained (last push 2026-09-21); Zernio sponsorship since Sept |
| 2 | [ChatbotXIO/ChatbotX](https://github.com/ChatbotXIO/ChatbotX) | 842 / 234 | 2024-12-09 | Multi-channel platform (WA, IG, FB, TikTok, Telegram, Zalo…) | Markets itself as "built for OpenClaw, Hermes, and Claude" | Open-core company product with a paid cloud (14-day trial) |
| 3 | [zernio-dev/zernflow](https://github.com/zernio-dev/zernflow) | 201 | 2026-02-12 | Paid third-party Zernio API (handles OAuth/tokens) | AI node supports Anthropic/OpenAI/Google via Vercel AI SDK | Real code, but functions as a funnel for the Zernio API |
| 4 | [ayuuxh2/insta-p8](https://github.com/ayuuxh2/insta-p8) ("InstaAuto") | 137 | 2026-01-12 | Official Instagram API w/ Instagram Login | AI replies via Groq/OpenAI-compatible gateway; not Claude-specific | Real code plus heavy SEO/marketing (Product Hunt, Telegram, Discord, hosted "tester" app) |
| 5 | [Shudesu/ig-harness-oss](https://github.com/Shudesu/ig-harness-oss) ("IG Harness", Japan) | 58 | 2026-04-08 | Official API, Standard Access | Bundled MCP server for Claude Code | Real; run by a company (AIエージェント株式会社) |
| 6 | [ryanlaiyanip-ctrl/chatmany](https://github.com/ryanlaiyanip-ctrl/chatmany) | 56 | 2026-08-07 | Official API only; Cloudflare Workers free tier | No (setup prompt is for ChatGPT/Codex) | Real, detailed install guide |
| 7 | [im-anishraj/instagram-comment-to-dm](https://github.com/im-anishraj/instagram-comment-to-dm) ("CampaignCue") | 38 | 2026-04-29 | Official Meta Graph API | No | Open-core; upstream fork source of OpenReply |
| 8 | [brodyautomates/ig-setter](https://github.com/brodyautomates/ig-setter) | 28 | 2026-04-08 (single-day repo) | Meta Graph API v19.0 via n8n | Yes: Claude API drafts DM replies | Creator lead-magnet style; DM reply only, no comment-to-DM |
| 9 | [juancadile/instabot](https://github.com/juancadile/instabot) | 28 | 2026-03-09 | Meta API credentials (official) | No | Small real project (~$5/mo on Railway) |
| 10 | [Upload-Post/upload-post-comment-funnel](https://github.com/Upload-Post/upload-post-comment-funnel) | 21 | 2026-03-28 | Upload-Post SaaS API, which uses Meta Private Replies API | Yes: Claude Code / skills.sh agent skill | Vendor marketing for Upload-Post (free plan) |
| 11 | [KenKaiii/oh-daddy](https://github.com/KenKaiii/oh-daddy) | 7 | 2026-06-27 | Meta Private Replies API (official) | Deployed via Claude Code `/setup-railway`; the app itself has "No AI" | Real minimal tool; promotes YouTube channel + Skool community |
| 12 | [Xeven777/openinstadm](https://github.com/Xeven777/openinstadm) | 10 | 2026-08-11 | Official Meta API | No | README text closely mirrors OpenReply's README (likely derivative) |
| 13 | [Mahanaicoach/free-claude-autodm-kit](https://github.com/Mahanaicoach/free-claude-autodm-kit) | 3 | 2026-08-04 | Zernio API (free tier: 2 connected accounts) | Yes: Claude Code runs the whole setup; uses `claude` CLI for drafting/triage | Claude-native kit; depends on Zernio |

Other small comment-to-DM repos in the `manychat-alternative` GitHub topic, all under 15 stars: brightbeanxyz/brightbean-chat (12), MaikoCode/nudgra-oss (8), CharanMN7/ig-comment-dm (6, Cloudflare Worker + D1), pjwang2022/instagram-comment-dm-bot (6), harshithgangone/open-autodm (13), Qaxlabs/AutoDMX (7), aldoprianandi/ig-autodm-worker (6), LdwS123/instagram-dm-funnel (2), molt-oss/slidein (3). Sources: [GitHub topic manychat-alternative](https://github.com/topics/manychat-alternative) and GitHub search API.

### Cited Findings
**OpenReply (diwenne/openreply): the most likely candidate**
- OpenReply calls itself "Open-sourced ManyChat for Instagram comment-to-DM automation." When a comment matches a keyword, "it sends that person a private reply through the official Meta API." It also offers an optional public reply. — [OpenReply README](https://github.com/diwenne/openreply)
- The README says: "It does not scrape, it does not automate a browser, and it never asks for an Instagram password. Instagram's policies, permissions, messaging windows, and rate limits still apply." — [OpenReply README](https://github.com/diwenne/openreply)
- Features: keyword-to-DM, optional public reply, DM/Story-reply triggers, tracked links, up to 2 link buttons, a follow gate (checks `is_user_follow_business` and fails open), `{username}` personalization, per-account rate limiting under Meta's 750 private replies/hour cap, multi-account workspaces/roles, an inbox inside the 24-hour window, and DM logs. — [OpenReply README](https://github.com/diwenne/openreply)
- Stack: Next.js 16, React 19, Prisma 7/PostgreSQL, BullMQ on Redis (a separate always-on worker), Auth.js magic links via Resend, and "The official Instagram API with Instagram Login". Free-tier hosting suggested: Vercel, Neon, Redis Cloud, and an Oracle Cloud always-free VM for the worker. — [OpenReply README](https://github.com/diwenne/openreply)
- It is self-hosted only. "openreply.diwen.dev is a demo of the dashboard, not a service you can sign up for." A working instance needs a deployed fork, public HTTPS, PostgreSQL, Redis, a running worker, and an Instagram connection. — [OpenReply README](https://github.com/diwenne/openreply)
- The README says: "Supported by Zernio", an optional paid Instagram connection provider that "lets you avoid creating and reviewing your own Meta app." — [OpenReply README](https://github.com/diwenne/openreply)
- On Claude: the README includes a section, "If you use Claude Code, Cursor, or a similar tool, an assistant can walk you through either connection path," with a ready-made prompt in docs/setup.md. — [OpenReply README](https://github.com/diwenne/openreply). The author's launch write-up does not mention Claude or any AI coding tool used to build it. — [diwen.ca OpenReply highlight](https://www.diwen.ca/highlights/openreply)
- OpenReply "was initially forked from instagram-comment-to-dm by Anish Raj (MIT)". — [OpenReply README](https://github.com/diwenne/openreply)
- Launch and virality: the project started July 17, 2026. Diwen launched it "with one reel asking people to comment 'open'", and OpenReply sent the DMs itself. The reel reached 169,486 views and 8,801 comments. The repo passed 1,000 stars in three weeks and had more than 2,200 stars and 850 forks at the time of writing. "At least 18 other creators made videos about it, unbidden and unpaid." — [diwen.ca OpenReply highlight](https://www.diwen.ca/highlights/openreply)
- Creator: Diwen Huang. GitHub @diwenne, X link x.com/diwennee, Instagram @devdiwen, site diwenhuang.ca. — [OpenReply README](https://github.com/diwenne/openreply)
- GitHub API on 2026-09-27: 2,462 stars, 967 forks, 14 open issues, created 2026-07-17, last push 2026-09-21, MIT. — GitHub REST API `repos/diwenne/openreply`
- Web search surfaces many forks by non-developer creators and businesses (e.g., Keatonmac-Fitness, thrivedigilabs, examarketing, WavemaxInternet). This is consistent with creators deploying it after seeing the reel. — [example fork](https://github.com/Keatonmac-Fitness/openreply), [example fork](https://github.com/thrivedigilabs/openreply)

**ChatbotX**
- ChatbotX is described as an "Open-source ManyChat alternative, built for AI" and an "Agentic chat marketing platform built for OpenClaw, Hermes, and Claude", covering WhatsApp, Messenger, Instagram, Telegram, Zalo, TikTok, Email, and Website. The README leads with "get 14 Days Free on ChatbotX Cloud" and "500+ MCP and CLI Tools for Your AI Agents". — [ChatbotX README](https://github.com/ChatbotXIO/ChatbotX)
- GitHub API: 842 stars, 234 forks, 87 open issues, created 2024-12-09, license field "NOASSERTION". — GitHub REST API `repos/ChatbotXIO/ChatbotX`
- Its Show HN (2026-05-11) got 2 points and 0 comments. — [HN item 48091318](https://news.ycombinator.com/item?id=48091318)

**ZernFlow**
- ZernFlow is "The open-source ManyChat alternative", with a visual flow builder for Instagram, Facebook, WhatsApp, Telegram, X, Bluesky, and Reddit. It is "Powered by Zernio for OAuth, token refresh, rate limiting, and cross-platform messaging". A Zernio API key is required. The AI Response Node supports OpenAI, Anthropic, or Google via the Vercel AI SDK. Comment-to-DM is listed. — [ZernFlow README](https://github.com/zernio-dev/zernflow), [zernflow.com](https://www.zernflow.com/)

**InstaAuto (ayuuxh2/insta-p8)**
- InstaAuto is a "Free open-source ManyChat alternative — Instagram DM automation, comment-to-DM funnels, story replies, AI auto-replies, and a live inbox". It runs on Next.js 16 + Supabase and self-hosts on Vercel/Supabase free tiers. It has a Product Hunt badge, a YouTube setup video (youtu.be/kIMQe__d37I, "live in under 18 minutes"), and Discord/Telegram groups. It also offers a hosted web app you can "request access" to as a tester. — [InstaAuto README](https://github.com/ayuuxh2/insta-p8)
- It uses "the official Instagram API with Instagram Login" and "does not scrape, mass-DM, or bypass rate limits". — [search summary of insta-p8 README](https://github.com/ayuuxh2/insta-p8)
- The dev.to launch post by "Trider" (June 3, 2026) had no visible comments. — [dev.to](https://dev.to/trider/i-built-a-free-open-source-manychat-alternative-for-instagram-automation-4a3m)
- Many near-identical copies carry the same description, including the Telegram link, under other accounts: asopash, asopash1300, gargee129, atakansaracoglu/insta-auto, Devproflow-Base-One, louiscreatesai/instaauto, and thevelocityexports/instaflow. — [example](https://github.com/asopash1300/insta-p8), [example](https://github.com/louiscreatesai/instaauto), [example](https://github.com/thevelocityexports/instaflow)
- Only one issue is visible ("ai needs improvements", closed May 30, 2026). — [insta-p8 issues](https://github.com/ayuuxh2/insta-p8/issues?q=is%3Aissue)

**IG Harness (Japan)**
- IG Harness is Instagram DM automation software offered as a "free alternative to Company A / Company B" (ManyChat / Lステップ-style tools), with 0 yen in software fees. It runs on Cloudflare Workers + D1 + R2, installs with one command (`npx create-ig-harness`), and bundles an MCP server "for Claude Code". It has a YouTube setup video (youtu.be/xzEanXQtlO0) and is at v0.11.1 under MIT. The developer is Shuichi Noda (Shudesu / @ai_shunoda), and the operating company is AIエージェント株式会社. — [IG Harness README (JA)](https://github.com/Shudesu/ig-harness-oss), [README.en](https://github.com/Shudesu/ig-harness-oss/blob/main/README.en.md)

**chatmany**
- chatmany is "Self-hosted Instagram comment-to-DM automation, using the official Meta Instagram API only — no scraping". It runs on Cloudflare's free tier ($0/month at single-creator scale) and includes an optional follow ask, email capture, and a ManyChat-style web UI. The GitHub description adds "no App Review". Setup takes about 45 minutes. Support is via Instagram DM to @build.ryanip. — [chatmany README](https://github.com/ryanlaiyanip-ctrl/chatmany)
- The README includes a paste-in prompt for ChatGPT or Codex (not Claude) that walks non-programmers through the install and flags "five things [that] break most installs". — [chatmany README](https://github.com/ryanlaiyanip-ctrl/chatmany)
- The project is described as "Built clean-room from official Meta API documentation". No AI build tools are mentioned. — [publik chatmany page](https://publikhq.com/chatmany)

**Smaller Claude-centric kits**
- **Oh Daddy (KenKaiii)**: "No AI, no chatbot builder… Just keyword in, reply + DM out." It uses Meta's Private Replies API with a global cap of 195 comments/hour. It costs about $5/month versus ManyChat "Starts at $29/month, per account" (the author's claim). Deploy: "Fork this repo. Open it in Claude Code / GG Coder. Run `/setup-railway`." It links YouTube @kenkaidoesai and skool.com/kenkai. License is AGPL-3.0. — [oh-daddy README](https://github.com/KenKaiii/oh-daddy)
- **free-claude-autodm-kit**: "You drop this repo into Claude and say 'set up my auto DM'." It runs on Zernio, which "gives you 2 connected accounts free, permanently". Its `write` / `triage` / `answer` commands use the logged-in `claude` CLI and fall back to keyword rules. It "doesn't log into your Instagram, doesn't scrape" and uses Meta's official API. — [free-claude-autodm-kit README](https://github.com/Mahanaicoach/free-claude-autodm-kit)
- **mrdainami/autodm-kit** (4 stars, 2026-09-05): a CLAUDE.md/AGENTS.md skill folder for Claude Code, Codex, or Cursor that sets up comment-word-to-DM automations through **Blotato** (a third-party SaaS). — [autodm-kit README](https://github.com/mrdainami/autodm-kit)

### Inferences
- Given the phrase "I've seen some repo on that", the strongest match is **OpenReply**. It is the only repo in this space with real viral distribution: a 169k-view reel, 8.8k comments, and 18+ third-party creator videos. Its reel used the exact "comment X for the link" format that creators recognise. A second possibility is one of the many creator videos that covered it.
- Most "open-source ManyChat" repos are thin wrappers around the same Meta primitive: the Instagram Private Replies API, triggered by a `comments` webhook. Several (ZernFlow, free-claude-autodm-kit, the Upload-Post skill, autodm-kit/Blotato) route through a paid middleman API (Zernio, Upload-Post, Blotato), so they are not fully "no-vendor".
- The InstaAuto copies with identical descriptions look like fork/SEO amplification rather than independent projects. Its 137 stars should be read with that in mind. This is an inference from the naming pattern and has not been verified.

### Gaps
- I could not verify which specific 18+ creator videos covered OpenReply (the author gives only the count), nor find the original reel URL.
- I could not retrieve ChatbotX's exact licence terms. GitHub reports NOASSERTION, which may mean a modified or open-core licence.
- I could not confirm Product Hunt upvote counts for InstaAuto.

## Q2. Who promoted these (YouTube, X, TikTok/Instagram, Reddit, HN, Product Hunt), and what "I replaced ManyChat with Claude Code" content exists?

### Takeaway
Distribution happened almost entirely on short-form video (Instagram Reels/TikTok) and GitHub, not on Hacker News or (as far as I could verify) Reddit. Much of the viral "Claude + ManyChat" content does not replace ManyChat at all. It uses Claude *with* ManyChat, through ManyChat's Claude integration or a Claude skill that builds ManyChat automations. It is easy to confuse with the DIY repos.

### Cited Findings
**Promoters of DIY repos**
- OpenReply was promoted by the author's own Instagram reel ("comment 'open'", 169,486 views, 8,801 comments) and then by at least 18 unpaid creator videos. — [diwen.ca](https://www.diwen.ca/highlights/openreply)
- chatmany is promoted via Instagram @build.ryanip ("Stuck? DM me"). — [chatmany README](https://github.com/ryanlaiyanip-ctrl/chatmany)
- Oh Daddy is promoted via Ken Kai's YouTube (@kenkaidoesai) and his paid/community Skool group (skool.com/kenkai). — [oh-daddy README](https://github.com/KenKaiii/oh-daddy)
- ig-setter credits "Built by @brodyautomates" (Instagram). — [ig-setter README](https://github.com/brodyautomates/ig-setter)
- InstaAuto is promoted via a Product Hunt badge, a YouTube tutorial (youtu.be/kIMQe__d37I), Telegram (t.me/instagramautomationp8), Discord, and a dev.to post. — [InstaAuto README](https://github.com/ayuuxh2/insta-p8), [dev.to](https://dev.to/trider/i-built-a-free-open-source-manychat-alternative-for-instagram-automation-4a3m)
- OpenInstaDM has a dev.to post: "A Free ManyChat Alternative for Instagram Creators? We Built It Open Source + FREE!" — [dev.to/xeven777](https://dev.to/xeven777/a-free-manychat-alternative-for-instagram-creators-we-built-it-open-source-free-5dlm)
- IG Harness is promoted via a YouTube walkthrough (youtu.be/xzEanXQtlO0) and the developer's X account @ai_shunoda. — [IG Harness README](https://github.com/Shudesu/ig-harness-oss)

**Hacker News: negligible traction**
- "Show HN: Nudgra – Open-source, self-hostable alternative to ManyChat" (2026-06-08): 3 points, 0 comments. — [HN 48444719](https://news.ycombinator.com/item?id=48444719)
- "Show HN: ChatbotX, an open-source alternative to ManyChat" (2026-05-11): 2 points, 0 comments. — [HN 48091318](https://news.ycombinator.com/item?id=48091318)
- "ShowHN: Insta DM and Website inquiries handler AI bot" (2025-04-02): 1 point, 2 comments. — [HN 43554387](https://news.ycombinator.com/item?id=43554387)
- The HN Algolia search returned no OpenReply submission. — hn.algolia.com API query "openreply", 2026-09-27

**n8n community / templates**
- The "Automated Instagram comment response with DMs & Google Sheets tracking" template (n8n #5941) monitors comments and DMs new commenters. It uses the upload-post.com API and Google Sheets and runs on a polling schedule. — [n8n workflow 5941](https://n8n.io/workflows/5941-automated-instagram-comment-response-with-dms-and-google-sheets-tracking/)
- "AI agent for Instagram DM/inbox. Manychat + Open AI integration" (n8n #2718) still requires ManyChat. — [n8n workflow 2718](https://n8n.io/workflows/2718-ai-agent-for-instagram-dminbox-manychat-open-ai-integration/)
- The n8n community post "I built a self-hosted Instagram comment-to-DM system with n8n" (ErikTaveras, July 19, 2026) uses Meta's official Graph API, keyword and typo detection, message rotation, and dedupe. No template link was shared, and it has only 1 reply (advice on composite-key dedupe plus a 120-second cooldown for duplicate webhooks). — [n8n community](https://community.n8n.io/t/i-built-a-self-hosted-instagram-comment-to-dm-system-with-n8n/303886)

**"Claude + ManyChat" content (likely source of confusion, not DIY)**
- Sabrina Ramonov's TikTok: "I use Claude AI to automate creating ManyChat automations… it comes up with a unique keyword for each video, clones a template in ManyChat, and updates everything automatically." Her CTA is "DM me 'CLAUDE'". This still uses ManyChat. — [TikTok @sabrina_ramonov](https://www.tiktok.com/@sabrina_ramonov/video/7618606049490111758); related Substack notes: [1](https://substack.com/@sabrinaramonov/note/c-228633759), [2](https://substack.com/@sabrinaramonov/note/c-213677532)
- A Threads post by @kotovdeny reads: "Claude has legitimately just changed Instagram DMs forever. You can now connect Claude directly to Manychat and have it handle full conversations." It describes ManyChat Settings → Integrations → Claude. Again, this uses ManyChat. — [Threads @kotovdeny](https://www.threads.com/@kotovdeny/post/DWOiwm7jTGk/claude-has-legitimately-just-changed-instagram-d-ms-forever-you-can-now-connect)
- An Instagram reel titled "I just replaced ManyChat with Claude Code #ai #claude" exists. The creator, date, and linked repo could not be retrieved because Instagram blocked the fetch. — [Instagram reel DW4fIz3D1NB](https://www.instagram.com/reel/DW4fIz3D1NB/)
- A YouTube video, "Claude + Instagram DM Automation Changes EVERYTHING!", was indexed as May 2026. The channel and description could not be retrieved. — [YouTube 6xc1OW57Xq4](https://www.youtube.com/watch?v=6xc1OW57Xq4)
- Preston Chin's blog post "Instagram Comments to Email Leads With ManyChat and Claude or ChatGPT" is also a ManyChat-based workflow. — [prestonchin.co](https://www.prestonchin.co/blog/instagram-comments-to-email-leads-manychat-claude)

**Market context driving the trend (secondary sources, some are competitor blogs)**
- Several blogs report that in March 2026 ManyChat cut its free plan from 1,000 contacts to 25 contacts per month, which prompted many "ManyChat alternative" posts. — [flowgent.ai ManyChat review](https://flowgent.ai/blog/manychat-review), [massively.ai](https://massively.ai/general/manychat-alternatives-2026-8-instagram-dm-tools-compared-massively/). Both are competitor or affiliate blogs, and I did not verify this against ManyChat's own pricing page.

### Inferences
- If the user saw the content on Instagram or TikTok, it was most likely either (a) the OpenReply "comment open" reel or a creator video about OpenReply, or (b) a "Claude + ManyChat" video (Sabrina Ramonov, @kotovdeny). Category (b) is not a ManyChat-free solution.
- The absence of HN traction and of verifiable Reddit threads suggests the "viral repo" phenomenon is creator-economy and short-form-video driven, not developer-community driven.

### Gaps
- Reddit: the JSON API was blocked, and `site:reddit.com` searches returned no matching threads. I could not verify any r/SaaS, r/ClaudeAI, r/n8n, r/InstagramMarketing, r/Entrepreneur, or r/selfhosted posts.
- X/Twitter: I found no specific X posts with engagement numbers, and X was not directly searchable.
- YouTube: I could not retrieve view counts or channel names for any tutorial, because the pages returned no metadata.
- I could not identify the creator of the "I just replaced ManyChat with Claude Code" reel.

## Q3. Are there Claude Code skills/plugins, MCP servers, or Claude Agent SDK examples specifically for Instagram/Meta DM automation?

### Takeaway
Yes, several exist, and they split cleanly by API. The official-API ones are the Upload-Post skill/plugin, IG Harness MCP, jlbadano/ig-mcp, free-claude-autodm-kit, and ig-setter (Claude API via n8n). The unofficial ones, which require an Instagram username/password or the private API, are the most-starred Instagram DM MCP (trypeggy/instagram_dm_mcp) and Stupidoodle/instagram-mcp. I found no Claude Agent SDK example specifically for Instagram comment-to-DM.

### Cited Findings
**Official-API Claude integrations**
- **Upload-Post comment-funnel skill** (21 stars): install with `npx skills add Upload-Post/upload-post-comment-funnel`. It monitors a post's comments, uses semantic keyword matching, and sends private DMs. It polls every 15 minutes and auto-stops after 15 days. The README says: "This skill uses Meta's official Private Replies API." It is Instagram only and requires an Upload-Post account and API key. — [upload-post-comment-funnel](https://github.com/Upload-Post/upload-post-comment-funnel)
- **Upload-Post Claude Code plugin**: "build Instagram comment-to-DM funnels… via the Upload-Post MCP". The plugin connects to a hosted MCP server with about 50 tools and has a free plan. — [upload-post-plugin](https://github.com/Upload-Post/upload-post-plugin)
- **IG Harness**: bundled `@ig-harness/mcp-server`, described as "Control everything from Claude Code in natural language." — [IG Harness README.en](https://github.com/Shudesu/ig-harness-oss/blob/main/README.en.md)
- **jlbadano/ig-mcp** (194 stars, created 2025-05-30): an MCP server on the Instagram Graph API. Its DM tools (get conversations, send DM) "require Advanced Access". — [ig-mcp README](https://github.com/jlbadano/ig-mcp)
- **brodyautomates/ig-setter** (28 stars): Instagram DM → Meta webhook → n8n → Claude API → Supabase → dashboard, with an "AI setter" pipeline (Active → Qualified → Booked → Closed). Claude cost is claimed at about $0.001 per DM. It handles inbound DMs only, not comment-to-DM. — [ig-setter README](https://github.com/brodyautomates/ig-setter)
- **free-claude-autodm-kit**: Claude Code-driven setup and operation on Zernio. — [README](https://github.com/Mahanaicoach/free-claude-autodm-kit)
- **AIMS-Product/InstaSetter** (0 stars): "Instagram DM appointment setting automation via Inro API + Claude". — GitHub search API result, [repo](https://github.com/AIMS-Product/InstaSetter)
- **Pinlyx/pinlyx-mcp** (5 stars): an MCP server for managing Instagram, WhatsApp, X, and LinkedIn DM inboxes from Claude, Cursor, or ChatGPT. — [repo](https://github.com/Pinlyx/pinlyx-mcp)

**Unofficial / private-API integrations (ban risk)**
- **trypeggy/instagram_dm_mcp** (183 stars, created 2025-06-19, last push 2025-08-13) is the most-starred "Instagram DM MCP". It is listed on Glama, LobeHub, mcpservers.org, and playbooks. It requires `INSTAGRAM_USERNAME` / `INSTAGRAM_PASSWORD`, and its requirements.txt pins `instagrapi==2.1.5`, an unofficial private mobile-API library. It sends and reads DMs from Claude Desktop or Cursor. It has no comment-to-DM trigger. — [instagram_dm_mcp README](https://github.com/trypeggy/instagram_dm_mcp), [requirements.txt](https://raw.githubusercontent.com/trypeggy/instagram_dm_mcp/main/requirements.txt), [mcpservers.org listing](https://mcpservers.org/servers/trypeggy/instagram_dm_mcp)
- **Stupidoodle/instagram-mcp** (3 stars) is "built entirely by Claude (Opus 4.5) in ~3 hours with mass auto-accept enabled". New DMs "arrive over Instagram's MQTT connection and are pushed straight into the Claude Code session". A `/dm @username "goal"` skill runs autonomous conversations. This relies on the private realtime API, so it is unofficial. — [instagram-mcp README](https://github.com/Stupidoodle/instagram-mcp)
- **5ou1e/insta-wizard** (34 stars) is a "Python Instagram client — private mobile & web API… DM, post media, comments". It is unofficial. — GitHub search API result, [repo](https://github.com/5ou1e/insta-wizard)

**Setter / "AI appointment setter" repos**
- The GitHub search "instagram setter" / "dm setter" returned jasonc00person/setter-bot (33 stars, "Instagram DM sales pipeline — AI-powered setter bot"; README not retrievable), brodyautomates/ig-setter (28), and a cluster of 1-star "closebot-*" and "gohighlevel-instagram-chatbot" repos all created 2026-09-18. Those have article-style descriptions and look like GitHub SEO spam. — GitHub search API, 2026-09-27; e.g., [yhdp84/closebot-instagram-crm](https://github.com/yhdp84/closebot-instagram-crm)

### Inferences
- The Claude-specific projects with the most social reach (Sabrina Ramonov's ManyChat skill, ManyChat's native Claude integration) still depend on ManyChat. The truly ManyChat-free Claude options are small (under 30 stars) or tied to a vendor API (Upload-Post, Zernio, Blotato).
- The most-starred "Claude + Instagram DM" MCP (trypeggy) uses the unofficial private API. It suits personal-DM experiments, not a compliant business comment-to-DM funnel.

### Gaps
- I found no official Anthropic Claude Agent SDK example or cookbook for Instagram or Meta DMs.
- I did not verify star counts for mcpware/instagram-mcp (23 Graph API tools) or braindead-dev/instagram-dms-mcp (10 stars per search) beyond the search listings.

## Q4. Do these actually work? (App Review hurdles, bans, missing comment-to-DM support, issue-tracker complaints)

### Takeaway
The official-API repos do work for **your own** Instagram professional account without Meta App Review. Standard Access covers accounts that hold a role on your app (admin, developer, or tester), provided the app is published/Live. App Review (Advanced Access) is only needed if other people's accounts connect to your app, i.e., if you run it as a service. The real pain points are setup friction: two sets of app IDs, tester invites that can only be accepted from a desktop browser, Live mode, and redirect URIs. Webhooks also drop comments (hence polling reconcilers), and rate limits apply (750 private replies/hour, one per comment). Unofficial MCPs (instagrapi or MQTT) carry account-ban risk and do not use Meta's sanctioned comment-to-DM mechanism.

### Cited Findings
- OpenReply setup docs: "Real comment webhooks are only delivered when the app is in Live state. In Development mode, only the console Test button delivers events. This is the single most common reason for 'I set everything up and nothing happens.'" — [OpenReply docs/setup.md](https://github.com/diwenne/openreply/blob/main/docs/setup.md)
- OpenReply setup docs: "A published app still holds Standard Access to `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. Standard Access only covers Instagram accounts that have a role on your app… Advanced Access, which covers everyone else, comes only from App Review." Also: "Everything above is enough to run OpenReply for your own accounts, or a handful of accounts you add as testers. No App Review needed." — [OpenReply docs/setup.md](https://github.com/diwenne/openreply/blob/main/docs/setup.md)
- OpenReply setup docs: a missing tester role produces the "Insufficient Developer Role" error. "Even your own account has to be added and accept." — [OpenReply docs/setup.md](https://github.com/diwenne/openreply/blob/main/docs/setup.md)
- IG Harness: "The Instagram Messaging API works on Standard Access (no Meta App Review required) for Pro accounts you own and manage — including DM delivery, engagement gates, and comment replies." It implements comment replies as top-level `@mention` comments to stay within Standard Access. — [IG Harness README.en](https://github.com/Shudesu/ig-harness-oss/blob/main/README.en.md)
- chatmany lists install traps: "TWO different app ID/secret pairs in a Meta app"; don't use the "Generate token" button ("expires in hours"); the redirect URL must be registered in two places; the app "MUST be Published… If it isn't, Instagram returns empty comment and message lists with no error"; Node 22+; and the tester invite can only be accepted from a desktop browser. — [chatmany README](https://github.com/ryanlaiyanip-ctrl/chatmany)
- The OpenReply author on Meta reliability: "webhooks frequently drop comments", which required a reconciler that polls 72 hours of post history. The rate limits are "750 private replies an hour and one per comment", handled with Redis Lua slot reservation. BullMQ workers are used instead of serverless because serverless functions are ephemeral. The write-up mentions no bans or App Review rejections. — [diwen.ca](https://www.diwen.ca/highlights/openreply)
- Open OpenReply issues (as of 2026-09-27):
  - #64 "Comments endpoint returns empty data[] despite comments_count>0 (Instagram Login token)", 2026-09-16
  - #69 "Prevent duplicate opening private replies from polling races", 2026-09-22
  - #63 asks for a delay "so replies don't look automated", 2026-09-15
  - #59 "How to debug?", 2026-09-14
  - #40 "Upgrade to payable model", 2026-08-27
  - Only 14 open issues against about 970 forks. — [OpenReply issues](https://github.com/diwenne/openreply/issues?q=is%3Aissue)
- free-claude-autodm-kit explains why DMs need buttons: DMs to non-followers land in Message Requests, where "a URL in the message text isn't tappable". It also notes that self-comments don't trigger and that each person gets only one DM per automation. — [free-claude-autodm-kit README](https://github.com/Mahanaicoach/free-claude-autodm-kit)
- chatmany notes Meta API limitations: no follower-check capability and no comment-like endpoint. Meta rejects buttons longer than 20 characters. — [publik chatmany page](https://publikhq.com/chatmany)
- The OpenReply follow gate relies on `is_user_follow_business` and "fails open… when Instagram does not return follow status". — [OpenReply README](https://github.com/diwenne/openreply)
- ig-setter's docs cover "App Review for production access". It uses the Graph API for inbound DM replies only. — [ig-setter README](https://github.com/brodyautomates/ig-setter)
- jlbadano/ig-mcp: DM tools "require Advanced Access". — [ig-mcp README](https://github.com/jlbadano/ig-mcp)
- An n8n community reply recommends composite-key dedupe (user + post + campaign) and a 120-second cooldown to handle duplicate webhook deliveries and race conditions. — [n8n community](https://community.n8n.io/t/i-built-a-self-hosted-instagram-comment-to-dm-system-with-n8n/303886)

### Inferences
- For a single creator automating their own account, the official-API repos (OpenReply, chatmany, IG Harness, Oh Daddy) are real, working projects, not vapourware. The effort is a Meta developer app with a tester role plus Live mode, and about 45 minutes of setup.
- "No App Review" claims (chatmany, IG Harness) are accurate only for accounts you own or have added as testers. Selling the tool to clients requires App Review or a middleman like Zernio.
- Private-API tools such as trypeggy/instagram_dm_mcp and Stupidoodle/instagram-mcp sit outside Meta's rules. Using them on a business account carries ban/checkpoint risk. This is an inference from their use of password login and the private API; I found no specific ban reports in their issue trackers.

### Gaps
- I found no concrete, sourced reports of Instagram account bans tied to any of these specific repos.
- I did not read the issue trackers of chatmany, IG Harness, ZernFlow, or trypeggy/instagram_dm_mcp because of the GitHub API rate limit and time budget.
- I did not verify the exact Meta rate limits (750 private replies/hour, 195/hour Graph ceiling) against Meta's developer docs. The figures come from repo authors.
