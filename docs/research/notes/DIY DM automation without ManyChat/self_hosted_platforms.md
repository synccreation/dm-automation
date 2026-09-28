# Self-hosted / open-source platforms that can replace ManyChat (Instagram, Messenger, WhatsApp) with AI (Claude) replies

Research date: 2026-09-27. Scope: only tools that use official Meta APIs (Instagram Platform, Messenger Platform, WhatsApp Cloud API). Unofficial/private-API tools are out of scope; the Baileys mode of Evolution API is noted only for completeness.

---

## Q1. Which open-source / self-hostable platforms actually support Instagram DMs AND Instagram comment triggers (comment-to-DM) via the official API, and how do they connect to Claude?

### Takeaway
Almost no open-source "inbox" or "chatbot builder" platform handles Instagram comment triggers. Chatwoot, Botpress, Hexabot, Typebot, Rasa, Dify, Flowise and Langflow either do Instagram DMs only or have no Instagram channel at all. The two options that handle comment-to-DM plus AI are (a) n8n, which has a native Instagram "comments" webhook trigger, an Anthropic node, and many ready-made templates, and (b) ChatbotX, a new MIT-licensed ManyChat clone (842 stars) whose README claims comment-to-DM and Claude support, not verified in practice. Claude is native in n8n and ChatbotX, and Hexabot lists it. Chatwoot Captain only takes OpenAI or an OpenAI-compatible endpoint.

### Cited Findings

**Chatwoot (open-source omnichannel inbox)**
- Instagram requires creating your own Facebook/Meta app in the developer portal. There are two methods: "Instagram via Facebook Login" (deprecated; "Support for Instagram via Facebook Login will be stopped from v4.1 onwards") and "Instagram Business Login" (recommended) — [Chatwoot Developer Docs](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/instagram-channel-setup); [User Guide – Instagram Login](https://www.chatwoot.com/hc/user-guide/articles/1744361165-how-to-setup-an-instagram-channel-via-instagram-login)
- Self-hosted Instagram (Facebook Login path) needs env vars `IG_VERIFY_TOKEN`, `FB_APP_SECRET`, `FB_APP_ID`. It also needs advanced access to `instagram_manage_messages`, `instagram_basic`, `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `business_management`, `pages_read_engagement`. Webhook subscriptions are `messages`, `message_reactions`, `messaging_seen`, and none are for comments. The docs say: "Before you can start using your Facebook app in production, you will have to get it verified by Facebook." — [Chatwoot Developer Docs](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/instagram-channel-setup)
- **Instagram comments are not supported as conversations.** Open PR #15596 (unmerged as of Sept 2026) fixes a crash where real Instagram comment webhooks (`field: 'comments'`, e.g. Reels comments) were misrouted into the test-event handler. The fix makes Chatwoot ignore them gracefully and does not process them — [GitHub PR #15596](https://github.com/chatwoot/chatwoot/pull/15596)
- Instagram/Facebook comment reply and keyword auto-reply to comments has been a long-standing feature request: #2096 (2021), #3448 (2021, "reply to Instagram mention and comments"), and #9724 (July 2024, "Auto Reply to Facebook and Instagram Comments" using trigger keywords) — [Issue #9724](https://github.com/chatwoot/chatwoot/issues/9724); [Issue #3448](https://github.com/chatwoot/chatwoot/issues/3448); [Discussion #8455](https://github.com/orgs/chatwoot/discussions/8455)
- As of May–July 2026, users report Instagram DMs landing in the Messenger inbox under the old Facebook-Login setup. The suggested fix was to switch to the Instagram Business Login flow — [Discussion #14428](https://github.com/orgs/chatwoot/discussions/14428)
- **Captain (Chatwoot's AI agent) LLM support:** "With Bring Your Own Key (BYOK), you can use your own API key from OpenAI or any compatible AI service." The configuration fields are OpenAI API Key, OpenAI Model (default `gpt-4o-mini`), and an optional OpenAI API Endpoint for custom or self-hosted endpoints. There is no native Anthropic option. Captain on self-hosted requires "Chatwoot Enterprise Edition with a paid plan" — [Chatwoot User Guide – enable Captain self-hosted](https://www.chatwoot.com/hc/user-guide/articles/1755284287-how-to-enable-captain-on-self_hosted-installations)
- Self-hosted pricing: Community Edition $0/agent/mo (no Captain), Premium Support $19/agent/mo (includes Captain), Enterprise $99/agent/mo (includes Captain) — [Chatwoot Self-Hosted Pricing](https://www.chatwoot.com/pricing/self-hosted-plans)
- Chatwoot publishes a separate provider-agnostic Ruby "AI Agents SDK" (`chatwoot/ai-agents`) that works with OpenAI, Anthropic and others. This is a library, not a documented Captain setting — [GitHub chatwoot/ai-agents](https://github.com/chatwoot/ai-agents)
- Anthropic offers an OpenAI-SDK-compatible endpoint (`base_url="https://api.anthropic.com/v1/"`), which in theory can go into an "OpenAI-compatible endpoint" field. Anthropic warns: "This compatibility layer is primarily intended to test and compare model capabilities, and is not considered a long-term or production-ready solution for most use cases." Its limitations: `response_format` is ignored, `strict` tool schemas are ignored, prompt caching is not supported, and system messages are hoisted — [Claude Docs – OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk)

**Botpress**
- The official Instagram integration: "allows your users to chat with your bot by messaging an Instagram account." The docs describe DMs only, with no comment events. There are two setup modes: **Botpress-managed** ("Authorize Instagram") or manual with your own Meta developer app. With your own app, "While the review is pending, your bot will work for admins, developers, and testers of the app only" — [Botpress Docs – Instagram](https://botpress.com/docs/integrations/integration-guides/instagram/)
- The Botpress Hub marketing page mentions the ability to "manage comments", but the documented features are DM features ("Reply automatically to Direct Messages", "Trigger workflows from Instagram messages"). Treat comment automation as unconfirmed — [Botpress Hub – Instagram](https://botpress.com/integrations/instagram). This contradicts the docs page above.
- A community Discord thread asks how to "Auto DM someone who comments on an Instagram post", which shows it is not a built-in feature. The answer was not verified — [Botpress Discord](https://discord.botpress.com/t/18852601/auto-dm-someone-who-comments-on-an-instagram-post)
- **Botpress is no longer self-hostable:** "Botpress v12 has been officially sunset and is no longer available for purchase, download, or new deployments." This covers all self-hosted versions, and new users must use Botpress Cloud — [Botpress Docs – v12](https://botpress.com/docs/studio/guides/advanced/v12/)

**Typebot**
- Typebot deploys to WhatsApp through "your own WhatsApp Business Platform which is the official service from Meta". The docs do not document native Instagram or Messenger channels — [Typebot Docs – WhatsApp](https://docs.typebot.com/deploy/whatsapp/overview)
- License: Functional Source License (FSL). Internal and commercial use and building bots for clients are allowed, but you may not build a competing chatbot SaaS. Each version converts to Apache 2.0 after two years — [Typebot LICENSE](https://github.com/baptistearno/typebot.io/blob/main/LICENSE); [Typebot self-hosting docs](https://docs.typebot.com/self-hosting/get-started)

**Hexabot**
- Channels: Facebook/Messenger, WhatsApp, Telegram, Discord and Slack, via extensions. Instagram is not listed — [Hexabot FAQ – channels](https://docs.hexabot.ai/faq/which-channels-are-supported-in-hexabot)
- `hexabot-channel-whatsapp` "adds official Meta WhatsApp Cloud API support to Hexabot v3" — [GitHub hexabot-channel-whatsapp](https://github.com/Hexastack/hexabot-channel-whatsapp)
- License "FCL-1.0-ALv2" (Fair Core License), about 1.3k stars. The repo topics list Claude, ChatGPT, Gemini, Mistral, DeepSeek, Llama and Ollama. Requires Node.js ^24.17; SQLite by default, Postgres for production — [GitHub Hexastack/hexabot](https://github.com/Hexastack/hexabot)

**ChatbotX (new, closest open-source ManyChat clone)**
- Described as an "Open source agentic chat marketing platform you can self-host, white-label, and resell." Channels: WhatsApp, Messenger, Instagram, Telegram, Zalo, TikTok, Email, Webchat — [OpenAlternative – ManyChat alternatives](https://openalternative.co/alternatives/manychat)
- The README claims the Community Edition is "released as open source under the MIT License". It lists comment-to-DM and Instagram integration, a "Drag-and-drop chatbot builder with 15+ node types", and AI providers "OpenAI, Claude, Gemini, DeepSeek, OpenRouter, NVIDIA NIM, and Local LLMs". Self-hosting uses a Docker Compose stack with PostgreSQL + pgvector, Redis, RustFS and MailHog, and you need your own Meta app credentials. 842 stars, 234 forks — [GitHub ChatbotXIO/ChatbotX](https://github.com/ChatbotXIO/ChatbotX)
- Pricing is "based on bot messages, not contact count". The self-hosted community plan is free, and white-label costs $299/month — [OpenAlternative – ChatbotX](https://openalternative.co/chatbotx)

**Tiledesk**
- A third-party review claims Tiledesk feeds "WhatsApp Business, Telegram, Facebook Messenger, Instagram Direct, email, and the embedded web widget" into one inbox. The backoffice is MIT-licensed — [EuropeanStack review](https://europeanstack.com/software/tiledesk); [GitHub Tiledesk](https://github.com/Tiledesk/tiledesk-server)
- Tiledesk's own feedback portal has an "Instagram DM channel | Feature" entry, but its status (shipped vs. requested) could not be read — [Tiledesk feedback](https://feedback.tiledesk.com/feedback/105458). No evidence found of Instagram comment triggers.

**Evolution API (WhatsApp gateway)**
- License: Apache 2.0 with brand-protection conditions ("LOGO/copyright preservation and Usage Notification requirement"). Connection types: Baileys (unofficial WhatsApp Web) and the official WhatsApp Cloud API. Native integrations: Typebot, Chatwoot, Dify, OpenAI, RabbitMQ, Kafka, SQS, S3/MinIO. About 9.7k stars. The README does not mention Instagram or Messenger — [GitHub EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api)
- Third-party and hosted-docs snippets claim "Evolution API v2+ supports WhatsApp, Instagram Direct, and Facebook Messenger through unified endpoints". This conflicts with the README and is unverified — [Evolution API docs (evoapicloud)](https://docs.evoapicloud.com/instances/overview)

**Rasa**
- Has a Facebook Messenger connector (verify token, secret and page-access-token in `credentials.yml`). No Instagram connector was found in the docs — [Rasa Docs – Facebook Messenger](https://rasa.com/docs/rasa/connectors/facebook-messenger/); [Rasa channels reference](https://rasa.com/docs/reference/channels/messaging-and-voice-channels/)

**Dify / Flowise / Langflow**
- Dify's marketplace has trigger plugins (GitHub, Notion, RSS, Telegram, Gmail, Slack, etc.) but no Instagram trigger plugin. The fallback is Dify's generic Webhook Trigger — [Dify Marketplace – triggers](https://marketplace.dify.ai/?category=trigger&language=en-US); [Dify Docs – Plugin Trigger](https://docs.dify.ai/en/use-dify/nodes/trigger/plugin-trigger)
- Langflow and Flowise expose generic webhook entry points and HTTP/webhook tools. No native Instagram channel was found — [Langflow – Trigger flows with webhooks](https://docs.langflow.org/webhook); [Flowise Integrations](https://docs.flowiseai.com/integrations)

**Activepieces**
- Community threads say Instagram can only be used as an output (action), with users asking for an Instagram trigger. No Instagram comment trigger was found — [Activepieces Community – Instagram as a trigger](https://community.activepieces.com/t/instagram-as-a-trigger/3819); [GitHub issue #465](https://github.com/activepieces/activepieces/issues/465)

**The underlying Meta API that any comment-to-DM tool must use**
- Private replies are sent with `POST /<IG_ID>/messages` with `recipient: {comment_id}`. They must be sent "within 7 days of the creation time of the comment", and "Only one message can be sent to the commenter". Follow-ups are allowed if the user replies (within 24 hours). Required permissions are `instagram_business_manage_comments` (Instagram Login) or `instagram_manage_comments` + `pages_read_engagement` (Facebook Login), plus webhook subscriptions to `comments` / `live_comments` — [Meta – Instagram Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies/)

### Inferences
- **Capability matrix (official-API only):**

| Platform | IG DMs | IG comment trigger / comment-to-DM | Messenger | WhatsApp Cloud API | Keyword triggers + flow builder | Claude | License | Self-host |
|---|---|---|---|---|---|---|---|---|
| **n8n** | Yes (Facebook Trigger "messages" + HTTP send) | **Yes** (Facebook Trigger "comments", or Webhook + Graph API private reply) | Yes (Facebook Trigger Page object + HTTP) | **Native node + trigger** | Yes (If/Switch nodes; not a chat-flow UI) | **Native** (Anthropic Chat Model + Anthropic node) | Sustainable Use License (fair-code) | Yes (free Community Edition) |
| **ChatbotX** | Yes (README) | Claimed (README), unverified | Yes (README) | Yes (README) | Yes (visual builder) | Claimed native | MIT (Community) | Docker Compose |
| **Chatwoot** | Yes | **No** (comments ignored) | Yes | Yes | Automation rules only; no chatbot flow builder (not verified in depth) | Only via "OpenAI-compatible endpoint" (not native; Captain is paid) | Core open-source (license not re-verified) | Yes |
| **Botpress** | Yes | Docs: no; Hub page ambiguous | Yes (not verified this session) | Yes (not verified this session) | Yes | Botpress Cloud LLM options not verified | — | **No** (Cloud only now) |
| **Typebot** | No | No | No | Yes | Yes | Via HTTP/OpenAI-compatible blocks (not verified) | FSL | Yes |
| **Hexabot** | No | No | Yes | Yes | Yes | Listed in topics | FCL-1.0-ALv2 | Yes |
| **Tiledesk** | Claimed (3rd party) | No evidence | Yes (3rd party) | Yes (3rd party) | Yes | Not verified | MIT | Yes |
| **Evolution API** | Unverified claim | No | Unverified claim | Yes (+ unofficial Baileys) | No (gateway only; pairs with Typebot/Chatwoot/Dify) | Via Dify/OpenAI integrations | Apache 2.0 + conditions | Yes |
| **Rasa** | No | No | Yes | Not verified | Yes (code/YAML) | Not verified | — | Yes |
| **Dify / Flowise / Langflow** | No native | No native | No native | No native | LLM flow builders; need a webhook bridge | Anthropic provider likely (not verified this session) | various | Yes |
| **Activepieces** | No trigger | No | Not verified | Not verified | Yes | Not verified | MIT (not verified) | Yes |

- For a DIY stack, the most practical architecture is **n8n as the Meta webhook receiver, router, and Claude caller**. Chatwoot can optionally be added as the human-handoff inbox for DMs, but it cannot act on comments.
- Chatwoot + Claude would need an OpenAI-compatible proxy (Anthropic's compat endpoint, or a proxy such as LiteLLM/OpenRouter). Anthropic explicitly says the compat layer is not production-grade, and Captain also needs a paid plan ($19+/agent/mo). This is a weak fit for "Claude-first".
- ChatbotX is the only open-source project found that is positioned as a direct ManyChat clone with comment-to-DM and BYO Claude. It is young (hundreds of stars) and its claims were not tested; do a hands-on proof of concept before relying on it.

### Gaps
- Could not verify whether ChatbotX's comment-to-DM uses the official Private Replies API or how mature it is. No independent reviews were found.
- Could not confirm whether Tiledesk's Instagram channel is shipped or only requested, or whether Evolution API v2 really supports Instagram/Messenger (the README is silent).
- Did not verify the LLM provider lists of Dify, Flowise, Langflow or Typebot (widely reported to include Anthropic, but not checked this session), or Botpress Cloud's model options.
- Did not research Node-RED (e.g. community Meta/Instagram nodes) or "OpenChatbot". No reliable sources were retrieved on either.
- Did not confirm whether Chatwoot Captain works reliably against Anthropic's OpenAI-compat endpoint. There are no docs or reports on this.
- Chatwoot's exact license (MIT core with an enterprise folder) was not re-verified this session.

---

## Q2. n8n specifically: native nodes, ready-made templates (Instagram comment→DM, Instagram DM AI agent, Claude), license and pricing

### Takeaway
n8n is the strongest self-hosted ManyChat replacement. Its native Facebook Trigger subscribes to Instagram `comments`, `messages` and `mentions` webhooks, it has native WhatsApp Business Cloud action and trigger nodes, and it has native Anthropic nodes. Sending Instagram DMs and private replies uses the HTTP Request node against the Graph API. Several ready-made templates cover comment→DM and AI DM agents. None found pairs Instagram with Claude out of the box, but templates say the LLM sub-node can be swapped for Anthropic. The Community Edition is free to self-host under the Sustainable Use License (fine for your own business, not for reselling). Cloud starts at €20/mo.

### Cited Findings

**Native nodes**
- The Facebook Trigger node with the **Instagram object** supports these events: Comments ("Notifies you when anyone comments on an IG Media owned by your app's Instagram user"), Mentions, Messages ("when anyone messages your app's Instagram user"), Messaging Seen, Messaging Handover, Standby and Story Insights. It requires a Facebook App credential, and the Instagram object "fails without" the Include Values option enabled — [n8n Docs – Facebook Trigger Instagram](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.facebooktrigger/instagram)
- The Facebook Trigger also has a Page object for Messenger/Page events — [n8n Docs – Facebook Trigger Page](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.facebooktrigger/page/)
- A known issue reports "Facebook Trigger (Instagram, Message) not getting the message", so reliability varies. Many templates use a plain Webhook node instead — [GitHub n8n issue #12456](https://github.com/n8n-io/n8n/issues/12456)
- WhatsApp: there is a native **WhatsApp Business Cloud** action node and a **WhatsApp Trigger** node — [n8n Docs – WhatsApp Business Cloud](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.whatsapp); [n8n Docs – WhatsApp Trigger](https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.whatsapptrigger)
- Claude: the native **Anthropic Chat Model** sub-node plugs into AI Agent nodes ("use Anthropic's Claude family of chat models with conversational agents"), and there is also a standalone **Anthropic** app node — [n8n Docs – Anthropic Chat Model](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatanthropic); [n8n Docs – Anthropic node](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-langchain.anthropic); [n8n Anthropic integrations](https://n8n.io/integrations/anthropic/)
- There is no dedicated native "Instagram send DM" node. A community node `@mookielianhd/n8n-nodes-instagram` wraps the Instagram Graph API — [GitHub MookieLian/n8n-nodes-instagram](https://github.com/MookieLian/n8n-nodes-instagram)

**Templates on n8n.io/workflows (URLs, nodes, AI)**
- **#15206 "Send Instagram auto DMs to post commenters using Meta Graph API"** by Salman Mehboob (Verified Creator). Nodes: Webhook, HTTP Request (Graph API), If, Edit Fields. It fires a DM when a follower comments a keyword ("DM", "Link", "Guide"), is post-specific, and "Ignores your own replies so it doesn't trigger an infinite loop". It uses no AI and requires a Meta app with `instagram_manage_comments` + `instagram_manage_messages`. This is the closest template to ManyChat's classic comment→DM — [n8n #15206](https://n8n.io/workflows/15206-send-instagram-auto-dms-to-post-commenters-using-meta-graph-api/)
- **#16300 "Reply to Instagram and Facebook comments via Meta webhooks and DMs"** by Pawel Jurczyk. Nodes: HTTP Request, If, Set, plus 4 more. It handles the webhook verification handshake and then posts a public reply and/or private DM. It uses no AI. Permissions: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`; for FB Pages, `pages_manage_engagement`, `pages_read_engagement`, `pages_messaging` — [n8n #16300](https://n8n.io/workflows/16300-reply-to-instagram-and-facebook-comments-via-meta-webhooks-and-dms/)
- **#18455 "Reply to Instagram comments and send DMs with Facebook Graph API and Gemini"**. It receives IG webhook events (GET returns `hub.challenge`, POST receives events) and generates a public reply plus an optional follow-up DM with Gemini. The LLM can in principle be swapped for Anthropic — [n8n #18455](https://n8n.io/workflows/18455-reply-to-instagram-comments-and-send-dms-with-facebook-graph-api-and-gemini/)
- **#14026 "Auto-reply to Instagram DMs with an AI chatbot and Google Gemini history"** by Nguyễn Thiệu Toàn (Jay Nguyen). Nodes: Webhook, AI Agent, Google Gemini Chat Model, n8n Data Table (memory), HTTP Request (send via Graph API). It needs a long-lived token and a publicly reachable n8n. The template states: "Swap the `Google Gemini Chat Model` sub-node for any other supported LLM (OpenAI, Anthropic, etc.)" — [n8n #14026](https://n8n.io/workflows/14026-auto-reply-to-instagram-dms-with-an-ai-chatbot-and-google-gemini-history/)
- **#6632 "Auto-respond to Instagram, Facebook & WhatsApp with Llama 3.2"** by Oneclick AI Squad. Nodes: Webhook, WhatsApp Trigger, HTTP Request, Ollama Chat Model. It covers all three channels in one workflow — [n8n #6632](https://n8n.io/workflows/6632-auto-respond-to-instagram-facebook-and-whatsapp-with-llama-32/)
- **#3713 "Automated Instagram comment replies using Gemini AI with context-aware responses"** does public comment replies with an AI agent — [n8n #3713](https://n8n.io/workflows/3713-automated-instagram-comment-replies-using-gemini-ai-with-context-aware-responses/)
- **#3896 "Instagram MCP AI agent – read, reply & manage comments with GPT-4o"** uses Graph API tools exposed via an MCP Server — [n8n #3896](https://n8n.io/workflows/3896-instagram-mcp-ai-agent-read-reply-and-manage-comments-with-gpt-4o/)
- **#6205 "Automate Instagram comment responses with Google Sheets & CRM tracking"** does keyword-based predefined responses via the Graph API — [n8n #6205](https://n8n.io/workflows/6205-automate-instagram-comment-responses-with-google-sheets-and-crm-tracking/)
- **#5941 "Automated Instagram comment response with DMs & Google Sheets tracking"** by Juan Carlos Cavero Gracia. It **polls every 15 min** with a Schedule Trigger and sends DMs through the third-party **upload-post.com API**, not directly through Meta. It uses no AI — [n8n #5941](https://n8n.io/workflows/5941-automated-instagram-comment-response-with-dms-and-google-sheets-tracking/)
- **#2718 "AI agent for Instagram DM/inbox. Manychat + Open AI integration"** still depends on ManyChat, so it is not a replacement — [n8n #2718](https://n8n.io/workflows/2718-ai-agent-for-instagram-dminbox-manychat-open-ai-integration/)
- A site search for Instagram + Claude templates returned only content-publishing workflows, such as "Publish Instagram Reels from Notion with Claude captions" (#14658). None were DM or comment automation — [n8n #14658](https://n8n.io/workflows/14658-publish-instagram-reels-from-notion-with-claude-captions-and-uploadtourl/); [n8n Social Media category](https://n8n.io/workflows/categories/social-media/)

**License and pricing**
- Sustainable Use License: "You may use or modify the software only for your own internal business purposes or for non-commercial or personal use", and "You may distribute the software or provide it to others only if you do so free of charge for non-commercial purposes." Files with `.ee.` in the name are under the separate n8n Enterprise License — [n8n LICENSE.md](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)
- Pricing, annual billing, EUR: Cloud **Starter €20/mo** (2.5K executions, 5 concurrent, 2,300 AI credits); Cloud **Pro €50/mo** (10K executions, 20 concurrent); **Business €667/mo**, self-hosted (40K executions, SSO/SAML/LDAP); **Enterprise** custom. The **Community Edition is free** to self-host — [n8n Pricing](https://n8n.io/pricing/)

### Inferences
- Recommended DIY build: start from #15206 or #16300 for comment→private-reply mechanics, graft in the AI Agent + Anthropic Chat Model pattern from #14026 (swap Gemini for Anthropic), and add WhatsApp via the native WhatsApp Trigger / WhatsApp Business Cloud nodes (#6632 pattern).
- For a creator running automation on their own account, self-hosted n8n Community Edition falls under "internal business purposes", so the license is free. Reselling n8n-powered DM automation to clients as a hosted service would conflict with the license.
- Self-hosted cost is roughly the VPS (a small instance) plus Claude API usage, with no per-contact fees. The trade-off is maintaining an HTTPS webhook endpoint and handling Meta token refresh and App Review yourself. VPS price was not researched here.
- Each comment→DM plus AI reply is 1 n8n execution. On n8n Cloud Starter, 2.5K executions/mo may be exhausted by one viral post (inference; depends on volume).

### Gaps
- No n8n.io template found that is specifically "Instagram comment-to-DM + Anthropic/Claude". Claude must be swapped in manually.
- Did not verify whether n8n Cloud prices shown are EUR only or also offered in USD, or the monthly (non-annual) prices.

---

## Q3. Make.com and Zapier as "no-code, no-ManyChat" options (not self-hosted)

### Takeaway
Make is workable but clunky. Its Instagram for Business app has a generic "Watch events" trigger, comment-reply actions and a full Anthropic Claude app (21 modules), but no listed "send DM / private reply" module, so DMs need a raw Graph API call. Zapier is not viable for comment-to-DM: its Instagram for Business app only has media triggers and publish actions.

### Cited Findings
- Make **Instagram for Business (Facebook login)** triggers: "Watch events" ("Triggers when the subscribed event is received"), "Watch media", "Watch public user posts". Actions: create photo/reel/carousel posts, list posts, list post comments, list comment replies, **Create a comment**, **Create a reply**, list stories, insights. **No send-message or private-reply module is listed** — [Make Apps – Instagram for Business](https://apps.make.com/instagram-business); [Make – Instagram for Business + Anthropic Claude](https://www.make.com/en/integrations/instagram-business/anthropic-claude)
- The Make **Anthropic Claude** app has 21 modules, including "Create a Prompt", "Simple Text Prompt", Skills and Files modules — [Make – Instagram for Business + Anthropic Claude](https://www.make.com/en/integrations/instagram-business/anthropic-claude)
- Make also lists an **Inrō – Instagram DM Automation** app that integrates with Anthropic Claude, which is a hybrid option: Inrō for Meta plumbing, Claude via Make — [Make – Inro + Anthropic Claude](https://www.make.com/en/integrations/inro/anthropic-claude)
- Make pricing (credits; 1 module action = 1 credit): Free $0 (1,000 credits/mo), Core $9, Pro $16, Teams $29 (each for 10,000 credits/mo), Enterprise custom. These appear to be annual-billed prices — [Make Pricing](https://www.make.com/en/pricing)
- Zapier **Instagram for Business** triggers: only "New Media Posted in my Account" and "New Tagged Media". Actions: "Publish Photo(s)" and "Publish Video" — [Zapier – Instagram for Business integrations](https://zapier.com/apps/instagram-for-business/integrations)
- A Zapier template titled "Respond to new Instagram comments that meet criteria" exists, which conflicts with the app's trigger list above. It was not verified and may rely on a third-party app — [Zapier template](https://zapier.com/templates/details/a6c48d0313b867be913b90d4be4b1ce3322ae426ce5792d91e1dc8a2598e8ae7)
- Zapier pricing: Free (100 tasks/mo); Professional from $29.99/mo monthly or $19.99/mo annual (750 tasks); Team from $103.50/mo monthly or $69/mo annual (2,000 tasks); Enterprise custom — [Zapier Pricing](https://zapier.com/pricing)

### Inferences
- Make with "Watch events" plus an HTTP "Make an API call" to `/{ig-id}/messages` with `recipient.comment_id` should be able to do comment→Claude→private reply. Because Make uses its own Meta app, this may avoid your own App Review (inference; not verified in Make docs). A multi-step scenario uses about 4–6 credits per comment, so the 10K-credit plans cover roughly 1.5–2.5K comment→DM events/mo.
- Zapier should be excluded for Instagram comment-to-DM.

### Gaps
- Could not confirm which webhook fields Make's "Watch events" subscribes to (comments, messages, mentions), or whether Make offers an "Instagram (Instagram login)" app with messaging modules.
- Did not check Make/Zapier WhatsApp Business Cloud or Messenger modules in detail.

---

## Q4. Meta requirements: own Meta app, App Review, Business Verification — and who lets you skip them?

### Takeaway
Every self-hosted option (n8n, Chatwoot, ChatbotX, Typebot, Hexabot, Evolution Cloud-API mode) requires your own Meta developer app. Going live for the public requires Advanced Access through App Review and Business Verification. Until then, the bot only works for app admins, developers and testers. Hosted SaaS tools (Botpress-managed Instagram, Chatwoot Cloud, ManyChat, InstantDM, LinkDM, Inrō, CreatorFlow) use their own already-approved Meta app. Their status is Meta "Business Partner" or "Tech Provider", which is how their users skip App Review.

### Cited Findings
- Chatwoot self-hosted: "Before you can start using your Facebook app in production, you will have to get it verified by Facebook". Advanced access is required for `instagram_manage_messages`, `pages_messaging`, `business_management`, etc. — [Chatwoot Developer Docs](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/instagram-channel-setup)
- Botpress with your own Meta app: "While the review is pending, your bot will work for admins, developers, and testers of the app only. After your app is approved and made public, it will work for the general public as well". Botpress also offers a **Botpress-managed** "Authorize Instagram" path — [Botpress Docs – Instagram](https://botpress.com/docs/integrations/integration-guides/instagram/)
- The n8n templates all require the user's own Meta Developer App with `instagram_manage_comments` / `instagram_manage_messages` (Facebook-login variant) or `instagram_business_manage_comments` / `instagram_business_manage_messages` (Instagram-login variant) — [n8n #15206](https://n8n.io/workflows/15206-send-instagram-auto-dms-to-post-commenters-using-meta-graph-api/); [n8n #16300](https://n8n.io/workflows/16300-reply-to-instagram-and-facebook-comments-via-meta-webhooks-and-dms/)
- ChatbotX self-hosted: "Users need their own Meta app credentials" — [GitHub ChatbotXIO/ChatbotX](https://github.com/ChatbotXIO/ChatbotX)
- Meta status claimed by commercial tools (vendor-authored comparison, InstantDM's own site): InstantDM "Business Partner"; ManyChat "Business Partner"; LinkDM "Business Partner"; Inrō "Tech Provider"; CreatorFlow "Tech Provider"; ReplyRush "Meta-approved developer" — [InstantDM comparison](https://instantdm.com/best-instagram-dm-automation-tools)

### Inferences
- Choosing Botpress's managed Instagram auth, Chatwoot Cloud's "Continue with Instagram", or Make's hosted Instagram connection most likely means the platform's approved app is used, so the user skips App Review. This follows from how the docs describe the managed flows, but none of these docs state it explicitly.
- If the user controls only their own IG account (they are the app's admin), a self-hosted Meta app in Development mode can already message people who comment. However, Meta limits non-reviewed apps to users with a role on the app (per the Botpress quote). So for real followers, App Review + Business Verification is effectively mandatory for any self-hosted build. The exact standard- vs. advanced-access rules for own-account use were not verified here and are covered by other research.

### Gaps
- Did not find a Meta directory entry confirming Business Partner or Tech Provider status for any open-source project. None of the self-hosted platforms appear to offer a way to skip App Review.
- Did not verify current (2026) Meta rules on whether an app used only on the developer's own business account needs Advanced Access.

---

## Q5. Commercial ManyChat competitors (comparison point): cheaper options and bring-your-own-Claude-key

### Takeaway
Several hosted tools undercut ManyChat and include comment-to-DM (InstantDM $9.99/mo, CreatorFlow $15, LinkDM $19, Inrō €12.99). No mainstream competitor was found that documents a bring-your-own-Anthropic-key option. AI replies are either vendor-managed (Inrō, InstantDM) or absent (LinkDM; CreatorFlow "coming soon"). The only ways to get BYO Claude found were self-hosted (n8n, ChatbotX) or pairing a SaaS with Make (Inrō + Claude).

### Cited Findings
- From the vendor-authored InstantDM comparison (2026):
  - InstantDM: $9.99/mo, free plan with 500 automations/mo, comment-to-DM, goal-based AI agent included, flat and unlimited.
  - ManyChat: $17/mo, free plan with 25 contacts, AI as steps plus an add-on, per-contact pricing ("roughly $914 on Pro monthly billing" in a viral week).
  - ReplyRush: $10/mo.
  - LinkDM: $19/mo, 1,000 free DMs/mo, no AI listed.
  - Inrō: €12.99/mo, 100 free contacts, native multi-turn AI, Instagram only.
  - CreatorFlow: $15/mo, 500 free DMs/mo, AI "coming soon", Instagram only.
  - [InstantDM – Best Instagram DM automation tools](https://instantdm.com/best-instagram-dm-automation-tools). Note the source is a vendor comparing itself.
- InstantDM also offers an API and MCP server, and Blotato is "built as an API for agents such as ChatGPT, Claude…". Both are search-snippet claims, not verified — [InstantDM blog](https://instantdm.com/blog/top-15-manychat-alternatives-for-instagram-automation-in-2026); [FlowGent](https://flowgent.ai/manychat-alternative)
- FlowGent claims it "uses GPT-4 and Claude" trained on your data, covers Instagram, WhatsApp, Slack and web, and costs from $19/mo with per-message pricing. This is a vendor claim — [FlowGent](https://flowgent.ai/manychat-alternative)
- Respond.io: cheapest plan $79/mo (annual), unlimited contacts, all channels, limited AI, no free plan (7-day trial). Chatfuel: entry around $23.99–$34.99/mo (third-party estimate). SendPulse: free entry tier, with keyword chatbots for Instagram DMs, comments and Story replies — [respond.io blog](https://respond.io/blog/best-instagram-chatbots); [Tomba – Chatfuel pricing](https://tomba.io/blog/chatfuel-pricing-reviews-pros-and-cons); [SendPulse – ManyChat alternatives](https://sendpulse.com/blog/manychat-alternatives)

### Inferences
- For a creator whose goal is comment→DM with occasional AI, a $10–$19/mo hosted tool is cheaper in total effort than self-hosting, because it skips App Review, hosting and maintenance. The self-hosted n8n + Claude route wins when the user specifically wants Claude, full control of prompts and data, multi-channel logic (IG + Messenger + WhatsApp) in one place, or no per-contact pricing at scale.

### Gaps
- No pricing page was fetched directly for CreatorFlow, LinkDM, Inrō, Chatfuel, SendPulse or respond.io. The figures come from comparison articles, often written by competitors, and should be re-checked.
- Found no documentation of any commercial tool that accepts the user's own Anthropic API key.
