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
