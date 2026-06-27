/*
 * about:them — thin vanilla client for the "them" people graph (them.forkjoin.ai,
 * the deployed them.yoga app). No bundler / React / npm — DOM + fetch only.
 *
 * Identity: the shared Kenoma SSO bridge `window.KenomaIdentity` (getBadge/signIn/
 * signOut/onChange). The badge JWT is passed to them.forkjoin.ai as
 * `Authorization: Bearer <token>`. Signed out -> public/empty + a Sign-in button.
 *
 * Core READ endpoints ported (the headline experience = your contact graph):
 *   GET /api/contacts                          -> { contacts: ContactRecord[] }
 *   GET /api/people/:id/claims                 -> { claims: PersonClaim[] }
 *   GET /api/people/:id/relationships          -> { relationships: [...] }
 *   GET /api/people/:id/consents               -> { consents: [...] }
 *   GET /api/people/:id/backlinks              -> { backlinks: [...], warnings }
 *   GET card.yoga/iam/badge/trust?rootDid=...  -> { ok, score } (public; best-effort)
 *
 * SKIPPED (write-heavy / heavy-viz / not read-path, per thin-client rules):
 *   contact create/update, vCard/CSV imports + commit, people search + share
 *   targets, projection editing, claims-from-iam, consent writes, the Lorenz/Zen
 *   hero WebGL visualizations, the aeon flow/laminar realtime transport.
 */

"use strict";

const APP_BASE = "https://them.forkjoin.ai";

const state = {
  token: null,
  profile: null,
  did: null,
  contacts: [],
  selectedId: null,
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

function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDate(value) {
  if (!value) {
    return "";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusTag(status) {
  const s = String(status || "").toLowerCase();
  const known = ["active", "pending", "revoked", "rejected", "verified", "badge-verified"];
  return known.includes(s) ? s : "neutral";
}

function clearList(el, emptyText) {
  el.textContent = "";
  if (emptyText) {
    const li = document.createElement("li");
    li.className = "empty-row";
    li.textContent = emptyText;
    el.appendChild(li);
  }
}

function row(mainText, tag, tagClass, meta) {
  const li = document.createElement("li");
  li.className = "row";
  const main = document.createElement("div");
  main.className = "row-main";
  const label = document.createElement("span");
  label.textContent = mainText;
  main.appendChild(label);
  if (tag) {
    const t = document.createElement("span");
    t.className = `tag ${tagClass || "neutral"}`;
    t.textContent = tag;
    main.appendChild(t);
  }
  li.appendChild(main);
  if (meta) {
    const m = document.createElement("div");
    m.className = "row-meta";
    m.textContent = meta;
    li.appendChild(m);
  }
  return li;
}

/* ---- contacts ---- */

function renderContacts() {
  const list = dom.contactList;
  list.textContent = "";
  if (state.contacts.length === 0) {
    dom.contactsCount.textContent = "0";
    return;
  }
  dom.contactsCount.textContent = String(state.contacts.length);
  for (const c of state.contacts) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "contact" + (c.personId === state.selectedId ? " active" : "") + (c.blocked ? " blocked" : "");
    btn.type = "button";
    btn.addEventListener("click", () => selectContact(c.personId));

    const av = document.createElement("span");
    av.className = "avatar";
    if (c.avatarUrl) {
      av.style.backgroundImage = `url("${c.avatarUrl}")`;
    } else {
      av.textContent = initials(c.name);
    }
    btn.appendChild(av);

    const copy = document.createElement("span");
    copy.className = "contact-copy";
    const nm = document.createElement("span");
    nm.className = "contact-name";
    nm.textContent = c.name || "(unnamed)";
    const sub = document.createElement("span");
    sub.className = "contact-sub";
    sub.textContent = c.email || c.phone || c.trustTier || c.personId;
    copy.appendChild(nm);
    copy.appendChild(sub);
    btn.appendChild(copy);

    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function loadContacts() {
  if (!state.token) {
    dom.contactsStatus.textContent = "Sign in to load your contacts.";
    dom.contactsCount.textContent = "—";
    state.contacts = [];
    renderContacts();
    return;
  }
  dom.contactsStatus.textContent = "Loading contacts…";
  const { ok, status, body } = await getJson("/api/contacts");
  if (!ok) {
    dom.contactsStatus.textContent =
      status === 401 || status === 403
        ? "Your identity isn’t authorized for them.forkjoin.ai yet."
        : `Couldn’t load contacts (${status}).`;
    state.contacts = [];
    renderContacts();
    return;
  }
  state.contacts = Array.isArray(body.contacts) ? body.contacts : [];
  dom.contactsStatus.textContent = `${state.contacts.length} ${state.contacts.length === 1 ? "contact" : "contacts"}.`;
  if (!state.selectedId && state.contacts[0]) {
    state.selectedId = state.contacts[0].personId;
  }
  renderContacts();
  if (state.selectedId) {
    loadDetail(state.selectedId);
  }
}

/* ---- person detail ---- */

function selectContact(personId) {
  state.selectedId = personId;
  renderContacts();
  loadDetail(personId);
}

function renderHeader(contact) {
  dom.detailEmpty.hidden = true;
  dom.detailName.textContent = contact ? contact.name || "(unnamed)" : "Select a contact";
  dom.detailSub.textContent = contact
    ? contact.email || contact.phone || contact.personId
    : "their claims, relationships and backlinks";
  if (contact && contact.avatarUrl) {
    dom.detailAvatar.style.backgroundImage = `url("${contact.avatarUrl}")`;
    dom.detailAvatar.textContent = "";
  } else if (contact) {
    dom.detailAvatar.style.backgroundImage = "";
    dom.detailAvatar.textContent = initials(contact.name);
  }
}

async function loadDetail(personId) {
  const contact = state.contacts.find((c) => c.personId === personId) || null;
  renderHeader(contact);

  clearList(dom.claimsRows, "loading…");
  clearList(dom.relRows, "loading…");
  clearList(dom.consentsRows, "loading…");
  clearList(dom.backlinksRows, "loading…");

  const enc = encodeURIComponent(personId);
  const [claims, rels, consents, backlinks] = await Promise.all([
    getJson(`/api/people/${enc}/claims`),
    getJson(`/api/people/${enc}/relationships`),
    getJson(`/api/people/${enc}/consents`),
    getJson(`/api/people/${enc}/backlinks`),
  ]);

  if (state.selectedId !== personId) {
    return;
  }

  renderClaims(claims.body.claims);
  renderRelationships(rels.body.relationships);
  renderConsents(consents.body.consents);
  renderBacklinks(backlinks.body.backlinks);
}

function renderClaims(claims) {
  const rows = Array.isArray(claims) ? claims : [];
  if (rows.length === 0) {
    clearList(dom.claimsRows, "No claims.");
    return;
  }
  dom.claimsRows.textContent = "";
  for (const c of rows) {
    const meta = [c.basis, c.createdAt ? `since ${fmtDate(c.createdAt)}` : ""]
      .filter(Boolean)
      .join(" · ");
    dom.claimsRows.appendChild(
      row(c.role || "claim", c.status, statusTag(c.status), meta)
    );
  }
}

function renderRelationships(rels) {
  const rows = Array.isArray(rels) ? rels : [];
  if (rows.length === 0) {
    clearList(dom.relRows, "No relationships.");
    return;
  }
  dom.relRows.textContent = "";
  for (const r of rows) {
    const conf =
      typeof r.confidence === "number"
        ? `${Math.round(r.confidence * 100)}%`
        : "";
    const meta = [r.direction, r.provenance, conf].filter(Boolean).join(" · ");
    dom.relRows.appendChild(row(r.kind || "related", r.direction || "", "neutral", meta));
  }
}

function renderConsents(consents) {
  const rows = Array.isArray(consents) ? consents : [];
  if (rows.length === 0) {
    clearList(dom.consentsRows, "No consents.");
    return;
  }
  dom.consentsRows.textContent = "";
  for (const c of rows) {
    const label = c.scope || c.purpose || c.kind || "consent";
    const status = c.status || c.state || "";
    const meta = [c.audience, c.grantedAt ? fmtDate(c.grantedAt) : ""].filter(Boolean).join(" · ");
    dom.consentsRows.appendChild(row(label, status, statusTag(status), meta));
  }
}

function renderBacklinks(backlinks) {
  const rows = Array.isArray(backlinks) ? backlinks : [];
  if (rows.length === 0) {
    clearList(dom.backlinksRows, "No backlinks.");
    return;
  }
  dom.backlinksRows.textContent = "";
  for (const b of rows) {
    const meta = [b.source, b.createdAt ? fmtDate(b.createdAt) : ""].filter(Boolean).join(" · ");
    dom.backlinksRows.appendChild(row(b.title || b.summary || b.id || "link", "", "neutral", meta));
  }
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
    dom.detailEmpty.textContent = "Pick a contact to inspect their claims, relationships and backlinks.";
  } else {
    dom.identityName.textContent = "signed out";
    dom.identityPill.querySelector(".dot").classList.add("off");
    dom.kindPill.hidden = true;
    dom.authBtn.hidden = false;
    dom.authBtn.textContent = "Sign in";
    dom.detailEmpty.hidden = false;
    dom.detailEmpty.textContent =
      "Sign in with your Kenoma identity to load your people graph.";
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
  loadContacts();
}

async function refreshIdentity() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.getBadge) {
    state.token = null;
    state.profile = null;
    renderIdentity();
    dom.identityName.textContent = "bridge offline";
    loadContacts();
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
  dom.contactsCount = $("#contacts-count");
  dom.contactsStatus = $("#contacts-status");
  dom.contactList = $("#contact-list");
  dom.detailName = $("#detail-name");
  dom.detailSub = $("#detail-sub");
  dom.detailAvatar = $("#detail-avatar");
  dom.detailEmpty = $("#detail-empty");
  dom.claimsRows = $("#claims-rows");
  dom.relRows = $("#rel-rows");
  dom.consentsRows = $("#consents-rows");
  dom.backlinksRows = $("#backlinks-rows");

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  dom.authBtn.addEventListener("click", onAuthClick);

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
