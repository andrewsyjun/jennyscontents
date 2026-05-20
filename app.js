const STORAGE_KEY = "jennyscontents.v1";
const SIGNAL_CACHE_KEY = "jennyscontents.signalCache.v1";
const TIKTOK_IMPORT_KEY = "jennyscontents.tiktokImports.v1";
const SAVED_IDEAS_KEY = "jennyscontents.savedIdeas.v1";
const VIDEO_JOBS_KEY = "jennyscontents.videoJobs.v1";
const MAX_SAVED_IDEAS = 40;
const MAX_VIDEO_JOBS = 40;
const REVIEW_TOKEN_KEY = "jennyscontents.facebookReviewToken";
const META_APP_ID = "859442203159885";
const FACEBOOK_LOGIN_CONFIG_ID = "2173649920103461";
const GRAPH_VERSION = "v25.0";
const GITHUB_PAGES_BASE = "/jennyscontents";
const ADMIN_CONTENTS_BASE = "/admin/contents";
const APPS_CONTENTS_BASE = "/contents";
const REVIEW_HASHTAGS = [
  "dfwrealestate",
  "dallasrealestate",
  "northdallas",
  "dallasrealtor",
  "dfwrealtor",
  "planotx",
  "friscotx",
  "mckinneytx",
];
const REVIEW_SCOPES = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
];
const PAGE_IDS = ["today", "library", "data"];
const signalSources = {
  instagram: {
    label: "Instagram",
    endpoint: "/api/instagram/summary?limit=12",
    accountLabel: "Account",
    countLabel: "Recent / found",
    reachLabel: "Engagement",
    shareLabel: "Saves + shares",
  },
  tiktok: {
    label: "TikTok",
    endpoint: "/api/tiktok/summary",
    accountLabel: "Account",
    countLabel: "Recent / videos",
    reachLabel: "Views",
    shareLabel: "Shares",
  },
  x: {
    label: "X",
    endpoint: "/api/x/summary",
    accountLabel: "Account",
    countLabel: "Recent / posts",
    reachLabel: "Engagement",
    shareLabel: "Reposts + quotes",
  },
};

const tiktokDfwSearches = [
  { label: "DFW real estate", type: "search", value: "DFW real estate" },
  { label: "Dallas real estate", type: "search", value: "Dallas real estate" },
  { label: "Moving to Dallas", type: "search", value: "moving to Dallas" },
  { label: "#dfwrealestate", type: "hashtag", value: "dfwrealestate" },
  { label: "#dallasrealestate", type: "hashtag", value: "dallasrealestate" },
  { label: "#dallasrealtor", type: "hashtag", value: "dallasrealtor" },
  { label: "#dfwrealtor", type: "hashtag", value: "dfwrealtor" },
  { label: "#friscorealestate", type: "hashtag", value: "friscorealestate" },
  { label: "#planorealestate", type: "hashtag", value: "planorealestate" },
  { label: "#mckinneyrealestate", type: "hashtag", value: "mckinneyrealestate" },
];

const tiktokImportTemplate = `url,caption,views,likes,comments,shares,date
https://www.tiktok.com/@creator/video/123,"Hook or caption from a DFW real estate post",12000,740,65,120,2026-05-19`;

const starterIdeas = [
  {
    hook: "The first question I ask every North Dallas buyer before we tour",
    format: "Talking-head opener, three quick bullets on screen, then one local example from a North Dallas search.",
    caption:
      "Most buyers start with bedrooms and price. I start with lifestyle fit, commute, school and work routes, and resale risk. That order saves time and prevents expensive compromises.",
    cta: "DM me 'DFW' and I will send you the North Dallas buyer prep checklist.",
  },
  {
    hook: "A North Dallas seller mistake that quietly costs showings in the first 72 hours",
    format: "B-roll of a listing prep walkthrough with text overlays for pricing, photos, prep, and launch timing.",
    caption:
      "The first three days shape the market's opinion of your home. Clean prep, clear pricing, and a coordinated launch matter more than one big open house.",
    cta: "Message me 'SELL' for the North Dallas pre-listing timeline.",
  },
  {
    hook: "What your budget actually buys in North Dallas right now",
    format: "Carousel or reel with three price bands, each with a neighborhood-style expectation and tradeoff.",
    caption:
      "A realistic budget conversation is not about discouraging you. It is how we find the best fit faster across North Dallas and DFW and avoid chasing homes that do not match your goals.",
    cta: "Send me your target area and I will map the current options.",
  },
];

const legacyDefaults = {
  displayName: "Jenny Jun Homes",
  market: "Chicago suburbs",
  primaryCta: "DM me 'HOME' for the local guide",
  ideaHooks: [
    "The first question I ask every Chicago suburbs buyer in 2026",
    "A seller mistake that quietly costs showings in the first 72 hours",
    "What your budget actually buys in the Chicago suburbs right now",
  ],
};

let state = loadState();
let latestInstagramPayload = null;
let latestExtractedIdea = null;
let ideaGenerationRun = 0;
let selectedVideoJobId = "";
let pendingVideoUploadJobId = "";
let libraryStore = {
  loaded: false,
  filePath: "",
  videoDir: "",
  savedIdeas: null,
  videoJobs: null,
  saveTimer: null,
};
let expandedSavedIdeaIds = new Set();
let reelPreviewController = null;
const videoStatusTimers = new Map();

function isStaticReviewMode() {
  return (
    window.location.hostname.endsWith("github.io") ||
    new URLSearchParams(window.location.search).get("review") === "github"
  );
}

function appBasePath() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === APPS_CONTENTS_BASE || pathname.startsWith(`${APPS_CONTENTS_BASE}/`)) {
    return APPS_CONTENTS_BASE;
  }
  if (pathname === ADMIN_CONTENTS_BASE || pathname.startsWith(`${ADMIN_CONTENTS_BASE}/`)) {
    return ADMIN_CONTENTS_BASE;
  }
  if (pathname === GITHUB_PAGES_BASE || pathname.startsWith(`${GITHUB_PAGES_BASE}/`)) {
    return GITHUB_PAGES_BASE;
  }
  return "";
}

function appPath(path = "/") {
  const value = String(path || "/");
  if (/^(?:https?:|mailto:|tel:|data:|blob:)/i.test(value)) return value;

  const base = appBasePath();
  if (!base) return value;

  const suffix = value.startsWith("/") ? value : `/${value}`;
  if (suffix === "/") return `${base}/`;
  return `${base}${suffix}`;
}

function appMediaUrl(url) {
  const value = String(url || "");
  if (!value || /^(?:https?:|data:|blob:)/i.test(value)) return value;
  return appPath(value);
}

function githubReviewUrl() {
  return `${window.location.origin}${GITHUB_PAGES_BASE}/`;
}

function reviewRedirectUri() {
  return `${window.location.origin}${appBasePath()}/auth/facebook/callback/`;
}

function facebookReviewLoginUrl() {
  const authUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", META_APP_ID);
  authUrl.searchParams.set("redirect_uri", reviewRedirectUri());
  authUrl.searchParams.set("config_id", FACEBOOK_LOGIN_CONFIG_ID);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", REVIEW_SCOPES.join(","));
  authUrl.searchParams.set("state", "jennyscontents-github-review");
  return authUrl.toString();
}

function loadState() {
  const defaults = {
    displayName: "Jun Residential Group",
    market: "North Dallas and DFW",
    audience: "buyers, sellers, and relocating families",
    primaryCta: "DM me 'DFW' for the North Dallas guide",
    focus: "3 reels I can film in under 45 minutes",
    signalSource: "instagram",
    mediaSort: "recommended",
    analytics: "",
    pillarMarket: true,
    pillarBuyer: true,
    pillarSeller: true,
    pillarLocal: true,
    ideas: starterIdeas,
  };

  try {
    return migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"), defaults);
  } catch {
    return defaults;
  }
}

function migrateState(saved, defaults) {
  const next = { ...defaults, ...saved };

  if (!saved.displayName || saved.displayName === legacyDefaults.displayName) {
    next.displayName = defaults.displayName;
  }

  if (!saved.market || saved.market === legacyDefaults.market) {
    next.market = defaults.market;
  }

  if (!saved.primaryCta || saved.primaryCta === legacyDefaults.primaryCta) {
    next.primaryCta = defaults.primaryCta;
  }

  if (!Array.isArray(saved.ideas) || saved.ideas.some((idea) => legacyDefaults.ideaHooks.includes(idea.hook))) {
    next.ideas = structuredClone(starterIdeas);
  }

  return next;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const saveState = document.querySelector("#saveState");
  saveState.textContent = "Saved locally";
  saveState.classList.remove("is-dirty");
}

function markDirty() {
  const saveState = document.querySelector("#saveState");
  saveState.textContent = "Saving...";
  saveState.classList.add("is-dirty");
  window.clearTimeout(markDirty.timer);
  markDirty.timer = window.setTimeout(persist, 180);
}

function setupStoredInputs() {
  document.querySelectorAll("[data-store]").forEach((input) => {
    const key = input.dataset.store;
    if (input.type === "checkbox") {
      input.checked = Boolean(state[key]);
    } else {
      input.value = state[key] || "";
    }

    input.addEventListener("input", () => {
      state[key] = input.type === "checkbox" ? input.checked : input.value;
      if (["focus", "market", "audience", "primaryCta"].includes(key)) {
        renderFocusPlan();
      }
      renderPrompt();
      markDirty();
    });
  });
}

function pageFromHash() {
  const page = window.location.hash.replace(/^#/, "");
  return PAGE_IDS.includes(page) ? page : "today";
}

function goToPage(page) {
  const nextPage = PAGE_IDS.includes(page) ? page : "today";
  if (window.location.hash.replace(/^#/, "") === nextPage) {
    renderPage(nextPage);
    return;
  }
  window.location.hash = nextPage;
}

function renderPage(page = pageFromHash()) {
  document.querySelectorAll("[data-page]").forEach((section) => {
    section.hidden = section.dataset.page !== page;
  });

  document.querySelectorAll("[data-page-link]").forEach((button) => {
    const active = button.dataset.pageLink === page;
    const isNavTab = button.classList.contains("nav-tab");
    button.classList.toggle("is-active", isNavTab && active);
    if (isNavTab) {
      button.setAttribute("aria-current", active ? "page" : "false");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  renderManagedData();
}

async function loadInstagramData() {
  return loadSignalData(state.signalSource || "instagram");
}

async function loadSignalData(sourceId = "instagram") {
  const source = signalSources[sourceId] || signalSources.instagram;
  const status = document.querySelector("#instagramStatus");
  const button = document.querySelector("#refreshInstagram");

  state.signalSource = sourceId;
  renderSourceTabs();
  renderSourceTools();
  renderMetricLabels(source);
  renderFocusPlan();
  status.textContent = `Checking ${source.label} posts...`;
  if (!button.dataset.idleLabel || button.textContent !== "Refreshing...") {
    button.dataset.idleLabel = button.textContent || "Refresh posts";
  }
  button.textContent = "Refreshing...";
  button.disabled = true;

  try {
    if (sourceId === "instagram" && isStaticReviewMode()) {
      renderInstagramData(await loadGithubReviewInstagramData());
      return;
    }

    const response = await fetch(appPath(source.endpoint), { cache: "no-store" });
    let payload = useCachedPayloadIfNeeded(sourceId, await response.json());
    payload = mergeImportedSignals(sourceId, payload);
    if (!response.ok || !payload.ok) {
      renderInstagramData(payload);
      return;
    }

    renderInstagramData(payload);
  } catch (error) {
    renderInstagramError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.idleLabel || "Refresh posts";
  }
}

function renderInstagramData(payload) {
  latestInstagramPayload = payload;
  const source = signalSources[state.signalSource] || signalSources.instagram;
  const account = payload.account;
  const analysis = payload.analysis || {};
  const totals = analysis.totals || {};
  const media = payload.media || [];

  cacheSignalPayload(state.signalSource || "instagram", payload);
  document.querySelector("#instagramStatus").textContent = instagramStatusText(payload);
  document.querySelector("#instagramAccount").textContent = account
    ? `@${account.username || account.id}`
    : "Not connected";
  document.querySelector("#instagramRecentCount").textContent = formatRecentTotal(analysis, media.length);
  document.querySelector("#instagramViews").textContent = formatNumber(
    totals.views || totals.likes + totals.comments
  );
  document.querySelector("#instagramSavesShares").textContent = formatNumber(
    (totals.saves || 0) + (totals.shares || 0)
  );

  renderConnectionAction(payload);
  renderSourceTools();
  renderCountList("#instagramHookPatterns", analysis.hookPatterns || []);
  renderCountList("#instagramTopics", analysis.topicCategories || []);
  renderCountList("#instagramFormats", analysis.formatMix || []);
  renderPostSortControl();
  renderInstagramRows(media);
  renderSourceStatus(payload.sourceStatus || [], payload.warnings || []);
  updateExtractedIdeaFromPayload(payload);
}

function instagramStatusText(payload) {
  const source = signalSources[state.signalSource] || signalSources.instagram;
  if (payload.cached?.stale) {
    const cachedAt = payload.cached.savedAt || payload.checkedAt;
    const date = cachedAt ? ` from ${formatDateTime(cachedAt)}` : "";
    return `Showing saved ${source.label} posts${date} because the latest refresh hit a platform limit.`;
  }
  if (payload.importedCount && payload.media?.length) {
    const imported = `${payload.importedCount} imported example${payload.importedCount === 1 ? "" : "s"}`;
    return `${source.label} connected. Reviewed ${payload.media.length} post(s), including ${imported}.`;
  }
  if (payload.configured === false) return payload.message || `${source.label} is not configured.`;
  if (!payload.ok && payload.account) {
    const username = payload.account.username ? ` as @${payload.account.username}` : "";
    return `${source.label} connected${username}, but posts could not be refreshed: ${payload.message || "No details returned."}`;
  }
  if (!payload.ok) return payload.message || `${source.label} posts could not be loaded.`;
  if (hasRateLimitWarning(payload)) {
    return `${source.label} is rate-limited. Try again later or use a recent refresh from Sources.`;
  }
  const checked = payload.checkedAt ? `Last checked ${formatDateTime(payload.checkedAt)}.` : "";
  if (!payload.media?.length) {
    return `${source.label} connected, but no real estate posts were returned. ${checked}`;
  }
  const recent = Number(payload.analysis?.recentCount || 0);
  const recentNote =
    recent === payload.media.length
      ? "all from the last 7 days"
      : `${formatNumber(recent)} from the last 7 days`;
  return `${source.label} connected. Reviewed ${payload.media.length} real estate post(s), ${recentNote}. ${checked}`;
}

function cacheSignalPayload(sourceId, payload) {
  if (payload.cached?.stale || !payload.ok || !payload.media?.length) return;

  const cache = readSignalCache();
  cache[sourceId] = {
    savedAt: new Date().toISOString(),
    payload,
  };
  localStorage.setItem(SIGNAL_CACHE_KEY, JSON.stringify(cache));
  renderSignalCacheManager();
}

function useCachedPayloadIfNeeded(sourceId, payload) {
  if (payload.ok && payload.media?.length) return payload;
  if (!hasRateLimitWarning(payload)) return payload;

  const cached = readSignalCache()[sourceId];
  if (!cached?.payload?.media?.length) return payload;

  return {
    ...cached.payload,
    cached: {
      stale: true,
      savedAt: cached.savedAt,
    },
    warnings: [
      ...(cached.payload.warnings || []),
      `Latest ${signalSources[sourceId]?.label || "source"} refresh hit a platform request limit.`,
      ...(payload.warnings || []),
    ],
  };
}

function hasRateLimitWarning(payload) {
  return [...(payload.warnings || []), payload.message || ""].some((line) =>
    /request limit|rate limit|too many requests/i.test(line)
  );
}

function readSignalCache() {
  try {
    return JSON.parse(localStorage.getItem(SIGNAL_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function formatRecentTotal(analysis, total) {
  const recent = Number(analysis?.recentCount || 0);
  const analyzed = Number(analysis?.analyzedCount || total || 0);
  if (!analyzed) return "0";
  if (recent !== analyzed) return `${formatNumber(recent)} / ${formatNumber(analyzed)}`;
  return formatNumber(analyzed);
}

function mergeImportedSignals(sourceId, payload) {
  if (sourceId !== "tiktok") return payload;

  const imported = readImportedTikTokPosts();
  if (!imported.length) return payload;

  const media = dedupeMedia([...(payload.media || []), ...imported]);
  const connectedAccount = payload.account || {
    id: "manual_import",
    username: "imported TikTok examples",
    authMode: "manual_import",
  };

  return {
    ...payload,
    ok: true,
    account: connectedAccount,
    importedCount: imported.length,
    media,
    sourceStatus: [
      ...(payload.sourceStatus || []),
      `Imported TikTok examples: ${imported.length} item(s) loaded from this browser.`,
    ],
    analysis: buildInstagramAnalysis(media),
  };
}

function dedupeMedia(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.permalink || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readImportedTikTokPosts() {
  try {
    const rows = JSON.parse(localStorage.getItem(TIKTOK_IMPORT_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveImportedTikTokPosts(rows) {
  localStorage.setItem(TIKTOK_IMPORT_KEY, JSON.stringify(rows));
}

function renderSourceTools() {
  const importButton = document.querySelector("#importTikTokPosts");
  if (!importButton) return;

  const isTikTok = (state.signalSource || "instagram") === "tiktok";
  importButton.hidden = !isTikTok;

  renderTikTokSearchLinks();
  renderTikTokImportStatus();
}

function toggleTikTokImportPanel(show) {
  if (show === false) {
    goToPage("today");
    return;
  }

  goToPage("data");
  renderTikTokImportStatus();
}

function renderTikTokImportStatus(message = "") {
  const status = document.querySelector("#tiktokImportStatus");
  if (!status) return;

  if (message) {
    status.textContent = message;
    return;
  }

  const count = readImportedTikTokPosts().length;
  status.textContent = count ? `${count} imported post${count === 1 ? "" : "s"} saved locally` : "No imported posts";
}

function renderManagedData() {
  renderTikTokImportStatus();
  renderSignalCacheManager();
}

function renderSignalCacheManager() {
  const list = document.querySelector("#signalCacheList");
  if (!list) return;

  const cache = readSignalCache();
  const rows = Object.entries(signalSources).map(([sourceId, source]) => ({
    sourceId,
    source,
    cached: cache[sourceId],
  }));

  list.innerHTML = "";

  const clearAll = document.querySelector("#clearSignalCache");
  if (clearAll) clearAll.disabled = !rows.some((row) => row.cached?.payload);

  rows.forEach(({ sourceId, source, cached }) => {
    const item = document.createElement("article");
    item.className = "cache-item";

    const title = document.createElement("strong");
    title.textContent = source.label;

    const meta = document.createElement("span");
    if (!cached?.payload) {
      meta.textContent = "No recent refresh";
    } else {
      const analysis = cached.payload.analysis || {};
      const mediaCount = cached.payload.media?.length || 0;
      const recentCount = Number(analysis.recentCount || 0);
      meta.textContent = [
        `${formatNumber(mediaCount)} signal${mediaCount === 1 ? "" : "s"}`,
        `${formatNumber(recentCount)} recent`,
        cached.savedAt ? `saved ${formatDateTime(cached.savedAt)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }

    const actions = document.createElement("div");
    actions.className = "cache-actions";
    const useButton = cacheActionButton("Use refresh", "use", sourceId);
    const clearButton = cacheActionButton("Clear", "clear", sourceId);
    useButton.disabled = !cached?.payload;
    clearButton.disabled = !cached?.payload;
    actions.append(useButton, clearButton);

    item.append(title, meta, actions);
    list.append(item);
  });
}

function cacheActionButton(label, action, sourceId) {
  const button = document.createElement("button");
  button.className = action === "clear" ? "button compact ghost" : "button compact";
  button.type = "button";
  button.dataset.cacheAction = action;
  button.dataset.cacheSource = sourceId;
  button.textContent = label;
  return button;
}

function handleSignalCacheAction(event) {
  const button = event.target.closest("[data-cache-action]");
  if (!button) return;

  const sourceId = button.dataset.cacheSource;
  const action = button.dataset.cacheAction;

  if (action === "use") {
    useCachedSignal(sourceId);
    return;
  }

  if (action === "clear") {
    clearSignalCache(sourceId);
  }
}

function useCachedSignal(sourceId) {
  const cached = readSignalCache()[sourceId];
  if (!cached?.payload) return;

  state.signalSource = sourceId;
  renderSourceTabs();
  renderSourceTools();
  renderMetricLabels(signalSources[sourceId] || signalSources.instagram);
  goToPage("today");
  renderInstagramData({
    ...cached.payload,
    cached: {
      stale: true,
      savedAt: cached.savedAt,
    },
    warnings: [
      ...(cached.payload.warnings || []),
      `Loaded ${signalSources[sourceId]?.label || "source"} from a recent refresh.`,
    ],
  });
  persist();
}

function clearSignalCache(sourceId = "") {
  if (!sourceId) {
    localStorage.removeItem(SIGNAL_CACHE_KEY);
    renderSignalCacheManager();
    return;
  }

  const cache = readSignalCache();
  delete cache[sourceId];
  localStorage.setItem(SIGNAL_CACHE_KEY, JSON.stringify(cache));
  renderSignalCacheManager();
}

function renderTikTokSearchLinks() {
  const container = document.querySelector("#tiktokSearchLinks");
  if (!container || container.childElementCount) return;

  tiktokDfwSearches.forEach((search) => {
    const link = document.createElement("a");
    link.href = tiktokSearchUrl(search);
    link.target = "_top";
    link.rel = "noreferrer";
    link.textContent = search.label;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      renderTikTokImportStatus(`Opening ${search.label} on TikTok...`);
      window.setTimeout(() => {
        window.location.assign(link.href);
      }, 120);
    });
    container.append(link);
  });
}

function tiktokSearchUrl(search) {
  if (search.type === "hashtag") {
    return `https://www.tiktok.com/tag/${encodeURIComponent(search.value)}`;
  }

  return `https://www.tiktok.com/search?q=${encodeURIComponent(search.value)}`;
}

function loadTikTokImportTemplate() {
  document.querySelector("#tiktokImportText").value = tiktokImportTemplate;
  renderTikTokImportStatus("Template loaded");
}

function addSingleTikTokPost() {
  const row = {
    permalink: document.querySelector("#tiktokSingleUrl").value,
    caption: document.querySelector("#tiktokSingleCaption").value,
    timestamp: document.querySelector("#tiktokSingleDate").value,
    format: "short_video",
    views: parseMetric(document.querySelector("#tiktokSingleViews").value),
    likes: parseMetric(document.querySelector("#tiktokSingleLikes").value),
    comments: parseMetric(document.querySelector("#tiktokSingleComments").value),
    shares: parseMetric(document.querySelector("#tiktokSingleShares").value),
    saves: 0,
  };
  const post = normalizeImportedTikTokPost(row);
  if (!post) {
    renderTikTokImportStatus("Add a post URL or caption first");
    return;
  }

  const existing = readImportedTikTokPosts();
  saveImportedTikTokPosts(dedupeMedia([...existing, post]));
  clearSingleTikTokPostForm();
  renderTikTokImportStatus("Post added");
  loadSignalData("tiktok");
}

function clearSingleTikTokPostForm() {
  [
    "#tiktokSingleUrl",
    "#tiktokSingleCaption",
    "#tiktokSingleViews",
    "#tiktokSingleLikes",
    "#tiktokSingleComments",
    "#tiktokSingleShares",
    "#tiktokSingleDate",
  ].forEach((selector) => {
    document.querySelector(selector).value = "";
  });
}

function importTikTokPosts() {
  const input = document.querySelector("#tiktokImportText");
  const rows = parseTikTokImportInput(input.value);
  if (!rows.length) {
    renderTikTokImportStatus("No valid TikTok posts found");
    return;
  }

  const existing = readImportedTikTokPosts();
  const combined = dedupeMedia([...existing, ...rows]);
  saveImportedTikTokPosts(combined);
  input.value = "";
  renderTikTokImportStatus(`${rows.length} imported`);
  loadSignalData("tiktok");
}

function clearTikTokImports() {
  localStorage.removeItem(TIKTOK_IMPORT_KEY);
  document.querySelector("#tiktokImportText").value = "";
  document.querySelector("#tiktokImportFile").value = "";
  clearSingleTikTokPostForm();
  renderTikTokImportStatus("Imports cleared");
  loadSignalData("tiktok");
}

async function handleTikTokImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  document.querySelector("#tiktokImportText").value = text;
  renderTikTokImportStatus(`${file.name} ready`);
}

function parseTikTokImportInput(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  const tabular = parseDelimitedTikTokRows(text);
  const rows = tabular.length ? tabular : parsePlainTikTokRows(text);
  return rows.map(normalizeImportedTikTokPost).filter(Boolean);
}

function parseDelimitedTikTokRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]+/g, "")
  );
  const hasKnownHeader = headers.some((header) =>
    ["url", "link", "permalink", "caption", "description", "text", "views", "likes", "comments", "shares"].includes(
      header
    )
  );
  if (!hasKnownHeader) return [];

  return lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    return importRowFromObject(row);
  });
}

function parseDelimitedLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t").map((cell) => cell.trim());

  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  cells.push(cell.trim());
  return cells;
}

function importRowFromObject(row) {
  const pick = (...keys) => keys.map((key) => row[key]).find((value) => String(value || "").trim()) || "";
  return {
    permalink: pick("url", "link", "permalink", "shareurl", "posturl"),
    caption: pick("caption", "description", "text", "copy", "hook"),
    timestamp: pick("date", "timestamp", "createdat", "created", "posted"),
    format: pick("format", "type"),
    views: parseMetric(pick("views", "viewcount", "plays")),
    likes: parseMetric(pick("likes", "likecount")),
    comments: parseMetric(pick("comments", "commentcount", "replies")),
    shares: parseMetric(pick("shares", "sharecount", "reposts")),
    saves: parseMetric(pick("saves", "savecount")),
  };
}

function parsePlainTikTokRows(text) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const urls = block.match(/https?:\/\/(?:www\.)?tiktok\.com\/\S+/gi) || [];
      if (urls.length > 1) {
        return urls.map((url) => parsePlainTikTokBlock(url));
      }
      return [parsePlainTikTokBlock(block)];
    });
}

function parsePlainTikTokBlock(block) {
  const url = (block.match(/https?:\/\/(?:www\.)?tiktok\.com\/\S+/i) || [])[0] || "";
  const clean = block
    .replace(url, "")
    .replace(/\b(views?|likes?|comments?|shares?|saves?)\s*[:=]?\s*[\d.,]+[kmb]?/gi, "")
    .replace(/\b(caption|description|text)\s*[:=-]\s*/i, "")
    .trim();

  return {
    permalink: url,
    caption: clean,
    timestamp: "",
    format: "short_video",
    views: metricFromText(block, "views?"),
    likes: metricFromText(block, "likes?"),
    comments: metricFromText(block, "comments?"),
    shares: metricFromText(block, "shares?"),
    saves: metricFromText(block, "saves?"),
  };
}

function metricFromText(text, label) {
  const match = String(text || "").match(new RegExp(`\\b${label}\\s*[:=]?\\s*([\\d.,]+[kmb]?)`, "i"));
  return parseMetric(match?.[1] || "");
}

function parseMetric(value) {
  const text = String(value || "").trim().toLowerCase().replace(/,/g, "");
  if (!text) return 0;

  const match = text.match(/^([\d.]+)\s*([kmb])?$/);
  if (!match) return Number.parseInt(text, 10) || 0;

  const base = Number.parseFloat(match[1]);
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]] || 1;
  return Math.round(base * multiplier);
}

function normalizeImportedTikTokPost(row, index) {
  const caption = String(row.caption || "").trim();
  const permalink = String(row.permalink || "").trim();
  if (!caption && !permalink) return null;

  const timestamp = normalizeImportDate(row.timestamp);
  const media = {
    id: `manual-tiktok-${hashText(`${permalink}|${caption}|${index}`)}`,
    source: "manual_market_import",
    hashtag: "",
    caption,
    format: row.format || "short_video",
    mediaType: "VIDEO",
    mediaProductType: "TIKTOK",
    timestamp,
    permalink,
    likes: Number(row.likes || 0),
    comments: Number(row.comments || 0),
    views: Number(row.views || 0),
    reach: 0,
    saves: Number(row.saves || 0),
    shares: Number(row.shares || 0),
    hookPattern: classifyHook(caption),
    topicCategory: classifyTopic(caption),
    score: 0,
  };
  media.score = scoreImportedMedia(media);
  return media;
}

function normalizeImportDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function scoreImportedMedia(media) {
  return (
    Number(media.views || 0) +
    Number(media.likes || 0) * 3 +
    Number(media.comments || 0) * 8 +
    Number(media.shares || 0) * 12 +
    Number(media.saves || 0) * 12
  );
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function renderConnectionAction(payload) {
  const connect = document.querySelector("#facebookConnect");
  if (!connect) return;

  const sourceId = state.signalSource || "instagram";
  const oauthConnected = Boolean(
    payload.ok && payload.configured !== false && payload.account?.authMode !== "manual_import" && payload.account
  );

  connect.removeAttribute("title");

  if (sourceId === "instagram") {
    connect.href = isStaticReviewMode() ? facebookReviewLoginUrl() : appPath("/auth/facebook/start");
    connect.hidden = oauthConnected;
    connect.textContent = oauthConnected ? "Instagram connected" : "Connect Instagram";
    if (isStaticReviewMode()) {
      connect.title = "GitHub Pages review mode stores the Meta review token only in this browser session.";
    }
    return;
  }

  if (sourceId === "tiktok") {
    connect.href = appPath("/auth/tiktok/start");
    connect.hidden = oauthConnected;
    connect.textContent = oauthConnected ? "TikTok connected" : "Connect TikTok";
    connect.title = "Connect TikTok through the local OAuth callback.";
    return;
  }

  if (sourceId === "x") {
    const xConnected = payload.account?.authMode === "oauth2_user";
    connect.href = appPath("/auth/x/start");
    connect.hidden = xConnected;
    connect.textContent = xConnected ? "X connected" : "Connect X";
    connect.title = "Connect X through the local OAuth 2.0 callback.";
    return;
  }

  connect.hidden = true;
}

function renderInstagramError(message) {
  const source = signalSources[state.signalSource] || signalSources.instagram;
  document.querySelector("#instagramStatus").textContent = `${source.label} posts could not be checked: ${message}`;
  document.querySelector("#instagramAccount").textContent = "Not loaded";
  document.querySelector("#instagramRecentCount").textContent = "0";
  document.querySelector("#instagramViews").textContent = "0";
  document.querySelector("#instagramSavesShares").textContent = "0";
  renderConnectionAction({ ok: false, account: null });
  renderCountList("#instagramHookPatterns", []);
  renderCountList("#instagramTopics", []);
  renderCountList("#instagramFormats", []);
  renderInstagramRows([]);
  renderSourceStatus([], []);
}

function renderSourceTabs() {
  document.querySelectorAll("[data-signal-source]").forEach((button) => {
    const active = button.dataset.signalSource === (state.signalSource || "instagram");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderMetricLabels(source) {
  document.querySelector("#signalAccountLabel").textContent = source.accountLabel;
  document.querySelector("#signalCountLabel").textContent = source.countLabel;
  document.querySelector("#signalReachLabel").textContent = source.reachLabel;
  document.querySelector("#signalShareLabel").textContent = source.shareLabel;
}

async function loadGithubReviewInstagramData() {
  const token = sessionStorage.getItem(REVIEW_TOKEN_KEY);
  const sourceStatus = [
    `GitHub Pages review mode: ${githubReviewUrl()}`,
    "This public build uses a short-lived browser OAuth token only for Meta review testing.",
  ];

  if (!token) {
    return {
      ok: false,
      configured: false,
      message: "GitHub Pages review mode is ready. Click Connect Facebook Login to authorize a short-lived review session.",
      checkedAt: new Date().toISOString(),
      account: null,
      media: [],
      analysis: buildInstagramAnalysis([]),
      sourceStatus,
      warnings: [
        `Meta review callback URL: ${reviewRedirectUri()}`,
        "No app secret or long-lived token is stored in the public GitHub Pages build.",
      ],
    };
  }

  const warnings = [];
  let account = null;
  const media = [];

  try {
    const connectedAccount = await discoverReviewInstagramAccount(token);
    account = {
      id: connectedAccount.id,
      username: connectedAccount.username,
      authMode: "github_review",
    };
    sourceStatus.push(`Connected @${connectedAccount.username} through ${connectedAccount.pageName}.`);

    const owned = await graphGet(`${connectedAccount.id}/media`, token, {
      fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count",
      limit: "12",
    });

    (owned.data || []).forEach((item) => {
      media.push(normalizeReviewMedia(item, "owned_media"));
    });
    sourceStatus.push(`Instagram owned media: ${(owned.data || []).length} item(s) returned.`);

    for (const hashtag of REVIEW_HASHTAGS.slice(0, 5)) {
      try {
        const search = await graphGet("ig_hashtag_search", token, {
          user_id: connectedAccount.id,
          q: hashtag,
        });
        const hashtagId = search.data?.[0]?.id;
        if (!hashtagId) {
          sourceStatus.push(`Instagram #${hashtag}: no hashtag id returned.`);
          continue;
        }

        const topMedia = await graphGet(`${hashtagId}/top_media`, token, {
          user_id: connectedAccount.id,
          fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count",
          limit: "8",
        });

        const items = topMedia.data || [];
        let kept = 0;
        let dropped = 0;
        items.forEach((item) => {
          const normalized = normalizeReviewMedia(item, "hashtag_top_media", hashtag);
          if (!isRelevantInstagramMedia(normalized)) {
            dropped += 1;
            return;
          }
          kept += 1;
          media.push(normalized);
        });
        sourceStatus.push(`Instagram #${hashtag}: ${kept}/${items.length} real estate top media item(s) kept.`);
        if (dropped) {
          sourceStatus.push(`Instagram #${hashtag}: ${dropped} unrelated top media item(s) filtered out.`);
        }
      } catch (error) {
        warnings.push(`Instagram hashtag #${hashtag} failed: ${error.message}`);
      }
    }
  } catch (error) {
    warnings.push(error.message);
  }

  return {
    ok: Boolean(account),
    configured: true,
    checkedAt: new Date().toISOString(),
    account,
    media,
    analysis: buildInstagramAnalysis(media),
    sourceStatus,
    warnings,
    message: account ? "" : "Could not load the connected Instagram account for this review session.",
  };
}

async function discoverReviewInstagramAccount(token) {
  const accounts = await graphGet("me/accounts", token, {
    fields: "id,name,instagram_business_account{id,username}",
    limit: "20",
  });
  const page = (accounts.data || []).find((item) => item.instagram_business_account?.id);

  if (!page) {
    throw new Error("No Facebook Page with a connected Instagram Business account was returned for this login.");
  }

  return {
    id: page.instagram_business_account.id,
    username: page.instagram_business_account.username,
    pageId: page.id,
    pageName: page.name,
  };
}

async function graphGet(path, token, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = payload.error;
    throw new Error(error?.message || `Graph API request failed for ${path}`);
  }
  return payload;
}

function normalizeReviewMedia(item, source, hashtag = "") {
  const caption = String(item.caption || "");
  const views = Number(item.video_views || 0);
  const likes = Number(item.like_count || 0);
  const comments = Number(item.comments_count || 0);
  return {
    id: item.id,
    source,
    hashtag,
    caption,
    permalink: item.permalink || "",
    timestamp: item.timestamp || "",
    format: classifyFormat(item),
    views,
    likes,
    comments,
    saves: 0,
    shares: 0,
    score: views + likes * 3 + comments * 8,
    hookPattern: classifyHook(caption),
    topicCategory: classifyTopic(caption),
  };
}

function classifyFormat(item) {
  const product = String(item.media_product_type || "").toLowerCase();
  const type = String(item.media_type || "").toLowerCase();
  if (product === "reels") return "reel";
  if (type === "carousel_album") return "carousel";
  if (type === "video") return "video";
  if (type === "image") return "post";
  return type || product || "post";
}

function classifyHook(caption) {
  const text = caption.toLowerCase();
  if (/\b(before|first|avoid|mistake|stop)\b/.test(text)) return "warning or mistake";
  if (/\b(why|what|how|where|when)\b/.test(text)) return "question led";
  if (/\b(3|three|top|best|worst|things|tips)\b/.test(text)) return "list based";
  if (/\b(price|budget|cost|afford|payment)\b/.test(text)) return "money led";
  return "direct local insight";
}

function classifyTopic(caption) {
  const text = caption.toLowerCase();
  if (/\b(sell|seller|listing|staging|showing)\b/.test(text)) return "seller strategy";
  if (/\b(buy|buyer|offer|mortgage|loan|budget|afford)\b/.test(text)) return "buyer education";
  if (/\b(dallas|dfw|frisco|plano|mckinney|north dallas|neighborhood)\b/.test(text)) return "local market";
  if (/\b(home|house|property|real estate|realtor)\b/.test(text)) return "real estate basics";
  return "local lifestyle";
}

function isRelevantInstagramMedia(item) {
  if (item.source !== "hashtag_top_media") return true;

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

function buildInstagramAnalysis(media) {
  const sorted = media.slice().sort((a, b) => b.score - a.score);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = sorted.filter((item) => {
    const time = new Date(item.timestamp).valueOf();
    return Number.isFinite(time) && time >= cutoff;
  });
  const signalRows = recent.length ? recent : sorted;

  return {
    analyzedCount: sorted.length,
    recentCount: recent.length,
    totals: signalRows.reduce(
      (totals, item) => ({
        views: totals.views + Number(item.views || 0),
        likes: totals.likes + Number(item.likes || 0),
        comments: totals.comments + Number(item.comments || 0),
        saves: totals.saves + Number(item.saves || 0),
        shares: totals.shares + Number(item.shares || 0),
      }),
      { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 }
    ),
    topPosts: signalRows.slice(0, 5),
    hookPatterns: topCounts(signalRows.map((item) => item.hookPattern)),
    topicCategories: topCounts(signalRows.map((item) => item.topicCategory)),
    formatMix: topCounts(signalRows.map((item) => item.format)),
  };
}

function topCounts(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
}

function renderCountList(selector, rows) {
  const list = document.querySelector(selector);
  list.innerHTML = "";

  if (!rows.length) {
    const item = document.createElement("li");
    item.textContent = "No ranked data yet";
    list.append(item);
    return;
  }

  rows.forEach(([label, count]) => {
    const item = document.createElement("li");
    item.textContent = `${label}: ${count}`;
    list.append(item);
  });
}

function renderInstagramRows(media) {
  const body = document.querySelector("#instagramMediaRows");
  body.innerHTML = "";

  if (!media.length) {
    const source = signalSources[state.signalSource] || signalSources.instagram;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = `No ${source.label} posts returned yet.`;
    row.append(cell);
    body.append(row);
    return;
  }

  media
    .slice()
    .sort(compareMediaForSelectedSort)
    .forEach((item) => {
      const row = document.createElement("tr");
      row.append(
        mediaPostCell(item),
        textCell(item.format),
        numberCell(item.score),
        numberCell(item.views),
        numberCell(item.likes),
        numberCell(item.comments),
        numberCell(item.saves),
        numberCell(item.shares)
      );
      body.append(row);
    });
}

function renderPostSortControl() {
  const control = document.querySelector("#postSort");
  if (!control) return;

  if (!postSortOptions().includes(state.mediaSort)) {
    state.mediaSort = "recommended";
  }
  control.value = state.mediaSort;
}

function postSortOptions() {
  return ["recommended", "format", "score", "views", "likes", "comments", "saves", "shares"];
}

function compareMediaForSelectedSort(a, b) {
  const sortKey = postSortOptions().includes(state.mediaSort) ? state.mediaSort : "recommended";
  if (sortKey === "recommended") return compareSignalMedia(a, b);
  if (sortKey === "format") {
    return (
      String(a.format || "").localeCompare(String(b.format || ""), undefined, { sensitivity: "base" }) ||
      compareSignalMedia(a, b)
    );
  }
  return compareNumericMedia(sortKey, a, b) || compareSignalMedia(a, b);
}

function compareNumericMedia(key, a, b) {
  return Number(b?.[key] || 0) - Number(a?.[key] || 0);
}

function compareSignalMedia(a, b) {
  const aRecent = isRecentSignalMedia(a);
  const bRecent = isRecentSignalMedia(b);
  if (aRecent !== bRecent) return aRecent ? -1 : 1;
  return Number(b.score || 0) - Number(a.score || 0);
}

function isRecentSignalMedia(item) {
  const time = Date.parse(item?.timestamp || "");
  return Number.isFinite(time) && Date.now() - time <= 7 * 24 * 60 * 60 * 1000;
}

function mediaPostCell(item) {
  const cell = document.createElement("td");
  if (!item.permalink) {
    const title = document.createElement("span");
    title.className = "media-post-title";
    title.textContent = postTitle(item);
    const meta = mediaMeta(item);
    cell.append(title, meta);
    return cell;
  }

  const link = document.createElement("a");
  link.href = item.permalink;
  link.className = "media-post-link";
  link.target = "_top";
  link.title = `Open ${postPlatformLabel(item)} post`;
  link.rel = "noreferrer";
  link.textContent = postTitle(item);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.assign(item.permalink);
  });

  const meta = mediaMeta(item);
  cell.append(link, meta);
  return cell;
}

function mediaMeta(item) {
  const meta = document.createElement("span");
  meta.className = "media-meta";
  meta.textContent = [
    formatDate(item.timestamp),
    sourceLabel(item),
    item.hookPattern,
    item.topicCategory,
  ]
    .filter(Boolean)
    .join(" · ");
  return meta;
}

function postTitle(item) {
  const caption = String(item.caption || "").trim().replace(/\s+/g, " ");
  if (caption) return caption.length > 84 ? `${caption.slice(0, 81)}...` : caption;
  const platform = postPlatformLabel(item);
  return item.permalink ? `Open ${platform} post` : `${platform} post`;
}

function postPlatformLabel(item) {
  const product = String(item.mediaProductType || "").toLowerCase();
  if (product === "tiktok") return "TikTok";
  if (product === "x") return "X";
  return signalSources[state.signalSource]?.label || "social";
}

function sourceLabel(item) {
  if (item.source === "hashtag_top_media") return item.hashtag ? `#${item.hashtag}` : "hashtag";
  if (item.source === "owned_media") return "owned";
  if (item.source === "manual_market_import") return "imported";
  return item.source || "";
}

function textCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "-";
  return cell;
}

function numberCell(value) {
  const cell = document.createElement("td");
  cell.textContent = formatNumber(value || 0);
  return cell;
}

function renderSourceStatus(statusRows, warningRows) {
  const container = document.querySelector("#instagramSourceStatus");
  container.innerHTML = "";

  [...statusRows, ...warningRows].forEach((line) => {
    const item = document.createElement("p");
    item.textContent = line;
    container.append(item);
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function selectedPillars() {
  const labels = [];
  if (state.pillarMarket) labels.push("market updates");
  if (state.pillarBuyer) labels.push("buyer education");
  if (state.pillarSeller) labels.push("seller strategy");
  if (state.pillarLocal) labels.push("local lifestyle");
  return labels.join(", ") || "real estate education";
}

function buildPrompt() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const focusPlan = filmingFocusPlan();

  return `CONTENT STRATEGY - ${today}

Brand: ${state.displayName}
Market: ${state.market}
Audience: ${state.audience}
Content pillars: ${selectedPillars()}
Primary CTA: ${state.primaryCta}
Today's filming focus: ${state.focus}

Search Instagram, TikTok, and X for top performing real estate content from the last 7 days.
Use refreshed post results when they are available. If a source is unavailable, state the gap and use the available real estate posts.

Identify:
1. Opening styles getting saves and shares.
2. Format structures that are repeatable for a local real estate agent.
3. Topic categories resonating with buyers, sellers, and relocation audiences.

Where saves and shares are unavailable for public examples, use the available proxy metrics and state the limitation.

Review my own analytics from the last 30 days:
${state.analytics || "[Paste analytics here before running.]"}

Find the overlap between what is working broadly and what is working for my audience.

${focusPlan.briefInstruction} Each idea should include:
- Hook
- Format
- Caption draft
- CTA

Output the final plan as a concise filming brief that can be saved to the Google Drive Content folder.`;
}

function renderPrompt() {
  document.querySelector("#promptPreview").textContent = buildPrompt();
}

function filmingFocusPlan() {
  const focus = String(state.focus || "").toLowerCase();
  const sourceLabel = signalSources[state.signalSource || "instagram"]?.label || "selected source";

  if (focus.includes("carousel")) {
    return {
      heading: "Carousel + two reels",
      note: `Create one carousel, one talking-head reel, and one b-roll reel from the refreshed ${sourceLabel} posts.`,
      briefInstruction: "Give me one carousel idea, one talking-head reel idea, and one b-roll reel idea to film today.",
      target: "balanced",
      slots: [
        { label: "Carousel", format: "carousel", topic: "" },
        { label: "Talking-head reel", format: "talking-head reel", topic: "" },
        { label: "B-roll reel", format: "b-roll reel", topic: "" },
      ],
    };
  }

  if (focus.includes("seller")) {
    return {
      heading: "Seller-focused ideas",
      note: `Create three seller strategy ideas for ${state.market}, using refreshed ${sourceLabel} patterns for hooks and formats.`,
      briefInstruction: "Give me three seller-focused reel ideas to film today.",
      target: "seller",
      slots: [
        { label: "Seller prep", format: "talking-head reel", topic: "seller prep" },
        { label: "Listing launch", format: "b-roll reel", topic: "seller prep" },
        { label: "Market read", format: "short reel", topic: "local market" },
      ],
    };
  }

  if (focus.includes("buyer")) {
    return {
      heading: "Buyer-focused ideas",
      note: `Create three buyer education ideas for ${state.audience}, using refreshed ${sourceLabel} patterns for hooks and formats.`,
      briefInstruction: "Give me three buyer-focused reel ideas to film today.",
      target: "buyer",
      slots: [
        { label: "Offer advice", format: "talking-head reel", topic: "buyer education" },
        { label: "Budget reality", format: "short reel", topic: "buyer education" },
        { label: "Relocation check", format: "b-roll reel", topic: "relocation" },
      ],
    };
  }

  return {
    heading: "Three quick reel ideas",
    note: `Create three short reels that Jenny can film in under 45 minutes, using refreshed ${sourceLabel} patterns.`,
    briefInstruction: "Give me three short reel ideas to film today.",
    target: "balanced",
    slots: [
      { label: "Reel 1", format: "short reel", topic: "" },
      { label: "Reel 2", format: "short reel", topic: "" },
      { label: "Reel 3", format: "short reel", topic: "" },
    ],
  };
}

function renderFocusPlan() {
  const plan = filmingFocusPlan();
  const heading = document.querySelector("#ideas-heading");
  const note = document.querySelector("#ideasFocusNote");
  const generateButton = document.querySelector("#generateIdeas");

  if (heading) heading.textContent = plan.heading;
  if (note) note.textContent = plan.note;
  if (generateButton) generateButton.textContent = `Create ${plan.heading.toLowerCase()}`;
}

function renderIdeas() {
  renderFocusPlan();
  const grid = document.querySelector("#ideaGrid");
  const template = document.querySelector("#ideaTemplate");
  grid.innerHTML = "";

  state.ideas.forEach((idea, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    bindIdeaField(card, ".idea-hook", index, "hook", idea.hook);
    bindIdeaField(card, ".idea-format", index, "format", idea.format);
    bindIdeaField(card, ".idea-caption", index, "caption", idea.caption);
    bindIdeaField(card, ".idea-cta", index, "cta", idea.cta);
    grid.append(card);
  });
}

function bindIdeaField(card, selector, index, key, value) {
  const field = card.querySelector(selector);
  field.value = value || "";
  field.addEventListener("input", () => {
    state.ideas[index][key] = field.value;
    markDirty();
  });
}

function generateIdeasFromSignals() {
  const analysis = latestInstagramPayload?.analysis || {};
  const plan = filmingFocusPlan();
  const topics = signalNames(analysis.topicCategories, ["buyer education", "seller prep", "local market"]).map((topic) =>
    normalizeIdeaTopic(topic, plan.target)
  );
  const patterns = signalNames(analysis.hookPatterns, ["direct advice", "specific numbered checklist", "visual reveal"]);
  const formats = signalNames(analysis.formatMix, ["reel", "carousel", "short video"]);

  state.ideas = plan.slots.map((slot, index) =>
    ideaFromSignal({
      topic: slot.topic || topics[index % topics.length],
      pattern: patterns[index % patterns.length],
      format: slot.format || formats[index % formats.length],
      index,
      focusTarget: plan.target,
      slotLabel: slot.label,
    })
  );
  renderIdeas();
  renderPrompt();
  markDirty();
}

function signalNames(rows, fallback) {
  const names = (rows || []).map((row) => row[0]).filter(Boolean);
  return names.length ? names : fallback;
}

function normalizeIdeaTopic(topic, focusTarget = "balanced") {
  const text = String(topic || "").toLowerCase();
  if (focusTarget === "seller") {
    return text.includes("market") ? "local market" : "seller prep";
  }
  if (focusTarget === "buyer") {
    if (/\b(relocat|lifestyle|neighborhood)\b/.test(text)) return "relocation";
    if (text.includes("market")) return "local market";
    return "buyer education";
  }
  if (text.includes("seller") || text.includes("listing") || text.includes("showing")) return "seller prep";
  if (text.includes("market") || text.includes("inventory") || text.includes("rate")) return "local market";
  if (text.includes("relocat") || text.includes("lifestyle") || text.includes("neighborhood")) return "relocation";
  if (text.includes("tour") || text.includes("property") || text.includes("home fit")) return "property tour";
  return "buyer education";
}

function formatLabelForIdea(format) {
  const text = String(format || "").toLowerCase();
  if (text.includes("carousel")) return "carousel";
  if (text.includes("talking") || text.includes("direct")) return "talking-head reel";
  if (text.includes("b-roll") || text.includes("visual") || text.includes("tour")) return "b-roll reel";
  if (text.includes("post")) return "short reel built from a text insight";
  return "short reel";
}

function ideaFromSignal({ topic, pattern, format, index, focusTarget = "balanced", slotLabel = "" }) {
  const normalizedTopic = normalizeIdeaTopic(topic, focusTarget);
  const formatLabel = formatLabelForIdea(format);
  const opener = pattern === "question-led" ? "question opener" : pattern;

  const templates = {
    "seller prep": {
      hook: `Before you list in ${state.market}, fix the first-photo areas buyers judge fastest`,
      format: `${formatLabel}: ${opener}, then three quick B-roll cuts of the entry, kitchen counters, and main living-room light before ending on pricing and launch timing.`,
      caption:
        "Buyers form an opinion before they read every detail. Clean entry shots, simple kitchen surfaces, strong natural light, and a clear launch plan can protect your first week of showings.",
      cta: "DM me 'SELL' for the North Dallas pre-listing timeline.",
    },
    "local market": {
      hook: `What changed in the ${state.market} market this week?`,
      format: `${formatLabel}: lead with the strongest market shift, then show one buyer takeaway and one seller takeaway.`,
      caption:
        "Local movement matters more than national headlines. Here is what buyers and sellers should watch before making the next move.",
      cta: "DM me 'DFW' for the current North Dallas market read.",
    },
    relocation: {
      hook: `Moving to ${state.market}? This is what surprises buyers first`,
      format: `${formatLabel}: start with the surprise, then compare commute, neighborhood feel, and tradeoffs in three cuts.`,
      caption:
        "Relocation decisions get easier when you compare lifestyle, commute, schools, and resale risk before touring homes.",
      cta: "Send me your target area and I will map the tradeoffs.",
    },
    "property tour": {
      hook: "The home feature buyers notice in the first 5 seconds",
      format: `${formatLabel}: visual reveal first, then explain why the feature matters for daily life and resale.`,
      caption:
        "Good tours do more than show pretty rooms. They explain how a home lives, what buyers notice, and where the tradeoffs are.",
      cta: "DM me the neighborhood you want to tour next.",
    },
    "buyer education": {
      hook: `I would not make an offer in ${state.market} until I checked this`,
      format: `${formatLabel}: ${opener}, then three offer checks with simple on-screen labels.`,
      caption:
        "A strong offer is not only about price. Terms, timing, inspection strategy, and the local competition all matter.",
      cta: state.primaryCta,
    },
  };

  const variants = {
    "seller prep": [
      templates["seller prep"],
      {
        hook: `Before you list in ${state.market}, check this pricing and launch sequence`,
        format: `${formatLabel}: ${opener}, then show prep list, photo-ready rooms, launch timing, and one seller takeaway.`,
        caption:
          "A strong listing launch is a sequence, not one task. Prep, photos, pricing, and first-week timing should work together before the home hits the market.",
        cta: "DM me 'SELL' for the North Dallas pre-listing timeline.",
      },
      {
        hook: `The showing detail ${state.market} sellers should fix before photos`,
        format: `${formatLabel}: show one fixable detail, explain why buyers notice it, then give a simple before-showing checklist.`,
        caption:
          "Small showing details can make a home feel either maintained or neglected. Fix the visible issues buyers notice before you spend energy on extras.",
        cta: "Message me 'PREP' for the seller walkthrough list.",
      },
    ],
    "buyer education": [
      templates["buyer education"],
      {
        hook: `What your budget actually buys in ${state.market} right now`,
        format: `${formatLabel}: compare three price bands and the tradeoffs buyers should expect.`,
        caption:
          "A realistic budget conversation helps you move faster and avoid chasing homes that do not fit your goals. The right tradeoff depends on location, condition, and daily life.",
        cta: state.primaryCta,
      },
      {
        hook: `Before you tour in ${state.market}, decide this first`,
        format: `${formatLabel}: show a map, then compare commute, schools, home condition, and resale risk in quick labeled cuts.`,
        caption:
          "Touring gets easier when you know what tradeoff you are willing to make before you walk into the first home.",
        cta: "Send me your target area and I will map the tradeoffs.",
      },
    ],
    "local market": [
      templates["local market"],
      {
        hook: `The ${state.market} market signal I would watch before making a move`,
        format: `${formatLabel}: lead with one visible signal, explain what it means for buyers, then what it means for sellers.`,
        caption:
          "The useful market question is not whether headlines are good or bad. It is what local inventory, pricing, and timing mean for your next move.",
        cta: "DM me 'DFW' for the current North Dallas market read.",
      },
      {
        hook: `What buyers and sellers are both missing in ${state.market}`,
        format: `${formatLabel}: split-screen or three quick cards showing buyer takeaway, seller takeaway, and Jenny's practical next step.`,
        caption:
          "Buyers and sellers are looking at the same market from different angles. The best strategy starts with the local signals that actually affect timing.",
        cta: "DM me 'DFW' for the current North Dallas market read.",
      },
    ],
    relocation: [
      templates.relocation,
      {
        hook: `Relocating to ${state.market}? Do this before you pick a neighborhood`,
        format: `${formatLabel}: show map, commute route, school zone check, and one neighborhood tradeoff in a tight 10-second preview.`,
        caption:
          "Relocation is easier when you narrow by daily life first, then shop homes. Commute, schools, routines, and resale risk should shape the search.",
        cta: state.primaryCta,
      },
      {
        hook: `The North Dallas neighborhood question I ask every relocating buyer`,
        format: `${formatLabel}: talking-head hook, then three B-roll cuts for commute, lifestyle fit, and home type.`,
        caption:
          "The right neighborhood is not just a price point. It is the place where your weekly routine, home needs, and long-term plans line up.",
        cta: state.primaryCta,
      },
    ],
    "property tour": [
      templates["property tour"],
      {
        hook: `Do not fall in love with a ${state.market} home until you check this`,
        format: `${formatLabel}: visual walkthrough with three home-fit checks: layout, light, and daily function.`,
        caption:
          "Pretty finishes matter less than how the home actually lives. Check the layout, natural light, storage, and daily flow before you decide.",
        cta: "DM me the neighborhood you want to tour next.",
      },
    ],
  };

  const focusSpecificIdea =
    focusTarget === "seller" && normalizedTopic === "local market"
      ? {
          hook: `What ${state.market} sellers should watch before they list`,
          format: `${formatLabel}: show one local market signal, explain what it means for pricing, then close with a listing prep next step.`,
          caption:
            "Seller strategy starts before the sign goes up. Local timing, competition, pricing, and prep all shape the first week on market.",
          cta: "DM me 'SELL' for the North Dallas pre-listing timeline.",
        }
      : focusTarget === "buyer" && normalizedTopic === "local market"
        ? {
            hook: `What ${state.market} buyers should watch before they tour this week`,
            format: `${formatLabel}: show one local market signal, then translate it into a buyer action for budget, timing, and neighborhoods.`,
            caption:
              "A market update only matters if it changes your next step. Buyers should use local signals to narrow timing, budget, and tradeoffs before touring.",
            cta: state.primaryCta,
          }
        : null;
  const idea =
    focusSpecificIdea ||
    variants[normalizedTopic]?.[index % variants[normalizedTopic].length] ||
    templates[normalizedTopic] ||
    templates["buyer education"];
  const focusedIdea = {
    ...idea,
    format: slotLabel ? `${slotLabel}: ${idea.format}` : idea.format,
  };

  if (index === 1 && normalizedTopic === "buyer education" && !slotLabel) {
    const budgetIdea = {
      ...focusedIdea,
      hook: `What your budget actually buys in ${state.market} right now`,
      format: `${formatLabel}: compare three price bands and the tradeoffs buyers should expect.`,
    };
    return {
      ...budgetIdea,
      videoPrompt: budgetIdea.videoPrompt || videoPromptFromIdea(budgetIdea),
    };
  }
  return {
    ...focusedIdea,
    videoPrompt: focusedIdea.videoPrompt || videoPromptFromIdea(focusedIdea),
  };
}

async function updateExtractedIdeaFromPayload(payload) {
  const fallbackIdea = buildExtractedIdeaFromPayload(payload);
  const runId = ++ideaGenerationRun;
  latestExtractedIdea = fallbackIdea;
  renderExtractedIdea(
    fallbackIdea
      ? {
          ...fallbackIdea,
          generationStatus: payload.cached?.stale
            ? "Showing the last saved draft idea."
            : "Drafting a concrete AI idea from the retrieved posts...",
        }
      : null
  );

  if (!fallbackIdea || payload.cached?.stale) {
    return;
  }

  let finalIdea = fallbackIdea;

  try {
    const aiPayload = await generateConcreteIdeaWithAI(payload, fallbackIdea);
    if (runId !== ideaGenerationRun) return;

    finalIdea = aiPayload.ok
      ? mergeAiIdea(fallbackIdea, aiPayload)
      : {
          ...fallbackIdea,
          id: `${fallbackIdea.id}-fallback`,
          title: `${fallbackIdea.title} (fallback)`,
          basis: `${fallbackIdea.basis} · AI not configured`,
          generationStatus: aiPayload.message || "AI idea generation is not configured.",
        };
  } catch (error) {
    if (runId !== ideaGenerationRun) return;
    finalIdea = {
      ...fallbackIdea,
      id: `${fallbackIdea.id}-fallback`,
      title: `${fallbackIdea.title} (fallback)`,
      basis: `${fallbackIdea.basis} · AI fallback`,
      generationStatus: `AI idea generation failed: ${error.message}`,
    };
  }

  latestExtractedIdea = finalIdea;
  renderExtractedIdea(finalIdea);
  saveExtractedIdea(finalIdea);
  saveVideoPromptFromIdea(finalIdea);
  renderSavedIdeas();
  renderVideoManager();
}

async function generateConcreteIdeaWithAI(payload, fallbackIdea) {
  const sourceId = state.signalSource || "instagram";
  const source = signalSources[sourceId] || signalSources.instagram;
  const analysis = payload.analysis || {};
  const response = await fetch(appPath("/api/ideas/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: state.displayName,
      market: state.market,
      audience: state.audience,
      primaryCta: state.primaryCta,
      focus: state.focus,
      sourceId,
      sourceLabel: source.label,
      retrievedCount: payload.media?.length || 0,
      recentCount: Number(analysis.recentCount || 0),
      hookPatterns: analysis.hookPatterns || [],
      topicCategories: analysis.topicCategories || [],
      formatMix: analysis.formatMix || [],
      fallbackIdea: fallbackIdea.idea,
      media: payload.media || [],
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "AI idea generation failed.");
  }
  return result;
}

function mergeAiIdea(fallbackIdea, aiPayload) {
  const idea = aiPayload.idea || {};
  const generated = {
    hook: idea.hook || fallbackIdea.idea.hook,
    format: idea.format || fallbackIdea.idea.format,
    caption: idea.caption || fallbackIdea.idea.caption,
    cta: idea.cta || fallbackIdea.idea.cta,
    videoPrompt: idea.videoPrompt || fallbackIdea.idea.videoPrompt || videoPromptFromIdea(fallbackIdea),
  };
  return {
    ...fallbackIdea,
    id: hashText(`${fallbackIdea.id}|${aiPayload.checkedAt}|${generated.hook}|${generated.caption}`),
    title: idea.title || fallbackIdea.title,
    basis: `${fallbackIdea.basis} · AI model ${aiPayload.model || "OpenAI"}`,
    generationStatus: idea.why || "Generated from retrieved captions and metrics.",
    aiGenerated: true,
    model: aiPayload.model || "",
    idea: generated,
    sourceSignals: idea.sourceSignals || [],
  };
}

function buildExtractedIdeaFromPayload(payload) {
  if (!payload.ok || !payload.media?.length) return null;

  const sourceId = state.signalSource || "instagram";
  const source = signalSources[sourceId] || signalSources.instagram;
  const analysis = payload.analysis || {};
  const topic = topSignal(analysis.topicCategories, "buyer education");
  const pattern = topSignal(analysis.hookPatterns, "direct advice");
  const format = topSignal(analysis.formatMix, "reel");
  const topPost = analysis.topPosts?.[0] || payload.media.slice().sort((a, b) => b.score - a.score)[0];
  const idea = ideaFromSignal({
    topic: topic.name,
    pattern: pattern.name,
    format: format.name,
    index: 0,
  });
  const checkedAt = payload.checkedAt || new Date().toISOString();
  const basis = [
    `${source.label}`,
    `${formatCount(topic)} topic`,
    `${formatCount(pattern)} hook`,
    `${formatCount(format)} format`,
    topPost ? `top post score ${formatNumber(topPost.score || 0)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: hashText(
      [
        sourceId,
        checkedAt,
        payload.media.length,
        topic.name,
        pattern.name,
        format.name,
        topPost?.id || topPost?.permalink || "",
      ].join("|")
    ),
    sourceId,
    sourceLabel: source.label,
    savedAt: new Date().toISOString(),
    checkedAt,
    retrievedCount: payload.media.length,
    recentCount: Number(analysis.recentCount || 0),
    title: `${source.label} ${topic.name} idea`,
    basis,
    signals: {
      topic: topic.name,
      topicCount: topic.count,
      pattern: pattern.name,
      patternCount: pattern.count,
      format: format.name,
      formatCount: format.count,
    },
    topPost: topPost
      ? {
          caption: topPost.caption || topPost.text || "",
          permalink: topPost.permalink || "",
          score: Number(topPost.score || 0),
        }
      : null,
    idea: {
      ...idea,
      videoPrompt: videoPromptFromIdea({
        sourceLabel: source.label,
        retrievedCount: payload.media.length,
        recentCount: Number(analysis.recentCount || 0),
        signals: {
          topic: topic.name,
          pattern: pattern.name,
          format: format.name,
        },
        topPost: topPost
          ? {
              caption: compactText(topPost.caption || "", 180),
              score: Number(topPost.score || 0),
            }
          : null,
        idea,
      }),
    },
  };
}

function normalizeVideoPromptDurationText(value) {
  return String(value || "")
    .replace(/\b15\s*[-–]\s*20\s*s\b/gi, "10-second")
    .replace(/\b15\s*[-–]\s*20\s*second[s]?\b/gi, "10-second")
    .replace(/\b15\s+to\s+20\s*second[s]?\b/gi, "10-second")
    .replace(/\b20\s*[-–]\s*30\s*s\b/gi, "10-second")
    .replace(/\b20\s*[-–]\s*30\s*second[s]?\b/gi, "10-second")
    .replace(/\b30\s*[-–]\s*45\s*s\b/gi, "10-second")
    .replace(/\b30\s*[-–]\s*45\s*second[s]?\b/gi, "10-second");
}

function videoPromptFromIdea(savedIdea) {
  const idea = savedIdea.idea || savedIdea;
  const topic = savedIdea.signals?.topic || "real estate";
  const pattern = savedIdea.signals?.pattern || "direct advice";
  const format = savedIdea.signals?.format || "short reel";
  const condensedFormat = normalizeVideoPromptDurationText(idea.format);
  const condensedCaption = normalizeVideoPromptDurationText(idea.caption);
  const reference = savedIdea.topPost?.caption ? ` Reference post pattern: ${savedIdea.topPost.caption}` : "";

  return [
    "Create a vertical 9:16 short-form real estate video preview, 10 seconds, natural smartphone footage style, polished but not overproduced.",
    "Use the attached Jenny Jun reference images if the video model supports image/reference inputs. Preserve her likeness as a polished North Dallas real estate advisor: warm smile, dark voluminous shoulder-length hair, professional navy wardrobe styling, and natural facial proportions.",
    `Concept: ${idea.hook}`,
    `Audience: North Dallas and DFW ${topic} viewers. Hook pattern: ${pattern}. Format inspiration: ${format}.`,
    "Scene plan: keep it to 3 beats only so it does not get cut off: 0-3s Jenny on camera with the hook, 3-7s one supporting real estate visual, 7-10s Jenny back on camera with the CTA.",
    `Use this idea as the source, but condense it for 10 seconds: ${condensedFormat}`,
    `Voiceover or on-screen narration, under 22 words total: ${condensedCaption}`,
    `On-screen text: open with a shortened version of "${idea.hook}", show one concise support label, and end with "${idea.cta}".`,
    "Visual direction: realistic North Dallas/DFW neighborhood feel, bright natural light, clean home details, no fake addresses, no fake prices, no fake client testimonials, no brokerage logos unless provided.",
    "Camera direction: one direct-to-camera opening shot, one quick b-roll cutaway, one direct-to-camera closing shot. Avoid trying to cover a longer full-length reel.",
    `End frame CTA: ${idea.cta}.${reference}`,
  ].join("\n");
}

function topSignal(rows, fallback) {
  const first = rows?.[0];
  return {
    name: first?.[0] || fallback,
    count: Number(first?.[1] || 0),
  };
}

function formatCount(signal) {
  if (!signal.count) return signal.name;
  return `${signal.name} (${formatNumber(signal.count)})`;
}

function compactText(value, limit = 120) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function renderExtractedIdea(savedIdea) {
  const panel = document.querySelector("#extractedIdeaPanel");
  if (!panel) return;

  if (!savedIdea) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  document.querySelector("#extractedIdeaTitle").textContent = savedIdea.title;
  document.querySelector("#extractedIdeaHook").textContent = savedIdea.idea.hook;
  document.querySelector("#extractedIdeaFormat").textContent = savedIdea.idea.format;
  document.querySelector("#extractedIdeaCaption").textContent = savedIdea.idea.caption;
  document.querySelector("#extractedIdeaCta").textContent = savedIdea.idea.cta;
  document.querySelector("#extractedVideoPrompt").value = savedIdea.idea.videoPrompt || videoPromptFromIdea(savedIdea);
  renderGeneratedVideo(savedIdea);
  document.querySelector("#extractedIdeaBasis").textContent = [
    savedIdea.basis,
    savedIdea.generationStatus,
    savedIdea.sourceSignals?.length ? `Why it fits: ${savedIdea.sourceSignals.join("; ")}` : "",
    savedIdea.recentCount !== savedIdea.retrievedCount
      ? `${formatNumber(savedIdea.recentCount)} recent / ${formatNumber(savedIdea.retrievedCount)} retrieved`
      : `${formatNumber(savedIdea.retrievedCount)} retrieved`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderGeneratedVideo(savedIdea) {
  const video = document.querySelector("#generatedVideo");
  const status = document.querySelector("#generatedVideoStatus");
  if (!video || !status) return;

  const matchingJob = readVideoJobs().find(
    (job) => job.ideaId && job.ideaId === savedIdea?.id && (job.localUrl || job.videoUrl)
  );
  const videoUrl = savedIdea.videoUrl || savedIdea.generatedVideoUrl || matchingJob?.localUrl || matchingJob?.videoUrl || "";
  if (!videoUrl) {
    video.hidden = true;
    video.removeAttribute("src");
    status.hidden = false;
    status.textContent = "No AI video yet. Use Saved > AI videos when you want to create one.";
    return;
  }

  video.src = appMediaUrl(videoUrl);
  video.hidden = false;
  status.hidden = true;
}

function readVideoJobs() {
  const rows = Array.isArray(libraryStore.videoJobs)
    ? libraryStore.videoJobs
    : readLocalRows(VIDEO_JOBS_KEY);
  return hydrateVideoJobLinks(rows);
}

function writeVideoJobs(rows) {
  const nextRows = rows.slice(0, MAX_VIDEO_JOBS);
  libraryStore.videoJobs = nextRows;
  localStorage.setItem(VIDEO_JOBS_KEY, JSON.stringify(nextRows));
  queueLibrarySave();
}

function regenerateStoredVideoPrompts() {
  const savedIdeas = readSavedIdeas();
  if (!savedIdeas.length) return { saved: 0, videos: 0 };

  const now = new Date().toISOString();
  let savedCount = 0;
  const nextSavedIdeas = savedIdeas.map((savedIdea) => {
    if (!savedIdea?.idea) return savedIdea;

    const nextPrompt = videoPromptFromIdea(savedIdea);
    if (!nextPrompt || savedIdea.idea.videoPrompt === nextPrompt) return savedIdea;

    savedCount += 1;
    return {
      ...savedIdea,
      promptRegeneratedAt: now,
      idea: {
        ...savedIdea.idea,
        videoPrompt: nextPrompt,
      },
    };
  });

  if (savedCount) {
    writeSavedIdeas(sortSavedIdeas(nextSavedIdeas));
  }

  let videoCount = 0;
  let rawRows = [];
  try {
    rawRows = JSON.parse(localStorage.getItem(VIDEO_JOBS_KEY) || "[]");
  } catch {
    rawRows = [];
  }

  if (Array.isArray(rawRows) && rawRows.length) {
    const nextRows = rawRows.map((job) => {
      const savedIdea = nextSavedIdeas.find((row) => row.id && row.id === job.ideaId);
      const nextPrompt = savedIdea?.idea?.videoPrompt;
      if (!nextPrompt || job.prompt === nextPrompt) return job;

      videoCount += 1;
      return {
        ...job,
        ...videoJobIdeaFields(savedIdea),
        prompt: nextPrompt,
        status: "prompt_ready",
        progress: 0,
        videoRequestId: "",
        openaiVideoId: "",
        videoUrl: "",
        localUrl: "",
        error: "",
        promptRegeneratedAt: now,
        updatedAt: now,
      };
    });
    if (videoCount) {
      writeVideoJobs(sortVideoJobs(nextRows));
      if (!nextRows.some((row) => row.id === selectedVideoJobId)) {
        selectedVideoJobId = "";
      }
    }
  }

  return { saved: savedCount, videos: videoCount };
}

function hydrateVideoJobLinks(rows) {
  const savedIdeas = readSavedIdeas();
  if (!savedIdeas.length || !rows.length) return rows;

  let changed = false;
  const linkedRows = rows.map((row) => {
    const savedIdea = findSavedIdeaForVideoJob(row, savedIdeas);
    if (!savedIdea) return row;

    const linked = attachIdeaToVideoJob(row, savedIdea);
    changed = changed || JSON.stringify(row) !== JSON.stringify(linked);
    return linked;
  });

  if (changed) {
    writeVideoJobs(sortVideoJobs(linkedRows));
  }

  return linkedRows;
}

function findSavedIdeaForVideoJob(job, savedIdeas = readSavedIdeas()) {
  if (!job || !savedIdeas.length) return null;

  if (job.ideaId) {
    const exact = savedIdeas.find((savedIdea) => savedIdea.id === job.ideaId);
    if (exact) return exact;
  }

  const scored = savedIdeas
    .map((savedIdea) => ({
      savedIdea,
      score: videoIdeaMatchScore(job, savedIdea),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 70 ? scored[0].savedIdea : null;
}

function videoIdeaMatchScore(job, savedIdea) {
  if (!job || !savedIdea) return 0;
  const prompt = normalizedPrompt(job.prompt);
  const savedPrompt = normalizedPrompt(savedIdea.idea?.videoPrompt || videoPromptFromIdea(savedIdea));
  const title = String(job.title || "").trim().toLowerCase();
  const ideaTitle = String(savedIdea.title || savedIdea.idea?.hook || "").trim().toLowerCase();
  let score = 0;

  if (job.ideaId && job.ideaId === savedIdea.id) score += 120;
  if (prompt && savedPrompt && prompt === savedPrompt) score += 95;
  if (title && ideaTitle && title === ideaTitle) score += 65;
  score += Math.round(textSimilarity(job.title || "", savedIdea.title || savedIdea.idea?.hook || "") * 45);
  score += Math.round(textSimilarity(videoJobPromptOpening(job), savedPrompt) * 35);
  return score;
}

function normalizedPrompt(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function videoJobIdeaFields(savedIdea) {
  const idea = savedIdea?.idea || {};
  return {
    ideaId: savedIdea?.id || "",
    ideaTitle: savedIdea?.title || idea.hook || "",
    ideaHook: idea.hook || "",
    ideaSourceLabel: savedIdea?.sourceLabel || "Posts",
    ideaSavedAt: savedIdea?.savedAt || "",
    ideaSnapshot: idea.hook
      ? {
          hook: idea.hook || "",
          format: idea.format || "",
          caption: idea.caption || "",
          cta: idea.cta || "",
          videoPrompt: idea.videoPrompt || videoPromptFromIdea(savedIdea),
        }
      : null,
  };
}

function attachIdeaToVideoJob(job, savedIdea) {
  return {
    ...job,
    ...videoJobIdeaFields(savedIdea),
    sourceLabel: job.sourceLabel || savedIdea?.sourceLabel || "Posts",
    title: job.title || savedIdea?.title || savedIdea?.idea?.hook || "Video prompt",
  };
}

function cleanVideoJobsData() {
  const before = readVideoJobs();
  const { rows, removed } = dedupeSimilarRows(before, areSimilarVideoJobs, preferredVideoJob);
  writeVideoJobs(sortVideoJobs(rows));
  if (!rows.some((row) => row.id === selectedVideoJobId)) {
    selectedVideoJobId = rows[0]?.id || "";
  }
  return { before: before.length, after: rows.length, removed };
}

function videoJobFromIdea(savedIdea) {
  const prompt = savedIdea?.idea?.videoPrompt || videoPromptFromIdea(savedIdea || {});
  const now = new Date().toISOString();
  return {
    id: `video-${hashText(`${savedIdea?.id || now}|${prompt}`)}`,
    ...videoJobIdeaFields(savedIdea),
    title: savedIdea?.title || savedIdea?.idea?.hook || "Video prompt",
    sourceLabel: savedIdea?.sourceLabel || "Posts",
    prompt,
    status: "prompt_ready",
    progress: 0,
    provider: "auto",
    model: "",
    seconds: "10",
    duration: "10",
    aspectRatio: "9:16",
    resolution: "720p",
    size: "720x1280",
    videoRequestId: "",
    openaiVideoId: "",
    videoUrl: "",
    localUrl: "",
    referenceImageCount: 0,
    error: "",
    createdAt: now,
    updatedAt: now,
  };
}

function saveVideoPromptFromIdea(savedIdea, select = false) {
  if (!savedIdea?.idea?.videoPrompt) return null;

  const rows = readVideoJobs();
  const job = videoJobFromIdea(savedIdea);
  const existing = rows.find(
    (row) =>
      row.id === job.id ||
      (row.ideaId && row.ideaId === job.ideaId) ||
      normalizedPrompt(row.prompt) === normalizedPrompt(job.prompt) ||
      areSimilarVideoJobs(row, job)
  );
  const linkedJob = existing
    ? attachIdeaToVideoJob(
        {
          ...existing,
          ...videoJobIdeaFields(savedIdea),
          title: job.title,
          sourceLabel: job.sourceLabel,
          prompt: job.prompt,
          updatedAt: job.updatedAt,
        },
        savedIdea
      )
    : job;
  const nextJob = existing
    ? {
        ...preferredVideoJob(existing, linkedJob),
        ...videoJobIdeaFields(savedIdea),
        title: job.title,
        sourceLabel: job.sourceLabel,
        prompt: job.prompt,
        updatedAt: job.updatedAt,
      }
    : linkedJob;
  const nextRows = existing
    ? rows.map((row) => (row.id === existing.id ? nextJob : row))
    : [nextJob, ...rows];

  writeVideoJobs(sortVideoJobs(dedupeSimilarRows(nextRows, areSimilarVideoJobs, preferredVideoJob).rows));
  if (select || !selectedVideoJobId) {
    selectedVideoJobId = nextJob.id;
  }
  return nextJob;
}

function clearVideoStatusTimer(id) {
  const timer = videoStatusTimers.get(id);
  if (!timer) return;
  window.clearTimeout(timer);
  videoStatusTimers.delete(id);
}

function scheduleVideoStatusRefresh(id, delay = 15000) {
  const job = readVideoJobs().find((row) => row.id === id);
  if (!videoJobRequestId(job) || !["queued", "in_progress"].includes(job.status)) return;

  clearVideoStatusTimer(id);
  videoStatusTimers.set(
    id,
    window.setTimeout(() => {
      videoStatusTimers.delete(id);
      refreshVideoJob(id, { auto: true });
    }, delay)
  );
}

function renderVideoManager() {
  const list = document.querySelector("#videoJobList");
  if (!list) return;

  const rows = readVideoJobs();
  if (!rows.some((row) => row.id === selectedVideoJobId)) {
    selectedVideoJobId = rows[0]?.id || "";
  }

  list.innerHTML = "";
  const title = document.querySelector("#video-manager-heading");
  if (title) title.textContent = `Video drafts (${formatNumber(rows.length)})`;

  const clearButton = document.querySelector("#clearVideoJobs");
  if (clearButton) clearButton.disabled = rows.length === 0;

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No video drafts saved yet.";
    list.append(empty);
    renderSelectedVideo(null);
    return;
  }

  rows.forEach((job) => {
    const item = document.createElement("article");
    item.className = `video-job-item${job.id === selectedVideoJobId ? " is-selected" : ""}`;

    const title = document.createElement("strong");
    title.textContent = job.title || "Video prompt";

    const ideaLink = document.createElement("span");
    ideaLink.className = `video-idea-link${job.ideaId ? " is-linked" : ""}`;
    ideaLink.textContent = videoJobIdeaLine(job);

    const meta = document.createElement("span");
    meta.textContent = [
      job.statusLabel || videoStatusLabel(job),
      job.progress ? `${job.progress}%` : "",
      job.updatedAt ? formatDateTime(job.updatedAt) : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const actions = document.createElement("div");
    actions.className = "video-job-actions";
    const createButton = videoJobButton(
      job.status === "completed" || job.localUrl || job.videoUrl ? "Regenerate in app" : "Create in app",
      "create",
      job.id
    );
  const requestId = videoJobRequestId(job);
  createButton.disabled = Boolean(
    job.status === "creating" || (requestId && ["queued", "in_progress"].includes(job.status))
  );
  const refreshButton = videoJobButton("Refresh", "refresh", job.id);
  refreshButton.disabled = !requestId;
  actions.append(
    videoJobButton("View", "view", job.id),
    videoJobButton("Upload", "upload", job.id),
    createButton,
    refreshButton,
    videoJobButton("Copy", "copy", job.id),
    videoJobButton("Delete", "delete", job.id)
  );

    item.append(title, ideaLink, meta, actions);
    list.append(item);
  });

  renderSelectedVideo(rows.find((row) => row.id === selectedVideoJobId) || null);
}

function videoJobButton(label, action, id) {
  const button = document.createElement("button");
  button.className = action === "delete" ? "button compact ghost" : "button compact";
  button.type = "button";
  button.dataset.videoJobAction = action;
  button.dataset.videoJobId = id;
  button.textContent = label;
  return button;
}

function renderSelectedVideo(job) {
  const title = document.querySelector("#selectedVideoTitle");
  const status = document.querySelector("#selectedVideoStatus");
  const ideaLink = document.querySelector("#selectedVideoIdeaLink");
  const prompt = document.querySelector("#selectedVideoPrompt");
  const player = document.querySelector("#selectedVideoPlayer");
  const copyButton = document.querySelector("#copySelectedVideoPrompt");
  const uploadButton = document.querySelector("#uploadSelectedVideo");
  if (!title || !status || !prompt || !player) return;

  if (!job) {
    title.textContent = "Choose a video draft";
    status.textContent = "Pick a draft or create one from today's idea.";
    if (ideaLink) {
      ideaLink.textContent = "";
      ideaLink.hidden = true;
    }
    prompt.value = "";
    player.hidden = true;
    player.removeAttribute("src");
    if (copyButton) copyButton.disabled = true;
    if (uploadButton) uploadButton.disabled = true;
    return;
  }

  title.textContent = job.title || "Video prompt";
  status.textContent = videoStatusLabel(job);
  if (ideaLink) {
    ideaLink.textContent = videoJobIdeaLine(job);
    ideaLink.hidden = false;
    ideaLink.classList.toggle("is-linked", Boolean(job.ideaId || job.ideaHook || job.ideaTitle));
  }
  prompt.value = job.prompt || "";
  if (copyButton) copyButton.disabled = !job.prompt;
  if (uploadButton) uploadButton.disabled = false;

  const videoUrl = job.localUrl || job.videoUrl || "";
  if (videoUrl) {
    player.src = appMediaUrl(videoUrl);
    player.hidden = false;
  } else {
    player.hidden = true;
    player.removeAttribute("src");
  }
}

function videoStatusLabel(job) {
  if (!job) return "";
  if (job.error) {
    return `${job.status === "prompt_ready" ? "Needs setup" : job.status || "Error"}: ${videoErrorLabel(job.error)}`;
  }
  if (job.status === "completed" && job.provider === "external_upload") return "Uploaded video";
  if (job.status === "completed") return "Completed";
  if (job.status === "uploading") return "Uploading video...";
  if (job.status === "queued") return "Queued";
  if (job.status === "in_progress") return `In progress${job.progress ? ` ${job.progress}%` : ""}`;
  if (job.status === "creating") return "Creating video...";
  return "Prompt ready";
}

function videoStatusSummaryLabel(job) {
  if (!job) return "";
  if (job.error) return videoErrorSummaryLabel(job.error);
  return videoStatusLabel(job);
}

function videoErrorLabel(error) {
  const text = String(error || "");
  if (/xai video (create|status): HTTP 403/i.test(text)) {
    return "xAI credits are not active yet. Check xAI Console > Billing/API Credits, then retry.";
  }
  return text;
}

function videoErrorSummaryLabel(error) {
  const text = String(error || "");
  if (/xai video (create|status): HTTP 403/i.test(text)) return "xAI credits not active";
  return compactText(videoErrorLabel(text), 44);
}

function videoJobRequestId(job) {
  return job?.videoRequestId || job?.openaiVideoId || "";
}

function videoJobProvider(job) {
  if (job?.provider && job.provider !== "auto") return job.provider;
  if (job?.openaiVideoId) return "openai";
  return "auto";
}

function videoJobIdeaLine(job) {
  const label = videoJobIdeaLabel(job);
  return label ? `Created from: ${compactText(label, 110)}` : "Created from: not linked";
}

function videoJobIdeaLabel(job) {
  if (!job) return "";
  const savedIdea = findSavedIdeaForVideoJob(job);
  return (
    savedIdea?.idea?.hook ||
    savedIdea?.title ||
    job.ideaHook ||
    job.ideaTitle ||
    job.ideaSnapshot?.hook ||
    ""
  );
}

function setVideoManagerStatus(message) {
  const status = document.querySelector("#videoManagerStatus");
  if (status) status.textContent = message;
  setLibraryStatus(message);
}

function updateVideoJob(id, patch) {
  const rows = readVideoJobs();
  const now = new Date().toISOString();
  writeVideoJobs(rows.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: now } : row)));
  renderVideoManager();
  renderSavedIdeas();
}

async function createVideoForJob(id, options = {}) {
  const job = readVideoJobs().find((row) => row.id === id);
  if (!job?.prompt) return;
  if (job.status === "creating" || ["queued", "in_progress"].includes(job.status)) {
    setVideoManagerStatus("This video job is already running.");
    return;
  }
  if (!options.force && job.status === "completed" && job.localUrl) {
    selectedVideoJobId = id;
    renderVideoManager();
    setVideoManagerStatus("This video is already ready to view.");
    return;
  }

  selectedVideoJobId = id;
  updateVideoJob(id, {
    status: "creating",
    progress: 0,
    videoRequestId: "",
    openaiVideoId: "",
    videoUrl: "",
    localUrl: "",
    error: "",
  });
  setVideoManagerStatus(options.force ? "Regenerating video job..." : "Creating video job...");

  try {
    const response = await fetch(appPath("/api/videos/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: job.prompt,
        provider: videoJobProvider(job),
        model: job.model || "",
        seconds: job.seconds || "10",
        duration: job.duration || job.seconds || "10",
        aspectRatio: job.aspectRatio || "9:16",
        resolution: job.resolution || "720p",
        size: job.size || "720x1280",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Video could not be created.");
    }

    const patch = videoPatchFromApi(payload.video);
    updateVideoJob(id, patch);
    setVideoManagerStatus("Video job created. The app will refresh status automatically.");
    if (["queued", "in_progress"].includes(patch.status)) {
      scheduleVideoStatusRefresh(id);
    }
  } catch (error) {
    updateVideoJob(id, { status: "prompt_ready", error: error.message });
    setVideoManagerStatus(error.message);
  }
}

async function refreshVideoJob(id, options = {}) {
  const job = readVideoJobs().find((row) => row.id === id);
  const requestId = videoJobRequestId(job);
  if (!requestId) {
    setVideoManagerStatus("No video job has been created yet.");
    return;
  }

  selectedVideoJobId = id;
  if (!options.auto) {
    setVideoManagerStatus("Refreshing video status...");
  }

  try {
    const response = await fetch(
      appPath(`/api/videos/status?id=${encodeURIComponent(requestId)}&provider=${encodeURIComponent(videoJobProvider(job))}`),
      {
        cache: "no-store",
      }
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Video status could not be refreshed.");
    }

    const patch = videoPatchFromApi(payload.video);
    updateVideoJob(id, patch);
    setVideoManagerStatus(payload.video.localUrl ? "Video ready." : `Video status: ${payload.video.status}`);
    if (["queued", "in_progress"].includes(patch.status)) {
      scheduleVideoStatusRefresh(id);
    } else {
      clearVideoStatusTimer(id);
    }
  } catch (error) {
    updateVideoJob(id, { error: error.message });
    setVideoManagerStatus(error.message);
    clearVideoStatusTimer(id);
  }
}

function uploadVideoForJob(id) {
  const job = readVideoJobs().find((row) => row.id === id);
  if (!job) {
    setVideoManagerStatus("Video draft was not found.");
    return;
  }

  pendingVideoUploadJobId = id;
  selectedVideoJobId = id;
  renderVideoManager();

  const input = document.querySelector("#videoUploadInput");
  if (!input) {
    setVideoManagerStatus("Video upload control is not available.");
    return;
  }
  input.value = "";
  input.click();
}

async function handleVideoUploadFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  const id = pendingVideoUploadJobId;
  pendingVideoUploadJobId = "";
  input.value = "";

  if (!file || !id) return;
  const job = readVideoJobs().find((row) => row.id === id);
  if (!job) {
    setVideoManagerStatus("Video draft was not found.");
    return;
  }

  selectedVideoJobId = id;
  updateVideoJob(id, {
    status: "uploading",
    progress: 0,
    provider: "external_upload",
    error: "",
  });
  setVideoManagerStatus(`Uploading ${file.name}...`);

  try {
    const body = new FormData();
    body.append("video", file);
    body.append("jobId", id);
    body.append("title", job.title || "Uploaded video");
    body.append("ideaId", job.ideaId || "");

    const response = await fetch(appPath("/api/videos/upload"), {
      method: "POST",
      body,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Video upload failed.");
    }

    updateVideoJob(id, {
      ...videoPatchFromApi(payload.video),
      status: "completed",
      provider: "external_upload",
      error: "",
      uploadedFileName: payload.video.fileName || file.name,
    });
    setVideoManagerStatus("Video uploaded and linked to this idea.");
  } catch (error) {
    updateVideoJob(id, {
      status: "prompt_ready",
      provider: job.provider || "auto",
      error: error.message,
    });
    setVideoManagerStatus(error.message);
  }
}

function videoPatchFromApi(video) {
  const provider = video.provider || "openai";
  const requestId = video.id || "";
  return {
    status: video.status || "queued",
    progress: Number(video.progress || 0),
    provider,
    videoRequestId: requestId,
    openaiVideoId: provider === "openai" ? requestId : "",
    model: video.model || "",
    seconds: video.seconds || video.duration || "",
    duration: video.duration || video.seconds || "",
    aspectRatio: video.aspectRatio || "",
    resolution: video.resolution || "",
    size: video.size || "",
    videoUrl: video.videoUrl || "",
    localUrl: video.localUrl || "",
    referenceImageCount: Number(video.referenceImageCount || 0),
    error: video.error || "",
    createdAt: video.createdAt || "",
    completedAt: video.completedAt || "",
    expiresAt: video.expiresAt || "",
  };
}

function saveCurrentVideoPrompt() {
  const job = saveVideoPromptFromIdea(latestExtractedIdea, true);
  renderVideoManager();
  setVideoManagerStatus(job ? "Video prompt saved." : "No video prompt is ready yet.");
}

function createVideoFromLatestIdea() {
  const job = saveVideoPromptFromIdea(latestExtractedIdea, true);
  renderVideoManager();
  if (!job) {
    setVideoManagerStatus("No video prompt is ready yet.");
    return;
  }
  createVideoForJob(job.id);
}

function handleVideoJobAction(event) {
  const button = event.target.closest("[data-video-job-action]");
  if (!button) return;

  const id = button.dataset.videoJobId;
  const action = button.dataset.videoJobAction;
  const rows = readVideoJobs();
  const job = rows.find((row) => row.id === id);

  if (action === "view") {
    selectedVideoJobId = id;
    renderVideoManager();
    return;
  }

  if (action === "create") {
    createVideoForJob(id);
    return;
  }

  if (action === "upload") {
    uploadVideoForJob(id);
    return;
  }

  if (action === "refresh") {
    refreshVideoJob(id);
    return;
  }

  if (action === "copy") {
    copyText(job?.prompt || "", "Video prompt copied", { button });
    setVideoManagerStatus("Video prompt copied.");
    return;
  }

  if (action === "delete") {
    clearVideoStatusTimer(id);
    writeVideoJobs(rows.filter((row) => row.id !== id));
    if (selectedVideoJobId === id) selectedVideoJobId = "";
    renderVideoManager();
    setVideoManagerStatus("Video job deleted.");
  }
}

function clearVideoJobs() {
  const rows = readVideoJobs();
  if (!rows.length) return;
  if (!window.confirm("Clear all video drafts?")) return;
  videoStatusTimers.forEach((timer) => window.clearTimeout(timer));
  videoStatusTimers.clear();
  writeVideoJobs([]);
  selectedVideoJobId = "";
  renderVideoManager();
  setVideoManagerStatus("Video drafts cleared.");
}

function cleanVideoJobs() {
  const result = cleanVideoJobsData();
  renderVideoManager();
  setVideoManagerStatus(
    result.removed
      ? `Removed ${formatNumber(result.removed)} duplicate video draft${result.removed === 1 ? "" : "s"}.`
      : "No duplicate video drafts found."
  );
  setLibraryStatus(`Video drafts: ${formatNumber(result.after)} kept`);
}

function dedupeSimilarRows(rows, isSimilar, preferred) {
  const kept = [];
  let removed = 0;

  rows.forEach((row) => {
    const index = kept.findIndex((existing) => isSimilar(existing, row));
    if (index === -1) {
      kept.push(row);
      return;
    }

    kept[index] = preferred(kept[index], row);
    removed += 1;
  });

  return { rows: kept, removed };
}

function areSimilarSavedIdeas(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;

  const hookScore = textSimilarity(a.idea?.hook || a.title || "", b.idea?.hook || b.title || "");
  const titleScore = textSimilarity(a.title || a.idea?.hook || "", b.title || b.idea?.hook || "");
  const score = textSimilarity(savedIdeaSimilarityText(a), savedIdeaSimilarityText(b));
  if (hookScore >= 0.42 || titleScore >= 0.48 || score >= 0.52) return true;

  const sameSignal =
    a.sourceId === b.sourceId &&
    a.signals?.topic === b.signals?.topic &&
    a.signals?.pattern === b.signals?.pattern &&
    a.signals?.format === b.signals?.format;
  return sameSignal && (hookScore >= 0.28 || titleScore >= 0.34 || score >= 0.38);
}

function preferredSavedIdea(a, b) {
  return savedIdeaQualityScore(b) > savedIdeaQualityScore(a) ? b : a;
}

function savedIdeaQualityScore(row) {
  const prompt = row?.idea?.videoPrompt || "";
  return (
    durationQualityScore(prompt) +
    (row?.aiGenerated ? 20 : 0) +
    (row?.sourceSignals?.length ? 8 : 0) +
    Math.min(20, prompt.length / 120) +
    recencyQualityScore(row?.savedAt || row?.checkedAt)
  );
}

function savedIdeaSimilarityText(row) {
  return [row?.idea?.hook, row?.title].filter(Boolean).join(" ");
}

function sortSavedIdeas(rows) {
  return rows
    .slice()
    .sort((a, b) => dateValue(b.savedAt || b.checkedAt) - dateValue(a.savedAt || a.checkedAt));
}

function areSimilarVideoJobs(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.ideaId && b.ideaId && a.ideaId === b.ideaId) return true;
  if (normalizedPrompt(a.prompt) && normalizedPrompt(a.prompt) === normalizedPrompt(b.prompt)) return true;

  const titleScore = textSimilarity(a.title || "", b.title || "");
  const promptScore = textSimilarity(videoJobPromptOpening(a), videoJobPromptOpening(b));
  return (
    titleScore >= 0.55 ||
    promptScore >= 0.85 ||
    textSimilarity(videoJobSimilarityText(a), videoJobSimilarityText(b)) >= 0.72
  );
}

function preferredVideoJob(a, b) {
  const winner = videoJobQualityScore(b) > videoJobQualityScore(a) ? b : a;
  return {
    ...winner,
    ideaId: winner.ideaId || a?.ideaId || b?.ideaId || "",
    ideaTitle: winner.ideaTitle || a?.ideaTitle || b?.ideaTitle || "",
    ideaHook: winner.ideaHook || a?.ideaHook || b?.ideaHook || "",
    ideaSourceLabel: winner.ideaSourceLabel || a?.ideaSourceLabel || b?.ideaSourceLabel || "",
    ideaSavedAt: winner.ideaSavedAt || a?.ideaSavedAt || b?.ideaSavedAt || "",
    ideaSnapshot: winner.ideaSnapshot || a?.ideaSnapshot || b?.ideaSnapshot || null,
  };
}

function videoJobQualityScore(row) {
  return (
    (isCurrentSavedIdeaVideo(row) ? 160 : 0) +
    (row?.localUrl || row?.videoUrl ? 200 : 0) +
    (row?.status === "completed" ? 80 : 0) +
    (videoJobRequestId(row) ? 50 : 0) +
    (["queued", "in_progress", "creating"].includes(row?.status) ? 20 : 0) +
    durationQualityScore(row?.prompt || "") +
    recencyQualityScore(row?.updatedAt || row?.createdAt)
  );
}

function isCurrentSavedIdeaVideo(row) {
  if (!row?.ideaId) return false;
  return readSavedIdeas().some((savedIdea) => savedIdea.id && savedIdea.id === row.ideaId);
}

function videoJobSimilarityText(row) {
  return [row?.title, videoJobPromptOpening(row)].filter(Boolean).join(" ");
}

function videoJobPromptOpening(row) {
  return String(row?.prompt || "").slice(0, 260);
}

function sortVideoJobs(rows) {
  return rows
    .slice()
    .sort((a, b) => dateValue(b.updatedAt || b.createdAt) - dateValue(a.updatedAt || a.createdAt));
}

function durationQualityScore(text) {
  const value = String(text || "").toLowerCase();
  if (/\b10\s*[-–]\s*second\b|\b10\s+second|\b10-second/.test(value)) return 90;
  if (/\b15\s*[-–]\s*20\b|\b15\s+to\s+20\b|\b15-20\s+second/.test(value)) return -10;
  if (/\b20\s*[-–]\s*30\b|\b20\s+to\s+30\b/.test(value)) return 30;
  if (/\b3[05]\s*[-–]\s*4[05]\b|\b35\s+to\s+45\b|\b45-second\b|\b45\s+second/.test(value)) return -30;
  return 0;
}

function recencyQualityScore(value) {
  const time = dateValue(value);
  if (!time) return 0;
  return Math.min(30, time / 1_000_000_000_000);
}

function dateValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function textSimilarity(a, b) {
  const left = similarityTokens(a);
  const right = similarityTokens(b);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });

  return intersection / new Set([...left, ...right]).size;
}

function similarityTokens(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/\b(relocating|relocation|moving|move)\b/g, "move")
    .replace(/\b(showings?|touring|tours?|walkthroughs?|buying|buy|buyers?|purchase|purchasing|hunting|shopping|searching)\b/g, "decision")
    .replace(/\b(choose|choosing|pick|picking|picked)\b/g, "choose")
    .replace(/\b(houses?|homes?)\b/g, "home")
    .replace(/\b(asks?|asking|checks?|questions?|things?|tips?)\b/g, "check")
    .replace(/\b(don'?t|do not|avoid|stop)\b/g, "avoid")
    .replace(/\b(dfw|north dallas|dallas|jun|residential|group|real estate|realtor)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "after",
    "your",
    "you",
    "youre",
    "are",
    "can",
    "from",
    "into",
    "this",
    "that",
    "these",
    "those",
    "video",
    "vertical",
    "reel",
    "seconds",
    "second",
    "style",
    "brand",
    "first",
    "single",
    "start",
    "waste",
    "weekend",
  ]);

  return new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stopWords.has(token))
  );
}

function cleanLibraryData() {
  const ideas = cleanSavedIdeasData();
  const videos = cleanVideoJobsData();
  renderSavedIdeas();
  renderVideoManager();
  setLibraryStatus(
    `Removed ${formatNumber(ideas.removed + videos.removed)} duplicate item${
      ideas.removed + videos.removed === 1 ? "" : "s"
    }.`
  );
  return { ideas, videos };
}

function setLibraryStatus(message) {
  const status = document.querySelector("#libraryStatus");
  if (status) status.textContent = message;
}

function readLocalRows(key) {
  try {
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function readSavedIdeas() {
  if (Array.isArray(libraryStore.savedIdeas)) return libraryStore.savedIdeas;
  return readLocalRows(SAVED_IDEAS_KEY);
}

function writeSavedIdeas(rows) {
  const nextRows = rows.slice(0, MAX_SAVED_IDEAS);
  libraryStore.savedIdeas = nextRows;
  localStorage.setItem(SAVED_IDEAS_KEY, JSON.stringify(nextRows));
  queueLibrarySave();
}

async function loadFilesystemLibrary() {
  try {
    const response = await fetch(appPath("/api/library"), { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Library could not be loaded.");
    }

    const filesystemIdeas = Array.isArray(payload.library?.savedIdeas)
      ? payload.library.savedIdeas
      : [];
    const filesystemVideos = Array.isArray(payload.library?.videoJobs)
      ? payload.library.videoJobs
      : [];
    const localIdeas = readLocalRows(SAVED_IDEAS_KEY);
    const localVideos = readLocalRows(VIDEO_JOBS_KEY);
    const mergedIdeas = mergeSavedIdeaRows(filesystemIdeas, localIdeas).slice(0, MAX_SAVED_IDEAS);
    const mergedVideos = mergeVideoJobRows(filesystemVideos, localVideos).slice(0, MAX_VIDEO_JOBS);

    libraryStore = {
      ...libraryStore,
      loaded: true,
      filePath: payload.filePath || "",
      videoDir: payload.videoDir || "",
      savedIdeas: mergedIdeas,
      videoJobs: mergedVideos,
    };

    localStorage.setItem(SAVED_IDEAS_KEY, JSON.stringify(mergedIdeas));
    localStorage.setItem(VIDEO_JOBS_KEY, JSON.stringify(mergedVideos));

    const shouldSave =
      !payload.exists ||
      mergedIdeas.length !== filesystemIdeas.length ||
      mergedVideos.length !== filesystemVideos.length ||
      JSON.stringify(mergedIdeas) !== JSON.stringify(filesystemIdeas) ||
      JSON.stringify(mergedVideos) !== JSON.stringify(filesystemVideos);
    if (shouldSave) {
      queueLibrarySave(0);
    }

    if (libraryStore.filePath) {
      setLibraryStatus(`Library stored at ${libraryStore.filePath}`);
    }
  } catch (error) {
    libraryStore.loaded = false;
    setLibraryStatus(`Using browser cache only. Filesystem library failed: ${error.message}`);
  }
}

function mergeSavedIdeaRows(...groups) {
  const rows = groups.flat().filter(Boolean);
  return sortSavedIdeas(dedupeSimilarRows(rows, areSimilarSavedIdeas, preferredSavedIdea).rows);
}

function mergeVideoJobRows(...groups) {
  const rows = groups.flat().filter(Boolean);
  return sortVideoJobs(dedupeSimilarRows(rows, areSimilarVideoJobs, preferredVideoJob).rows);
}

function queueLibrarySave(delay = 400) {
  if (libraryStore.saveTimer) {
    window.clearTimeout(libraryStore.saveTimer);
  }
  libraryStore.saveTimer = window.setTimeout(() => {
    libraryStore.saveTimer = null;
    persistFilesystemLibrary();
  }, delay);
}

async function persistFilesystemLibrary() {
  const savedIdeas = Array.isArray(libraryStore.savedIdeas)
    ? libraryStore.savedIdeas
    : readLocalRows(SAVED_IDEAS_KEY);
  const videoJobs = Array.isArray(libraryStore.videoJobs)
    ? libraryStore.videoJobs
    : readLocalRows(VIDEO_JOBS_KEY);

  try {
    const response = await fetch(appPath("/api/library"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedIdeas, videoJobs }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Library could not be saved.");
    }
    libraryStore.loaded = true;
    libraryStore.filePath = payload.filePath || libraryStore.filePath;
    libraryStore.videoDir = payload.videoDir || libraryStore.videoDir;
    if (libraryStore.filePath) {
      setLibraryStatus(`Library saved to ${libraryStore.filePath}`);
    }
  } catch (error) {
    setLibraryStatus(`Library save failed: ${error.message}`);
  }
}

function cleanSavedIdeasData() {
  const before = readSavedIdeas();
  const { rows, removed } = dedupeSimilarRows(before, areSimilarSavedIdeas, preferredSavedIdea);
  writeSavedIdeas(sortSavedIdeas(rows));
  return { before: before.length, after: rows.length, removed };
}

function saveExtractedIdea(savedIdea) {
  const rows = readSavedIdeas();
  const existing = rows.find((row) => row.id === savedIdea.id || areSimilarSavedIdeas(row, savedIdea));
  const nextRows = existing
    ? rows.map((row) => (row.id === existing.id ? preferredSavedIdea(row, savedIdea) : row))
    : [savedIdea, ...rows];
  writeSavedIdeas(sortSavedIdeas(dedupeSimilarRows(nextRows, areSimilarSavedIdeas, preferredSavedIdea).rows));
}

function renderSavedIdeas() {
  const list = document.querySelector("#savedIdeasList");
  const title = document.querySelector("#savedIdeasTitle");
  if (!list || !title) return;

  const rows = readSavedIdeas();
  const videoJobs = readVideoJobs();
  const rowIds = new Set(rows.map((row) => row.id));
  expandedSavedIdeaIds = new Set([...expandedSavedIdeaIds].filter((id) => rowIds.has(id)));
  title.textContent = `Saved ideas (${formatNumber(rows.length)})`;
  list.innerHTML = "";

  const clearButton = document.querySelector("#clearSavedIdeas");
  if (clearButton) clearButton.disabled = rows.length === 0;

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No saved ideas yet.";
    list.append(empty);
    return;
  }

  rows.forEach((savedIdea) => {
    const relatedJob = findVideoJobForSavedIdea(savedIdea, videoJobs);
    const isExpanded = expandedSavedIdeaIds.has(savedIdea.id);
    const item = document.createElement("article");
    item.className = `saved-idea-item${isExpanded ? " is-expanded" : ""}`;
    item.dataset.savedIdeaId = savedIdea.id;

    const row = document.createElement("div");
    row.className = "saved-idea-summary-row";
    row.dataset.savedIdeaToggle = savedIdea.id;

    const toggle = document.createElement("button");
    toggle.className = "saved-idea-toggle";
    toggle.type = "button";
    toggle.dataset.savedIdeaToggle = savedIdea.id;
    toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    toggle.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} saved idea`);
    toggle.textContent = isExpanded ? "v" : ">";

    const titleBlock = document.createElement("div");
    titleBlock.className = "saved-idea-title-block";
    const hook = document.createElement("strong");
    hook.textContent = savedIdea.idea?.hook || "Saved idea";
    const meta = document.createElement("span");
    meta.textContent = [
      savedIdea.sourceLabel || "Posts",
      savedIdea.savedAt ? formatDateTime(savedIdea.savedAt) : "",
      savedIdea.signals?.topic,
      savedIdea.signals?.pattern,
    ]
      .filter(Boolean)
      .join(" · ");
    titleBlock.append(hook, meta);

    const videoSummary = document.createElement("span");
    videoSummary.className = `saved-idea-row-status${relatedJob ? " is-linked" : ""}`;
    videoSummary.textContent = relatedJob ? `Video: ${videoStatusSummaryLabel(relatedJob)}` : "No video draft";

    row.append(toggle, titleBlock, videoSummary);

    const details = document.createElement("div");
    details.className = "saved-idea-details";
    details.hidden = !isExpanded;

    const actions = document.createElement("div");
    actions.className = "saved-idea-actions";
    actions.append(
      savedIdeaActionButton("Use in Today", "use", savedIdea.id),
      savedIdeaActionButton("Copy idea", "copy", savedIdea.id),
      savedIdeaActionButton("Delete idea", "delete", savedIdea.id)
    );

    const videoLink = document.createElement("p");
    videoLink.className = `saved-video-link${relatedJob ? " is-linked" : ""}`;
    videoLink.classList.toggle("is-error", Boolean(relatedJob?.error));
    videoLink.textContent = relatedJob
      ? `Video draft: ${videoStatusLabel(relatedJob)}`
      : "Video draft: not saved yet";
    const fullDetails = renderSavedIdeaFullDetails(savedIdea);
    const linkedVideo = renderSavedIdeaVideoBlock(savedIdea, relatedJob);

    details.append(actions, videoLink, fullDetails, linkedVideo);
    item.append(row, details);
    list.append(item);
  });
}

function renderSavedIdeaFullDetails(savedIdea) {
  const details = document.createElement("div");
  details.className = "saved-idea-full-details";
  const idea = savedIdea.idea || {};

  [
    ["Hook", idea.hook],
    ["Format", idea.format],
    ["Caption draft", idea.caption],
    ["CTA", idea.cta],
    ["Why this idea", savedIdea.basis],
    ["Source signals", savedIdea.sourceSignals?.join("; ")],
    ["Generation note", savedIdea.generationStatus],
  ].forEach(([label, value]) => {
    if (!value) return;
    details.append(savedIdeaDetailBlock(label, value));
  });

  const sourceMeta = [
    savedIdea.sourceLabel,
    savedIdea.recentCount || savedIdea.retrievedCount
      ? `${formatNumber(savedIdea.recentCount || 0)} recent / ${formatNumber(savedIdea.retrievedCount || 0)} retrieved`
      : "",
    savedIdea.savedAt ? `saved ${formatDateTime(savedIdea.savedAt)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (sourceMeta) details.append(savedIdeaDetailBlock("Source", sourceMeta));

  const topPostText = savedIdeaReferencePostText(savedIdea);
  if (topPostText) details.append(savedIdeaDetailBlock("Reference post", topPostText));

  return details;
}

function savedIdeaReferencePostText(savedIdea) {
  const topPost = savedIdea?.topPost || {};
  const permalink = topPost.permalink || "";
  let caption = topPost.caption || topPost.text || "";

  if (permalink && /(?:\.\.\.|…)\s*$/.test(caption)) {
    const cache = readSignalCache();
    const cachedMedia = Object.values(cache).flatMap((entry) => entry?.payload?.media || []);
    const match = cachedMedia.find((item) => item.permalink === permalink);
    if (match?.caption && match.caption.length > caption.length) {
      caption = match.caption;
    }
  }

  return [caption, permalink].filter(Boolean).join("\n");
}

function savedIdeaDetailBlock(label, value, mode = "text") {
  const block = document.createElement("section");
  block.className = "saved-idea-detail-block";
  const heading = document.createElement("span");
  heading.textContent = label;
  const body = mode === "pre" ? document.createElement("pre") : document.createElement("p");
  body.textContent = String(value || "");
  block.append(heading, body);
  return block;
}

function renderSavedIdeaVideoBlock(savedIdea, relatedJob) {
  const block = document.createElement("section");
  block.className = `saved-linked-video${relatedJob ? " is-linked" : " is-empty"}`;

  const header = document.createElement("div");
  header.className = "saved-linked-video-header";

  const titleBlock = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = relatedJob ? "Video draft for this idea" : "Video draft";
  const status = document.createElement("span");
  status.textContent = relatedJob
    ? videoStatusLabel(relatedJob)
    : "No video draft has been saved for this idea yet.";
  titleBlock.append(heading, status);

  const actions = document.createElement("div");
  actions.className = "saved-linked-video-actions";

  header.append(titleBlock);
  block.append(header);

  const source = document.createElement("p");
  source.className = "saved-linked-video-source";
  source.textContent = relatedJob
    ? [
        `Idea: ${compactText(savedIdea.idea?.hook || savedIdea.title || "Saved idea", 82)}`,
        relatedJob.referenceImageCount ? "Jenny reference used" : "",
        relatedJob.updatedAt ? `Updated ${formatDateTime(relatedJob.updatedAt)}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "Prompt ready from this idea. Save it as a video draft when you want to manage or create the AI video.";
  block.append(source);

  const videoUrl = relatedJob?.localUrl || relatedJob?.videoUrl || "";
  const promptPanel = document.createElement("section");
  promptPanel.className = "saved-linked-video-prompt";
  const promptHeader = document.createElement("div");
  promptHeader.className = "saved-linked-video-prompt-header";
  const promptLabel = document.createElement("span");
  promptLabel.textContent = "Video prompt";
  const promptActions = document.createElement("div");
  promptActions.className = "saved-linked-video-prompt-actions";
  promptActions.append(
    savedIdeaActionButton("Copy prompt", "copy-video", savedIdea.id),
    savedIdeaActionButton("Upload video", "upload-video", savedIdea.id),
    savedIdeaVideoCreateButton(savedIdea, relatedJob)
  );
  promptHeader.append(promptLabel, promptActions);
  const prompt = document.createElement("textarea");
  prompt.readOnly = true;
  prompt.value = relatedJob?.prompt || savedIdea.idea?.videoPrompt || videoPromptFromIdea(savedIdea);
  prompt.setAttribute("aria-label", "Video prompt linked to this saved idea");
  prompt.rows = 6;
  promptPanel.append(promptHeader, prompt);
  block.append(promptPanel);

  if (videoUrl) {
    const output = document.createElement("div");
    output.className = "saved-linked-video-output";
    const outputLabel = document.createElement("span");
    outputLabel.textContent = "Generated video";
    const video = document.createElement("video");
    video.controls = true;
    video.src = appMediaUrl(videoUrl);
    output.append(outputLabel, video);
    block.append(output);
  }

  return block;
}

function savedIdeaVideoCreateButton(savedIdea, relatedJob) {
  const button = savedIdeaActionButton("Create in app", "create-video", savedIdea.id);

  if (relatedJob?.status === "creating" || ["queued", "in_progress"].includes(relatedJob?.status)) {
    button.textContent = "Creating...";
    button.disabled = true;
  } else if (relatedJob?.localUrl || relatedJob?.videoUrl) {
    button.textContent = "Regenerate in app";
  } else if (relatedJob?.status === "completed") {
    button.textContent = "Regenerate in app";
  } else if (relatedJob?.error) {
    button.textContent = "Retry video";
  }

  return button;
}

function linkedVideoActionButton(label, action, id) {
  const button = document.createElement("button");
  button.className = action === "delete" ? "button compact ghost" : "button compact";
  button.type = "button";
  button.dataset.linkedVideoAction = action;
  button.dataset.videoJobId = id;
  button.textContent = label;
  return button;
}

function savedIdeaActionButton(label, action, id) {
  const button = document.createElement("button");
  button.className = action === "delete" ? "button compact ghost" : "button compact";
  button.type = "button";
  button.dataset.savedIdeaAction = action;
  button.dataset.savedIdeaId = id;
  button.textContent = label;
  return button;
}

function findVideoJobForSavedIdea(savedIdea, videoJobs = readVideoJobs()) {
  if (!savedIdea) return null;
  const savedPrompt = normalizedPrompt(savedIdea.idea?.videoPrompt || videoPromptFromIdea(savedIdea));
  return (
    videoJobs.find((job) => job.ideaId && job.ideaId === savedIdea.id) ||
    videoJobs.find((job) => savedPrompt && normalizedPrompt(job.prompt) === savedPrompt) ||
    null
  );
}

function useIdeaInBrief(idea) {
  if (!idea) return;
  const existing = Array.isArray(state.ideas) ? state.ideas : structuredClone(starterIdeas);
  state.ideas = [structuredClone(idea), ...existing.slice(1)].slice(0, 3);
  while (state.ideas.length < 3) {
    state.ideas.push(structuredClone(starterIdeas[state.ideas.length] || starterIdeas[0]));
  }
  renderIdeas();
  renderPrompt();
  markDirty();
  goToPage("today");
}

function handleSavedIdeaAction(event) {
  const linkedVideoButton = event.target.closest("[data-linked-video-action]");
  if (linkedVideoButton) {
    handleLinkedVideoAction(linkedVideoButton);
    return;
  }

  const toggle = event.target.closest("[data-saved-idea-toggle]");
  if (toggle) {
    const id = toggle.dataset.savedIdeaToggle;
    if (expandedSavedIdeaIds.has(id)) {
      expandedSavedIdeaIds.delete(id);
    } else {
      expandedSavedIdeaIds.add(id);
    }
    renderSavedIdeas();
    return;
  }

  const button = event.target.closest("[data-saved-idea-action]");
  if (!button) return;

  const id = button.dataset.savedIdeaId;
  const action = button.dataset.savedIdeaAction;
  const rows = readSavedIdeas();
  const savedIdea = rows.find((row) => row.id === id);

  if (action === "use") {
    useIdeaInBrief(savedIdea?.idea);
    return;
  }

  if (action === "copy") {
    copyText(savedIdeaMarkdown(savedIdea), "Idea copied", { button });
    return;
  }

  if (action === "copy-video") {
    copyText(savedIdea?.idea?.videoPrompt || videoPromptFromIdea(savedIdea), "Video prompt copied", { button });
    return;
  }

  if (action === "open-video") {
    const job = saveVideoPromptFromIdea(savedIdea, true);
    expandedSavedIdeaIds.add(id);
    renderSavedIdeas();
    renderVideoManager();
    setVideoManagerStatus(job ? "Video draft linked to the saved idea." : "No video prompt is ready yet.");
    document
      .querySelector(`[data-saved-idea-id="${id}"] .saved-linked-video`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (action === "create-video") {
    let job = findVideoJobForSavedIdea(savedIdea);
    if (!job) {
      job = saveVideoPromptFromIdea(savedIdea, true);
    }
    if (!job) {
      setVideoManagerStatus("No video prompt is ready yet.");
      return;
    }
    expandedSavedIdeaIds.add(id);
    selectedVideoJobId = job.id;
    renderSavedIdeas();
    renderVideoManager();
    createVideoForJob(job.id, {
      force: Boolean(job.status === "completed" || job.localUrl || job.videoUrl),
    });
    return;
  }

  if (action === "upload-video") {
    let job = findVideoJobForSavedIdea(savedIdea);
    if (!job) {
      job = saveVideoPromptFromIdea(savedIdea, true);
    }
    if (!job) {
      setVideoManagerStatus("No video prompt is ready yet.");
      return;
    }
    expandedSavedIdeaIds.add(id);
    selectedVideoJobId = job.id;
    renderSavedIdeas();
    renderVideoManager();
    uploadVideoForJob(job.id);
    return;
  }

  if (action === "delete") {
    expandedSavedIdeaIds.delete(id);
    writeSavedIdeas(rows.filter((row) => row.id !== id));
    renderSavedIdeas();
  }
}

function handleLinkedVideoAction(button) {
  const id = button.dataset.videoJobId;
  const action = button.dataset.linkedVideoAction;
  const rows = readVideoJobs();
  const job = rows.find((row) => row.id === id);

  if (!job) {
    setVideoManagerStatus("Video draft was not found.");
    renderSavedIdeas();
    return;
  }

  if (action === "view") {
    selectedVideoJobId = id;
    if (job.ideaId) expandedSavedIdeaIds.add(job.ideaId);
    renderVideoManager();
    if (job.ideaId) {
      document
        .querySelector(`[data-saved-idea-id="${job.ideaId}"] .saved-linked-video`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  if (action === "create") {
    selectedVideoJobId = id;
    createVideoForJob(id, {
      force: Boolean(job.status === "completed" || job.localUrl || job.videoUrl),
    });
    return;
  }

  if (action === "upload") {
    uploadVideoForJob(id);
    return;
  }

  if (action === "copy") {
    copyText(job.prompt || "", "Video prompt copied", { button });
    setVideoManagerStatus("Video prompt copied.");
    return;
  }

  if (action === "delete") {
    clearVideoStatusTimer(id);
    writeVideoJobs(rows.filter((row) => row.id !== id));
    if (selectedVideoJobId === id) selectedVideoJobId = "";
    renderSavedIdeas();
    renderVideoManager();
    setVideoManagerStatus("Video draft deleted.");
  }
}

function clearSavedIdeas() {
  const rows = readSavedIdeas();
  if (!rows.length) return;
  if (!window.confirm("Clear all saved ideas?")) return;
  writeSavedIdeas([]);
  renderSavedIdeas();
  setLibraryStatus("Saved ideas cleared.");
}

function cleanSavedIdeas() {
  const result = cleanSavedIdeasData();
  renderSavedIdeas();
  setLibraryStatus(
    result.removed
      ? `Removed ${formatNumber(result.removed)} duplicate saved idea${result.removed === 1 ? "" : "s"}.`
      : "No duplicate saved ideas found."
  );
}

function savedIdeaMarkdown(savedIdea) {
  if (!savedIdea?.idea) return "";
  return `# ${savedIdea.title || "Saved filming idea"}

Source: ${savedIdea.sourceLabel || "Posts"}
Why this was saved:
${savedIdea.basis || ""}

Hook:
${savedIdea.idea.hook}

Format:
${savedIdea.idea.format}

Caption:
${savedIdea.idea.caption}

CTA:
${savedIdea.idea.cta}

Video prompt:
${savedIdea.idea.videoPrompt || videoPromptFromIdea(savedIdea)}
`;
}

function briefMarkdown() {
  const ideas = state.ideas
    .map(
      (idea, index) => `## Idea ${index + 1}

Hook:
${idea.hook}

Format:
${idea.format}

Caption:
${idea.caption}

CTA:
${idea.cta}

Video prompt:
${idea.videoPrompt || videoPromptFromIdea(idea)}`
    )
    .join("\n\n");

  return `# Jenny's Contents Daily Brief

${buildPrompt()}

${ideas}
`;
}

async function saveBriefToDrive() {
  const button = document.querySelector("#saveBrief");
  const saveState = document.querySelector("#saveState");
  const briefStatus = document.querySelector("#briefSaveStatus");
  const originalButtonText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving...";
  saveState.textContent = "Saving brief...";
  if (briefStatus) {
    briefStatus.hidden = false;
    briefStatus.textContent = "Saving brief...";
  }

  try {
    const response = await fetch(appPath("/api/brief/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: briefMarkdown(),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Brief could not be saved.");
    }

    const savedAt = formatDateTime(new Date().toISOString());
    const fileName = payload.filePath ? payload.filePath.split(/[\\/]/).pop() : "";
    const location = payload.drive?.uploaded ? "Drive" : "this computer";
    const message = `Brief saved to ${location}${fileName ? ` (${fileName})` : ""} at ${savedAt}`;
    saveState.textContent = payload.drive?.uploaded ? "Brief saved to Drive" : "Brief saved locally";
    button.textContent = "Saved";
    if (briefStatus) {
      briefStatus.hidden = false;
      briefStatus.textContent = message;
    }
  } catch (error) {
    const message = `Save failed: ${error.message}`;
    saveState.textContent = message;
    if (briefStatus) {
      briefStatus.hidden = false;
      briefStatus.textContent = message;
    }
  } finally {
    button.disabled = false;
    window.clearTimeout(saveBriefToDrive.buttonTimer);
    saveBriefToDrive.buttonTimer = window.setTimeout(() => {
      button.textContent = originalButtonText || "Save today's brief";
    }, 1400);
  }
}

async function copyText(text, label = "Copied", options = {}) {
  const value = String(text || "");
  const copied = value ? await writeClipboardText(value) : false;
  const selected = !copied && value && options.selectSelector ? selectTextForManualCopy(options.selectSelector) : false;
  const message = copied
    ? label
    : selected
      ? "Prompt selected. Press Cmd+C to copy."
      : value
        ? "Copy failed. Select the text and copy manually."
        : "Nothing to copy.";
  showCopyFeedback(message, {
    ...options,
    buttonLabel: copied ? "Copied" : selected ? "Selected" : "Copy failed",
  });
  return copied;
}

async function writeClipboardText(value) {
  if (copyWithSelection(value)) {
    return true;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function copyWithSelection(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0.01";
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function selectTextForManualCopy(selector) {
  const field = document.querySelector(selector);
  if (!field || typeof field.select !== "function") return false;

  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, field.value.length);
  return true;
}

function showCopyFeedback(message, options = {}) {
  const saveState = document.querySelector("#saveState");
  if (saveState) {
    saveState.textContent = message;
    window.clearTimeout(showCopyFeedback.saveTimer);
    showCopyFeedback.saveTimer = window.setTimeout(() => {
      saveState.textContent = "Saved locally";
    }, 1500);
  }

  if (options.statusSelector) {
    const status = document.querySelector(options.statusSelector);
    if (status) {
      status.hidden = false;
      status.textContent = message;
      window.clearTimeout(showCopyFeedback.statusTimers?.[options.statusSelector]);
      showCopyFeedback.statusTimers = showCopyFeedback.statusTimers || {};
      showCopyFeedback.statusTimers[options.statusSelector] = window.setTimeout(() => {
        status.textContent = options.restoreStatus || "Ready";
        status.hidden = Boolean(options.restoreHidden);
      }, 1800);
    }
  }

  if (options.button) {
    const original = options.button.dataset.originalText || options.button.textContent;
    options.button.dataset.originalText = original;
    options.button.textContent = options.buttonLabel || "Copied";
    window.clearTimeout(options.button.copyFeedbackTimer);
    options.button.copyFeedbackTimer = window.setTimeout(() => {
      options.button.textContent = original;
    }, 1400);
  }
}

function downloadBrief() {
  const blob = new Blob([briefMarkdown()], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `jennyscontents-${stamp}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function togglePromptPanel() {
  const panel = document.querySelector("#promptPanel");
  const button = document.querySelector("#togglePrompt");
  const willShow = panel.hidden;
  panel.hidden = !willShow;
  button.textContent = willShow ? "Hide prompt" : "Show prompt";
  button.setAttribute("aria-expanded", willShow ? "true" : "false");
}

function createReelPreviewController() {
  const scenes = Array.from(document.querySelectorAll("[data-reel-scene]"));
  const playButton = document.querySelector("#reelPreviewPlay");
  const resetButton = document.querySelector("#reelPreviewReset");
  const progress = document.querySelector("#reelPreviewProgress");
  const sceneDurations = [3000, 5000, 6000, 6000];
  const totalDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);
  let currentScene = 0;
  let isPlaying = false;
  let startTime = null;
  let animationFrame = null;
  let delayedPlayTimer = null;

  function showScene(index) {
    scenes.forEach((scene, sceneIndex) => {
      scene.classList.toggle("is-active", sceneIndex === index);
    });
    currentScene = index;
  }

  function updateProgress(elapsed) {
    if (!progress) return;
    const percent = Math.min((elapsed / totalDuration) * 100, 100);
    progress.style.width = `${percent}%`;
  }

  function sceneIndexForElapsed(elapsed) {
    let cumulative = 0;
    for (let index = 0; index < sceneDurations.length; index += 1) {
      cumulative += sceneDurations[index];
      if (elapsed < cumulative) return index;
    }
    return sceneDurations.length - 1;
  }

  function animate(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const nextScene = sceneIndexForElapsed(elapsed);

    updateProgress(elapsed);
    if (nextScene !== currentScene) {
      showScene(nextScene);
    }

    if (elapsed < totalDuration) {
      animationFrame = window.requestAnimationFrame(animate);
      return;
    }

    isPlaying = false;
    animationFrame = null;
    updateProgress(totalDuration);
    if (playButton) playButton.textContent = "Replay";
  }

  function cancel() {
    if (delayedPlayTimer) {
      window.clearTimeout(delayedPlayTimer);
      delayedPlayTimer = null;
    }
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function reset() {
    cancel();
    isPlaying = false;
    startTime = null;
    showScene(0);
    updateProgress(0);
    if (playButton) playButton.textContent = "Play";
  }

  function play() {
    if (isPlaying || !scenes.length) return;
    isPlaying = true;
    startTime = null;
    if (playButton) playButton.textContent = "Playing...";
    animationFrame = window.requestAnimationFrame(animate);
  }

  function playFromStart() {
    reset();
    delayedPlayTimer = window.setTimeout(() => {
      delayedPlayTimer = null;
      play();
    }, 150);
  }

  playButton?.addEventListener("click", () => {
    if (progress?.style.width === "100%") {
      reset();
    }
    play();
  });
  resetButton?.addEventListener("click", reset);
  reset();

  return { play, reset, playFromStart };
}

function attachActions() {
  document.querySelectorAll("[data-page-link]").forEach((button) => {
    button.addEventListener("click", () => goToPage(button.dataset.pageLink));
  });
  window.addEventListener("hashchange", () => renderPage());
  document.querySelector("#copyStrategy").addEventListener("click", () => copyText(briefMarkdown(), "Brief copied"));
  document.querySelector("#copyPrompt").addEventListener("click", () => copyText(buildPrompt(), "Prompt copied"));
  document.querySelector("#downloadBrief").addEventListener("click", downloadBrief);
  document.querySelector("#togglePrompt").addEventListener("click", togglePromptPanel);
  document.querySelector("#refreshInstagram").addEventListener("click", loadInstagramData);
  document.querySelector("#generateIdeas").addEventListener("click", generateIdeasFromSignals);
  document.querySelector("#postSort").addEventListener("change", (event) => {
    state.mediaSort = event.target.value;
    if (latestInstagramPayload?.media) {
      renderInstagramRows(latestInstagramPayload.media);
    }
    markDirty();
  });
  document.querySelector("#saveBrief").addEventListener("click", saveBriefToDrive);
  document.querySelector("#useExtractedIdea").addEventListener("click", () => useIdeaInBrief(latestExtractedIdea?.idea));
  document.querySelector("#copyVideoPrompt").addEventListener("click", (event) => {
    const prompt = latestExtractedIdea?.idea?.videoPrompt || document.querySelector("#extractedVideoPrompt").value;
    copyText(prompt, "Video prompt copied", {
      button: event.currentTarget,
      statusSelector: "#videoPromptCopyStatus",
      restoreStatus: "Ready to copy",
      selectSelector: "#extractedVideoPrompt",
    });
  });
  document.querySelector("#saveVideoPrompt").addEventListener("click", saveCurrentVideoPrompt);
  document.querySelector("#createVideoFromIdea").addEventListener("click", createVideoFromLatestIdea);
  document.querySelector("#cleanVideoJobs").addEventListener("click", cleanVideoJobs);
  document.querySelector("#clearVideoJobs").addEventListener("click", clearVideoJobs);
  document.querySelector("#videoJobList").addEventListener("click", handleVideoJobAction);
  document.querySelector("#uploadSelectedVideo").addEventListener("click", () => {
    if (!selectedVideoJobId) {
      setVideoManagerStatus("Choose a video draft before uploading.");
      return;
    }
    uploadVideoForJob(selectedVideoJobId);
  });
  document.querySelector("#videoUploadInput").addEventListener("change", handleVideoUploadFile);
  document.querySelector("#copySelectedVideoPrompt").addEventListener("click", (event) => {
    const prompt = document.querySelector("#selectedVideoPrompt").value;
    copyText(prompt, "Video prompt copied", {
      button: event.currentTarget,
      statusSelector: "#videoManagerStatus",
      restoreStatus:
        "Refresh saves one reusable video prompt. Create an AI video only when you are ready.",
      selectSelector: "#selectedVideoPrompt",
    });
  });
  document.querySelector("#savedIdeasList").addEventListener("click", handleSavedIdeaAction);
  document.querySelector("#cleanSavedIdeas").addEventListener("click", cleanSavedIdeas);
  document.querySelector("#clearSavedIdeas").addEventListener("click", clearSavedIdeas);
  document.querySelector("#importTikTokPosts").addEventListener("click", () => toggleTikTokImportPanel(true));
  document.querySelector("#closeTikTokImport").addEventListener("click", () => toggleTikTokImportPanel(false));
  document.querySelector("#saveTikTokImport").addEventListener("click", importTikTokPosts);
  document.querySelector("#clearTikTokImport").addEventListener("click", clearTikTokImports);
  document.querySelector("#tiktokImportFile").addEventListener("change", handleTikTokImportFile);
  document.querySelector("#loadTikTokTemplate").addEventListener("click", loadTikTokImportTemplate);
  document.querySelector("#addTikTokSinglePost").addEventListener("click", addSingleTikTokPost);
  document.querySelector("#signalCacheList").addEventListener("click", handleSignalCacheAction);
  document.querySelector("#clearSignalCache").addEventListener("click", () => clearSignalCache());
  document.querySelectorAll("[data-signal-source]").forEach((button) => {
    button.addEventListener("click", () => {
      loadSignalData(button.dataset.signalSource);
      markDirty();
    });
  });
  document.querySelector("#resetDemo").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TIKTOK_IMPORT_KEY);
    localStorage.removeItem(SIGNAL_CACHE_KEY);
    writeSavedIdeas([]);
    writeVideoJobs([]);
    videoStatusTimers.forEach((timer) => window.clearTimeout(timer));
    videoStatusTimers.clear();
    selectedVideoJobId = "";
    latestExtractedIdea = null;
    state = loadState();
    setupStoredInputs();
    renderFocusPlan();
    renderPrompt();
    renderIdeas();
    renderPostSortControl();
    renderExtractedIdea(null);
    renderSavedIdeas();
    renderVideoManager();
    renderManagedData();
    goToPage("today");
    persist();
  });
}

function setupReviewMode() {
  const connect = document.querySelector("#facebookConnect");
  if (!connect) return;

  if (isStaticReviewMode()) {
    connect.href = facebookReviewLoginUrl();
    connect.textContent = sessionStorage.getItem(REVIEW_TOKEN_KEY)
      ? "Reconnect Instagram"
      : "Connect Instagram";
    connect.title = "GitHub Pages review mode uses a short-lived browser token and stores it only in session storage.";
    return;
  }

  connect.href = appPath("/auth/facebook/start");
}

async function bootApp() {
  setupStoredInputs();
  renderSourceTabs();
  renderSourceTools();
  renderMetricLabels(signalSources[state.signalSource] || signalSources.instagram);
  renderFocusPlan();
  renderPrompt();
  renderIdeas();
  renderPostSortControl();
  renderExtractedIdea(null);
  renderSavedIdeas();
  renderVideoManager();
  renderManagedData();
  setupReviewMode();
  attachActions();
  renderPage();

  await loadFilesystemLibrary();
  const promptMigrationResult = regenerateStoredVideoPrompts();
  cleanLibraryData();
  renderSavedIdeas();
  renderVideoManager();
  renderManagedData();
  if (promptMigrationResult.saved || promptMigrationResult.videos) {
    setLibraryStatus(
      `Regenerated ${formatNumber(promptMigrationResult.saved)} saved idea prompt${
        promptMigrationResult.saved === 1 ? "" : "s"
      } and ${formatNumber(promptMigrationResult.videos)} video draft prompt${
        promptMigrationResult.videos === 1 ? "" : "s"
      }.`
    );
  } else if (libraryStore.filePath) {
    setLibraryStatus(`Library stored at ${libraryStore.filePath}`);
  }

  loadInstagramData();
  persist();
}

bootApp();
