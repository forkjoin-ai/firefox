/* hexwar-home.js — self-contained vanilla port of HexWar (hexwar.forkjoin.ai)
 * for the packaged about:hexwar page. No React, no bundler, no npm imports:
 * plain DOM + fetch + the shared window.KenomaIdentity SSO API.
 *
 * The page runs from a chrome://branding (about:hexwar) origin, so it ALWAYS
 * talks to the absolute backend base (cross-origin, allowed by the page CSP
 * connect-src + hexwar's `Access-Control-Allow-Origin: *` headers).
 *
 * Surface — "the live state of the hex-globe frontier": a frontier-state stat
 * grid (claim ratio, active claims/rallies, captured/expanded roots, unlocked
 * latitude band), the strongest-roots leaderboard, and the recent narration
 * feed. Identity is OPTIONAL here (public game board): if the Kenoma SSO bridge
 * is present we surface the signed-in badge, otherwise we degrade to a "sign in"
 * pill — every read endpoint used here is public.
 *
 * Core read endpoints (all CORS-enabled + working):
 *   GET /api/ticks/latest → { ok, latestTick:{ resolvedAt, summary:{ claimRatio,
 *       maxUnlockedAbsLatitude, activeClaimCount, activeRallyCount,
 *       capturedRootCount, expandedRootCount, leaderboard:[{cellId,energy,ownerDid}] } } }
 *   GET /api/visitors  → { count }
 *   GET /api/events    → HexwarNarrationEvent[] (recent frontier activity)
 *
 * Deliberately SKIPPED (heavy / write / auth-gated, out of scope for a
 * dependency-free read page): the 3D hex-globe WebGL scene, root claiming /
 * checkout + Stripe, nexus create/connect, subdivide / delegations / revocations,
 * alliance + rally writes, embed publish, MCP/agent surfaces, per-player inventory
 * + void saves (auth-gated), and the live presence WebSocket.
 * NOTE: GET /api/board and GET /api/leaderboard currently return a server 1101
 * (worker exception) upstream — not a CORS issue. The leaderboard + headline
 * counts are instead read from /api/ticks/latest's summary, which is live. */
"use strict";

const HTTP_BASE = "https://hexwar.forkjoin.ai";

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

function shortDid(did) {
  if (!did) return "—";
  return String(did).replace(/^did:[^:]+:/, "").slice(0, 22);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── narration: mirror hexgrid-3d formatSingleEvent for plain text ──────────────
function narrate(event) {
  const actor = event.actorName ? `${shortDid(event.actorName)} ` : "";
  const cell = event.cellId ? ` ${event.cellId}` : "";
  switch (event.eventType) {
    case "claim":
      return `${actor}claimed root${cell}.`.trim();
    case "embed_set":
      return `${actor}repointed the frontier payload${cell}.`.trim();
    case "delegation_issued":
      return `${actor}delegated subhex control${cell}.`.trim();
    case "delegation_revoked":
      return `${actor}revoked delegated control${cell}.`.trim();
    case "nexus_created":
      return `${actor}founded a nexus${cell}.`.trim();
    case "nexus_connected":
      return `${actor}connected a sovereign root into an alliance${cell}.`.trim();
    case "alliance_root_bound":
      return `A sovereign root joined an allied phyle${cell}.`.trim();
    case "rally_called":
      return `A new rally directive lit up${cell}.`.trim();
    case "allied_border_held":
      return `Allied borders held firm${cell}.`.trim();
    case "alliance_surged":
      return `Allied pressure pushed${cell} into surge state.`.trim();
    case "unlock":
      return `A new latitude band unlocked${cell}.`.trim();
    case "tick_surged":
      return `Hourly pressure pushed${cell} into surge state.`.trim();
    case "tick_entrenched":
      return `${cell.trim()} entrenched after the latest tick.`.trim();
    case "leaderboard_flip":
      return "The leaderboard flipped after the latest tick.";
    default:
      return `${(event.eventType || "frontier event").replace(/_/g, " ")}${cell}.`.trim();
  }
}

// ── render: frontier stats ────────────────────────────────────────────────────
function statCard(value, label, variant) {
  const card = document.createElement("div");
  card.className = "stat-card";
  const v = document.createElement("span");
  v.className = `stat-value${variant ? " " + variant : ""}`;
  v.textContent = value;
  const l = document.createElement("span");
  l.className = "stat-label";
  l.textContent = label;
  card.appendChild(v);
  card.appendChild(l);
  return card;
}

function renderStats(summary, viewers) {
  clear(dom.statGrid);
  const s = summary || {};
  const ratio = Number.isFinite(s.claimRatio)
    ? `${Math.round(s.claimRatio * 100)}%`
    : "0%";
  dom.statGrid.appendChild(statCard(String(viewers ?? 0), "watching now", "accent"));
  dom.statGrid.appendChild(statCard(String(s.capturedRootCount ?? 0), "captured roots", "gold"));
  dom.statGrid.appendChild(statCard(String(s.activeClaimCount ?? 0), "active claims"));
  dom.statGrid.appendChild(statCard(String(s.activeRallyCount ?? 0), "active rallies"));
  dom.statGrid.appendChild(statCard(String(s.expandedRootCount ?? 0), "expanded roots"));
  dom.statGrid.appendChild(statCard(ratio, "globe claimed"));
  dom.statGrid.appendChild(
    statCard(`±${s.maxUnlockedAbsLatitude ?? 0}`, "unlocked latitude")
  );
  dom.statsBoard.hidden = false;
}

// ── render: leaderboard ───────────────────────────────────────────────────────
function renderLeaderboard(rows) {
  clear(dom.lbList);
  if (!rows || !rows.length) {
    dom.leaderboardBoard.hidden = true;
    return;
  }
  dom.leaderboardBoard.hidden = false;
  rows.slice(0, 8).forEach((row, i) => {
    const li = document.createElement("li");

    const rank = document.createElement("span");
    rank.className = "lb-rank";
    rank.textContent = String(i + 1);

    const body = document.createElement("div");
    body.className = "lb-body";
    const cell = document.createElement("span");
    cell.className = "lb-cell";
    cell.textContent = row.cellId || "—";
    const owner = document.createElement("span");
    owner.className = "lb-owner";
    owner.textContent = shortDid(row.ownerDid);
    body.appendChild(cell);
    body.appendChild(owner);

    const energy = document.createElement("span");
    energy.className = "lb-energy";
    const e = Number(row.energy);
    energy.textContent = Number.isFinite(e) ? `${Math.round(e)} ⚡` : "—";

    li.appendChild(rank);
    li.appendChild(body);
    li.appendChild(energy);
    dom.lbList.appendChild(li);
  });
}

// ── render: activity feed ─────────────────────────────────────────────────────
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
    text.textContent = narrate(item);
    const time = document.createElement("span");
    time.className = "feed-time";
    time.textContent = timeAgo(item.occurredAtMs);
    li.appendChild(text);
    li.appendChild(time);
    dom.feedList.appendChild(li);
  }
}

// ── identity (optional) ───────────────────────────────────────────────────────
function renderIdentity() {
  const b = state.badge;
  if (b && b.profile) {
    const kind = b.profile.participantKind || "human";
    const short = shortDid(b.did);
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
  dom.statusLine.textContent = "Loading the frontier…";
  dom.emptyState.hidden = true;
  try {
    const [tick, visitors, events] = await Promise.allSettled([
      getJSON("/api/ticks/latest"),
      getJSON("/api/visitors"),
      getJSON("/api/events"),
    ]);

    let viewers = 0;
    if (visitors.status === "fulfilled") {
      viewers = (visitors.value && visitors.value.count) || 0;
    }
    dom.viewersCount.textContent = `${viewers} watching`;

    let summary = null;
    let leaderboard = [];
    if (tick.status === "fulfilled") {
      const latest = tick.value && tick.value.latestTick;
      summary = (latest && latest.summary) || null;
      leaderboard = (summary && Array.isArray(summary.leaderboard)) ? summary.leaderboard : [];
      dom.tickLabel.textContent = latest && latest.resolvedAt
        ? `tick ${timeAgo(latest.resolvedAt)}`
        : "tick —";
    }
    renderStats(summary, viewers);
    renderLeaderboard(leaderboard);

    let feedItems = [];
    if (events.status === "fulfilled" && Array.isArray(events.value)) {
      feedItems = events.value;
    }
    renderFeed(feedItems);

    const reachable = tick.status === "fulfilled" || visitors.status === "fulfilled";
    if (!reachable) {
      throw new Error("no live data");
    }

    if (!leaderboard.length && !feedItems.length && !summary) {
      dom.emptyState.hidden = false;
      dom.emptyState.textContent =
        "The frontier is quiet. Claims, rallies, and tick resolutions will appear here as the board comes alive.";
      dom.statusLine.textContent = "hexwar.forkjoin.ai · awaiting first claims";
    } else {
      dom.statusLine.textContent =
        `hexwar.forkjoin.ai · ${viewers} watching · ${leaderboard.length} ranked roots · ${feedItems.length} recent events`;
    }
  } catch (e) {
    dom.statusLine.textContent = "Could not reach hexwar.forkjoin.ai.";
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
  dom.viewersCount = el("viewers-count");
  dom.tickLabel = el("tick-label");
  dom.refreshBtn = el("refresh-btn");
  dom.identityBtn = el("identity-btn");
  dom.identityLabel = el("identity-label");
  dom.identityDot = dom.identityBtn.querySelector(".dot-id");
  dom.clock = el("clock");
  dom.statusLine = el("status-line");
  dom.statsBoard = el("stats-board");
  dom.statGrid = el("stat-grid");
  dom.leaderboardBoard = el("leaderboard-board");
  dom.lbList = el("lb-list");
  dom.feedBoard = el("feed-board");
  dom.feedList = el("feed-list");
  dom.emptyState = el("empty-state");

  dom.refreshBtn.addEventListener("click", load);
  dom.identityBtn.addEventListener("click", onIdentityClick);

  updateClock();
  setInterval(updateClock, 30000);
  setInterval(load, 60000);

  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    window.addEventListener("KenomaIdentity:ready", startIdentity, { once: true });
    renderIdentity();
  }

  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
