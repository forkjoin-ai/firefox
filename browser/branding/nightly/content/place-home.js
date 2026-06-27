/* place-home.js — self-contained vanilla port of halo-place (place.forkjoin.ai)
 * for the packaged about:place page. No React, no bundler, no npm imports:
 * plain DOM + fetch + the shared window.KenomaIdentity SSO API.
 *
 * The page runs from a chrome://branding (about:place) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src
 * + halo-place's `Access-Control-Allow-Origin: *` headers).
 *
 * Surface — "what ephemeral places are live right now": a stats header, the live
 * public site directory (each card links out to the running {hash}.halo.place site),
 * and the recent activity feed. Identity is OPTIONAL here (public/geo app): if the
 * Kenoma SSO bridge is present we surface the signed-in badge, otherwise we degrade
 * to a "sign in" pill — the read endpoints never require auth.
 *
 * Deliberately SKIPPED (heavy / write / auth-gated, out of scope for a dependency-
 * free read page): site creation/upload/renew, AFFECT-token purchase + Stripe
 * webhooks, UCAN-gated Aeon Container code execution + the in-browser IDE, agent
 * dashboards/cron, per-site collaborative state (PUT /state), and geolocation
 * (no core read endpoint consumes coordinates). */
"use strict";

const HTTP_BASE = "https://place.forkjoin.ai";
// Individual ephemeral sites are served from {siteHash}.halo.place.
const SITE_DOMAIN = "halo.place";

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

function parseMetadata(row) {
  let meta = {};
  try {
    if (row && typeof row.metadata_json === "string" && row.metadata_json) {
      meta = JSON.parse(row.metadata_json) || {};
    }
  } catch {
    /* ignore malformed metadata */
  }
  return meta;
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

function expiryLabel(value) {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  const diff = t - Date.now();
  if (diff <= 0) return "expired";
  const hr = Math.round(diff / 3600000);
  if (hr < 1) return `expires in ${Math.round(diff / 60000)}m`;
  if (hr < 48) return `expires in ${hr}h`;
  return `expires in ${Math.round(hr / 24)}d`;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── render: stats ───────────────────────────────────────────────────────────
function renderStats(data) {
  if (!data) return;
  const active = data.active_sites ?? data.total_sites ?? 0;
  const total = data.total_sites ?? 0;
  dom.liveCount.textContent = `${active} live`;
  dom.totalCount.textContent = `${total} all-time`;
}

// ── render: directory ───────────────────────────────────────────────────────
function renderSites(rows) {
  clear(dom.siteGrid);
  if (!rows || !rows.length) {
    dom.sitesBoard.hidden = true;
    return;
  }
  dom.sitesBoard.hidden = false;
  for (const row of rows) {
    const meta = parseMetadata(row);
    const hash = row.site_hash || "";
    const tier = (row.execution_tier || "static").toLowerCase();
    const card = document.createElement("a");
    card.className = "site-card";
    card.href = `https://${hash}.${SITE_DOMAIN}`;
    card.rel = "noopener noreferrer";

    const head = document.createElement("div");
    head.className = "site-head";
    const title = document.createElement("span");
    title.className = "site-title";
    title.textContent = meta.title || hash || "untitled place";
    const tierEl = document.createElement("span");
    tierEl.className = `site-tier${tier === "ide" ? " ide" : ""}`;
    tierEl.textContent = tier;
    head.appendChild(title);
    head.appendChild(tierEl);
    card.appendChild(head);

    if (meta.description) {
      const desc = document.createElement("p");
      desc.className = "site-desc";
      desc.textContent = String(meta.description).slice(0, 180);
      card.appendChild(desc);
    }

    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = `${hash}.${SITE_DOMAIN}`;
    card.appendChild(host);

    const tags = Array.isArray(meta.tags) ? meta.tags.slice(0, 4) : [];
    if (tags.length) {
      const metaRow = document.createElement("div");
      metaRow.className = "site-meta";
      for (const tag of tags) {
        const t = document.createElement("span");
        t.className = "tag";
        t.textContent = `#${String(tag).slice(0, 24)}`;
        metaRow.appendChild(t);
      }
      card.appendChild(metaRow);
    }

    const expiry = expiryLabel(row.expires_at);
    if (expiry) {
      const exp = document.createElement("span");
      exp.className = "site-expiry";
      exp.textContent = expiry;
      card.appendChild(exp);
    }

    dom.siteGrid.appendChild(card);
  }
}

// ── render: activity feed ───────────────────────────────────────────────────
function renderFeed(items) {
  clear(dom.feedList);
  if (!items || !items.length) {
    dom.feedBoard.hidden = true;
    return;
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
}

// ── identity (optional) ─────────────────────────────────────────────────────
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
    // No SSO bridge in this context → point at the identity hub.
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

// ── load ─────────────────────────────────────────────────────────────────────
async function load() {
  dom.statusLine.textContent = "Loading live places…";
  dom.emptyState.hidden = true;
  try {
    const [stats, directory, feed] = await Promise.allSettled([
      getJSON("/api/stats"),
      getJSON("/api/directory"),
      getJSON("/api/activity-feed"),
    ]);

    if (stats.status === "fulfilled") renderStats(stats.value && stats.value.data);

    let siteRows = [];
    if (directory.status === "fulfilled") {
      siteRows = (directory.value && directory.value.data) || [];
      renderSites(siteRows);
    }

    let feedItems = [];
    if (feed.status === "fulfilled") {
      feedItems = (feed.value && feed.value.items) || [];
      renderFeed(feedItems);
    }

    if (!siteRows.length && !feedItems.length) {
      dom.emptyState.hidden = false;
      dom.emptyState.textContent =
        "No ephemeral places are live right now. They appear here the moment an agent spins one up.";
      dom.statusLine.textContent = "place.forkjoin.ai · 0 live";
    } else {
      dom.statusLine.textContent = `place.forkjoin.ai · ${siteRows.length} live · ${feedItems.length} recent events`;
    }
  } catch (e) {
    dom.statusLine.textContent = "Could not reach place.forkjoin.ai.";
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

  // Identity bridge may not be injected yet at load.
  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    window.addEventListener("KenomaIdentity:ready", startIdentity, {
      once: true,
    });
    // Still render the signed-out pill immediately.
    renderIdentity();
  }

  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
