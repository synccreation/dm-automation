import { countActions } from "./db/actions";
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { DAY } from "./time";

export interface Health {
  connected: boolean;
  username: string | null;
  tokenRefreshedAt: number | null;
  tokenError: string | null;
  subscriptionError: string | null;
  lastWebhookAt: number | null;
  pendingActions: number;
  failedLast24h: number;
}

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

export async function getHealth(env: AppEnv, now: number): Promise<Health> {
  const [
    token, username, refreshedAt, tokenError, subscriptionError, lastWebhookAt, pendingActions, failedLast24h,
  ] = await Promise.all([
    getSetting(env.DB, "ig_access_token"),
    getSetting(env.DB, "ig_username"),
    getSetting(env.DB, "ig_token_refreshed_at"),
    getSetting(env.DB, "ig_token_error"),
    getSetting(env.DB, "webhook_subscription_error"),
    getSetting(env.DB, "last_webhook_at"),
    countActions(env.DB, "pending"),
    countActions(env.DB, "failed", now - DAY),
  ]);
  return {
    connected: token !== null,
    username,
    tokenRefreshedAt: toNumber(refreshedAt),
    tokenError,
    subscriptionError,
    lastWebhookAt: toNumber(lastWebhookAt),
    pendingActions,
    failedLast24h,
  };
}
