/**
 * about:mechcog — thin vanilla client of the affectively-mechcog-app worker.
 *
 * Surface ported: the Mechacognition landing experience — headline, the
 * "Three Versions of You" cognitive-topology architecture (Now / Halogram /
 * Cyrano), and a LIVE presence counter driven by the worker's only read API.
 *
 * Core read endpoint:
 *   GET https://mech.forkjoin.ai/api/visitors -> { count: number }
 *
 * SKIPPED (heavy / not thin-client-friendly):
 *   - Three.js HeroCanvas + 3D cognitive-topology visualizations (WebGL)
 *   - WebSocket presence (/ws, /_aeon/ws cursors/scroll/emotions) — we POLL
 *     /api/visitors instead for the headline count, no WS needed
 *   - Waitlist / invite write flow (write-heavy), telemetry, web-vitals
 *
 * Identity: mechcog is a PUBLIC landing page, so identity is OPTIONAL. We read
 * window.KenomaIdentity if the Kenoma SSO foundation injected it (render a
 * badge), else degrade silently to guest with a "Sign in" affordance. Never
 * hard-fail; the page is fully functional signed-out.
 */

(function () {
  "use strict";

  const BASE = "https://mech.forkjoin.ai";
  const POLL_MS = 15000;

  const $ = (id) => document.getElementById(id);

  // ---- live presence count -------------------------------------------------
  async function fetchVisitors() {
    const res = await fetch(`${BASE}/api/visitors`, { cache: "no-store" });
    if (!res.ok) throw new Error(`visitors ${res.status}`);
    return res.json();
  }

  function renderCount(count) {
    const n = Number.isFinite(count) ? count : 0;
    const numEl = $("livecount-num");
    const labelEl = $("livecount-label");
    const presenceEl = $("presence-text");
    numEl.textContent = String(n);
    labelEl.textContent =
      n === 1 ? "mind exploring right now" : "minds exploring right now";
    if (presenceEl) presenceEl.textContent = n + " live";
  }

  function renderCountError() {
    $("livecount-num").textContent = "—";
    $("livecount-label").textContent = "presence unavailable";
    const presenceEl = $("presence-text");
    if (presenceEl) presenceEl.textContent = "offline";
  }

  let pollTimer = null;
  async function pollLoop() {
    try {
      const data = await fetchVisitors();
      renderCount(data && typeof data.count === "number" ? data.count : 0);
    } catch (err) {
      console.warn("[mechcog] visitors poll failed", err);
      renderCountError();
    } finally {
      pollTimer = setTimeout(pollLoop, POLL_MS);
    }
  }

  // ---- optional Kenoma identity (public page: best-effort only) ------------
  function applyIdentity(id) {
    const pill = $("identity-pill");
    const nameEl = $("identity-name");
    const signin = $("signin-btn");
    if (id && id.token) {
      const profile = id.profile || {};
      const kind = profile.participantKind || "human";
      const did = id.did || "";
      nameEl.textContent =
        kind + (did ? " · " + did.replace(/^did:[^:]+:/, "").slice(0, 14) : "");
      pill.hidden = false;
      if (signin) signin.hidden = true;
    } else {
      pill.hidden = true;
      if (signin) signin.hidden = false;
    }
  }

  function wireIdentity() {
    const api = window.KenomaIdentity;
    if (!api) {
      // No SSO foundation present in this context — degrade to guest.
      applyIdentity(null);
      return;
    }
    const signin = $("signin-btn");
    if (signin && api.signIn) {
      signin.addEventListener("click", () => {
        api.signIn().then(applyIdentity).catch(() => {});
      });
    }
    if (api.getBadge) {
      api.getBadge().then(applyIdentity).catch(() => applyIdentity(null));
    } else {
      applyIdentity(null);
    }
    if (api.onChange) {
      try {
        api.onChange(applyIdentity);
      } catch (_) {}
    }
  }

  function bootIdentity() {
    if (window.KenomaIdentity) {
      wireIdentity();
    } else {
      // Wait briefly for the SSO actor; degrade to guest if it never arrives.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        wireIdentity();
      };
      window.addEventListener("KenomaIdentity:ready", finish, { once: true });
      setTimeout(finish, 1500);
    }
  }

  // ---- boot ----------------------------------------------------------------
  function init() {
    bootIdentity();
    pollLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
