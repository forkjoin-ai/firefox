/* skychat-home.js — self-contained vanilla port of the skymesh near-chat for the
 * packaged about:skychat page. No React, no bundler, no npm imports: plain DOM +
 * fetch + WebSocket + localStorage. Logic ported from
 * apps/skymesh-rtmp/src/render-app/hooks/{useGeoChannels,useFluidChat,useSkychat}.ts.
 *
 * The page runs from a chrome://branding (about:skychat) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src).
 *
 * MVP scope — geo:* + general channels only. Deliberately SKIPPED (need @a0n/auth /
 * fractal-iam, out of scope for a dependency-free page): encrypted/phyle channels,
 * fractal-iam identity badges, business POI channel posting nuance, mementos. */
"use strict";

const HTTP_BASE = "https://tv.forkjoin.ai";
const WS_BASE = "wss://tv.forkjoin.ai";
const POLL_MS = 6000;
const PING_MS = 25000;
const TYPING_TTL_MS = 4500;
const TYPING_THROTTLE_MS = 1800;
const WS_MAX_RETRIES = 4;

const GENERAL_CHANNEL = { id: "general", kind: "general", label: "general", sublabel: "everyone" };

const CHAT_GENERA = [
  "ACER", "ALNUS", "BETULA", "CARPINUS", "CEDRUS", "CORNUS", "FAGUS", "FRAXINUS",
  "GINKGO", "ILEX", "JUGLANS", "LARIX", "MAGNOLIA", "OLEA", "PICEA", "PINUS",
  "PLATANUS", "POPULUS", "PRUNUS", "SORBUS", "TILIA", "ULMUS", "VIBURNUM", "ZELKOVA",
  "ABIES", "CARYA", "FICUS", "MORUS", "NYSSA", "TAXUS", "AESCULUS", "CASTANEA",
];

function friendlyDidName(did) {
  let h = 0;
  for (let i = 0; i < did.length; i++) h = (h * 31 + did.charCodeAt(i)) >>> 0;
  const name = CHAT_GENERA[h % CHAT_GENERA.length];
  const seg = (did.split(":").pop() || did).replace(/[^a-zA-Z0-9]/g, "");
  const suffix = seg.slice(-2).toUpperCase();
  return suffix ? `${name} ${suffix}` : name;
}

function getLocalDid() {
  try {
    const KEY = "skymesh:did";
    let did = window.localStorage.getItem(KEY);
    if (!did) {
      const rand = Array.from({ length: 4 }, () =>
        Math.floor((0x10000 * (1 + Math.sin(Date.now() + Math.random()))) / 2)
          .toString(16)
          .padStart(4, "0")
      ).join("");
      did = `did:ucan:skymesh:${rand}`;
      window.localStorage.setItem(KEY, did);
    }
    return did;
  } catch {
    return "anon";
  }
}

function getLocalHandle() {
  try {
    const h = window.localStorage.getItem("skymesh:handle");
    return h && h.trim() ? h.trim() : null;
  } catch {
    return null;
  }
}

let localId = 0;
function normalizeMessage(value) {
  if (typeof value !== "object" || value === null) return null;
  const r = value;
  const rawText = typeof r.text === "string" ? r.text : typeof r.content === "string" ? r.content : "";
  const text = rawText.slice(0, 180);
  if (!text) return null;
  const rawUser = typeof r.user === "string" ? r.user : typeof r.author === "string" ? r.author : "VIEWER";
  const did =
    typeof r.did === "string" && r.did.startsWith("did:")
      ? r.did
      : typeof r.author === "string" && r.author.startsWith("did:")
        ? r.author
        : rawUser.startsWith("did:")
          ? rawUser
          : undefined;
  const user = did
    ? friendlyDidName(did)
    : rawUser.toLowerCase() === "cissypatterson"
      ? "CISSY"
      : rawUser.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toUpperCase() || "VIEWER";
  const id = typeof r.id === "string" && r.id ? r.id : `local-${++localId}-${Date.now()}`;
  const ts =
    typeof r.ts === "number" && Number.isFinite(r.ts)
      ? r.ts
      : typeof r.createdAt === "string"
        ? Date.parse(r.createdAt) || undefined
        : undefined;
  const system = r.system === true || (typeof r.id === "string" && r.id.startsWith("seed-"));
  return { id, user, text, did, ts, system };
}

function messagesFromSnapshot(snapshot) {
  if (typeof snapshot !== "object" || snapshot === null) return [];
  const raw = snapshot.messages;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMessage).filter(Boolean);
}

function normalizeChannel(value) {
  if (typeof value !== "object" || value === null) return null;
  const c = value;
  const id = typeof c.id === "string" ? c.id : null;
  const kind = c.kind;
  const label = typeof c.label === "string" ? c.label : null;
  if (!id || !label || !["general", "state", "city", "grid", "biz"].includes(kind)) return null;
  return {
    id,
    kind,
    label,
    sublabel: typeof c.sublabel === "string" ? c.sublabel : undefined,
    transient: c.transient === true,
  };
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const KIND_GLYPH = { general: "ALL", state: "ST", city: "CT", grid: "##", biz: "BIZ" };

// ── app state ────────────────────────────────────────────────────────────────
const state = {
  did: "anon",
  handle: null,
  channels: [GENERAL_CHANNEL],
  activeId: "general",
  messages: [],
  presence: 0,
  typing: new Map(), // did -> timeout id
  transport: "connecting", // connecting | ws | poll | down
};

const dom = {};

// True once the user explicitly clicks a channel — until then geolocation is free to
// auto-upgrade the active channel to the most specific non-transient one (grid/city).
let userSelected = false;

// ── transport: WS-first with HTTP poll fallback ──────────────────────────────
const conn = {
  ws: null,
  retries: 0,
  mode: "connecting",
  pollTimer: undefined,
  reconnectTimer: undefined,
  pingTimer: undefined,
  generation: 0, // bump on channel switch to invalidate stale callbacks
};

function setTransport(t) {
  state.transport = t;
  dom.transportText.textContent =
    t === "ws" ? "live (ws)" : t === "poll" ? "poll" : t === "down" ? "offline" : "connecting";
  dom.transportDot.className = "dot " + (t === "ws" ? "ws" : t === "poll" ? "poll" : t === "down" ? "down" : "");
}

function socketUrl(room, did) {
  const url = new URL(`${WS_BASE}/api/chat/socket`);
  url.searchParams.set("room", room || "general");
  url.searchParams.set("did", did);
  return url.toString();
}

function teardownConnection() {
  conn.generation++;
  clearTimeout(conn.pollTimer);
  clearTimeout(conn.reconnectTimer);
  clearInterval(conn.pingTimer);
  if (conn.ws) {
    try {
      conn.ws.onopen = conn.ws.onmessage = conn.ws.onclose = conn.ws.onerror = null;
      conn.ws.close();
    } catch {
      /* already closed */
    }
    conn.ws = null;
  }
}

function startConnection(room) {
  teardownConnection();
  const gen = conn.generation;
  conn.retries = 0;
  conn.mode = "connecting";
  setTransport("connecting");

  const poll = async () => {
    if (gen !== conn.generation) return;
    try {
      const res = await fetch(`${HTTP_BASE}/api/chat/recent?room=${encodeURIComponent(room)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`chat ${res.status}`);
      const payload = await res.json();
      if (gen !== conn.generation) return;
      const next = Array.isArray(payload.messages)
        ? payload.messages.map(normalizeMessage).filter(Boolean)
        : [];
      state.messages = next;
      renderMessages();
    } catch {
      if (gen === conn.generation) setTransport("down");
    } finally {
      if (gen === conn.generation && conn.mode === "poll") conn.pollTimer = setTimeout(poll, POLL_MS);
    }
  };

  const startPolling = () => {
    if (gen !== conn.generation) return;
    conn.mode = "poll";
    setTransport("poll");
    void poll();
  };

  const connect = () => {
    if (gen !== conn.generation) return;
    if (typeof WebSocket === "undefined") {
      startPolling();
      return;
    }
    let ws;
    try {
      ws = new WebSocket(socketUrl(room, state.did));
    } catch {
      startPolling();
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      if (gen !== conn.generation) return;
      conn.retries = 0;
      conn.mode = "ws";
      setTransport("ws");
      clearInterval(conn.pingTimer);
      conn.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            /* ignore */
          }
        }
      }, PING_MS);
    };

    ws.onmessage = (ev) => {
      if (gen !== conn.generation) return;
      let frame;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (frame.type === "sync") {
        state.messages = messagesFromSnapshot(frame.snapshot);
        renderMessages();
      } else if (frame.type === "presence" && Array.isArray(frame.online)) {
        state.presence = frame.online.filter((d) => typeof d === "string").length;
        renderPresence();
      } else if (frame.type === "typing" && typeof frame.did === "string") {
        const who = frame.did;
        if (who === state.did) return;
        const prev = state.typing.get(who);
        if (prev) clearTimeout(prev);
        state.typing.set(
          who,
          setTimeout(() => {
            state.typing.delete(who);
            renderTyping();
          }, TYPING_TTL_MS)
        );
        renderTyping();
      }
    };

    const drop = () => {
      if (gen !== conn.generation || conn.mode === "poll") return;
      setTransport("down");
      clearInterval(conn.pingTimer);
      if (conn.retries < WS_MAX_RETRIES) {
        conn.retries += 1;
        conn.reconnectTimer = setTimeout(connect, Math.min(8000, 600 * 2 ** conn.retries));
      } else {
        startPolling();
      }
    };
    ws.onclose = drop;
    ws.onerror = drop;
  };

  connect();
}

let lastTypingSent = 0;
function sendTyping() {
  const ws = conn.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (now - lastTypingSent < TYPING_THROTTLE_MS) return;
  lastTypingSent = now;
  try {
    ws.send(JSON.stringify({ type: "typing" }));
  } catch {
    /* ignore */
  }
}

function postFallback(message) {
  void fetch(`${HTTP_BASE}/api/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: message.user,
      did: state.did,
      text: message.text,
      room: state.activeId,
    }),
  }).catch(() => {});
}

function sendMessage(text) {
  const clean = text.trim().slice(0, 180);
  if (!clean) return;
  const displayUser = friendlyDidName(state.did);
  const optimistic = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user: displayUser,
    text: clean,
    did: state.did,
    ts: Date.now(),
    system: false,
  };
  state.messages = [...state.messages.slice(-80), optimistic];
  renderMessages();

  const ws = conn.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "post", author: state.did, content: clean, ts: Date.now() }));
    } catch {
      postFallback(optimistic);
    }
  } else {
    postFallback(optimistic);
  }
}

// ── geolocation → channels ───────────────────────────────────────────────────
function resolveChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) return;
  state.channels = channels;
  // Default to the most specific NON-transient channel (grid/city), else last, else
  // general — until the user explicitly picks one. If the active channel vanished
  // from the hierarchy (moved away), fall back the same way.
  const ids = channels.map((c) => c.id);
  if (!userSelected || !ids.includes(state.activeId)) {
    const nonTransient = channels.filter((c) => !c.transient);
    const pool = nonTransient.length ? nonTransient : channels;
    const pick = pool[pool.length - 1].id;
    if (pick !== state.activeId) selectChannel(pick, true);
  }
  renderChannels();
}

async function fetchChannels(lat, lon) {
  try {
    const res = await fetch(`${HTTP_BASE}/api/skychat/channels?lat=${lat}&lon=${lon}`, { cache: "no-store" });
    if (!res.ok) return;
    const payload = await res.json();
    const next = Array.isArray(payload.channels)
      ? payload.channels.map(normalizeChannel).filter(Boolean)
      : [];
    if (next.length > 0) resolveChannels(next);
  } catch {
    /* keep last resolved set; honest degrade */
  }
}

function enableLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    dom.locStatus.textContent = "Geolocation unsupported — showing general.";
    return;
  }
  dom.locStatus.textContent = "Requesting location…";
  const onPos = (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    dom.locStatus.textContent = `Near ${lat.toFixed(3)}, ${lon.toFixed(3)} — channels live.`;
    void fetchChannels(lat, lon);
  };
  const onErr = (err) => {
    dom.locStatus.textContent =
      err && err.code === err.PERMISSION_DENIED
        ? "Location denied — staying on general."
        : "Location unavailable — staying on general.";
  };
  navigator.geolocation.getCurrentPosition(onPos, onErr, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 15000,
  });
  navigator.geolocation.watchPosition(onPos, onErr, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 10000,
  });
}

// ── channel selection ────────────────────────────────────────────────────────
function selectChannel(id, reconnect = true) {
  state.activeId = id;
  state.messages = [];
  state.presence = 0;
  state.typing.forEach((t) => clearTimeout(t));
  state.typing.clear();
  const ch = state.channels.find((c) => c.id === id) || GENERAL_CHANNEL;
  dom.roomLabel.textContent = ch.label;
  dom.roomSublabel.textContent = ch.sublabel || ch.kind;
  renderMessages();
  renderPresence();
  renderTyping();
  renderChannels();
  if (reconnect) startConnection(id);
}

// ── render ───────────────────────────────────────────────────────────────────
function renderChannels() {
  dom.channelList.replaceChildren();
  for (const ch of state.channels) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "channel" + (ch.id === state.activeId ? " active" : "");

    const glyph = document.createElement("span");
    glyph.className = "channel-kind";
    glyph.textContent = KIND_GLYPH[ch.kind] || "?";

    const copy = document.createElement("span");
    copy.className = "channel-copy";
    const strong = document.createElement("strong");
    strong.textContent = ch.label;
    const small = document.createElement("small");
    small.textContent = ch.sublabel || ch.kind;
    copy.append(strong, small);

    btn.append(glyph, copy);
    if (ch.transient) {
      const t = document.createElement("span");
      t.className = "channel-transient";
      t.textContent = "TMP";
      btn.append(t);
    }
    btn.addEventListener("click", () => {
      userSelected = true;
      selectChannel(ch.id);
    });
    li.append(btn);
    dom.channelList.append(li);
  }
}

function renderMessages() {
  dom.messages.replaceChildren();
  if (state.messages.length === 0) {
    const li = document.createElement("li");
    li.className = "msg-empty";
    li.textContent = state.transport === "down" ? "Reconnecting…" : "No messages yet. Say hello.";
    dom.messages.append(li);
    return;
  }
  for (const m of state.messages) {
    const li = document.createElement("li");
    li.className = "msg" + (m.system ? " system" : "");

    const body = document.createElement("div");
    body.className = "msg-body";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const author = document.createElement("span");
    author.className = "msg-author";
    author.textContent = m.user;
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = timeAgo(m.ts);
    meta.append(author, time);

    const txt = document.createElement("div");
    txt.className = "msg-text";
    txt.textContent = m.text;

    body.append(meta, txt);
    li.append(body);
    dom.messages.append(li);
  }
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderPresence() {
  const n = state.presence;
  dom.roomOnline.textContent = `${n} online`;
  dom.presenceText.textContent = n > 0 ? `${n} near` : "quiet";
}

function renderTyping() {
  const n = state.typing.size;
  dom.typing.textContent = n === 0 ? "" : n === 1 ? "someone is typing…" : `${n} people typing…`;
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

// ── boot ─────────────────────────────────────────────────────────────────────
function init() {
  dom.identityName = document.querySelector("#identity-name");
  dom.presenceText = document.querySelector("#presence-text");
  dom.transportText = document.querySelector("#transport-text");
  dom.transportDot = document.querySelector("#transport-dot");
  dom.clock = document.querySelector("#clock");
  dom.locBtn = document.querySelector("#loc-btn");
  dom.locStatus = document.querySelector("#loc-status");
  dom.channelList = document.querySelector("#channel-list");
  dom.roomLabel = document.querySelector("#room-label");
  dom.roomSublabel = document.querySelector("#room-sublabel");
  dom.roomOnline = document.querySelector("#room-online");
  dom.messages = document.querySelector("#messages");
  dom.typing = document.querySelector("#typing");
  dom.composer = document.querySelector("#composer");
  dom.composerInput = document.querySelector("#composer-input");

  state.did = getLocalDid();
  state.handle = getLocalHandle();
  dom.identityName.textContent = state.handle || friendlyDidName(state.did);

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  renderChannels();
  renderPresence();
  renderTyping();

  dom.locBtn.addEventListener("click", enableLocation);
  dom.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(dom.composerInput.value);
    dom.composerInput.value = "";
  });
  dom.composerInput.addEventListener("input", sendTyping);

  // Start on general immediately; geolocation upgrades the channel set on demand.
  selectChannel("general");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
