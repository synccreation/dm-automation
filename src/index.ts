import { Hono } from "hono";
import type { AppEnv } from "./env";
import { handshakeChallenge } from "./webhook/verify";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

app.get("/webhook", (c) => {
  const challenge = handshakeChallenge(new URL(c.req.url).searchParams, c.env.WEBHOOK_VERIFY_TOKEN);
  return challenge === null ? c.text("forbidden", 403) : c.text(challenge);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
