/*
 * about:todo — Fractal Todo thin client (Kenoma surface)
 *
 * Renders the PUBLIC "global" task graph from todo.forkjoin.ai with plain DOM.
 * Flow: POST /auth/ucan/global (anon guest UCAN) -> GET /api/graph/global.
 * Identity: shared Kenoma SSO bridge `window.KenomaIdentity` (badge readout +
 * Sign in). card.yoga = fractal-iam authority.
 *
 * SKIPPED (thin client, note in handoff): all write ops (add/clone/vote/move),
 * AI flow/enrich/decompose/next-actions, attachments, presence/WebTransport
 * sync, mesh/federation, and the personal signed-in space — the app
 * authenticates personal todos with a Google OAuth session, NOT the fractal-iam
 * badge, so personal data needs app-side badge acceptance (follow-up).
 */

"use strict";

const BASE = "https://todo.forkjoin.ai";
const GRAPH_LIMIT = 500;

const dom = {};
let nodes = [];
let childMap = new Map();
let domains = [];
let activeDomainId = null;

function setGraphStatus(state, text) {
  if (dom.graphDot) {
    dom.graphDot.className = "dot" + (state ? " " + state : "");
  }
  if (dom.graphText) {
    dom.graphText.textContent = text;
  }
}

/* ---------- identity (shared Kenoma SSO bridge) ---------- */

function renderSignedIn(badge) {
  const profile =
    badge.profile && Object.keys(badge.profile).length ? badge.profile : {};
  const name =
    profile.displayName ||
    profile.name ||
    profile.handle ||
    (badge.did ? shortDid(badge.did) : "signed in");
  dom.identityName.textContent = name;
  const kind = profile.participantKind || profile.kind || "human";
  dom.kindText.textContent = kind;
  dom.kindPill.hidden = false;
  dom.authBtn.hidden = true;
}

function renderSignedOut(bridgeAvailable) {
  dom.identityName.textContent = bridgeAvailable ? "guest" : "no bridge";
  dom.kindPill.hidden = true;
  dom.authBtn.hidden = !bridgeAvailable;
}

function shortDid(did) {
  if (did.length <= 22) {
    return did;
  }
  return did.slice(0, 14) + "…" + did.slice(-5);
}

async function refreshIdentity() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.getBadge) {
    renderSignedOut(false);
    return;
  }
  try {
    const badge = await window.KenomaIdentity.getBadge();
    if (badge && badge.token) {
      renderSignedIn(badge);
    } else {
      renderSignedOut(true);
    }
  } catch (e) {
    renderSignedOut(true);
  }
}

async function onSignIn() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.signIn) {
    return;
  }
  dom.authBtn.disabled = true;
  try {
    const badge = await window.KenomaIdentity.signIn();
    if (badge && badge.token) {
      renderSignedIn(badge);
    } else {
      renderSignedOut(true);
    }
  } catch (e) {
    renderSignedOut(true);
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

/* ---------- global task graph (public, read-only) ---------- */

async function mintGuestToken() {
  const response = await fetch(BASE + "/auth/ucan/global", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ permissions: "read", ttlSeconds: 3600 }),
  });
  if (!response.ok) {
    throw new Error("guest token failed (" + response.status + ")");
  }
  const payload = await response.json();
  if (!payload || !payload.sessionToken) {
    throw new Error("no session token in grant");
  }
  return payload.sessionToken;
}

async function fetchGlobalGraph(token) {
  const url =
    BASE + "/api/graph/global?limit=" + GRAPH_LIMIT + "&projection=summary";
  const response = await fetch(url, {
    method: "GET",
    headers: { authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("graph fetch failed (" + response.status + ")");
  }
  const payload = await response.json();
  return Array.isArray(payload.nodes) ? payload.nodes : [];
}

async function loadGlobalGraph() {
  setGraphStatus("", "connecting");
  dom.domainsStatus.textContent = "Loading global graph…";
  try {
    const token = await mintGuestToken();
    nodes = await fetchGlobalGraph(token);
    indexGraph();
    setGraphStatus("ok", nodes.length + " tasks");
    renderDomains();
    if (domains.length) {
      selectDomain(domains[0].id);
    } else {
      dom.domainsStatus.textContent = "No tasks in the global graph yet.";
    }
  } catch (e) {
    setGraphStatus("down", "offline");
    dom.domainsStatus.textContent =
      "Could not load the global graph: " + (e && e.message ? e.message : e);
  }
}

function indexGraph() {
  childMap = new Map();
  for (const node of nodes) {
    if (node.deletedAt) {
      continue;
    }
    const key = node.parentId || "__root__";
    if (!childMap.has(key)) {
      childMap.set(key, []);
    }
    childMap.get(key).push(node);
  }
  for (const list of childMap.values()) {
    list.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  }
  domains = (childMap.get("__root__") || []).slice();
}

function descendantsOf(rootId, includeRoot) {
  const out = [];
  const walk = (id, depth) => {
    const kids = childMap.get(id) || [];
    for (const kid of kids) {
      out.push({ node: kid, depth });
      walk(kid.id, depth + 1);
    }
  };
  if (includeRoot) {
    const root = nodes.find((n) => n.id === rootId);
    if (root) {
      out.push({ node: root, depth: 0 });
    }
    walk(rootId, 1);
  } else {
    walk(rootId, 0);
  }
  return out;
}

function renderDomains() {
  dom.domainList.replaceChildren();
  dom.domainsCount.textContent = String(domains.length);
  dom.domainsStatus.textContent =
    domains.length + " top-level domains · global space";
  for (const domain of domains) {
    const count = descendantsOf(domain.id, false).length;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "domain-item";
    btn.dataset.id = domain.id;
    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain.title || domain.id;
    const badge = document.createElement("span");
    badge.className = "domain-badge";
    badge.textContent = String(count);
    btn.append(name, badge);
    btn.addEventListener("click", () => selectDomain(domain.id));
    li.append(btn);
    dom.domainList.append(li);
  }
}

function selectDomain(id) {
  activeDomainId = id;
  const buttons = dom.domainList.querySelectorAll(".domain-item");
  buttons.forEach((b) => {
    b.classList.toggle("active", b.dataset.id === id);
  });
  const domain = nodes.find((n) => n.id === id);
  if (!domain) {
    return;
  }
  dom.detailName.textContent = domain.title || domain.id;
  dom.detailEmpty.hidden = true;

  const rows = descendantsOf(id, false);
  const doneCount = rows.filter((r) => r.node.status === "done").length;
  if (rows.length) {
    dom.progressChip.hidden = false;
    dom.progressScore.textContent =
      Math.round((doneCount / rows.length) * 100) + "%";
    dom.detailSub.textContent =
      rows.length + " tasks · " + doneCount + " done";
  } else {
    dom.progressChip.hidden = true;
    dom.detailSub.textContent = "no sub-tasks";
  }
  renderTasks(domain, rows);
}

function renderTasks(domain, rows) {
  dom.taskList.replaceChildren();

  if (domain.body) {
    dom.taskList.append(buildTaskRow(domain, -1, true));
  }

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "detail-empty";
    li.textContent = "This domain has no sub-tasks in the global graph.";
    dom.taskList.append(li);
    return;
  }

  for (const row of rows) {
    dom.taskList.append(buildTaskRow(row.node, row.depth, false));
  }
}

function buildTaskRow(node, depth, isHeader) {
  const li = document.createElement("li");
  li.className = "task" + (node.status === "done" ? " done" : "");

  const check = document.createElement("span");
  check.className = "task-check " + node.status;
  check.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "task-body";

  const title = document.createElement("div");
  title.className = "task-title";
  if (depth > 0) {
    title.style.paddingLeft = Math.min(depth, 6) * 14 + "px";
  }
  title.textContent = node.title || node.id;
  body.append(title);

  if (isHeader && node.body) {
    const note = document.createElement("div");
    note.className = "task-note";
    note.textContent = node.body;
    body.append(note);
  }

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const statusTag = document.createElement("span");
  statusTag.className = "task-tag status-" + node.status;
  statusTag.textContent = node.status;
  meta.append(statusTag);
  if (node.priority) {
    const pri = document.createElement("span");
    pri.className = "task-tag";
    pri.textContent = "priority: " + node.priority;
    meta.append(pri);
  }
  if (node.dueDate) {
    const due = document.createElement("span");
    due.className = "task-tag";
    due.textContent = "due " + node.dueDate;
    meta.append(due);
  }
  if (typeof node.voteScore === "number" && node.voteScore !== 0) {
    const vote = document.createElement("span");
    vote.className = "task-tag";
    vote.textContent = (node.voteScore > 0 ? "+" : "") + node.voteScore;
    meta.append(vote);
  }
  body.append(meta);

  li.append(check, body);
  return li;
}

/* ---------- decorative hex field ---------- */

function buildField() {
  const field = document.querySelector(".field");
  if (!field) {
    return;
  }
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
      if (cx < -25 || cx > width + 25 || cy < -25 || cy > height + 25) {
        continue;
      }
      const t = cx / width;
      const distance = Math.hypot(cx - eye.x, cy - eye.y);
      const eyeFactor =
        distance < eye.r ? Math.pow(1 - distance / eye.r, 1.6) : 0;
      const noise =
        Math.sin(cx * 0.018 + cy * 0.011) * 0.5 +
        Math.sin(cx * 0.006 - cy * 0.02 + 1.7) * 0.5;
      const coherence = Math.max(
        0,
        Math.min(
          1,
          Math.pow(Math.max(0, t), 1.18) - eyeFactor * 1.25 + noise * 0.26
        )
      );
      if (coherence < 0.17) {
        continue;
      }
      const size = radius * (0.3 + 0.64 * coherence) * 0.9;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * 60 * i;
        points.push(
          (cx + size * Math.cos(angle)).toFixed(1) +
            "," +
            (cy + size * Math.sin(angle)).toFixed(1)
        );
      }
      const opacity = (0.09 + 0.34 * coherence).toFixed(2);
      out +=
        '<polygon points="' +
        points.join(" ") +
        '" fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="' +
        opacity +
        '"/>';
    }
  }
  field.innerHTML =
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" width="' +
    width +
    '" height="' +
    height +
    '" aria-hidden="true">' +
    out +
    "</svg>";
}

function updateClock() {
  const now = new Date();
  dom.clock.textContent =
    String(now.getHours()).padStart(2, "0") +
    ":" +
    String(now.getMinutes()).padStart(2, "0");
}

function init() {
  dom.identityName = document.querySelector("#identity-name");
  dom.kindPill = document.querySelector("#kind-pill");
  dom.kindText = document.querySelector("#kind-text");
  dom.authBtn = document.querySelector("#auth-btn");
  dom.graphDot = document.querySelector("#graph-dot");
  dom.graphText = document.querySelector("#graph-text");
  dom.clock = document.querySelector("#clock");
  dom.domainList = document.querySelector("#domain-list");
  dom.domainsCount = document.querySelector("#domains-count");
  dom.domainsStatus = document.querySelector("#domains-status");
  dom.detailName = document.querySelector("#detail-name");
  dom.detailSub = document.querySelector("#detail-sub");
  dom.detailEmpty = document.querySelector("#detail-empty");
  dom.progressChip = document.querySelector("#progress-chip");
  dom.progressScore = document.querySelector("#progress-score");
  dom.taskList = document.querySelector("#task-list");

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  dom.authBtn.addEventListener("click", onSignIn);

  // The global graph is public; load it immediately regardless of identity.
  loadGlobalGraph();

  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    renderSignedOut(false);
    window.addEventListener("KenomaIdentity:ready", startIdentity, {
      once: true,
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
