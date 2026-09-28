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
            ZERNIO_API_KEY: "sk_test",
            ZERNIO_WEBHOOK_SECRET: "test-webhook-secret",
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
