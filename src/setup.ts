import { deleteSetting, getSetting, setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { listInstagramAccounts, upsertWebhook, type ZernioAccount } from "./zernio";

export type SetupResult =
  | { ok: true; username: string | null; accountId: string; webhookId: string }
  | { ok: false; error: string; accounts?: ZernioAccount[] };

/** Links the Instagram account connected in Zernio and points Zernio's webhook at this Worker. */
export async function runSetup(
  env: AppEnv, requestedAccountId: string | null, fetchFn?: typeof fetch,
): Promise<SetupResult> {
  const accounts = await listInstagramAccounts(env.ZERNIO_API_KEY, fetchFn);
  if (accounts.length === 0) {
    return {
      ok: false,
      error: "No Instagram account is connected in Zernio yet. Connect it at zernio.com (choose Instagram login), then run setup again.",
    };
  }
  const account = requestedAccountId
    ? accounts.find((a) => a.id === requestedAccountId)
    : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) {
    return {
      ok: false,
      error: requestedAccountId
        ? "That id isn't one of the Instagram accounts connected in Zernio."
        : "Several Instagram accounts are connected in Zernio. Run setup again with the id of the one to use.",
      accounts,
    };
  }

  const webhookId = await upsertWebhook(env.ZERNIO_API_KEY, {
    webhookId: await getSetting(env.DB, "zernio_webhook_id"),
    url: `${env.PUBLIC_URL}/webhook`,
    secret: env.ZERNIO_WEBHOOK_SECRET,
    profileId: account.profileId,
  }, fetchFn);

  await setSetting(env.DB, "zernio_account_id", account.id);
  await setSetting(env.DB, "zernio_profile_id", account.profileId);
  await setSetting(env.DB, "zernio_webhook_id", webhookId);
  if (account.username) await setSetting(env.DB, "ig_username", account.username);
  else await deleteSetting(env.DB, "ig_username");
  return { ok: true, username: account.username, accountId: account.id, webhookId };
}
