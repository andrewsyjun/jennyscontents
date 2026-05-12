import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(path.join(root, ".env"));

const port = numberFromEnv("LOCAL_PORT", 4173, 1024, 65535);
const host = process.env.LOCAL_HOST || "127.0.0.1";
const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";

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

function facebookLoginScopes() {
  return csv(
    process.env.FACEBOOK_LOGIN_SCOPES ||
      "instagram_basic,pages_show_list,pages_read_engagement,business_management"
  );
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
      <p><a href="/">Return to Jenny's Contents</a></p>
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
    media,
    analysis: analyzeMedia(media),
  };
}

async function collectInstagramHashtags({ token, userId, sourceStatus, warnings }) {
  const tags = csv(process.env.INSTAGRAM_HASHTAGS).slice(0, 30);
  const limit = numberFromEnv("INSTAGRAM_HASHTAG_LIMIT", 5, 1, 25);
  const rows = [];

  if (!tags.length) {
    sourceStatus.push("Instagram hashtag discovery skipped: INSTAGRAM_HASHTAGS is empty.");
    return rows;
  }

  for (const tag of tags) {
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
        continue;
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
      sourceStatus.push(`Instagram #${cleanTag}: ${items.length} top media item(s).`);

      for (const item of items) {
        rows.push(
          normalizeInstagramMedia({
            item,
            insights: {},
            source: "hashtag_top_media",
            hashtag: cleanTag,
          })
        );
      }
    } catch (error) {
      warnings.push(`Instagram hashtag #${tag} failed: ${error.message}`);
    }
  }

  return rows;
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

function analyzeMedia(media) {
  const sorted = [...media].sort((a, b) => b.score - a.score);
  const lastSevenDays = sorted.filter((item) => item.timestamp && daysAgo(item.timestamp) <= 7);
  const strategySet = lastSevenDays.length ? lastSevenDays : sorted;
  const totals = media.reduce(
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
    recentCount: lastSevenDays.length,
    topPosts: strategySet.slice(0, 5),
    hookPatterns: topCounts(strategySet.map((item) => item.hookPattern)),
    topicCategories: topCounts(strategySet.map((item) => item.topicCategory)),
    formatMix: topCounts(strategySet.map((item) => item.format)),
  };
}

function emptyAnalysis() {
  return {
    totals: { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 },
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

async function getJson(url, headers = {}, label = "") {
  const response = await fetch(url, { headers });
  return parseResponse(response, label);
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

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
