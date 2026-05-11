import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");

loadEnv(path.join(root, ".env"));

const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";

const checks = [
  ["X", Boolean(process.env.X_BEARER_TOKEN), checkX],
  ["Instagram", Boolean(process.env.INSTAGRAM_ACCESS_TOKEN), checkInstagram],
  ["TikTok", Boolean(process.env.TIKTOK_ACCESS_TOKEN), checkTikTok],
];

let failures = 0;

for (const [name, configured, fn] of checks) {
  if (!configured) {
    console.log(`SKIP ${name}: token not configured.`);
    continue;
  }

  try {
    const summary = await fn();
    console.log(`OK   ${name}: ${summary}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
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

  const user = await getJson(userUrl, {
    Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
  });

  const searchUrl = new URL("https://api.x.com/2/tweets/search/recent");
  searchUrl.searchParams.set(
    "query",
    '("real estate" OR realtor OR homebuyer OR homeseller) lang:en -is:retweet'
  );
  searchUrl.searchParams.set("max_results", "10");
  searchUrl.searchParams.set("tweet.fields", "created_at,public_metrics,author_id,text");
  searchUrl.searchParams.set("expansions", "author_id");
  searchUrl.searchParams.set("user.fields", "username,public_metrics,verified");

  const search = await getJson(searchUrl, {
    Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`,
  });

  const count = search.data?.length || 0;
  return `connected as @${user.data?.username || username}; recent search returned ${count} posts`;
}

async function checkInstagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID || "me";

  const meUrl = new URL(`https://graph.instagram.com/${graphVersion}/${userId}`);
  meUrl.searchParams.set("fields", "id,username,account_type,media_count");
  meUrl.searchParams.set("access_token", token);

  const me = await getJson(meUrl);

  const mediaUrl = new URL(`https://graph.instagram.com/${graphVersion}/${me.id}/media`);
  mediaUrl.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count"
  );
  mediaUrl.searchParams.set("limit", "5");
  mediaUrl.searchParams.set("access_token", token);

  const media = await getJson(mediaUrl);
  const count = media.data?.length || 0;

  return `connected as @${me.username || process.env.INSTAGRAM_USERNAME || me.id}; media returned ${count} items`;
}

async function checkTikTok() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;

  const userUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
  userUrl.searchParams.set(
    "fields",
    [
      "open_id",
      "username",
      "display_name",
      "bio_description",
      "profile_deep_link",
      "follower_count",
      "following_count",
      "likes_count",
      "video_count",
    ].join(",")
  );

  const user = await getJson(userUrl, {
    Authorization: `Bearer ${token}`,
  });

  const listUrl = new URL("https://open.tiktokapis.com/v2/video/list/");
  listUrl.searchParams.set(
    "fields",
    "id,create_time,share_url,video_description,duration,like_count,comment_count,share_count,view_count"
  );
  listUrl.searchParams.set("max_count", "10");

  const videos = await postJson(
    listUrl,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    {}
  );

  const profile = user.data?.user || {};
  const count = videos.data?.videos?.length || 0;
  return `connected as @${profile.username || process.env.TIKTOK_USERNAME || profile.display_name || "unknown"}; video list returned ${count} items`;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  return parseResponse(response);
}

async function postJson(url, headers = {}, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok || data.error?.code) {
    const message =
      data.error?.message ||
      data.title ||
      data.detail ||
      data.message ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}
