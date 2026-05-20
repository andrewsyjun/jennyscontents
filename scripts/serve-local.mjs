import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));

const port = numberFromEnv("LOCAL_PORT", 4173, 1024, 65535);
const host = process.env.LOCAL_HOST || "127.0.0.1";
const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const apiFetchTimeoutMs = numberFromEnv("API_FETCH_TIMEOUT_MS", 15000, 1000, 60000);
const tiktokOauthSessions = new Map();
const xOauthSessions = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/auth/facebook/start") {
      handleFacebookStart(response);
      return;
    }

    if (url.pathname === "/auth/facebook/callback") {
      handleFacebookCallback(url)
        .then((html) => send(response, 200, html, "text/html; charset=utf-8"))
        .catch((error) =>
          send(
            response,
            500,
            authResultPage({
              title: "Facebook Login failed",
              status: error.message,
              details: error.details || [
                "No tokens were printed.",
                "Check the local .env values and the Facebook Login redirect URI in Meta Developer settings.",
              ],
            }),
            "text/html; charset=utf-8"
          )
        );
      return;
    }

    if (url.pathname === "/auth/tiktok/start") {
      handleTikTokStart(response);
      return;
    }

    if (url.pathname === "/auth/tiktok/callback") {
      handleTikTokCallback(url)
        .then((html) => send(response, 200, html, "text/html; charset=utf-8"))
        .catch((error) =>
          send(
            response,
            500,
            authResultPage({
              title: "TikTok Login failed",
              status: error.message,
              details: error.details || [
                "No TikTok token values were saved or printed.",
                "Check TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI in .env.",
              ],
            }),
            "text/html; charset=utf-8"
          )
        );
      return;
    }

    if (url.pathname === "/auth/x/start") {
      handleXStart(response);
      return;
    }

    if (url.pathname === "/auth/x/callback") {
      handleXCallback(url)
        .then((html) => send(response, 200, html, "text/html; charset=utf-8"))
        .catch((error) =>
          send(
            response,
            500,
            authResultPage({
              title: "X Login failed",
              status: error.message,
              details: error.details || [
                "No X token values were saved or printed.",
                "Check X_CLIENT_ID, X_CLIENT_SECRET if using a confidential client, and X_REDIRECT_URI in .env.",
              ],
            }),
            "text/html; charset=utf-8"
          )
        );
      return;
    }

    if (url.pathname === "/api/instagram/summary") {
      handleInstagramSummary(url)
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            checkedAt: new Date().toISOString(),
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/tiktok/summary") {
      handleTikTokSummary()
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            checkedAt: new Date().toISOString(),
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/x/summary") {
      handleXSummary()
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            checkedAt: new Date().toISOString(),
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/library") {
      if (request.method === "GET") {
        handleLibraryGet()
          .then((payload) => sendJson(response, 200, payload))
          .catch((error) =>
            sendJson(response, 500, {
              ok: false,
              message: error.message,
            })
          );
        return;
      }

      if (request.method === "POST") {
        readJsonBody(request)
          .then((payload) => handleLibrarySave(payload))
          .then((payload) => sendJson(response, 200, payload))
          .catch((error) =>
            sendJson(response, 500, {
              ok: false,
              message: error.message,
            })
          );
        return;
      }

      sendJson(response, 405, { ok: false, message: "Use GET or POST for the library." });
      return;
    }

    if (url.pathname === "/api/ideas/generate") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, message: "Use POST to generate an idea." });
        return;
      }

      readJsonBody(request)
        .then((payload) => handleIdeaGenerate(payload))
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/videos/create") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, message: "Use POST to create a video." });
        return;
      }

      readJsonBody(request)
        .then((payload) => handleVideoCreate(payload))
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/videos/upload") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, message: "Use POST to upload a video." });
        return;
      }

      handleVideoUpload(request)
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/videos/status") {
      handleVideoStatus(url)
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname === "/api/brief/save") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, message: "Use POST to save a brief." });
        return;
      }

      readJsonBody(request)
        .then((payload) => handleBriefSave(payload))
        .then((payload) => sendJson(response, 200, payload))
        .catch((error) =>
          sendJson(response, 500, {
            ok: false,
            message: error.message,
          })
        );
      return;
    }

    if (url.pathname.startsWith("/generated-videos/")) {
      const videoPath = resolveGeneratedVideoPath(url.pathname);
      if (!videoPath) {
        send(response, 404, "Not found", "text/plain; charset=utf-8");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": videoMimeType(videoPath),
      });
      fs.createReadStream(videoPath).pipe(response);
      return;
    }

    const filePath = resolveStaticPath(url.pathname);

    if (!filePath) {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const ext = path.extname(filePath);
    send(response, 200, fs.readFileSync(filePath), contentTypes[ext] || "application/octet-stream");
  } catch (error) {
    send(response, 500, `Server error: ${error.message}`, "text/plain; charset=utf-8");
  }
});

server.listen(port, host, () => {
  console.log(`Jenny's Contents local app: http://${host}:${port}/`);
  console.log(`Facebook callback: http://${host}:${port}/auth/facebook/callback`);
  console.log(`TikTok callback: http://${host}:${port}/auth/tiktok/callback`);
  console.log(`X callback: http://${host}:${port}/auth/x/callback`);
});

function handleFacebookStart(response) {
  const appId = process.env.META_APP_ID;
  const redirectUri = facebookRedirectUri();

  if (!appId) {
    send(
      response,
      500,
      authResultPage({
        title: "Facebook Login is not configured",
        status: "Add META_APP_ID and META_APP_SECRET to .env, then restart npm start.",
        details: [
          `Use this redirect URI in Meta: ${redirectUri}`,
          "Do not paste the app secret into chat.",
        ],
      }),
      "text/html; charset=utf-8"
    );
    return;
  }

  const authUrl = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", "jennyscontents-facebook-login");
  authUrl.searchParams.set("scope", facebookLoginScopes().join(","));

  response.writeHead(302, { Location: authUrl.toString() });
  response.end();
}

function handleTikTokStart(response) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = tiktokRedirectUri();

  if (!clientKey || !clientSecret) {
    send(
      response,
      500,
      authResultPage({
        title: "TikTok Login is not configured",
        status: "Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env, then restart npm start.",
        details: [
          `Use this redirect URI in TikTok Developer Portal: ${redirectUri}`,
          "For this local app, configure TikTok Login Kit for Desktop so the 127.0.0.1 callback is allowed.",
          "Request scopes: user.info.basic and video.list.",
          "Do not paste the client secret into chat.",
        ],
      }),
      "text/html; charset=utf-8"
    );
    return;
  }

  cleanupTikTokOauthSessions();

  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = shouldUseTikTokPkce(redirectUri) ? generateCodeVerifier() : "";
  tiktokOauthSessions.set(state, {
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", clientKey);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "user.info.basic,video.list");
  authUrl.searchParams.set("state", state);

  if (codeVerifier) {
    authUrl.searchParams.set("code_challenge", tikTokCodeChallenge(codeVerifier));
    authUrl.searchParams.set("code_challenge_method", "S256");
  }

  response.writeHead(302, { Location: authUrl.toString() });
  response.end();
}

function handleXStart(response) {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = xRedirectUri();

  if (!clientId) {
    send(
      response,
      500,
      authResultPage({
        title: "X Login is not configured",
        status: "Add X_CLIENT_ID to .env, then restart npm start.",
        details: [
          `Use this callback URL in the X Developer Console: ${redirectUri}`,
          "Enable OAuth 2.0 in User authentication settings.",
          `Request scopes: ${xLoginScopes().join(" ")}`,
          "Add X_CLIENT_SECRET too if your X app is configured as a confidential client.",
          "Do not paste client secrets into chat.",
        ],
      }),
      "text/html; charset=utf-8"
    );
    return;
  }

  cleanupXOauthSessions();

  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = generateCodeVerifier();
  xOauthSessions.set(state, {
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", xLoginScopes().join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", xCodeChallenge(codeVerifier));
  authUrl.searchParams.set("code_challenge_method", "S256");

  response.writeHead(302, { Location: authUrl.toString() });
  response.end();
}

async function handleFacebookCallback(url) {
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (error) {
    throw new Error(error);
  }

  const state = url.searchParams.get("state");
  if (state !== "jennyscontents-facebook-login") {
    throw new Error("Invalid OAuth state.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("No code parameter was returned.");
  }

  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    throw new Error("META_APP_ID and META_APP_SECRET must be set in .env before exchanging the code.");
  }

  const shortToken = await exchangeFacebookCode(code);
  const { token, tokenType } = await exchangeLongLivedFacebookToken(shortToken);
  const discovery = await discoverInstagramAccount(token);
  if (!discovery.instagramUserId) {
    Object.assign(discovery, await discoverBusinessInstagramAccount(token));
  }
  if (!discovery.instagramUserId && process.env.INSTAGRAM_USER_ID) {
    Object.assign(discovery, await validateConfiguredInstagramAccount(token));
  }

  if (!discovery.instagramUserId) {
    throw new AuthError(
      "No connected Instagram business account was found for the authorized Facebook Pages.",
      [
        "No token values were saved or printed.",
        "If the OAuth dialog showed @junresidentialgroup, add INSTAGRAM_USER_ID and INSTAGRAM_USERNAME to .env and try again.",
        "Open Meta Business Suite Settings -> Profiles -> Jun Residential Group.",
        "Click Connect Instagram and finish linking @junresidentialgroup to the Jun Residential Group Facebook Page.",
        "Then return to Jenny's Contents and click Connect Facebook Login again.",
      ]
    );
  }

  upsertEnvValues(envPath(), {
    INSTAGRAM_AUTH_MODE: "facebook_login",
    INSTAGRAM_ACCESS_TOKEN: token,
    INSTAGRAM_USER_ID: discovery.instagramUserId,
    INSTAGRAM_USERNAME: discovery.instagramUsername,
    INSTAGRAM_PAGE_ID: discovery.pageId,
    INSTAGRAM_HASHTAG_DISCOVERY: "true",
  });

  Object.assign(process.env, {
    INSTAGRAM_AUTH_MODE: "facebook_login",
    INSTAGRAM_ACCESS_TOKEN: token,
    INSTAGRAM_USER_ID: discovery.instagramUserId,
    INSTAGRAM_USERNAME: discovery.instagramUsername,
    INSTAGRAM_PAGE_ID: discovery.pageId,
    INSTAGRAM_HASHTAG_DISCOVERY: "true",
  });

  return authResultPage({
    title: "Facebook Login connected",
    status: `Connected @${discovery.instagramUsername || discovery.instagramUserId} through ${discovery.pageName || "the selected Facebook Page"}.`,
    details: [
      `Token type saved: ${tokenType}.`,
      "INSTAGRAM_AUTH_MODE is now facebook_login.",
      "INSTAGRAM_HASHTAG_DISCOVERY is now true.",
      "No token values were printed.",
    ],
  });
}

async function handleTikTokCallback(url) {
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");
  const errorType = url.searchParams.get("error_type");
  if (error || errorType) {
    throw new Error(errorType || error);
  }

  const state = url.searchParams.get("state");
  const session = tiktokOauthSessions.get(state);
  tiktokOauthSessions.delete(state);

  if (!session || session.expiresAt < Date.now()) {
    throw new Error("Invalid or expired OAuth state. Start TikTok Login again from the app.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("No code parameter was returned.");
  }

  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set in .env before exchanging the code.");
  }

  const payload = await exchangeTikTokCode(code, session.codeVerifier);
  upsertEnvValues(envPath(), {
    TIKTOK_ACCESS_TOKEN: payload.access_token,
    TIKTOK_REFRESH_TOKEN: payload.refresh_token,
    TIKTOK_OPEN_ID: payload.open_id,
  });

  Object.assign(process.env, {
    TIKTOK_ACCESS_TOKEN: payload.access_token,
    TIKTOK_REFRESH_TOKEN: payload.refresh_token,
    TIKTOK_OPEN_ID: payload.open_id,
  });

  return authResultPage({
    title: "TikTok Login connected",
    status: `TikTok token saved for open_id ${payload.open_id || "unknown"}.`,
    details: [
      "TIKTOK_ACCESS_TOKEN, TIKTOK_REFRESH_TOKEN, and TIKTOK_OPEN_ID were saved to .env.",
      "No token values were printed.",
      "Return to Jenny's Contents, select TikTok, and click Refresh signals.",
    ],
  });
}

async function handleXCallback(url) {
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (error) {
    throw new Error(error);
  }

  const state = url.searchParams.get("state");
  const session = xOauthSessions.get(state);
  xOauthSessions.delete(state);

  if (!session || session.expiresAt < Date.now()) {
    throw new Error("Invalid or expired OAuth state. Start X Login again from the app.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("No code parameter was returned.");
  }

  if (!process.env.X_CLIENT_ID) {
    throw new Error("X_CLIENT_ID must be set in .env before exchanging the code.");
  }

  const payload = await exchangeXCode(code, session.codeVerifier);
  const user = await getXMe(payload.access_token);
  const envValues = {
    X_ACCESS_TOKEN: payload.access_token,
    X_REFRESH_TOKEN: payload.refresh_token || process.env.X_REFRESH_TOKEN || "",
    X_TOKEN_TYPE: payload.token_type || "bearer",
    X_TOKEN_EXPIRES_AT: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : "",
    X_USER_ID: user.id || "",
    X_USERNAME: user.username || process.env.X_USERNAME || "",
  };

  upsertEnvValues(envPath(), envValues);
  Object.assign(process.env, envValues);

  return authResultPage({
    title: "X Login connected",
    status: `Connected @${user.username || user.id || "X account"}.`,
    details: [
      "X_ACCESS_TOKEN, X_REFRESH_TOKEN, X_USER_ID, and X_USERNAME were saved to .env.",
      "No token values were printed.",
      "Return to Jenny's Contents, select X, and click Refresh posts.",
    ],
  });
}

async function exchangeTikTokCode(code, codeVerifier = "") {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: tiktokRedirectUri(),
  });

  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });

  const payload = await parseResponse(response, "TikTok token exchange");
  if (!payload.access_token) {
    throw new Error("TikTok token exchange did not return an access token.");
  }
  return payload;
}

async function refreshTikTokAccessToken() {
  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("TIKTOK_REFRESH_TOKEN is not configured.");
  }

  const missing = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"].filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`${missing.join(" and ")} must be set before refreshing TikTok tokens.`);
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
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const payload = await parseResponse(response, "TikTok token refresh");
  if (!payload.access_token) {
    throw new Error("TikTok token refresh did not return an access token.");
  }

  const envValues = {
    TIKTOK_ACCESS_TOKEN: payload.access_token,
    TIKTOK_REFRESH_TOKEN: payload.refresh_token || refreshToken,
    TIKTOK_OPEN_ID: payload.open_id || process.env.TIKTOK_OPEN_ID || "",
  };
  upsertEnvValues(envPath(), envValues);
  Object.assign(process.env, envValues);
  return payload.access_token;
}

async function exchangeXCode(code, codeVerifier) {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: xRedirectUri(),
    code_verifier: codeVerifier,
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = xBasicAuthHeader();
  } else {
    body.set("client_id", process.env.X_CLIENT_ID);
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });

  const payload = await parseResponse(response, "X token exchange");
  if (!payload.access_token) {
    throw new Error("X token exchange did not return an access token.");
  }
  return payload;
}

async function refreshXAccessToken() {
  const refreshToken = process.env.X_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("X_REFRESH_TOKEN is not configured.");
  }
  if (!process.env.X_CLIENT_ID) {
    throw new Error("X_CLIENT_ID must be set before refreshing X tokens.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (process.env.X_CLIENT_SECRET) {
    headers.Authorization = xBasicAuthHeader();
  } else {
    body.set("client_id", process.env.X_CLIENT_ID);
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });

  const payload = await parseResponse(response, "X token refresh");
  if (!payload.access_token) {
    throw new Error("X token refresh did not return an access token.");
  }

  const envValues = {
    X_ACCESS_TOKEN: payload.access_token,
    X_REFRESH_TOKEN: payload.refresh_token || refreshToken,
    X_TOKEN_TYPE: payload.token_type || "bearer",
    X_TOKEN_EXPIRES_AT: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : process.env.X_TOKEN_EXPIRES_AT || "",
  };
  upsertEnvValues(envPath(), envValues);
  Object.assign(process.env, envValues);
  return payload.access_token;
}

async function exchangeFacebookCode(code) {
  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", process.env.META_APP_ID);
  tokenUrl.searchParams.set("redirect_uri", facebookRedirectUri());
  tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET);
  tokenUrl.searchParams.set("code", code);

  const payload = await getJson(tokenUrl, {}, "Facebook OAuth code exchange");
  if (!payload.access_token) {
    throw new Error("Facebook OAuth code exchange did not return an access token.");
  }
  return payload.access_token;
}

async function exchangeLongLivedFacebookToken(shortToken) {
  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("grant_type", "fb_exchange_token");
  tokenUrl.searchParams.set("client_id", process.env.META_APP_ID);
  tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET);
  tokenUrl.searchParams.set("fb_exchange_token", shortToken);

  try {
    const payload = await getJson(tokenUrl, {}, "Facebook long-lived token exchange");
    return {
      token: payload.access_token || shortToken,
      tokenType: payload.access_token ? "long-lived user token" : "short-lived user token",
    };
  } catch {
    return { token: shortToken, tokenType: "short-lived user token" };
  }
}

async function discoverInstagramAccount(token) {
  const accountsUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  accountsUrl.searchParams.set("limit", "100");
  accountsUrl.searchParams.set("access_token", token);

  const payload = await getJson(accountsUrl, {}, "Facebook Pages");
  const pages = Array.isArray(payload.data) ? payload.data : [];
  const preferredPageId = process.env.INSTAGRAM_PAGE_ID || "";
  const preferredUsername = String(process.env.INSTAGRAM_USERNAME || "").toLowerCase();

  const selected =
    pages.find((page) => preferredPageId && page.id === preferredPageId) ||
    pages.find(
      (page) =>
        preferredUsername &&
        String(page.instagram_business_account?.username || "").toLowerCase() === preferredUsername
    ) ||
    pages.find((page) => page.instagram_business_account?.id);

  return {
    pageId: selected?.id || "",
    pageName: selected?.name || "",
    instagramUserId: selected?.instagram_business_account?.id || "",
    instagramUsername: selected?.instagram_business_account?.username || preferredUsername,
  };
}

async function discoverBusinessInstagramAccount(token) {
  const businessesUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/businesses`);
  businessesUrl.searchParams.set("fields", "id,name");
  businessesUrl.searchParams.set("limit", "100");
  businessesUrl.searchParams.set("access_token", token);

  try {
    const payload = await getJson(businessesUrl, {}, "Facebook businesses");
    const businesses = Array.isArray(payload.data) ? payload.data : [];
    const preferredUsername = String(process.env.INSTAGRAM_USERNAME || "").toLowerCase();

    for (const business of businesses) {
      const accountsUrl = new URL(
        `https://graph.facebook.com/${graphVersion}/${business.id}/instagram_business_accounts`
      );
      accountsUrl.searchParams.set("fields", "id,username");
      accountsUrl.searchParams.set("limit", "100");
      accountsUrl.searchParams.set("access_token", token);

      const accountsPayload = await getJson(accountsUrl, {}, `Business Instagram accounts ${business.name}`);
      const accounts = Array.isArray(accountsPayload.data) ? accountsPayload.data : [];
      const selected =
        accounts.find(
          (account) => preferredUsername && String(account.username || "").toLowerCase() === preferredUsername
        ) || accounts[0];

      if (selected?.id) {
        return {
          pageId: process.env.INSTAGRAM_PAGE_ID || "",
          pageName: business.name || "",
          instagramUserId: selected.id,
          instagramUsername: selected.username || preferredUsername,
        };
      }
    }
  } catch {
    return {
      pageId: "",
      pageName: "",
      instagramUserId: "",
      instagramUsername: "",
    };
  }

  return {
    pageId: "",
    pageName: "",
    instagramUserId: "",
    instagramUsername: "",
  };
}

async function validateConfiguredInstagramAccount(token) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const profileUrl = new URL(`https://graph.facebook.com/${graphVersion}/${userId}`);
  profileUrl.searchParams.set("fields", "id,username");
  profileUrl.searchParams.set("access_token", token);

  const profile = await getJson(profileUrl, {}, "Configured Instagram account");
  return {
    pageId: process.env.INSTAGRAM_PAGE_ID || "",
    pageName: "",
    instagramUserId: profile.id || userId,
    instagramUsername: profile.username || process.env.INSTAGRAM_USERNAME || "",
  };
}

class AuthError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "AuthError";
    this.details = details;
  }
}

function facebookRedirectUri() {
  return (
    process.env.FACEBOOK_REDIRECT_URI ||
    `${process.env.LOCAL_APP_URL || `http://${host}:${port}`}/auth/facebook/callback`
  );
}

function tiktokRedirectUri() {
  return (
    process.env.TIKTOK_REDIRECT_URI ||
    `${process.env.LOCAL_APP_URL || `http://${host}:${port}`}/auth/tiktok/callback`
  );
}

function xRedirectUri() {
  return (
    process.env.X_REDIRECT_URI ||
    `${process.env.LOCAL_APP_URL || `http://${host}:${port}`}/auth/x/callback`
  );
}

function shouldUseTikTokPkce(redirectUri) {
  try {
    const url = new URL(redirectUri);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function generateCodeVerifier() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(64);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function tikTokCodeChallenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier).digest("hex");
}

function xCodeChallenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

function cleanupTikTokOauthSessions() {
  const now = Date.now();
  for (const [state, session] of tiktokOauthSessions.entries()) {
    if (session.expiresAt < now) {
      tiktokOauthSessions.delete(state);
    }
  }
}

function cleanupXOauthSessions() {
  const now = Date.now();
  for (const [state, session] of xOauthSessions.entries()) {
    if (session.expiresAt < now) {
      xOauthSessions.delete(state);
    }
  }
}

function facebookLoginScopes() {
  return csv(
    process.env.FACEBOOK_LOGIN_SCOPES ||
      "instagram_basic,pages_show_list,pages_read_engagement,business_management"
  );
}

function xLoginScopes() {
  const scopes = csv(process.env.X_LOGIN_SCOPES || "tweet.read,users.read,offline.access");
  return scopes.length ? scopes : ["tweet.read", "users.read", "offline.access"];
}

function publicAppPath(suffix = "/") {
  const base = normalizePublicBasePath(process.env.PUBLIC_APP_BASE_PATH || "");
  const value = String(suffix || "/");
  if (!base) return value;
  if (value === "/") return `${base}/`;
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

function normalizePublicBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function xBasicAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
}

function authResultPage({ title, status, details }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f4ef; color: #1c2420; }
      main { max-width: 760px; margin: 10vh auto; padding: 28px; background: #fffdf8; border: 1px solid #d9d4c8; border-radius: 8px; }
      h1 { margin: 0 0 12px; font-size: 1.6rem; }
      p, li { line-height: 1.55; }
      a { color: #245746; font-weight: 800; }
      code { background: #f0eee6; padding: 2px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(status)}</p>
      <ul>
        ${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}
      </ul>
      <p><a href="${escapeHtml(publicAppPath("/"))}">Return to Jenny's Contents</a></p>
    </main>
  </body>
</html>`;
}

async function handleInstagramSummary(url) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const authMode = instagramAuthMode();
  const graphHost = authMode === "facebook_login" ? "graph.facebook.com" : "graph.instagram.com";
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isNaN(requestedLimit) ? 12 : Math.min(25, Math.max(1, requestedLimit));
  const sourceStatus = [];
  const warnings = [];

  if (!token) {
    return {
      ok: false,
      configured: false,
      checkedAt: new Date().toISOString(),
      account: null,
      sourceStatus: ["Instagram skipped: INSTAGRAM_ACCESS_TOKEN is not configured."],
      warnings,
      media: [],
      analysis: emptyAnalysis(),
    };
  }

  const profileId = process.env.INSTAGRAM_USER_ID || "me";
  const meUrl = new URL(`https://${graphHost}/${graphVersion}/${profileId}`);
  meUrl.searchParams.set("fields", instagramProfileFields(authMode));
  meUrl.searchParams.set("access_token", token);

  const me = await getJson(meUrl, {}, "Instagram profile");
  const account = {
    id: me.id,
    username: me.username || process.env.INSTAGRAM_USERNAME || "",
    accountType: me.account_type || "",
    authMode,
    mediaCount: number(me.media_count),
  };

  const mediaUrl = new URL(`https://${graphHost}/${graphVersion}/${me.id}/media`);
  mediaUrl.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count"
  );
  mediaUrl.searchParams.set("limit", String(limit));
  mediaUrl.searchParams.set("access_token", token);

  const mediaPayload = await getJson(mediaUrl, {}, "Instagram media");
  const items = Array.isArray(mediaPayload.data) ? mediaPayload.data : [];
  sourceStatus.push(`Instagram owned media: ${items.length} item(s) returned.`);

  const media = [];
  for (const item of items) {
    const insights = await getInstagramInsights({ graphHost, mediaId: item.id, token, warnings });
    media.push(normalizeInstagramMedia({ item, insights, source: "owned_media" }));
  }

  if (truthy(process.env.INSTAGRAM_HASHTAG_DISCOVERY)) {
    if (authMode === "facebook_login") {
      media.push(...(await collectInstagramHashtags({ token, userId: me.id, sourceStatus, warnings })));
    } else {
      sourceStatus.push("Instagram hashtag discovery requires INSTAGRAM_AUTH_MODE=facebook_login.");
    }
  } else {
    sourceStatus.push("Instagram hashtag discovery skipped: INSTAGRAM_HASHTAG_DISCOVERY is false.");
  }

  return {
    ok: true,
    configured: true,
    checkedAt: new Date().toISOString(),
    account,
    sourceStatus,
    warnings,
    media: sortSignalMedia(media),
    analysis: analyzeMedia(media),
  };
}

async function handleTikTokSummary() {
  let token = process.env.TIKTOK_ACCESS_TOKEN;
  const checkedAt = new Date().toISOString();
  const sourceStatus = [
    "TikTok Display API returns owned videos. Broad public TikTok search requires approved Research API access.",
  ];
  const warnings = [];

  if (!token && process.env.TIKTOK_REFRESH_TOKEN) {
    try {
      token = await refreshTikTokAccessToken();
      sourceStatus.push("TikTok access token refreshed from the saved refresh token.");
    } catch (error) {
      warnings.push(`TikTok token refresh failed: ${error.message}`);
    }
  }

  if (!token) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      account: null,
      message: "TikTok is not configured. Add TIKTOK_ACCESS_TOKEN after completing TikTok OAuth.",
      sourceStatus: [
        "TikTok skipped: TIKTOK_ACCESS_TOKEN is not configured.",
        ...sourceStatus,
      ],
      warnings,
      media: [],
      analysis: emptyAnalysis(),
    };
  }

  try {
    return await buildTikTokSummary({ token, checkedAt, sourceStatus, warnings });
  } catch (error) {
    if (!process.env.TIKTOK_REFRESH_TOKEN || !isTikTokTokenError(error)) {
      throw error;
    }

    warnings.push(`TikTok access token was rejected, so it was refreshed and retried: ${error.message}`);
    const refreshedToken = await refreshTikTokAccessToken();
    sourceStatus.push("TikTok access token refreshed from the saved refresh token.");
    return buildTikTokSummary({ token: refreshedToken, checkedAt, sourceStatus, warnings });
  }
}

async function buildTikTokSummary({ token, checkedAt, sourceStatus, warnings }) {
  const userUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
  userUrl.searchParams.set(
    "fields",
    process.env.TIKTOK_USER_FIELDS || "open_id,avatar_url,display_name,username"
  );

  const user = await getJson(
    userUrl,
    {
      Authorization: `Bearer ${token}`,
    },
    "TikTok user"
  );

  const listUrl = new URL("https://open.tiktokapis.com/v2/video/list/");
  listUrl.searchParams.set(
    "fields",
    "id,create_time,share_url,video_description,duration,like_count,comment_count,share_count,view_count"
  );

  const videosPayload = await postJson(
    listUrl,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    {
      max_count: numberFromEnv("TIKTOK_VIDEO_LIST_MAX_COUNT", 10, 1, 20),
    },
    "TikTok video list"
  );

  const videos = videosPayload.data?.videos || [];
  sourceStatus.push(`TikTok owned videos: ${videos.length} item(s) returned.`);

  const media = videos.map(normalizeTikTokVideo);
  const profile = user.data?.user || {};
  return {
    ok: true,
    configured: true,
    checkedAt,
    account: {
      id: profile.open_id || process.env.TIKTOK_OPEN_ID || "",
      username: profile.username || process.env.TIKTOK_USERNAME || profile.display_name || "connected account",
      authMode: "display_api",
    },
    sourceStatus,
    warnings,
    media,
    analysis: analyzeMedia(media),
  };
}

function isTikTokTokenError(error) {
  return /access.?token|auth|credential|expired|invalid.?token|unauthorized/i.test(error.message || "");
}

async function handleXSummary() {
  const oauthAccount = xOAuthAccountFromEnv();
  let token = process.env.X_BEARER_TOKEN || process.env.X_ACCESS_TOKEN;
  const checkedAt = new Date().toISOString();
  const sourceStatus = [];
  const warnings = [];
  let authMode = process.env.X_BEARER_TOKEN ? "app_bearer" : "oauth2_user";

  if (process.env.X_BEARER_TOKEN && oauthAccount) {
    sourceStatus.push("X recent search is using the configured app bearer token for API credits.");
  }

  if (!token) {
    if (process.env.X_REFRESH_TOKEN) {
      try {
        token = await refreshXAccessToken();
        authMode = "oauth2_user";
        sourceStatus.push("X access token refreshed from the saved refresh token.");
      } catch (error) {
        warnings.push(`X token refresh failed: ${error.message}`);
      }
    }
  }

  if (!token) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      account: null,
      message: "X is not configured. Connect X or add X_BEARER_TOKEN to use recent public X search.",
      sourceStatus: [
        "X skipped: no X OAuth access token or X bearer token is configured.",
        "Use the X API recent search endpoint for public posts from the last 7 days.",
        ...sourceStatus,
      ],
      warnings,
      media: [],
      analysis: emptyAnalysis(),
    };
  }

  try {
    return await buildXSummary({ token, authMode, checkedAt, sourceStatus, warnings, accountOverride: oauthAccount });
  } catch (error) {
    if (authMode !== "oauth2_user" || !process.env.X_REFRESH_TOKEN || !isXTokenError(error)) {
      if (oauthAccount) {
        return xConnectedUnavailableSummary({
          checkedAt,
          sourceStatus,
          warnings,
          message: error.message,
          account: oauthAccount,
        });
      }
      throw error;
    }

    warnings.push(`X access token was rejected, so it was refreshed and retried: ${error.message}`);
    token = await refreshXAccessToken();
    sourceStatus.push("X access token refreshed from the saved refresh token.");
    try {
      return await buildXSummary({ token, authMode: "oauth2_user", checkedAt, sourceStatus, warnings, accountOverride: oauthAccount });
    } catch (retryError) {
      return xConnectedUnavailableSummary({
        checkedAt,
        sourceStatus,
        warnings,
        message: retryError.message,
        account: oauthAccount,
      });
    }
  }
}

function xOAuthAccountFromEnv() {
  if (!process.env.X_ACCESS_TOKEN && !process.env.X_REFRESH_TOKEN && !process.env.X_USERNAME && !process.env.X_USER_ID) {
    return null;
  }

  return {
    id: process.env.X_USER_ID || "oauth_user",
    username: process.env.X_USERNAME || "connected X account",
    authMode: "oauth2_user",
  };
}

function xConnectedUnavailableSummary({ checkedAt, sourceStatus, warnings, message, account }) {
  const connectedAccount = account || xOAuthAccountFromEnv() || {
    id: "oauth_user",
    username: "connected X account",
    authMode: "oauth2_user",
  };

  return {
    ok: false,
    configured: true,
    checkedAt,
    account: connectedAccount,
    message,
    sourceStatus: [
      `X connected @${connectedAccount.username || "connected account"} through OAuth 2.0.`,
      `X posts could not be refreshed: ${message}`,
      ...sourceStatus,
    ],
    warnings,
    media: [],
    analysis: emptyAnalysis(),
  };
}

async function buildXSummary({ token, authMode, checkedAt, sourceStatus, warnings, accountOverride = null }) {
  const query =
    process.env.X_RECENT_SEARCH_QUERY ||
    '("real estate" OR realtor OR homebuyer OR homeseller) lang:en -is:retweet';
  const searchUrl = new URL("https://api.x.com/2/tweets/search/recent");
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("max_results", String(numberFromEnv("X_RECENT_SEARCH_MAX_RESULTS", 10, 10, 100)));
  searchUrl.searchParams.set("sort_order", "relevancy");
  searchUrl.searchParams.set("tweet.fields", "author_id,created_at,public_metrics,text");
  searchUrl.searchParams.set("expansions", "author_id");
  searchUrl.searchParams.set("user.fields", "username,name");

  const payload = await getJson(
    searchUrl,
    {
      Authorization: `Bearer ${token}`,
    },
    "X recent search"
  );

  const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
  const rows = payload.data || [];
  let kept = 0;
  let dropped = 0;
  const media = [];

  for (const post of rows) {
    const item = normalizeXPost(post, users.get(post.author_id));
    if (!isRelevantInstagramMedia(item)) {
      dropped += 1;
      continue;
    }

    kept += 1;
    media.push(item);
  }

  const statusRows = [
    ...sourceStatus,
    `X recent search: ${kept}/${rows.length} real estate post(s) kept.`,
    `X query: ${query}`,
  ];
  if (dropped) {
    statusRows.push(`X recent search: ${dropped} unrelated post(s) filtered out.`);
  }

  return {
    ok: true,
    configured: true,
    checkedAt,
    account: accountOverride || (await xAccountFromToken(token, authMode)),
    sourceStatus: statusRows,
    warnings,
    media,
    analysis: analyzeMedia(media),
  };
}

async function xAccountFromToken(token, authMode) {
  if (authMode !== "oauth2_user") {
    return {
      id: "recent_search",
      username: "public recent search",
      authMode: "app_bearer",
    };
  }

  try {
    const user = await getXMe(token);
    return {
      id: user.id || process.env.X_USER_ID || "oauth_user",
      username: user.username || process.env.X_USERNAME || "connected X account",
      authMode,
    };
  } catch {
    return {
      id: process.env.X_USER_ID || "oauth_user",
      username: process.env.X_USERNAME || "connected X account",
      authMode,
    };
  }
}

async function getXMe(token) {
  const meUrl = new URL("https://api.x.com/2/users/me");
  meUrl.searchParams.set("user.fields", "username,name");
  const payload = await getJson(
    meUrl,
    {
      Authorization: `Bearer ${token}`,
    },
    "X user profile"
  );
  return payload.data || {};
}

function isXTokenError(error) {
  return /access.?token|auth|credential|expired|invalid.?token|unauthorized|forbidden/i.test(
    error.message || ""
  );
}

async function collectInstagramHashtags({ token, userId, sourceStatus, warnings }) {
  const tags = csv(process.env.INSTAGRAM_HASHTAGS).slice(0, 30);
  const limit = numberFromEnv("INSTAGRAM_HASHTAG_LIMIT", 5, 1, 25);
  const concurrency = numberFromEnv("INSTAGRAM_HASHTAG_CONCURRENCY", 4, 1, 8);
  const rows = [];

  if (!tags.length) {
    sourceStatus.push("Instagram hashtag discovery skipped: INSTAGRAM_HASHTAGS is empty.");
    return rows;
  }

  await mapWithConcurrency(tags, concurrency, async (tag) => {
    try {
      const cleanTag = tag.replace(/^#/, "");
      const searchUrl = new URL(`https://graph.facebook.com/${graphVersion}/ig_hashtag_search`);
      searchUrl.searchParams.set("user_id", userId);
      searchUrl.searchParams.set("q", cleanTag);
      searchUrl.searchParams.set("access_token", token);

      const search = await getJson(searchUrl, {}, `Instagram hashtag ${cleanTag}`);
      const hashtagId = search.data?.[0]?.id;
      if (!hashtagId) {
        sourceStatus.push(`Instagram #${cleanTag}: no hashtag id returned.`);
        return;
      }

      const topUrl = new URL(`https://graph.facebook.com/${graphVersion}/${hashtagId}/top_media`);
      topUrl.searchParams.set("user_id", userId);
      topUrl.searchParams.set(
        "fields",
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count"
      );
      topUrl.searchParams.set("limit", String(limit));
      topUrl.searchParams.set("access_token", token);

      const top = await getJson(topUrl, {}, `Instagram hashtag top_media ${cleanTag}`);
      const items = Array.isArray(top.data) ? top.data : [];
      let kept = 0;
      let dropped = 0;

      for (const item of items) {
        const media = normalizeInstagramMedia({
          item,
          insights: {},
          source: "hashtag_top_media",
          hashtag: cleanTag,
        });

        if (!isRelevantInstagramMedia(media)) {
          dropped += 1;
          continue;
        }

        kept += 1;
        rows.push(media);
      }

      sourceStatus.push(
        `Instagram #${cleanTag}: ${kept}/${items.length} real estate top media item(s) kept.`
      );
      if (dropped) {
        sourceStatus.push(`Instagram #${cleanTag}: ${dropped} unrelated top media item(s) filtered out.`);
      }
    } catch (error) {
      warnings.push(`Instagram hashtag #${tag} failed: ${error.message}`);
    }
  });

  return rows;
}

async function mapWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function getInstagramInsights({ graphHost, mediaId, token, warnings }) {
  const insights = {};
  const metrics = csv(process.env.INSTAGRAM_INSIGHT_METRICS || "views,reach,saved,shares");

  for (const metric of metrics) {
    try {
      const insightUrl = new URL(`https://${graphHost}/${graphVersion}/${mediaId}/insights`);
      insightUrl.searchParams.set("metric", metric);
      insightUrl.searchParams.set("access_token", token);

      const payload = await getJson(insightUrl, {}, `Instagram insight ${metric}`);
      for (const row of payload.data || []) {
        insights[row.name] = latestInsightValue(row);
      }
    } catch (error) {
      if (!warnings.some((warning) => warning.includes(metric))) {
        warnings.push(`Instagram insight "${metric}" was not available for one or more posts.`);
      }
    }
  }

  return insights;
}

function normalizeInstagramMedia({ item, insights, source, hashtag = "" }) {
  const caption = String(item.caption || "");
  const media = {
    id: item.id,
    source,
    hashtag,
    caption,
    format: instagramFormat(item),
    mediaType: item.media_type || "",
    mediaProductType: item.media_product_type || "",
    timestamp: item.timestamp || "",
    permalink: item.permalink || "",
    likes: number(item.like_count || insights.likes),
    comments: number(item.comments_count || insights.comments),
    views: number(insights.views || insights.plays || insights.reach),
    reach: number(insights.reach),
    saves: number(insights.saved || insights.saves),
    shares: number(insights.shares),
    hookPattern: inferHookPattern(caption),
    topicCategory: inferTopicCategory(caption),
    score: 0,
  };
  media.score = scoreMedia(media);
  return media;
}

function normalizeTikTokVideo(video) {
  const media = {
    id: video.id,
    source: "owned_video",
    hashtag: "",
    caption: video.video_description || "",
    format: "short_video",
    mediaType: "VIDEO",
    mediaProductType: "TIKTOK",
    timestamp: video.create_time ? new Date(Number(video.create_time) * 1000).toISOString() : "",
    permalink: video.share_url || "",
    likes: number(video.like_count),
    comments: number(video.comment_count),
    views: number(video.view_count),
    reach: 0,
    saves: 0,
    shares: number(video.share_count),
    hookPattern: inferHookPattern(video.video_description || ""),
    topicCategory: inferTopicCategory(video.video_description || ""),
    score: 0,
  };
  media.score = scoreMedia(media);
  return media;
}

function normalizeXPost(post, author = {}) {
  const metrics = post.public_metrics || {};
  const username = author.username || "x";
  const media = {
    id: post.id,
    source: "x_recent_search",
    hashtag: "",
    caption: post.text || "",
    format: "post",
    mediaType: "POST",
    mediaProductType: "X",
    timestamp: post.created_at || "",
    permalink: username ? `https://x.com/${username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`,
    likes: number(metrics.like_count),
    comments: number(metrics.reply_count),
    views: number(metrics.impression_count),
    reach: 0,
    saves: 0,
    shares: number(metrics.retweet_count) + number(metrics.quote_count),
    hookPattern: inferHookPattern(post.text || ""),
    topicCategory: inferTopicCategory(post.text || ""),
    score: 0,
  };
  media.score = scoreMedia(media);
  return media;
}

function analyzeMedia(media) {
  const sorted = [...media].sort((a, b) => b.score - a.score);
  const lastSevenDays = sorted.filter(isRecentSignalMedia);
  const signalRows = lastSevenDays.length ? lastSevenDays : sorted;
  const totals = signalRows.reduce(
    (sum, item) => ({
      views: sum.views + item.views,
      likes: sum.likes + item.likes,
      comments: sum.comments + item.comments,
      saves: sum.saves + item.saves,
      shares: sum.shares + item.shares,
    }),
    { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 }
  );

  return {
    totals,
    analyzedCount: sorted.length,
    recentCount: lastSevenDays.length,
    topPosts: signalRows.slice(0, 5),
    hookPatterns: topCounts(signalRows.map((item) => item.hookPattern)),
    topicCategories: topCounts(signalRows.map((item) => item.topicCategory)),
    formatMix: topCounts(signalRows.map((item) => item.format)),
  };
}

function sortSignalMedia(media) {
  return [...media].sort((a, b) => {
    const aRecent = isRecentSignalMedia(a);
    const bRecent = isRecentSignalMedia(b);
    if (aRecent !== bRecent) return aRecent ? -1 : 1;
    return number(b.score) - number(a.score);
  });
}

function isRecentSignalMedia(item) {
  return Boolean(item?.timestamp) && daysAgo(item.timestamp) <= 7;
}

function emptyAnalysis() {
  return {
    totals: { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 },
    analyzedCount: 0,
    recentCount: 0,
    topPosts: [],
    hookPatterns: [],
    topicCategories: [],
    formatMix: [],
  };
}

function resolveStaticPath(pathname) {
  let cleanPath = decodeURIComponent(pathname).replace(/\\/g, "/");
  if (cleanPath.endsWith("/")) cleanPath += "index.html";
  if (!path.extname(cleanPath)) cleanPath = `${cleanPath}/index.html`;

  const candidate = path.resolve(root, `.${cleanPath}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return "";
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return "";
  return candidate;
}

function resolveGeneratedVideoPath(pathname) {
  const fileName = path.basename(decodeURIComponent(pathname));
  if (!/^[a-z0-9_.-]+\.(mp4|webm|mov)$/i.test(fileName)) return "";

  const dir = generatedVideoDir();
  const candidate = path.resolve(dir, fileName);
  if (!candidate.startsWith(`${dir}${path.sep}`)) return "";
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return "";
  return candidate;
}

function videoMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

function libraryFilePath() {
  return path.resolve(
    root,
    process.env.CONTENT_LIBRARY_PATH ||
      path.join(process.env.CONTENT_OUTPUT_DIR || "content-strategy", "library.json")
  );
}

function contentLibraryPayload() {
  const filePath = libraryFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      library: emptyLibrary(),
      filePath,
    };
  }

  const library = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    exists: true,
    library: {
      ...emptyLibrary(),
      ...library,
      savedIdeas: Array.isArray(library.savedIdeas) ? library.savedIdeas : [],
      videoJobs: Array.isArray(library.videoJobs) ? library.videoJobs : [],
    },
    filePath,
  };
}

function emptyLibrary() {
  return {
    version: 1,
    savedIdeas: [],
    videoJobs: [],
    updatedAt: "",
  };
}

async function handleLibraryGet() {
  const payload = contentLibraryPayload();
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    exists: payload.exists,
    filePath: payload.filePath,
    videoDir: generatedVideoDir(),
    library: payload.library,
  };
}

async function handleLibrarySave(payload) {
  const filePath = libraryFilePath();
  const savedIdeas = Array.isArray(payload.savedIdeas) ? payload.savedIdeas.slice(0, 200) : [];
  const videoJobs = Array.isArray(payload.videoJobs) ? payload.videoJobs.slice(0, 200) : [];
  const library = {
    version: 1,
    savedIdeas,
    videoJobs,
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(library, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);

  return {
    ok: true,
    filePath,
    videoDir: generatedVideoDir(),
    library,
  };
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("Request body is too large.");
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body must be JSON.");
  }
}

async function handleBriefSave(payload) {
  const content = String(payload.content || "").trim();
  if (!content) {
    throw new Error("Brief content is empty.");
  }

  const outputDir = path.join(root, process.env.CONTENT_OUTPUT_DIR || "content-strategy");
  fs.mkdirSync(outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = path.join(outputDir, `jennyscontents-${stamp}.md`);
  fs.writeFileSync(filePath, `${content}\n`);

  const drive = await maybeUploadBriefToDrive(filePath, content);
  return {
    ok: true,
    filePath,
    drive,
  };
}

async function handleVideoCreate(payload) {
  const checkedAt = new Date().toISOString();
  const prompt = String(payload.prompt || "").trim();
  const provider = resolveVideoProvider(payload);

  if (!prompt) {
    throw new Error("Video prompt is empty.");
  }

  if (provider === "xai") {
    return handleXaiVideoCreate({ payload, prompt, checkedAt });
  }

  return handleOpenAIVideoCreate({ payload, prompt, checkedAt });
}

async function handleVideoUpload(request) {
  const checkedAt = new Date().toISOString();
  const upload = await readMultipartVideoUpload(request);
  if (!upload.file?.length) {
    throw new Error("Choose an MP4, WebM, or MOV file to upload.");
  }

  const originalFileName = upload.fileName || "uploaded-video.mp4";
  const originalExt = path.extname(originalFileName).toLowerCase();
  const mimeExt =
    upload.mimeType === "video/webm"
      ? ".webm"
      : upload.mimeType === "video/quicktime"
        ? ".mov"
        : ".mp4";
  const ext = [".mp4", ".webm", ".mov"].includes(originalExt) ? originalExt : mimeExt;
  if (![".mp4", ".webm", ".mov"].includes(ext)) {
    throw new Error("Only MP4, WebM, and MOV video files can be uploaded.");
  }

  const dir = generatedVideoDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = checkedAt.replace(/[:.]/g, "-").slice(0, 19);
  const baseName = safeFileName(path.basename(originalFileName, originalExt || ext)) || "uploaded-video";
  const fileName = `${safeFileName(`uploaded-${stamp}-${baseName}`)}${ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, upload.file);

  const localUrl = `/generated-videos/${fileName}`;
  return {
    ok: true,
    checkedAt,
    provider: "external_upload",
    video: {
      id: `upload-${stamp}-${safeFileName(upload.fields.jobId || baseName)}`,
      status: "completed",
      progress: 100,
      provider: "external_upload",
      model: "external upload",
      videoUrl: "",
      localUrl,
      fileName,
      originalFileName,
      uploadedAt: checkedAt,
      completedAt: checkedAt,
    },
  };
}

async function readMultipartVideoUpload(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2] || "";
  if (!boundary) {
    throw new Error("Video upload must use multipart/form-data.");
  }

  const maxBytes = numberFromEnv("VIDEO_UPLOAD_MAX_MB", 250, 10, 2000) * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const next = Buffer.from(chunk);
    total += next.length;
    if (total > maxBytes) {
      throw new Error(`Video file is too large. Limit is ${Math.round(maxBytes / 1024 / 1024)}MB.`);
    }
    chunks.push(next);
  }

  const raw = Buffer.concat(chunks).toString("latin1");
  const fields = {};
  let file = null;
  let fileName = "";
  let mimeType = "";

  for (const part of raw.split(`--${boundary}`)) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const clean = part.startsWith("\r\n") ? part.slice(2) : part;
    const headerEnd = clean.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = clean.slice(0, headerEnd);
    let bodyText = clean.slice(headerEnd + 4);
    if (bodyText.endsWith("\r\n")) bodyText = bodyText.slice(0, -2);
    if (bodyText.endsWith("--")) bodyText = bodyText.slice(0, -2);

    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || "";
    const partFileName = disposition.match(/filename="([^"]*)"/i)?.[1] || "";
    const partMimeType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";
    if (!name) continue;

    if (partFileName) {
      file = Buffer.from(bodyText, "latin1");
      fileName = path.basename(partFileName);
      mimeType = partMimeType;
    } else {
      fields[name] = bodyText;
    }
  }

  if (!file) {
    throw new Error("Video upload did not include a file.");
  }

  return { fields, file, fileName, mimeType };
}

async function handleOpenAIVideoCreate({ payload, prompt, checkedAt }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      message: setupVideoMessage("OpenAI"),
    };
  }

  const model = payload.model || process.env.OPENAI_VIDEO_MODEL || "sora-2";
  const seconds = String(payload.seconds || process.env.OPENAI_VIDEO_SECONDS || "4");
  const size = payload.size || process.env.OPENAI_VIDEO_SIZE || "720x1280";
  const body = new FormData();
  body.set("model", model);
  body.set("prompt", prompt);
  body.set("seconds", seconds);
  body.set("size", size);

  const response = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });
  const video = await parseResponse(response, "OpenAI video create");

  return {
    ok: true,
    configured: true,
    checkedAt,
    provider: "openai",
    video: openAIVideoJobPayload(video),
  };
}

async function handleVideoStatus(url) {
  const checkedAt = new Date().toISOString();
  const id = String(url.searchParams.get("id") || "").trim();
  const provider = resolveVideoProvider({ provider: url.searchParams.get("provider") }, { preferRequested: true });

  if (!id) {
    throw new Error("Video id is required.");
  }

  if (provider === "xai") {
    return handleXaiVideoStatus({ id, checkedAt });
  }

  return handleOpenAIVideoStatus({ id, checkedAt });
}

async function handleOpenAIVideoStatus({ id, checkedAt }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      message: setupVideoMessage("OpenAI"),
    };
  }

  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const video = await parseResponse(response, "OpenAI video status");
  const payload = openAIVideoJobPayload(video);

  if (payload.status === "completed") {
    payload.localUrl = await downloadOpenAIVideo({ apiKey, id });
  }

  return {
    ok: true,
    configured: true,
    checkedAt,
    provider: "openai",
    video: payload,
  };
}

async function handleXaiVideoCreate({ payload, prompt, checkedAt }) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      message: setupVideoMessage("xAI"),
    };
  }

  const keyStatus = await getXaiApiKeyStatus(apiKey);
  const accessMessage = xaiAccessMessage(keyStatus);
  if (accessMessage) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      provider: "xai",
      message: accessMessage,
    };
  }

  const referenceImages = xaiVideoReferenceImages();
  const model = xaiVideoModel(payload);
  const duration = videoDuration(payload, referenceImages.length ? 10 : 15);
  const aspectRatio = payload.aspectRatio || payload.aspect_ratio || process.env.XAI_VIDEO_ASPECT_RATIO || "9:16";
  const resolution = payload.resolution || process.env.XAI_VIDEO_RESOLUTION || "720p";
  const finalPrompt = referenceImages.length
    ? xaiPromptWithReferenceGuidance(prompt, duration, referenceImages.length)
    : prompt;
  const body = {
    model,
    prompt: finalPrompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
  };
  if (referenceImages.length) {
    body.reference_images = referenceImages;
  }

  const response = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const video = await parseXaiVideoResponse(response, "xAI video create", apiKey);

  return {
    ok: true,
    configured: true,
    checkedAt,
    provider: "xai",
    video: xaiVideoJobPayload(video, {
      prompt,
      model,
      duration,
      aspectRatio,
      resolution,
      referenceImageCount: referenceImages.length,
    }),
  };
}

async function handleXaiVideoStatus({ id, checkedAt }) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      checkedAt,
      message: setupVideoMessage("xAI"),
    };
  }

  const response = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const video = await parseXaiVideoResponse(response, "xAI video status", apiKey);
  const payload = xaiVideoJobPayload(video, { id });

  if (payload.status === "completed" && payload.videoUrl) {
    payload.localUrl = await downloadRemoteVideoUrl({
      id: payload.id,
      provider: "xai",
      sourceUrl: payload.videoUrl,
    }).catch(() => "");
  }

  return {
    ok: true,
    configured: true,
    checkedAt,
    provider: "xai",
    video: payload,
  };
}

function resolveVideoProvider(payload = {}, options = {}) {
  const requested = normalizeVideoProvider(payload.provider);
  if (options.preferRequested && requested) return requested;

  const configured = normalizeVideoProvider(process.env.VIDEO_PROVIDER);
  if (configured) return configured;

  if (requested) return requested;

  return process.env.XAI_API_KEY ? "xai" : "openai";
}

function normalizeVideoProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider || provider === "auto") return "";
  if (["xai", "grok"].includes(provider)) return "xai";
  if (["openai", "sora"].includes(provider)) return "openai";
  return "";
}

function setupVideoMessage(provider) {
  if (provider === "xAI") {
    return "XAI_API_KEY is required to create videos with xAI. Create an API key in the xAI Console and save it to .env.";
  }
  return "OPENAI_API_KEY is required for OpenAI videos, or set VIDEO_PROVIDER=xai with XAI_API_KEY to use xAI.";
}

function xaiAccessMessage(keyStatus) {
  if (!keyStatus) return "";
  if (keyStatus.team_blocked) {
    return `xAI video is not available yet because the current xAI team is blocked or credits are still activating. Open xAI Console > Billing/API Credits for team ${keyStatus.team_id || "the current team"}, then retry after the team is active.`;
  }
  if (keyStatus.api_key_disabled || keyStatus.api_key_blocked) {
    return "xAI video is not available because this API key is disabled or blocked. Create a new xAI API key and save it to .env.";
  }
  return "";
}

async function parseXaiVideoResponse(response, label, apiKey) {
  try {
    return await parseResponse(response, label);
  } catch (error) {
    if (response.status !== 403) throw error;

    const keyStatus = await getXaiApiKeyStatus(apiKey).catch(() => null);
    const accessMessage = xaiAccessMessage(keyStatus);
    if (accessMessage) {
      throw new Error(`${label}: ${accessMessage}`);
    }

    throw error;
  }
}

async function getXaiApiKeyStatus(apiKey) {
  const response = await fetch("https://api.x.ai/v1/api-key", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return parseResponse(response, "xAI API key status");
}

function xaiVideoModel(payload = {}) {
  const requested = String(payload.model || "").trim();
  if (requested && !/^sora/i.test(requested)) return requested;
  return process.env.XAI_VIDEO_MODEL || "grok-imagine-video";
}

function videoDuration(payload = {}, max = 15) {
  return clampNumber(
    payload.duration || process.env.XAI_VIDEO_DURATION || payload.seconds || process.env.OPENAI_VIDEO_SECONDS || 15,
    1,
    max
  );
}

function xaiVideoReferenceImages() {
  return csv(process.env.XAI_VIDEO_REFERENCE_IMAGES)
    .slice(0, 7)
    .map((imagePath) => xaiReferenceImage(imagePath))
    .filter(Boolean);
}

function xaiReferenceImage(imagePath) {
  if (/^(https:\/\/|data:image\/)/i.test(imagePath)) {
    return { url: imagePath };
  }

  const resolvedPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(root, imagePath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) return null;

  const bytes = fs.readFileSync(resolvedPath);
  return {
    url: `data:${imageMimeType(resolvedPath)};base64,${bytes.toString("base64")}`,
  };
}

function imageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function xaiPromptWithReferenceGuidance(prompt, duration, referenceImageCount) {
  const sourcePrompt = String(prompt || "")
    .replace(/\b15\s*[-–]\s*20\s*s\b/gi, `${duration}-second`)
    .replace(/\b15\s*[-–]\s*20\s*second[s]?\b/gi, `${duration}-second`)
    .replace(/\b15\s+to\s+20\s+second[s]?\b/gi, `${duration}-second`)
    .replace(/\b20\s*[-–]\s*30\s*s\b/gi, `${duration}-second`)
    .replace(/\b20\s*[-–]\s*30\s*second[s]?\b/gi, `${duration}-second`)
    .replace(/\b30\s*[-–]\s*45\s*s\b/gi, `${duration}-second`)
    .replace(/\b30\s*[-–]\s*45\s*second[s]?\b/gi, `${duration}-second`);

  return `Create a ${duration}-second vertical 9:16 AI video preview for Jenny Jun, a North Dallas real estate advisor. This is a short preview, not a longer full-length reel.

Use the ${referenceImageCount} provided Jenny Jun reference images to preserve Jenny's likeness: same adult woman, warm smile, dark voluminous shoulder-length hair, polished professional real estate presence, navy wardrobe styling, and natural facial proportions. Keep her consistent across shots and avoid changing age, hairstyle, ethnicity, or facial structure.

Use a simple 3-beat structure that can finish cleanly in ${duration} seconds:
1) 0-3s: Jenny on camera, friendly and confident, one concise hook.
2) 3-7s: quick real estate b-roll or one visual example supporting the hook.
3) 7-${duration}s: Jenny back on camera with one short CTA.

Keep narration under 22 words total. Do not try to include every detail from the longer planning prompt. No fake listings, prices, testimonials, market stats, or claims of real recorded footage.

Source planning prompt to adapt:
${sourcePrompt}`;
}

function openAIVideoJobPayload(video) {
  return {
    id: video.id || "",
    provider: "openai",
    model: video.model || "",
    status: video.status || "",
    progress: number(video.progress),
    seconds: video.seconds || "",
    size: video.size || "",
    prompt: video.prompt || "",
    error: video.error?.message || video.error || "",
    createdAt: video.created_at ? new Date(Number(video.created_at) * 1000).toISOString() : "",
    completedAt: video.completed_at ? new Date(Number(video.completed_at) * 1000).toISOString() : "",
    expiresAt: video.expires_at ? new Date(Number(video.expires_at) * 1000).toISOString() : "",
  };
}

function xaiVideoJobPayload(video, context = {}) {
  const result = video.video || {};
  const status = normalizeXaiVideoStatus(video.status);
  const duration = result.duration || video.duration || context.duration || "";
  const id = video.request_id || video.id || context.id || "";

  return {
    id,
    provider: "xai",
    model: video.model || context.model || process.env.XAI_VIDEO_MODEL || "grok-imagine-video",
    status,
    progress: xaiVideoProgress(video, status),
    seconds: duration ? String(duration) : "",
    duration: duration ? Number(duration) : "",
    aspectRatio: video.aspect_ratio || context.aspectRatio || process.env.XAI_VIDEO_ASPECT_RATIO || "9:16",
    resolution: video.resolution || context.resolution || process.env.XAI_VIDEO_RESOLUTION || "720p",
    size: "",
    prompt: video.prompt || context.prompt || "",
    videoUrl: result.url || video.url || "",
    localUrl: "",
    referenceImageCount: context.referenceImageCount || number(video.reference_image_count),
    error: video.error?.message || video.error || "",
    createdAt: video.created_at ? toIsoTime(video.created_at) : "",
    completedAt: status === "completed" ? new Date().toISOString() : "",
    expiresAt: result.expires_at ? toIsoTime(result.expires_at) : "",
  };
}

function normalizeXaiVideoStatus(status) {
  const value = String(status || "pending").toLowerCase();
  if (["done", "completed", "succeeded", "success"].includes(value)) return "completed";
  if (["running", "processing", "in_progress"].includes(value)) return "in_progress";
  if (["failed", "error"].includes(value)) return "failed";
  if (value === "expired") return "expired";
  return "queued";
}

function xaiVideoProgress(video, status) {
  const progress = number(video.progress);
  if (progress) return progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
  if (status === "completed") return 100;
  return 0;
}

async function downloadOpenAIVideo({ apiKey, id }) {
  const dir = generatedVideoDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${safeFileName(id)}.mp4`);
  const localUrl = `/generated-videos/${path.basename(filePath)}`;

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return localUrl;
  }

  const response = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(id)}/content`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `OpenAI video download failed with HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return localUrl;
}

async function downloadRemoteVideoUrl({ sourceUrl, id, provider }) {
  const dir = generatedVideoDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${safeFileName(`${provider}-${id}`)}.mp4`);
  const localUrl = `/generated-videos/${path.basename(filePath)}`;

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return localUrl;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `${provider} video download failed with HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return localUrl;
}

function generatedVideoDir() {
  return path.resolve(
    root,
    process.env.VIDEO_OUTPUT_DIR || process.env.OPENAI_VIDEO_OUTPUT_DIR || "content-strategy/videos"
  );
}

function safeFileName(value) {
  return String(value || "video").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 120);
}

async function handleIdeaGenerate(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  const checkedAt = new Date().toISOString();

  if (apiKey) {
    return generateIdeaWithOpenAIApi({ apiKey, checkedAt, payload });
  }

  if (hasCodexChatGptAuth()) {
    return generateIdeaWithCodexCli({ checkedAt, payload });
  }

  return {
    ok: false,
    configured: false,
    checkedAt,
    message:
      "No AI credential is configured. Add OPENAI_API_KEY to .env or sign in with Codex so ~/.codex/auth.json is available.",
  };
}

async function generateIdeaWithOpenAIApi({ apiKey, checkedAt, payload }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: ideaGenerationInstructions(),
      input: JSON.stringify(ideaGenerationContext(payload)),
      max_output_tokens: numberFromEnv("OPENAI_IDEA_MAX_OUTPUT_TOKENS", 900, 300, 4000),
    }),
  });

  const data = await parseResponse(response, "OpenAI idea generation");
  const text = extractOpenAIText(data);
  const idea = parseGeneratedIdea(text);

  return {
    ok: true,
    configured: true,
    checkedAt,
    authMode: "openai_api_key",
    model: data.model || model,
    idea,
  };
}

async function generateIdeaWithCodexCli({ checkedAt, payload }) {
  const model = process.env.CODEX_IDEA_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const outputPath = path.join(os.tmpdir(), `jennyscontents-codex-idea-${crypto.randomUUID()}.txt`);
  const schemaPath = path.join(os.tmpdir(), `jennyscontents-codex-idea-schema-${crypto.randomUUID()}.json`);

  fs.writeFileSync(schemaPath, JSON.stringify(ideaOutputSchema(), null, 2));

  try {
    const result = await spawnWithInput(
      process.env.CODEX_BIN || "codex",
      [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--color",
        "never",
        "-C",
        root,
        "-m",
        model,
        "-c",
        'model_reasoning_effort="low"',
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        "-",
      ],
      codexIdeaPrompt(payload),
      {
        cwd: root,
        timeout: numberFromEnv("CODEX_IDEA_TIMEOUT_MS", 120000, 30000, 300000),
        maxBuffer: 2_000_000,
      }
    );

    const text = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : result.stdout || result.stderr;
    const idea = parseGeneratedIdea(text);
    return {
      ok: true,
      configured: true,
      checkedAt,
      authMode: "codex_oauth",
      model,
      idea,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      checkedAt,
      authMode: "codex_oauth",
      message: `Codex OAuth idea generation failed: ${error.message}`,
    };
  } finally {
    safeUnlink(outputPath);
    safeUnlink(schemaPath);
  }
}

function hasCodexChatGptAuth() {
  const authPath = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), ".codex", "auth.json");
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    return Boolean(
      auth.auth_mode === "chatgpt" && auth.tokens?.access_token && auth.tokens?.account_id
    );
  } catch {
    return false;
  }
}

function codexIdeaPrompt(payload) {
  return `${ideaGenerationInstructions()}

Use only the JSON context below. Do not inspect the filesystem, do not run shell commands, and do not modify files.

JSON context:
${JSON.stringify(
  ideaGenerationContext(payload, {
    postLimit: numberFromEnv("CODEX_IDEA_POST_LIMIT", 4, 2, 10),
    captionLimit: numberFromEnv("CODEX_IDEA_CAPTION_LIMIT", 240, 120, 500),
  }),
  null,
  2
)}`;
}

function ideaOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "hook", "format", "caption", "cta", "videoPrompt", "why", "sourceSignals"],
    properties: {
      title: { type: "string" },
      hook: { type: "string" },
      format: { type: "string" },
      caption: { type: "string" },
      cta: { type: "string" },
      videoPrompt: { type: "string" },
      why: { type: "string" },
      sourceSignals: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function spawnWithInput(command, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const startedAt = Date.now();

    const timeout = setTimeout(() => {
      if (finished) return;
      child.kill("SIGTERM");
      reject(new Error(`Codex CLI timed out after ${Date.now() - startedAt}ms.`));
    }, options.timeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > options.maxBuffer) {
        child.kill("SIGTERM");
        reject(new Error("Codex CLI stdout exceeded the local buffer limit."));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        reject(new Error("Codex CLI stderr exceeded the local buffer limit."));
      }
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = String(stderr || stdout || signal || "").trim();
      reject(new Error(detail || `Codex CLI exited with code ${code}.`));
    });

    child.stdin.end(input);
  });
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore temp-file cleanup failures.
  }
}

function ideaGenerationInstructions() {
  return `You are a practical content strategist for a North Dallas and DFW real estate agent.
Analyze the provided social post captions and metrics. Create one concrete filming idea that Jenny can film today.

Rules:
- Do not return vague placeholders like "fix this first" unless you define exactly what "this" is.
- Use the posts as evidence for the hook pattern, topic, and format, but do not claim facts that are not in the posts.
- Make the idea specific to DFW, North Dallas, buyers, sellers, or relocating families.
- Respect the focus field. If it asks for buyer-only or seller-only content, keep the idea in that audience lane. If it asks for a carousel/talking-head/B-roll mix, choose the format that best fits the requested mix.
- The format must include concrete shots or steps Jenny can film in under 45 minutes.
- The CTA must be practical for a real estate lead.
- The videoPrompt must be ready to paste into an AI video model. Default to a 10-second vertical preview for xAI/reference-image generation, unless the source pattern clearly requires a longer walkthrough.
- The videoPrompt should specify duration, aspect ratio, visual style, scene order, camera movement, on-screen text, voiceover or narration, and brand-safe constraints.
- Do not ask the video model to invent fake listings, fake prices, fake client testimonials, or exact market facts not present in the context.
- Return only valid JSON with these fields: title, hook, format, caption, cta, videoPrompt, why, sourceSignals.`;
}

function ideaGenerationContext(payload, options = {}) {
  const media = Array.isArray(payload.media) ? payload.media : [];
  const recent = media.filter(isRecentSignalMedia);
  const sorted = [...(recent.length ? recent : media)].sort((a, b) => number(b.score) - number(a.score));
  const postLimit =
    options.postLimit || numberFromEnv("IDEA_GENERATION_POST_LIMIT", 8, 3, 20);
  const captionLimit =
    options.captionLimit || numberFromEnv("IDEA_GENERATION_CAPTION_LIMIT", 360, 120, 900);

  return {
    brand: payload.brand || "Jun Residential Group",
    market: payload.market || process.env.CONTENT_MARKET || "North Dallas and DFW",
    audience: payload.audience || "buyers, sellers, and relocating families",
    primaryCta: payload.primaryCta || "DM me 'DFW' for the North Dallas guide",
    focus: payload.focus || "3 reels I can film in under 45 minutes",
    source: payload.sourceLabel || payload.sourceId || "social signals",
    analysis: {
      retrievedCount: number(payload.retrievedCount),
      recentCount: number(payload.recentCount),
      hookPatterns: payload.hookPatterns || [],
      topicCategories: payload.topicCategories || [],
      formatMix: payload.formatMix || [],
    },
    posts: sorted.slice(0, postLimit).map((item, index) => ({
      rank: index + 1,
      source: item.source || "",
      hashtag: item.hashtag || "",
      format: item.format || "",
      score: number(item.score),
      views: number(item.views),
      likes: number(item.likes),
      comments: number(item.comments),
      saves: number(item.saves),
      shares: number(item.shares),
      hookPattern: item.hookPattern || "",
      topicCategory: item.topicCategory || "",
      caption: truncate(String(item.caption || ""), captionLimit),
    })),
  };
}

function extractOpenAIText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }

  const text = chunks.join("\n").trim();
  if (!text) {
    throw new Error("OpenAI response did not include text output.");
  }
  return text;
}

function parseGeneratedIdea(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed;

  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = parseLastJsonObject(clean);
  }

  const idea = {
    title: truncate(parsed.title, 90),
    hook: truncate(parsed.hook, 160),
    format: truncate(parsed.format, 650),
    caption: truncate(parsed.caption, 900),
    cta: truncate(parsed.cta, 180),
    videoPrompt: truncate(parsed.videoPrompt, 1600),
    why: truncate(parsed.why, 500),
    sourceSignals: Array.isArray(parsed.sourceSignals)
      ? parsed.sourceSignals.map((item) => truncate(item, 140)).filter(Boolean).slice(0, 5)
      : [],
  };

  const missing = ["title", "hook", "format", "caption", "cta", "videoPrompt", "why"].filter((key) => !idea[key]);
  if (missing.length) {
    throw new Error(`OpenAI idea response is missing ${missing.join(", ")}.`);
  }

  return idea;
}

function parseLastJsonObject(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].replace(/^codex\s*/i, "").trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Continue searching earlier lines.
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("OpenAI response was not valid JSON.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function maybeUploadBriefToDrive(filePath, content) {
  if (!truthy(process.env.GOOGLE_DRIVE_UPLOAD)) {
    return { uploaded: false, reason: "GOOGLE_DRIVE_UPLOAD is not true" };
  }

  const required = [
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
    "GOOGLE_DRIVE_CONTENT_FOLDER_ID",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    return { uploaded: false, reason: `missing ${missing.join(", ")}` };
  }

  const accessToken = await getGoogleAccessToken();
  const boundary = `jennyscontents-${Date.now()}`;
  const metadata = {
    name: path.basename(filePath),
    parents: [process.env.GOOGLE_DRIVE_CONTENT_FOLDER_ID],
    mimeType: "text/markdown",
  };

  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: text/markdown; charset=UTF-8",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const uploadUrl = new URL("https://www.googleapis.com/upload/drive/v3/files");
  uploadUrl.searchParams.set("uploadType", "multipart");
  uploadUrl.searchParams.set("fields", "id,name,webViewLink");

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  return { uploaded: true, ...(await parseResponse(response, "Google Drive upload")) };
}

async function getGoogleAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const payload = await parseResponse(response, "Google Drive token refresh");
  if (!payload.access_token) {
    throw new Error("Google Drive token refresh did not return an access token.");
  }
  return payload.access_token;
}

async function getJson(url, headers = {}, label = "") {
  const response = await fetchWithTimeout(url, { headers }, label || "API request");
  return parseResponse(response, label);
}

async function postJson(url, headers = {}, body = {}, label = "") {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, label || "API request");
  return parseResponse(response, label);
}

async function fetchWithTimeout(url, options = {}, label = "API request") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiFetchTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label}: timed out after ${Math.round(apiFetchTimeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponse(response, label) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const apiError = data.error && data.error.code !== "ok";
  if (!response.ok || apiError) {
    const message =
      data.error_description ||
      data.error?.message ||
      data.error?.code ||
      data.message ||
      data.detail ||
      `HTTP ${response.status}`;
    throw new Error(`${label ? `${label}: ` : ""}${message}`);
  }

  return data;
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

function envPath() {
  return path.join(root, ".env");
}

function upsertEnvValues(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  const updated = lines.map((line) => {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trim().startsWith("#")) return line;

    const key = line.slice(0, eq).trim();
    if (!Object.hasOwn(values, key)) return line;

    seen.add(key);
    return `${key}=${quoteEnvValue(values[key])}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      updated.push(`${key}=${quoteEnvValue(value)}`);
    }
  }

  fs.writeFileSync(file, `${updated.join("\n").replace(/\n*$/, "")}\n`);
}

function quoteEnvValue(value) {
  const text = String(value || "");
  if (!text || /[\s#'"]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function instagramAuthMode() {
  const mode = String(process.env.INSTAGRAM_AUTH_MODE || "instagram_login")
    .toLowerCase()
    .replace(/[-\s]/g, "_");

  if (["instagram", "instagram_login"].includes(mode)) return "instagram_login";
  if (["facebook", "facebook_login", "facebook_login_for_business"].includes(mode)) {
    return "facebook_login";
  }

  return "instagram_login";
}

function instagramProfileFields(authMode) {
  if (authMode === "facebook_login") {
    return "id,username,media_count";
  }

  return "id,username,account_type,media_count";
}

function instagramFormat(item) {
  if (item.media_product_type === "REELS") return "reel";
  if (item.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (item.media_type === "VIDEO") return "video";
  return "post";
}

function latestInsightValue(row) {
  const values = row.values || [];
  const last = values[values.length - 1];
  return number(last?.value);
}

function scoreMedia(item) {
  const age = item.timestamp ? daysAgo(item.timestamp) : 7;
  const recencyMultiplier = age <= 7 ? 1.25 : 1;
  const engagement =
    item.likes + item.comments * 3 + item.shares * 6 + item.saves * 6 + item.views * 0.02;
  return Math.round(engagement * recencyMultiplier);
}

function inferHookPattern(textValue) {
  const text = String(textValue || "").toLowerCase();
  if (/\b(3|5|seven|three|five)\b/.test(text)) return "specific numbered checklist";
  if (/\b(don't|do not|not buy|mistake|avoid|stop)\b/.test(text)) return "contrarian warning";
  if (/\b(before|after)\b/.test(text)) return "before-after setup";
  if (/\b(cost|payment|rate|afford|price|budget)\b/.test(text)) return "affordability hook";
  if (/\b(secret|nobody|most people|surprises)\b/.test(text)) return "curiosity gap";
  if (/\b(tour|walkthrough|inside|feature)\b/.test(text)) return "visual reveal";
  if (text.includes("?")) return "question-led";
  return "direct advice";
}

function inferTopicCategory(textValue) {
  const text = String(textValue || "").toLowerCase();
  if (/\b(sell|seller|listing|list|staging|photos)\b/.test(text)) return "seller prep";
  if (/\b(market|inventory|price cut|days on market|rate|rates)\b/.test(text)) return "local market";
  if (/\b(move|moving|relocat|neighborhood|suburb|commute)\b/.test(text)) return "relocation";
  if (/\b(tour|walkthrough|open house|kitchen|bedroom|bath|feature)\b/.test(text)) {
    return "property tour";
  }
  return "buyer education";
}

function isRelevantInstagramMedia(item) {
  if (["owned_media", "owned_video"].includes(item.source)) return true;

  const caption = String(item.caption || "");
  const body = caption.replace(/#[a-z0-9_]+/gi, " ").toLowerCase();
  const fullText = caption.toLowerCase();

  if (!isMostlyLatinText(caption)) return false;
  if (/\b(giveaway|hockey|donald trump|breaking news|tcas|university admissions?)\b/.test(body)) {
    return false;
  }

  const strongRealEstate =
    /\b(real estate|realtor|realty|broker|agent|mls|homebuyer|home buyer|homeseller|home seller|mortgage|lender|loan|down payment|closing cost|escrow|appraisal|inspection|property tax|hoa)\b/.test(
      body
    );
  const propertySignal =
    /\b(home|homes|house|houses|property|properties|condo|condos|townhome|townhomes|townhouse|townhouses|listing|listings|listed|sold|lease|rental|rent|kitchen|bedroom|bathroom|garage|backyard|floor plan|renovation|development opportunity|new construction)\b/.test(
      body
    );
  const transactionSignal =
    /\b(buy|buyer|buyers|sell|seller|sellers|offer|showing|showings|house hunting|open house|move-in|neighborhood|suburb|relocat|inventory|price cut|days on market|rate|rates|afford|budget)\b/.test(
      body
    );
  const localSignal =
    /\b(dfw|dallas|north dallas|plano|frisco|mckinney|allen|prosper|celina|richardson|addison|carrollton|collin county|denton county|tarrant county)\b/.test(
      fullText
    );

  return strongRealEstate || (propertySignal && (transactionSignal || localSignal));
}

function isMostlyLatinText(value) {
  const letters = String(value || "").match(/\p{L}/gu) || [];
  if (letters.length < 20) return true;
  const latinLetters = String(value || "").match(/[A-Za-z]/g) || [];
  return latinLetters.length / letters.length >= 0.65;
}

function topCounts(items) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function daysAgo(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / 86_400_000;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function toIsoTime(value) {
  const text = String(value || "");
  const numeric = Number(text);
  const timestamp = Number.isFinite(numeric) && text.length <= 10 ? numeric * 1000 : Date.parse(text);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

function truncate(value, limit) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
