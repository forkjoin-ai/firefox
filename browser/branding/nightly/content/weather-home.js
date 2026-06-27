/* weather-home.js — self-contained vanilla port of the storms-watch weather app
 * for the packaged about:weather page. No React, no bundler, no npm imports: plain
 * DOM + fetch + geolocation + localStorage. Logic ported from
 * apps/storms-watch/src/horizon (nws/geo/minutecast) + the /api/weather contract.
 *
 * The page runs from a chrome://branding (about:weather) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src +
 * the storms-watch /api CORS headers).
 *
 * Scope — "current + forecast for my location": NOW hero, hourly strip, 7-day grid,
 * next-hour rain, extra metrics, active-storm banner, F/C toggle. Deliberately
 * SKIPPED (heavy / out of scope for a dependency-free page): candle charts, the 3D
 * globe (WeatherEarthStage), the precog cockpit, mesh-contribute, sim, intake
 * telemetry. */
"use strict";

const HTTP_BASE = "https://storms.forkjoin.ai";
const LS_PLACE = "storms-watch:lastPlace";
const LS_UNIT = "storms-watch:unit";

const state = {
  place: null, // { lat, lon, label }
  unit: "F", // "F" | "C"
  weather: null,
};

const dom = {};

// ── persistence ───────────────────────────────────────────────────────────────
function loadPlace() {
  try {
    const raw = window.localStorage.getItem(LS_PLACE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function savePlace(place) {
  try {
    window.localStorage.setItem(LS_PLACE, JSON.stringify(place));
  } catch {
    /* ignore */
  }
}

function loadUnit() {
  try {
    return window.localStorage.getItem(LS_UNIT) === "C" ? "C" : "F";
  } catch {
    return "F";
  }
}

function saveUnit(unit) {
  try {
    window.localStorage.setItem(LS_UNIT, unit);
  } catch {
    /* ignore */
  }
}

// ── units / formatting ──────────────────────────────────────────────────────
function temp(tempF) {
  if (tempF === null || tempF === undefined || !Number.isFinite(tempF)) return "--";
  const v = state.unit === "C" ? ((tempF - 32) * 5) / 9 : tempF;
  return `${Math.round(v)}°`;
}

function setStatus(text) {
  dom.statusLine.textContent = text;
}

function clearForecastUI() {
  dom.nowCard.hidden = true;
  dom.hourlyCard.hidden = true;
  dom.dailyCard.hidden = true;
  dom.rainLine.hidden = true;
  dom.rainStrip.hidden = true;
  dom.stormBanner.hidden = true;
}

// ── fetch helpers ─────────────────────────────────────────────────────────────
async function getJson(path) {
  const res = await fetch(`${HTTP_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── geolocation ───────────────────────────────────────────────────────────────
function useGeolocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    setStatus("Geolocation unsupported — search a place below.");
    return;
  }
  setStatus("Requesting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const place = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: "My location",
      };
      setPlace(place);
    },
    (err) => {
      setStatus(
        err && err.code === err.PERMISSION_DENIED
          ? "Location denied — search a place below."
          : "Location unavailable — search a place below."
      );
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// ── place search ──────────────────────────────────────────────────────────────
async function runSearch(query) {
  const q = query.trim();
  if (q.length < 2) return;
  setStatus(`Searching “${q}”…`);
  let results = [];
  try {
    results = await getJson(`/api/geo/search?q=${encodeURIComponent(q)}`);
  } catch {
    setStatus("Search failed — try again.");
    return;
  }
  renderSearchResults(Array.isArray(results) ? results : []);
}

function renderSearchResults(results) {
  dom.searchResults.replaceChildren();
  if (results.length === 0) {
    dom.searchResults.hidden = true;
    setStatus("No matches — try another spelling.");
    return;
  }
  for (const r of results.slice(0, 8)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const name = document.createElement("span");
    name.textContent = r.label || r.name;
    const sub = document.createElement("span");
    sub.className = "res-sub";
    sub.textContent = `${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`;
    btn.append(name, sub);
    btn.addEventListener("click", () => {
      dom.searchResults.hidden = true;
      dom.searchInput.value = "";
      setPlace({ lat: r.lat, lon: r.lon, label: r.label || r.name });
    });
    li.append(btn);
    dom.searchResults.append(li);
  }
  dom.searchResults.hidden = false;
}

// ── active place → load everything ────────────────────────────────────────────
function setPlace(place) {
  state.place = place;
  savePlace(place);
  dom.locName.textContent = place.label;
  void loadWeather();
}

async function loadWeather() {
  const place = state.place;
  if (!place) return;
  setStatus(`Loading forecast for ${place.label}…`);
  let wx;
  try {
    wx = await getJson(`/api/weather/forecast?lat=${place.lat}&lon=${place.lon}`);
  } catch (e) {
    clearForecastUI();
    dom.emptyState.hidden = false;
    dom.emptyState.textContent = "Could not load the forecast. Try refresh.";
    setStatus(`Forecast unavailable (${e instanceof Error ? e.message : "error"}).`);
    return;
  }
  state.weather = wx;
  dom.emptyState.hidden = true;
  renderWeather();
  const cityLabel = wx.city && place.label === "My location" ? wx.city : place.label;
  setStatus(`Updated ${new Date().toLocaleTimeString()} · ${cityLabel}`);

  // Nice-to-haves — best effort, never block the core render.
  void loadMinutecast();
  void loadConditions();
  void loadStorms();
}

function renderWeather() {
  const wx = state.weather;
  if (!wx) return;
  const now = wx.now || {};

  dom.nowTemp.textContent = temp(now.tempF);
  dom.nowCond.textContent = now.condition || "—";
  dom.nowPlace.textContent = wx.city || state.place.label;
  const hi = temp(wx.hi24F);
  const lo = temp(wx.lo24F);
  dom.nowHilo.textContent = `H ${hi} · L ${lo}`;

  const stats = [
    ["Precip", now.precipPct !== null && now.precipPct !== undefined ? `${now.precipPct}%` : "—"],
    ["Humidity", now.humidityPct !== null && now.humidityPct !== undefined ? `${now.humidityPct}%` : "—"],
    ["Wind", now.windMph !== null && now.windMph !== undefined ? `${Math.round(now.windMph)} mph ${now.windDir || ""}`.trim() : "—"],
  ];
  dom.nowStats.replaceChildren();
  for (const [k, v] of stats) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    div.append(dt, dd);
    dom.nowStats.append(div);
  }
  dom.nowCard.hidden = false;

  renderHourly(Array.isArray(wx.hourly) ? wx.hourly.slice(0, 24) : []);
  renderDaily(foldDaily(Array.isArray(wx.daily) ? wx.daily : []));
}

function renderHourly(hours) {
  dom.hourlyStrip.replaceChildren();
  if (hours.length === 0) {
    dom.hourlyCard.hidden = true;
    return;
  }
  for (const h of hours) {
    const cell = document.createElement("div");
    cell.className = "hour";
    const t = document.createElement("span");
    t.className = "hour-time";
    const d = new Date(h.time);
    t.textContent = Number.isNaN(d.getTime())
      ? "--"
      : `${((d.getHours() + 11) % 12) + 1}${d.getHours() < 12 ? "a" : "p"}`;
    const temperature = document.createElement("span");
    temperature.className = "hour-temp";
    temperature.textContent = temp(h.tempF);
    const short = document.createElement("span");
    short.className = "hour-short";
    short.textContent = h.short || "";
    cell.append(t, temperature, short);
    if (h.precipPct !== null && h.precipPct !== undefined && h.precipPct > 0) {
      const p = document.createElement("span");
      p.className = "hour-precip";
      p.textContent = `${h.precipPct}%`;
      cell.append(p);
    }
    dom.hourlyStrip.append(cell);
  }
  dom.hourlyCard.hidden = false;
}

// Fold the 12h day/night periods into per-day {name, hi, lo, short, precip}.
function foldDaily(periods) {
  const byDate = new Map();
  for (const p of periods) {
    const date = (p.date || "").slice(0, 10) || p.name;
    if (!byDate.has(date)) byDate.set(date, { day: null, night: null, order: byDate.size });
    const slot = byDate.get(date);
    if (p.isDaytime) slot.day = p;
    else slot.night = p;
  }
  const days = [];
  for (const { day, night } of byDate.values()) {
    const lead = day || night;
    if (!lead) continue;
    const name = (day ? day.name : night.name.replace(/\s+Night$/i, "")) || lead.name;
    const precipCandidates = [day && day.precipPct, night && night.precipPct].filter(
      (v) => v !== null && v !== undefined
    );
    days.push({
      name,
      hi: day ? day.tempF : null,
      lo: night ? night.tempF : null,
      short: (day || night).short || "",
      precip: precipCandidates.length ? Math.max(...precipCandidates) : null,
    });
  }
  return days.slice(0, 7);
}

function renderDaily(days) {
  dom.dailyGrid.replaceChildren();
  if (days.length === 0) {
    dom.dailyCard.hidden = true;
    return;
  }
  for (const d of days) {
    const cell = document.createElement("div");
    cell.className = "day";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = d.name;
    const t = document.createElement("span");
    t.className = "day-temp";
    t.append(document.createTextNode(temp(d.hi)));
    if (d.lo !== null) {
      const lo = document.createElement("span");
      lo.className = "lo";
      lo.textContent = temp(d.lo);
      t.append(lo);
    }
    const short = document.createElement("span");
    short.className = "day-short";
    short.textContent = d.short;
    cell.append(name, t, short);
    if (d.precip !== null && d.precip > 0) {
      const p = document.createElement("span");
      p.className = "day-precip";
      p.textContent = `${d.precip}% rain`;
      cell.append(p);
    }
    dom.dailyGrid.append(cell);
  }
  dom.dailyCard.hidden = false;
}

// ── next-hour rain (minutecast) ───────────────────────────────────────────────
async function loadMinutecast() {
  const place = state.place;
  if (!place) return;
  let mc;
  try {
    mc = await getJson(`/api/weather/minutecast?lat=${place.lat}&lon=${place.lon}`);
  } catch {
    return;
  }
  if (!mc || !mc.summary) {
    dom.rainLine.hidden = true;
    dom.rainStrip.hidden = true;
    return;
  }
  dom.rainLine.textContent = mc.summary.caption || "";
  dom.rainLine.hidden = !mc.summary.caption;

  const buckets = Array.isArray(mc.buckets) ? mc.buckets : [];
  dom.rainStrip.replaceChildren();
  if (buckets.length === 0 || mc.summary.peakPrecip <= 0) {
    dom.rainStrip.hidden = true;
    return;
  }
  const peak = mc.summary.peakPrecip || 1;
  for (const b of buckets) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const h = Math.max(2, Math.round((b.precip / peak) * 100));
    bar.style.height = `${h}%`;
    dom.rainStrip.append(bar);
  }
  dom.rainStrip.hidden = false;
}

// ── extra metrics (conditions) ────────────────────────────────────────────────
async function loadConditions() {
  const place = state.place;
  if (!place) return;
  let c;
  try {
    c = await getJson(`/api/weather/conditions?lat=${place.lat}&lon=${place.lon}`);
  } catch {
    return;
  }
  if (!c) return;
  const extras = [];
  if (c.feelsLikeF !== null && c.feelsLikeF !== undefined) extras.push(["Feels like", temp(c.feelsLikeF)]);
  if (c.uvIndex !== null && c.uvIndex !== undefined) extras.push(["UV index", String(Math.round(c.uvIndex))]);
  if (c.pressureMb !== null && c.pressureMb !== undefined) extras.push(["Pressure", `${Math.round(c.pressureMb)} mb`]);
  for (const [k, v] of extras) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    div.append(dt, dd);
    dom.nowStats.append(div);
  }
}

// ── active storms strip ───────────────────────────────────────────────────────
async function loadStorms() {
  let feed;
  try {
    feed = await getJson(`/api/live/current-storms`);
  } catch {
    return;
  }
  if (!feed || !feed.activeCount || feed.activeCount <= 0) {
    dom.stormBanner.hidden = true;
    return;
  }
  const storms = Array.isArray(feed.storms) ? feed.storms : [];
  const names = storms
    .map((s) => s.classification || s.name || s.summary)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  dom.stormBanner.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = `${feed.activeCount} active storm${feed.activeCount === 1 ? "" : "s"}`;
  dom.stormBanner.append(label);
  if (names) dom.stormBanner.append(document.createTextNode(` · ${names}`));
  dom.stormBanner.hidden = false;
}

// ── unit toggle ───────────────────────────────────────────────────────────────
function toggleUnit() {
  state.unit = state.unit === "F" ? "C" : "F";
  saveUnit(state.unit);
  dom.unitLabel.textContent = state.unit === "F" ? "°F" : "°C";
  if (state.weather) {
    renderWeather();
    void loadMinutecast();
    void loadConditions();
  }
}

// ── clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// Decorative hex field, ported from skychat-home.js so the aesthetic matches.
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
  dom.locName = document.querySelector("#loc-name");
  dom.unitToggle = document.querySelector("#unit-toggle");
  dom.unitLabel = document.querySelector("#unit-label");
  dom.refreshBtn = document.querySelector("#refresh-btn");
  dom.locateBtn = document.querySelector("#locate-btn");
  dom.clock = document.querySelector("#clock");
  dom.searchForm = document.querySelector("#search-form");
  dom.searchInput = document.querySelector("#search-input");
  dom.searchResults = document.querySelector("#search-results");
  dom.statusLine = document.querySelector("#status-line");
  dom.stormBanner = document.querySelector("#storm-banner");
  dom.nowCard = document.querySelector("#now-card");
  dom.nowTemp = document.querySelector("#now-temp");
  dom.nowCond = document.querySelector("#now-cond");
  dom.nowPlace = document.querySelector("#now-place");
  dom.nowHilo = document.querySelector("#now-hilo");
  dom.nowStats = document.querySelector("#now-stats");
  dom.rainLine = document.querySelector("#rain-line");
  dom.rainStrip = document.querySelector("#rain-strip");
  dom.hourlyCard = document.querySelector("#hourly-card");
  dom.hourlyStrip = document.querySelector("#hourly-strip");
  dom.dailyCard = document.querySelector("#daily-card");
  dom.dailyGrid = document.querySelector("#daily-grid");
  dom.emptyState = document.querySelector("#empty-state");

  state.unit = loadUnit();
  dom.unitLabel.textContent = state.unit === "F" ? "°F" : "°C";

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  dom.unitToggle.addEventListener("click", toggleUnit);
  dom.refreshBtn.addEventListener("click", () => {
    if (state.place) void loadWeather();
    else useGeolocation();
  });
  dom.locateBtn.addEventListener("click", useGeolocation);
  dom.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void runSearch(dom.searchInput.value);
  });

  const saved = loadPlace();
  if (saved) {
    setPlace(saved);
  } else {
    useGeolocation();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
