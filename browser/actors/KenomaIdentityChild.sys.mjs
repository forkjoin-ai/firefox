/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Content-facing side of the Kenoma shared-identity (SSO) bridge.
//
// Injects a frozen `window.KenomaIdentity` object into every Kenoma about: page
// (about:id, about:kenoma, about:todo, ...). The badge lives in global prefs on
// the parent side, so it is shared across every about: content origin and is
// immune to storage partitioning. See KenomaIdentityParent.sys.mjs.
//
// PINNED content-facing contract (fanout pages code against this verbatim):
//   window.KenomaIdentity.getBadge() -> Promise<{token,did,profile}|null>
//   window.KenomaIdentity.signIn()   -> Promise<{token,did,profile}|null>
//   window.KenomaIdentity.signOut()  -> Promise<void>
//   window.KenomaIdentity.onChange(cb) -> unsubscribe()   // cb(identity|null)
//   `KenomaIdentity:ready` window event when the API is injected.
//   `KenomaIdentity:change` window event (detail: identity|null) on any change.
//
//   token   = fractal-iam BADGE JWT (ES256, verifiable vs card.yoga issuer-key)
//   did     = the badge subject DID (rootDid)
//   profile = the decoded badge claims {participantKind, capabilities, issuer,
//             exp, ...} plus an `identity` field {name,email,picture,...}.
//
// The whole card.yoga sign-in flow runs here so any about: page gets signIn()
// without re-implementing it. Network calls use the module's privileged fetch
// (system principal, not subject to CORS); the interactive OAuth popup is opened
// through the content window so it carries the user gesture.

const IAM_BASE = "https://card.yoga";
const APP_ID = "kenoma";
// returnOrigin must satisfy fractal-iam's allow-list (any https: origin). We use
// popup + status polling, so the completion postMessage target is unused.
const RETURN_ORIGIN = IAM_BASE;
const BADGE_TTL_SECONDS = 60 * 60 * 24 * 30;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export class KenomaIdentityChild extends JSWindowActorChild {
  actorCreated() {
    this.injectAPI();
  }

  // Event-gated actors are dispatched through handleEvent; without it the
  // DOMDocElementInserted instantiation aborts before actorCreated, so the API
  // never gets injected.
  handleEvent(event) {
    if (event.type === "DOMDocElementInserted") {
      this.injectAPI();
    }
  }

  injectAPI() {
    const window = this.contentWindow;
    if (!window || this._injected) {
      return;
    }
    this._injected = true;

    const api = Cu.createObjectIn(window, { defineAs: "KenomaIdentity" });
    Cu.exportFunction(this.getBadge.bind(this), api, { defineAs: "getBadge" });
    Cu.exportFunction(this.signIn.bind(this), api, { defineAs: "signIn" });
    Cu.exportFunction(this.signOut.bind(this), api, { defineAs: "signOut" });
    Cu.exportFunction(this.onChange.bind(this), api, { defineAs: "onChange" });

    try {
      Object.freeze(api);
    } catch (e) {
      // Non-fatal; methods are still non-writable function slots.
    }

    try {
      window.dispatchEvent(new window.Event("KenomaIdentity:ready"));
    } catch (e) {
      // Window may be tearing down.
    }
  }

  /** Wrap a chrome promise so content gets a content-realm Promise. */
  wrapPromise(promise) {
    return new this.contentWindow.Promise((resolve, reject) =>
      promise.then(resolve, reject)
    );
  }

  /** Resolve a sendQuery, cloning the result into the content realm. */
  queryForContent(...args) {
    return this.wrapPromise(
      (async () =>
        Cu.cloneInto(await this.sendQuery(...args), this.contentWindow))()
    );
  }

  getBadge() {
    return this.queryForContent("KenomaIdentity:Get");
  }

  signOut() {
    return this.wrapPromise(
      (async () => {
        await this.sendQuery("KenomaIdentity:Clear");
      })()
    );
  }

  signIn() {
    return this.wrapPromise(this.runSignIn());
  }

  onChange(callback) {
    const window = this.contentWindow;
    const handler = ev => {
      try {
        callback(ev.detail);
      } catch (e) {
        // Swallow content callback errors.
      }
    };
    window.addEventListener("KenomaIdentity:change", handler);
    return Cu.exportFunction(
      () => window.removeEventListener("KenomaIdentity:change", handler),
      window
    );
  }

  // ── card.yoga browser-auth + badge-issue flow ──────────────────────────────

  // Read a response as JSON, but on a non-JSON body throw a descriptive error
  // (with status + a snippet) instead of an opaque "JSON.parse" failure, so the
  // operator page can show exactly which step failed and what came back.
  async readJsonOrThrow(res, tag) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      const snippet = (text || "(empty body)")
        .slice(0, 200)
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(
        `${tag} returned non-JSON (HTTP ${res.status}): ${snippet}`
      );
    }
  }

  async runSignIn() {
    const win = this.contentWindow;
    // Open the popup synchronously so it keeps the click's user gesture; we
    // navigate it once we have the sign-in URL.
    let popup = null;
    try {
      popup = win.open("about:blank", "forkjoin-auth", "width=520,height=660");
    } catch (e) {
      popup = null;
    }

    try {
      const startRes = await fetch(`${IAM_BASE}/auth/browser/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          appId: APP_ID,
          mode: "popup",
          returnOrigin: RETURN_ORIGIN,
        }),
      });
      const start = await this.readJsonOrThrow(startRes, "auth/browser/start");
      if (!start.ok || !start.signInUrl || !start.statusUrl) {
        throw new Error(start.error || "start_failed");
      }

      if (popup && !popup.closed) {
        try {
          popup.location.href = start.signInUrl;
        } catch (e) {
          popup = win.open(start.signInUrl, "forkjoin-auth");
        }
      } else {
        popup = win.open(start.signInUrl, "forkjoin-auth");
      }

      const auth = await this.pollStatus(start.statusUrl, popup);
      const badge = await this.issueBadge(auth);

      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch (e) {
          // ignore
        }
      }

      await this.sendQuery("KenomaIdentity:Set", badge);
      return Cu.cloneInto(badge, win);
    } catch (e) {
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch (e2) {
          // ignore
        }
      }
      // Reject with a content-realm Error so content sees a clean message.
      throw new win.Error((e && e.message) || String(e));
    }
  }

  async pollStatus(statusUrl, popup) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const sep = statusUrl.includes("?") ? "&" : "?";
        const res = await fetch(`${statusUrl}${sep}consume=false`, {
          cache: "no-store",
        });
        const data = await this.readJsonOrThrow(res, "auth/browser/status");
        if (data.status === "complete" && data.auth) {
          return data.auth;
        }
        if (data.status === "failed") {
          throw new Error(data.error || "auth_failed");
        }
      } catch (e) {
        if (e && e.message === "auth_failed") {
          throw e;
        }
        lastError = e;
        // transient; keep polling
      }
      if (popup && popup.closed) {
        throw new Error(
          "popup_closed" + (lastError ? ` (last: ${lastError.message})` : "")
        );
      }
      await new Promise(r => this.contentWindow.setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      "timeout" + (lastError ? ` (last: ${lastError.message})` : "")
    );
  }

  async issueBadge(auth) {
    const res = await fetch(`${IAM_BASE}/iam/badge/issue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.bootstrapToken}`,
      },
      body: JSON.stringify({
        audienceDid: auth.rootDid,
        serviceId: APP_ID,
        ttlSeconds: BADGE_TTL_SECONDS,
      }),
    });
    const data = await this.readJsonOrThrow(res, "iam/badge/issue");
    if (!res.ok || !data.ok || !data.token) {
      throw new Error(data.error || `badge_issue_${res.status}`);
    }
    const claims = this.decodeBadge(data.token) || {};
    return {
      token: data.token,
      did: auth.rootDid || claims.sub || "",
      profile: {
        ...claims,
        participantKind: claims.participantKind || claims.kind || "human",
        capabilities: data.capabilities || claims.capabilities || [],
        issuer: claims.iss || "did:web:card.yoga",
        exp: claims.exp,
        identity: auth.identity || {},
      },
    };
  }

  decodeBadge(token) {
    if (typeof token !== "string") {
      return null;
    }
    const m = token.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    if (!m) {
      return null;
    }
    try {
      const part = m[0].split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = part.length % 4 ? "=".repeat(4 - (part.length % 4)) : "";
      return JSON.parse(atob(part + pad));
    } catch (e) {
      return null;
    }
  }

  receiveMessage(message) {
    if (message.name === "KenomaIdentity:Changed") {
      const window = this.contentWindow;
      if (!window) {
        return;
      }
      const event = new window.CustomEvent("KenomaIdentity:change", {
        detail: Cu.cloneInto(message.data, window),
      });
      window.dispatchEvent(event);
    }
  }
}
