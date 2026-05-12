import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));

let options;

try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR ${error.message}`);
  printHelp();
  process.exit(1);
}

const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";

const checks = [
  {
    id: "x",
    aliases: ["twitter"],
    name: "X",
    configured: Boolean(process.env.X_BEARER_TOKEN),
    run: checkX,
  },
  {
    id: "instagram",
    aliases: ["ig"],
    name: "Instagram",
    configured: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN),
    run: checkInstagram,
  },
  {
    id: "tiktok",
    aliases: ["tt"],
    name: "TikTok",
    configured: Boolean(process.env.TIKTOK_ACCESS_TOKEN),
    run: checkTikTok,
  },
];

if (options.help) {
  printHelp();
  process.exit(0);
}

let selectedChecks;

try {
  selectedChecks = selectChecks(checks, options.platform);
} catch (error) {
  console.error(`ERROR ${error.message}`);
  printHelp();
  process.exit(1);
}

let failures = 0;

for (const check of selectedChecks) {
  if (!check.configured) {
    const message = `${check.name}: token not configured.`;
    if (options.strict) {
      failures += 1;
      console.error(`FAIL ${message}`);
    } else {
      console.log(`SKIP ${message}`);
    }
    continue;
  }

  try {
    const summary = await check.run();
    console.log(`OK   ${check.name}: ${summary}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${error.message}`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

function parseArgs(args) {
  const parsed = {
    full: false,
    help: false,
    platform: null,
    strict: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--full") {
      parsed.full = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (arg === "--platform") {
      if (!args[index + 1] || args[index + 1].startsWith("-")) {
        throw new Error("--platform requires a value.");
      }
      parsed.platform = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--platform=")) {
      if (!arg.slice("--platform=".length)) {
        throw new Error("--platform requires a value.");
      }
      parsed.platform = arg.slice("--platform=".length);
      continue;
    }

    if (!arg.startsWith("-") && !parsed.platform) {
      parsed.platform = arg;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run check:access -- [options]

Options:
  --platform <x|instagram|tiktok>  Check one platform only.
  --full                          Run optional deeper checks.
  --strict                        Fail when a selected platform is missing credentials.
  --help                          Show this help.

Examples:
  npm run check:access
  npm run check:access -- --platform x
  npm run check:access -- --platform x --full
`);
}

function selectChecks(allChecks, platform) {
  if (!platform) return allChecks;

  const normalized = platform.toLowerCase();
  const selected = allChecks.find(
    (check) => check.id === normalized || check.aliases.includes(normalized)
  );

  if (!selected) {
    const allowed = allChecks.map((check) => check.id).join(", ");
    throw new Error(`Unknown platform "${platform}". Expected one of: ${allowed}.`);
  }

  return [selected];
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function checkX() {
  const username = process.env.X_USERNAME || "XDevelopers";
  const userUrl = new URL(`https://api.x.com/2/users/by/username/${username}`);
  userUrl.searchParams.set("user.fields", "created_at,description,public_metrics,verified");

  const user = await getJson(
    userUrl,
    {
      Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
    },
    "X"
  );

  const handle = user.data?.username || username;

  if (!shouldCheckXRecentSearch()) {
    return `connected as @${handle}; recent search not run`;
  }

  const searchUrl = new URL("https://api.x.com/2/tweets/search/recent");
  searchUrl.searchParams.set(
    "query",
    process.env.X_RECENT_SEARCH_QUERY ||
      '("real estate" OR realtor OR homebuyer OR homeseller) lang:en -is:retweet'
  );
  searchUrl.searchParams.set(
    "max_results",
    String(numberFromEnv("X_RECENT_SEARCH_MAX_RESULTS", 10, 10, 100))
  );
  searchUrl.searchParams.set("tweet.fields", "created_at,public_metrics,author_id,text");
  searchUrl.searchParams.set("expansions", "author_id");
  searchUrl.searchParams.set("user.fields", "username,public_metrics,verified");

  const search = await getJson(
    searchUrl,
    {
      Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
    },
    "X"
  );

  const count = search.data?.length || 0;
  return `connected as @${handle}; recent search returned ${count} posts`;
}

function shouldCheckXRecentSearch() {
  return options.full || truthy(process.env.X_CHECK_RECENT_SEARCH);
}

async function checkInstagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID || "me";
  const authMode = instagramAuthMode();
  const graphHost = authMode === "facebook_login" ? "graph.facebook.com" : "graph.instagram.com";

  const meUrl = new URL(`https://${graphHost}/${graphVersion}/${userId}`);
  meUrl.searchParams.set("fields", instagramProfileFields(authMode));
  meUrl.searchParams.set("access_token", token);

  const me = await getJson(meUrl, {}, "Instagram");

  const mediaUrl = new URL(`https://${graphHost}/${graphVersion}/${me.id}/media`);
  mediaUrl.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count"
  );
  mediaUrl.searchParams.set("limit", "5");
  mediaUrl.searchParams.set("access_token", token);

  const media = await getJson(mediaUrl, {}, "Instagram");
  const count = media.data?.length || 0;

  return `connected via ${authMode.replace("_", " ")} as @${me.username || process.env.INSTAGRAM_USERNAME || me.id}; media returned ${count} items`;
}

function instagramAuthMode() {
  const mode = String(process.env.INSTAGRAM_AUTH_MODE || "instagram_login")
    .toLowerCase()
    .replace(/[-\s]/g, "_");

  if (["instagram", "instagram_login"].includes(mode)) return "instagram_login";
  if (["facebook", "facebook_login", "facebook_login_for_business"].includes(mode)) {
    return "facebook_login";
  }

  throw new Error(
    `Unknown INSTAGRAM_AUTH_MODE "${process.env.INSTAGRAM_AUTH_MODE}". Use instagram_login or facebook_login.`
  );
}

function instagramProfileFields(authMode) {
  if (authMode === "facebook_login") {
    return "id,username,media_count";
  }

  return "id,username,account_type,media_count";
}

async function checkTikTok() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;

  const userUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
  userUrl.searchParams.set("fields", tiktokUserFields());

  const user = await getJson(
    userUrl,
    {
      Authorization: `Bearer ${token}`,
    },
    "TikTok"
  );

  const listUrl = new URL("https://open.tiktokapis.com/v2/video/list/");
  listUrl.searchParams.set(
    "fields",
    "id,create_time,share_url,video_description,duration,like_count,comment_count,share_count,view_count"
  );

  const videos = await postJson(
    listUrl,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    {
      max_count: numberFromEnv("TIKTOK_VIDEO_LIST_MAX_COUNT", 10, 1, 20),
    },
    "TikTok"
  );

  const profile = user.data?.user || {};
  const count = videos.data?.videos?.length || 0;
  return `connected as @${profile.username || process.env.TIKTOK_USERNAME || profile.display_name || "unknown"}; video list returned ${count} items`;
}

function tiktokUserFields() {
  return process.env.TIKTOK_USER_FIELDS || "open_id,avatar_url,display_name";
}

async function getJson(url, headers = {}, platform = "") {
  const response = await fetch(url, { headers });
  return parseResponse(response, platform);
}

async function postJson(url, headers = {}, body = {}, platform = "") {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseResponse(response, platform);
}

async function parseResponse(response, platform) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok || hasApiError(data)) {
    const message =
      apiErrorMessage(data) ||
      data.title ||
      data.detail ||
      data.message ||
      `HTTP ${response.status}`;
    throw new Error(withHint(message, response.status, platform));
  }

  return data;
}

function hasApiError(data) {
  if (!data.error) return false;
  if (data.error.code === "ok") return false;
  return Boolean(data.error.code || data.error.message || data.error.type);
}

function apiErrorMessage(data) {
  if (data.error?.message) return data.error.message;
  if (data.error?.code && data.error.code !== "ok") return data.error.code;
  if (Array.isArray(data.errors) && data.errors[0]?.message) return data.errors[0].message;
  if (Array.isArray(data.errors) && data.errors[0]?.detail) return data.errors[0].detail;
  return "";
}

function withHint(message, status, platform) {
  const hints = {
    401: "check that the token is current and was copied without spaces",
    403: "check app permissions, scopes, product approval, and platform access level",
    429: "rate limit or usage cap reached; wait or check the developer dashboard",
  };
  const hint = hints[status];
  const prefix = status >= 400 ? `HTTP ${status}: ` : "";
  const suffix = hint ? ` (${platform ? `${platform}: ` : ""}${hint})` : "";
  return `${prefix}${message}${suffix}`;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
