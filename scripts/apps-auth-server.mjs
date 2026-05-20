import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));

const host = process.env.APPS_AUTH_HOST || "127.0.0.1";
const port = numberFromEnv("APPS_AUTH_PORT", 4180, 1024, 65535);
const cookieName = process.env.APPS_AUTH_COOKIE_NAME || "jr_apps_session";
const sessionSeconds = numberFromEnv("APPS_AUTH_SESSION_SECONDS", 12 * 60 * 60, 900, 30 * 24 * 60 * 60);
const authSecret = process.env.APPS_AUTH_SECRET || "";
const users = loadUsers();
const apps = loadApps();
const routeMap = loadRouteMap();
const loginAttempts = new Map();

if (!authSecret || authSecret.length < 32) {
  console.error("APPS_AUTH_SECRET must be set to at least 32 characters.");
  process.exit(1);
}

if (!users.length) {
  console.error("No app users configured. Set APPS_AUTH_USERS_FILE or APPS_AUTH_USERS_JSON.");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/check") {
      handleAuthCheck(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/login") {
      handleLoginGet(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/login") {
      readBody(request)
        .then((body) => handleLoginPost(request, response, body))
        .catch((error) => renderLogin(response, { error: error.message, next: safeNextPath(url.searchParams.get("next")) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/logout") {
      clearSessionCookie(response);
      redirect(response, "/login?signedOut=1");
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      handleLauncher(request, response);
      return;
    }

    send(response, 404, pageShell({ title: "Not found", body: "<h1>Not found</h1>" }));
  } catch (error) {
    send(response, 500, pageShell({ title: "App login error", body: `<h1>App login error</h1><p>${escapeHtml(error.message)}</p>` }));
  }
});

server.listen(port, host, () => {
  console.log(`Jenny Apps auth server: http://${host}:${port}/`);
});

function handleAuthCheck(request, response) {
  const session = readSession(request);
  if (!session) {
    send(response, 401, "", "text/plain; charset=utf-8", { "Cache-Control": "no-store" });
    return;
  }

  const originalUri = request.headers["x-original-uri"] || "/";
  const requiredApp = appForPath(String(originalUri));
  if (requiredApp && !canUseApp(session, requiredApp)) {
    send(response, 403, "", "text/plain; charset=utf-8", authHeaders(session));
    return;
  }

  send(response, 204, "", "text/plain; charset=utf-8", authHeaders(session));
}

function handleLoginGet(request, response, url) {
  const next = safeNextPath(url.searchParams.get("next"));
  if (readSession(request)) {
    redirect(response, next || "/");
    return;
  }

  renderLogin(response, {
    next,
    notice: url.searchParams.get("signedOut") ? "Signed out." : "",
  });
}

function handleLoginPost(request, response, body) {
  const params = new URLSearchParams(body);
  const username = normalizeUsername(params.get("username"));
  const password = params.get("password") || "";
  const next = safeNextPath(params.get("next"));
  const key = `${clientIp(request)}:${username || "unknown"}`;
  const attempt = checkLoginRate(key);

  if (!attempt.allowed) {
    renderLogin(response, {
      username,
      next,
      error: `Too many attempts. Try again in ${Math.ceil(attempt.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  const user = users.find((item) => item.username === username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    renderLogin(response, {
      username,
      next,
      error: "The username or password was not recognized.",
    });
    return;
  }

  loginAttempts.delete(key);
  setSessionCookie(response, {
    username: user.username,
    name: user.name || user.username,
    apps: user.apps || [],
  });
  redirect(response, next || "/");
}

function handleLauncher(request, response) {
  const session = readSession(request);
  if (!session) {
    redirect(response, "/login?next=/");
    return;
  }

  const visibleApps = apps.filter((app) => canUseApp(session, app.id));
  const cards = visibleApps
    .map(
      (app) => `<a class="app-card" href="${escapeHtml(app.href)}">
        <span>${escapeHtml(app.label)}</span>
        <strong>${escapeHtml(app.name)}</strong>
        <em>${escapeHtml(app.description)}</em>
      </a>`
    )
    .join("");

  send(
    response,
    200,
    pageShell({
      title: "Jenny Apps",
      body: `<main class="launcher">
        <header class="topbar">
          <div>
            <p class="eyebrow">Jenny Apps</p>
            <h1>Internal workspace</h1>
          </div>
          <div class="session-chip">
            <span>${escapeHtml(session.name || session.username)}</span>
            <a href="/logout">Sign out</a>
          </div>
        </header>
        <section class="app-grid">${cards || "<p>No apps are available for this account.</p>"}</section>
      </main>`,
    })
  );
}

function renderLogin(response, { username = "", next = "/", error = "", notice = "" } = {}) {
  const message = error
    ? `<p class="form-message error">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="form-message">${escapeHtml(notice)}</p>`
      : "";

  send(
    response,
    200,
    pageShell({
      title: "Jenny Apps Login",
      body: `<main class="login-shell">
        <section class="login-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Sign in</h1>
          <p class="login-copy">Use this workspace for internal tools like content planning and client operations.</p>
          ${message}
          <form method="post" action="/login">
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <label>
              Username
              <input name="username" autocomplete="username" value="${escapeHtml(username)}" autofocus />
            </label>
            <label>
              Password
              <input name="password" type="password" autocomplete="current-password" />
            </label>
            <button type="submit">Sign in</button>
          </form>
        </section>
      </main>`,
    })
  );
}

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3ed;
        --panel: #fffdf8;
        --ink: #1d2722;
        --muted: #66736c;
        --line: #ddd6ca;
        --accent: #245746;
        --accent-strong: #163c30;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: inherit; }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .login-card, .topbar, .app-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: 0 18px 55px rgba(29, 39, 34, 0.08);
      }
      .login-card {
        width: min(100%, 420px);
        padding: 30px;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.8rem, 5vw, 2.5rem);
        letter-spacing: 0;
      }
      .login-copy {
        margin: 10px 0 24px;
        color: var(--muted);
        line-height: 1.55;
      }
      form, label {
        display: grid;
        gap: 10px;
      }
      form { gap: 16px; }
      label {
        font-size: 0.82rem;
        font-weight: 800;
        color: var(--muted);
      }
      input {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 12px 13px;
        color: var(--ink);
        background: white;
        font: inherit;
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 13px 16px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 850;
        cursor: pointer;
      }
      button:hover { background: var(--accent-strong); }
      .form-message {
        margin: 0 0 16px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 10px 12px;
        color: var(--muted);
        background: #f9f6ef;
      }
      .form-message.error {
        border-color: #d8aaa0;
        color: #8b2f24;
        background: #fff4f1;
      }
      .launcher {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 48px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: center;
        padding: 22px;
      }
      .session-chip {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .session-chip a {
        color: var(--accent);
        font-weight: 800;
        text-decoration: none;
      }
      .app-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .app-card {
        min-height: 154px;
        display: grid;
        align-content: start;
        gap: 12px;
        padding: 20px;
        text-decoration: none;
      }
      .app-card:hover {
        border-color: #b9ad9d;
        transform: translateY(-1px);
      }
      .app-card span {
        color: var(--accent);
        font-size: 0.76rem;
        font-weight: 850;
        text-transform: uppercase;
      }
      .app-card strong {
        font-size: 1.3rem;
      }
      .app-card em {
        color: var(--muted);
        font-style: normal;
        line-height: 1.45;
      }
      @media (max-width: 620px) {
        .topbar { align-items: flex-start; flex-direction: column; }
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function readSession(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const raw = cookies[cookieName];
  if (!raw) return null;

  const [payloadText, signature] = raw.split(".");
  if (!payloadText || !signature) return null;
  if (!timingSafeEqual(signature, sign(payloadText))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    if (!users.some((user) => user.username === payload.username)) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(response, session) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      ...session,
      iat: now,
      exp: now + sessionSeconds,
      nonce: crypto.randomBytes(12).toString("base64url"),
    })
  ).toString("base64url");
  const cookie = `${cookieName}=${payload}.${sign(payload)}; Path=/; Max-Age=${sessionSeconds}; HttpOnly; Secure; SameSite=Lax`;
  response.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function sign(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPassword(password, hash) {
  const [kind, iterationsText, salt, expected] = String(hash || "").split("$");
  if (kind !== "pbkdf2-sha256" || !iterationsText || !salt || !expected) return false;

  const iterations = Number.parseInt(iterationsText, 10);
  if (!Number.isFinite(iterations) || iterations < 100_000) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return timingSafeEqual(actual, expected);
}

function loadUsers() {
  const fromFile = process.env.APPS_AUTH_USERS_FILE;
  const raw = fromFile
    ? fs.readFileSync(fromFile, "utf8")
    : process.env.APPS_AUTH_USERS_JSON || "[]";

  return JSON.parse(raw).map((user) => ({
    username: normalizeUsername(user.username || user.email),
    name: String(user.name || user.username || "").trim(),
    passwordHash: String(user.passwordHash || ""),
    apps: Array.isArray(user.apps) ? user.apps.map(String) : [],
  }));
}

function loadApps() {
  const raw =
    process.env.APPS_AUTH_APPS ||
    "contents|Content Planner|Jenny's Contents|Find social signals, draft ideas, and manage video prompts.|/contents/";
  return raw
    .split(";")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [id, label, name, description, href] = row.split("|");
      return {
        id: id?.trim(),
        label: label?.trim() || "App",
        name: name?.trim() || id?.trim(),
        description: description?.trim() || "",
        href: href?.trim() || "/",
      };
    })
    .filter((app) => app.id);
}

function loadRouteMap() {
  const raw = process.env.APPS_AUTH_ROUTES || "/contents=contents";
  return raw
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [prefix, appId] = row.split("=");
      return {
        prefix: normalizePrefix(prefix),
        appId: appId?.trim(),
      };
    })
    .filter((row) => row.prefix && row.appId);
}

function appForPath(value) {
  const pathname = safePathname(value);
  const match = routeMap.find((row) => pathname === row.prefix || pathname.startsWith(`${row.prefix}/`));
  return match?.appId || "";
}

function canUseApp(session, appId) {
  return Array.isArray(session.apps) && (session.apps.includes("*") || session.apps.includes(appId));
}

function authHeaders(session) {
  return {
    "Cache-Control": "no-store",
    "X-Apps-User": session.username || "",
    "X-Apps-Name": session.name || "",
    "X-Apps-Apps": Array.isArray(session.apps) ? session.apps.join(",") : "",
  };
}

function checkLoginRate(key) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const limit = 8;
  const existing = loginAttempts.get(key) || [];
  const recent = existing.filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  loginAttempts.set(key, recent);

  return {
    allowed: recent.length <= limit,
    retryAfterMs: recent.length > limit ? windowMs - (now - recent[0]) : 0,
  };
}

function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePrefix(value) {
  const text = String(value || "").trim();
  if (!text || text === "/") return "/";
  return `/${text.replace(/^\/+|\/+$/g, "")}`;
}

function safeNextPath(value) {
  const text = String(value || "/").trim() || "/";
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text;
}

function safePathname(value) {
  try {
    return new URL(String(value || "/"), "https://apps.junresidential.com").pathname;
  } catch {
    return "/";
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  response.end();
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function send(response, status, body, contentType = "text/html; charset=utf-8", headers = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberFromEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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
