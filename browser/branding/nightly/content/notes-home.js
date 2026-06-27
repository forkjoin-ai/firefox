/* notes-home.js — self-contained vanilla port of fractal-note for the packaged
 * about:notes page. No React, no bundler, no npm imports: plain DOM + fetch +
 * the shared window.KenomaIdentity SSO API. Surface ported from
 * apps/fractal-note (client/App.tsx + src/worker.ts read endpoints).
 *
 * The page runs from a chrome://branding (about:notes) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src).
 *
 * Core read endpoints:
 *   GET /api/notes?limit=&query=  -> { notes:[...], count, nextCursor }   (public, + owner notes when signed in)
 *   GET /api/notes/shared         -> { success, sharedNotes:[...] }       (identity required)
 *   GET /api/meta                 -> service descriptor (footer status)
 *
 * Identity: the Kenoma shared SSO injects window.KenomaIdentity. We read the BADGE
 * JWT and pass it as `Authorization: Bearer <token>`; if absent we degrade to the
 * public feed and offer a "Sign in" button. Re-render on onChange.
 *
 * Deliberately SKIPPED (write-heavy / heavy / encrypted — out of scope for a
 * dependency-free read surface): Capacitor block editing, collab DO sessions,
 * presence WebSocket, note graph/children/related viz, pensieve/mementos,
 * sync pull/snapshot, MCP, sharing writes. */
"use strict";

const HTTP_BASE = "https://note.forkjoin.ai";
const PAGE_LIMIT = 30;

const state = {
  identity: null, // { token, did, profile } | null
  view: "public", // public | mine | shared
  query: "",
  notes: [],
  status: "loading", // loading | ok | empty | error
  loadToken: 0,
};

const dom = {};

// ── identity helpers ──────────────────────────────────────────────────────────
function authHeaders() {
  const token = state.identity && state.identity.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function profileLabel(identity) {
  if (!identity) return "signed out";
  const p = identity.profile || {};
  const kind = typeof p.participantKind === "string" ? p.participantKind : "human";
  const did = typeof identity.did === "string" ? identity.did : "";
  const seg = (did.split(":").pop() || did).replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return seg ? `${kind} · ${seg}` : kind;
}

// ── normalization (mirror fractal-note NoteNode shape) ────────────────────────
function asString(v) {
  return typeof v === "string" ? v : null;
}

function normalizeNote(value) {
  if (typeof value !== "object" || value === null) return null;
  const r = value;
  const id = asString(r.id);
  if (!id) return null;
  const title = asString(r.title) || "Untitled note";
  const summary = asString(r.summary);
  const canonicalText = asString(r.canonicalText);
  const preview = (summary || canonicalText || "").trim().slice(0, 220);
  const updatedAt =
    typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt)
      ? r.updatedAt
      : typeof r.createdAt === "number"
        ? r.createdAt
        : null;
  const affective =
    r.affective && typeof r.affective === "object" ? r.affective : null;
  return {
    id,
    title,
    preview,
    slug: asString(r.slug),
    ownerId: asString(r.ownerId),
    visibility: asString(r.visibility) || "public",
    status: asString(r.status) || "draft",
    updatedAt,
    emotion: affective ? asString(affective.emotion) : null,
  };
}

// shared notes wrap the note under .note (NoteShare) or may be a flat note
function normalizeShared(value) {
  if (typeof value !== "object" || value === null) return null;
  const r = value;
  const inner = r.note && typeof r.note === "object" ? r.note : r;
  return normalizeNote(inner);
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

// ── data fetch ────────────────────────────────────────────────────────────────
async function loadFeed() {
  const token = ++state.loadToken;
  state.status = "loading";
  renderNotes();
  renderFeedPill();

  try {
    let notes = [];
    if (state.view === "shared") {
      const res = await fetch(`${HTTP_BASE}/api/notes/shared`, {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error(`shared ${res.status}`);
      const payload = await res.json();
      const raw = Array.isArray(payload.sharedNotes) ? payload.sharedNotes : [];
      notes = raw.map(normalizeShared).filter(Boolean);
    } else {
      const url = new URL(`${HTTP_BASE}/api/notes`);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      if (state.query) url.searchParams.set("query", state.query);
      const res = await fetch(url.toString(), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error(`notes ${res.status}`);
      const payload = await res.json();
      const raw = Array.isArray(payload.notes) ? payload.notes : [];
      let mapped = raw.map(normalizeNote).filter(Boolean);
      // "Mine" filters the signed-in feed to notes the badge owns (server already
      // unions public + owner rows; we narrow client-side by owner did).
      if (state.view === "mine" && state.identity && state.identity.did) {
        const did = state.identity.did;
        mapped = mapped.filter((n) => n.ownerId === did || n.visibility !== "public");
      }
      notes = mapped;
    }

    if (token !== state.loadToken) return; // superseded
    state.notes = notes;
    state.status = notes.length ? "ok" : "empty";
  } catch (err) {
    if (token !== state.loadToken) return;
    state.status = "error";
    state.notes = [];
  }
  renderNotes();
  renderFeedPill();
}

// ── render ────────────────────────────────────────────────────────────────────
function renderIdentity() {
  dom.identityName.textContent = profileLabel(state.identity);
  const signedIn = !!state.identity;
  dom.authBtn.textContent = signedIn ? "Sign out" : "Sign in";
  dom.tabMine.disabled = !signedIn;
  dom.tabShared.disabled = !signedIn;
  if (!signedIn && (state.view === "mine" || state.view === "shared")) {
    setView("public");
  }
}

function renderFeedPill() {
  if (state.status === "loading") dom.feedText.textContent = "loading…";
  else if (state.status === "error") dom.feedText.textContent = "offline";
  else if (state.status === "empty") dom.feedText.textContent = "no notes";
  else dom.feedText.textContent = `${state.notes.length} notes`;
}

function renderTabs() {
  dom.tabPublic.classList.toggle("active", state.view === "public");
  dom.tabMine.classList.toggle("active", state.view === "mine");
  dom.tabShared.classList.toggle("active", state.view === "shared");
  const labels = {
    public: ["Public notes", "latest across note.forkjoin.ai"],
    mine: ["My notes", "owned by your Kenoma identity"],
    shared: ["Shared with me", "notes others shared to you"],
  };
  const [l, s] = labels[state.view] || labels.public;
  dom.viewLabel.textContent = l;
  dom.viewSublabel.textContent = s;
}

function renderNotes() {
  dom.notes.replaceChildren();

  if (state.status === "loading") {
    const li = document.createElement("li");
    li.className = "note-empty";
    li.textContent = "Loading notes…";
    dom.notes.append(li);
    return;
  }
  if (state.status === "error") {
    const li = document.createElement("li");
    li.className = "note-empty";
    li.textContent = "Could not reach note.forkjoin.ai. Retry shortly.";
    dom.notes.append(li);
    return;
  }
  if (state.notes.length === 0) {
    const li = document.createElement("li");
    li.className = "note-empty";
    li.textContent =
      state.view === "shared"
        ? "Nothing shared with you yet."
        : state.query
          ? "No notes match that search."
          : "No notes here yet.";
    dom.notes.append(li);
    return;
  }

  for (const n of state.notes) {
    const li = document.createElement("li");
    li.className = "note";

    const link = document.createElement("a");
    link.className = "note-link";
    link.href = n.slug ? `${HTTP_BASE}/${n.slug}` : `${HTTP_BASE}/n/${n.id}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const head = document.createElement("div");
    head.className = "note-head";
    const title = document.createElement("strong");
    title.className = "note-title";
    title.textContent = n.title;
    const time = document.createElement("span");
    time.className = "note-time";
    time.textContent = timeAgo(n.updatedAt);
    head.append(title, time);

    link.append(head);

    if (n.preview) {
      const body = document.createElement("p");
      body.className = "note-preview";
      body.textContent = n.preview;
      link.append(body);
    }

    const meta = document.createElement("div");
    meta.className = "note-meta";
    const vis = document.createElement("span");
    vis.className = "tag tag-vis";
    vis.textContent = n.visibility;
    meta.append(vis);
    if (n.status && n.status !== "draft") {
      const st = document.createElement("span");
      st.className = "tag";
      st.textContent = n.status;
      meta.append(st);
    }
    if (n.emotion) {
      const em = document.createElement("span");
      em.className = "tag tag-emotion";
      em.textContent = n.emotion;
      meta.append(em);
    }
    link.append(meta);

    li.append(link);
    dom.notes.append(li);
  }
}

function setView(view) {
  state.view = view;
  renderTabs();
  void loadFeed();
}

function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// Decorative hex field, ported from kenoma-home.js so the aesthetic matches.
function buildField() {
  const field = document.querySelector(".field");
  if (!field) return;
  const width = 860;
  const height = 780;
  const radius = 15;
  const sqrt3 = Math.sqrt(3);
  const eye = { x: width * 0.46, y: height * 0.4, r: 160 };
  let out = "";
  for (let q = -2; q < 42; q++) {
    for (let r = -6; r < 46; r++) {
      const cx = radius * 1.5 * q;
      const cy = radius * sqrt3 * (r + q / 2);
      if (cx < -25 || cx > width + 25 || cy < -25 || cy > height + 25) continue;
      const t = cx / width;
      const distance = Math.hypot(cx - eye.x, cy - eye.y);
      const eyeFactor = distance < eye.r ? Math.pow(1 - distance / eye.r, 1.6) : 0;
      const noise =
        Math.sin(cx * 0.018 + cy * 0.011) * 0.5 + Math.sin(cx * 0.006 - cy * 0.02 + 1.7) * 0.5;
      const coherence = Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1.18) - eyeFactor * 1.25 + noise * 0.26));
      if (coherence < 0.17) continue;
      const size = radius * (0.3 + 0.64 * coherence) * 0.9;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * 60 * i;
        points.push(`${(cx + size * Math.cos(angle)).toFixed(1)},${(cy + size * Math.sin(angle)).toFixed(1)}`);
      }
      const opacity = (0.09 + 0.34 * coherence).toFixed(2);
      out += `<polygon points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="${opacity}"/>`;
    }
  }
  field.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${out}</svg>`;
}

// ── identity wiring ───────────────────────────────────────────────────────────
async function refreshIdentity() {
  try {
    const id = await (window.KenomaIdentity &&
      window.KenomaIdentity.getBadge &&
      window.KenomaIdentity.getBadge());
    state.identity = id || null;
  } catch {
    state.identity = null;
  }
  renderIdentity();
}

function wireIdentity() {
  const subscribe = () => {
    if (window.KenomaIdentity && typeof window.KenomaIdentity.onChange === "function") {
      window.KenomaIdentity.onChange(() => {
        void refreshIdentity().then(() => loadFeed());
      });
    }
    void refreshIdentity().then(() => loadFeed());
  };

  if (window.KenomaIdentity) {
    subscribe();
  } else {
    let done = false;
    window.addEventListener(
      "KenomaIdentity:ready",
      () => {
        if (done) return;
        done = true;
        subscribe();
      },
      { once: true }
    );
    // Degrade to public feed immediately; identity may arrive later.
    void loadFeed();
  }
}

async function onAuthClick() {
  const api = window.KenomaIdentity;
  if (state.identity) {
    try {
      if (api && api.signOut) await api.signOut();
    } catch {
      /* ignore */
    }
    await refreshIdentity();
    void loadFeed();
    return;
  }
  if (api && api.signIn) {
    try {
      const id = await api.signIn();
      state.identity = id || null;
      renderIdentity();
      void loadFeed();
      return;
    } catch {
      /* fall through to hub */
    }
  }
  window.location.href = "about:id";
}

// ── boot ──────────────────────────────────────────────────────────────────────
function init() {
  dom.identityName = document.querySelector("#identity-name");
  dom.authBtn = document.querySelector("#auth-btn");
  dom.feedText = document.querySelector("#feed-text");
  dom.clock = document.querySelector("#clock");
  dom.viewLabel = document.querySelector("#view-label");
  dom.viewSublabel = document.querySelector("#view-sublabel");
  dom.tabPublic = document.querySelector("#tab-public");
  dom.tabMine = document.querySelector("#tab-mine");
  dom.tabShared = document.querySelector("#tab-shared");
  dom.searchForm = document.querySelector("#search-form");
  dom.searchInput = document.querySelector("#search-input");
  dom.notes = document.querySelector("#notes");

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  renderIdentity();
  renderTabs();

  dom.tabPublic.addEventListener("click", () => setView("public"));
  dom.tabMine.addEventListener("click", () => {
    if (!dom.tabMine.disabled) setView("mine");
  });
  dom.tabShared.addEventListener("click", () => {
    if (!dom.tabShared.disabled) setView("shared");
  });
  dom.authBtn.addEventListener("click", () => void onAuthClick());
  dom.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.query = dom.searchInput.value.trim();
    if (state.view === "shared") setView("public");
    else void loadFeed();
  });

  wireIdentity();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
