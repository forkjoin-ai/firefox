/**
 * about:monster — LAUNCHER for Monster Studio (monster.forkjoin.ai).
 *
 * Monster Studio is a heavy WebGL/WebGPU layer-composite .ply 3D viewer
 * (physics / mass / handoff-consensus passes rendered as one animated mass,
 * built on aeon-3d + Edgework). A thin in-page port doesn't fit a 3D engine,
 * so this page is a clean landing surface that links into the live site and
 * its real deep-link query params (?presentation=1, ?view=overview, ?globe=1).
 *
 * No app API / CORS port: the page makes NO network fetches. It only renders a
 * static scene-layer catalog and an optional Kenoma identity badge.
 *
 * Identity: Monster Studio is a public launcher, so identity is OPTIONAL. We
 * read window.KenomaIdentity if the Kenoma SSO foundation injected it (render a
 * badge), else degrade silently to guest with a "Sign in" affordance. Never
 * hard-fail; the page is fully functional signed-out.
 */

(function () {
  "use strict";

  const BASE = "https://monster.forkjoin.ai";

  const $ = (id) => document.getElementById(id);

  // ---- scene-layer catalog (static; deep-links into the live studio) --------
  const SCENES = [
    {
      title: "Mass consensus",
      desc: "The agreed-upon mass pass — where the layers reconcile into one solid form.",
      tag: "mass",
    },
    {
      title: "Physics consensus",
      desc: "The physics pass: forces, settling, and motion folded across the composite.",
      tag: "physics",
    },
    {
      title: "Handoff scene",
      desc: "The handoff-consensus pass that hands state between passes as one animation.",
      tag: "handoff",
    },
    {
      title: "Phyle solver trees",
      desc: "Solver trees rendered as living structure inside the composite.",
      tag: "solver",
    },
    {
      title: "Thoth bodies",
      desc: "Androgynous, woman, and man body point-clouds — the figure layers.",
      tag: "body",
    },
    {
      title: "Live face + head",
      desc: "The Thoth head and live face passes brought into the same scene.",
      tag: "face",
    },
  ];

  function renderScenes() {
    const grid = $("scene-grid");
    if (!grid) return;
    grid.textContent = "";
    SCENES.forEach((s) => {
      const a = document.createElement("a");
      a.className = "scene-card";
      a.href = BASE;
      a.rel = "noopener noreferrer";

      const tag = document.createElement("span");
      tag.className = "scene-tag";
      tag.textContent = s.tag;

      const h = document.createElement("strong");
      h.className = "scene-title";
      h.textContent = s.title;

      const p = document.createElement("span");
      p.className = "scene-desc";
      p.textContent = s.desc;

      a.appendChild(tag);
      a.appendChild(h);
      a.appendChild(p);
      grid.appendChild(a);
    });
  }

  // ---- clock ---------------------------------------------------------------
  function tickClock() {
    const el = $("clock");
    if (!el) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    el.textContent = `${hh}:${mm}`;
  }

  // ---- optional Kenoma identity (public launcher: best-effort only) --------
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
      if (pill) pill.hidden = false;
      if (signin) signin.hidden = true;
    } else {
      if (pill) pill.hidden = true;
      if (signin) signin.hidden = false;
    }
  }

  function wireIdentity() {
    const api = window.KenomaIdentity;
    if (!api) {
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
    renderScenes();
    tickClock();
    setInterval(tickClock, 30000);
    bootIdentity();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
