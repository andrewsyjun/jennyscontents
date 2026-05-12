import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

loadEnv(envPath);

const callbackInput = process.argv[2] || process.env.TIKTOK_AUTH_CALLBACK_URL;

if (!callbackInput) {
  fail("Pass the TikTok callback URL as the first argument or set TIKTOK_AUTH_CALLBACK_URL in .env.");
}

const requiredEnv = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"];
const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length) {
  fail(`Missing ${missing.join(", ")} in .env.`);
}

const callbackUrl = parseCallbackUrl(callbackInput);
const code = callbackUrl.searchParams.get("code");
const state = callbackUrl.searchParams.get("state");
const error = callbackUrl.searchParams.get("error");
const errorType = callbackUrl.searchParams.get("error_type");

if (error || errorType) {
  fail(`TikTok returned ${errorType || error}.`);
}

if (!code) {
  fail("No code parameter found in callback URL.");
}

if (state && state !== "jennyscontents") {
  fail(`Unexpected OAuth state: ${state}.`);
}

const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cache-Control": "no-cache",
  },
  body: new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
  }),
});

const payload = await response.json().catch(() => ({}));

if (!response.ok || payload.error) {
  const message =
    payload.error_description ||
    payload.error?.message ||
    payload.error ||
    `HTTP ${response.status}`;
  fail(`Token exchange failed: ${message}`);
}

writeEnvValues(envPath, {
  TIKTOK_ACCESS_TOKEN: payload.access_token,
  TIKTOK_REFRESH_TOKEN: payload.refresh_token,
  TIKTOK_OPEN_ID: payload.open_id,
});

console.log(
  `OK TikTok token saved to .env for open_id ${payload.open_id || "unknown"}. Run: npm run check:access -- --platform tiktok --strict`
);

function parseCallbackUrl(input) {
  try {
    return new URL(input);
  } catch {
    fail("Callback input is not a valid URL.");
  }
}

function fail(message) {
  console.error(`ERROR ${message}`);
  process.exit(1);
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

function writeEnvValues(file, values) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const seen = new Set();

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line;

    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    if (!Object.hasOwn(values, key) || values[key] == null) return line;

    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key) && value != null) {
      nextLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(file, `${nextLines.join("\n").replace(/\n+$/, "")}\n`);
}
