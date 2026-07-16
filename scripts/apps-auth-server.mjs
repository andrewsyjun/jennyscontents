import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  createPasswordResetToken,
  createAccountPasskey,
  consumePasswordResetToken,
  countAccounts,
  createPoolFromEnv,
  deleteAccountPasskey,
  ensureAppsAuthSchema,
  findAccountPasskeyByCredentialId,
  findAccountByUsername,
  findPasswordResetToken,
  hashPassword,
  listAccountPasskeys,
  loadEnv,
  normalizeUsername,
  recordLoginEvent,
  setAccountTotpSecret,
  timingSafeEqual,
  updateAccountPasskeyCounter,
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
const passkeyCookieName = `${cookieName}_passkey`;
const sessionSeconds = numberFromEnv("APPS_AUTH_SESSION_SECONDS", 12 * 60 * 60, 900, 30 * 24 * 60 * 60);
const mfaSeconds = numberFromEnv("APPS_AUTH_MFA_SECONDS", 10 * 60, 60, 60 * 60);
const passkeyChallengeSeconds = numberFromEnv("APPS_AUTH_PASSKEY_SECONDS", 5 * 60, 60, 60 * 60);
const requireTotp = process.env.APPS_AUTH_REQUIRE_TOTP !== "0";
const passkeysEnabled = process.env.APPS_AUTH_PASSKEYS_ENABLED !== "0";
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

    if (request.method === "GET" && ["/favicon.ico", "/favicon.png", "/apple-touch-icon.png"].includes(url.pathname)) {
      sendStaticIcon(response, url.pathname);
      return;
    }

    if (request.method === "HEAD" && url.pathname === "/health") {
      send(response, 200, "", "application/json; charset=utf-8", { "Cache-Control": "no-store" });
      return;
    }

    if (request.method === "HEAD" && ["/", "/login", "/logout", "/reset-password"].includes(url.pathname)) {
      send(response, 200, "", "text/html; charset=utf-8", { "Cache-Control": "no-store" });
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

    if (request.method === "GET" && url.pathname === "/login/complete") {
      await handleLoginComplete(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/login/passkey/options") {
      await handleLoginPasskeyOptions(request, response, await readJsonBody(request));
      return;
    }

    if (request.method === "POST" && url.pathname === "/login/passkey/verify") {
      await handleLoginPasskeyVerify(request, response, await readJsonBody(request));
      return;
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const jsonRequest = isJsonRequest(request);
      try {
        const body = await readBody(request);
        if (jsonRequest) {
          const payload = parseJsonPayload(body);
          if (payload.action === "passkey-login-options") {
            await handleLoginPasskeyOptions(request, response, payload);
            return;
          }
          if (payload.action === "passkey-login-verify") {
            await handleLoginPasskeyVerify(request, response, payload);
            return;
          }
          sendJson(response, 400, { ok: false, error: "Unsupported login action." });
          return;
        }

        await handleLoginPost(request, response, body);
      } catch (error) {
        if (jsonRequest) {
          sendJson(response, 400, { ok: false, error: error.message || "Passkey request failed." });
          return;
        }
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
      await handleChangePasswordGet(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/account/password") {
      const jsonRequest = isJsonRequest(request);
      try {
        const body = await readBody(request);
        if (jsonRequest) {
          const payload = parseJsonPayload(body);
          if (payload.action === "passkey-register-options") {
            await handlePasskeyRegistrationOptions(request, response);
            return;
          }
          if (payload.action === "passkey-register-verify") {
            await handlePasskeyRegistrationVerify(request, response, payload);
            return;
          }
          sendJson(response, 400, { ok: false, error: "Unsupported account security action." });
          return;
        }

        const params = new URLSearchParams(body);
        if (params.get("passkeyAction") === "delete") {
          await handleDeletePasskey(request, response, body);
          return;
        }

        await handleChangePasswordPost(request, response, body);
      } catch (error) {
        if (jsonRequest) {
          sendJson(response, 400, { ok: false, error: error.message || "Account security request failed." });
          return;
        }
        renderChangePassword(response, { error: error.message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/account/security") {
      await handleAccountSecurityGet(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/account/passkeys/register/options") {
      await handlePasskeyRegistrationOptions(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/account/passkeys/register/verify") {
      await handlePasskeyRegistrationVerify(request, response, await readJsonBody(request));
      return;
    }

    if (request.method === "POST" && url.pathname === "/account/passkeys/delete") {
      await handleDeletePasskey(request, response, await readBody(request));
      return;
    }

    if (request.method === "GET" && url.pathname === "/logout") {
      clearSessionCookie(response);
      clearMfaCookie(response);
      clearPasskeyCookie(response);
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

  const loginStage = String(params.get("loginStage") || "identify");
  if (loginStage !== "password") {
    await handleLoginIdentifyPost(request, response, params);
    return;
  }

  const username = normalizeUsername(params.get("username"));
  const password = params.get("password") || "";
  const next = safeNextPath(params.get("next"));
  const key = `${clientIp(request)}:${username || "unknown"}`;
  const attempt = checkLoginRate(key);

  if (!attempt.allowed) {
    renderPasswordLogin(response, {
      username,
      next,
      error: `Too many attempts. Try again in ${Math.ceil(attempt.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  const user = await findConfiguredUser(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await recordLogin(request, { username, success: false });
    renderPasswordLogin(response, {
      username,
      next,
      error: "The username or password was not recognized.",
    });
    return;
  }

  loginAttempts.delete(key);

  if (requireTotp) {
    if (!databasePool) {
      renderPasswordLogin(response, {
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
  renderLoginComplete(response, { next });
}

async function handleLoginIdentifyPost(request, response, params) {
  const username = normalizeUsername(params.get("username"));
  const next = safeNextPath(params.get("next"));
  if (!username) {
    renderLogin(response, {
      next,
      error: "Enter the account email first.",
    });
    return;
  }

  const key = `identify:${clientIp(request)}:${username}`;
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
  const passkeys = user && databasePool && passkeysEnabled
    ? await listAccountPasskeys(databasePool, user.username)
    : [];

  if (user && passkeys.length > 0) {
    loginAttempts.delete(key);
    renderPasskeyChoice(response, {
      username: user.username,
      next,
    });
    return;
  }

  renderPasswordLogin(response, {
    username,
    next,
    notice: "Enter the password, then verify with the authenticator code.",
  });
}

async function handleMfaPost(request, response, params, mfaStage) {
  if (!databasePool) throw new Error("Authenticator app setup requires database-backed app accounts.");

  const state = readMfaState(request);
  const next = safeNextPath(params.get("next") || state?.next);
  const code = normalizeTotpCode(params.get("totpCode"));
  const username = normalizeUsername(state?.username);

  if (!state || !username) {
    const session = await readSession(request);
    if (session) {
      clearMfaCookie(response);
      renderLoginComplete(response, { next });
      return;
    }

    clearMfaCookie(response);
    renderLogin(response, {
      next,
      error: "Your verification window expired. Sign in again.",
    });
    return;
  }

  const key = `mfa:${clientIp(request)}:${username}`;
  const attempt = checkLoginRate(key);
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
  renderLoginComplete(response, { next });
}

async function handleLoginComplete(request, response, url) {
  const next = safeNextPath(url.searchParams.get("next"));
  if (!(await readSession(request))) {
    redirect(response, `/login?next=${encodeURIComponent(next || "/")}`);
    return;
  }

  renderLoginComplete(response, { next });
}

async function handleLoginPasskeyOptions(request, response, payload) {
  ensurePasskeyMode();

  const mfaState = readMfaState(request);
  const username = normalizeUsername(payload.username || mfaState?.username);
  const next = safeNextPath(payload.next || mfaState?.next);
  const key = `passkey-options:${clientIp(request)}:${username || "unknown"}`;
  const attempt = checkLoginRate(key);
  if (!attempt.allowed) {
    sendJson(response, 429, {
      ok: false,
      error: `Too many passkey attempts. Try again in ${Math.ceil(attempt.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  const user = await findConfiguredUser(username);
  const passkeys = user ? await listAccountPasskeys(databasePool, user.username) : [];
  if (!user || passkeys.length === 0) {
    sendJson(response, 404, {
      ok: false,
      error: "No passkey is registered for that account yet. Sign in with password and authenticator first, then open Account security to add a passkey.",
    });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId(),
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    userVerification: "required",
    timeout: 90_000,
  });

  setPasskeyCookie(response, {
    stage: "login",
    username: user.username,
    next,
    challenge: options.challenge,
  });
  sendJson(response, 200, { ok: true, options });
}

async function handleLoginPasskeyVerify(request, response, payload) {
  ensurePasskeyMode();

  const state = readPasskeyState(request);
  if (!state || state.stage !== "login" || !state.username || !state.challenge) {
    sendJson(response, 400, {
      ok: false,
      error: "Your passkey verification window expired. Sign in again.",
    });
    return;
  }

  const user = await findConfiguredUser(state.username);
  const credentialId = String(payload?.response?.id || payload?.response?.rawId || "");
  const passkey = user
    ? await findAccountPasskeyByCredentialId(databasePool, user.username, credentialId)
    : null;
  if (!user || !passkey) {
    await recordLogin(request, { username: state.username, success: false });
    clearPasskeyCookie(response);
    sendJson(response, 400, {
      ok: false,
      error: "That passkey is not registered for this account.",
    });
    return;
  }

  const verification = await verifyAuthenticationResponse({
    response: payload.response,
    expectedChallenge: state.challenge,
    expectedOrigin: passkeyOrigin(),
    expectedRPID: passkeyRpId(),
    requireUserVerification: true,
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.credentialPublicKey),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });

  if (!verification.verified) {
    await recordLogin(request, { username: user.username, accountId: user.id, success: false });
    sendJson(response, 400, {
      ok: false,
      error: "That passkey could not be verified.",
    });
    return;
  }

  await updateAccountPasskeyCounter(databasePool, passkey.credentialId, verification.authenticationInfo.newCounter, {
    deviceType: verification.authenticationInfo.credentialDeviceType,
    backedUp: verification.authenticationInfo.credentialBackedUp,
  });
  loginAttempts.delete(`passkey-options:${clientIp(request)}:${user.username}`);
  await recordLogin(request, { username: user.username, accountId: user.id, success: true });
  clearPasskeyCookie(response);
  clearMfaCookie(response);
  setSessionCookie(response, {
    username: user.username,
    name: user.name || user.username,
    apps: user.apps || [],
  });
  sendJson(response, 200, { ok: true, redirectTo: safeNextPath(state.next) });
}

async function handleAccountSecurityGet(request, response, url) {
  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  const query = url.search || "";
  redirect(response, `/account/password${query}`);
}

async function handlePasskeyRegistrationOptions(request, response) {
  ensurePasskeyMode();

  const session = await readSession(request);
  if (!session) {
    sendJson(response, 401, { ok: false, error: "Sign in before adding a passkey." });
    return;
  }

  const user = await findConfiguredUser(session.username);
  const passkeys = user ? await listAccountPasskeys(databasePool, user.username) : [];
  if (!user) {
    sendJson(response, 401, { ok: false, error: "Account could not be verified." });
    return;
  }

  const options = await generateRegistrationOptions({
    rpName: passkeyRpName(),
    rpID: passkeyRpId(),
    userID: passkeyUserId(user),
    userName: user.username,
    userDisplayName: user.name || user.username,
    attestationType: "none",
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    timeout: 90_000,
  });

  setPasskeyCookie(response, {
    stage: "register",
    username: user.username,
    challenge: options.challenge,
  });
  sendJson(response, 200, { ok: true, options });
}

async function handlePasskeyRegistrationVerify(request, response, payload) {
  ensurePasskeyMode();

  const session = await readSession(request);
  const state = readPasskeyState(request);
  if (!session || !state || state.stage !== "register" || state.username !== session.username || !state.challenge) {
    clearPasskeyCookie(response);
    sendJson(response, 400, {
      ok: false,
      error: "Your passkey setup window expired. Try again.",
    });
    return;
  }

  const verification = await verifyRegistrationResponse({
    response: payload.response,
    expectedChallenge: state.challenge,
    expectedOrigin: passkeyOrigin(),
    expectedRPID: passkeyRpId(),
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    sendJson(response, 400, {
      ok: false,
      error: "That passkey could not be verified.",
    });
    return;
  }

  const info = verification.registrationInfo;
  await createAccountPasskey(databasePool, session.username, {
    credentialId: info.credential.id,
    credentialPublicKey: Buffer.from(info.credential.publicKey),
    counter: info.credential.counter,
    transports: payload.response?.response?.transports || info.credential.transports || [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    nickname: payload.nickname || passkeyDefaultNickname(info.credentialDeviceType),
  });

  clearPasskeyCookie(response);
  sendJson(response, 200, { ok: true, redirectTo: "/account/password?passkeyAdded=1" });
}

async function handleDeletePasskey(request, response, body) {
  ensurePasskeyMode();

  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  const params = new URLSearchParams(body);
  await deleteAccountPasskey(databasePool, session.username, params.get("credentialId"));
  redirect(response, "/account/password");
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
            <a href="/account/password">Account security</a>
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
          <p class="login-copy">Enter the account email first. If a passkey is registered, Jenny can use it next; otherwise the app will ask for password and authenticator code.</p>
          ${message}
          <form method="post" action="/login">
            <input type="hidden" name="loginStage" value="identify" />
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <label>
              Account email
              <input name="username" autocomplete="username webauthn" value="${escapeHtml(username)}" autofocus />
            </label>
            <button type="submit">Continue</button>
          </form>
          <p class="form-footnote"><a href="/reset-password">Set or reset password</a></p>
        </section>
      </main>`,
    })
  );
}

function renderPasswordLogin(response, { username = "", next = "/", error = "", notice = "" } = {}) {
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
          <h1>Enter password</h1>
          <p class="login-copy">${escapeHtml(username)}</p>
          ${message}
          <form method="post" action="/login">
            <input type="hidden" name="loginStage" value="password" />
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <input type="hidden" name="username" value="${escapeHtml(username)}" />
            <label>
              Password
              <input name="password" type="password" autocomplete="current-password" autofocus />
            </label>
            <button type="submit">Continue</button>
          </form>
          <p class="form-footnote"><a href="/login?next=${encodeURIComponent(safeNextPath(next))}">Use a different account</a> · <a href="/reset-password">Set or reset password</a></p>
        </section>
      </main>`,
    })
  );
}

function renderPasskeyChoice(response, { username = "", next = "/", error = "" } = {}) {
  const message = error ? `<p class="form-message error">${escapeHtml(error)}</p>` : "";

  send(
    response,
    200,
    pageShell({
      title: "Use Passkey",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Use your passkey</h1>
          <p class="login-copy">${escapeHtml(username)} has a passkey registered. Use it now, or use password and authenticator code instead.</p>
          ${message}
          <form data-passkey-login-form>
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <input type="hidden" name="passkeyUsername" value="${escapeHtml(username)}" />
            <button type="submit" data-autostart-passkey>Sign in with passkey</button>
          </form>
          <details class="fallback-panel">
            <summary>Use password instead</summary>
            <form method="post" action="/login">
              <input type="hidden" name="loginStage" value="password" />
              <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
              <input type="hidden" name="username" value="${escapeHtml(username)}" />
              <label>
                Password
                <input name="password" type="password" autocomplete="current-password" />
              </label>
              <button type="submit" class="secondary-button">Continue with password</button>
            </form>
          </details>
          <p class="form-footnote"><a href="/login?next=${encodeURIComponent(safeNextPath(next))}">Use a different account</a></p>
        </section>
      </main>${passkeyBrowserScript({ autostart: true })}`,
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

function renderPasskeyChallenge(response, { username = "", next = "/", error = "", totpEnabled = false } = {}) {
  const message = error ? `<p class="form-message error">${escapeHtml(error)}</p>` : "";

  send(
    response,
    200,
    pageShell({
      title: "Verify Passkey",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Use your passkey</h1>
          <p class="login-copy">${escapeHtml(username)} can sign in with Face ID, Touch ID, Windows Hello, or a saved security key.</p>
          ${message}
          <form data-passkey-login-form>
            <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
            <input type="hidden" name="passkeyUsername" value="${escapeHtml(username)}" />
            <button type="submit" data-autostart-passkey>Verify with passkey</button>
          </form>
          ${totpEnabled ? `<details class="fallback-panel">
            <summary>Use authenticator code instead</summary>
            <form method="post" action="/login">
              <input type="hidden" name="mfaStage" value="verify" />
              <input type="hidden" name="next" value="${escapeHtml(safeNextPath(next))}" />
              <label>
                6-digit code
                <input name="totpCode" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,}" />
              </label>
              <button type="submit" class="secondary-button">Verify code</button>
            </form>
          </details>` : ""}
          <p class="form-footnote"><a href="/logout">Cancel and sign out</a></p>
        </section>
      </main>${passkeyBrowserScript({ autostart: true })}`,
    })
  );
}

function renderLoginComplete(response, { next = "/" } = {}) {
  const safeNext = safeNextPath(next);

  send(
    response,
    200,
    pageShell({
      title: "Opening Jenny Apps",
      body: `<main class="login-shell">
        <section class="login-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Opening app</h1>
          <p class="login-copy">Signed in. Opening your app now.</p>
          <p class="form-footnote"><a data-login-complete-link href="${escapeHtml(safeNext)}">Continue</a></p>
        </section>
        <script>
          const continueLink = document.querySelector("[data-login-complete-link]");
          if (continueLink) window.location.replace(continueLink.href);
        </script>
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

async function handleChangePasswordGet(request, response, url) {
  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  const passkeys = databasePool && passkeysEnabled
    ? await listAccountPasskeys(databasePool, session.username)
    : [];
  renderChangePassword(response, {
    username: session.username,
    passkeys,
    notice: url.searchParams.get("passkeyAdded") ? "Passkey added." : "",
    error: url.searchParams.get("passkeyError") ? "Passkey could not be updated." : "",
  });
}

async function handleChangePasswordPost(request, response, body) {
  if (!databasePool) throw new Error("Password changes are not available in file-backed auth mode.");

  const session = await readSession(request);
  if (!session) {
    redirect(response, "/login?next=/account/password");
    return;
  }

  const passkeys = databasePool && passkeysEnabled
    ? await listAccountPasskeys(databasePool, session.username)
    : [];
  const params = new URLSearchParams(body);
  const currentPassword = String(params.get("currentPassword") || "");
  const password = String(params.get("password") || "");
  const confirmPassword = String(params.get("confirmPassword") || "");
  const user = await findConfiguredUser(session.username);

  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    renderChangePassword(response, {
      username: session.username,
      passkeys,
      error: "The current password was not recognized.",
    });
    return;
  }

  try {
    validateNewPassword(password, confirmPassword);
  } catch (error) {
    renderChangePassword(response, {
      username: session.username,
      passkeys,
      error: error.message,
    });
    return;
  }

  await updateAccountPassword(databasePool, session.username, hashPassword(password));
  renderChangePassword(response, {
    username: session.username,
    passkeys,
    notice: "Password updated.",
  });
}

function renderChangePassword(response, { username = "", passkeys = [], error = "", notice = "" } = {}) {
  const message = error
    ? `<p class="form-message error">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="form-message">${escapeHtml(notice)}</p>`
      : "";
  const passkeyRows = passkeys.map((passkey) => `<li class="passkey-row">
    <div>
      <strong>${escapeHtml(passkey.nickname || "Passkey")}</strong>
      <span>${escapeHtml(passkeySummary(passkey))}</span>
    </div>
    <form method="post" action="/account/password">
      <input type="hidden" name="passkeyAction" value="delete" />
      <input type="hidden" name="credentialId" value="${escapeHtml(passkey.credentialId)}" />
      <button type="submit" class="danger-button">Remove</button>
    </form>
  </li>`).join("");
  const passkeySection = passkeysEnabled
    ? `<div class="form-divider"></div>
      <section class="security-list">
        <h2>Passkeys</h2>
        <p class="login-copy">You can register more than one passkey, but each one should be a different device or provider. A synced iCloud, Google, or 1Password passkey usually only needs to be added once.</p>
        <button type="button" data-passkey-register>${passkeyRows ? "Add another passkey" : "Add passkey"}</button>
        ${passkeyRows ? `<ul>${passkeyRows}</ul>` : `<p class="empty-note">No passkeys are registered yet.</p>`}
      </section>`
    : "";

  send(
    response,
    200,
    pageShell({
      title: "Account Security",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Account security</h1>
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
          ${passkeySection}
          <p class="form-footnote"><a href="/">Return to apps</a></p>
        </section>
      </main>${passkeysEnabled ? passkeyBrowserScript() : ""}`,
    })
  );
}

function renderAccountSecurity(response, { username = "", passkeys = [], error = "", notice = "" } = {}) {
  const message = error
    ? `<p class="form-message error">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="form-message">${escapeHtml(notice)}</p>`
      : "";
  const rows = passkeys.map((passkey) => `<li class="passkey-row">
    <div>
      <strong>${escapeHtml(passkey.nickname || "Passkey")}</strong>
      <span>${escapeHtml(passkeySummary(passkey))}</span>
    </div>
    <form method="post" action="/account/password">
      <input type="hidden" name="passkeyAction" value="delete" />
      <input type="hidden" name="credentialId" value="${escapeHtml(passkey.credentialId)}" />
      <button type="submit" class="danger-button">Remove</button>
    </form>
  </li>`).join("");

  send(
    response,
    200,
    pageShell({
      title: "Account Security",
      body: `<main class="login-shell">
        <section class="login-card security-card">
          <p class="eyebrow">Jenny Apps</p>
          <h1>Account security</h1>
          <p class="login-copy">${escapeHtml(username)} can use passkeys for faster sign-in. Keep at least two passkeys before turning off authenticator fallback.</p>
          ${message}
          <button type="button" data-passkey-register>Add passkey</button>
          <section class="security-list">
            <h2>Registered passkeys</h2>
            ${rows ? `<ul>${rows}</ul>` : `<p class="empty-note">No passkeys are registered yet.</p>`}
          </section>
          <p class="form-footnote"><a href="/account/password">Change password</a> · <a href="/">Return to apps</a></p>
        </section>
      </main>${passkeyBrowserScript()}`,
    })
  );
}

function passkeyBrowserScript({ autostart = false } = {}) {
  return `<script>
    (() => {
      function friendlyPasskeyError(error) {
        const message = typeof error === "string" ? error : (error && error.message) || "";
        const lower = message.toLowerCase();
        if (
          lower.includes("already registered") ||
          lower.includes("invalidstate") ||
          lower.includes("excludecredential") ||
          lower.includes("excluded credential")
        ) {
          return "That passkey or synced passkey provider is already registered for this account. Use a different device/provider, or remove the existing passkey first.";
        }
        if (lower.includes("notallowed") || lower.includes("timed out") || lower.includes("cancel")) {
          return "The passkey prompt was canceled or timed out.";
        }
        return message || "Passkey verification failed.";
      }

      function showPasskeyError(error) {
        let node = document.querySelector("[data-passkey-error]");
        if (!node) {
          node = document.createElement("p");
          node.className = "form-message error";
          node.setAttribute("data-passkey-error", "1");
          const card = document.querySelector(".login-card");
          const anchor = card && (card.querySelector("form") || card.querySelector("button"));
          if (card && anchor) card.insertBefore(node, anchor);
        }
        node.textContent = friendlyPasskeyError(error);
      }

      function base64urlToBuffer(value) {
        const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), "=");
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes.buffer;
      }

      function bufferToBase64url(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
      }

      function creationOptionsFromJson(options) {
        return {
          publicKey: {
            ...options,
            challenge: base64urlToBuffer(options.challenge),
            user: { ...options.user, id: base64urlToBuffer(options.user.id) },
            excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
              ...credential,
              id: base64urlToBuffer(credential.id),
            })),
          },
        };
      }

      function requestOptionsFromJson(options) {
        return {
          publicKey: {
            ...options,
            challenge: base64urlToBuffer(options.challenge),
            allowCredentials: (options.allowCredentials || []).map((credential) => ({
              ...credential,
              id: base64urlToBuffer(credential.id),
            })),
          },
        };
      }

      function registrationResponseToJson(credential) {
        return {
          id: credential.id,
          rawId: bufferToBase64url(credential.rawId),
          type: credential.type,
          authenticatorAttachment: credential.authenticatorAttachment,
          response: {
            clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
            attestationObject: bufferToBase64url(credential.response.attestationObject),
            transports: typeof credential.response.getTransports === "function" ? credential.response.getTransports() : [],
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        };
      }

      function authenticationResponseToJson(credential) {
        return {
          id: credential.id,
          rawId: bufferToBase64url(credential.rawId),
          type: credential.type,
          authenticatorAttachment: credential.authenticatorAttachment,
          response: {
            clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
            authenticatorData: bufferToBase64url(credential.response.authenticatorData),
            signature: bufferToBase64url(credential.response.signature),
            userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : undefined,
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        };
      }

      async function postJson(url, payload) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload || {}),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || "Passkey request failed.");
        return data;
      }

      async function registerPasskey(button) {
        if (!window.PublicKeyCredential || !navigator.credentials) {
          throw new Error("This browser does not support passkeys.");
        }
        button.disabled = true;
        button.textContent = "Opening passkey...";
        const start = await postJson("/account/password", {
          action: "passkey-register-options",
        });
        const credential = await navigator.credentials.create(creationOptionsFromJson(start.options));
        const done = await postJson("/account/password", {
          action: "passkey-register-verify",
          response: registrationResponseToJson(credential),
        });
        window.location.href = done.redirectTo || "/account/password";
      }

      async function loginWithPasskey(form) {
        if (!window.PublicKeyCredential || !navigator.credentials) {
          throw new Error("This browser does not support passkeys.");
        }
        const button = form.querySelector("button[type='submit']");
        if (button) {
          button.disabled = true;
          button.textContent = "Opening passkey...";
        }
        const usernameInput = form.querySelector("[name='passkeyUsername']");
        const nextInput = form.querySelector("[name='next']");
        const start = await postJson("/login", {
          action: "passkey-login-options",
          username: usernameInput ? usernameInput.value : "",
          next: nextInput ? nextInput.value : "/",
        });
        const credential = await navigator.credentials.get(requestOptionsFromJson(start.options));
        const done = await postJson("/login", {
          action: "passkey-login-verify",
          response: authenticationResponseToJson(credential),
        });
        window.location.href = done.redirectTo || "/";
      }

      document.querySelectorAll("[data-passkey-login-form]").forEach((form) => {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          loginWithPasskey(form).catch((error) => {
            showPasskeyError(error);
            const button = form.querySelector("button[type='submit']");
            if (button) {
              button.disabled = false;
              button.textContent = "Sign in with passkey";
            }
          });
        });
      });

      const registerButton = document.querySelector("[data-passkey-register]");
      if (registerButton) {
        registerButton.addEventListener("click", () => {
          registerPasskey(registerButton).catch((error) => {
            showPasskeyError(error);
            registerButton.disabled = false;
            registerButton.textContent = registerButton.dataset.originalLabel || "Add passkey";
          });
        });
        registerButton.dataset.originalLabel = registerButton.textContent || "Add passkey";
      }

      ${autostart ? `setTimeout(() => {
        const button = document.querySelector("[data-autostart-passkey]");
        if (button) button.click();
      }, 250);` : ""}
    })();
  </script>`;
}

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" href="/favicon.png" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }
      .secondary-button {
        border: 1px solid var(--line);
        background: white;
        color: var(--accent);
      }
      .secondary-button:hover { background: #f9f6ef; }
      .danger-button {
        border: 1px solid #d8aaa0;
        background: #fff4f1;
        color: #8b2f24;
      }
      .danger-button:hover { background: #ffe8e1; }
      .form-divider {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 10px;
        margin: 18px 0;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 850;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .form-divider::before,
      .form-divider::after {
        content: "";
        height: 1px;
        background: var(--line);
      }
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
      .fallback-panel,
      .security-list {
        margin-top: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
        background: #f9f6ef;
      }
      .fallback-panel summary {
        cursor: pointer;
        color: var(--accent);
        font-weight: 850;
      }
      .fallback-panel form { margin-top: 14px; }
      .security-list h2 {
        margin: 0 0 12px;
        font-size: 1rem;
      }
      .security-list ul {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .passkey-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        background: white;
      }
      .passkey-row div {
        display: grid;
        gap: 4px;
      }
      .passkey-row span,
      .empty-note {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .passkey-row form { display: block; }
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
  <body>${body}
    <script>
      document.addEventListener("submit", (event) => {
        const button = event.target.querySelector("button[type='submit']");
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = "Working...";
      });
    </script>
  </body>
</html>`;
}

async function readSession(request) {
  const payload = readSignedCookiePayload(request, cookieName);
  if (!payload) return null;

  const user = await findConfiguredUser(payload.username);
  if (!user) return null;
  return {
    ...payload,
    username: user.username,
    name: user.name || payload.name || user.username,
    apps: user.apps || [],
  };
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
  clearCookieVariants(response, cookieName);
}

function readMfaState(request) {
  const payload = readSignedCookiePayload(request, mfaCookieName);
  if (!payload) return null;

  return {
    username: normalizeUsername(payload.username),
    next: safeNextPath(payload.next),
    setupSecret: String(payload.setupSecret || "").trim(),
  };
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
  clearCookieVariants(response, mfaCookieName);
}

function readPasskeyState(request) {
  const payload = readSignedCookiePayload(request, passkeyCookieName);
  if (!payload) return null;

  return {
    stage: String(payload.stage || ""),
    username: normalizeUsername(payload.username),
    next: safeNextPath(payload.next),
    challenge: String(payload.challenge || "").trim(),
  };
}

function setPasskeyCookie(response, state) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      stage: String(state.stage || ""),
      username: normalizeUsername(state.username),
      next: safeNextPath(state.next),
      challenge: String(state.challenge || "").trim(),
      iat: now,
      exp: now + passkeyChallengeSeconds,
      nonce: crypto.randomBytes(12).toString("base64url"),
    })
  ).toString("base64url");
  const cookie = `${passkeyCookieName}=${payload}.${sign(payload)}; Path=/; Max-Age=${passkeyChallengeSeconds}; HttpOnly; Secure; SameSite=Lax`;
  appendSetCookie(response, cookie);
}

function clearPasskeyCookie(response) {
  clearCookieVariants(response, passkeyCookieName);
}

function readSignedCookiePayload(request, name) {
  const payloads = parseCookieValues(request.headers.cookie || "", name)
    .map(parseSignedCookiePayload)
    .filter(Boolean)
    .sort((first, second) => Number(second.iat || 0) - Number(first.iat || 0));

  return payloads[0] || null;
}

function parseSignedCookiePayload(raw) {
  const [payloadText, signature] = String(raw || "").split(".");
  if (!payloadText || !signature) return null;
  if (!timingSafeEqual(signature, sign(payloadText))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function clearCookieVariants(response, name) {
  const attributes = "Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
  appendSetCookie(response, `${name}=; ${attributes}`);
  appendSetCookie(response, `${name}=; Domain=apps.junresidential.com; ${attributes}`);
  appendSetCookie(response, `${name}=; Domain=.junresidential.com; ${attributes}`);
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

function passkeyOrigin() {
  return String(process.env.APPS_AUTH_PASSKEY_ORIGIN || publicBaseUrl()).replace(/\/+$/, "");
}

function passkeyRpId() {
  if (process.env.APPS_AUTH_PASSKEY_RP_ID) return process.env.APPS_AUTH_PASSKEY_RP_ID;
  try {
    return new URL(passkeyOrigin()).hostname;
  } catch {
    return "apps.junresidential.com";
  }
}

function passkeyRpName() {
  return process.env.APPS_AUTH_PASSKEY_RP_NAME || "Jenny Apps";
}

function ensurePasskeyMode() {
  if (!passkeysEnabled) throw new Error("Passkey sign-in is not enabled.");
  if (!databasePool) throw new Error("Passkeys require database-backed app accounts.");
}

function passkeyUserId(user) {
  return crypto
    .createHash("sha256")
    .update(`jenny-apps:${user.id}:${user.username}`)
    .digest();
}

function passkeyDefaultNickname(deviceType = "") {
  return deviceType === "multiDevice" ? "Synced passkey" : "Device passkey";
}

function passkeySummary(passkey) {
  const parts = [];
  if (passkey.deviceType === "multiDevice") parts.push("Synced");
  if (passkey.deviceType === "singleDevice") parts.push("This device");
  if (passkey.backedUp) parts.push("backed up");
  if (passkey.lastUsedAt) {
    parts.push(`last used ${new Date(passkey.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  } else if (passkey.createdAt) {
    parts.push(`added ${new Date(passkey.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
  }
  return parts.join(" · ") || "Ready for passkey sign-in";
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

function parseCookieValues(header, name) {
  const values = [];
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      values.push(part.slice(index + 1).trim());
    }
  }
  return values;
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

async function readJsonBody(request) {
  const body = await readBody(request);
  return parseJsonPayload(body);
}

function parseJsonPayload(body) {
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function isJsonRequest(request) {
  return String(request.headers["content-type"] || "").toLowerCase().includes("application/json");
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

function sendStaticIcon(response, pathname) {
  const filename = pathname.slice(1);
  const fullPath = path.join(root, filename);
  if (!fs.existsSync(fullPath)) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const contentType =
    filename.endsWith(".svg") ? "image/svg+xml" :
    filename.endsWith(".png") ? "image/png" :
    "image/x-icon";
  const body = fs.readFileSync(fullPath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "public, max-age=86400",
  });
  response.end(body);
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
