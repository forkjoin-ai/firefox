/*
 * about:affectively — thin vanilla client for AFFECTIVELY, the emotional-intelligence
 * platform at self.forkjoin.ai (served by edge-web-app / affectively-app-production).
 * No bundler / React / npm — DOM + fetch only.
 *
 * Identity: the shared Kenoma SSO bridge `window.KenomaIdentity` (getBadge/signIn/
 * signOut/onChange). The badge JWT is passed to self.forkjoin.ai as
 * `Authorization: Bearer <token>`. Signed out -> public atlas + a Sign-in button.
 *
 * Core READ endpoints ported (the headline experience):
 *   GET /api/emotions?limit=500          -> { emotions: EmotionData[], total } (PUBLIC)
 *        EmotionData: { name, description?, family, tier, color?, bgColor? }
 *   GET /api/user/emotional-state        -> { reflections|recent[], streak, count } (AUTH)
 *   GET /api/user/profile                -> { name?, ... } (AUTH; badge profile preferred)
 *
 * SKIPPED (write-heavy / heavy-viz / auth-gated detail, per thin-client rules):
 *   emotion check-in / reflection writes (Pensieve), Kardia, soul-document, charts &
 *   3D affect terrain, behavioral radar, calendar/contacts, badges/achievements,
 *   billing, MCP tools, the realtime Dash relay sync.
 */

"use strict";

const APP_BASE = "https://self.forkjoin.ai";

const state = {
  token: null,
  profile: null,
  did: null,
  emotions: [],
  families: [],
  activeFamily: null,
  query: "",
};

const dom = {};

function $(id) {
  return document.querySelector(id);
}

function authHeaders() {
  const h = { Accept: "application/json" };
  if (state.token) {
    h.Authorization = `Bearer ${state.token}`;
  }
  return h;
}

async function getJson(path) {
  const url = path.startsWith("http") ? path : `${APP_BASE}${path}`;
  const res = await fetch(url, { headers: authHeaders() });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { ok: res.ok, status: res.status, body: body || {} };
}

function titleCase(s) {
  const str = String(s || "");
  return str.length ? str[0].toUpperCase() + str.slice(1) : str;
}

function tierClass(tier) {
  const t = String(tier || "").toLowerCase();
  return ["primary", "secondary", "tertiary"].includes(t) ? t : "neutral";
}

/* ---- emotion atlas (public headline) ---- */

function buildFamilies() {
  const byFamily = new Map();
  for (const e of state.emotions) {
    const fam = e.family || "other";
    if (!byFamily.has(fam)) {
      byFamily.set(fam, []);
    }
    byFamily.get(fam).push(e);
  }
  state.families = [...byFamily.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length);
  if (!state.activeFamily && state.families[0]) {
    state.activeFamily = state.families[0].name;
  }
}

function renderFamilies() {
  const list = dom.familyList;
  list.textContent = "";
  for (const fam of state.families) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "family" + (fam.name === state.activeFamily && !state.query ? " active" : "");
    btn.addEventListener("click", () => {
      state.activeFamily = fam.name;
      state.query = "";
      dom.search.value = "";
      renderFamilies();
      renderCards();
    });

    const nm = document.createElement("span");
    nm.className = "family-name";
    nm.textContent = titleCase(fam.name);
    const cnt = document.createElement("span");
    cnt.className = "family-count";
    cnt.textContent = String(fam.items.length);
    btn.appendChild(nm);
    btn.appendChild(cnt);
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function currentEmotions() {
  if (state.query) {
    const q = state.query.toLowerCase();
    return state.emotions.filter(
      (e) =>
        String(e.name || "").toLowerCase().includes(q) ||
        String(e.description || "").toLowerCase().includes(q) ||
        String(e.family || "").toLowerCase().includes(q)
    );
  }
  const fam = state.families.find((f) => f.name === state.activeFamily);
  return fam ? fam.items : [];
}

function renderCards() {
  const items = currentEmotions();

  if (state.query) {
    dom.detailName.textContent = `“${state.query}”`;
    dom.detailSub.textContent = `${items.length} match${items.length === 1 ? "" : "es"}`;
  } else {
    dom.detailName.textContent = titleCase(state.activeFamily || "Emotions");
    dom.detailSub.textContent = `${items.length} emotion${items.length === 1 ? "" : "s"} in this family`;
  }

  const wrap = dom.cards;
  wrap.textContent = "";
  if (items.length === 0) {
    dom.detailEmpty.hidden = false;
    dom.detailEmpty.textContent = state.query
      ? "No emotions match your search."
      : "No emotions in this family.";
    return;
  }
  dom.detailEmpty.hidden = true;

  for (const e of items) {
    const card = document.createElement("article");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "card-head";
    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = titleCase(e.name);
    const tier = document.createElement("span");
    tier.className = `tag ${tierClass(e.tier)}`;
    tier.textContent = e.tier || "—";
    head.appendChild(name);
    head.appendChild(tier);
    card.appendChild(head);

    if (e.description) {
      const desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = e.description;
      card.appendChild(desc);
    }

    if (e.family && e.family !== state.activeFamily) {
      const fam = document.createElement("span");
      fam.className = "card-family";
      fam.textContent = titleCase(e.family);
      card.appendChild(fam);
    }

    wrap.appendChild(card);
  }
}

async function loadAtlas() {
  dom.atlasStatus.textContent = "Loading the emotion atlas…";
  const { ok, status, body } = await getJson("/api/emotions?limit=500");
  if (!ok || !Array.isArray(body.emotions)) {
    dom.atlasStatus.textContent = `Couldn’t load the atlas (${status || "network"}).`;
    dom.atlasTotal.textContent = "—";
    return;
  }
  state.emotions = body.emotions;
  dom.atlasTotal.textContent = String(body.total ?? state.emotions.length);
  dom.atlasStatus.textContent = `${state.emotions.length} feelings across ${
    new Set(state.emotions.map((e) => e.family || "other")).size
  } families.`;
  dom.sourceTag.textContent = `${state.emotions.length} emotions`;
  buildFamilies();
  renderFamilies();
  renderCards();
}

/* ---- your check-ins (signed-in, best-effort) ---- */

function renderSelf(data) {
  if (!state.token) {
    dom.selfPanel.hidden = true;
    return;
  }
  dom.selfPanel.hidden = false;

  const reflections = Array.isArray(data && data.reflections)
    ? data.reflections
    : Array.isArray(data && data.recent)
    ? data.recent
    : [];
  const streak =
    (data && (data.streak ?? data.currentStreak)) ?? null;
  const total =
    (data && (data.count ?? data.totalCount ?? data.total)) ?? reflections.length;

  dom.selfStats.textContent = "";
  const stats = [
    ["check-ins", total != null ? String(total) : "—"],
    ["streak", streak != null ? `${streak}d` : "—"],
  ];
  for (const [label, value] of stats) {
    const cell = document.createElement("div");
    cell.className = "stat";
    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;
    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;
    cell.appendChild(v);
    cell.appendChild(l);
    dom.selfStats.appendChild(cell);
  }

  dom.selfRows.textContent = "";
  const recent = reflections.slice(0, 5);
  if (recent.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-row";
    li.textContent = "No reflections yet. Open self.forkjoin.ai to check in.";
    dom.selfRows.appendChild(li);
    dom.selfStatus.textContent = "ready";
    return;
  }
  for (const r of recent) {
    const primary =
      (r.parsedState && r.parsedState.primary) ||
      r.primary ||
      r.emotion ||
      r.emotional_state ||
      "reflection";
    const when = r.createdAtIso || r.createdAt || r.timestamp || "";
    const li = document.createElement("li");
    li.className = "row";
    const main = document.createElement("div");
    main.className = "row-main";
    const label = document.createElement("span");
    label.textContent = titleCase(
      typeof primary === "string" ? primary : "reflection"
    );
    main.appendChild(label);
    if (r.intensity != null) {
      const t = document.createElement("span");
      t.className = "tag neutral";
      t.textContent = `intensity ${r.intensity}`;
      main.appendChild(t);
    }
    li.appendChild(main);
    if (when) {
      const meta = document.createElement("div");
      meta.className = "row-meta";
      const d = new Date(when);
      meta.textContent = Number.isNaN(d.getTime())
        ? String(when)
        : d.toLocaleString();
      li.appendChild(meta);
    }
    dom.selfRows.appendChild(li);
  }
  dom.selfStatus.textContent = `${recent.length} recent`;
}

async function loadSelf() {
  if (!state.token) {
    renderSelf(null);
    return;
  }
  dom.selfPanel.hidden = false;
  dom.selfStatus.textContent = "loading…";
  const { ok, status, body } = await getJson("/api/user/emotional-state");
  if (!ok) {
    dom.selfStatus.textContent =
      status === 401 || status === 403 ? "not authorized" : `error ${status}`;
    renderSelf({ reflections: [] });
    return;
  }
  renderSelf(body);
}

/* ---- identity ---- */

function renderIdentity() {
  if (state.profile) {
    const name =
      state.profile.name ||
      state.profile.displayName ||
      (state.did ? state.did.slice(0, 22) + "…" : "signed in");
    dom.identityName.textContent = name;
    dom.identityPill.querySelector(".dot").classList.remove("off");
    const kind = state.profile.participantKind || "human";
    dom.kindText.textContent = kind;
    dom.kindPill.hidden = false;
    dom.authBtn.hidden = false;
    dom.authBtn.textContent = "Sign out";
  } else {
    dom.identityName.textContent = "signed out";
    dom.identityPill.querySelector(".dot").classList.add("off");
    dom.kindPill.hidden = true;
    dom.authBtn.hidden = false;
    dom.authBtn.textContent = "Sign in";
  }
}

function applyBadge(badge) {
  if (badge && badge.token) {
    state.token = badge.token;
    state.did = badge.did || (badge.profile && badge.profile.did) || null;
    state.profile = badge.profile || {};
  } else {
    state.token = null;
    state.did = null;
    state.profile = null;
  }
  renderIdentity();
  loadSelf();
}

async function refreshIdentity() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.getBadge) {
    state.token = null;
    state.profile = null;
    renderIdentity();
    dom.identityName.textContent = "bridge offline";
    return;
  }
  try {
    const badge = await window.KenomaIdentity.getBadge();
    applyBadge(badge);
  } catch (e) {
    applyBadge(null);
  }
}

async function onAuthClick() {
  if (!window.KenomaIdentity) {
    return;
  }
  dom.authBtn.disabled = true;
  try {
    if (state.token) {
      if (window.KenomaIdentity.signOut) {
        await window.KenomaIdentity.signOut();
      }
      applyBadge(null);
    } else if (window.KenomaIdentity.signIn) {
      const badge = await window.KenomaIdentity.signIn();
      applyBadge(badge);
    }
  } catch (e) {
    /* keep current state on failure */
  } finally {
    dom.authBtn.disabled = false;
  }
}

function startIdentity() {
  if (window.KenomaIdentity && window.KenomaIdentity.onChange) {
    window.KenomaIdentity.onChange(() => refreshIdentity());
  }
  refreshIdentity();
}

/* ---- clock + chrome ---- */

function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function buildField() {
  const field = document.querySelector(".field");
  if (!field) {
    return;
  }
  const width = 860;
  const height = 780;
  const radius = 15;
  const sqrt3 = Math.sqrt(3);
  let out = "";
  for (let q = -2; q < 42; q++) {
    for (let r = -6; r < 46; r++) {
      const cx = radius * 1.5 * q;
      const cy = radius * sqrt3 * (r + q / 2);
      if (cx < -25 || cx > width + 25 || cy < -25 || cy > height + 25) {
        continue;
      }
      const t = cx / width;
      const noise =
        Math.sin(cx * 0.018 + cy * 0.011) * 0.5 +
        Math.sin(cx * 0.006 - cy * 0.02 + 1.7) * 0.5;
      const coherence = Math.max(
        0,
        Math.min(1, Math.pow(Math.max(0, t), 1.18) + noise * 0.26)
      );
      if (coherence < 0.2) {
        continue;
      }
      const size = radius * (0.3 + 0.6 * coherence) * 0.9;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * 60 * i;
        points.push(
          `${(cx + size * Math.cos(angle)).toFixed(1)},${(
            cy +
            size * Math.sin(angle)
          ).toFixed(1)}`
        );
      }
      const opacity = (0.08 + 0.3 * coherence).toFixed(2);
      out += `<polygon points="${points.join(
        " "
      )}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="${opacity}"/>`;
    }
  }
  field.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${out}</svg>`;
}

function init() {
  dom.clock = $("#clock");
  dom.identityPill = $("#identity-pill");
  dom.identityName = $("#identity-name");
  dom.kindPill = $("#kind-pill");
  dom.kindText = $("#kind-text");
  dom.authBtn = $("#auth-btn");
  dom.atlasTotal = $("#atlas-total");
  dom.atlasStatus = $("#atlas-status");
  dom.familyList = $("#family-list");
  dom.detailName = $("#detail-name");
  dom.detailSub = $("#detail-sub");
  dom.detailEmpty = $("#detail-empty");
  dom.cards = $("#cards");
  dom.search = $("#search");
  dom.selfPanel = $("#self-panel");
  dom.selfStatus = $("#self-status");
  dom.selfStats = $("#self-stats");
  dom.selfRows = $("#self-rows");
  dom.sourceTag = $("#source-tag");

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  dom.authBtn.addEventListener("click", onAuthClick);
  dom.search.addEventListener("input", () => {
    state.query = dom.search.value.trim();
    renderFamilies();
    renderCards();
  });

  loadAtlas();

  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    dom.identityName.textContent = "connecting…";
    window.addEventListener("KenomaIdentity:ready", startIdentity, { once: true });
    setTimeout(() => {
      if (!state.token && !window.KenomaIdentity) {
        refreshIdentity();
      }
    }, 1500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
