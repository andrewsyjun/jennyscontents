import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

loadEnv(envPath);

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const port = numberFromEnv("GOOGLE_DRIVE_OAUTH_PORT", 8787, 1024, 65535);
const redirectUri =
  process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI || `http://127.0.0.1:${port}/oauth2callback`;
const state = crypto.randomBytes(16).toString("hex");

if (!clientId || !clientSecret) {
  console.error("ERROR Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("state", state);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", redirectUri);
    if (url.pathname !== new URL(redirectUri).pathname) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    if (url.searchParams.get("state") !== state) {
      response.writeHead(400);
      response.end("Invalid OAuth state.");
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      response.writeHead(400);
      response.end(`Google OAuth error: ${escapeHtml(error)}`);
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      response.writeHead(400);
      response.end("Missing OAuth code.");
      return;
    }

    const token = await exchangeCode(code);
    if (!token.refresh_token) {
      response.writeHead(400);
      response.end(
        "Google did not return a refresh token. Re-run this command and make sure you approve offline access."
      );
      return;
    }

    writeEnvValues(envPath, {
      GOOGLE_DRIVE_REFRESH_TOKEN: token.refresh_token,
      GOOGLE_DRIVE_OAUTH_REDIRECT_URI: redirectUri,
      GOOGLE_DRIVE_OAUTH_PORT: String(port),
    });

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<p>Google Drive authorization saved. You can close this tab.</p>");
    console.log("OK Google Drive refresh token saved to .env.");
  } catch (error) {
    response.writeHead(500);
    response.end("Authorization failed.");
    console.error(`ERROR ${error.message}`);
  } finally {
    setTimeout(() => server.close(), 250);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Open this URL to authorize Google Drive access:");
  console.log(authUrl.toString());
});

async function exchangeCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
  }
  return payload;
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

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
