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
