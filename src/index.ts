import { Hono } from "hono";
import type { AppEnv } from "./env";
import { handleLinkRedirect } from "./links";
import { dataDeletionPage, privacyPage, termsPage } from "./pages";
import { handshakeChallenge } from "./webhook/verify";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

app.get("/webhook", (c) => {
  const challenge = handshakeChallenge(new URL(c.req.url).searchParams, c.env.WEBHOOK_VERIFY_TOKEN);
  return challenge === null ? c.text("forbidden", 403) : c.text(challenge);
});

app.get("/l/:code", (c) =>
  handleLinkRedirect(c.env.DB, c.req.param("code"), c.req.query("c") ?? null, Date.now()),
);
app.get("/privacy", (c) => c.html(privacyPage(c.env.CONTACT_EMAIL)));
app.get("/terms", (c) => c.html(termsPage(c.env.CONTACT_EMAIL)));
app.get("/data-deletion", (c) => c.html(dataDeletionPage(c.env.CONTACT_EMAIL)));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
