import { Hono } from "hono";
import { admin } from "./admin";
import { setSetting } from "./db/settings";
import type { AppEnv } from "./env";
import { handleLinkRedirect } from "./links";
import { dataDeletionPage, privacyPage, termsPage } from "./pages";
import { runScheduler } from "./scheduler";
import { handleEvent } from "./webhook/handle";
import { parseWebhook } from "./webhook/parse";
import { verifyZernioSignature } from "./webhook/verify";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

app.post("/webhook", async (c) => {
  const raw = await c.req.text();
  if (!(await verifyZernioSignature(raw, c.req.header("X-Zernio-Signature") ?? null, c.env.ZERNIO_WEBHOOK_SECRET))) {
    // Logged, not stored: unauthenticated requests must not cost D1 writes. Shows up in `wrangler tail`.
    console.warn(JSON.stringify({
      webhook: "rejected",
      reason: "bad signature",
      hint: "ZERNIO_WEBHOOK_SECRET doesn't match the secret registered by `npm run cli -- setup`",
    }));
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
  const event = parseWebhook(body);
  // Errors propagate as a 500 so Zernio redelivers; handleEvent is idempotent.
  if (event) await handleEvent(c.env, event, { now, defer: (task) => c.executionCtx.waitUntil(task) });
  return c.text("ok");
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
