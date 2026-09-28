import { Hono } from "hono";
import type { AppEnv } from "./env";

export const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.text("dm-automation: ok"));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
