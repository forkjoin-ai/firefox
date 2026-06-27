/* community-home.js — self-contained vanilla port of halo-community
 * (community.forkjoin.ai) for the packaged about:community page. No React, no
 * bundler, no npm imports: plain DOM + fetch + the shared window.KenomaIdentity
 * SSO API.
 *
 * The page runs from a chrome://branding (about:community) origin, so it ALWAYS
 * talks to the absolute backend base (cross-origin, allowed by the page CSP
 * connect-src + halo-community's `Access-Control-Allow-Origin: *` headers).
 *
 * Surface — "the rolling community canvas": a stats header, the daily community
 * sites grid (a new open collaboration space spawns every day, three live at a
 * time; each card links out to /site/{hash} on community.forkjoin.ai), the
 * recent activity feed, and a static "how it works" rail. Identity is OPTIONAL
 * here (community is identity-optional): if the Kenoma SSO bridge is present we
 * surface the signed-in badge and forward the token, otherwise we degrade to a
 * "sign in" pill — every read endpoint used here is public.
 *
 * Deliberately SKIPPED (heavy / write / auth-gated, out of scope for a
 * dependency-free read page): the ESIDream generative shell + POST /api/esi/
 * inference, dream seed/state persistence (GET/PUT /api/dream/state), the
 * UCAN-gated presence WebSocket (/api/presence/connect), site creation/upload
 * + AFFECT burn (POST /api/sites), the Aeon Container code execution + IDE
 * (/api/container/*), and the agent / personal-assistant / wisdom / ecology
 * dashboards. */
"use strict";

const HTTP_BASE = "https://community.forkjoin.ai";

const state = {
  badge: null, // { token, did, profile } | null
};

const dom = {};

// ── helpers ───────────────────────────────────────────────────────────────────
function el(id) {
  return document.getElementById(id);
}

async function getJSON(path) {
  const headers = { accept: "application/json" };
  if (state.badge && state.badge.token) {
    headers.authorization = `Bearer ${state.badge.token}`;
  }
  const res = await fetch(`${HTTP_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function timeAgo(value) {
  if (!value) return "";
  const t = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function hoursLeft(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return 0;
  return Math.floor(diff / 3600000);
}

function dayLabel(value) {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── render: stats ─────────────────────────────────────────────────────────────
function renderStats(data) {
  if (!data) return;
  const active = data.active_sites ?? data.total_sites ?? 0;
  const total = data.total_sites ?? 0;
  const contributors = data.total_contributors ?? 0;
  dom.liveCount.textContent = `${active} live`;
  dom.totalCount.textContent = `${total} all-time`;
  dom.contribCount.textContent = `${contributors} contributors`;
}

// ── render: daily community sites ─────────────────────────────────────────────
// /api/sites/daily returns the NORMALIZED shape:
//   { siteHash, title, description, createdAt, expiresAt, status }
function renderSites(rows) {
  clear(dom.siteGrid);
  if (!rows || !rows.length) {
    dom.sitesBoard.hidden = true;
    return 0;
  }
  dom.sitesBoard.hidden = false;
  rows.forEach((row, i) => {
    const hash = row.siteHash || "";
    const card = document.createElement("a");
    card.className = `site-card${i === 0 ? " site-card--today" : ""}`;
    card.href = `${HTTP_BASE}/site/${encodeURIComponent(hash)}`;
    card.rel = "noopener noreferrer";

    const head = document.createElement("div");
    head.className = "site-head";
    const date = document.createElement("span");
    date.className = "site-date";
    date.textContent = dayLabel(row.createdAt) || hash;
    head.appendChild(date);
    if (i === 0) {
      const badge = document.createElement("span");
      badge.className = "site-badge";
      badge.textContent = "TODAY";
      head.appendChild(badge);
    }
    card.appendChild(head);

    const title = document.createElement("span");
    title.className = "site-title";
    title.textContent = row.title || hash || "community space";
    card.appendChild(title);

    if (row.description) {
      const desc = document.createElement("p");
      desc.className = "site-desc";
      desc.textContent = String(row.description).slice(0, 200);
      card.appendChild(desc);
    }

    const foot = document.createElement("div");
    foot.className = "site-foot";
    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = `community.forkjoin.ai/site/${hash}`;
    foot.appendChild(host);
    const hrs = hoursLeft(row.expiresAt);
    if (hrs !== null) {
      const timer = document.createElement("span");
      timer.className = "site-timer";
      timer.textContent = hrs > 0 ? `${hrs}h remaining` : "expired";
      foot.appendChild(timer);
    }
    card.appendChild(foot);

    dom.siteGrid.appendChild(card);
  });
  return rows.length;
}

// ── render: activity feed ─────────────────────────────────────────────────────
function renderFeed(items) {
  clear(dom.feedList);
  if (!items || !items.length) {
    dom.feedBoard.hidden = true;
    return 0;
  }
  dom.feedBoard.hidden = false;
  for (const item of items.slice(0, 30)) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "feed-text";
    text.textContent =
      item.title || item.message || item.summary || item.type || "activity";
    const time = document.createElement("span");
    time.className = "feed-time";
    time.textContent = timeAgo(item.timestamp || item.createdAt || item.ts);
    li.appendChild(text);
    li.appendChild(time);
    dom.feedList.appendChild(li);
  }
  return items.length;
}

// ── identity (optional) ───────────────────────────────────────────────────────
function renderIdentity() {
  const b = state.badge;
  if (b && b.profile) {
    const kind = b.profile.participantKind || "human";
    const short = (b.did || "").replace(/^did:[^:]+:/, "").slice(0, 14);
    dom.identityLabel.textContent = short ? `${kind} · ${short}` : kind;
    dom.identityDot.classList.add("on");
    dom.identityBtn.title = b.did || "Signed in";
  } else {
    dom.identityLabel.textContent = "sign in";
    dom.identityDot.classList.remove("on");
    dom.identityBtn.title = "Sign in with ForkJoin identity";
  }
}

async function refreshIdentity() {
  try {
    if (window.KenomaIdentity && window.KenomaIdentity.getBadge) {
      state.badge = await window.KenomaIdentity.getBadge();
    } else {
      state.badge = null;
    }
  } catch {
    state.badge = null;
  }
  renderIdentity();
}

async function onIdentityClick() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.signIn) {
    try {
      window.location.href = "about:id";
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    if (state.badge) {
      await window.KenomaIdentity.signOut?.();
      state.badge = null;
    } else {
      state.badge = await window.KenomaIdentity.signIn();
    }
  } catch {
    /* ignore — degrade silently */
  }
  renderIdentity();
}

// ── load ──────────────────────────────────────────────────────────────────────
async function load() {
  dom.statusLine.textContent = "Loading the community canvas…";
  dom.emptyState.hidden = true;
  try {
    const [stats, daily, feed] = await Promise.allSettled([
      getJSON("/api/stats"),
      getJSON("/api/sites/daily"),
      getJSON("/api/activity-feed"),
    ]);

    if (stats.status === "fulfilled") {
      renderStats(stats.value && stats.value.data);
    }

    let siteCount = 0;
    if (daily.status === "fulfilled") {
      const rows = (daily.value && daily.value.data) || [];
      siteCount = renderSites(rows);
    }

    let feedCount = 0;
    if (feed.status === "fulfilled") {
      const items = (feed.value && feed.value.items) || [];
      feedCount = renderFeed(items);
    }

    if (!siteCount) {
      dom.emptyState.hidden = false;
      dom.emptyState.textContent =
        "No community sites are live yet — the first one of the day appears here shortly after midnight UTC.";
      dom.statusLine.textContent = "community.forkjoin.ai · 0 live";
    } else {
      dom.statusLine.textContent = `community.forkjoin.ai · ${siteCount} live · ${feedCount} recent events`;
    }
  } catch (e) {
    dom.statusLine.textContent = "Could not reach community.forkjoin.ai.";
    dom.emptyState.hidden = false;
    dom.emptyState.textContent = `Network error: ${(e && e.message) || "unknown"}`;
  }
}

function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function startIdentity() {
  if (window.KenomaIdentity && window.KenomaIdentity.onChange) {
    window.KenomaIdentity.onChange(() => {
      refreshIdentity();
    });
  }
  refreshIdentity();
}

function init() {
  dom.liveCount = el("live-count");
  dom.totalCount = el("total-count");
  dom.contribCount = el("contrib-count");
  dom.refreshBtn = el("refresh-btn");
  dom.identityBtn = el("identity-btn");
  dom.identityLabel = el("identity-label");
  dom.identityDot = dom.identityBtn.querySelector(".dot-id");
  dom.clock = el("clock");
  dom.statusLine = el("status-line");
  dom.sitesBoard = el("sites-board");
  dom.siteGrid = el("site-grid");
  dom.feedBoard = el("feed-board");
  dom.feedList = el("feed-list");
  dom.emptyState = el("empty-state");

  dom.refreshBtn.addEventListener("click", load);
  dom.identityBtn.addEventListener("click", onIdentityClick);

  updateClock();
  setInterval(updateClock, 30000);

  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    window.addEventListener("KenomaIdentity:ready", startIdentity, {
      once: true,
    });
    renderIdentity();
  }

  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
