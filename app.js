const STORAGE_KEY = "jennyscontents.v1";

const platforms = [
  {
    id: "x",
    label: "X",
    name: "X",
    handle: "@JunResidential",
    links: [
      ["Sign up", "https://x.com/i/flow/signup"],
      ["Profile settings", "https://x.com/settings/profile"],
      ["Analytics", "https://analytics.x.com/"],
      ["Developer console", "https://console.x.com/"],
    ],
    tasks: [
      "Claim the brand handle",
      "Upload profile image and header",
      "Add bio, service area, and link-in-bio URL",
      "Enable two-factor authentication",
      "Pin the current buyer or seller CTA post",
      "Create X API app and validate the Bearer token",
    ],
  },
  {
    id: "instagram",
    label: "Instagram",
    name: "Instagram",
    handle: "@junresidentialgroup",
    links: [
      ["Sign up", "https://www.instagram.com/accounts/emailsignup/"],
      ["Professional setup", "https://www.instagram.com/accounts/convert_to_professional_account/"],
      ["Meta Business", "https://business.facebook.com/"],
      ["Meta Developers", "https://developers.facebook.com/apps/"],
    ],
    tasks: [
      "Claim the matching handle",
      "Switch to a professional account",
      "Choose real estate or entrepreneur category",
      "Connect the Facebook Page for Meta tools",
      "Turn on contact buttons and insights",
      "Create Meta app and validate Instagram token",
    ],
  },
  {
    id: "tiktok",
    label: "TikTok",
    name: "TikTok",
    handle: "@junresidential",
    links: [
      ["Sign up", "https://www.tiktok.com/signup"],
      ["Business suite", "https://www.tiktok.com/business-suite"],
      ["Creator center", "https://www.tiktok.com/creator-center"],
      ["Developer portal", "https://developers.tiktok.com/"],
    ],
    tasks: [
      "Claim the matching handle",
      "Add profile image, service area, and CTA",
      "Choose creator or business account mode",
      "Enable analytics after the account is live",
      "Post three starter videos before inviting traffic",
      "Create TikTok developer app and validate Display API token",
    ],
  },
];

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
  accountHandles: {
    x: "@JennyJunHomes",
    instagram: "@jennyjunhomes",
    tiktok: "@jennyjunhomes",
  },
  ideaHooks: [
    "The first question I ask every Chicago suburbs buyer in 2026",
    "A seller mistake that quietly costs showings in the first 72 hours",
    "What your budget actually buys in the Chicago suburbs right now",
  ],
};

let state = loadState();

function loadState() {
  const defaults = {
    displayName: "Jun Residential Group",
    market: "North Dallas and DFW",
    audience: "buyers, sellers, and relocating families",
    primaryCta: "DM me 'DFW' for the North Dallas guide",
    focus: "3 reels I can film in under 45 minutes",
    analytics: "",
    pillarMarket: true,
    pillarBuyer: true,
    pillarSeller: true,
    pillarLocal: true,
    accounts: {},
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

  next.accounts = { ...(saved.accounts || {}) };
  platforms.forEach((platform) => {
    const account = { ...(next.accounts[platform.id] || {}) };
    if (account.handle === legacyDefaults.accountHandles[platform.id]) {
      account.handle = platform.handle;
      next.accounts[platform.id] = account;
    }
  });

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
      renderPrompt();
      markDirty();
    });
  });
}

function renderAccounts() {
  const grid = document.querySelector("#accountGrid");
  const template = document.querySelector("#accountCardTemplate");
  grid.innerHTML = "";

  platforms.forEach((platform) => {
    const accountState = state.accounts[platform.id] || {};
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".platform-label").textContent = platform.label;
    card.querySelector("h3").textContent = platform.name;

    const status = card.querySelector(".status-select");
    status.value = accountState.status || "Not started";
    status.addEventListener("input", () => {
      updateAccount(platform.id, { status: status.value });
    });

    const handle = card.querySelector(".handle-input");
    handle.value = accountState.handle || platform.handle;
    handle.addEventListener("input", () => {
      updateAccount(platform.id, { handle: handle.value });
    });

    const links = card.querySelector(".link-row");
    platform.links.forEach(([label, url]) => {
      const link = document.createElement("a");
      link.className = "external-link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = label;
      links.append(link);
    });

    const tasks = card.querySelector(".task-list");
    platform.tasks.forEach((task, index) => {
      const taskKey = `${platform.id}-${index}`;
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(accountState.tasks?.[taskKey]);
      checkbox.addEventListener("input", () => {
        const nextTasks = { ...(state.accounts[platform.id]?.tasks || {}) };
        nextTasks[taskKey] = checkbox.checked;
        updateAccount(platform.id, { tasks: nextTasks });
      });
      label.append(checkbox, task);
      tasks.append(label);
    });

    grid.append(card);
  });

  renderProgress();
}

function updateAccount(id, patch) {
  state.accounts[id] = { ...(state.accounts[id] || {}), ...patch };
  renderProgress();
  markDirty();
}

function renderProgress() {
  const total = platforms.reduce((count, platform) => count + platform.tasks.length + 1, 0);
  const done = platforms.reduce((count, platform) => {
    const account = state.accounts[platform.id] || {};
    const live = account.status === "Live" ? 1 : 0;
    const taskDone = Object.values(account.tasks || {}).filter(Boolean).length;
    return count + live + taskDone;
  }, 0);
  document.querySelector("#setupProgress").textContent = `${Math.round((done / total) * 100)}%`;
}

async function loadInstagramData() {
  const status = document.querySelector("#instagramStatus");
  const button = document.querySelector("#refreshInstagram");

  status.textContent = "Refreshing Instagram data...";
  button.disabled = true;

  try {
    const response = await fetch("/api/instagram/summary?limit=12", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      renderInstagramData(payload);
      return;
    }

    renderInstagramData(payload);
  } catch (error) {
    renderInstagramError(error.message);
  } finally {
    button.disabled = false;
  }
}

function renderInstagramData(payload) {
  const account = payload.account;
  const analysis = payload.analysis || {};
  const totals = analysis.totals || {};
  const media = payload.media || [];

  document.querySelector("#instagramStatus").textContent = instagramStatusText(payload);
  document.querySelector("#instagramAccount").textContent = account
    ? `@${account.username || account.id} (${account.authMode.replace("_", " ")})`
    : "Not connected";
  document.querySelector("#instagramRecentCount").textContent = formatNumber(analysis.recentCount || 0);
  document.querySelector("#instagramViews").textContent = formatNumber(totals.views || 0);
  document.querySelector("#instagramSavesShares").textContent = formatNumber(
    (totals.saves || 0) + (totals.shares || 0)
  );

  renderCountList("#instagramHookPatterns", analysis.hookPatterns || []);
  renderCountList("#instagramTopics", analysis.topicCategories || []);
  renderCountList("#instagramFormats", analysis.formatMix || []);
  renderInstagramRows(media);
  renderSourceStatus(payload.sourceStatus || [], payload.warnings || []);
}

function instagramStatusText(payload) {
  if (payload.configured === false) return "Instagram token is not configured.";
  if (!payload.ok) return payload.message || "Instagram data could not be loaded.";
  const checked = payload.checkedAt ? `Last checked ${formatDateTime(payload.checkedAt)}.` : "";
  if (!payload.media?.length) {
    return `Connected, but no Instagram media was returned. ${checked}`;
  }
  return `Connected and loaded ${payload.media.length} Instagram media item(s). ${checked}`;
}

function renderInstagramError(message) {
  document.querySelector("#instagramStatus").textContent = `Instagram data failed: ${message}`;
  document.querySelector("#instagramAccount").textContent = "Not loaded";
  document.querySelector("#instagramRecentCount").textContent = "0";
  document.querySelector("#instagramViews").textContent = "0";
  document.querySelector("#instagramSavesShares").textContent = "0";
  renderCountList("#instagramHookPatterns", []);
  renderCountList("#instagramTopics", []);
  renderCountList("#instagramFormats", []);
  renderInstagramRows([]);
  renderSourceStatus([], []);
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
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No Instagram media returned yet.";
    row.append(cell);
    body.append(row);
    return;
  }

  media
    .slice()
    .sort((a, b) => b.score - a.score)
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

function mediaPostCell(item) {
  const cell = document.createElement("td");
  const link = document.createElement("a");
  link.href = item.permalink || "#";
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = postTitle(item);

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

  cell.append(link, meta);
  return cell;
}

function postTitle(item) {
  const caption = String(item.caption || "").trim().replace(/\s+/g, " ");
  if (caption) return caption.length > 84 ? `${caption.slice(0, 81)}...` : caption;
  return item.permalink ? "Open Instagram post" : "Instagram post";
}

function sourceLabel(item) {
  if (item.source === "hashtag_top_media") return item.hashtag ? `#${item.hashtag}` : "hashtag";
  if (item.source === "owned_media") return "owned";
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

  return `CONTENT STRATEGY - ${today}

Brand: ${state.displayName}
Market: ${state.market}
Audience: ${state.audience}
Content pillars: ${selectedPillars()}
Primary CTA: ${state.primaryCta}
Today's filming focus: ${state.focus}

Use the available social data sources for the last 7 days:
- X recent search for public real estate posts.
- Instagram owned media insights and approved hashtag discovery results.
- TikTok owned video analytics, approved Research API results, or manually collected public examples.

Identify:
1. Hook patterns getting saves and shares.
2. Format structures that are repeatable for a local real estate agent.
3. Topic categories resonating with buyers, sellers, and relocation audiences.

Where saves and shares are unavailable for public examples, use the available proxy metrics and state the limitation.

Review my own analytics from the last 30 days:
${state.analytics || "[Paste analytics here before running.]"}

Find the overlap between what is working broadly and what is working for my audience.

Give me 3 reel ideas to film today. Each idea should include:
- Hook
- Format
- Caption draft
- CTA

Output the final plan as a concise filming brief that can be saved to the Google Drive Content folder.`;
}

function renderPrompt() {
  document.querySelector("#promptPreview").textContent = buildPrompt();
}

function renderIdeas() {
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
${idea.cta}`
    )
    .join("\n\n");

  return `# Jenny's Contents Daily Brief

${buildPrompt()}

${ideas}
`;
}

async function copyText(text, label = "Copied") {
  await navigator.clipboard.writeText(text);
  const saveState = document.querySelector("#saveState");
  saveState.textContent = label;
  window.setTimeout(() => {
    saveState.textContent = "Saved locally";
  }, 1200);
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

function attachActions() {
  document.querySelector("#copyStrategy").addEventListener("click", () => copyText(briefMarkdown(), "Brief copied"));
  document.querySelector("#copyPrompt").addEventListener("click", () => copyText(buildPrompt(), "Prompt copied"));
  document.querySelector("#downloadBrief").addEventListener("click", downloadBrief);
  document.querySelector("#refreshInstagram").addEventListener("click", loadInstagramData);
  document.querySelector("#seedIdeas").addEventListener("click", () => {
    state.ideas = structuredClone(starterIdeas);
    renderIdeas();
    markDirty();
  });
  document.querySelector("#resetDemo").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    setupStoredInputs();
    renderAccounts();
    renderPrompt();
    renderIdeas();
    persist();
  });
}

setupStoredInputs();
renderAccounts();
renderPrompt();
renderIdeas();
attachActions();
loadInstagramData();
persist();
