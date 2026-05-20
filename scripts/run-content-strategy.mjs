import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

loadEnv(envPath);

let options;

try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR ${error.message}`);
  printHelp();
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const runDate = options.date ? parseDate(options.date) : new Date();
const runDateKey = formatDateKey(runDate);
const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const market = process.env.CONTENT_MARKET || "North Dallas and DFW";
const warnings = [];
const sourceStatus = [];

const records = [
  ...(await collectInstagram()),
  ...(await collectTikTok()),
  ...(await collectX()),
  ...loadManualTrends(),
];

const report = buildReport(records);
const outputDir = path.resolve(root, process.env.CONTENT_OUTPUT_DIR || "content-strategy");
fs.mkdirSync(outputDir, { recursive: true });

const outputPath = path.join(outputDir, `${runDateKey}-content-strategy.md`);
fs.writeFileSync(outputPath, report);

console.log(`Wrote ${path.relative(root, outputPath)}`);

if (!options.noDrive) {
  const uploadResult = await maybeUploadToDrive(outputPath, report);
  if (uploadResult.uploaded) {
    console.log(`Uploaded to Google Drive: ${uploadResult.webViewLink || uploadResult.id}`);
  } else {
    console.log(`Skipped Google Drive upload: ${uploadResult.reason}`);
  }
}

async function collectInstagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID || "me";

  if (!token) {
    sourceStatus.push("Instagram skipped: INSTAGRAM_ACCESS_TOKEN is not configured.");
    return [];
  }

  const authMode = instagramAuthMode();
  const graphHost = authMode === "facebook_login" ? "graph.facebook.com" : "graph.instagram.com";
  const rows = [];

  try {
    const mediaUrl = new URL(`https://${graphHost}/${graphVersion}/${userId}/media`);
    mediaUrl.searchParams.set(
      "fields",
      "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count"
    );
    mediaUrl.searchParams.set("limit", "25");
    mediaUrl.searchParams.set("access_token", token);

    const media = await getJson(mediaUrl, {}, "Instagram owned media");
    const items = Array.isArray(media.data) ? media.data : [];
    sourceStatus.push(`Instagram owned media: ${items.length} item(s) returned.`);

    for (const item of items) {
      const insights = await getInstagramInsights({
        authMode,
        graphHost,
        mediaId: item.id,
        token,
      });

      rows.push(
        normalizeRecord({
          platform: "instagram",
          source: "owned_media",
          post_id: item.id,
          url: item.permalink,
          created_at: item.timestamp,
          caption_or_text: item.caption || "",
          format: instagramFormat(item),
          views: insights.views || insights.plays || insights.reach || 0,
          likes: item.like_count || insights.likes || 0,
          comments: item.comments_count || insights.comments || 0,
          shares: insights.shares || 0,
          saves: insights.saved || insights.saves || 0,
          raw_metrics: insights,
        })
      );
    }
  } catch (error) {
    warnings.push(`Instagram owned media failed: ${error.message}`);
  }

  if (truthy(process.env.INSTAGRAM_HASHTAG_DISCOVERY)) {
    rows.push(...(await collectInstagramHashtags({ token, userId, authMode })));
  } else {
    sourceStatus.push("Instagram hashtag discovery skipped: INSTAGRAM_HASHTAG_DISCOVERY is false.");
  }

  return rows;
}

async function collectInstagramHashtags({ token, userId, authMode }) {
  if (authMode !== "facebook_login") {
    sourceStatus.push("Instagram hashtag discovery skipped: it requires INSTAGRAM_AUTH_MODE=facebook_login.");
    return [];
  }

  const tags = csv(process.env.INSTAGRAM_HASHTAGS).slice(0, 30);
  const limit = numberFromEnv("INSTAGRAM_HASHTAG_LIMIT", 5, 1, 25);
  const rows = [];

  for (const tag of tags) {
    try {
      const searchUrl = new URL(`https://graph.facebook.com/${graphVersion}/ig_hashtag_search`);
      searchUrl.searchParams.set("user_id", userId);
      searchUrl.searchParams.set("q", tag.replace(/^#/, ""));
      searchUrl.searchParams.set("access_token", token);

      const search = await getJson(searchUrl, {}, `Instagram hashtag ${tag}`);
      const hashtagId = search.data?.[0]?.id;
      if (!hashtagId) continue;

      const topUrl = new URL(`https://graph.facebook.com/${graphVersion}/${hashtagId}/top_media`);
      topUrl.searchParams.set("user_id", userId);
      topUrl.searchParams.set(
        "fields",
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count"
      );
      topUrl.searchParams.set("limit", String(limit));
      topUrl.searchParams.set("access_token", token);

      const top = await getJson(topUrl, {}, `Instagram hashtag top_media ${tag}`);
      const items = Array.isArray(top.data) ? top.data : [];
      let kept = 0;
      let dropped = 0;

      for (const item of items) {
        const record = normalizeRecord({
          platform: "instagram",
          source: "hashtag_top_media",
          post_id: item.id,
          url: item.permalink,
          created_at: item.timestamp,
          caption_or_text: item.caption || "",
          format: instagramFormat(item),
          likes: item.like_count || 0,
          comments: item.comments_count || 0,
          hashtag: tag,
        });

        if (!isRelevantInstagramRecord(record)) {
          dropped += 1;
          continue;
        }

        kept += 1;
        rows.push(record);
      }

      sourceStatus.push(`Instagram #${tag}: ${kept}/${items.length} real estate top media item(s) kept.`);
      if (dropped) {
        sourceStatus.push(`Instagram #${tag}: ${dropped} unrelated top media item(s) filtered out.`);
      }
    } catch (error) {
      warnings.push(`Instagram hashtag #${tag} failed: ${error.message}`);
    }
  }

  return rows;
}

async function getInstagramInsights({ authMode, graphHost, mediaId, token }) {
  const metrics = csv(process.env.INSTAGRAM_INSIGHT_METRICS || "views,reach,saved,shares");
  const insights = {};

  for (const metric of metrics) {
    try {
      const insightUrl = new URL(`https://${graphHost}/${graphVersion}/${mediaId}/insights`);
      insightUrl.searchParams.set("metric", metric);
      insightUrl.searchParams.set("access_token", token);

      const payload = await getJson(insightUrl, {}, `Instagram insight ${metric}`);
      for (const row of payload.data || []) {
        insights[row.name] = latestInsightValue(row);
      }
    } catch {
      // Instagram exposes different insight metrics by account mode and media type.
      // Missing metrics are expected; keep the report running with available data.
    }
  }

  return insights;
}

async function collectTikTok() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;

  if (!token) {
    sourceStatus.push("TikTok skipped: TIKTOK_ACCESS_TOKEN is not configured.");
    return [];
  }

  try {
    const listUrl = new URL("https://open.tiktokapis.com/v2/video/list/");
    listUrl.searchParams.set(
      "fields",
      "id,create_time,share_url,video_description,duration,like_count,comment_count,share_count,view_count"
    );

    const payload = await postJson(
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

    const videos = payload.data?.videos || [];
    sourceStatus.push(`TikTok owned videos: ${videos.length} item(s) returned.`);

    return videos.map((video) =>
      normalizeRecord({
        platform: "tiktok",
        source: "owned_video",
        post_id: video.id,
        url: video.share_url,
        created_at: video.create_time ? new Date(Number(video.create_time) * 1000).toISOString() : "",
        caption_or_text: video.video_description || "",
        format: "short_video",
        views: video.view_count || 0,
        likes: video.like_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
      })
    );
  } catch (error) {
    warnings.push(`TikTok owned videos failed: ${error.message}`);
    return [];
  }
}

async function collectX() {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    sourceStatus.push("X skipped: X_BEARER_TOKEN is not configured.");
    return [];
  }

  try {
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
    const posts = payload.data || [];
    const rows = [];
    let dropped = 0;

    for (const post of posts) {
      const author = users.get(post.author_id) || {};
      const metrics = post.public_metrics || {};
      const record = normalizeRecord({
        platform: "x",
        source: "x_recent_search",
        post_id: post.id,
        url: author.username ? `https://x.com/${author.username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`,
        created_at: post.created_at,
        caption_or_text: post.text || "",
        format: "post",
        views: metrics.impression_count || 0,
        likes: metrics.like_count || 0,
        comments: metrics.reply_count || 0,
        shares: (metrics.retweet_count || 0) + (metrics.quote_count || 0),
      });

      if (!isRelevantInstagramRecord(record)) {
        dropped += 1;
        continue;
      }

      rows.push(record);
    }

    sourceStatus.push(`X recent search: ${rows.length}/${posts.length} real estate post(s) kept.`);
    if (dropped) {
      sourceStatus.push(`X recent search: ${dropped} unrelated post(s) filtered out.`);
    }
    return rows;
  } catch (error) {
    warnings.push(`X recent search failed: ${error.message}`);
    return [];
  }
}

function loadManualTrends() {
  const manualFile = path.resolve(root, process.env.MANUAL_TRENDS_FILE || "data/manual-trends.json");
  if (!fs.existsSync(manualFile)) {
    sourceStatus.push("Manual trends skipped: data/manual-trends.json not found.");
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(manualFile, "utf8"));
    const items = Array.isArray(payload) ? payload : payload.items || [];
    sourceStatus.push(`Manual trends: ${items.length} item(s) loaded.`);
    return items.map((item) => normalizeRecord({ source: "manual_research", ...item }));
  } catch (error) {
    warnings.push(`Manual trends failed: ${error.message}`);
    return [];
  }
}

function buildReport(allRecords) {
  const records = allRecords
    .filter((record) => record.created_at ? daysAgo(record.created_at) <= 30 : true)
    .map((record) => ({
      ...record,
      score: scoreRecord(record),
      hook_pattern: inferHookPattern(record),
      topic_category: inferTopicCategory(record),
    }))
    .sort((a, b) => b.score - a.score);

  const recentRecords = records.filter((record) => record.created_at && daysAgo(record.created_at) <= 7);
  const strategyInputs = recentRecords.length ? recentRecords : records;
  const topRecords = strategyInputs.slice(0, 12);
  const patterns = topCounts(topRecords.map((record) => record.hook_pattern));
  const topics = topCounts(topRecords.map((record) => record.topic_category));
  const ideas = generateIdeas({ patterns, topics, topRecords });
  const analyticsNotes = readOptionalText(process.env.CONTENT_ANALYTICS_FILE || "data/analytics-notes.md");

  return `# Daily Content Strategy - ${runDateKey}

Market: ${market}

## Summary

${summaryLine(strategyInputs, allRecords)}

## Source Status

${sourceStatus.map((line) => `- ${line}`).join("\n") || "- No sources checked."}

${warnings.length ? `## Warnings\n\n${warnings.map((line) => `- ${line}`).join("\n")}\n\n` : ""}## What Is Working

Hook patterns:

${renderCounts(patterns)}

Topic categories:

${renderCounts(topics)}

Top available examples:

${renderTopRecords(topRecords)}

## 3 Reel Ideas To Film Today

${ideas.map(renderIdea).join("\n\n")}

## Prompt 3 Input

\`\`\`text
CONTENT STRATEGY
Search Instagram and TikTok for the top performing real estate reels and carousels of the last 7 days.
Identify the hook patterns getting saves and shares, the format structures, and the topic categories resonating.
Give me 3 reel ideas to film today. Each idea should include the hook, the format, the caption draft, and the CTA.
Save to my Drive in the Content folder.
\`\`\`

## Own Analytics Notes

${analyticsNotes || "_No local analytics notes file found. Add notes to `data/analytics-notes.md` or set `CONTENT_ANALYTICS_FILE`._"}

## Data Appendix

\`\`\`json
${JSON.stringify(topRecords, null, 2)}
\`\`\`
`;
}

function summaryLine(strategyInputs, allRecords) {
  if (!allRecords.length) {
    return "No API or manual trend records were available. The ideas below use default real estate content patterns and should be updated after tokens or manual trend examples are added.";
  }

  if (!strategyInputs.length) {
    return "Records were available, but none were dated in the last 7 days. The ideas below use the most recent available records.";
  }

  return `${strategyInputs.length} recent record(s) were available from the last 7 days. Public saves/shares are included only where the source API or manual research provided them.`;
}

function generateIdeas({ patterns, topics, topRecords }) {
  const topicNames = unique([
    ...topics.map(([name]) => name),
    "buyer education",
    "seller prep",
    "local market",
  ]).slice(0, 3);

  return topicNames.map((topic, index) => {
    const pattern = patterns[index]?.[0] || "specific checklist";
    const reference = topRecords[index];
    const template = ideaTemplate(topic, pattern, reference);
    return {
      number: index + 1,
      topic,
      pattern,
      reference,
      ...template,
    };
  });
}

function ideaTemplate(topic, pattern, reference) {
  const sourceNote = reference
    ? `Inspired by the ${reference.platform} ${reference.format} pattern: ${reference.hook_pattern}.`
    : "Use a fast hook, on-screen text, and local proof.";

  if (topic === "seller prep") {
    return {
      hook: `Before you list your home in ${market}, fix these 3 things first`,
      format:
        "Reel: direct-to-camera hook, then 3 quick B-roll cuts of common seller prep issues with on-screen labels.",
      caption:
        `Most sellers focus on the big upgrades, but buyers notice the small signals first. Here are 3 fixes I would handle before photos in ${market}.`,
      cta: "DM me 'PREP' and I will send a quick pre-list checklist.",
      why: sourceNote,
    };
  }

  if (topic === "local market") {
    return {
      hook: `What changed in the ${market} market this week?`,
      format:
        "Reel: one chart or screenshot, one neighborhood B-roll clip, then 3 plain-English takeaways.",
      caption:
        `This week's market is not just about prices. Watch the inventory, days on market, and buyer competition before you decide your next move.`,
      cta: "Comment your city and I will pull the latest local snapshot.",
      why: sourceNote,
    };
  }

  if (topic === "relocation") {
    return {
      hook: `If you're moving to ${market}, this surprises buyers the most`,
      format:
        "Reel: walking neighborhood B-roll with text overlays for commute, schools, taxes, and lifestyle tradeoffs.",
      caption:
        `Relocating buyers usually compare homes first, but the better decision starts with the lifestyle math around the home.`,
      cta: "DM me 'MOVE' for a relocation shortlist.",
      why: sourceNote,
    };
  }

  if (topic === "property tour") {
    return {
      hook: "The feature buyers notice in the first 5 seconds",
      format:
        "Reel: start with the strongest room or exterior angle, then cut to 3 detail shots and explain why each matters.",
      caption:
        "A good tour is not a walkthrough. It is a sequence of buying decisions. Here is what I would point out first.",
      cta: "Save this before your next showing.",
      why: sourceNote,
    };
  }

  return {
    hook: `I would not make an offer in ${market} until I checked this`,
    format:
      "Reel: contrarian hook, quick screen recording or note card, then 3 buyer checks with captions on screen.",
    caption:
      `A strong offer is not just the highest number. These are the checks I would make before writing terms in today's market.`,
    cta: "DM me 'OFFER' before you tour this weekend.",
    why: sourceNote,
  };
}

function renderIdea(idea) {
  const referenceLine = idea.reference?.url ? `\nReference signal: ${idea.reference.url}` : "";
  return `### ${idea.number}. ${titleCase(idea.topic)}

- Hook: ${idea.hook}
- Format: ${idea.format}
- Caption draft: ${idea.caption}
- CTA: ${idea.cta}
- Why this fits: ${idea.why}${referenceLine}`;
}

function renderCounts(counts) {
  if (!counts.length) return "- No ranked patterns available yet.";
  return counts.map(([name, count]) => `- ${name}: ${count}`).join("\n");
}

function renderTopRecords(records) {
  if (!records.length) return "- No records available yet.";

  return records
    .slice(0, 8)
    .map((record, index) => {
      const metrics = [
        ["views", record.views],
        ["likes", record.likes],
        ["comments", record.comments],
        ["shares", record.shares],
        ["saves", record.saves],
      ]
        .filter(([, value]) => Number(value) > 0)
        .map(([label, value]) => `${label} ${value}`)
        .join(", ");
      return `- ${index + 1}. ${record.platform} ${record.format} (${record.source}) - ${record.topic_category}; ${record.hook_pattern}; ${metrics || "no public metrics"}${record.url ? `; ${record.url}` : ""}`;
    })
    .join("\n");
}

function normalizeRecord(record) {
  return {
    platform: record.platform || "manual",
    source: record.source || "unknown",
    post_id: record.post_id || record.id || "",
    url: record.url || "",
    created_at: normalizeDate(record.created_at || record.timestamp || ""),
    caption_or_text: String(record.caption_or_text || record.caption || record.text || ""),
    format: record.format || "unknown",
    views: number(record.views),
    likes: number(record.likes),
    comments: number(record.comments),
    shares: number(record.shares),
    saves: number(record.saves),
    hook_notes: record.hook_notes || "",
    raw_metrics: record.raw_metrics || undefined,
  };
}

function scoreRecord(record) {
  const age = record.created_at ? daysAgo(record.created_at) : 7;
  const recencyMultiplier = age <= 7 ? 1.25 : 1;
  const engagement =
    record.likes + record.comments * 3 + record.shares * 6 + record.saves * 6 + record.views * 0.02;
  return Math.round(engagement * recencyMultiplier);
}

function inferHookPattern(record) {
  const text = `${record.hook_notes || ""} ${record.caption_or_text || ""}`.toLowerCase();
  if (/\b(3|5|seven|three|five)\b/.test(text)) return "specific numbered checklist";
  if (/\b(don't|do not|not buy|mistake|avoid|stop)\b/.test(text)) return "contrarian warning";
  if (/\b(before|after)\b/.test(text)) return "before-after setup";
  if (/\b(cost|payment|rate|afford|price|budget)\b/.test(text)) return "affordability hook";
  if (/\b(secret|nobody|most people|surprises)\b/.test(text)) return "curiosity gap";
  if (/\b(tour|walkthrough|inside|feature)\b/.test(text)) return "visual reveal";
  if (text.includes("?")) return "question-led";
  return "direct advice";
}

function inferTopicCategory(record) {
  const text = `${record.hook_notes || ""} ${record.caption_or_text || ""}`.toLowerCase();
  if (/\b(sell|seller|listing|list|staging|photos)\b/.test(text)) return "seller prep";
  if (/\b(market|inventory|price cut|days on market|rate|rates)\b/.test(text)) return "local market";
  if (/\b(move|moving|relocat|neighborhood|suburb|commute)\b/.test(text)) return "relocation";
  if (/\b(tour|walkthrough|open house|kitchen|bedroom|bath|feature)\b/.test(text)) {
    return "property tour";
  }
  return "buyer education";
}

function isRelevantInstagramRecord(record) {
  if (["owned_media", "owned_video"].includes(record.source)) return true;

  const caption = String(record.caption_or_text || "");
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

async function maybeUploadToDrive(filePath, content) {
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
    warnings.push(`Google Drive upload skipped: missing ${missing.join(", ")}.`);
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

  return parseResponse(response, "Google Drive upload");
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
  const payload = await parseResponse(response, "Google OAuth");
  return payload.access_token;
}

async function getJson(url, headers = {}, label = "") {
  const response = await fetch(url, { headers });
  return parseResponse(response, label);
}

async function postJson(url, headers = {}, body = {}, label = "") {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
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

function parseArgs(args) {
  const parsed = {
    date: "",
    help: false,
    noDrive: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--no-drive") {
      parsed.noDrive = true;
      continue;
    }
    if (arg === "--date") {
      if (!args[index + 1] || args[index + 1].startsWith("-")) {
        throw new Error("--date requires YYYY-MM-DD.");
      }
      parsed.date = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      parsed.date = arg.slice("--date=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run strategy:daily -- [options]

Options:
  --date YYYY-MM-DD  Run for a specific report date.
  --no-drive         Write the local report but skip Google Drive upload.
  --help             Show this help.

Examples:
  npm run strategy:daily
  npm run strategy:daily -- --no-drive
`);
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

function readOptionalText(file) {
  const resolved = path.resolve(root, file);
  return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8").trim() : "";
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function topCounts(items) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }
  return date;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 999;
  return (runDate.getTime() - date.getTime()) / 86400000;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}
