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
