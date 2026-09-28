import { countActions } from "./db/actions";
import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { DAY } from "./time";

export interface Health {
  connected: boolean;
  username: string | null;
  webhookRegistered: boolean;
  lastWebhookAt: number | null;
  pendingActions: number;
  failedLast24h: number;
}

export async function getHealth(env: AppEnv, now: number): Promise<Health> {
  const [accountId, username, webhookId, lastWebhookAt, pendingActions, failedLast24h] = await Promise.all([
    getSetting(env.DB, "zernio_account_id"),
    getSetting(env.DB, "ig_username"),
    getSetting(env.DB, "zernio_webhook_id"),
    getSetting(env.DB, "last_webhook_at"),
    countActions(env.DB, "pending"),
    countActions(env.DB, "failed", now - DAY),
  ]);
  return {
    connected: accountId !== null && Boolean(env.ZERNIO_API_KEY),
    username,
    webhookRegistered: webhookId !== null,
    lastWebhookAt: lastWebhookAt === null ? null : Number(lastWebhookAt),
    pendingActions,
    failedLast24h,
  };
}
