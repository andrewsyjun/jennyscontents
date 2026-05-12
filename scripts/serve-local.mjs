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
  console.log(`TikTok callback: http://${host}:${port}/auth/tiktok/callback`);
});

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
    media.push(normalizeInstagramMedia({ item, insights }));
  }

  if (truthy(process.env.INSTAGRAM_HASHTAG_DISCOVERY)) {
    if (authMode === "facebook_login") {
      sourceStatus.push("Instagram hashtag discovery is enabled for the strategy runner.");
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

function normalizeInstagramMedia({ item, insights }) {
  const caption = String(item.caption || "");
  const media = {
    id: item.id,
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
