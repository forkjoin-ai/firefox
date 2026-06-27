/* id-home.js — about:id identity hub. Vanilla DOM, no bundler.
 *
 * Consumes the shared, partition-immune identity bridge injected by the
 * KenomaIdentity JSWindowActor as a frozen `window.KenomaIdentity`:
 *
 *   getBadge()       -> Promise<{token,did,profile}|null>
 *   signIn()         -> Promise<{token,did,profile}|null>   (runs card.yoga flow)
 *   signOut()        -> Promise<void>
 *   onChange(cb)     -> unsubscribe()                         (cb(identity|null))
 *   `KenomaIdentity:ready` window event when the API is injected.
 *
 * The card.yoga sign-in flow lives in the actor, so this page just calls the
 * API. It additionally verifies the badge ES256 signature against
 * https://card.yoga/iam/badge/issuer-key to render the verified mark.
 */
"use strict";

const IAM_BASE = "https://card.yoga";

const dom = {};
let issuerKeyPromise = null;
let signingInFlight = false;

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function extractJwt(token) {
  if (typeof token !== "string") {
    return null;
  }
  const m = token.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  return m ? m[0] : null;
}

function decodeBadge(token) {
  const jwt = extractJwt(token);
  if (!jwt) {
    return null;
  }
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(jwt.split(".")[1]));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function fetchIssuerKey() {
  if (!issuerKeyPromise) {
    issuerKeyPromise = fetch(`${IAM_BASE}/iam/badge/issuer-key`, {
      cache: "no-store",
    })
      .then(r => r.json())
      .then(d => (d && d.ok ? d : null))
      .catch(() => null);
  }
  return issuerKeyPromise;
}

async function verifyBadge(token) {
  const jwt = extractJwt(token);
  if (!jwt) {
    return false;
  }
  const issuer = await fetchIssuerKey();
  if (!issuer || !issuer.publicKeyJwk) {
    return false;
  }
  const [h, p, s] = jwt.split(".");
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      issuer.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`)
    );
  } catch (e) {
    return false;
  }
}

function setStatus(kind, text) {
  dom.statusText.textContent = text;
  dom.statusDot.className = "dot " + (kind || "");
}

function fmtExpiry(value) {
  if (!value) {
    return "—";
  }
  const ms = value < 1e12 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function showView(which) {
  dom.viewOut.hidden = which !== "out";
  dom.viewIn.hidden = which !== "in";
}

async function renderSignedIn(badge) {
  const payload = (badge.profile && Object.keys(badge.profile).length
    ? badge.profile
    : decodeBadge(badge.token)) || {};
  const identity = payload.identity || {};
  const caps = payload.capabilities || [];

  dom.displayName.textContent =
    identity.name || identity.username || identity.email || "ForkJoin user";
  dom.email.textContent = identity.email || "";

  if (identity.picture) {
    dom.avatar.src = identity.picture;
    dom.avatar.hidden = false;
  } else {
    dom.avatar.hidden = true;
  }

  dom.did.textContent = badge.did || payload.sub || "—";
  dom.kind.textContent = payload.participantKind || payload.kind || "human";
  dom.issuer.textContent = payload.issuer || payload.iss || "did:web:card.yoga";
  dom.expiry.textContent = fmtExpiry(payload.exp);

  dom.capList.replaceChildren();
  const list = Array.isArray(caps) ? caps : [];
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "cap-empty";
    li.textContent = "No scoped capabilities.";
    dom.capList.append(li);
  } else {
    for (const cap of list) {
      const li = document.createElement("li");
      const can = document.createElement("strong");
      can.textContent = (cap && (cap.can || cap.with)) || String(cap);
      li.append(can);
      if (cap && cap.with && cap.can) {
        const w = document.createElement("span");
        w.textContent = cap.with;
        li.append(w);
      }
      dom.capList.append(li);
    }
  }

  showView("in");
  setStatus("violet", "signed in");

  dom.verifyChip.className = "verify pending";
  dom.verifyText.textContent = "verifying…";
  const ok = await verifyBadge(badge.token);
  dom.verifyChip.className = "verify " + (ok ? "ok" : "bad");
  dom.verifyText.textContent = ok ? "verified" : "unverified";
}

function renderSignedOut(hint) {
  showView("out");
  setStatus("", "signed out");
  dom.outHint.textContent = hint || "";
}

async function refresh() {
  if (!window.KenomaIdentity) {
    renderSignedOut("Identity bridge unavailable.");
    setStatus("down", "bridge offline");
    return;
  }
  try {
    const badge = await window.KenomaIdentity.getBadge();
    if (badge && badge.token) {
      await renderSignedIn(badge);
    } else {
      renderSignedOut();
    }
  } catch (e) {
    renderSignedOut("Could not read identity.");
  }
}

async function onSignIn() {
  if (signingInFlight || !window.KenomaIdentity) {
    if (!window.KenomaIdentity) {
      renderSignedOut("Identity bridge unavailable.");
    }
    return;
  }
  signingInFlight = true;
  dom.signinBtn.disabled = true;
  dom.outHint.textContent = "Opening ForkJoin sign-in…";
  setStatus("pending", "signing in");
  try {
    const badge = await window.KenomaIdentity.signIn();
    if (badge && badge.token) {
      await renderSignedIn(badge);
    } else {
      renderSignedOut("Sign-in cancelled.");
    }
  } catch (e) {
    renderSignedOut(`Sign-in failed: ${(e && e.message) || "unknown error"}`);
    setStatus("down", "sign-in failed");
  } finally {
    signingInFlight = false;
    dom.signinBtn.disabled = false;
  }
}

async function onSignOut() {
  if (!window.KenomaIdentity) {
    return;
  }
  dom.signoutBtn.disabled = true;
  try {
    await window.KenomaIdentity.signOut();
  } catch (e) {
    // ignore
  }
  dom.signoutBtn.disabled = false;
  renderSignedOut();
}

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
          `${(cx + size * Math.cos(angle)).toFixed(1)},${(
            cy +
            size * Math.sin(angle)
          ).toFixed(1)}`
        );
      }
      const opacity = (0.09 + 0.34 * coherence).toFixed(2);
      out += `<polygon points="${points.join(
        " "
      )}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="${opacity}"/>`;
    }
  }
  field.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${out}</svg>`;
}

function startIdentity() {
  if (window.KenomaIdentity && window.KenomaIdentity.onChange) {
    window.KenomaIdentity.onChange(() => refresh());
  }
  refresh();
}

function init() {
  dom.statusText = document.querySelector("#status-text");
  dom.statusDot = document.querySelector("#status-dot");
  dom.clock = document.querySelector("#clock");
  dom.viewOut = document.querySelector("#view-out");
  dom.viewIn = document.querySelector("#view-in");
  dom.signinBtn = document.querySelector("#signin-btn");
  dom.signoutBtn = document.querySelector("#signout-btn");
  dom.outHint = document.querySelector("#out-hint");
  dom.avatar = document.querySelector("#avatar");
  dom.displayName = document.querySelector("#display-name");
  dom.email = document.querySelector("#email");
  dom.did = document.querySelector("#did");
  dom.kind = document.querySelector("#kind");
  dom.issuer = document.querySelector("#issuer");
  dom.expiry = document.querySelector("#expiry");
  dom.capList = document.querySelector("#cap-list");
  dom.verifyChip = document.querySelector("#verify-chip");
  dom.verifyText = document.querySelector("#verify-text");

  buildField();
  updateClock();
  setInterval(updateClock, 15000);

  dom.signinBtn.addEventListener("click", onSignIn);
  dom.signoutBtn.addEventListener("click", onSignOut);

  // The actor usually injects before page scripts run; if not, wait for ready.
  if (window.KenomaIdentity) {
    startIdentity();
  } else {
    setStatus("pending", "connecting…");
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
