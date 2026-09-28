import { Hono, type Context } from "hono";
import { zernioFromSettings } from "./account";
import { recentActions } from "./db/actions";
import { getRule, insertRule, listRules, updateRule, type NewRule } from "./db/rules";
import type { AppEnv } from "./env";
import { getHealth } from "./health";
import { createTrackedLink } from "./links";
import { parseNewRule, parseRulePatch } from "./rule-input";
import { runSetup } from "./setup";
import { constantTimeEqual } from "./webhook/verify";
import { ZernioError } from "./zernio";

export const admin = new Hono<{ Bindings: AppEnv }>();

admin.use("*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  if (!c.env.ADMIN_TOKEN || !constantTimeEqual(header, `Bearer ${c.env.ADMIN_TOKEN}`)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

admin.post("/setup", async (c) => {
  const body = await readJson(c);
  const requested = (body as { accountId?: unknown } | undefined)?.accountId;
  try {
    const result = await runSetup(c.env, typeof requested === "string" ? requested : null);
    return result.ok ? c.json(result) : c.json(result, 409);
  } catch (err) {
    if (err instanceof ZernioError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

admin.get("/health", async (c) => c.json(await getHealth(c.env, Date.now())));

admin.get("/rules", async (c) => c.json(await listRules(c.env.DB)));

admin.post("/rules", async (c) => {
  const parsed = parseNewRule(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { link_url, ...rule } = parsed.value;
  const now = Date.now();
  const link = link_url ? await createTrackedLink(c.env.DB, link_url, rule.name, now) : null;
  return c.json(await insertRule(c.env.DB, { ...rule, link_id: link?.id ?? null }, now), 201);
});

admin.patch("/rules/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  const parsed = parseRulePatch(await readJson(c));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const existing = await getRule(c.env.DB, id);
  if (!existing) return c.json({ error: "rule not found" }, 404);
  const { link_url, ...rest } = parsed.value;
  const patch: Partial<NewRule> = { ...rest };
  if (link_url) patch.link_id = (await createTrackedLink(c.env.DB, link_url, rest.name ?? existing.name, Date.now())).id;
  return c.json(await updateRule(c.env.DB, id, patch));
});

admin.get("/media", async (c) => {
  const zernio = await zernioFromSettings(c.env);
  if (!zernio) return c.json({ error: "Not set up yet. Run: npm run cli -- setup" }, 409);
  try {
    return c.json(await zernio.listPosts());
  } catch (err) {
    if (err instanceof ZernioError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

admin.get("/actions/recent", async (c) => c.json(await recentActions(c.env.DB, 20)));
