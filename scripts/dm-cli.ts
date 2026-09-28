import { readFileSync } from "node:fs";
import { USAGE, parseCli } from "./cli-core";

function loadEnvFile(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env is optional if the variables are already exported
  }
}

/** Turn `--file rule.json` into `--json <contents>` so cli-core stays free of Node APIs. */
function expandFileFlag(argv: string[]): string[] {
  const index = argv.indexOf("--file");
  if (index === -1) return argv;
  const path = argv[index + 1];
  if (!path) throw new Error("--file needs a path");
  const copy = [...argv];
  copy.splice(index, 2, "--json", readFileSync(path, "utf8"));
  return copy;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help") {
    console.log(USAGE);
    return;
  }

  loadEnvFile();
  const baseUrl = process.env.DM_WORKER_URL;
  const token = process.env.DM_ADMIN_TOKEN;
  if (!baseUrl || !token) {
    console.error("Set DM_WORKER_URL and DM_ADMIN_TOKEN in .env (copy .env.example).");
    process.exit(1);
  }

  const parsed = parseCli(expandFileFlag(argv));
  if (!parsed.ok) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exit(1);
  }

  const { method, path, body } = parsed.request;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let output: unknown = text;
  try {
    output = JSON.parse(text);
  } catch {
    // not JSON; print as-is
  }

  console.log(typeof output === "string" ? output : JSON.stringify(output, null, 2));
  if (!response.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
