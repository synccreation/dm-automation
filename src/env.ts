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
