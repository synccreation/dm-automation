import { getSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { createZernioClient, type ZernioClient } from "./zernio";

/** The Zernio client for the linked Instagram account, or null until `npm run cli -- setup`. */
export async function zernioFromSettings(env: AppEnv): Promise<ZernioClient | null> {
  const accountId = await getSetting(env.DB, "zernio_account_id");
  if (!accountId || !env.ZERNIO_API_KEY) return null;
  return createZernioClient({ apiKey: env.ZERNIO_API_KEY, accountId });
}
