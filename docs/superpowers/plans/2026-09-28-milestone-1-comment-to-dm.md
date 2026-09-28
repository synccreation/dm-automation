# Milestone 1: Comment-to-DM Core + Go/No-Go — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Cloudflare Worker that sends a public reply and a DM with a tracked link about 1–2 minutes after someone comments a keyword, plus the admin API and CLI needed to connect Instagram and manage rules. Ends with the live go/no-go test from spec §9.

**Architecture:** One Hono app on Cloudflare Workers with a D1 database and a once-a-minute cron. `POST /webhook` only verifies, parses and enqueues. The cron scheduler sends due actions through a thin Instagram Graph API client. A bearer-protected `/admin` API is driven by `npm run cli`.

**Tech Stack:** TypeScript (strict), Hono 4, Wrangler 4, Cloudflare D1, Vitest 4.1 with `@cloudflare/vitest-plugin`, tsx for the CLI.

**Spec:** `docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md`

**Scope of this plan:** spec §5.1 without the follow gate, §6 (routes marked M1 below), §7 due-action processing, §8, and §9 rollout steps 1–2.
- **M1 routes:** `/webhook`, `/l/:code`, `/auth/callback`, `/admin/auth/start`, `/admin/health`, `/admin/rules`, `/admin/media`, `/admin/actions/recent`, and the legal pages.
- **Left for milestone 2** (planned after the go/no-go passes): the follow gate (§5.2), story replies (§5.3), inbox and echoes (§5.4–5.5), `/dms` and `business.md` (§5.6), stats, the missed-comment sweep, and token refresh.

## Global Constraints

- Node ≥ 24 and npm ≥ 11 (installed: Node 24.14, npm 11.9). Commands are run from the repo root in Git Bash.
- Cloudflare Workers Free plan only. No paid services and no Claude API key.
- Graph API host `graph.instagram.com`, version from the `GRAPH_API_VERSION` var, `v25.0`.
- The opening DM and public reply use `send_at = now + 60s + random(0–10s)`, sent by a cron that runs every minute (`* * * * *`).
- At most 12 `private_reply` + `public_reply` sends per scheduler run.
- Transient failures retry after 1, 5, then 15 minutes; after that they are marked `failed`. Private replies to comments older than 7 days are marked `dropped`.
- Secrets are set with `wrangler secret put`: `IG_APP_ID`, `IG_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `ADMIN_TOKEN`, and optionally `META_APP_SECRET`. `.env` and `.dev.vars` are never committed.
- Only `src/instagram.ts` and `src/auth.ts` call Meta. Only `src/db/*` issues SQL (test helpers excepted).
- All timestamps are Unix epoch milliseconds.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **Emoji-only keyword (for example `🔥`):** the creator expects either that it works or a clear error. Rule creation rejects it with a message saying emoji-only keywords aren't supported. (Task 9 test.)
2. **The creator's own comment contains the keyword** (for example while replying to fans): no DM to themselves. (Task 7 test.)
3. **Meta redelivers the same webhook, or the same person comments the keyword twice on one post:** exactly one opening DM. (Task 7 tests.)
4. **Webhook payload variants** (`entry.field/value` instead of `entry.changes`, numeric IDs, reactions and read receipts): parsed or skipped, never a 500. (Task 5 tests.)
5. **The scheduler runs before Instagram is connected:** nothing crashes, nothing is lost, and actions stay pending. (Task 8 test.)

## File Structure

```
package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, .env.example, .dev.vars.example, README.md
migrations/0001_init.sql         # full schema from spec §4 (milestone 2 reuses it)
src/env.ts                       # AppEnv bindings type
src/index.ts                     # Hono app: routes + scheduled handler
src/time.ts                      # delay, 7-day cutoff, retry schedule (pure)
src/rules.ts                     # keyword matching + templates (pure)
src/messages.ts                  # OutgoingMessage / Button types
src/db/settings.ts, links.ts, rules.ts, contacts.ts, events.ts, actions.ts
src/instagram.ts                 # Graph API client (injectable fetch)
src/account.ts                   # InstagramClient from stored settings
src/webhook/verify.ts            # handshake + HMAC signature
src/webhook/parse.ts             # payload → typed events
src/webhook/handle.ts            # comment flow (spec §5.1)
src/links.ts                     # tracked links + redirect
src/pages.ts                     # HTML pages (legal, OAuth result)
src/actions.ts                   # execute one queued action
src/scheduler.ts                 # cron processing
src/rule-input.ts                # admin rule validation
src/health.ts                    # status summary
src/admin.ts                     # bearer-protected admin API
src/auth.ts                      # Instagram Login OAuth
scripts/cli-core.ts, scripts/dm-cli.ts, scripts/tsconfig.json
test/setup.ts, test/helpers.ts, test/factories.ts, test/fixtures.ts, test/*.test.ts, test/tsconfig.json
docs/setup.md                    # Meta + Cloudflare setup and go/no-go guide
```

---

### Task 1: Project scaffold, schema and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `test/tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `migrations/0001_init.sql`, `src/env.ts`, `src/index.ts`, `test/setup.ts`, `test/helpers.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Produces:
  - `AppEnv` (from `src/env.ts`)
  - `app: Hono<{ Bindings: AppEnv }>` exported from `src/index.ts`
  - Test helpers in `test/helpers.ts`: `testEnv: AppEnv`, `IG_USER_ID = "17840000000000001"`, `resetDb(): Promise<void>`, `jsonResponse(body, status?)`, `fakeFetch(handler)`, `stubGlobalFetch(handler)`, `seedConnectedAccount()`, `type FetchCall`

- [ ] **Step 1: Create `package.json` and install dependencies**

```json
{
  "name": "dm-automation",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit && tsc --noEmit -p test",
    "types": "wrangler types",
    "cli": "tsx scripts/dm-cli.ts"
  }
}
```

Run:
```bash
npm i hono@^4
npm i -D wrangler@^4 vitest@^4.1.0 @cloudflare/vitest-plugin typescript@^5 tsx@^4 @types/node@^24
```
Expected: installs without peer-dependency errors.

- [ ] **Step 2: Create `tsconfig.json` and `test/tsconfig.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "worker-configuration.d.ts"]
}
```

`test/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["@cloudflare/vitest-plugin/types"] },
  "include": ["./**/*.ts", "../src/**/*.ts", "../worker-configuration.d.ts"]
}
```

- [ ] **Step 3: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dm-automation",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "observability": { "enabled": true },
  "triggers": { "crons": ["* * * * *"] },
  "vars": {
    "GRAPH_API_VERSION": "v25.0",
    // Replaced with the real workers.dev URL in Task 12.
    "PUBLIC_URL": "https://dm-automation.YOUR-SUBDOMAIN.workers.dev",
    // Shown on the privacy / data-deletion pages Meta requires. Set in Task 12.
    "CONTACT_EMAIL": "you@example.com"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dm-automation",
      // Replaced with the real ID from `wrangler d1 create` in Task 12.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 4: Create `migrations/0001_init.sql`**

```sql
-- Initial schema (spec §4). All timestamps are Unix epoch milliseconds.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,              -- JSON array of strings
  scope TEXT NOT NULL DEFAULT 'all',   -- 'all' or JSON array of media IDs
  on_comment INTEGER NOT NULL DEFAULT 1,
  on_story_reply INTEGER NOT NULL DEFAULT 0,
  public_replies TEXT NOT NULL DEFAULT '[]',
  opening_text TEXT NOT NULL,
  button_label TEXT NOT NULL,
  follow_gate INTEGER NOT NULL DEFAULT 0,
  not_following_text TEXT NOT NULL DEFAULT '',
  link_text TEXT NOT NULL DEFAULT '',
  link_button_label TEXT NOT NULL DEFAULT 'Open',
  link_id INTEGER REFERENCES links(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE contacts (
  igsid TEXT PRIMARY KEY,
  username TEXT,
  name TEXT,
  follows_me INTEGER,
  follows_checked_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_inbound_at INTEGER
);

CREATE TABLE processed_events (
  event_key TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE TABLE triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rules(id),
  contact_igsid TEXT NOT NULL,
  media_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('comment', 'story_reply')),
  comment_id TEXT,
  comment_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (rule_id, contact_igsid, media_id)
);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('private_reply', 'public_reply', 'dm')),
  trigger_id INTEGER REFERENCES triggers(id),
  contact_igsid TEXT NOT NULL,
  payload TEXT NOT NULL,               -- JSON ActionPayload
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dropped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at INTEGER,
  sent_at INTEGER,
  sent_mid TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX actions_due ON actions (status, send_at);

CREATE TABLE messages (
  mid TEXT PRIMARY KEY,
  contact_igsid TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'bot', 'creator_app', 'creator_dms')),
  text TEXT,
  attachments TEXT,
  is_trigger INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_contact ON messages (contact_igsid, created_at);

CREATE TABLE conversations (
  contact_igsid TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('needs_reply', 'answered', 'skipped')),
  last_inbound_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  contact_igsid TEXT,
  clicked_at INTEGER NOT NULL
);
CREATE INDEX clicks_link ON clicks (link_id);
```

- [ ] **Step 5: Create `vitest.config.ts` and `test/setup.ts`**

`vitest.config.ts`:
```ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            IG_APP_ID: "test-app-id",
            IG_APP_SECRET: "test-app-secret",
            WEBHOOK_VERIFY_TOKEN: "test-verify-token",
            ADMIN_TOKEN: "test-admin-token",
            PUBLIC_URL: "https://dm.test",
            CONTACT_EMAIL: "creator@example.com",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      // Test files share one local D1; run them one at a time so resetDb() in one
      // file can never wipe rows another file is using.
      fileParallelism: false,
    },
  };
});
```

If the installed version exports `readD1Migrations` from `@cloudflare/vitest-plugin/config` instead of the package root, change only that import. Cloudflare's docs show both.

`test/setup.ts`:
```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

const setupEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(setupEnv.DB, setupEnv.TEST_MIGRATIONS);
```

- [ ] **Step 6: Create `test/helpers.ts`**

```ts
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import type { AppEnv } from "../src/env";

export const testEnv = env as unknown as AppEnv;
export const IG_USER_ID = "17840000000000001";

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
    ["ig_access_token", "test-token"],
    ["ig_user_id", IG_USER_ID],
    ["ig_username", "creator"],
  ];
  await testEnv.DB.batch(
    rows.map(([key, value]) =>
      testEnv.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind(key, value),
    ),
  );
}
```

- [ ] **Step 7: Write the failing test `test/index.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { resetDb, testEnv } from "./helpers";

describe("worker scaffold", () => {
  beforeEach(resetDb);

  it("answers on /", async () => {
    const res = await app.request("/", {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dm-automation: ok");
  });

  it("creates every table from the initial migration", async () => {
    const { results } = await testEnv.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    const names = results
      .map((r) => r.name)
      .filter((n) => !n.startsWith("_cf") && !n.startsWith("sqlite_") && n !== "d1_migrations");
    expect(names).toEqual([
      "actions", "clicks", "contacts", "conversations", "links",
      "messages", "processed_events", "rules", "settings", "triggers",
    ]);
  });
});
```

- [ ] **Step 8: Run the test and confirm it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL, because `../src/index` cannot be resolved.

- [ ] **Step 9: Create `src/env.ts` and `src/index.ts`**

`src/env.ts`:
```ts
export interface AppEnv {
  DB: D1Database;
  IG_APP_ID: string;
  IG_APP_SECRET: string;
  /** Optional: the Meta app secret, accepted as a second webhook signing key. */
  META_APP_SECRET?: string;
  WEBHOOK_VERIFY_TOKEN: string;
  ADMIN_TOKEN: string;
  PUBLIC_URL: string;
  GRAPH_API_VERSION: string;
  CONTACT_EMAIL: string;
}
```

`src/index.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv } from "./env";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
```

- [ ] **Step 10: Generate runtime types, then run the tests and typecheck**

Run: `npx wrangler types && npx vitest run test/index.test.ts && npm run typecheck`
Expected: `worker-configuration.d.ts` is created; 2 tests pass; typecheck exits 0.
- If Vitest reports that `compatibility_date` is in the future, set it to the date the error suggests.
- If the plugin rejects the config shape, compare with `node_modules/@cloudflare/vitest-plugin/README.md` and adjust only `vitest.config.ts` or `test/setup.ts`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json test/tsconfig.json wrangler.jsonc vitest.config.ts migrations src test worker-configuration.d.ts
git commit -m "feat: scaffold worker, D1 schema and test harness"
```

---

### Task 2: Pure helpers for timing and keyword rules

**Files:**
- Create: `src/time.ts`, `src/rules.ts`
- Test: `test/time.test.ts`, `test/rules.test.ts`

**Interfaces:**
- Produces from `src/time.ts`:
  - constants `MINUTE`, `HOUR`, `DAY`
  - `openingSendAt(now: number, random?: () => number): number`
  - `isPrivateReplyExpired(commentAt: number, now: number): boolean`
  - `retryDelayMs(attemptsMade: number): number | null`
- Produces from `src/rules.ts`:
  - `type Scope = "all" | string[]`
  - `type TriggerSource = "comment" | "story_reply"`
  - `interface MatchableRule { id; keywords; scope; on_comment; on_story_reply; active }`
  - `normalizeText(text): string`
  - `matchesKeyword(text, keyword): boolean`
  - `findMatchingRule<R extends MatchableRule>(rules: R[], text: string, mediaId: string, source: TriggerSource): R | null`
  - `fillTemplate(template: string, vars: Record<string, string>): string`

- [ ] **Step 1: Write the failing tests**

`test/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DAY, MINUTE, isPrivateReplyExpired, openingSendAt, retryDelayMs } from "../src/time";

describe("openingSendAt", () => {
  it("is 60 seconds after now with zero jitter", () => {
    expect(openingSendAt(1_000, () => 0)).toBe(61_000);
  });
  it("adds less than 10 seconds of jitter", () => {
    expect(openingSendAt(1_000, () => 0.999999)).toBe(1_000 + 60_000 + 9_999);
  });
});

describe("isPrivateReplyExpired", () => {
  it("still allows a reply at exactly 7 days", () => {
    expect(isPrivateReplyExpired(0, 7 * DAY)).toBe(false);
  });
  it("expires after 7 days", () => {
    expect(isPrivateReplyExpired(0, 7 * DAY + 1)).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("backs off 1, 5 and 15 minutes, then gives up", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([MINUTE, 5 * MINUTE, 15 * MINUTE, null]);
  });
});
```

`test/rules.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fillTemplate, findMatchingRule, matchesKeyword, type MatchableRule } from "../src/rules";

describe("matchesKeyword", () => {
  it.each([
    ["guide", "guide"],
    ["Guide!", "guide"],
    ["GUIDE 🙏", "guide"],
    ["send me the guide please", "guide"],
    ["Free-guide pls", "free guide"],
    ["GUÍA", "guía"],
  ])("matches %j for keyword %j", (text, keyword) => {
    expect(matchesKeyword(text, keyword)).toBe(true);
  });

  it.each([
    ["guidebook", "guide"],
    ["gui de", "guide"],
    ["", "guide"],
    ["🔥🔥", "🔥"],
  ])("does not match %j for keyword %j", (text, keyword) => {
    expect(matchesKeyword(text, keyword)).toBe(false);
  });
});

describe("findMatchingRule", () => {
  const rule = (overrides: Partial<MatchableRule>): MatchableRule => ({
    id: 1, keywords: ["guide"], scope: "all", on_comment: true, on_story_reply: false, active: true,
    ...overrides,
  });

  it("returns the lowest-id matching rule", () => {
    const rules = [rule({ id: 7 }), rule({ id: 3 })];
    expect(findMatchingRule(rules, "guide", "m1", "comment")?.id).toBe(3);
  });

  it("skips inactive rules", () => {
    expect(findMatchingRule([rule({ active: false })], "guide", "m1", "comment")).toBeNull();
  });

  it("respects the media scope", () => {
    const scoped = rule({ scope: ["m2"] });
    expect(findMatchingRule([scoped], "guide", "m1", "comment")).toBeNull();
    expect(findMatchingRule([scoped], "guide", "m2", "comment")?.id).toBe(1);
  });

  it("respects the trigger source", () => {
    expect(findMatchingRule([rule({})], "guide", "s1", "story_reply")).toBeNull();
    expect(findMatchingRule([rule({ on_story_reply: true })], "guide", "s1", "story_reply")?.id).toBe(1);
  });
});

describe("fillTemplate", () => {
  it("replaces known variables and leaves unknown ones", () => {
    expect(fillTemplate("Hi {name}, {x}", { name: "anna" })).toBe("Hi anna, {x}");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/time.test.ts test/rules.test.ts`
Expected: FAIL, because the modules `../src/time` and `../src/rules` are not found.

- [ ] **Step 3: Implement `src/time.ts` and `src/rules.ts`**

`src/time.ts`:
```ts
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const OPENING_DELAY_MS = 60_000;
const OPENING_JITTER_MS = 10_000;
const PRIVATE_REPLY_MAX_AGE_MS = 7 * DAY;
const RETRY_SCHEDULE_MS = [MINUTE, 5 * MINUTE, 15 * MINUTE];

/** When the opening DM and public reply for a new trigger should go out. */
export function openingSendAt(now: number, random: () => number = Math.random): number {
  return now + OPENING_DELAY_MS + Math.floor(random() * OPENING_JITTER_MS);
}

/** Meta accepts a private reply only within 7 days of the comment. */
export function isPrivateReplyExpired(commentAt: number, now: number): boolean {
  return now - commentAt > PRIVATE_REPLY_MAX_AGE_MS;
}

/** Delay before the next try after `attemptsMade` failed attempts, or null to give up. */
export function retryDelayMs(attemptsMade: number): number | null {
  return RETRY_SCHEDULE_MS[attemptsMade - 1] ?? null;
}
```

`src/rules.ts`:
```ts
export type Scope = "all" | string[];
export type TriggerSource = "comment" | "story_reply";

export interface MatchableRule {
  id: number;
  keywords: string[];
  scope: Scope;
  on_comment: boolean;
  on_story_reply: boolean;
  active: boolean;
}

/** Lower-case, and turn everything that isn't a letter or digit (punctuation, emoji) into spaces. */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Whole-word (or whole-phrase) match; "guide" matches "Guide!" but not "guidebook". */
export function matchesKeyword(text: string, keyword: string): boolean {
  const needle = normalizeText(keyword);
  if (needle === "") return false;
  return ` ${normalizeText(text)} `.includes(` ${needle} `);
}

function inScope(scope: Scope, mediaId: string): boolean {
  return scope === "all" || scope.includes(mediaId);
}

export function findMatchingRule<R extends MatchableRule>(
  rules: R[],
  text: string,
  mediaId: string,
  source: TriggerSource,
): R | null {
  const ordered = [...rules].sort((a, b) => a.id - b.id);
  for (const rule of ordered) {
    if (!rule.active) continue;
    if (source === "comment" ? !rule.on_comment : !rule.on_story_reply) continue;
    if (!inScope(rule.scope, mediaId)) continue;
    if (rule.keywords.some((keyword) => matchesKeyword(text, keyword))) return rule;
  }
  return null;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/time.test.ts test/rules.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/time.ts src/rules.ts test/time.test.ts test/rules.test.ts
git commit -m "feat: add timing helpers and keyword rule matching"
```

---

### Task 3: Database access layer

**Files:**
- Create: `src/messages.ts`, `src/db/settings.ts`, `src/db/links.ts`, `src/db/rules.ts`, `src/db/contacts.ts`, `src/db/events.ts`, `src/db/actions.ts`, `test/factories.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `Scope` and `TriggerSource` from `src/rules.ts`.
- Produces from `src/messages.ts`:
  - `type Button = { type: "postback"; title; payload } | { type: "web_url"; title; url }`
  - `interface OutgoingMessage { text: string; buttons?: Button[] }`
- Produces from `src/db/settings.ts`:
  - `type SettingKey`
  - `getSetting(db, key): Promise<string | null>`
  - `setSetting(db, key, value): Promise<void>`
  - `deleteSetting(db, key): Promise<void>`
- Produces from `src/db/links.ts`:
  - `interface LinkRow { id; code; target_url; label; created_at }`
  - `insertLink(db, code, targetUrl, label, now): Promise<LinkRow>`
  - `getLinkByCode(db, code): Promise<LinkRow | null>`
  - `getLinkById(db, id): Promise<LinkRow | null>`
  - `insertClick(db, linkId, contactIgsid | null, now): Promise<void>`
  - `countClicks(db, linkId): Promise<number>`
- Produces from `src/db/rules.ts`:
  - `interface RuleRow` (all spec §4 columns; JSON columns parsed, booleans as `boolean`)
  - `type NewRule = Omit<RuleRow, "id" | "created_at">`
  - `insertRule(db, rule, now): Promise<RuleRow>`
  - `updateRule(db, id, patch: Partial<NewRule>): Promise<RuleRow | null>`
  - `getRule(db, id): Promise<RuleRow | null>`
  - `listRules(db): Promise<RuleRow[]>`
  - `listActiveRules(db): Promise<RuleRow[]>`
- Produces from `src/db/contacts.ts`:
  - `interface ContactRow`
  - `upsertContact(db, { igsid, username }, now): Promise<void>`
  - `getContact(db, igsid): Promise<ContactRow | null>`
- Produces from `src/db/events.ts`:
  - `isProcessed(db, key): Promise<boolean>`
  - `markProcessed(db, key, now): Promise<void>`
  - `interface TriggerRow`
  - `insertTrigger(db, trigger: Omit<TriggerRow, "id">): Promise<number | null>` (null means duplicate)
  - `getTrigger(db, id): Promise<TriggerRow | null>`
- Produces from `src/db/actions.ts`:
  - types `ActionType`, `ActionStatus`, `ActionPayload`, `ActionRow`, `NewAction`
  - `enqueueAction(db, action, now): Promise<number>`
  - `claimDueActions(db, now, types, limit): Promise<ActionRow[]>`
  - `markSent(db, id, mid: string | null, now)`, `markRetry(db, id, sendAt, error)`, `markFailed(db, id, error)`, `markDropped(db, id, reason)`
  - `failStuckActions(db, claimedBefore): Promise<number>`
  - `countActions(db, status, since?): Promise<number>`
  - `getAction(db, id): Promise<ActionRow | null>`
  - `recentActions(db, limit): Promise<ActionRow[]>`
- Produces from `test/factories.ts`: `newRule(overrides?: Partial<NewRule>): NewRule`

- [ ] **Step 1: Write the failing tests**

`test/factories.ts`:
```ts
import type { NewRule } from "../src/db/rules";

export function newRule(overrides: Partial<NewRule> = {}): NewRule {
  return {
    name: "Guide",
    keywords: ["guide"],
    scope: "all",
    on_comment: true,
    on_story_reply: false,
    public_replies: [],
    opening_text: "Hey {name}! Here you go 👇",
    button_label: "Get the guide",
    follow_gate: false,
    not_following_text: "",
    link_text: "",
    link_button_label: "Open",
    link_id: null,
    active: true,
    ...overrides,
  };
}
```

`test/db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimDueActions, countActions, enqueueAction, failStuckActions, getAction, markRetry, recentActions,
} from "../src/db/actions";
import { getContact, upsertContact } from "../src/db/contacts";
import { getTrigger, insertTrigger, isProcessed, markProcessed } from "../src/db/events";
import { countClicks, getLinkByCode, insertClick, insertLink } from "../src/db/links";
import { getRule, insertRule, listActiveRules, listRules, updateRule } from "../src/db/rules";
import { deleteSetting, getSetting, setSetting } from "../src/db/settings";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const db = () => testEnv.DB;
const NOW = 1_700_000_000_000;

beforeEach(resetDb);

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
    expect(await isProcessed(db(), "comment:1")).toBe(false);
    await markProcessed(db(), "comment:1", NOW);
    await markProcessed(db(), "comment:1", NOW);
    expect(await isProcessed(db(), "comment:1")).toBe(true);
  });

  it("returns null for a duplicate trigger (same rule, person, post)", async () => {
    const rule = await insertRule(db(), newRule(), NOW);
    const trigger = {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment" as const,
      comment_id: "c1", comment_at: NOW, created_at: NOW,
    };
    const id = await insertTrigger(db(), trigger);
    expect(id).not.toBeNull();
    expect(await insertTrigger(db(), { ...trigger, comment_id: "c2" })).toBeNull();
    expect(await getTrigger(db(), id!)).toMatchObject({ comment_id: "c1", source: "comment" });
  });
});

describe("actions", () => {
  const dm = (igsid: string) => ({ kind: "dm" as const, igsid, message: { text: "hi" } });

  it("claims only due actions of the requested types, up to the limit", async () => {
    const due1 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW - 2, payload: dm("u1") }, NOW);
    const due2 = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW - 1, payload: dm("u2") }, NOW);
    await enqueueAction(db(), { triggerId: null, contactIgsid: "u3", sendAt: NOW + 60_000, payload: dm("u3") }, NOW);
    await enqueueAction(db(), {
      triggerId: null, contactIgsid: "u4", sendAt: NOW - 5,
      payload: { kind: "public_reply", commentId: "c4", text: "Sent!" },
    }, NOW);

    const claimed = await claimDueActions(db(), NOW, ["dm"], 1);
    expect(claimed.map((a) => a.id)).toEqual([due1]);
    expect(claimed[0]).toMatchObject({ status: "sending", attempts: 1, claimed_at: NOW, payload: dm("u1") });

    const next = await claimDueActions(db(), NOW, ["dm"], 10);
    expect(next.map((a) => a.id)).toEqual([due2]);
  });

  it("puts a retried action back in the queue", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    await markRetry(db(), id, NOW + 60_000, "boom");
    expect(await getAction(db(), id)).toMatchObject({ status: "pending", send_at: NOW + 60_000, last_error: "boom", attempts: 1 });
  });

  it("fails actions stuck in sending", async () => {
    const id = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    await claimDueActions(db(), NOW, ["dm"], 10);
    expect(await failStuckActions(db(), NOW + 1)).toBe(1);
    expect(await getAction(db(), id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
    expect(await countActions(db(), "failed")).toBe(1);
    expect(await countActions(db(), "failed", NOW + 10)).toBe(0);
  });

  it("lists recent actions newest first", async () => {
    const a = await enqueueAction(db(), { triggerId: null, contactIgsid: "u1", sendAt: NOW, payload: dm("u1") }, NOW);
    const b = await enqueueAction(db(), { triggerId: null, contactIgsid: "u2", sendAt: NOW, payload: dm("u2") }, NOW);
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

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL, because `../src/db/*` modules are not found.

- [ ] **Step 3: Implement `src/messages.ts` and `src/db/settings.ts`**

`src/messages.ts`:
```ts
export type Button =
  | { type: "postback"; title: string; payload: string }
  | { type: "web_url"; title: string; url: string };

export interface OutgoingMessage {
  text: string;
  buttons?: Button[];
}
```

`src/db/settings.ts`:
```ts
export type SettingKey =
  | "ig_access_token"
  | "ig_token_refreshed_at"
  | "ig_token_error"
  | "ig_user_id"
  | "ig_username"
  | "oauth_state"
  | "last_webhook_at"
  | "last_sweep_at";

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: SettingKey, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: D1Database, key: SettingKey): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}
```

- [ ] **Step 4: Implement `src/db/links.ts`, `src/db/contacts.ts` and `src/db/events.ts`**

`src/db/links.ts`:
```ts
export interface LinkRow {
  id: number;
  code: string;
  target_url: string;
  label: string | null;
  created_at: number;
}

export async function insertLink(
  db: D1Database, code: string, targetUrl: string, label: string | null, now: number,
): Promise<LinkRow> {
  const row = await db
    .prepare("INSERT INTO links (code, target_url, label, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(code, targetUrl, label, now)
    .first<LinkRow>();
  if (!row) throw new Error("insertLink returned no row");
  return row;
}

export async function getLinkByCode(db: D1Database, code: string): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE code = ?").bind(code).first<LinkRow>();
}

export async function getLinkById(db: D1Database, id: number): Promise<LinkRow | null> {
  return db.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>();
}

export async function insertClick(
  db: D1Database, linkId: number, contactIgsid: string | null, now: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO clicks (link_id, contact_igsid, clicked_at) VALUES (?, ?, ?)")
    .bind(linkId, contactIgsid, now)
    .run();
}

export async function countClicks(db: D1Database, linkId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?").bind(linkId).first<{ n: number }>();
  return row?.n ?? 0;
}
```

`src/db/contacts.ts`:
```ts
export interface ContactRow {
  igsid: string;
  username: string | null;
  name: string | null;
  follows_me: boolean | null;
  follows_checked_at: number | null;
  first_seen_at: number;
  last_inbound_at: number | null;
}

type RawContact = Omit<ContactRow, "follows_me"> & { follows_me: number | null };

export async function upsertContact(
  db: D1Database, contact: { igsid: string; username: string | null }, now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contacts (igsid, username, first_seen_at) VALUES (?, ?, ?)
       ON CONFLICT (igsid) DO UPDATE SET username = COALESCE(excluded.username, contacts.username)`,
    )
    .bind(contact.igsid, contact.username, now)
    .run();
}

export async function getContact(db: D1Database, igsid: string): Promise<ContactRow | null> {
  const raw = await db.prepare("SELECT * FROM contacts WHERE igsid = ?").bind(igsid).first<RawContact>();
  if (!raw) return null;
  return { ...raw, follows_me: raw.follows_me === null ? null : raw.follows_me === 1 };
}
```

`src/db/events.ts`:
```ts
import type { TriggerSource } from "../rules";

export async function isProcessed(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS hit FROM processed_events WHERE event_key = ?").bind(key).first();
  return row !== null;
}

export async function markProcessed(db: D1Database, key: string, now: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO processed_events (event_key, received_at) VALUES (?, ?)").bind(key, now).run();
}

export interface TriggerRow {
  id: number;
  rule_id: number;
  contact_igsid: string;
  media_id: string;
  source: TriggerSource;
  comment_id: string | null;
  comment_at: number | null;
  created_at: number;
}

/** Returns the new trigger id, or null if this person already triggered this rule on this media. */
export async function insertTrigger(db: D1Database, trigger: Omit<TriggerRow, "id">): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO triggers (rule_id, contact_igsid, media_id, source, comment_id, comment_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (rule_id, contact_igsid, media_id) DO NOTHING
       RETURNING id`,
    )
    .bind(
      trigger.rule_id, trigger.contact_igsid, trigger.media_id, trigger.source,
      trigger.comment_id, trigger.comment_at, trigger.created_at,
    )
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function getTrigger(db: D1Database, id: number): Promise<TriggerRow | null> {
  return db.prepare("SELECT * FROM triggers WHERE id = ?").bind(id).first<TriggerRow>();
}
```

- [ ] **Step 5: Implement `src/db/rules.ts`**

```ts
import type { Scope } from "../rules";

export interface RuleRow {
  id: number;
  name: string;
  keywords: string[];
  scope: Scope;
  on_comment: boolean;
  on_story_reply: boolean;
  public_replies: string[];
  opening_text: string;
  button_label: string;
  follow_gate: boolean;
  not_following_text: string;
  link_text: string;
  link_button_label: string;
  link_id: number | null;
  active: boolean;
  created_at: number;
}

export type NewRule = Omit<RuleRow, "id" | "created_at">;

interface RawRule {
  id: number;
  name: string;
  keywords: string;
  scope: string;
  on_comment: number;
  on_story_reply: number;
  public_replies: string;
  opening_text: string;
  button_label: string;
  follow_gate: number;
  not_following_text: string;
  link_text: string;
  link_button_label: string;
  link_id: number | null;
  active: number;
  created_at: number;
}

const COLUMNS = [
  "name", "keywords", "scope", "on_comment", "on_story_reply", "public_replies",
  "opening_text", "button_label", "follow_gate", "not_following_text", "link_text",
  "link_button_label", "link_id", "active",
] as const satisfies readonly (keyof NewRule)[];

function toRule(raw: RawRule): RuleRow {
  return {
    ...raw,
    keywords: JSON.parse(raw.keywords) as string[],
    scope: raw.scope === "all" ? "all" : (JSON.parse(raw.scope) as string[]),
    on_comment: raw.on_comment === 1,
    on_story_reply: raw.on_story_reply === 1,
    public_replies: JSON.parse(raw.public_replies) as string[],
    follow_gate: raw.follow_gate === 1,
    active: raw.active === 1,
  };
}

function toColumnValue(key: keyof NewRule, value: unknown): string | number | null {
  if (key === "scope") return value === "all" ? "all" : JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as string | number | null;
}

export async function insertRule(db: D1Database, rule: NewRule, now: number): Promise<RuleRow> {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const raw = await db
    .prepare(`INSERT INTO rules (${COLUMNS.join(", ")}, created_at) VALUES (${placeholders}, ?) RETURNING *`)
    .bind(...COLUMNS.map((key) => toColumnValue(key, rule[key])), now)
    .first<RawRule>();
  if (!raw) throw new Error("insertRule returned no row");
  return toRule(raw);
}

export async function updateRule(db: D1Database, id: number, patch: Partial<NewRule>): Promise<RuleRow | null> {
  const keys = COLUMNS.filter((key) => patch[key] !== undefined);
  if (keys.length === 0) return getRule(db, id);
  const raw = await db
    .prepare(`UPDATE rules SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ? RETURNING *`)
    .bind(...keys.map((key) => toColumnValue(key, patch[key])), id)
    .first<RawRule>();
  return raw ? toRule(raw) : null;
}

export async function getRule(db: D1Database, id: number): Promise<RuleRow | null> {
  const raw = await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RawRule>();
  return raw ? toRule(raw) : null;
}

export async function listRules(db: D1Database): Promise<RuleRow[]> {
  const { results } = await db.prepare("SELECT * FROM rules ORDER BY id").all<RawRule>();
  return results.map(toRule);
}

export async function listActiveRules(db: D1Database): Promise<RuleRow[]> {
  const { results } = await db.prepare("SELECT * FROM rules WHERE active = 1 ORDER BY id").all<RawRule>();
  return results.map(toRule);
}
```

- [ ] **Step 6: Implement `src/db/actions.ts`**

```ts
import type { OutgoingMessage } from "../messages";

export type ActionType = "private_reply" | "public_reply" | "dm";
export type ActionStatus = "pending" | "sending" | "sent" | "failed" | "dropped";

export type ActionPayload =
  | { kind: "private_reply"; commentId: string; message: OutgoingMessage }
  | { kind: "public_reply"; commentId: string; text: string }
  | { kind: "dm"; igsid: string; message: OutgoingMessage };

export interface ActionRow {
  id: number;
  type: ActionType;
  trigger_id: number | null;
  contact_igsid: string;
  payload: ActionPayload;
  send_at: number;
  status: ActionStatus;
  attempts: number;
  last_error: string | null;
  claimed_at: number | null;
  sent_at: number | null;
  sent_mid: string | null;
  created_at: number;
}

type RawAction = Omit<ActionRow, "payload"> & { payload: string };

function toAction(raw: RawAction): ActionRow {
  return { ...raw, payload: JSON.parse(raw.payload) as ActionPayload };
}

export interface NewAction {
  triggerId: number | null;
  contactIgsid: string;
  payload: ActionPayload;
  sendAt: number;
}

export async function enqueueAction(db: D1Database, action: NewAction, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO actions (type, trigger_id, contact_igsid, payload, send_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(action.payload.kind, action.triggerId, action.contactIgsid, JSON.stringify(action.payload), action.sendAt, now)
    .first<{ id: number }>();
  if (!row) throw new Error("enqueueAction returned no row");
  return row.id;
}

/** Atomically moves due actions to 'sending' (one UPDATE…RETURNING), so no action is claimed twice. */
export async function claimDueActions(
  db: D1Database, now: number, types: ActionType[], limit: number,
): Promise<ActionRow[]> {
  if (types.length === 0 || limit <= 0) return [];
  const placeholders = types.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `UPDATE actions SET status = 'sending', attempts = attempts + 1, claimed_at = ?
       WHERE id IN (
         SELECT id FROM actions
         WHERE status = 'pending' AND send_at <= ? AND type IN (${placeholders})
         ORDER BY send_at, id LIMIT ?
       )
       RETURNING *`,
    )
    .bind(now, now, ...types, limit)
    .all<RawAction>();
  return results.map(toAction).sort((a, b) => a.send_at - b.send_at || a.id - b.id);
}

export async function markSent(db: D1Database, id: number, mid: string | null, now: number): Promise<void> {
  await db
    .prepare("UPDATE actions SET status = 'sent', sent_at = ?, sent_mid = ?, last_error = NULL WHERE id = ?")
    .bind(now, mid, id)
    .run();
}

export async function markRetry(db: D1Database, id: number, sendAt: number, error: string): Promise<void> {
  await db
    .prepare("UPDATE actions SET status = 'pending', send_at = ?, last_error = ? WHERE id = ?")
    .bind(sendAt, error, id)
    .run();
}

export async function markFailed(db: D1Database, id: number, error: string): Promise<void> {
  await db.prepare("UPDATE actions SET status = 'failed', last_error = ? WHERE id = ?").bind(error, id).run();
}

export async function markDropped(db: D1Database, id: number, reason: string): Promise<void> {
  await db.prepare("UPDATE actions SET status = 'dropped', last_error = ? WHERE id = ?").bind(reason, id).run();
}

export async function failStuckActions(db: D1Database, claimedBefore: number): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE actions SET status = 'failed', last_error = 'interrupted while sending' WHERE status = 'sending' AND claimed_at < ?",
    )
    .bind(claimedBefore)
    .run();
  return result.meta.changes;
}

export async function countActions(db: D1Database, status: ActionStatus, since?: number): Promise<number> {
  const row =
    since === undefined
      ? await db.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = ?").bind(status).first<{ n: number }>()
      : await db
          .prepare("SELECT COUNT(*) AS n FROM actions WHERE status = ? AND COALESCE(claimed_at, created_at) >= ?")
          .bind(status, since)
          .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAction(db: D1Database, id: number): Promise<ActionRow | null> {
  const raw = await db.prepare("SELECT * FROM actions WHERE id = ?").bind(id).first<RawAction>();
  return raw ? toAction(raw) : null;
}

export async function recentActions(db: D1Database, limit: number): Promise<ActionRow[]> {
  const { results } = await db.prepare("SELECT * FROM actions ORDER BY id DESC LIMIT ?").bind(limit).all<RawAction>();
  return results.map(toAction);
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run test/db.test.ts && npm run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/messages.ts src/db test/factories.ts test/db.test.ts
git commit -m "feat: add typed D1 access layer"
```

---

### Task 4: Instagram Graph API client

**Files:**
- Create: `src/instagram.ts`
- Test: `test/instagram.test.ts`

**Interfaces:**
- Consumes: `OutgoingMessage` from `src/messages.ts`.
- Produces:
  - `type Recipient = { comment_id: string } | { id: string }`
  - `interface MediaItem { id; caption?; media_product_type?; timestamp; permalink? }`
  - `interface InstagramClient`:
    - `sendMessage(recipient, message): Promise<{ messageId: string }>`
    - `replyToComment(commentId, text): Promise<{ id: string }>`
    - `listMedia(limit): Promise<MediaItem[]>`
    - `subscribeWebhooks(fields: string[]): Promise<void>`
  - `class InstagramError extends Error { status: number; code: number | null; transient: boolean }`
  - `buildMessageBody(message): Record<string, unknown>`
  - `createInstagramClient({ accessToken, igUserId, version, fetch? }): InstagramClient`

- [ ] **Step 1: Write the failing tests**

`test/instagram.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { InstagramError, createInstagramClient } from "../src/instagram";
import { fakeFetch, jsonResponse, type FetchCall } from "./helpers";

function client(handler: (call: FetchCall) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  const ig = createInstagramClient({ accessToken: "tok", igUserId: "178400", version: "v25.0", fetch: fake.fetch });
  return { ig, calls: fake.calls };
}

describe("InstagramClient", () => {
  it("sends a plain-text private reply", async () => {
    const { ig, calls } = client(() => jsonResponse({ recipient_id: "1", message_id: "mid.1" }));
    await expect(ig.sendMessage({ comment_id: "c1" }, { text: "hi" })).resolves.toEqual({ messageId: "mid.1" });
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/178400/messages");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ recipient: { comment_id: "c1" }, message: { text: "hi" } });
  });

  it("sends buttons as a button template within Meta's length limits", async () => {
    const { ig, calls } = client(() => jsonResponse({ message_id: "mid.2" }));
    await ig.sendMessage({ id: "u1" }, {
      text: "x".repeat(700),
      buttons: [{ type: "web_url", title: "A very long button title", url: "https://e.com" }],
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      recipient: { id: "u1" },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "x".repeat(640),
            buttons: [{ type: "web_url", title: "A very long button t", url: "https://e.com" }],
          },
        },
      },
    });
  });

  it("replies publicly to a comment", async () => {
    const { ig, calls } = client(() => jsonResponse({ id: "r1" }));
    await expect(ig.replyToComment("c1", "Sent!")).resolves.toEqual({ id: "r1" });
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/c1/replies");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ message: "Sent!" });
  });

  it("lists recent media", async () => {
    const { ig, calls } = client(() => jsonResponse({ data: [{ id: "m1", timestamp: "2026-09-01T00:00:00+0000" }] }));
    await expect(ig.listMedia(25)).resolves.toEqual([{ id: "m1", timestamp: "2026-09-01T00:00:00+0000" }]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v25.0/me/media");
    expect(url.searchParams.get("fields")).toBe("id,caption,media_product_type,timestamp,permalink");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("subscribes the account to webhook fields", async () => {
    const { ig, calls } = client(() => jsonResponse({ success: true }));
    await ig.subscribeWebhooks(["comments", "messages"]);
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/178400/subscribed_apps");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ subscribed_fields: ["comments", "messages"] });
  });

  it.each([
    [500, { error: { message: "down", code: 2 } }],
    [400, { error: { message: "rate", code: 4 } }],
    [429, {}],
    [400, { error: { message: "blip", code: 100, is_transient: true } }],
  ])("classifies HTTP %i %j as transient", async (status, body) => {
    const { ig } = client(() => jsonResponse(body, status));
    const error = await ig.sendMessage({ id: "u1" }, { text: "hi" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstagramError);
    expect((error as InstagramError).transient).toBe(true);
  });

  it("classifies other errors as permanent and keeps Meta's message", async () => {
    const { ig } = client(() => jsonResponse({ error: { message: "User blocked", code: 100, error_subcode: 2534014 } }, 400));
    const error = (await ig.sendMessage({ id: "u1" }, { text: "hi" }).catch((e: unknown) => e)) as InstagramError;
    expect(error.transient).toBe(false);
    expect(error.code).toBe(100);
    expect(error.message).toContain("User blocked");
  });

  it("treats network failures as transient", async () => {
    const { ig } = client(() => { throw new TypeError("fetch failed"); });
    const error = (await ig.replyToComment("c1", "x").catch((e: unknown) => e)) as InstagramError;
    expect(error).toBeInstanceOf(InstagramError);
    expect(error.transient).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/instagram.test.ts`
Expected: FAIL, because `../src/instagram` is not found.

- [ ] **Step 3: Implement `src/instagram.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/instagram.test.ts && npm run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/instagram.ts test/instagram.test.ts
git commit -m "feat: add Instagram Graph API client with error classification"
```

---

### Task 5: Webhook verification and payload parsing

**Files:**
- Create: `src/webhook/verify.ts`, `src/webhook/parse.ts`, `test/fixtures.ts`
- Modify: `src/index.ts` (add `GET /webhook`)
- Test: `test/webhook-verify.test.ts`, `test/webhook-parse.test.ts`

**Interfaces:**
- Produces from `src/webhook/verify.ts`:
  - `handshakeChallenge(params: URLSearchParams, verifyToken: string): string | null`
  - `hmacSha256Hex(secret, body): Promise<string>`
  - `constantTimeEqual(a, b): boolean`
  - `verifySignature(rawBody, header: string | null, secrets: string[]): Promise<boolean>`
- Produces from `src/webhook/parse.ts`:
  - `type WebhookEvent`, a union of `comment | message | echo | postback`, fields as below
  - `parseWebhook(body: unknown): WebhookEvent[]`
- Produces from `test/fixtures.ts`: `commentPayload()`, `messagingPayload()`, `textMessage()`, `storyReply()`, `echoMessage()`, `postbackEvent()`

- [ ] **Step 1: Write `test/fixtures.ts` (shapes from Meta's documented webhook examples)**

```ts
import { IG_USER_ID } from "./helpers";

export function commentPayload(o: {
  commentId?: string; text?: string; fromId?: string; username?: string; mediaId?: string;
} = {}) {
  return {
    object: "instagram",
    entry: [{
      id: IG_USER_ID,
      time: 1_727_500_000,
      changes: [{
        field: "comments",
        value: {
          id: o.commentId ?? "c-1",
          from: { id: o.fromId ?? "user-1", username: o.username ?? "anna" },
          text: o.text ?? "GUIDE please",
          media: { id: o.mediaId ?? "media-1", media_product_type: "REELS" },
        },
      }],
    }],
  };
}

export function messagingPayload(messaging: Record<string, unknown>[]) {
  return { object: "instagram", entry: [{ id: IG_USER_ID, time: 1_727_500_000_000, messaging }] };
}

export function textMessage(o: { mid?: string; senderId?: string; text?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    message: { mid: o.mid ?? "m-1", text: o.text ?? "hello" },
  };
}

export function storyReply(o: { mid?: string; senderId?: string; text?: string; storyId?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    message: {
      mid: o.mid ?? "m-story",
      text: o.text ?? "GUIDE",
      reply_to: { story: { url: "https://cdn.example/story.jpg", id: o.storyId ?? "story-1" } },
    },
  };
}

export function echoMessage(o: { mid?: string; recipientId?: string; text?: string } = {}) {
  return {
    sender: { id: IG_USER_ID },
    recipient: { id: o.recipientId ?? "user-1" },
    timestamp: 1_727_500_000_000,
    message: { mid: o.mid ?? "m-echo", text: o.text ?? "thanks!", is_echo: true },
  };
}

export function postbackEvent(o: { mid?: string; senderId?: string; payload?: string } = {}) {
  return {
    sender: { id: o.senderId ?? "user-1" },
    recipient: { id: IG_USER_ID },
    timestamp: 1_727_500_000_000,
    postback: { mid: o.mid ?? "m-pb", title: "Get the guide", payload: o.payload ?? "GET:1" },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`test/webhook-verify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { handshakeChallenge, hmacSha256Hex, verifySignature } from "../src/webhook/verify";
import { testEnv } from "./helpers";

describe("handshakeChallenge", () => {
  const params = (mode: string, token: string) =>
    new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "12345" });

  it("returns the challenge for a valid subscribe request", () => {
    expect(handshakeChallenge(params("subscribe", "tok"), "tok")).toBe("12345");
  });
  it("rejects a wrong token or mode", () => {
    expect(handshakeChallenge(params("subscribe", "nope"), "tok")).toBeNull();
    expect(handshakeChallenge(params("unsubscribe", "tok"), "tok")).toBeNull();
  });
});

describe("signatures", () => {
  it("computes a standard HMAC-SHA256", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"))
      .toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("accepts a correct signature from any configured secret", async () => {
    const body = '{"object":"instagram"}';
    const header = `sha256=${await hmacSha256Hex("second", body)}`;
    expect(await verifySignature(body, header, ["first", "second"])).toBe(true);
  });

  it("rejects tampered bodies, missing headers and wrong prefixes", async () => {
    const header = `sha256=${await hmacSha256Hex("s", "a")}`;
    expect(await verifySignature("b", header, ["s"])).toBe(false);
    expect(await verifySignature("a", null, ["s"])).toBe(false);
    expect(await verifySignature("a", header.replace("sha256=", "sha1="), ["s"])).toBe(false);
  });
});

describe("GET /webhook", () => {
  it("echoes the challenge for Meta's verification request", async () => {
    const qs = "hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=987";
    const res = await app.request(`/webhook?${qs}`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("987");
  });

  it("returns 403 for a wrong verify token", async () => {
    const res = await app.request("/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1", {}, testEnv);
    expect(res.status).toBe(403);
  });
});
```

`test/webhook-parse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseWebhook } from "../src/webhook/parse";
import {
  commentPayload, echoMessage, messagingPayload, postbackEvent, storyReply, textMessage,
} from "./fixtures";
import { IG_USER_ID } from "./helpers";

describe("parseWebhook", () => {
  it("parses a comment from entry.changes", () => {
    expect(parseWebhook(commentPayload())).toEqual([{
      kind: "comment", accountId: IG_USER_ID, commentId: "c-1", text: "GUIDE please",
      fromId: "user-1", fromUsername: "anna", mediaId: "media-1",
    }]);
  });

  it("parses a comment sent in the flat entry.field/value form with numeric ids", () => {
    const payload = {
      object: "instagram",
      entry: [{
        id: IG_USER_ID, time: 1, field: "comments",
        value: { id: 111, from: { id: 222 }, text: "guide", media: { id: 333 } },
      }],
    };
    expect(parseWebhook(payload)).toEqual([{
      kind: "comment", accountId: IG_USER_ID, commentId: "111", text: "guide",
      fromId: "222", fromUsername: null, mediaId: "333",
    }]);
  });

  it("parses text messages, story replies, echoes and postbacks", () => {
    const events = parseWebhook(messagingPayload([textMessage(), storyReply(), echoMessage(), postbackEvent()]));
    expect(events).toEqual([
      { kind: "message", accountId: IG_USER_ID, mid: "m-1", senderId: "user-1", text: "hello", attachmentTypes: [], storyId: null },
      { kind: "message", accountId: IG_USER_ID, mid: "m-story", senderId: "user-1", text: "GUIDE", attachmentTypes: [], storyId: "story-1" },
      { kind: "echo", accountId: IG_USER_ID, mid: "m-echo", recipientId: "user-1", text: "thanks!" },
      { kind: "postback", accountId: IG_USER_ID, mid: "m-pb", senderId: "user-1", payload: "GET:1" },
    ]);
  });

  it("skips reactions, read receipts, deleted messages and malformed items", () => {
    const events = parseWebhook(messagingPayload([
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, reaction: { mid: "m", action: "react", emoji: "❤️" } },
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, read: { mid: "m" } },
      { sender: { id: "user-1" }, recipient: { id: IG_USER_ID }, message: { mid: "m-del", is_deleted: true } },
      { sender: { id: "user-1" }, message: {} },
      "not an object" as unknown as Record<string, unknown>,
    ]));
    expect(events).toEqual([]);
  });

  it("ignores payloads that are not for Instagram", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ object: "instagram", entry: "nope" })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run test/webhook-verify.test.ts test/webhook-parse.test.ts`
Expected: FAIL, because the modules `../src/webhook/verify` and `../src/webhook/parse` are not found.

- [ ] **Step 4: Implement `src/webhook/verify.ts`**

```ts
export function handshakeChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export async function verifySignature(rawBody: string, header: string | null, secrets: string[]): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  for (const secret of secrets) {
    if (constantTimeEqual(header, `sha256=${await hmacSha256Hex(secret, rawBody)}`)) return true;
  }
  return false;
}
```

- [ ] **Step 5: Implement `src/webhook/parse.ts`**

```ts
export type WebhookEvent =
  | {
      kind: "comment";
      accountId: string;
      commentId: string;
      text: string;
      fromId: string;
      fromUsername: string | null;
      mediaId: string;
    }
  | {
      kind: "message";
      accountId: string;
      mid: string;
      senderId: string;
      text: string;
      attachmentTypes: string[];
      storyId: string | null;
    }
  | { kind: "echo"; accountId: string; mid: string; recipientId: string; text: string }
  | { kind: "postback"; accountId: string; mid: string; senderId: string; payload: string };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** IDs may arrive as strings or numbers; empty strings count as missing. */
function id(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function field(obj: unknown, key: string): unknown {
  return isObj(obj) ? obj[key] : undefined;
}

export function parseWebhook(body: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  if (!isObj(body) || body.object !== "instagram" || !Array.isArray(body.entry)) return events;

  for (const entry of body.entry) {
    const accountId = id(field(entry, "id"));
    if (!isObj(entry) || !accountId) continue;

    const changes: unknown[] = Array.isArray(entry.changes)
      ? entry.changes
      : typeof entry.field === "string"
        ? [{ field: entry.field, value: entry.value }]
        : [];
    for (const change of changes) {
      if (field(change, "field") !== "comments") continue;
      const value = field(change, "value");
      const commentId = id(field(value, "id"));
      const fromId = id(field(field(value, "from"), "id"));
      const mediaId = id(field(field(value, "media"), "id")) ?? id(field(value, "media_id"));
      if (!commentId || !fromId || !mediaId) continue;
      events.push({
        kind: "comment", accountId, commentId, text: text(field(value, "text")), fromId,
        fromUsername: id(field(field(value, "from"), "username")), mediaId,
      });
    }

    const messaging: unknown[] = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      if (!isObj(item)) continue;
      const senderId = id(field(item.sender, "id"));
      const recipientId = id(field(item.recipient, "id"));

      if (isObj(item.postback)) {
        const mid = id(item.postback.mid);
        const payload = id(item.postback.payload);
        if (senderId && mid && payload && senderId !== accountId) {
          events.push({ kind: "postback", accountId, mid, senderId, payload });
        }
        continue;
      }

      const message = item.message;
      if (!isObj(message)) continue; // reactions, read receipts, etc.
      const mid = id(message.mid);
      if (!mid || message.is_deleted === true || message.is_unsupported === true) continue;

      if (message.is_echo === true) {
        if (recipientId) events.push({ kind: "echo", accountId, mid, recipientId, text: text(message.text) });
        continue;
      }
      if (!senderId || senderId === accountId) continue;
      const attachmentTypes = Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => id(field(attachment, "type")) ?? "unknown")
        : [];
      events.push({
        kind: "message", accountId, mid, senderId, text: text(message.text), attachmentTypes,
        storyId: id(field(field(message.reply_to, "story"), "id")),
      });
    }
  }
  return events;
}
```

- [ ] **Step 6: Add `GET /webhook` to `src/index.ts`**

Add the import and route below the existing `app.get("/")` line:
```ts
import { handshakeChallenge } from "./webhook/verify";

app.get("/webhook", (c) => {
  const challenge = handshakeChallenge(new URL(c.req.url).searchParams, c.env.WEBHOOK_VERIFY_TOKEN);
  return challenge === null ? c.text("forbidden", 403) : c.text(challenge);
});
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run test/webhook-verify.test.ts test/webhook-parse.test.ts && npm run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/webhook src/index.ts test/fixtures.ts test/webhook-verify.test.ts test/webhook-parse.test.ts
git commit -m "feat: verify and parse Instagram webhooks"
```

---

### Task 6: Tracked links and the pages Meta requires

**Files:**
- Create: `src/links.ts`, `src/pages.ts`
- Modify: `src/index.ts` (routes `/l/:code`, `/privacy`, `/terms`, `/data-deletion`)
- Test: `test/public-routes.test.ts`

**Interfaces:**
- Consumes: `insertLink`, `getLinkByCode`, `insertClick`, `LinkRow` from `src/db/links.ts`.
- Produces from `src/links.ts`:
  - `isHttpUrl(value): boolean`
  - `randomCode(length?): string`
  - `createTrackedLink(db, targetUrl, label, now): Promise<LinkRow>`
  - `trackedUrl(publicUrl, code, contactIgsid?): string`
  - `handleLinkRedirect(db, code, contactParam: string | null, now): Promise<Response>`
- Produces from `src/pages.ts`:
  - `escapeHtml(value): string`
  - `page(title, bodyHtml): string`
  - `privacyPage(email)`, `termsPage(email)`, `dataDeletionPage(email)`

- [ ] **Step 1: Write the failing tests**

`test/public-routes.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { countClicks, getLinkByCode } from "../src/db/links";
import { app } from "../src/index";
import { createTrackedLink, trackedUrl } from "../src/links";
import { escapeHtml } from "../src/pages";
import { resetDb, testEnv } from "./helpers";

beforeEach(resetDb);

describe("tracked links", () => {
  it("rejects non-http targets", async () => {
    await expect(createTrackedLink(testEnv.DB, "javascript:alert(1)", null, 1)).rejects.toThrow("http");
  });

  it("builds tracked URLs with an optional contact", () => {
    expect(trackedUrl("https://dm.test", "abc", "123")).toBe("https://dm.test/l/abc?c=123");
    expect(trackedUrl("https://dm.test", "abc")).toBe("https://dm.test/l/abc");
  });

  it("redirects and records the click with the contact", async () => {
    const link = await createTrackedLink(testEnv.DB, "https://example.com/guide", "Guide", 1);
    expect(link.code).toMatch(/^[A-Za-z0-9]{8}$/);
    const res = await app.request(`/l/${link.code}?c=17841`, { redirect: "manual" }, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/guide");
    expect(await countClicks(testEnv.DB, link.id)).toBe(1);
    const row = await testEnv.DB.prepare("SELECT contact_igsid FROM clicks").first<{ contact_igsid: string | null }>();
    expect(row?.contact_igsid).toBe("17841");
  });

  it("ignores a contact parameter that is not an Instagram id", async () => {
    const link = await createTrackedLink(testEnv.DB, "https://example.com", null, 1);
    await app.request(`/l/${link.code}?c=<script>`, { redirect: "manual" }, testEnv);
    const row = await testEnv.DB.prepare("SELECT contact_igsid FROM clicks").first<{ contact_igsid: string | null }>();
    expect(row?.contact_igsid).toBeNull();
  });

  it("returns 404 for unknown codes", async () => {
    const res = await app.request("/l/missing1", { redirect: "manual" }, testEnv);
    expect(res.status).toBe(404);
    expect(await getLinkByCode(testEnv.DB, "missing1")).toBeNull();
  });
});

describe("legal pages", () => {
  it.each(["/privacy", "/terms", "/data-deletion"])("%s shows the contact email", async (path) => {
    const res = await app.request(path, {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("creator@example.com");
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/public-routes.test.ts`
Expected: FAIL, because the modules `../src/links` and `../src/pages` are not found.

- [ ] **Step 3: Implement `src/links.ts`**

```ts
import { getLinkByCode, insertClick, insertLink, type LinkRow } from "./db/links";

// No look-alike characters (0/O, 1/l/I), so codes are easy to read aloud if ever needed.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function randomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export async function createTrackedLink(
  db: D1Database, targetUrl: string, label: string | null, now: number,
): Promise<LinkRow> {
  if (!isHttpUrl(targetUrl)) throw new Error("Link must be an http(s) URL");
  return insertLink(db, randomCode(), targetUrl, label, now);
}

export function trackedUrl(publicUrl: string, code: string, contactIgsid?: string | null): string {
  const url = new URL(`/l/${code}`, publicUrl);
  if (contactIgsid) url.searchParams.set("c", contactIgsid);
  return url.toString();
}

export async function handleLinkRedirect(
  db: D1Database, code: string, contactParam: string | null, now: number,
): Promise<Response> {
  const link = await getLinkByCode(db, code);
  if (!link) return new Response("Link not found", { status: 404 });
  const contact = contactParam && /^\d{1,32}$/.test(contactParam) ? contactParam : null;
  await insertClick(db, link.id, contact, now);
  return Response.redirect(link.target_url, 302);
}
```

- [ ] **Step 4: Implement `src/pages.ts`**

```ts
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.6}</style>
</head>
<body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body>
</html>`;
}

export function privacyPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Privacy Policy", `
<p>This service automates replies to Instagram comments and direct messages on behalf of the account owner.</p>
<p>When you comment on or message the account, we store your Instagram username, your Instagram-scoped user ID,
the messages you exchange with the account, and whether you opened links we sent you. We use this only to reply
to you and to measure how many people open those links. We do not sell or share this data.</p>
<p>Data is stored with Cloudflare. To have your data deleted, see <a href="/data-deletion">data deletion</a>
or email <a href="mailto:${mail}">${mail}</a>.</p>`);
}

export function termsPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Terms of Service", `
<p>Automated messages from this account are provided as-is, for information about the account owner's content,
products and services. Do not send sensitive personal information by direct message.</p>
<p>Questions: <a href="mailto:${mail}">${mail}</a>.</p>`);
}

export function dataDeletionPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Data Deletion", `
<p>To delete the data this service holds about you, email <a href="mailto:${mail}">${mail}</a> with your
Instagram username. We delete your username, ID, messages and link-click records within 30 days and confirm by email.</p>`);
}
```

- [ ] **Step 5: Add the routes to `src/index.ts`**

Add these imports and routes (after the `GET /webhook` route):
```ts
import { handleLinkRedirect } from "./links";
import { dataDeletionPage, privacyPage, termsPage } from "./pages";

app.get("/l/:code", (c) =>
  handleLinkRedirect(c.env.DB, c.req.param("code"), c.req.query("c") ?? null, Date.now()),
);
app.get("/privacy", (c) => c.html(privacyPage(c.env.CONTACT_EMAIL)));
app.get("/terms", (c) => c.html(termsPage(c.env.CONTACT_EMAIL)));
app.get("/data-deletion", (c) => c.html(dataDeletionPage(c.env.CONTACT_EMAIL)));
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run test/public-routes.test.ts && npm run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/links.ts src/pages.ts src/index.ts test/public-routes.test.ts
git commit -m "feat: add tracked link redirects and legal pages"
```

---

### Task 7: Comment-to-DM flow (spec §5.1, no follow gate)

**Files:**
- Create: `src/webhook/handle.ts`
- Modify: `src/index.ts` (add `POST /webhook`)
- Test: `test/webhook-comments.test.ts`

**Interfaces:**
- Consumes:
  - `parseWebhook` and `WebhookEvent` (Task 5)
  - `verifySignature` and `hmacSha256Hex` (Task 5)
  - `findMatchingRule` and `fillTemplate` (Task 2)
  - `openingSendAt` (Task 2)
  - db functions (Task 3)
  - `trackedUrl` (Task 6)
- Produces: `handleEvents(env: AppEnv, events: WebhookEvent[], options: { now: number; random?: () => number }): Promise<void>`. Only `comment` events are acted on in this milestone.
- Behavior notes:
  - `follow_gate` is ignored in this milestone: the opening DM always carries a `web_url` button to the rule's tracked link, or plain text if the rule has no link.
  - `{name}` is filled with the commenter's username, or "there" if it's missing.

- [ ] **Step 1: Write the failing tests**

`test/webhook-comments.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { ActionRow } from "../src/db/actions";
import { insertLink } from "../src/db/links";
import { insertRule, type NewRule } from "../src/db/rules";
import { getSetting } from "../src/db/settings";
import { app } from "../src/index";
import { hmacSha256Hex } from "../src/webhook/verify";
import { newRule } from "./factories";
import { commentPayload, messagingPayload } from "./fixtures";
import { IG_USER_ID, resetDb, seedConnectedAccount, testEnv } from "./helpers";

const VARIANTS = ["Sent! Check your DMs 👀", "Just sent it 🙌"];

async function postWebhook(body: unknown, secret = "test-app-secret"): Promise<Response> {
  const raw = JSON.stringify(body);
  return app.request("/webhook", {
    method: "POST",
    body: raw,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(secret, raw)}` },
  }, testEnv);
}

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

beforeEach(async () => {
  await resetDb();
  await seedConnectedAccount();
});

describe("POST /webhook: comments", () => {
  it("rejects an invalid signature and stores nothing", async () => {
    await seedRule();
    const res = await postWebhook(commentPayload(), "wrong-secret");
    expect(res.status).toBe(401);
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(0);
  });

  it("queues a public reply and an opening DM about a minute out", async () => {
    await seedRule();
    const before = Date.now();
    const res = await postWebhook(commentPayload());
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EVENT_RECEIVED");
    expect(await count("triggers")).toBe(1);

    const [publicReply, privateReply] = await actions();
    expect(publicReply!.type).toBe("public_reply");
    expect(VARIANTS).toContain((publicReply!.payload as { text: string }).text);
    expect(privateReply!.type).toBe("private_reply");
    expect(privateReply!.payload).toEqual({
      kind: "private_reply",
      commentId: "c-1",
      message: {
        text: "Hey anna! Here you go 👇",
        buttons: [{ type: "web_url", title: "Get the guide", url: "https://dm.test/l/abc123?c=user-1" }],
      },
    });
    for (const action of [publicReply!, privateReply!]) {
      expect(action.status).toBe("pending");
      expect(action.send_at).toBeGreaterThanOrEqual(before + 60_000);
      expect(action.send_at).toBeLessThan(after + 70_000);
    }
  });

  it("queues only the DM when the rule has no public replies", async () => {
    await seedRule({ public_replies: [] });
    await postWebhook(commentPayload());
    expect((await actions()).map((a) => a.type)).toEqual(["private_reply"]);
  });

  it("sends plain text when the rule has no link", async () => {
    await insertRule(testEnv.DB, newRule(), Date.now());
    await postWebhook(commentPayload({ username: "" }));
    const [dm] = await actions();
    expect(dm!.payload).toEqual({ kind: "private_reply", commentId: "c-1", message: { text: "Hey there! Here you go 👇" } });
  });

  it("does nothing for a comment without a keyword, but remembers it", async () => {
    await seedRule();
    await postWebhook(commentPayload({ text: "love this" }));
    expect(await count("actions")).toBe(0);
    expect(await count("processed_events")).toBe(1);
  });

  it("ignores the creator's own comments", async () => {
    await seedRule();
    await postWebhook(commentPayload({ fromId: IG_USER_ID, text: "guide is in bio" }));
    expect(await count("actions")).toBe(0);
  });

  it("sends one DM when Meta delivers the same webhook twice", async () => {
    await seedRule();
    await postWebhook(commentPayload());
    await postWebhook(commentPayload());
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("sends one DM when the same person comments the keyword again on the same post", async () => {
    await seedRule();
    await postWebhook(commentPayload({ commentId: "c-1" }));
    await postWebhook(commentPayload({ commentId: "c-2", text: "GUIDE!!" }));
    expect(await count("triggers")).toBe(1);
    expect(await count("actions")).toBe(2);
  });

  it("records when the last webhook arrived, even with no events", async () => {
    const res = await postWebhook(messagingPayload([]));
    expect(res.status).toBe(200);
    expect(Number(await getSetting(testEnv.DB, "last_webhook_at"))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/webhook-comments.test.ts`
Expected: FAIL, because the `POST /webhook` route does not exist (404) and `src/webhook/handle.ts` is missing.

- [ ] **Step 3: Implement `src/webhook/handle.ts`**

```ts
import { enqueueAction } from "../db/actions";
import { upsertContact } from "../db/contacts";
import { insertTrigger, isProcessed, markProcessed } from "../db/events";
import { getLinkById } from "../db/links";
import { listActiveRules, type RuleRow } from "../db/rules";
import { getSetting } from "../db/settings";
import type { AppEnv } from "../env";
import { trackedUrl } from "../links";
import type { OutgoingMessage } from "../messages";
import { fillTemplate, findMatchingRule } from "../rules";
import { openingSendAt } from "../time";
import type { WebhookEvent } from "./parse";

type CommentEvent = Extract<WebhookEvent, { kind: "comment" }>;

export interface HandleOptions {
  now: number;
  random?: () => number;
}

export async function handleEvents(env: AppEnv, events: WebhookEvent[], options: HandleOptions): Promise<void> {
  for (const event of events) {
    // Messages, echoes and postbacks are handled in milestone 2.
    if (event.kind === "comment") await handleComment(env, event, options);
  }
}

async function handleComment(env: AppEnv, event: CommentEvent, options: HandleOptions): Promise<void> {
  const key = `comment:${event.commentId}`;
  if (await isProcessed(env.DB, key)) return;

  const ownId = await getSetting(env.DB, "ig_user_id");
  const isOwnComment = event.fromId === event.accountId || event.fromId === ownId;
  if (!isOwnComment) {
    const rule = findMatchingRule(await listActiveRules(env.DB), event.text, event.mediaId, "comment");
    if (rule) await triggerCommentRule(env, rule, event, options);
  }
  // Marked last: if anything above throws, Meta retries the webhook, and the
  // triggers table's unique key stops the retry from sending a second DM.
  await markProcessed(env.DB, key, options.now);
}

async function triggerCommentRule(
  env: AppEnv, rule: RuleRow, event: CommentEvent, { now, random = Math.random }: HandleOptions,
): Promise<void> {
  await upsertContact(env.DB, { igsid: event.fromId, username: event.fromUsername }, now);
  const triggerId = await insertTrigger(env.DB, {
    rule_id: rule.id, contact_igsid: event.fromId, media_id: event.mediaId, source: "comment",
    comment_id: event.commentId, comment_at: now, created_at: now,
  });
  if (triggerId === null) return; // already triggered for this person on this post

  const sendAt = openingSendAt(now, random);
  if (rule.public_replies.length > 0) {
    const text = rule.public_replies[Math.floor(random() * rule.public_replies.length)]!;
    await enqueueAction(env.DB, {
      triggerId, contactIgsid: event.fromId, sendAt,
      payload: { kind: "public_reply", commentId: event.commentId, text },
    }, now);
  }
  await enqueueAction(env.DB, {
    triggerId, contactIgsid: event.fromId, sendAt,
    payload: { kind: "private_reply", commentId: event.commentId, message: await openingMessage(env, rule, event) },
  }, now);
}

async function openingMessage(env: AppEnv, rule: RuleRow, event: CommentEvent): Promise<OutgoingMessage> {
  const text = fillTemplate(rule.opening_text, { name: event.fromUsername ?? "there" });
  const link = rule.link_id === null ? null : await getLinkById(env.DB, rule.link_id);
  if (!link) return { text };
  return {
    text,
    buttons: [{ type: "web_url", title: rule.button_label, url: trackedUrl(env.PUBLIC_URL, link.code, event.fromId) }],
  };
}
```

- [ ] **Step 4: Add `POST /webhook` to `src/index.ts`**

Add the imports and route (after `GET /webhook`):
```ts
import { setSetting } from "./db/settings";
import { handleEvents } from "./webhook/handle";
import { parseWebhook } from "./webhook/parse";
import { verifySignature } from "./webhook/verify";

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  const secrets = [c.env.IG_APP_SECRET, c.env.META_APP_SECRET].filter((s): s is string => Boolean(s));
  if (!(await verifySignature(raw, c.req.header("X-Hub-Signature-256") ?? null, secrets))) {
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
  // Errors propagate as a 500 so Meta retries; handleEvents is idempotent.
  await handleEvents(c.env, parseWebhook(body), { now });
  return c.text("EVENT_RECEIVED");
});
```

Merge the `handshakeChallenge` import from Task 5 with `verifySignature` into a single import line from `./webhook/verify`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run test/webhook-comments.test.ts && npm run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/webhook/handle.ts src/index.ts test/webhook-comments.test.ts
git commit -m "feat: queue delayed public reply and DM for keyword comments"
```

---

### Task 8: Scheduler that sends queued actions

**Files:**
- Create: `src/actions.ts`, `src/account.ts`, `src/scheduler.ts`
- Modify: `src/index.ts` (add `scheduled` to the default export)
- Test: `test/scheduler.test.ts`

**Interfaces:**
- Consumes:
  - `InstagramClient`, `InstagramError`, `createInstagramClient` (Task 4)
  - action db functions and `getTrigger` (Task 3)
  - `isPrivateReplyExpired`, `retryDelayMs`, `MINUTE` (Task 2)
- Produces:
  - `executeAction(ig, payload: ActionPayload): Promise<string | null>` (returns the message ID for DMs, null for public replies)
  - `instagramFromSettings(env): Promise<InstagramClient | null>`
  - `COMMENT_REPLY_BUDGET = 12`
  - `runScheduler(env, now, deps?: { ig?: InstagramClient }): Promise<SchedulerReport>`, where `SchedulerReport = { sent; retried; failed; dropped; skippedNoToken: boolean }`

- [ ] **Step 1: Write the failing tests**

`test/scheduler.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { enqueueAction, getAction, type ActionPayload } from "../src/db/actions";
import { insertTrigger } from "../src/db/events";
import { insertRule } from "../src/db/rules";
import { InstagramError, type InstagramClient } from "../src/instagram";
import { runScheduler } from "../src/scheduler";
import { DAY, MINUTE } from "../src/time";
import { newRule } from "./factories";
import { resetDb, testEnv } from "./helpers";

const NOW = 1_700_000_000_000;

function fakeIg(sendImpl?: () => Promise<{ messageId: string }>) {
  const sent: unknown[][] = [];
  const ig: InstagramClient = {
    async sendMessage(recipient, message) {
      sent.push(["sendMessage", recipient, message]);
      return sendImpl ? sendImpl() : { messageId: `mid-${sent.length}` };
    },
    async replyToComment(commentId, text) {
      sent.push(["replyToComment", commentId, text]);
      return { id: `reply-${sent.length}` };
    },
    async listMedia() { return []; },
    async subscribeWebhooks() {},
  };
  return { ig, sent };
}

const privateReply = (commentId: string): ActionPayload => ({ kind: "private_reply", commentId, message: { text: "hi" } });
const enqueue = (payload: ActionPayload, sendAt = NOW - 1, triggerId: number | null = null) =>
  enqueueAction(testEnv.DB, { triggerId, contactIgsid: "u1", payload, sendAt }, NOW - 1);

beforeEach(resetDb);

describe("runScheduler", () => {
  it("does nothing and loses nothing before Instagram is connected", async () => {
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW);
    expect(report.skippedNoToken).toBe(true);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends due actions and leaves future ones queued", async () => {
    const { ig, sent } = fakeIg();
    const dm = await enqueue(privateReply("c1"));
    const reply = await enqueue({ kind: "public_reply", commentId: "c1", text: "Sent!" });
    const later = await enqueue({ kind: "dm", igsid: "u1", message: { text: "later" } }, NOW + MINUTE);

    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report).toMatchObject({ sent: 2, failed: 0, retried: 0 });
    expect(sent).toHaveLength(2);
    expect(await getAction(testEnv.DB, dm)).toMatchObject({ status: "sent", sent_mid: "mid-1" });
    expect(await getAction(testEnv.DB, reply)).toMatchObject({ status: "sent", sent_mid: null });
    expect(await getAction(testEnv.DB, later)).toMatchObject({ status: "pending" });
  });

  it("caps comment replies at 12 per run but still sends DMs", async () => {
    const { ig } = fakeIg();
    for (let i = 0; i < 15; i++) await enqueue(privateReply(`c${i}`));
    for (let i = 0; i < 3; i++) await enqueue({ kind: "dm", igsid: `u${i}`, message: { text: "hi" } });
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.sent).toBe(15);
    const pending = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").first<{ n: number }>();
    expect(pending!.n).toBe(3);
  });

  it("retries a transient failure a minute later", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("down", 500, 2, true)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.retried).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "pending", attempts: 1, send_at: NOW + MINUTE });
  });

  it("gives up after the fourth transient failure", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("down", 500, 2, true)));
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET attempts = 3 WHERE id = ?").bind(id).run();
    await runScheduler(testEnv, NOW, { ig });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("fails a permanent error immediately", async () => {
    const { ig } = fakeIg(() => Promise.reject(new InstagramError("User blocked", 400, 100, false)));
    const id = await enqueue(privateReply("c1"));
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.failed).toBe(1);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed" });
    expect((await getAction(testEnv.DB, id))!.last_error).toContain("User blocked");
  });

  it("drops a private reply to a comment older than 7 days", async () => {
    const { ig, sent } = fakeIg();
    const rule = await insertRule(testEnv.DB, newRule(), NOW);
    const triggerId = await insertTrigger(testEnv.DB, {
      rule_id: rule.id, contact_igsid: "u1", media_id: "m1", source: "comment",
      comment_id: "c1", comment_at: NOW - 8 * DAY, created_at: NOW - 8 * DAY,
    });
    const id = await enqueue(privateReply("c1"), NOW - 1, triggerId);
    const report = await runScheduler(testEnv, NOW, { ig });
    expect(report.dropped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "dropped" });
  });

  it("fails actions stuck in sending for over 10 minutes", async () => {
    const { ig } = fakeIg();
    const id = await enqueue(privateReply("c1"));
    await testEnv.DB.prepare("UPDATE actions SET status = 'sending', claimed_at = ? WHERE id = ?").bind(NOW - 11 * MINUTE, id).run();
    await runScheduler(testEnv, NOW, { ig });
    expect(await getAction(testEnv.DB, id)).toMatchObject({ status: "failed", last_error: "interrupted while sending" });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/scheduler.test.ts`
Expected: FAIL, because `../src/scheduler` is not found.

- [ ] **Step 3: Implement `src/actions.ts` and `src/account.ts`**

`src/actions.ts`:
```ts
import type { ActionPayload } from "./db/actions";
import type { InstagramClient } from "./instagram";

/** Sends one queued action. Returns the Instagram message id for DMs, null for public replies. */
export async function executeAction(ig: InstagramClient, payload: ActionPayload): Promise<string | null> {
  switch (payload.kind) {
    case "private_reply":
      return (await ig.sendMessage({ comment_id: payload.commentId }, payload.message)).messageId;
    case "public_reply":
      await ig.replyToComment(payload.commentId, payload.text);
      return null;
    case "dm":
      return (await ig.sendMessage({ id: payload.igsid }, payload.message)).messageId;
  }
}
```

`src/account.ts`:
```ts
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { createInstagramClient, type InstagramClient } from "./instagram";

/** The client for the connected Instagram account, or null until OAuth has completed. */
export async function instagramFromSettings(env: AppEnv): Promise<InstagramClient | null> {
  const [accessToken, igUserId] = await Promise.all([
    getSetting(env.DB, "ig_access_token"),
    getSetting(env.DB, "ig_user_id"),
  ]);
  if (!accessToken || !igUserId) return null;
  return createInstagramClient({ accessToken, igUserId, version: env.GRAPH_API_VERSION });
}
```

- [ ] **Step 4: Implement `src/scheduler.ts`**

```ts
import { instagramFromSettings } from "./account";
import { executeAction } from "./actions";
import {
  claimDueActions, failStuckActions, markDropped, markFailed, markRetry, markSent, type ActionRow,
} from "./db/actions";
import { getTrigger } from "./db/events";
import type { AppEnv } from "./env";
import { InstagramError, type InstagramClient } from "./instagram";
import { MINUTE, isPrivateReplyExpired, retryDelayMs } from "./time";

/** Comment replies per run (the cron runs every minute): 720/hour, under Meta's 750/hour cap. */
export const COMMENT_REPLY_BUDGET = 12;
const DM_BATCH = 50;
const STUCK_AFTER_MS = 10 * MINUTE;

export interface SchedulerReport {
  sent: number;
  retried: number;
  failed: number;
  dropped: number;
  skippedNoToken: boolean;
}

export async function runScheduler(
  env: AppEnv, now: number, deps: { ig?: InstagramClient } = {},
): Promise<SchedulerReport> {
  const report: SchedulerReport = { sent: 0, retried: 0, failed: 0, dropped: 0, skippedNoToken: false };
  await failStuckActions(env.DB, now - STUCK_AFTER_MS);

  const ig = deps.ig ?? (await instagramFromSettings(env));
  if (!ig) {
    report.skippedNoToken = true;
    return report;
  }

  const due = [
    ...(await claimDueActions(env.DB, now, ["private_reply", "public_reply"], COMMENT_REPLY_BUDGET)),
    ...(await claimDueActions(env.DB, now, ["dm"], DM_BATCH)),
  ];
  for (const action of due) await processAction(env, ig, action, now, report);
  return report;
}

async function processAction(
  env: AppEnv, ig: InstagramClient, action: ActionRow, now: number, report: SchedulerReport,
): Promise<void> {
  if (action.type === "private_reply" && action.trigger_id !== null) {
    const trigger = await getTrigger(env.DB, action.trigger_id);
    if (trigger?.comment_at != null && isPrivateReplyExpired(trigger.comment_at, now)) {
      await markDropped(env.DB, action.id, "comment is older than 7 days");
      report.dropped++;
      return;
    }
  }

  try {
    const mid = await executeAction(ig, action.payload);
    await markSent(env.DB, action.id, mid, now);
    report.sent++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = err instanceof InstagramError ? err.transient : true;
    const delay = transient ? retryDelayMs(action.attempts) : null;
    if (delay !== null) {
      await markRetry(env.DB, action.id, now + delay, message);
      report.retried++;
    } else {
      await markFailed(env.DB, action.id, message);
      report.failed++;
    }
  }
}
```

- [ ] **Step 5: Wire the cron into `src/index.ts`**

Replace the default export with:
```ts
import { runScheduler } from "./scheduler";

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

- [ ] **Step 6: Run the full suite and confirm it passes**

Run: `npx vitest run && npm run typecheck`
Expected: every test file passes; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/actions.ts src/account.ts src/scheduler.ts src/index.ts test/scheduler.test.ts
git commit -m "feat: send queued actions from the minute cron with retries"
```

---

### Task 9: Admin API with rule validation

**Files:**
- Create: `src/rule-input.ts`, `src/health.ts`, `src/admin.ts`
- Modify: `src/index.ts` (mount `/admin`)
- Test: `test/rule-input.test.ts`, `test/admin.test.ts`

**Interfaces:**
- Consumes:
  - rule, action and setting db functions (Task 3)
  - `createTrackedLink` and `isHttpUrl` (Task 6)
  - `normalizeText` (Task 2)
  - `instagramFromSettings` (Task 8)
  - `InstagramError` (Task 4)
  - `constantTimeEqual` (Task 5)
- Produces from `src/rule-input.ts`:
  - `interface RuleInput` (`NewRule` minus `link_id`, plus `link_url?: string`)
  - `type ParseResult<T>`
  - `parseNewRule(body): ParseResult<RuleInput>`
  - `parseRulePatch(body): ParseResult<Partial<RuleInput>>`
- Produces from `src/health.ts`:
  - `interface Health { connected; username; tokenRefreshedAt; tokenError; lastWebhookAt; pendingActions; failedLast24h }`
  - `getHealth(env, now): Promise<Health>`
- Produces from `src/admin.ts`: `admin: Hono<{ Bindings: AppEnv }>`, with these routes:
  - `GET /health`
  - `GET /rules`, `POST /rules`, `PATCH /rules/:id`
  - `GET /media`
  - `GET /actions/recent`
- Deviation from spec §6.1: rules are paused with `PATCH {"active": false}` rather than deleted, because triggers keep a foreign key to their rule. There is no `DELETE` route.

- [ ] **Step 1: Write the failing tests**

`test/rule-input.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseNewRule, parseRulePatch } from "../src/rule-input";

const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Hey {name}!", button_label: "Get it" };

describe("parseNewRule", () => {
  it("applies defaults to a minimal rule", () => {
    expect(parseNewRule(minimal)).toEqual({
      ok: true,
      value: {
        ...minimal, scope: "all", on_comment: true, on_story_reply: false, public_replies: [],
        follow_gate: false, not_following_text: "", link_text: "", link_button_label: "Open", active: true,
      },
    });
  });

  it.each([
    [{ ...minimal, name: undefined }, "name is required"],
    [{ ...minimal, surprise: 1 }, 'unknown field "surprise"'],
    [{ ...minimal, keywords: ["🔥"] }, "emoji-only"],
    [{ ...minimal, keywords: [] }, "keywords must be a non-empty list"],
    [{ ...minimal, link_url: "ftp://x" }, "link_url must be an http(s) URL"],
    [{ ...minimal, button_label: "x".repeat(21) }, "button_label must be at most 20 characters"],
    [{ ...minimal, scope: [] }, "scope must be"],
    [{ ...minimal, public_replies: [""] }, "public_replies"],
    ["nope", "body must be a JSON object"],
  ])("rejects %j", (body, message) => {
    const result = parseNewRule(body);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(message);
  });
});

describe("parseRulePatch", () => {
  it("accepts a partial update without applying defaults", () => {
    expect(parseRulePatch({ active: false })).toEqual({ ok: true, value: { active: false } });
  });
  it("still validates the fields it gets", () => {
    expect(parseRulePatch({ active: "no" })).toEqual({ ok: false, error: "active must be true or false" });
  });
});
```

`test/admin.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueAction } from "../src/db/actions";
import { getLinkById } from "../src/db/links";
import { setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { jsonResponse, resetDb, seedConnectedAccount, stubGlobalFetch, testEnv } from "./helpers";

const AUTH = { Authorization: "Bearer test-admin-token" };
const minimal = { name: "Guide", keywords: ["guide"], opening_text: "Hey {name}!", button_label: "Get it" };

function adminRequest(path: string, init: RequestInit = {}) {
  return app.request(`/admin${path}`, {
    ...init,
    headers: { ...AUTH, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, testEnv);
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("admin auth", () => {
  it("rejects missing and wrong tokens", async () => {
    expect((await app.request("/admin/health", {}, testEnv)).status).toBe(401);
    expect((await app.request("/admin/health", { headers: { Authorization: "Bearer nope" } }, testEnv)).status).toBe(401);
  });
});

describe("GET /admin/health", () => {
  it("reports a disconnected, empty system", async () => {
    const res = await adminRequest("/health");
    expect(await res.json()).toEqual({
      connected: false, username: null, tokenRefreshedAt: null, tokenError: null,
      lastWebhookAt: null, pendingActions: 0, failedLast24h: 0,
    });
  });

  it("reports connection, webhook time and queue counts", async () => {
    await seedConnectedAccount();
    await setSetting(testEnv.DB, "last_webhook_at", "1234");
    await enqueueAction(testEnv.DB, {
      triggerId: null, contactIgsid: "u1", sendAt: Date.now(), payload: { kind: "dm", igsid: "u1", message: { text: "x" } },
    }, Date.now());
    const body = (await (await adminRequest("/health")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ connected: true, username: "creator", lastWebhookAt: 1234, pendingActions: 1 });
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
    const list = (await (await adminRequest("/rules")).json()) as unknown[];
    expect(list).toHaveLength(1);
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
  it("explains how to connect when Instagram is not connected", async () => {
    const res = await adminRequest("/media");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("connect");
  });

  it("lists recent media from Instagram", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ data: [{ id: "m1", caption: "Reel", timestamp: "2026-09-01T00:00:00+0000" }] }));
    const res = await adminRequest("/media");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "m1", caption: "Reel", timestamp: "2026-09-01T00:00:00+0000" }]);
  });

  it("returns 502 with Meta's message when Instagram errors", async () => {
    await seedConnectedAccount();
    stubGlobalFetch(() => jsonResponse({ error: { message: "Invalid token", code: 190 } }, 400));
    const res = await adminRequest("/media");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Invalid token");
  });
});

describe("GET /admin/actions/recent", () => {
  it("lists the newest actions first", async () => {
    for (const igsid of ["u1", "u2"]) {
      await enqueueAction(testEnv.DB, {
        triggerId: null, contactIgsid: igsid, sendAt: 1, payload: { kind: "dm", igsid, message: { text: "x" } },
      }, 1);
    }
    const list = (await (await adminRequest("/actions/recent")).json()) as { contact_igsid: string }[];
    expect(list.map((a) => a.contact_igsid)).toEqual(["u2", "u1"]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/rule-input.test.ts test/admin.test.ts`
Expected: FAIL, because `../src/rule-input` is not found and `/admin/*` returns 404.

- [ ] **Step 3: Implement `src/rule-input.ts`**

```ts
import type { NewRule } from "./db/rules";
import { isHttpUrl } from "./links";
import { normalizeText } from "./rules";

export type RuleInput = Omit<NewRule, "link_id"> & { link_url?: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Check = (value: unknown) => string | null;

const text = (max: number, allowEmpty = false): Check => (value) => {
  if (typeof value !== "string") return "must be a string";
  if (!allowEmpty && value.trim() === "") return "must not be empty";
  return value.length > max ? `must be at most ${max} characters` : null;
};
const bool: Check = (value) => (typeof value === "boolean" ? null : "must be true or false");

const CHECKS: Record<keyof RuleInput, Check> = {
  name: text(100),
  keywords: (value) => {
    if (!Array.isArray(value) || value.length === 0) return "must be a non-empty list";
    return value.some((k) => typeof k !== "string" || normalizeText(k) === "")
      ? "each need a letter or number (emoji-only keywords are not supported)"
      : null;
  },
  scope: (value) =>
    value === "all" ||
    (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.trim() !== ""))
      ? null
      : 'must be "all" or a non-empty list of media IDs',
  on_comment: bool,
  on_story_reply: bool,
  follow_gate: bool,
  active: bool,
  public_replies: (value) => {
    if (!Array.isArray(value) || value.length > 10) return "must be a list of at most 10 replies";
    return value.some((r) => typeof r !== "string" || r.trim() === "" || r.length > 300)
      ? "must each be 1–300 characters"
      : null;
  },
  opening_text: text(640),
  button_label: text(20),
  not_following_text: text(640, true),
  link_text: text(640, true),
  link_button_label: text(20),
  link_url: (value) => (typeof value === "string" && isHttpUrl(value) ? null : "must be an http(s) URL"),
};

const DEFAULTS = {
  scope: "all",
  on_comment: true,
  on_story_reply: false,
  public_replies: [],
  follow_gate: false,
  not_following_text: "",
  link_text: "",
  link_button_label: "Open",
  active: true,
} satisfies Partial<RuleInput>;

const REQUIRED = ["name", "keywords", "opening_text", "button_label"] as const;

function validate(body: unknown): ParseResult<Record<string, unknown>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const input = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(CHECKS, key)) return { ok: false, error: `unknown field "${key}"` };
    const error = CHECKS[key as keyof RuleInput](value);
    if (error) return { ok: false, error: `${key} ${error}` };
  }
  return { ok: true, value: input };
}

export function parseNewRule(body: unknown): ParseResult<RuleInput> {
  const result = validate(body);
  if (!result.ok) return result;
  for (const key of REQUIRED) {
    if (result.value[key] === undefined) return { ok: false, error: `${key} is required` };
  }
  return { ok: true, value: { ...DEFAULTS, ...result.value } as RuleInput };
}

export function parseRulePatch(body: unknown): ParseResult<Partial<RuleInput>> {
  const result = validate(body);
  return result.ok ? { ok: true, value: result.value as Partial<RuleInput> } : result;
}
```

The keywords error reads "keywords each need a letter or number (emoji-only keywords are not supported)". It contains "emoji-only", which is what the tests assert. The `{ ...minimal, name: undefined }` case is skipped by the `value === undefined` guard and then caught by `REQUIRED`.

- [ ] **Step 4: Implement `src/health.ts`**

```ts
import { countActions } from "./db/actions";
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { DAY } from "./time";

export interface Health {
  connected: boolean;
  username: string | null;
  tokenRefreshedAt: number | null;
  tokenError: string | null;
  lastWebhookAt: number | null;
  pendingActions: number;
  failedLast24h: number;
}

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

export async function getHealth(env: AppEnv, now: number): Promise<Health> {
  const [token, username, refreshedAt, tokenError, lastWebhookAt, pendingActions, failedLast24h] = await Promise.all([
    getSetting(env.DB, "ig_access_token"),
    getSetting(env.DB, "ig_username"),
    getSetting(env.DB, "ig_token_refreshed_at"),
    getSetting(env.DB, "ig_token_error"),
    getSetting(env.DB, "last_webhook_at"),
    countActions(env.DB, "pending"),
    countActions(env.DB, "failed", now - DAY),
  ]);
  return {
    connected: token !== null,
    username,
    tokenRefreshedAt: toNumber(refreshedAt),
    tokenError,
    lastWebhookAt: toNumber(lastWebhookAt),
    pendingActions,
    failedLast24h,
  };
}
```

- [ ] **Step 5: Implement `src/admin.ts`**

```ts
import { Hono, type Context } from "hono";
import { instagramFromSettings } from "./account";
import { recentActions } from "./db/actions";
import { getRule, insertRule, listRules, updateRule, type NewRule } from "./db/rules";
import type { AppEnv } from "./env";
import { getHealth } from "./health";
import { InstagramError } from "./instagram";
import { createTrackedLink } from "./links";
import { parseNewRule, parseRulePatch } from "./rule-input";
import { constantTimeEqual } from "./webhook/verify";

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
  const ig = await instagramFromSettings(c.env);
  if (!ig) return c.json({ error: "Instagram is not connected. Run: npm run cli -- connect" }, 409);
  try {
    return c.json(await ig.listMedia(25));
  } catch (err) {
    if (err instanceof InstagramError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

admin.get("/actions/recent", async (c) => c.json(await recentActions(c.env.DB, 20)));
```

- [ ] **Step 6: Mount the admin app in `src/index.ts`**

Add the import and the mount line (after the other routes):
```ts
import { admin } from "./admin";

app.route("/admin", admin);
```

- [ ] **Step 7: Run the full suite and confirm it passes**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/rule-input.ts src/health.ts src/admin.ts src/index.ts test/rule-input.test.ts test/admin.test.ts
git commit -m "feat: add bearer-protected admin API for health, rules and media"
```

---

### Task 10: Instagram Login (OAuth) connection

**Files:**
- Create: `src/auth.ts`
- Modify: `src/admin.ts` (`POST /auth/start`), `src/index.ts` (`GET /auth/callback`)
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: settings db functions (Task 3); `createInstagramClient` and `InstagramError` (Task 4); `constantTimeEqual` (Task 5); `page` and `escapeHtml` (Task 6).
- Produces:
  - `OAUTH_SCOPES`, `WEBHOOK_FIELDS = ["comments", "messages", "messaging_postbacks"]`
  - `class AuthError`
  - `redirectUri(env)`
  - `startAuth(env, now): Promise<string>`
  - `completeAuth(env, code, state, now, fetchFn?): Promise<{ username: string }>`
- Endpoints (as used in OpenReply's working implementation):
  - authorize: `https://www.instagram.com/oauth/authorize`
  - code exchange: `POST https://api.instagram.com/oauth/access_token` (form-encoded)
  - long-lived token: `GET https://graph.instagram.com/{v}/access_token?grant_type=ig_exchange_token`
  - profile: `GET /{v}/me?fields=user_id,username`. The webhook `entry.id` equals `user_id`, not `id`.
  - webhook subscription: `POST /{v}/{user_id}/subscribed_apps`

- [ ] **Step 1: Write the failing tests**

`test/auth.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAuth } from "../src/auth";
import { getSetting, setSetting } from "../src/db/settings";
import { app } from "../src/index";
import { IG_USER_ID, jsonResponse, resetDb, stubGlobalFetch, testEnv, type FetchCall } from "./helpers";

function metaHappyPath(call: FetchCall): Response {
  if (call.url === "https://api.instagram.com/oauth/access_token") return jsonResponse({ access_token: "short-token", user_id: 123 });
  if (call.url.startsWith("https://graph.instagram.com/v25.0/access_token?")) {
    return jsonResponse({ access_token: "long-token", token_type: "bearer", expires_in: 5_184_000 });
  }
  if (call.url.startsWith("https://graph.instagram.com/v25.0/me?")) return jsonResponse({ user_id: IG_USER_ID, username: "creator" });
  if (call.url === `https://graph.instagram.com/v25.0/${IG_USER_ID}/subscribed_apps`) return jsonResponse({ success: true });
  return jsonResponse({ error: { message: `unexpected ${call.url}` } }, 500);
}

async function stateFrom(url: string): Promise<string> {
  return new URL(url).searchParams.get("state")!;
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("POST /admin/auth/start", () => {
  it("returns an Instagram authorize URL and stores the state", async () => {
    const res = await app.request("/admin/auth/start", { method: "POST", headers: { Authorization: "Bearer test-admin-token" } }, testEnv);
    const { url } = (await res.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-app-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://dm.test/auth/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    );
    expect(await getSetting(testEnv.DB, "oauth_state")).toContain(parsed.searchParams.get("state")!);
  });
});

describe("GET /auth/callback", () => {
  it("exchanges the code, stores the account and subscribes webhooks", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    const calls = stubGlobalFetch(metaHappyPath);
    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("@creator");

    expect(await getSetting(testEnv.DB, "ig_access_token")).toBe("long-token");
    expect(await getSetting(testEnv.DB, "ig_user_id")).toBe(IG_USER_ID);
    expect(await getSetting(testEnv.DB, "ig_username")).toBe("creator");
    expect(Number(await getSetting(testEnv.DB, "ig_token_refreshed_at"))).toBeGreaterThan(0);
    expect(await getSetting(testEnv.DB, "oauth_state")).toBeNull();

    const exchange = new URLSearchParams(calls[0]!.body!);
    expect(exchange.get("code")).toBe("abc");
    expect(exchange.get("redirect_uri")).toBe("https://dm.test/auth/callback");
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(JSON.parse(calls[3]!.body!)).toEqual({ subscribed_fields: ["comments", "messages", "messaging_postbacks"] });
  });

  it("rejects a wrong state without calling Meta, and states are single-use", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    const calls = stubGlobalFetch(metaHappyPath);
    expect((await app.request("/auth/callback?code=abc&state=wrong", {}, testEnv)).status).toBe(400);
    expect((await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects an expired state", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now() - 11 * 60_000));
    stubGlobalFetch(metaHappyPath);
    expect((await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv)).status).toBe(400);
  });

  it("explains a cancelled login", async () => {
    const res = await app.request("/auth/callback?error=access_denied&error_description=User+denied", {}, testEnv);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cancelled");
  });

  it("shows Meta's error and stores nothing when the code exchange fails", async () => {
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    stubGlobalFetch(() => jsonResponse({ error_type: "OAuthException", code: 400, error_message: "Invalid redirect_uri" }, 400));
    const res = await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Invalid redirect_uri");
    expect(await getSetting(testEnv.DB, "ig_access_token")).toBeNull();
  });

  it("keeps an existing connection when a reconnect fails", async () => {
    await setSetting(testEnv.DB, "ig_access_token", "old-token");
    const state = await stateFrom(await startAuth(testEnv, Date.now()));
    stubGlobalFetch(() => jsonResponse({ error_message: "nope" }, 400));
    await app.request(`/auth/callback?code=abc&state=${state}`, {}, testEnv);
    expect(await getSetting(testEnv.DB, "ig_access_token")).toBe("old-token");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL, because `../src/auth` is not found.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
import { deleteSetting, getSetting, setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { InstagramError, createInstagramClient } from "./instagram";
import { MINUTE } from "./time";
import { constantTimeEqual } from "./webhook/verify";

export const OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];
export const WEBHOOK_FIELDS = ["comments", "messages", "messaging_postbacks"];
const STATE_TTL_MS = 10 * MINUTE;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function redirectUri(env: AppEnv): string {
  return `${env.PUBLIC_URL}/auth/callback`;
}

function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function startAuth(env: AppEnv, now: number): Promise<string> {
  const state = randomState();
  await setSetting(env.DB, "oauth_state", JSON.stringify({ state, expiresAt: now + STATE_TTL_MS }));
  const params = new URLSearchParams({
    client_id: env.IG_APP_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: OAUTH_SCOPES.join(","),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

async function readMeta(response: Response, step: string): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.error) {
    const nested = data.error as { message?: string } | undefined;
    const detail = (data.error_message as string | undefined) ?? nested?.message ?? `HTTP ${response.status}`;
    throw new AuthError(`Instagram ${step} failed: ${detail}`);
  }
  return data;
}

function requireValue(data: Record<string, unknown>, key: string, step: string): string {
  const value = data[key];
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  throw new AuthError(`Instagram ${step} returned no ${key}`);
}

export async function completeAuth(
  env: AppEnv,
  code: string,
  state: string,
  now: number,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<{ username: string }> {
  const stored = await getSetting(env.DB, "oauth_state");
  await deleteSetting(env.DB, "oauth_state"); // single-use
  const expected = stored ? (JSON.parse(stored) as { state: string; expiresAt: number }) : null;
  if (!expected || !constantTimeEqual(expected.state, state) || now > expected.expiresAt) {
    throw new AuthError("This login link is invalid or has expired. Run `npm run cli -- connect` to get a new one.");
  }

  const short = await readMeta(
    await fetchFn("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.IG_APP_ID,
        client_secret: env.IG_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(env),
        code,
      }).toString(),
    }),
    "code exchange",
  );

  const longUrl = new URL(`https://graph.instagram.com/${env.GRAPH_API_VERSION}/access_token`);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", env.IG_APP_SECRET);
  longUrl.searchParams.set("access_token", requireValue(short, "access_token", "code exchange"));
  const long = await readMeta(await fetchFn(longUrl.toString()), "long-lived token exchange");
  const accessToken = requireValue(long, "access_token", "long-lived token exchange");

  const meUrl = new URL(`https://graph.instagram.com/${env.GRAPH_API_VERSION}/me`);
  meUrl.searchParams.set("fields", "user_id,username");
  const me = await readMeta(
    await fetchFn(meUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } }),
    "profile lookup",
  );
  const igUserId = requireValue(me, "user_id", "profile lookup");
  const username = requireValue(me, "username", "profile lookup");

  try {
    await createInstagramClient({ accessToken, igUserId, version: env.GRAPH_API_VERSION, fetch: fetchFn })
      .subscribeWebhooks(WEBHOOK_FIELDS);
  } catch (err) {
    if (err instanceof InstagramError) throw new AuthError(`Webhook subscription failed: ${err.message}`);
    throw err;
  }

  await setSetting(env.DB, "ig_access_token", accessToken);
  await setSetting(env.DB, "ig_user_id", igUserId);
  await setSetting(env.DB, "ig_username", username);
  await setSetting(env.DB, "ig_token_refreshed_at", String(now));
  await deleteSetting(env.DB, "ig_token_error");
  return { username };
}
```

- [ ] **Step 4: Add the routes**

In `src/admin.ts`, add the import and route:
```ts
import { startAuth } from "./auth";

admin.post("/auth/start", async (c) => c.json({ url: await startAuth(c.env, Date.now()) }));
```

In `src/index.ts`, add the imports and route (before `app.route("/admin", admin)`). Merge `escapeHtml` and `page` into the existing `./pages` import:
```ts
import { AuthError, completeAuth } from "./auth";
import { escapeHtml, page } from "./pages";

app.get("/auth/callback", async (c) => {
  const error = c.req.query("error");
  if (error) {
    const reason = escapeHtml(c.req.query("error_description") ?? error);
    return c.html(page("Instagram connection cancelled", `<p>Instagram said: ${reason}.</p>
<p>Run <code>npm run cli -- connect</code> to try again.</p>`), 400);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.html(page("Connection failed", "<p>The login response was missing its code. Run <code>npm run cli -- connect</code> again.</p>"), 400);
  }
  try {
    const { username } = await completeAuth(c.env, code, state, Date.now());
    return c.html(page("Instagram connected", `<p>Connected as <strong>@${escapeHtml(username)}</strong>. You can close this tab.</p>`));
  } catch (err) {
    if (err instanceof AuthError) return c.html(page("Connection failed", `<p>${escapeHtml(err.message)}</p>`), 400);
    throw err;
  }
});
```

- [ ] **Step 5: Run the full suite and confirm it passes**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/admin.ts src/index.ts test/auth.test.ts
git commit -m "feat: connect Instagram via Instagram Login OAuth"
```

---

### Task 11: Command-line tool (`npm run cli`)

**Files:**
- Create: `scripts/cli-core.ts`, `scripts/dm-cli.ts`, `scripts/tsconfig.json`, `.env.example`
- Modify: `package.json` (`typecheck` script), `test/tsconfig.json` (add `"../scripts/cli-core.ts"` to `include`)
- Test: `test/cli-core.test.ts`

**Interfaces:**
- Consumes: the admin routes from Tasks 9 and 10.
- Produces:
  - `interface CliRequest { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown }`
  - `type CliParse`
  - `USAGE: string`
  - `parseCli(argv: string[]): CliParse`
  - CLI commands: `connect`, `health`, `media`, `actions`, `rules [list]`, `rules add --json|--file`, `rules update <id> --json|--file`

- [ ] **Step 1: Write the failing test**

`test/cli-core.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseCli } from "../scripts/cli-core";

describe("parseCli", () => {
  it.each([
    [["connect"], { method: "POST", path: "/admin/auth/start" }],
    [["health"], { method: "GET", path: "/admin/health" }],
    [["media"], { method: "GET", path: "/admin/media" }],
    [["actions"], { method: "GET", path: "/admin/actions/recent" }],
    [["rules"], { method: "GET", path: "/admin/rules" }],
    [["rules", "list"], { method: "GET", path: "/admin/rules" }],
    [["rules", "add", "--json", '{"name":"x"}'], { method: "POST", path: "/admin/rules", body: { name: "x" } }],
    [["rules", "update", "3", "--json", '{"active":false}'], { method: "PATCH", path: "/admin/rules/3", body: { active: false } }],
  ])("maps %j", (argv, request) => {
    expect(parseCli(argv)).toEqual({ ok: true, request });
  });

  it.each([
    [[], "no command"],
    [["launch"], 'unknown command "launch"'],
    [["rules", "add"], "missing --json"],
    [["rules", "add", "--json", "{bad"], "not valid JSON"],
    [["rules", "update", "x", "--json", "{}"], "rules update <id>"],
    [["rules", "zap"], 'unknown rules command "zap"'],
  ])("rejects %j", (argv, message) => {
    const result = parseCli(argv);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(message);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run test/cli-core.test.ts`
Expected: FAIL, because `../scripts/cli-core` is not found.

- [ ] **Step 3: Implement `scripts/cli-core.ts`**

```ts
export interface CliRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export type CliParse = { ok: true; request: CliRequest } | { ok: false; error: string };

export const USAGE = `Usage: npm run cli -- <command>

  connect                               Print the Instagram login link
  health                                Connection and queue status
  media                                 Recent posts and reels with their IDs
  actions                               The 20 most recent sends, with errors
  rules [list]                          List keyword rules
  rules add --json '<object>'           Create a rule (or: --file rule.json)
  rules update <id> --json '<object>'   Change a rule, e.g. '{"active":false}'`;

function request(method: CliRequest["method"], path: string, body?: unknown): CliParse {
  return { ok: true, request: body === undefined ? { method, path } : { method, path, body } };
}

function jsonFlag(args: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  const index = args.indexOf("--json");
  const raw = index === -1 ? undefined : args[index + 1];
  if (raw === undefined) return { ok: false, error: "missing --json '<object>' (or --file path.json)" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "--json is not valid JSON" };
  }
}

export function parseCli(argv: string[]): CliParse {
  const [command, sub, ...rest] = argv;
  switch (command) {
    case "connect":
      return request("POST", "/admin/auth/start");
    case "health":
      return request("GET", "/admin/health");
    case "media":
      return request("GET", "/admin/media");
    case "actions":
      return request("GET", "/admin/actions/recent");
    case "rules": {
      if (sub === undefined || sub === "list") return request("GET", "/admin/rules");
      if (sub === "add") {
        const json = jsonFlag(rest);
        return json.ok ? request("POST", "/admin/rules", json.value) : json;
      }
      if (sub === "update") {
        const id = rest[0];
        if (!id || !/^\d+$/.test(id)) return { ok: false, error: "usage: rules update <id> --json '<object>'" };
        const json = jsonFlag(rest.slice(1));
        return json.ok ? request("PATCH", `/admin/rules/${id}`, json.value) : json;
      }
      return { ok: false, error: `unknown rules command "${sub}"` };
    }
    default:
      return { ok: false, error: command ? `unknown command "${command}"` : "no command given" };
  }
}
```

- [ ] **Step 4: Implement `scripts/dm-cli.ts`, `scripts/tsconfig.json` and `.env.example`**

`scripts/dm-cli.ts`:
```ts
import { readFileSync } from "node:fs";
import { USAGE, parseCli } from "./cli-core";

function loadEnvFile(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env is optional if the variables are already exported
  }
}

/** Turn `--file rule.json` into `--json <contents>` so cli-core stays free of Node APIs. */
function expandFileFlag(argv: string[]): string[] {
  const index = argv.indexOf("--file");
  if (index === -1) return argv;
  const path = argv[index + 1];
  if (!path) throw new Error("--file needs a path");
  const copy = [...argv];
  copy.splice(index, 2, "--json", readFileSync(path, "utf8"));
  return copy;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help") {
    console.log(USAGE);
    return;
  }

  loadEnvFile();
  const baseUrl = process.env.DM_WORKER_URL;
  const token = process.env.DM_ADMIN_TOKEN;
  if (!baseUrl || !token) {
    console.error("Set DM_WORKER_URL and DM_ADMIN_TOKEN in .env (copy .env.example).");
    process.exit(1);
  }

  const parsed = parseCli(expandFileFlag(argv));
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const { method, path, body } = parsed.request;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let output: unknown = text;
  try {
    output = JSON.parse(text);
  } catch {
    // not JSON; print as-is
  }

  if (response.ok && path === "/admin/auth/start" && typeof output === "object" && output !== null && "url" in output) {
    console.log(`Open this link in your browser and approve access:\n\n${String(output.url)}\n`);
    return;
  }
  console.log(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  if (!response.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

`scripts/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["./**/*.ts"]
}
```

`.env.example`:
```
# Used by `npm run cli`. Copy to .env (never committed).
DM_WORKER_URL=https://dm-automation.YOUR-SUBDOMAIN.workers.dev
DM_ADMIN_TOKEN=the-same-value-you-set-with-wrangler-secret-put-ADMIN_TOKEN
```

Update the `typecheck` script in `package.json`:
```json
"typecheck": "tsc --noEmit && tsc --noEmit -p test && tsc --noEmit -p scripts"
```

In `test/tsconfig.json`, change `include` to:
```json
"include": ["./**/*.ts", "../src/**/*.ts", "../scripts/cli-core.ts", "../worker-configuration.d.ts"]
```

- [ ] **Step 5: Run the tests, typecheck and a local smoke run**

Run: `npx vitest run && npm run typecheck && npm run cli -- help`
Expected: all tests pass, typecheck exits 0, and the last command prints the usage text.

- [ ] **Step 6: Commit**

```bash
git add scripts .env.example package.json test/cli-core.test.ts
git commit -m "feat: add npm run cli for connecting and managing rules"
```

---

### Task 12: Deploy, connect Instagram, and run the go/no-go test

This task is done together with the user: they click through Meta's and Cloudflare's dashboards. Commands are run from the repo root.

**Files:**
- Create: `docs/setup.md`, `.dev.vars.example`, `README.md`
- Modify: `wrangler.jsonc` (real `database_id`, `PUBLIC_URL`, `CONTACT_EMAIL`)

**Interfaces:**
- Consumes: everything above.
- Produces: a live Worker plus a recorded go/no-go result.

- [ ] **Step 1: Write `docs/setup.md`**

````markdown
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
````

- [ ] **Step 2: Write `.dev.vars.example` and `README.md`**

`.dev.vars.example`:
```
# For `npm run dev` (wrangler dev). Copy to .dev.vars (never committed).
IG_APP_ID=
IG_APP_SECRET=
WEBHOOK_VERIFY_TOKEN=
ADMIN_TOKEN=
```

`README.md`:
```markdown
# dm-automation

Self-hosted, $0/month Instagram comment-to-DM automation on Cloudflare Workers — a ManyChat replacement
for one creator account. Replies to DMs are drafted with Claude Code (`/dms`, milestone 2) and sent only
after you approve them.

- Setup and go/no-go test: [docs/setup.md](docs/setup.md)
- Design: [docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md](docs/superpowers/specs/2026-09-28-instagram-dm-automation-design.md)
- Commands: `npm test`, `npm run typecheck`, `npm run deploy`, `npm run cli -- help`
```

- [ ] **Step 3: Run the final automated checks**

Run: `npx vitest run && npm run typecheck`
Expected: every test passes; typecheck exits 0.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/setup.md .dev.vars.example README.md
git commit -m "docs: add setup and go/no-go guide"
```

- [ ] **Step 5: Walk the user through `docs/setup.md` sections 1–3**

Do each step with the user and confirm the expected output before moving on. Commit the `wrangler.jsonc` changes (database ID, URL, email). They contain no secrets.
```bash
git add wrangler.jsonc
git commit -m "chore: configure deployed worker"
```

- [ ] **Step 6: Run the go/no-go test (section 4) and record the result**

Append the outcome to `docs/setup.md` under a new heading `## Go/no-go result (YYYY-MM-DD)`. Include what arrived, how long it took, and any errors from `npm run cli -- actions`. Then commit:
```bash
git add docs/setup.md
git commit -m "docs: record go/no-go result"
```

- **GO:** write the milestone 2 plan (follow gate, story replies, inbox and echoes, `/dms` and `business.md`, stats, sweep, token refresh).
- **NO-GO:** stop and discuss the options in the result section with the user.
