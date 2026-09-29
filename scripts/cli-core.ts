export interface CliRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export type CliParse = { ok: true; request: CliRequest } | { ok: false; error: string };

export const USAGE = `Usage: npm run cli -- <command>

  setup [accountId]                     Link your Zernio Instagram account and register the webhook
  backfill <postId>                     Run a post's existing comments through the rules
  health                                Connection and queue status
  media                                 Recent posts and reels with their IDs
  actions                               The 20 most recent sends, with errors
  rules [list]                          List keyword rules
  rules add --json '<object>'           Create a rule (or: --file rule.json)
  rules update <id> --json '<object>'   Change a rule, e.g. '{"active":false}'`;

function request(method: CliRequest["method"], path: string, body?: unknown): CliParse {
  return { ok: true, request: body === undefined ? { method, path } : { method, path, body } };
}

function jsonFlag(args: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  const index = args.indexOf("--json");
  const raw = index === -1 ? undefined : args[index + 1];
  if (raw === undefined) return { ok: false, error: "missing --json '<object>' (or --file path.json)" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "--json is not valid JSON" };
  }
}

export function parseCli(argv: string[]): CliParse {
  const [command, sub, ...rest] = argv;
  switch (command) {
    case "setup":
      return request("POST", "/admin/setup", sub === undefined ? {} : { accountId: sub });
    case "backfill":
      return sub ? request("POST", "/admin/backfill", { mediaId: sub }) : { ok: false, error: "usage: backfill <postId>" };
    case "health":
      return request("GET", "/admin/health");
    case "media":
      return request("GET", "/admin/media");
    case "actions":
      return request("GET", "/admin/actions/recent");
    case "rules": {
      if (sub === undefined || sub === "list") return request("GET", "/admin/rules");
      if (sub === "add") {
        const json = jsonFlag(rest);
        return json.ok ? request("POST", "/admin/rules", json.value) : json;
      }
      if (sub === "update") {
        const id = rest[0];
        if (!id || !/^\d+$/.test(id)) return { ok: false, error: "usage: rules update <id> --json '<object>'" };
        const json = jsonFlag(rest.slice(1));
        return json.ok ? request("PATCH", `/admin/rules/${id}`, json.value) : json;
      }
      return { ok: false, error: `unknown rules command "${sub}"` };
    }
    default:
      return { ok: false, error: command ? `unknown command "${command}"` : "no command given" };
  }
}
