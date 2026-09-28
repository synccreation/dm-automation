import { Hono } from "hono";
import { admin } from "./admin";
import { setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { handleLinkRedirect } from "./links";
import { dataDeletionPage, privacyPage, termsPage } from "./pages";
import { runScheduler } from "./scheduler";
import { handleEvents } from "./webhook/handle";
import { parseWebhook } from "./webhook/parse";
import { handshakeChallenge, verifySignature } from "./webhook/verify";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

app.get("/webhook", (c) => {
  const challenge = handshakeChallenge(new URL(c.req.url).searchParams, c.env.WEBHOOK_VERIFY_TOKEN);
  return challenge === null ? c.text("forbidden", 403) : c.text(challenge);
});

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  const secrets = [c.env.IG_APP_SECRET, c.env.META_APP_SECRET].filter((s): s is string => Boolean(s));
  if (!(await verifySignature(raw, c.req.header("X-Hub-Signature-256") ?? null, secrets))) {
    return c.text("invalid signature", 401);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("invalid JSON", 400);
  }
  const now = Date.now();
  await setSetting(c.env.DB, "last_webhook_at", String(now));
  // Errors propagate as a 500 so Meta retries; handleEvents is idempotent.
  await handleEvents(c.env, parseWebhook(body), { now });
  return c.text("EVENT_RECEIVED");
});

app.get("/l/:code", (c) =>
  handleLinkRedirect(c.env.DB, c.req.param("code"), c.req.query("c") ?? null, Date.now()),
);
app.get("/privacy", (c) => c.html(privacyPage(c.env.CONTACT_EMAIL)));
app.get("/terms", (c) => c.html(termsPage(c.env.CONTACT_EMAIL)));
app.get("/data-deletion", (c) => c.html(dataDeletionPage(c.env.CONTACT_EMAIL)));

app.route("/admin", admin);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduler(env, controller.scheduledTime).then((report) => {
        if (report.sent + report.retried + report.failed + report.dropped > 0) {
          console.log(JSON.stringify({ scheduler: report }));
        }
      }),
    );
  },
} satisfies ExportedHandler<AppEnv>;
