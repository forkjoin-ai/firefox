/* fact-home.js — self-contained vanilla port of Fractal Fact (fact.forkjoin.ai)
 * for the packaged about:fact page. No React, no bundler, no npm imports: plain
 * DOM + fetch + the shared Kenoma identity bridge.
 *
 * The page runs from a chrome://branding (about:fact) origin, so it ALWAYS talks
 * to the absolute backend base (cross-origin, allowed by the page CSP connect-src
 * + the fractal-fact /api CORS headers).
 *
 * Scope — the "facts / verification feed" headline. Core read endpoints:
 *   GET /api/facts/graph        -> { nodes, links, metrics }   (the fact feed)
 *   GET /api/entropy            -> belief-distribution stats    (entropy panel)
 *   GET /api/facts/search?q=    -> { results }                  (claim search)
 *   GET /api/anchoring/status   -> { batches }                  (anchor panel)
 *
 * Identity: reads the shared window.KenomaIdentity badge (fractal-iam). If signed
 * in, the badge token is sent as Authorization: Bearer for graph/search and the
 * profile renders in the topbar pill. If absent/null -> public default-space feed
 * + a Sign in button. Never hard-fails.
 *
 * Deliberately SKIPPED (heavy / write / dependency-laden, out of scope for a
 * dependency-free read page): the 3D/force fact-graph view, voting & commit-reveal
 * rounds (writes), evidence/attachment upload, fact create/edit/delete, live
 * presence cursors, the AeonPID agent panel, treasury/bond writes, LLM/ESI
 * inference & decompose, contribution settings, and any encrypted/auth-gated
 * mutations. */
"use strict";

const HTTP_BASE = "https://fact.forkjoin.ai";

const state = {
  identity: null, // { token, did, profile } | null
  facts: [],
  query: "",
  metrics: null, // from /api/facts/graph
  entropy: null, // from /api/entropy
};

const dom = {};

// ── fetch helpers ─────────────────────────────────────────────────────────────
function authHeaders() {
  const h = {};
  if (state.identity && state.identity.token) {
    h["Authorization"] = `Bearer ${state.identity.token}`;
  }
  return h;
}

async function getJson(path) {
  const res = await fetch(`${HTTP_BASE}${path}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── field-name normalization (worker returns raw snake_case D1 rows) ────────────
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function normFact(n) {
  return {
    id: pick(n, "id") || "",
    parentId: pick(n, "parentId", "parent_id") || null,
    claim:
      pick(n, "normalizedClaim", "normalized_claim", "rawText", "raw_text") ||
      "(untitled claim)",
    state: (pick(n, "state") || "raw").toLowerCase(),
    pTrue: Number(pick(n, "pTrue", "p_true")),
    voteScore: Number(pick(n, "voteScore", "vote_score")),
    depth: Number(pick(n, "depth")) || 0,
    anchored: !!pick(n, "anchorTxHash", "anchor_tx_hash"),
  };
}

// ── render: entropy / metrics panel ─────────────────────────────────────────────
// Merges the two independent sources (graph metrics + /api/entropy) held in state
// so a late entropy response never clobbers the verified/pending/disputed counts.
function renderMetrics() {
  const metrics = state.metrics;
  const entropy = state.entropy;

  const total =
    metrics && metrics.totalFacts != null
      ? metrics.totalFacts
      : entropy && entropy.total_facts != null
        ? entropy.total_facts
        : 0;
  const verified = metrics ? metrics.verified || 0 : 0;
  const pending = metrics ? metrics.pending || 0 : 0;
  const disputed = metrics ? metrics.disputed || 0 : 0;

  dom.mTotal.textContent = String(total);
  dom.mVerified.textContent = String(verified);
  dom.mPending.textContent = String(pending);
  dom.mDisputed.textContent = String(disputed);

  const rate =
    metrics && Number.isFinite(metrics.verificationRate)
      ? metrics.verificationRate
      : total > 0
        ? verified / total
        : 0;
  dom.gaugeFill.style.width = `${Math.round(rate * 100)}%`;
  dom.gaugeLabel.textContent = `verification rate ${Math.round(rate * 100)}%`;

  if (entropy) {
    const sh = Number(entropy.shannon_entropy);
    const neg = Number(entropy.negentropy);
    dom.mShannon.textContent = Number.isFinite(sh) ? sh.toFixed(3) : "--";
    dom.mNegentropy.textContent = Number.isFinite(neg) ? neg.toFixed(3) : "--";
  }
}

// ── render: fact feed ───────────────────────────────────────────────────────────
function factCard(f) {
  const li = document.createElement("li");
  li.className = "fact";
  li.style.marginLeft = `${Math.min(f.depth, 6) * 14}px`;

  const claim = document.createElement("div");
  claim.className = "fact-claim";
  claim.textContent = f.claim;

  const meta = document.createElement("div");
  meta.className = "fact-meta";

  const badge = document.createElement("span");
  const known = ["verified", "pending", "disputed", "raw", "atomized"];
  badge.className = `badge ${known.indexOf(f.state) >= 0 ? f.state : "raw"}`;
  badge.textContent = f.state;
  meta.appendChild(badge);

  if (Number.isFinite(f.pTrue)) {
    const pt = document.createElement("span");
    pt.className = "ptrue";
    pt.textContent = `p(true) ${Math.round(f.pTrue * 100)}%`;
    meta.appendChild(pt);
  }
  if (Number.isFinite(f.voteScore) && f.voteScore !== 0) {
    const vs = document.createElement("span");
    vs.textContent = `votes ${f.voteScore > 0 ? "+" : ""}${f.voteScore}`;
    meta.appendChild(vs);
  }
  if (f.anchored) {
    const an = document.createElement("span");
    an.className = "anchored";
    an.textContent = "⛓ anchored";
    meta.appendChild(an);
  }

  li.appendChild(claim);
  li.appendChild(meta);
  return li;
}

function renderFacts() {
  dom.facts.replaceChildren();
  if (!state.facts.length) {
    const empty = document.createElement("li");
    empty.className = "facts-empty";
    empty.textContent = state.query
      ? `No claims match “${state.query}”.`
      : state.identity
        ? "No facts yet in your space."
        : "No public facts yet — sign in to see yours.";
    dom.facts.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const f of state.facts) frag.appendChild(factCard(f));
  dom.facts.appendChild(frag);
}

// ── render: anchoring panel ─────────────────────────────────────────────────────
function renderAnchors(status) {
  dom.anchorList.replaceChildren();
  const batches = (status && status.batches) || [];
  if (!batches.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "no anchor batches yet";
    dom.anchorList.appendChild(li);
    return;
  }
  for (const b of batches.slice(0, 8)) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = (pick(b, "id", "merkleRoot", "merkle_root") || "batch")
      .toString()
      .slice(0, 12);
    const right = document.createElement("span");
    right.textContent = pick(b, "status", "state") || "pending";
    li.appendChild(left);
    li.appendChild(right);
    dom.anchorList.appendChild(li);
  }
}

function setIntegrity(cls, text) {
  dom.integrityDot.className = "dot " + cls;
  dom.integrityText.textContent = text;
}

// ── data load ───────────────────────────────────────────────────────────────────
async function loadFeed() {
  setIntegrity("", "loading");
  try {
    const graph = await getJson("/api/facts/graph");
    const nodes = graph.nodes || graph.facts || [];
    state.facts = nodes.map(normFact);
    state.metrics = graph.metrics || null;
    renderMetrics();
    renderFacts();
    setIntegrity("ok", `${state.facts.length} facts`);
  } catch (e) {
    setIntegrity("down", "graph offline");
    dom.facts.replaceChildren();
    const err = document.createElement("li");
    err.className = "facts-empty";
    err.textContent = `Fact graph unavailable (${e.message}).`;
    dom.facts.appendChild(err);
  }

  // Entropy + anchoring are independent best-effort panels.
  getJson("/api/entropy")
    .then((ent) => {
      state.entropy = ent;
      renderMetrics();
    })
    .catch(() => {});
  getJson("/api/anchoring/status")
    .then(renderAnchors)
    .catch(() => renderAnchors(null));
}

async function runSearch(q) {
  state.query = q;
  if (!q) {
    dom.feedLabel.textContent = "Fact feed";
    await loadFeed();
    return;
  }
  dom.feedLabel.textContent = "Search";
  try {
    const data = await getJson(`/api/facts/search?q=${encodeURIComponent(q)}`);
    const results = data.results || data.nodes || [];
    state.facts = results.map(normFact);
    renderFacts();
  } catch (e) {
    state.facts = [];
    renderFacts();
  }
}

// ── identity ──────────────────────────────────────────────────────────────────
function shortDid(did) {
  if (!did) return "anonymous";
  const tail = did.split(":").pop() || did;
  return tail.length > 14 ? `${tail.slice(0, 6)}…${tail.slice(-4)}` : tail;
}

function renderIdentity() {
  const id = state.identity;
  if (id && id.token) {
    const p = id.profile || {};
    const kind = p.participantKind || "human";
    dom.identityName.textContent =
      (p.handle || p.name || shortDid(id.did)) + ` · ${kind}`;
    dom.signinBtn.hidden = true;
  } else {
    dom.identityName.textContent = "public";
    dom.signinBtn.hidden = false;
  }
}

async function refreshIdentity() {
  try {
    const badge =
      window.KenomaIdentity && window.KenomaIdentity.getBadge
        ? await window.KenomaIdentity.getBadge()
        : null;
    state.identity = badge && badge.token ? badge : null;
  } catch {
    state.identity = null;
  }
  renderIdentity();
}

async function onSignIn() {
  if (!window.KenomaIdentity || !window.KenomaIdentity.signIn) {
    location.href = "about:id";
    return;
  }
  dom.signinBtn.disabled = true;
  try {
    const badge = await window.KenomaIdentity.signIn();
    state.identity = badge && badge.token ? badge : null;
  } catch {
    state.identity = null;
  } finally {
    dom.signinBtn.disabled = false;
  }
  renderIdentity();
  await loadFeed();
}

function startIdentity() {
  if (window.KenomaIdentity && window.KenomaIdentity.onChange) {
    window.KenomaIdentity.onChange(async () => {
      await refreshIdentity();
      await loadFeed();
    });
  }
  refreshIdentity().then(loadFeed);
}

// ── clock ───────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  dom.clock.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

// ── init ──────────────────────────────────────────────────────────────────────
function init() {
  dom.identityName = document.querySelector("#identity-name");
  dom.signinBtn = document.querySelector("#signin-btn");
  dom.integrityDot = document.querySelector("#integrity-dot");
  dom.integrityText = document.querySelector("#integrity-text");
  dom.clock = document.querySelector("#clock");
  dom.mTotal = document.querySelector("#m-total");
  dom.mVerified = document.querySelector("#m-verified");
  dom.mPending = document.querySelector("#m-pending");
  dom.mDisputed = document.querySelector("#m-disputed");
  dom.gaugeFill = document.querySelector("#gauge-fill");
  dom.gaugeLabel = document.querySelector("#gauge-label");
  dom.mShannon = document.querySelector("#m-shannon");
  dom.mNegentropy = document.querySelector("#m-negentropy");
  dom.anchorList = document.querySelector("#anchor-list");
  dom.feedLabel = document.querySelector("#feed-label");
  dom.facts = document.querySelector("#facts");
  dom.searchForm = document.querySelector("#search-form");
  dom.searchInput = document.querySelector("#search-input");

  updateClock();
  setInterval(updateClock, 15000);

  dom.signinBtn.addEventListener("click", onSignIn);

  let searchTimer = null;
  dom.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(dom.searchInput.value.trim());
  });
  dom.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(
      () => runSearch(dom.searchInput.value.trim()),
      350
    );
  });

  // The actor usually injects before page scripts run; if not, wait for ready.
  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    dom.identityName.textContent = "connecting…";
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      startIdentity();
    };
    window.addEventListener("KenomaIdentity:ready", go, { once: true });
    // Don't block the feed on identity — degrade to public after a short wait.
    setTimeout(go, 1200);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
