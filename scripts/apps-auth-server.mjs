import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  countAccounts,
  createPoolFromEnv,
  ensureAppsAuthSchema,
  findAccountByUsername,
  findPasswordResetToken,
  hashPassword,
  loadEnv,
  normalizeUsername,
  recordLoginEvent,
  setAccountTotpSecret,
  timingSafeEqual,
  updateAccountPassword,
  verifyPassword,
} from "./apps-auth-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));
loadEnv(process.env.APPS_AUTH_ENV_FILE || "/etc/jenny-apps-auth/apps-auth.env");

const host = process.env.APPS_AUTH_HOST || "127.0.0.1";
const port = numberFromEnv("APPS_AUTH_PORT", 4180, 1024, 65535);
const cookieName = process.env.APPS_AUTH_COOKIE_NAME || "jr_apps_session";
const mfaCookieName = `${cookieName}_mfa`;
const sessionSeconds = numberFromEnv("APPS_AUTH_SESSION_SECONDS", 12 * 60 * 60, 900, 30 * 24 * 60 * 60);
const mfaSeconds = numberFromEnv("APPS_AUTH_MFA_SECONDS", 10 * 60, 60, 60 * 60);
const requireTotp = process.env.APPS_AUTH_REQUIRE_TOTP !== "0";
const authSecret = process.env.APPS_AUTH_SECRET || "";
const databasePool = createPoolFromEnv();
const fileUsers = databasePool ? [] : loadUsers();
const apps = loadApps();
const routeMap = loadRouteMap();
const mailer = createMailerFromEnv();
const loginAttempts = new Map();

if (!authSecret || authSecret.length < 32) {
  console.error("APPS_AUTH_SECRET must be set to at least 32 characters.");
  process.exit(1);
}

if (!databasePool && !fileUsers.length) {
  console.error("No app users configured. Set APPS_AUTH_USERS_FILE or APPS_AUTH_USERS_JSON.");
  process.exit(1);
}

await bootstrapDatabase();

const server = http.createServer((request, response) => {
  routeRequest(request, response).catch((error) => {
    send(response, 500, pageShell({ title: "App login error", body: `<h1>App login error</h1><p>${escapeHtml(error.message)}</p>` }));
  });
});

server.listen(port, host, () => {
  console.log(`Jenny Apps auth server: http://${host}:${port}/`);
});

async function routeRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/auth/check") {
      await handleAuthCheck(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/login") {
      await handleLoginGet(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/login") {
      try {
        await handleLoginPost(request, response, await readBody(request));
      } catch (error) {
        renderLogin(response, { error: error.message, next: safeNextPath(url.searchParams.get("next")) });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/reset-password") {
      await handleResetPasswordGet(response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/reset-password") {
      try {
        await handleResetPasswordPost(request, response, await readBody(request));
      } catch (error) {
        renderResetPassword(response, { error: error.message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/account/password") {
      await handleChangePasswordGet(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/account/password") {
      try {
        await handleChangePasswordPost(request, response, await readBody(request));
      } catch (error) {
        renderChangePassword(response, { error: error.message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/logout") {
      clearSessionCookie(response);
      clearMfaCookie(response);
      redirect(response, "/login?signedOut=1");
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      await handleLauncher(request, response);
      return;
    }

    send(response, 404, pageShell({ title: "Not found", body: "<h1>Not found</h1>" }));
  } catch (error) {
    send(response, 500, pageShell({ title: "App login error", body: `<h1>App login error</h1><p>${escapeHtml(error.message)}</p>` }));
  }
}

async function bootstrapDatabase() {
  if (!databasePool) return;

  await ensureAppsAuthSchema(databasePool);
  const accountCount = await countAccounts(databasePool);
  if (!accountCount) {
    console.warn("Apps auth database is ready, but no app accounts exist yet.");
  }
}

async function handleAuthCheck(request, response) {
  const session = await readSession(request);
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

async function handleLoginGet(request, response, url) {
  const next = safeNextPath(url.searchParams.get("next"));
  if (await readSession(request)) {
    redirect(response, next || "/");
    return;
  }

  const mfaState = readMfaState(request);
  if (mfaState?.username) {
    const user = await findConfiguredUser(mfaState.username);
    if (user && mfaState.setupSecret) {
      setMfaCookie(response, mfaState);
      await renderTotpSetup(response, {
        username: user.username,
        next: mfaState.next || next,
        secret: mfaState.setupSecret,
      });
      return;
    }

    if (user && user.totpEnabled && user.totpSecret) {
      setMfaCookie(response, mfaState);
      renderTotpChallenge(response, {
        username: user.username,
        next: mfaState.next || next,
      });
      return;
    }
  }

  renderLogin(response, {
    next,
    notice: url.searchParams.get("signedOut") ? "Signed out." : "",
  });
}

async function handleLoginPost(request, response, body) {
  const params = new URLSearchParams(body);
  const mfaStage = String(params.get("mfaStage") || "");
  if (mfaStage) {
    await handleMfaPost(request, response, params, mfaStage);
    return;
  }

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

  const user = await findConfiguredUser(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await recordLogin(request, { username, success: false });
    renderLogin(response, {
      username,
      next,
      error: "The username or password was not recognized.",
    });
    return;
  }

  loginAttempts.delete(key);

  if (requireTotp) {
    if (!databasePool) {
      renderLogin(response, {
        username,
        next,
        error: "Authenticator app setup requires database-backed app accounts.",
      });
      return;
    }

    if (user.totpEnabled && user.totpSecret) {
      setMfaCookie(response, { username: user.username, next });
      renderTotpChallenge(response, { username: user.username, next });
      return;
    }

    const secret = generateTotpSecret();
    setMfaCookie(response, { username: user.username, next, setupSecret: secret });
    await renderTotpSetup(response, { username: user.username, next, secret });
    return;
  }

  await recordLogin(request, { username, accountId: user.id, success: true });
  setSessionCookie(response, {
    username: user.username,
    name: user.name || user.username,
    apps: user.apps || [],
  });
  redirect(response, next || "/");
}

async function handleMfaPost(request, response, params, mfaStage) {
  if (!databasePool) throw new Error("Authenticator app setup requires database-backed app accounts.");

  const state = readMfaState(request);
  const next = safeNextPath(params.get("next") || state?.next);
  const code = normalizeTotpCode(params.get("totpCode"));
  const username = normalizeUsername(state?.username);
  const key = `mfa:${clientIp(request)}:${username || "unknown"}`;
  const attempt = checkLoginRate(key);

  if (!state || !username) {
    clearMfaCookie(response);
    renderLogin(response, {
      next,
      error: "Your verification window expired. Sign in again.",
    });
    return;
  }

  const user = await findConfiguredUser(username);
  if (!user) {
    clearMfaCookie(response);
    renderLogin(response, {
      next,
      error: "Your account could not be verified. Sign in again.",
    });
    return;
  }

  if (!attempt.allowed) {
    const error = `Too many verification attempts. Try again in ${Math.ceil(attempt.retryAfterMs / 1000)} seconds.`;
    if (state.setupSecret) {
      setMfaCookie(response, state);
      await renderTotpSetup(response, { username: user.username, next, secret: state.setupSecret, error });
      return;
    }

    setMfaCookie(response, state);
    renderTotpChallenge(response, { username: user.username, next, error });
    return;
  }

  const secret = state.setupSecret || user.totpSecret;
  if (!secret || !verifyTotpCode(secret, code)) {
    await recordLogin(request, { username: user.username, accountId: user.id, success: false });
    const error = "That authenticator code was not recognized.";
    if (state.setupSecret) {
      setMfaCookie(response, state);
      await renderTotpSetup(response, { username: user.username, next, secret: state.setupSecret, error });
      return;
    }

    setMfaCookie(response, state);
    renderTotpChallenge(response, { username: user.username, next, error });
    return;
  }

  if (state.setupSecret) {
    const account = await setAccountTotpSecret(databasePool, user.username, state.setupSecret);
    if (!account) {
      clearMfaCookie(response);
      renderLogin(response, {
        username: user.username,
        next,
        error: "Authenticator setup could not be saved. Sign in again.",
      });
      return;
    }
  }

  loginAttempts.delete(key);
  await recordLogin(request, { username: user.username, accountId: user.id, success: true });
  clearMfaCookie(response);
  setSessionCookie(response, {
    username: user.username,
    name: user.name || user.username,
    apps: user.apps || [],
  });
  redirect(response, next || "/");
}

async function handleLauncher(request, response) {
  const session = await readSession(request);
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
            <a href="/account/password">Password</a>
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
          <p class="login-copy">Use this workspace for internal tools like content planning, client operations, and financial review. Password and authenticator verification are required.</p>
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
          <p class="form-footnote"><a href="/reset-password">Set or reset password</a></p>
        </section>
      </main>`,
    })
  );
}

async function renderTotpSetup(response, { username = "", next = "/", secret = "", error = "" } = {}) {
  const message = error ? `<p class="form-message error">${escapeHtml(error)}</p>` : "";
  const setupUrl = otpauthUrl({ username, secret });
  const qrCode = await QRCode.toDataURL(setupUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });

  send(
    response,
    200,
    pageShell({
      title: "Set Up Authenticator",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Set up 2FA</h1>
          <p class="login-copy">Add this account to Google Authenticator, Microsoft Authenticator, 1Password, or another authenticator app, then enter the 6-digit code.</p>
          ${message}
          <div class="security-panel">
            <img class="qr-code" src="${escapeHtml(qrCode)}" alt="Authenticator QR code" />
            <span class="security-label">Manual setup key</span>
            <code class="secret-code">${escapeHtml(formatTotpSecret(secret))}</code>
            <a class="setup-link" href="${escapeHtml(setupUrl)}">Open authenticator setup link</a>
          </div>
          <form method="post" action="/login">
            <input type="hidden" name="mfaStage" value="setup" />
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <label>
              6-digit code
              <input name="totpCode" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,}" autofocus />
            </label>
            <button type="submit">Finish setup</button>
          </form>
          <p class="form-footnote"><a href="/logout">Cancel and sign out</a></p>
        </section>
      </main>`,
    })
  );
}

function renderTotpChallenge(response, { username = "", next = "/", error = "" } = {}) {
  const message = error ? `<p class="form-message error">${escapeHtml(error)}</p>` : "";

  send(
    response,
    200,
    pageShell({
      title: "Authenticator Code",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Enter 2FA code</h1>
          <p class="login-copy">${escapeHtml(username)} needs a 6-digit code from your authenticator app.</p>
          ${message}
          <form method="post" action="/login">
            <input type="hidden" name="mfaStage" value="verify" />
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <label>
              6-digit code
              <input name="totpCode" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,}" autofocus />
            </label>
            <button type="submit">Verify and continue</button>
          </form>
          <p class="form-footnote"><a href="/logout">Cancel and sign out</a></p>
        </section>
      </main>`,
    })
  );
}

async function handleResetPasswordGet(response, url) {
  const token = String(url.searchParams.get("token") || "");
  if (!databasePool) {
    renderResetPassword(response, {
      error: "Password reset links are not available in file-backed auth mode.",
    });
    return;
  }

  if (!token) {
    renderResetPassword(response, {
      notice: url.searchParams.get("sent")
        ? "If that account exists, a reset link has been emailed."
        : "",
    });
    return;
  }

  const reset = await findPasswordResetToken(databasePool, token);
  if (!reset) {
    renderResetPassword(response, {
      error: "This reset link is invalid, expired, or already used.",
    });
    return;
  }

  renderResetPassword(response, {
    token,
    username: reset.username,
  });
}

async function handleResetPasswordPost(request, response, body) {
  if (!databasePool) throw new Error("Password reset links are not available in file-backed auth mode.");

  const params = new URLSearchParams(body);
  const token = String(params.get("token") || "");
  const username = normalizeUsername(params.get("username"));
  if (!token) {
    await handleResetRequest(request, response, username);
    return;
  }

  const password = String(params.get("password") || "");
  const confirmPassword = String(params.get("confirmPassword") || "");

  try {
    validateNewPassword(password, confirmPassword);
  } catch (error) {
    renderResetPassword(response, {
      token,
      error: error.message,
    });
    return;
  }

  const account = await consumePasswordResetToken(databasePool, token, hashPassword(password));
  if (!account) {
    renderResetPassword(response, {
      error: "This reset link is invalid, expired, or already used.",
    });
    return;
  }

  renderResetPassword(response, {
    done: true,
    username: account.username,
    notice: "Password saved. You can sign in now.",
  });
}

async function handleResetRequest(request, response, username) {
  const key = `reset:${clientIp(request)}:${username || "unknown"}`;
  const attempt = checkLoginRate(key);
  if (!attempt.allowed) {
    renderResetPassword(response, {
      requestUsername: username,
      error: `Too many reset requests. Try again in ${Math.ceil(attempt.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  if (!username || !username.includes("@")) {
    renderResetPassword(response, {
      requestUsername: username,
      error: "Enter the email address for your app account.",
    });
    return;
  }

  if (!mailer && process.env.APPS_AUTH_EMAIL_DRY_RUN !== "1") {
    renderResetPassword(response, {
      requestUsername: username,
      error: "Password reset email is not configured.",
    });
    return;
  }

  const user = await findConfiguredUser(username);
  if (user) {
    const reset = await createPasswordResetToken(databasePool, user.username, {
      expiresHours: numberFromEnv("APPS_AUTH_RESET_TOKEN_HOURS", 24, 1, 168),
    });
    const link = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(reset.token)}`;
    await sendPasswordResetEmail({
      to: user.username,
      name: user.name || user.username,
      link,
      expiresHours: reset.expiresHours,
    });
  }

  renderResetPassword(response, {
    notice: "If that account exists, a reset link has been emailed.",
  });
}

function renderResetPassword(
  response,
  { token = "", username = "", requestUsername = "", error = "", notice = "", done = false } = {}
) {
  const message = error
    ? `<p class="form-message error">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="form-message">${escapeHtml(notice)}</p>`
      : "";

  const body = done
    ? `<main class="login-shell">
        <section class="login-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Password saved</h1>
          ${message}
          <p class="login-copy">${escapeHtml(username)} is ready to use.</p>
          <p class="form-footnote"><a href="/login">Return to sign in</a></p>
        </section>
      </main>`
    : `<main class="login-shell">
        <section class="login-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Set password</h1>
          <p class="login-copy">${username ? `Choose a password for ${escapeHtml(username)}.` : "Enter your app account email. Existing accounts will receive a reset link."}</p>
          ${message}
          ${token ? `<form method="post" action="/reset-password">
            <input type="hidden" name="token" value="${escapeHtml(token)}" />
            <label>
              New password
              <input name="password" type="password" autocomplete="new-password" autofocus />
            </label>
            <label>
              Confirm password
              <input name="confirmPassword" type="password" autocomplete="new-password" />
            </label>
            <button type="submit">Save password</button>
          </form>` : `<form method="post" action="/reset-password">
            <label>
              Account email
              <input name="username" type="email" autocomplete="email" value="${escapeHtml(requestUsername)}" autofocus />
            </label>
            <button type="submit">Email reset link</button>
          </form>`}
          <p class="form-footnote"><a href="/login">Return to sign in</a></p>
        </section>
      </main>`;

  send(response, 200, pageShell({ title: "Set Password", body }));
}

async function handleChangePasswordGet(request, response) {
  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  renderChangePassword(response, { username: session.username });
}

async function handleChangePasswordPost(request, response, body) {
  if (!databasePool) throw new Error("Password changes are not available in file-backed auth mode.");

  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  const params = new URLSearchParams(body);
  const currentPassword = String(params.get("currentPassword") || "");
  const password = String(params.get("password") || "");
  const confirmPassword = String(params.get("confirmPassword") || "");
  const user = await findConfiguredUser(session.username);

  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    renderChangePassword(response, {
      username: session.username,
      error: "The current password was not recognized.",
    });
    return;
  }

  try {
    validateNewPassword(password, confirmPassword);
  } catch (error) {
    renderChangePassword(response, {
      username: session.username,
      error: error.message,
    });
    return;
  }

  await updateAccountPassword(databasePool, session.username, hashPassword(password));
  renderChangePassword(response, {
    username: session.username,
    notice: "Password updated.",
  });
}

function renderChangePassword(response, { username = "", error = "", notice = "" } = {}) {
  const message = error
    ? `<p class="form-message error">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="form-message">${escapeHtml(notice)}</p>`
      : "";

  send(
    response,
    200,
    pageShell({
      title: "Change Password",
      body: `<main class="login-shell">
        <section class="login-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Change password</h1>
          <p class="login-copy">${escapeHtml(username)}</p>
          ${message}
          <form method="post" action="/account/password">
            <label>
              Current password
              <input name="currentPassword" type="password" autocomplete="current-password" autofocus />
            </label>
            <label>
              New password
              <input name="password" type="password" autocomplete="new-password" />
            </label>
            <label>
              Confirm password
              <input name="confirmPassword" type="password" autocomplete="new-password" />
            </label>
            <button type="submit">Update password</button>
          </form>
          <p class="form-footnote"><a href="/">Return to apps</a></p>
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
      .form-footnote {
        margin: 16px 0 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .form-footnote a {
        color: var(--accent);
        font-weight: 800;
        text-decoration: none;
      }
      .security-card {
        width: min(100%, 480px);
      }
      .security-panel {
        display: grid;
        gap: 10px;
        margin: 0 0 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
        background: #f9f6ef;
      }
      .qr-code {
        width: 180px;
        height: 180px;
        justify-self: center;
        border-radius: 8px;
        border: 1px solid var(--line);
        background: white;
      }
      .security-label {
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 850;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .secret-code {
        display: block;
        overflow-wrap: anywhere;
        border-radius: 6px;
        padding: 12px;
        background: white;
        color: var(--ink);
        font: 800 1rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        letter-spacing: 0.04em;
      }
      .setup-link {
        width: fit-content;
        color: var(--accent);
        font-weight: 800;
        text-decoration: none;
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

async function readSession(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const raw = cookies[cookieName];
  if (!raw) return null;

  const [payloadText, signature] = raw.split(".");
  if (!payloadText || !signature) return null;
  if (!timingSafeEqual(signature, sign(payloadText))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    const user = await findConfiguredUser(payload.username);
    if (!user) return null;
    return {
      ...payload,
      username: user.username,
      name: user.name || payload.name || user.username,
      apps: user.apps || [],
    };
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
  appendSetCookie(response, cookie);
}

function clearSessionCookie(response) {
  appendSetCookie(response, `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function readMfaState(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const raw = cookies[mfaCookieName];
  if (!raw) return null;

  const [payloadText, signature] = raw.split(".");
  if (!payloadText || !signature) return null;
  if (!timingSafeEqual(signature, sign(payloadText))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return {
      username: normalizeUsername(payload.username),
      next: safeNextPath(payload.next),
      setupSecret: String(payload.setupSecret || "").trim(),
    };
  } catch {
    return null;
  }
}

function setMfaCookie(response, state) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      username: normalizeUsername(state.username),
      next: safeNextPath(state.next),
      setupSecret: state.setupSecret ? String(state.setupSecret).trim() : "",
      iat: now,
      exp: now + mfaSeconds,
      nonce: crypto.randomBytes(12).toString("base64url"),
    })
  ).toString("base64url");
  const cookie = `${mfaCookieName}=${payload}.${sign(payload)}; Path=/; Max-Age=${mfaSeconds}; HttpOnly; Secure; SameSite=Lax`;
  appendSetCookie(response, cookie);
}

function clearMfaCookie(response) {
  appendSetCookie(response, `${mfaCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function appendSetCookie(response, cookie) {
  const existing = response.getHeader("Set-Cookie");
  if (!existing) {
    response.setHeader("Set-Cookie", cookie);
    return;
  }

  response.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

function sign(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUrl({ username, secret }) {
  const issuer = process.env.APPS_AUTH_TOTP_ISSUER || "Jenny Apps";
  const label = `${issuer}:${username}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function verifyTotpCode(secret, input, window = 1) {
  const code = normalizeTotpCode(input);
  if (!/^\d{6}$/.test(code)) return false;

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    if (timingSafeEqual(totpCode(secret, currentStep + offset), code)) return true;
  }
  return false;
}

function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 1_000_000).padStart(6, "0");
}

function normalizeTotpCode(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function formatTotpSecret(secret) {
  return String(secret || "")
    .replace(/\s+/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

async function findConfiguredUser(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return null;
  if (databasePool) return findAccountByUsername(databasePool, normalizedUsername);
  return fileUsers.find((user) => user.username === normalizedUsername) || null;
}

async function recordLogin(request, options) {
  if (!databasePool) return;

  try {
    await recordLoginEvent(databasePool, {
      ...options,
      clientIp: clientIp(request),
      userAgent: String(request.headers["user-agent"] || ""),
    });
  } catch (error) {
    console.warn(`Could not record apps login event: ${error.message}`);
  }
}

async function sendPasswordResetEmail({ to, name, link, expiresHours }) {
  if (process.env.APPS_AUTH_EMAIL_DRY_RUN === "1") {
    console.log(`Password reset link for ${to}: ${link}`);
    return;
  }

  if (!mailer) {
    throw new Error("Password reset email is not configured.");
  }

  const from = process.env.APPS_AUTH_EMAIL_FROM || process.env.NOTIFY_FROM || process.env.SMTP_USER;
  const replyTo = process.env.APPS_AUTH_EMAIL_REPLY_TO || process.env.NOTIFY_REPLY_TO || from;
  const subject = "Jenny Apps password reset";
  const safeName = name || to;

  await mailer.sendMail({
    from,
    to,
    replyTo,
    subject,
    text: [
      `Hi ${safeName},`,
      "",
      "Use this link to set or reset your Jenny Apps password:",
      link,
      "",
      `This link expires in ${expiresHours} hours and can be used once.`,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(safeName)},</p>
      <p>Use this link to set or reset your Jenny Apps password:</p>
      <p><a href="${escapeHtml(link)}">Set password</a></p>
      <p>This link expires in ${escapeHtml(expiresHours)} hours and can be used once.</p>
      <p>If you did not request this, you can ignore this email.</p>`,
  });
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

function createMailerFromEnv() {
  const hostValue = process.env.APPS_AUTH_SMTP_HOST || process.env.SMTP_HOST || "";
  const user = process.env.APPS_AUTH_SMTP_USER || process.env.SMTP_USER || "";
  const pass = process.env.APPS_AUTH_SMTP_PASS || process.env.SMTP_PASS || "";
  if (!hostValue || !user || !pass) return null;

  const portValue = Number.parseInt(process.env.APPS_AUTH_SMTP_PORT || process.env.SMTP_PORT || "465", 10);
  const secureValue = process.env.APPS_AUTH_SMTP_SECURE || process.env.SMTP_SECURE || "true";

  return nodemailer.createTransport({
    host: hostValue,
    port: Number.isFinite(portValue) ? portValue : 465,
    secure: secureValue !== "false",
    auth: {
      user,
      pass,
    },
  });
}

function publicBaseUrl() {
  return String(process.env.APPS_AUTH_PUBLIC_URL || "https://apps.junresidential.com").replace(/\/+$/, "");
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

function validateNewPassword(password, confirmPassword) {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }

  if (password !== confirmPassword) {
    throw new Error("Password confirmation does not match.");
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
