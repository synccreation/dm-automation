import { describe, expect, it } from "vitest";
import { parseCli } from "../scripts/cli-core";

describe("parseCli", () => {
  it.each([
    [["setup"], { method: "POST", path: "/admin/setup", body: {} }],
    [["setup", "acc2"], { method: "POST", path: "/admin/setup", body: { accountId: "acc2" } }],
    [["health"], { method: "GET", path: "/admin/health" }],
    [["media"], { method: "GET", path: "/admin/media" }],
    [["actions"], { method: "GET", path: "/admin/actions/recent" }],
    [["rules"], { method: "GET", path: "/admin/rules" }],
    [["rules", "list"], { method: "GET", path: "/admin/rules" }],
    [["rules", "add", "--json", '{"name":"x"}'], { method: "POST", path: "/admin/rules", body: { name: "x" } }],
    [["rules", "update", "3", "--json", '{"active":false}'], { method: "PATCH", path: "/admin/rules/3", body: { active: false } }],
  ])("maps %j", (argv, request) => {
    expect(parseCli(argv)).toEqual({ ok: true, request });
  });

  it.each([
    [[], "no command"],
    [["launch"], 'unknown command "launch"'],
    [["connect"], 'unknown command "connect"'],
    [["rules", "add"], "missing --json"],
    [["rules", "add", "--json", "{bad"], "not valid JSON"],
    [["rules", "update", "x", "--json", "{}"], "rules update <id>"],
    [["rules", "zap"], 'unknown rules command "zap"'],
  ])("rejects %j", (argv, message) => {
    const result = parseCli(argv);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(message);
  });
});
