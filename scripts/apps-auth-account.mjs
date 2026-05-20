import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPoolFromEnv,
  ensureAppsAuthSchema,
  hashPassword,
  listAccounts,
  loadEnv,
  setAccountActive,
  upsertAccount,
} from "./apps-auth-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));
loadEnv(process.env.APPS_AUTH_ENV_FILE || "/etc/jenny-apps-auth/apps-auth.env");

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";
const pool = createPoolFromEnv();

if (!pool) {
  console.error("APPS_AUTH_DATABASE_URL is required.");
  process.exit(1);
}

try {
  await ensureAppsAuthSchema(pool);

  if (command === "list") {
    const rows = await listAccounts(pool);
    for (const row of rows) {
      console.log(
        [
          row.username,
          row.name,
          row.isActive ? "active" : "disabled",
          Array.isArray(row.apps) ? row.apps.join(",") : "",
          row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : "never",
        ].join("\t")
      );
    }
  } else if (command === "upsert") {
    const username = args.username;
    const password = args.password || process.env.APPS_AUTH_ACCOUNT_PASSWORD || "";
    if (!username || !password) {
      throw new Error("upsert requires --username and --password or APPS_AUTH_ACCOUNT_PASSWORD");
    }

    const account = await upsertAccount(pool, {
      username,
      name: args.name || username,
      passwordHash: hashPassword(password),
      apps: csv(args.apps || "contents"),
      isActive: args.active !== "false",
    });

    console.log(`saved ${account.username} (${account.apps.join(",") || "no apps"})`);
  } else if (command === "disable" || command === "enable") {
    const username = args.username;
    if (!username) throw new Error(`${command} requires --username`);
    const account = await setAccountActive(pool, username, command === "enable");
    if (!account) throw new Error(`account not found: ${username}`);
    console.log(`${account.username} ${account.isActive ? "enabled" : "disabled"}`);
  } else {
    printUsage();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printUsage() {
  console.log(`Usage:
  npm run apps:account -- list
  npm run apps:account -- upsert --username jenny --name "Jenny Jun" --apps contents --password "temporary-password"
  npm run apps:account -- disable --username jenny
  npm run apps:account -- enable --username jenny`);
}
