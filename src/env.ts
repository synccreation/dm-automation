export interface AppEnv {
  DB: D1Database;
  ZERNIO_API_KEY: string;
  /** Our own secret; Zernio signs webhook deliveries with it (registered by `setup`). */
  ZERNIO_WEBHOOK_SECRET: string;
  ADMIN_TOKEN: string;
  PUBLIC_URL: string;
  CONTACT_EMAIL: string;
}
