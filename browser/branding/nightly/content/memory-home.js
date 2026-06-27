/* memory-home.js — self-contained vanilla port of the Fractal Memory workspace
 * for the packaged about:memex page. No React, no bundler, no npm imports: plain
 * DOM + fetch + the shared window.KenomaIdentity SSO bridge. Logic ported from the
 * apps/fractal-memory /api contract (src/worker.ts: /api/meta + the space-scoped
 * /api/spaces/{space}/api/memory/{recent,pinned,feed} read endpoints).
 *
 * The page runs from a chrome://branding (about:memex) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src +
 * fractal-memory's /api CORS headers: ACAO *, methods GET/POST/OPTIONS, allow-headers
 * content-type+authorization).
 *
 * Scope — "my memory workspace at a glance": fabric status (public /api/meta),
 * identity badge (KenomaIdentity), pinned entries, recent memory pool, activity feed.
 * Deliberately SKIPPED (heavy / write-heavy / not expressible dependency-free):
 *   - collaborative-stack live editing (the CRDT collab Durable Object + /collab/.../ws
 *     WebSocket channel),
 *   - ops/mutation writes, sync pull/snapshot CRDT replication, relation-graph viz,
 *     audit-chain verification.
 * Identity: memory reads require a UCAN-capability bearer per space. We pass the
 * KenomaIdentity badge token as `Authorization: Bearer <token>` best-effort and
 * DEGRADE gracefully (public status + sign-in prompt) on 401/absent identity. */
"use strict";

const HTTP_BASE = "https://memory.forkjoin.ai";
const DEFAULT_SPACE = "global";

const state = {
  space: DEFAULT_SPACE,
  token: null, // fractal-iam badge JWT (best-effort UCAN bearer)
  profile: null, // decoded badge profile
  loading: false,
};

const dom = {};

// ── helpers ─────────────────────────────────────────────────────────────────
function el(id) {
  return document.getElementById(id);
}

function show(node, visible) {
  if (node) {
    node.hidden = !visible;
  }
}

function setStatus(text) {
  if (dom.statusLine) {
    dom.statusLine.textContent = text;
  }
}

function clear(node) {
  while (node && node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function relTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) {
    return "—";
  }
  const diff = Date.now() - n;
  const s = Math.round(diff / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(n).toLocaleDateString();
}

function previewPayload(payload) {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload !== "object") {
    return String(payload);
  }
  // Prefer common human fields the memory entries carry.
  const keys = ["text", "title", "summary", "content", "name", "label", "body", "note"];
  for (const k of keys) {
    if (typeof payload[k] === "string" && payload[k].trim()) {
      return payload[k];
    }
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

function truncate(text, max) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ── fetch ─────────────────────────────────────────────────────────────────--
async function apiGet(path) {
  const headers = { accept: "application/json" };
  if (state.token) {
    headers.authorization = `Bearer ${state.token}`;
  }
  const res = await fetch(HTTP_BASE + path, {
    method: "GET",
    headers,
    mode: "cors",
    credentials: "omit",
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, ok: res.ok, body };
}

function spaceBase() {
  return `/api/spaces/${encodeURIComponent(state.space)}/api/memory`;
}

// ── render: fabric status ─────────────────────────────────────────────────--
// NOTE: memory.forkjoin.ai/api/meta is the *landing* surface (no CORS). Only the
// fractal-memory worker routes (/api/spaces/.../memory/*) send CORS headers, so we
// derive status from the memory worker itself — even an unauthorized probe (HTTP 401
// WITH access-control-allow-origin) confirms the fabric is reachable cross-origin.
function setMeta(online, version) {
  el("meta-service").textContent = "fractal-memory";
  el("meta-sub").textContent = online ? "shared memory fabric · online" : "unreachable";
  const stats = el("meta-stats");
  clear(stats);
  const rows = [
    ["space", state.space],
    ["status", online ? "online" : "offline"],
    ["version", version || "—"],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    stats.append(dt, dd);
  }
  show(dom.metaCard, true);
}

async function probeFabric() {
  // No-auth probe of the memory worker to confirm reachability + CORS.
  try {
    const r = await apiGet(`${spaceBase()}/recent?limit=1`);
    setMeta(true, (r.body && r.body.version) || "v1");
    return true;
  } catch {
    setMeta(false, null);
    return false;
  }
}

// ── render: entries ───────────────────────────────────────────────────────--
function renderEntry(entry) {
  const li = document.createElement("li");
  li.className = "entry";

  const head = document.createElement("div");
  head.className = "entry-head";

  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = entry.kind || "entry";
  head.appendChild(kind);

  if (entry.pinned) {
    const p = document.createElement("span");
    p.className = "chip chip-pin";
    p.textContent = "pinned";
    head.appendChild(p);
  }
  if (entry.consumed) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = "consumed";
    head.appendChild(c);
  }

  const time = document.createElement("span");
  time.className = "entry-time";
  time.textContent = relTime(entry.createdAt || entry.lastTouchedAt);
  head.appendChild(time);

  li.appendChild(head);

  const text = previewPayload(entry.payload);
  if (text) {
    const body = document.createElement("p");
    body.className = "entry-body";
    body.textContent = truncate(text, 280);
    li.appendChild(body);
  }

  const foot = document.createElement("div");
  foot.className = "entry-foot";
  if (entry.createdBy) {
    const by = document.createElement("span");
    by.textContent = truncate(entry.createdBy, 48);
    foot.appendChild(by);
  }
  if (entry.stackId) {
    const st = document.createElement("span");
    st.textContent = `stack ${truncate(entry.stackId, 18)}`;
    foot.appendChild(st);
  }
  if (foot.childNodes.length) {
    li.appendChild(foot);
  }
  return li;
}

function renderFeedEvent(ev) {
  const li = document.createElement("li");
  li.className = "feed-event";

  const head = document.createElement("div");
  head.className = "entry-head";

  const src = document.createElement("span");
  src.className = "kind";
  src.textContent = ev.source || "event";
  head.appendChild(src);

  const type = document.createElement("span");
  type.className = "chip";
  type.textContent = ev.eventType || "—";
  head.appendChild(type);

  const time = document.createElement("span");
  time.className = "entry-time";
  time.textContent = relTime(ev.createdAt);
  head.appendChild(time);

  li.appendChild(head);

  const text = previewPayload(ev.payload);
  if (text) {
    const body = document.createElement("p");
    body.className = "entry-body";
    body.textContent = truncate(text, 220);
    li.appendChild(body);
  }
  return li;
}

function renderEntryList(listNode, countNode, cardNode, entries) {
  clear(listNode);
  if (!entries || !entries.length) {
    show(cardNode, false);
    return;
  }
  for (const e of entries) {
    listNode.appendChild(renderEntry(e));
  }
  if (countNode) {
    countNode.textContent = String(entries.length);
  }
  show(cardNode, true);
}

// ── load workspace (identity-scoped) ──────────────────────────────────────--
async function loadWorkspace() {
  // Reset memory sections each load.
  show(dom.pinnedCard, false);
  show(dom.recentCard, false);
  show(dom.feedCard, false);
  show(dom.authNote, false);
  show(dom.emptyState, false);

  if (!state.token) {
    const online = await probeFabric();
    show(dom.authNote, true);
    el("auth-note-title").textContent = "Sign in to load your memory workspace";
    setStatus(
      online
        ? `Fabric online · space "${state.space}" · sign in to view memory.`
        : `Fabric unreachable · space "${state.space}".`
    );
    return;
  }

  setStatus(`Loading memory for space "${state.space}"…`);

  const [pinned, recent, feed] = await Promise.all([
    apiGet(`${spaceBase()}/pinned?limit=20`),
    apiGet(`${spaceBase()}/recent?limit=30`),
    apiGet(`${spaceBase()}/feed?limit=30`),
  ]);

  // Auth failure → degrade with explanation (badge may not carry the UCAN
  // capability for this space).
  const okBody = (recent.body && recent.body) || (pinned.body && pinned.body) || (feed.body && feed.body);
  setMeta(true, (okBody && okBody.version) || "v1");

  const unauthorized = [pinned, recent, feed].some(
    (r) => r.status === 401 || r.status === 403
  );
  if (unauthorized) {
    show(dom.authNote, true);
    el("auth-note-title").textContent = "This session can't read this space";
    el("auth-note-body").textContent =
      `Your identity is signed in, but the badge does not grant a memory ` +
      `capability for space "${state.space}". Open it from memory.forkjoin.ai or ` +
      `switch to a space you can read.`;
    setStatus(`Signed in · no memory capability for "${state.space}".`);
    return;
  }

  const pinnedEntries = (pinned.body && pinned.body.entries) || [];
  const recentEntries = (recent.body && recent.body.entries) || [];
  const feedEvents = (feed.body && feed.body.events) || [];

  renderEntryList(dom.pinnedList, dom.pinnedCount, dom.pinnedCard, pinnedEntries);
  renderEntryList(dom.recentList, dom.recentCount, dom.recentCard, recentEntries);

  clear(dom.feedList);
  if (feedEvents.length) {
    for (const ev of feedEvents) {
      dom.feedList.appendChild(renderFeedEvent(ev));
    }
    if (dom.feedCount) {
      dom.feedCount.textContent = String(feedEvents.length);
    }
    show(dom.feedCard, true);
  }

  const total = pinnedEntries.length + recentEntries.length + feedEvents.length;
  if (total === 0) {
    show(dom.emptyState, true);
    dom.emptyState.textContent = `Space "${state.space}" has no memory entries yet.`;
    setStatus(`Signed in · space "${state.space}" is empty.`);
  } else {
    setStatus(
      `Space "${state.space}" · ${recentEntries.length} recent · ` +
        `${pinnedEntries.length} pinned · ${feedEvents.length} events.`
    );
  }
}

async function refreshAll() {
  if (state.loading) {
    return;
  }
  state.loading = true;
  try {
    await loadWorkspace();
  } catch (e) {
    setStatus(`Could not reach the memory fabric: ${(e && e.message) || "error"}`);
  } finally {
    state.loading = false;
  }
}

// ── identity (shared KenomaIdentity SSO bridge) ───────────────────────────--
function renderBadge() {
  const signedIn = !!state.token;
  show(dom.badgePill, signedIn);
  show(dom.signoutBtn, signedIn);
  show(dom.signinBtn, !signedIn);
  if (signedIn) {
    const p = state.profile || {};
    const kind = p.participantKind || "identity";
    dom.badgeLabel.textContent = kind;
    dom.badgePill.title = [
      p.issuer ? `issuer ${p.issuer}` : "",
      p.exp ? `exp ${new Date(p.exp * 1000).toLocaleString()}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "signed in";
  }
}

function applyBadge(badge) {
  state.token = (badge && badge.token) || null;
  state.profile = (badge && badge.profile) || null;
  renderBadge();
}

async function readIdentity() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.getBadge) {
    applyBadge(null);
    return;
  }
  try {
    const badge = await window.KenomaIdentity.getBadge();
    applyBadge(badge && badge.token ? badge : null);
  } catch {
    applyBadge(null);
  }
}

async function onSignIn() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.signIn) {
    // No bridge in this build — point at the identity hub.
    setStatus("Identity bridge unavailable — open about:id to sign in.");
    return;
  }
  setStatus("Opening ForkJoin sign-in…");
  try {
    const badge = await window.KenomaIdentity.signIn();
    applyBadge(badge && badge.token ? badge : null);
    await refreshAll();
  } catch (e) {
    setStatus(`Sign-in failed: ${(e && e.message) || "unknown error"}`);
  }
}

async function onSignOut() {
  if (window.KenomaIdentity && window.KenomaIdentity.signOut) {
    try {
      await window.KenomaIdentity.signOut();
    } catch {
      /* ignore */
    }
  }
  applyBadge(null);
  await refreshAll();
}

function startIdentity() {
  if (window.KenomaIdentity && window.KenomaIdentity.onChange) {
    window.KenomaIdentity.onChange(async () => {
      await readIdentity();
      await refreshAll();
    });
  }
  readIdentity().then(refreshAll);
}

// ── chrome ────────────────────────────────────────────────────────────────--
function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function onSpaceSubmit(e) {
  e.preventDefault();
  const next = (dom.spaceInput.value || "").trim() || DEFAULT_SPACE;
  state.space = next;
  el("space-name").textContent = next;
  refreshAll();
}

function init() {
  dom.statusLine = el("status-line");
  dom.clock = el("clock");
  dom.metaCard = el("meta-card");
  dom.badgePill = el("badge-pill");
  dom.badgeLabel = el("badge-label");
  dom.signinBtn = el("signin-btn");
  dom.signoutBtn = el("signout-btn");
  dom.refreshBtn = el("refresh-btn");
  dom.spaceForm = el("space-form");
  dom.spaceInput = el("space-input");
  dom.authNote = el("auth-note");
  dom.pinnedCard = el("pinned-card");
  dom.pinnedList = el("pinned-list");
  dom.pinnedCount = el("pinned-count");
  dom.recentCard = el("recent-card");
  dom.recentList = el("recent-list");
  dom.recentCount = el("recent-count");
  dom.feedCard = el("feed-card");
  dom.feedList = el("feed-list");
  dom.feedCount = el("feed-count");
  dom.emptyState = el("empty-state");

  updateClock();
  setInterval(updateClock, 15000);

  dom.signinBtn.addEventListener("click", onSignIn);
  dom.signoutBtn.addEventListener("click", onSignOut);
  dom.refreshBtn.addEventListener("click", () => refreshAll());
  dom.spaceForm.addEventListener("submit", onSpaceSubmit);
  el("auth-note-btn").addEventListener("click", onSignIn);

  // The actor usually injects before page scripts run; if not, wait for ready.
  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    // Show public fabric status immediately; pick up identity when it arrives.
    refreshAll();
    window.addEventListener("KenomaIdentity:ready", startIdentity, { once: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
