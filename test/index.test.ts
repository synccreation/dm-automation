import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { resetDb, testEnv } from "./helpers";

describe("worker scaffold", () => {
  beforeEach(resetDb);

  it("answers on /", async () => {
    const res = await app.request("/", {}, testEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dm-automation: ok");
  });

  it("creates every table from the initial migration", async () => {
    const { results } = await testEnv.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    const names = results
      .map((r) => r.name)
      .filter((n) => !n.startsWith("_cf") && !n.startsWith("sqlite_") && n !== "d1_migrations");
    expect(names).toEqual([
      "actions", "clicks", "contacts", "conversations", "links",
      "messages", "processed_events", "rules", "settings", "triggers",
    ]);
  });
});
