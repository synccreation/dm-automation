# Unofficial / Private-API DM Automation for Instagram, Messenger and WhatsApp: Tools, Activity, LLM Use, and Ban/Legal Risk (as of 27 Sept 2026)

Method note: All GitHub star counts, last-push dates and licenses below come from the GitHub REST API, queried on 2026-09-27. Issue and PR details come from the GitHub API or the linked issue pages. Meta, Instagram and WhatsApp terms and enforcement facts come from Meta or WhatsApp pages and tech or legal press, with dates given. Anything I could not confirm is marked **UNVERIFIED** or listed under Gaps.

---

## 1. Instagram private-API libraries, browser bots and "Instagram DM MCP servers"

### Takeaway
The unofficial Instagram ecosystem centres on **instagrapi**. It is Python, very active (6.9k stars, pushed 2026-09-24), and logs in with a username/password or a session, then drives Instagram's private mobile API. Nearly every "Instagram DM MCP server" that lets Claude read or send DMs on a personal account is a thin wrapper around instagrapi (or around raw web cookies). The older Node library (dilame) moved behind a paywall, the Selenium DM bots are abandoned, and instagrapi's own README now tells business users to prefer the official API.

### Cited Findings

**instagrapi (subzeroid/instagrapi): the dominant library**
- 6,856 stars. Last push 2026-09-24. GitHub reports the license as NOASSERTION. Description: "The fastest and powerful Python library for Instagram Private API 2026 with HikerAPI SaaS." — [GitHub API: subzeroid/instagrapi](https://github.com/subzeroid/instagrapi)
- The README says instagrapi "combines public web and private mobile API flows, supports session persistence and challenge handling, and covers ... users, media, stories, direct messages, notes, locations, comments, insights, and uploads." — [instagrapi README](https://github.com/subzeroid/instagrapi)
- The README's own risk warning: "Private API automation is fragile in production because account trust, proxies, device state, challenges, and rate limits can change independently of the library. For account-owned business workflows, prefer official Instagram APIs where they cover your use case. For production private API infrastructure, a hosted provider such as HikerAPI may be a better fit." HikerAPI is the maintainers' paid SaaS. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- The README notes that the project's Telegram support group "has been restricted by Meta and is no longer maintained" and moved to @aiograpi_support. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- **Authentication:** `cl.login(USERNAME, PASSWORD)`, `login_by_sessionid()`, and saved sessions via `dump_settings("session.json")` / `load_settings()`. The README says that when a browser `sessionid` gets `login_required`, "Instagram rejected that session for the private mobile API." Private mobile requests now use HTTP/2 through `curl_cffi`. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- **DM features:** `direct_send()` and `direct_threads()`. There is also experimental "Realtime MQTT" support that "opens Instagram's private MQTToT connection after login" to receive live DM events. Comment endpoints are in the feature list. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- **aiograpi** (the async sibling from the same org): 459 stars, pushed 2026-09-24, MIT. — [GitHub: subzeroid/aiograpi](https://github.com/subzeroid/aiograpi)

**instagrapi issue tracker: evidence of breakage and anti-abuse responses (2026)**
- #2807 (opened 2026-09-18, open, 23 comments): login fails with "Your version of Instagram is out of date. Please upgrade your app to log in," with HTTP 400 on `/api/v1/accounts/login/` when a verification code is required. — [instagrapi #2807](https://github.com/subzeroid/instagrapi/issues/2807)
- #2778 (2026-08-28, 30 comments): "Login Faild with Username and Password." — [instagrapi #2778](https://github.com/subzeroid/instagrapi/issues/2778)
- #2774 (2026-08-23): "too many 429 error responses." — [instagrapi #2774](https://github.com/subzeroid/instagrapi/issues/2774)
- #2718 (2026-07-04): "challenge_required / Can't login." — [instagrapi #2718](https://github.com/subzeroid/instagrapi/issues/2718)
- PR #2737 (2026-07-13) adds an `AccountSuspended` exception because "Instagram can return `message=challenge_required` with a challenge URL that points at `/suspended/`," which it calls "a terminal account-state response." — [instagrapi PR #2737](https://github.com/subzeroid/instagrapi/pull/2737)
- #2423 (2026-04-19, maintainer tracking issue): "Users regularly hit `429`, `feedback_required`, signup blocks, and related anti-abuse responses," including "repeated retries that likely worsen account health." — [instagrapi #2423](https://github.com/subzeroid/instagrapi/issues/2423)
- #2369 (2026-02-04, 11 comments): `unsupported_version` errors from v1 endpoints. — [instagrapi #2369](https://github.com/subzeroid/instagrapi/issues/2369)
- A GitHub search of the repo for "challenge_required" returned 45 issues/PRs. A search for ban/banned/suspended/disabled returned 151, but that set is noisy and includes unrelated PRs. — [GitHub issue search](https://github.com/subzeroid/instagrapi/issues?q=challenge_required)

**Other Instagram private-API libraries**
- **dilame/instagram-private-api** (Node/TypeScript): 6,479 stars, MIT, last push **2024-08-09**. The README says: "The new version is hosted in a private repository and access is paid." It advertises FBNS/Realtime, so you can "listen for new direct messages." — [GitHub: dilame/instagram-private-api](https://github.com/dilame/instagram-private-api)
- **ping/instagram_private_api** (Python): 3,311 stars, last push 2024-05-06. Effectively legacy. — [GitHub: ping/instagram_private_api](https://github.com/ping/instagram_private_api)
- **Instaloader**: 13,457 stars, MIT, pushed 2026-09-06. Described as a downloader for "pictures (or videos) along with their captions and other metadata." It is read-only, with no DM-sending role. — [GitHub: instaloader/instaloader](https://github.com/instaloader/instaloader)

**Browser-automation (Selenium, Playwright, Puppeteer) DM bots**
- **CamTosh/instagram-bot-dm**: 343 stars, last push 2024-01-28. The README header says "⚠️ Project discontinued." It uses Selenium with `InstaDM(username=..., password=...)` and sends single and group DMs. — [GitHub: CamTosh/instagram-bot-dm](https://github.com/CamTosh/instagram-bot-dm)
- **hbollon/IGopher**: 165 stars, last push 2023-09-07. A Selenium-based DM bot with TUI and Electron GUIs, plus "Quotas & user blacklist modules." Disclaimer: "I am not responsible for any sanctions and/or limitations imposed on your account after using this bot." — [GitHub: hbollon/IGopher](https://github.com/hbollon/IGopher)
- Other mass-DM repos found by GitHub search include CryonicsX/instagram-massdm (75 stars, last push 2024-09-05, "MULTI-THREADING REQUESTS BASED | PROXY SUPPORT") and wezaxy/AI-Powered-Instagram-DM-Bot (33 stars, pushed 2026-04-04). — [GitHub search "instagram dm bot"](https://github.com/search?q=instagram+dm+bot&type=repositories&s=stars)
- A GitHub search found no widely starred, actively maintained Playwright- or Puppeteer-based Instagram DM bot. The browser-automation DM bots with meaningful stars all date from 2020–2024. — [GitHub search](https://github.com/search?q=instagram+dm+playwright&type=repositories)

**Instagram DM MCP servers (Claude Desktop / Claude Code / Cursor)**
- **trypeggy/instagram_dm_mcp**: 183 stars, MIT, last push **2025-08-13**.
  - It pins `instagrapi==2.1.5` and `fastmcp==2.8.1` in pyproject.
  - Auth is an Instagram username and **password**, supplied through `.env` or as `--password` args inside `claude_desktop_config.json`. It saves session files such as `username_session.json`.
  - Tools: `send_message`, `send_photo_message`, `send_video_message`, `list_chats`, `list_messages`, `list_pending_chats`, `get_user_followers`, `get_user_following`, `get_user_posts`, `get_user_stories`, and others.
  - It is set up for Claude Desktop and Cursor.
  — [GitHub: trypeggy/instagram_dm_mcp](https://github.com/trypeggy/instagram_dm_mcp); [pyproject.toml](https://raw.githubusercontent.com/trypeggy/instagram_dm_mcp/main/pyproject.toml)
  - It has **no comment monitoring in main**. PR #5 ("Add get_media_comments, like_comment, and reply_comment", 2025-06-26) is still open. PR #12 ("add per-tool rate limiting to protect accounts from anti-abuse bans", 2026-05-18) is also still open and unmerged. — [PR #5](https://github.com/trypeggy/instagram_dm_mcp/pull/5); [PR #12](https://github.com/trypeggy/instagram_dm_mcp/pull/12)
  - It is listed on Glama. — [Glama: trypeggy/instagram_dm_mcp](https://glama.ai/mcp/servers/trypeggy/instagram_dm_mcp)
- **taskmaster-ai/insta-mcp**: 18 stars, pushed 2026-08-09. Glama describes it as "built with fastmcp and instagrapi," able to read, send and react to DMs and search users. — [Glama: taskmaster-ai/insta-mcp](https://glama.ai/mcp/servers/taskmaster-ai/insta-mcp)
- **Stupidoodle/instagram-mcp**: 3 stars, pushed 2026-09-27.
  - Self-described as "built entirely by Claude (Opus 4.5) in ~3 hours with mass auto-accept enabled."
  - It uses "instagrapi for the Instagram API, raw MQTToT for realtime." DMs, typing and read receipts are "pushed straight into the Claude Code session as channel events."
  - Auth is username, password and 2FA, saved to `.instagram_session`. The README also shows a second "bot" account session.
  - It ships a `/dm @username "your goal"` skill for autonomous conversations that "Run for hours/days until the goal is achieved or abandoned."
  - One README "war story" describes the agent continuing with "playful persistence" after the other person wrote "give up."
  - The disclaimer disclaims responsibility for "Account bans."
  — [GitHub: Stupidoodle/instagram-mcp](https://github.com/Stupidoodle/instagram-mcp); [Glama listing](https://glama.ai/mcp/servers/Stupidoodle/instagram-mcp)
- **mcp-instagram-dm** (Glama lists it under 0XX7C00; Glama's GitHub link is KynuxDev/mcp-instagram-dm, which the GitHub API resolves to 0XX7C00/mcp-instagram-dm): 4 stars, pushed 2026-04-08.
  - It uses **cookie auth** (`INSTAGRAM_SESSION_ID`, `INSTAGRAM_CSRF_TOKEN`, `INSTAGRAM_DS_USER_ID`) against Instagram's "**unofficial** web API, which may change without notice."
  - It is for "personal use only," warns against mass messaging, and disclaims account penalties.
  - The Glama search snippet also described it as wrapping instagrapi with 24 tools. That conflicts with the Glama page's "native HTTP client (no instagrapi dependency)." I did not resolve this.
  — [Glama: 0XX7C00/mcp-instagram-dm](https://glama.ai/mcp/servers/0XX7C00/mcp-instagram-dm)
- Other Glama "Instagram DM MCP" listings: demaAlramhe/instagram-claude-mcp (0 stars, created 2026-08-07), portdev0/instagram_dm_mcp (**the GitHub API returns 404**, so it was likely deleted or renamed), addity3/instagram_dm_mcp, official-Arvind/instagram-mcp and dr-ashraf-s-MCP-LABS/instagram-mcp. I did not check the last three individually. — [Glama search results](https://glama.ai/mcp/servers/demaAlramhe/instagram-claude-mcp); [Glama portdev0](https://glama.ai/mcp/servers/@portdev0/instagram_dm_mcp)
- **Contrast, official-API MCP:** jlbadano/ig-mcp (194 stars, pushed 2026-02-09) uses the Instagram Graph API with a Business account linked to a Facebook Page. Its README says DM read/send "requires Advanced Access approval from Meta" through App Review. — [GitHub: jlbadano/ig-mcp](https://github.com/jlbadano/ig-mcp)
- **Contrast, official-API with MCP and no App Review:** Shudesu/ig-harness-oss (58 stars, pushed 2026-09-06, Japanese). It bundles `@ig-harness/mcp-server` for Claude Code. It claims that on your own professional account, DM delivery works under **Standard Access (no Meta App Review)**, and that Advanced Access is needed only for certain features. — [GitHub: Shudesu/ig-harness-oss](https://github.com/Shudesu/ig-harness-oss)
- **mautrix/meta**: 433 stars, AGPL-3.0, pushed 2026-09-27. "A Matrix-Facebook Messenger and Instagram DM puppeting bridge." It logs in as the user and is not a bot framework. The older mautrix/instagram has 150 stars, last push 2024-03-02. — [GitHub: mautrix/meta](https://github.com/mautrix/meta)

### Inferences
- Every unofficial Instagram DM MCP found needs the user's **raw password or session cookies**, often stored in plaintext in `claude_desktop_config.json` or `.env`. This adds a credential-exposure risk on top of the ToS and ban risk, especially with small, unaudited repos (0–18 stars).
- The flagship Instagram DM MCP (trypeggy) has not been pushed since August 2025 and pins an instagrapi version (2.1.5) far behind current releases (3.0.x in September 2026, per PR #2815). Given instagrapi's 2026 login breakages (#2807, #2778, #2369), it is probably unreliable without upgrades. This is an inference; I did not run it.
- Comment-to-DM (the ManyChat core feature) is not a first-class feature of any unofficial Instagram MCP found. Unofficial tools mainly serve personal-account DM reading and sending, and cold outreach.
- instagrapi's maintainers steer business users to the official API or their paid SaaS. That is a signal that even the library's authors do not consider DIY private-API use production-safe for a business.

### Gaps
- I could not find smithery.ai, mcp.so or lobehub listing pages for Instagram DM MCPs. Only Glama was confirmed.
- I found no download or usage statistics for the Instagram DM MCP servers.
- I did not verify whether instagrapi exposes a documented comment-monitoring (polling/webhook-like) helper beyond generic comment endpoints.
- mgp25/Instagram-API, historically the major PHP private-API library, was not checked. See section 4 on the MGP25 lawsuit and the **UNVERIFIED** link between the two.

---

## 2. WhatsApp unofficial libraries, gateways and WhatsApp MCP servers, with ban evidence

### Takeaway
The WhatsApp unofficial stack is large and extremely active: whatsapp-web.js at 22.6k stars, Baileys at 11.2k, Evolution API at 9.7k, WAHA at 7.5k and whatsmeow at 7.4k. The most popular Claude integration is lharries/whatsapp-mcp (6.3k stars), built on whatsmeow, but its maintenance has stalled. Every major library's own disclaimer says bans are possible. The 2025–2026 issue trackers contain many restriction reports, including cases where accounts sending very low volumes were still restricted.

### Cited Findings

**Libraries and gateways**
- **WhiskeySockets/Baileys**: 11,168 stars, MIT, pushed 2026-09-27.
  - It is "a WebSockets-based TypeScript library for interacting with the WhatsApp Web API." Version 7.0.0 introduced breaking changes.
  - Disclaimer: "The maintainers of Baileys do not in any way condone the use of this application in practices that violate the Terms of Service of WhatsApp ... Do not spam people with this. We discourage any stalkerware, bulk or automated messaging usage."
  — [GitHub: WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- **wwebjs/whatsapp-web.js** (moved from pedroslopez): 22,650 stars, Apache-2.0, pushed 2026-09-27.
  - It uses Puppeteer to run WhatsApp Web "in a managed browser instance to reduce the risk of being blocked."
  - Disclaimer: "it is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe."
  — [GitHub: wwebjs/whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js)
- **Evolution API** (now evolution-foundation/evolution-api): 9,700 stars, pushed 2026-07-14. It "supports both the Baileys-based WhatsApp Web API and the official WhatsApp Cloud API." It integrates with Typebot, Chatwoot, Dify, OpenAI, Flowise and n8n. On the Baileys channel it says: "this method relies on the web version of WhatsApp and may have limitations compared to official APIs." — [GitHub: evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api)
- **WPPConnect**: 3,457 stars, pushed 2026-09-27. — [GitHub: wppconnect-team/wppconnect](https://github.com/wppconnect-team/wppconnect)
- **WAHA** (devlikeapro/waha): 7,496 stars, pushed 2026-09-22. A "WhatsApp HTTP API" with multiple engines, including browser-based WEBJS. — [GitHub: devlikeapro/waha](https://github.com/devlikeapro/waha)
- **tulir/whatsmeow** (Go): 7,424 stars, pushed 2026-09-27. **GOWA** (aldinokemal/go-whatsapp-web-multidevice): 4,869 stars, "REST API with ... Webhooks, and MCP." — [GitHub: tulir/whatsmeow](https://github.com/tulir/whatsmeow); [GitHub: aldinokemal/go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice)

**WhatsApp MCP**
- **lharries/whatsapp-mcp**: 6,321 stars, MIT, last push **2025-07-13**.
  - It connects to "your **personal WhatsApp account** directly via the Whatsapp web multidevice API (using the whatsmeow library)." Auth is a QR scan. Messages are stored locally in SQLite. It targets Claude Desktop and Cursor.
  - The README warns it is subject to "the lethal trifecta ... prompt injection could lead to private data exfiltration."
  — [GitHub: lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp)
  - Maintenance: issue #220 (2026-04-15) says "Request: Add maintainers or transfer repo — 20+ PRs waiting." Community PRs are open for a JID whitelist (#319), a path-traversal fix (#275, "CWE-22"), and rate limiting and hardening (#340). — [#220](https://github.com/lharries/whatsapp-mcp/issues/220); [#275](https://github.com/lharries/whatsapp-mcp/pull/275)

**Ban evidence from issue trackers (2025–2026)**
- whatsapp-web.js #4008 (2025-12-08): "Banned after 3 messages despite implementing ALL #532 recommendations."
  - The reporter used about 110 messages, randomized 20–35 s delays, cooling pauses and a "save contact" prompt, for transactional appointment confirmations.
  - They still received a 24-hour ban after about 3 messages.
  — [wwebjs #4008](https://github.com/wwebjs/whatsapp-web.js/issues/4008)
- whatsapp-web.js #3966 (2025-11-20): "Account restricted after sending 250 messages in a row" (a bulk send from a CSV). — [wwebjs #3966](https://github.com/wwebjs/whatsapp-web.js/issues/3966)
- whatsapp-web.js #3963 (2025-11-19): "Normal Whatsapp Account restricted for 24 hours after using 3-4 days sending 400 messages daily." — [wwebjs #3963](https://github.com/wwebjs/whatsapp-web.js/issues/3963)
- Baileys #2805 (2026-09-07): "Instant Account Restriction (Banned) upon QR Scan for Verified Official Business Account (OBA / Blue Checkmark)."
  - The environment was a datacenter IP "hosting multiple concurrent Baileys connections."
  - The reporter says standard accounts on the same setup were not restricted.
  — [Baileys #2805](https://github.com/WhiskeySockets/Baileys/issues/2805)
- Baileys #2707 (2026-07-14, 14 comments): "Error 463 (Reachout Timelock) Causing Account Bans." It describes temporary bans when messaging contacts with no recent conversation history and links this to WhatsApp's "Trusted Contact (TC) Token" requirement. — [Baileys #2707](https://github.com/WhiskeySockets/Baileys/issues/2707)
- Baileys #2800 (2026-09-05) "Account is Restricted." Baileys #2658 (2026-06-24) "Your account may soon be subject to restrictions." — [Baileys #2800](https://github.com/WhiskeySockets/Baileys/issues/2800); [Baileys #2658](https://github.com/WhiskeySockets/Baileys/issues/2658)
- GitHub issue search counts: 68 Baileys issues/PRs match "ban OR banned" and 98 for whatsapp-web.js. — [Baileys search](https://github.com/WhiskeySockets/Baileys/issues?q=ban)

**WhatsApp terms and enforcement**
- The WhatsApp Terms of Service prohibit communications "such as bulk messaging, auto-messaging, auto-dialing, and the like."
  - Users "must not directly or through automated means" reverse engineer the Services or "gain or attempt to gain unauthorized access."
  - They also may not "create software or APIs that function substantially the same as our Services and offer them for use by third parties in an unauthorized manner."
  - The fetched page showed an effective date of January 4, 2021. That date may not reflect the latest revision.
  — [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service)
- In June 2019 WhatsApp announced that, beginning **December 7, 2019**, it would "take legal action against those we determine are engaged in or assisting others in abuse ... such as automated or bulk messaging, or non-personal use." This includes action based only on **off-platform evidence**, such as companies' public claims about using WhatsApp in violating ways. — [SecurityWeek](https://www.securityweek.com/whatsapp-will-take-legal-action-against-automated-or-bulk-messaging/); [TechCrunch 2019-06-11](https://techcrunch.com/2019/06/11/whatsapp-legal-actions-off-platform/amp/)
- WhatsApp's Help Center has a dedicated page titled "Unauthorized use of automated or bulk messaging on WhatsApp." Its full text could not be fetched because the page is JS-rendered. — [WhatsApp FAQ](https://faq.whatsapp.com/5957850900902049)
- WhatsApp removed more than **6.8 million accounts** linked to scam centers in H1 2025 (announced August 2025). — [US News/AP, 2025-08-06](https://www.usnews.com/news/business/articles/2025-08-06/whatsapp-takes-down-6-8-million-accounts-linked-to-criminal-scam-centers-meta-says)
- Official-platform context for LLM bots: WhatsApp changed its Business API terms to bar **general-purpose AI chatbots** from 2026-01-15 (immediately for new accounts from 2025-10-15). Structured business bots such as support, bookings and sales remain allowed. — [TechCrunch 2025-10-18](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform); [respond.io explainer](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)
- Vendor blogs claim that in 2025 Meta "dramatically increased automated detection of unofficial bulk messaging behaviour." These are vendor or marketing sources without primary evidence, so they are low confidence. — [ask4lead](https://ask4lead.com/will-whatsapp-ban-you-for-automating-your-business/); [odivend](https://engage.odivend.com/blog/whatsapp-bulk-sender-plugins-ban-risk-api-solution)

### Inferences
- The WhatsApp ban signal is the strongest of the three platforms. Restrictions are reported for bulk sends, for moderate daily volumes, for first contact with new numbers, and in one report for very low-volume transactional use. The "conservative settings" in #4008 did not prevent a ban, so volume limits alone are not a reliable safeguard.
- Evolution API is often described as "Baileys or Cloud API." Only its Cloud API channel is ToS-compliant. Its Baileys channel carries the same risk as Baileys itself.
- Pointing an LLM at a personal WhatsApp account through whatsapp-mcp combines three risks: ToS non-compliance, the prompt-injection "lethal trifecta" (which the README itself flags), and a stalled upstream with unmerged security PRs.

### Gaps
- I found no official Meta or WhatsApp statistic isolating bans of unofficial-library users, as opposed to scam, spam or bulk bans in general.
- I did not verify any 2025–2026 lawsuit by WhatsApp or Meta against a specific Baileys- or whatsapp-web.js-based vendor.
- I found no repo for "WhatsApp MCP servers" beyond lharries/whatsapp-mcp and GOWA's MCP support.

---

## 3. Messenger unofficial options (facebook-chat-api / "fca" forks): status

### Takeaway
The original unofficial Messenger library (Schmavery/facebook-chat-api) is **archived** and was self-described as "fundamentally too unstable for any serious application." What remains is a fragmented set of low-star "fca" forks (under 50 stars each) that log in with credentials or cookie "appState." The only substantial, active unofficial Messenger project is the mautrix-meta Matrix bridge, which is a personal chat bridge rather than a bot platform.

### Cited Findings
- **Schmavery/facebook-chat-api**: 1,945 stars, **archived**, last push 2021-12-24.
  - The README says the project is in "maintenance mode" and "fundamentally too unstable for any serious application. Any change by Facebook can break the api overnight and that's assuming the api can remain compliant enough not to get blocked."
  - It works "by emulating the browser ... tricking Facebook into thinking we're accessing the website normally" and "requires the credentials of a Facebook account."
  - It points users to the official Messenger Platform.
  — [GitHub: Schmavery/facebook-chat-api](https://github.com/Schmavery/facebook-chat-api)
- Active forks (all small):
  - VangBanLaNhat/fca-unofficial: 48 stars, pushed 2026-08-21.
  - mahmud-aura/mahmud-fca: 25 stars, pushed 2026-08-26. It supports cookie or appState login and advertises auto-dismissing Facebook's "automated behavior checkpoint."
  - sheikhtamimlover/ST-FCA: 4 stars. It advertises new "End-to-End Encryption (E2EE) Support" and requires "email/password or AppState."
  - nethgraves/ws3-fca: 8 stars.
  - A repo named dragonx943/MiraiBypassGBan (4 stars) has "Bypass Global Ban" in its title.
  — [GitHub search "fca facebook chat api"](https://github.com/search?q=fca+facebook+chat+api&type=repositories&s=stars); [mahmud-fca](https://github.com/mahmud-aura/mahmud-fca); [ST-FCA](https://github.com/sheikhtamimlover/ST-FCA)
- Meta began rolling out **default end-to-end encryption** for personal Messenger chats on 2023-12-06, and said the rollout would take months. — [Meta Newsroom](https://about.fb.com/news/2023/12/default-end-to-end-encryption-on-messenger/); [TechCrunch 2023-12-06](https://techcrunch.com/2023/12/06/meta-finally-starts-rolling-out-default-end-to-end-encryption-for-messenger/)
- **mautrix/meta**: 433 stars, AGPL-3.0, pushed 2026-09-27. An active Matrix puppeting bridge for Messenger and Instagram DMs. — [GitHub: mautrix/meta](https://github.com/mautrix/meta)

### Inferences
- The fca forks' new "E2EE support" claims suggest that Messenger's default E2EE broke older fca-style scraping of chats, forcing forks to reimplement encryption. This is an inference; I did not test it.
- Several forks advertise "checkpoint dismiss" or "ban bypass" features. That indicates Facebook actively checkpoints these sessions, and that the remaining ecosystem is oriented to hobby bots and ban evasion rather than business use.
- For a business Page, the official Messenger Platform is the only sustainable route. The unofficial Messenger route is effectively dead for serious use.

### Gaps
- I found no Messenger MCP server for Claude. None surfaced in the GitHub or Glama searches run here.
- I found no quantitative ban data for fca users.

---

## 4. Ban risk and legal risk: Instagram/Meta terms, lawsuits, 2025–2026 enforcement

### Takeaway
Instagram's Terms of Use explicitly prohibit automated access or collection without Meta's permission. Meta has sued vendors of Instagram automation that "mimicked the official Instagram app" (MGP25, 2020) and scraping-for-hire firms (Octopus and Ateş 2022, Voyager Labs 2023). Meta lost on *logged-off* public scraping (Bright Data, January 2024), but every DM bot is by definition *logged-in*, which is the clearest ToS territory. No 2025–2026 Meta lawsuit specifically targeting DM-bot tools was found; the practical risk to an individual is account-level (challenges, action blocks, suspension), not litigation.

### Cited Findings

**Terms**
- Instagram Terms of Use: "You can't attempt to create accounts or access or collect information in unauthorized ways. This includes creating accounts or collecting information in an automated way without our express permission." Automated data collection must also comply with separate "Automated Data Collection Terms," which Instagram "may restrict or revoke at any time." Source: search-result excerpt of the Help Center page; direct fetch failed because the page is JS-rendered. — [Instagram Terms of Use](https://help.instagram.com/581066165581870/)
- Instagram has a Help Center page, "Why your account has been restricted for data scraping," stating that data scraping "goes against Instagram's Terms of Use." Source: search-result excerpt. — [Instagram Help](https://help.instagram.com/740480200552298/)

**Litigation and enforcement history**
- **June 2020: Facebook v. MGP25 Cyberint Services (Spain).** Facebook sued the company over "automation software to distribute fake likes and comments on Instagram." Facebook's statement: "The defendant's service was designed to evade Instagram's restrictions against fake engagement by mimicking the official Instagram app in the way that it connected to our systems ... [and] continued to do so even after we sent a Cease and Desist letter and disabled their accounts." The same round included **Massroot8** (Mohammad Zaghar), a service that asked for users' Facebook credentials and used "bots posing as Android devices." — [Social Media Today](https://www.socialmediatoday.com/news/facebook-launches-new-legal-action-against-fake-engagement-sellers-and-data/580135/)
  - **UNVERIFIED:** "mgp25" is also the handle associated with a historically popular PHP Instagram private-API library. I did not confirm that the defendant is the same entity.
- **October 2020: BrandTotal / Unimania.** Browser extensions ("UpVoice," "Ads Feed") that scraped Facebook, Instagram and other sites; suit filed in US federal court in California. — [Meta Newsroom 2020-10-01](https://about.fb.com/news/2020/10/taking-legal-action-against-data-scraping/)
- **July 2022: Octopus (the US subsidiary of a Chinese firm) and Ekrem Ateş.** Ateş allegedly used automated Instagram accounts to scrape about 350,000 profiles. — [Engadget](https://www.engadget.com/meta-sues-data-scraping-company-octopus-213001115.html); [TechCrunch 2022-07-06](https://techcrunch.com/2022/07/06/meta-sues-chinese-companys-us-subsidiary-for-scraping-facebook-and-instagram-data/embed/); [Meta Newsroom 2022-07](https://about.fb.com/news/2022/07/actions-against-scraping-for-hire/)
- **January 2023: Voyager Labs.** Meta alleged that more than 38,000 fake accounts were used to scrape more than 600,000 users. The case later settled with a permanent injunction, a monetary payment and data deletion. One search-tool summary dated the filing to December 2024, which conflicts with CNBC's 2023-01-12 date; 2023 is correct per CNBC. — [CNBC 2023-01-12](https://www.cnbc.com/2023/01/12/meta-sues-voyager-labs-over-scraping-user-data.html); [MediaPost (settlement)](https://www.mediapost.com/publications/article/401661/analytics-company-voyager-labs-settles-scraping-ba.html)
- **January 23, 2024: Meta v. Bright Data.** Judge Edward Chen (N.D. Cal.) held that "The Facebook and Instagram Terms do not bar logged-off scraping of public data." Meta dropped its remaining claim and waived appeal in February 2024. — [Quinn Emanuel client alert](https://www.quinnemanuel.com/the-firm/news-events/client-alert-meta-v-bright-data-significant-decision-for-web-scraping-industry/); [Eric Goldman blog](https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm)
- A search for a 2026 Meta lawsuit against an Instagram automation or bot service found none. The 2026 results were suits *against* Meta over scams, addiction and AI training. — [search result set, e.g., MediaPost 2026-09-09](https://www.mediapost.com/publications/article/417725/meta-sued-over-crypto-scams.html)

**2025–2026 ban waves**
- **June 2025:** TechCrunch reported widespread Instagram user complaints of mass bans. Users blamed AI moderation, some were falsely accused of serious violations, and Meta declined to comment on the record. This wave is not specifically tied to automation tools. — [TechCrunch 2025-06-16](https://techcrunch.com/2025/06/16/instagram-users-complain-of-mass-bans-pointing-finger-at-ai/)
- A vendor blog ("Instagram DM Bot Ban Wave 2026," SumGeniusAI) describes a May–August 2025 wave and lists browser automation, password-based tools, scraping and auto-engagement bots as "instant ban risk."
  - The same post retracts a widely repeated claim that Meta cut DM limits from 5,000 to 200 per hour in October 2024, saying it "could not find that change in any Meta documentation."
  - It sells a competing "compliant" product, so treat it as low reliability.
  — [SumGeniusAI blog](https://sumgenius.ai/blog/instagram-dm-bot-ban-wave-2026/)
- Account-level failure modes from instagrapi's own tracker (section 1): `challenge_required`, `feedback_required`, 429 rate limits, "Your version of Instagram is out of date" login blocks, and terminal `/suspended/` challenges (PR #2737, July 2026). — [instagrapi #2423](https://github.com/subzeroid/instagrapi/issues/2423); [PR #2737](https://github.com/subzeroid/instagrapi/pull/2737)

### Inferences
- **Legal exposure** is concentrated on vendors who sell automation or scraping as a service, or who publicly advertise ToS-violating use (Meta's cases; WhatsApp's 2019 "off-platform evidence" policy). An individual automating their own account mainly risks **account loss**, not a lawsuit. Someone who packages an unofficial tool as a SaaS for clients moves toward the profile Meta has sued.
- Bright Data's win does not help DM bots: DM automation requires a logged-in session, which the court treated as the domain where the Terms bind.
- Current ban risk is compounded by Meta's error-prone automated moderation (the 2025 false-positive wave). Accounts with unusual automation signals may be more exposed to mass enforcement, and appeals are reportedly slow. This is an inference; direct evidence linking the two was not found.

### Gaps
- I did not fetch the Meta Platform Terms (developers.facebook.com/terms). Their exact anti-scraping language is not quoted here.
- I could not retrieve the full text of Instagram's "Automated Data Collection Terms."
- I found no official Meta data on how many accounts were actioned specifically for unofficial-API use in 2025–2026.

---

## 5. Which repos are marketed as a "free ManyChat alternative"?

### Takeaway
On GitHub, the repos that explicitly brand themselves "open-source/free ManyChat alternative" overwhelmingly use the **official** Meta Instagram API (webhooks plus private replies), not instagrapi or browser automation. Several explicitly advertise "no scraping, no browser automation, never asks for your password." Unofficial tools are marketed under different labels: "DM bot," "mass DM," "outreach," "multi-account."

### Cited Findings
- **diwenne/openreply**: 2,462 stars, pushed 2026-09-21. It calls itself "The open-source Manychat alternative."
  - It sends private replies "through the official Meta API. It does not scrape, it does not automate a browser, and it never asks for an Instagram password."
  - It rate-limits under "Meta's documented cap of 750 private replies per hour."
  - It offers an optional paid provider (Zernio) so users can avoid creating and reviewing their own Meta app.
  - Its README includes a ready-made prompt for Claude Code or Cursor to walk users through setup.
  — [GitHub: diwenne/openreply](https://github.com/diwenne/openreply)
- **ayuuxh2/insta-p8**: 137 stars. "Free open-source ManyChat alternative." It explicitly targets search phrases ("If you are searching for a free ManyChat alternative, open-source Instagram DM bot..."). It uses "Instagram API with Instagram Login, Graph API v24.0" and needs a Business or Creator account. — [GitHub: ayuuxh2/insta-p8](https://github.com/ayuuxh2/insta-p8)
- **Xeven777/openinstadm**: 10 stars. "Open-source ManyChat alternative ... through the official Meta API. No scraping. No browser automation." — [GitHub: Xeven777/openinstadm](https://github.com/Xeven777/openinstadm)
- **juancadile/instabot**: 28 stars. "Open-source ManyChat alternative ... ~$5/month." It uses Meta webhooks and the Graph API.
  - Its README states: "To the best of our understanding, using this tool with the official Instagram Messaging API for your own account ... does not require App Review."
  - It disclaims liability for "account suspension, ban."
  — [GitHub: juancadile/instabot](https://github.com/juancadile/instabot)
- Others labeled ManyChat alternatives: ChatbotXIO/ChatbotX (842 stars), zernio-dev/zernflow (201), KenKaiii/oh-daddy (7), MaikoCode/nudgra-oss (8). I did not individually verify their auth methods. — [GitHub search "manychat alternative"](https://github.com/search?q=manychat+alternative&type=repositories&s=stars)
- Unofficial-stack repos use outreach framing instead:
  - wasifakram8900/outreachos: "Instagram outreach SaaS — instagrapi engine, multi-account DM automation."
  - kqtff/InstagramAIChatBot: "instagrapi + Groq. Sessionid login."
  - CryonicsX/instagram-massdm: "PROXY SUPPORT."
  — [GitHub search "instagrapi dm"](https://github.com/search?q=instagrapi+dm&type=repositories)
- Web search for "free ManyChat alternative" mostly returns commercial SaaS listicles (LinkDM, InstantDM, Inrō, ChatAutoDM, CreatorFlow), not unofficial GitHub repos. — [InstantDM blog](https://instantdm.com/blog/free-alternatives-to-manychat-free-instagram-dm-automation); [Inrō blog](https://www.inro.social/blog/manychat-competitors-alternatives)

### Inferences
- The "ManyChat alternative" market has largely converged on the official API. The feature ManyChat is known for (comment-to-DM) is available via official private replies, and several repos claim it works for your own account without App Review under Standard Access. That undercuts the main reason to take on unofficial-API risk. The Standard Access claim comes from repo READMEs and should be cross-checked against Meta docs by the official-API research thread.
- Unofficial tools remain attractive mainly for (a) **personal** (non-professional) Instagram accounts, which the official API does not support, and (b) **cold outreach** to people who have not messaged or commented first. Case (b) is exactly the behavior anti-spam systems and the ToS target.

### Gaps
- **I could not verify specific YouTube, X or TikTok videos** marketing instagrapi, Baileys or MCP-based bots as a "free ManyChat alternative." The searches returned SaaS listicles, not videos. This remains unverified.
- I found no popularity or usage data for any trypeggy "Instagram DM MCP" launch virality on X. **UNVERIFIED.**

---

## 6. Bottom line: when (if ever) an unofficial approach is reasonable, and which mitigations people report

### Takeaway
The evidence supports unofficial DM automation only for **personal, low-stakes, low-volume or experimental use on an account you can afford to lose**, such as reading your own DMs through an MCP, or a hobby bot. It is a poor fit for a business account that generates revenue or leads, for any cold or bulk messaging, and for anything offered to clients as a service. The mitigations people describe (session reuse, proxies, randomized delays, rate caps, secondary accounts) are reported to reduce but not eliminate restrictions. On WhatsApp, documented cases show bans despite conservative settings.

### Cited Findings (mitigations as reported, described neutrally)
- **Session reuse instead of repeated logins:** instagrapi's README recommends `login() -> dump_settings() -> load_settings()` session flows over repeatedly importing browser cookies. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- **Proxies and device state:** instagrapi lists "account trust, proxies, device state, challenges, and rate limits" as the factors that make private-API automation fragile. It suggests a hosted provider (HikerAPI) instead of maintaining these yourself. — [instagrapi README](https://github.com/subzeroid/instagrapi)
- **Backoff guidance:** instagrapi maintainers opened #2423 to document which anti-abuse responses (`429`, `feedback_required`, action blocks) "should trigger immediate stop/backoff." — [instagrapi #2423](https://github.com/subzeroid/instagrapi/issues/2423)
- **Per-tool rate limits in MCPs:** a proposed but unmerged PR adds rate limiting to trypeggy's Instagram DM MCP "to protect accounts from anti-abuse bans." — [trypeggy PR #12](https://github.com/trypeggy/instagram_dm_mcp/pull/12)
- **Randomized delays and cooling periods on WhatsApp:** these did not prevent a 24-hour ban in the #4008 report. — [wwebjs #4008](https://github.com/wwebjs/whatsapp-web.js/issues/4008)
- **Secondary or "bot" accounts:** Stupidoodle's MCP README shows logging a second "bot" account into its own session file. — [Stupidoodle/instagram-mcp](https://github.com/Stupidoodle/instagram-mcp)
- **Official-API rate caps:** official-API tools cite and stay under Meta's "750 private replies per hour" cap and the 24-hour messaging window. — [diwenne/openreply](https://github.com/diwenne/openreply)
- **Library authors' own positioning:**
  - Baileys: "We discourage any stalkerware, bulk or automated messaging usage." — [Baileys README](https://github.com/WhiskeySockets/Baileys)
  - whatsapp-web.js: "shouldn't be considered totally safe." — [wwebjs README](https://github.com/wwebjs/whatsapp-web.js)
  - facebook-chat-api: "ok for one-off scripts or fun projects but fundamentally too unstable for any serious application." — [facebook-chat-api README](https://github.com/Schmavery/facebook-chat-api)
  - instagrapi: "prefer official Instagram APIs where they cover your use case." — [instagrapi README](https://github.com/subzeroid/instagrapi)

### Inferences
- **Reasonable-ish use cases** (still ToS-non-compliant, so the risk is accepted rather than avoided):
  - reading and summarizing your own DMs with Claude via a local MCP;
  - low-volume replies on a personal account;
  - prototyping a conversation flow before building on the official API;
  - bridging personal chats (mautrix).
- **Unreasonable use cases:**
  - automating a business or creator account whose leads depend on it;
  - cold or bulk outreach;
  - multi-account operations;
  - reselling as a service (this raises legal exposure, per Meta's 2020–2023 suits and WhatsApp's off-platform-evidence policy);
  - running an autonomous LLM agent that can send DMs unattended. The Stupidoodle README's "Rogue Sessions" and "Persistence Play" anecdotes show how agents create unbounded volume and potentially harassing behavior.
- **LLM-specific risks beyond bans:**
  - prompt injection leading to data exfiltration (flagged in whatsapp-mcp's README);
  - plaintext passwords and session tokens in MCP configs;
  - unaudited low-star MCP code handling credentials;
  - agents continuing after a person declines.
- For Instagram comment-to-DM specifically, several official-API repos say you can run it on your own professional account without App Review. That removes most of the reason to accept unofficial-API risk. Other researchers should confirm this against Meta's documentation.

### Gaps
- There are no quantitative data (from Meta or independent sources) on ban rates by volume or tool for Instagram private-API users. All evidence is anecdotal (GitHub issues) or from vendors.
- It is unclear whether Meta distinguishes unofficial *read-only* personal use (for example, an MCP that only reads DMs) from sending, for enforcement purposes. No source found.
