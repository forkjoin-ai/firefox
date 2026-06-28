/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Privileged side of the Kenoma browser agent. Driven by the about:kenoma page
// through the child actor, it runs a perceive -> decide -> act loop: observe the
// active tab (its content actor) and the tab list, ask the sovereign moonshine
// `browser-step` subprocess (local Qwen, no paid AI) for one action, then drive
// the tab via gBrowser and the content actor. Progress streams back as events.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const MAX_STEPS = 12;
const ACTIONS = new Set(["open", "navigate", "click", "type", "read", "done"]);
const SETTLE_NAV_MS = 2200;
const SETTLE_CLICK_MS = 1200;

// Resolution order for the moonshine binary: a pref override, then the
// monorepo release/debug build outputs.
const MOONSHINE_CANDIDATES = [
  "/Users/buley/Documents/Code/monorepo/open-source/gnosis/moonshine/target/release/moonshine",
  "/Users/buley/Documents/Code/monorepo/open-source/gnosis/moonshine/target/debug/moonshine",
];

// Sovereign status sources. Every request goes through this privileged actor
// (system principal) so the operator page never makes a cross-origin fetch.
// Storms + fact reads are public; memory + todo are UCAN-gated, so we mint a
// guest-or-user read grant via each app's /auth/ucan/global and cache it.
const STATUS_BASE = {
  weather: "https://storms.watch",
  memory: "https://memory-api.forkjoin.ai",
  todos: "https://todo.forkjoin.ai",
  facts: "https://fact.forkjoin.ai",
};
const EDGEWORK_BASE = "https://www-edgework-app.edgework.ai";
// Shared identity badge, written by KenomaIdentityParent into global prefs.
const IDENTITY_PREF_TOKEN = "kenoma.identity.badgeToken";
const STATUS_TIMEOUT_MS = 8000;

export class KenomaAgentParent extends JSWindowActorParent {
  async receiveMessage(message) {
    switch (message.name) {
      case "KenomaAgent:Run":
        return this.runTask(
          String((message.data && message.data.task) || ""),
          message.data && message.data.forks
        );
      case "KenomaAgent:Stop":
        this._stop = true;
        return true;
      case "KenomaAgent:GetVersion":
        return {
          appVersion: Services.appinfo.version,
          appBuildID: Services.appinfo.appBuildID,
        };
      case "KenomaAgent:Status":
        return this.statusSummary();
      case "KenomaAgent:Wallet":
        return this.walletSummary();
      case "KenomaAgent:Topup":
        return this.topup(message.data && message.data.cents);
    }
    return null;
  }

  // ── sovereign status + wallet (privileged fetch, UCAN-grant aware) ──────────

  readBadgeToken() {
    try {
      return Services.prefs.getStringPref(IDENTITY_PREF_TOKEN, "") || "";
    } catch (e) {
      return "";
    }
  }

  async fetchJson(url, options, timeoutMs = STATUS_TIMEOUT_MS) {
    const controller = new AbortController();
    const win = this.chromeWindow();
    const timer = (win || globalThis).setTimeout(
      () => controller.abort(),
      timeoutMs
    );
    try {
      const res = await fetch(url, {
        ...(options || {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`http ${res.status}`);
      }
      return await res.json();
    } finally {
      (win || globalThis).clearTimeout(timer);
    }
  }

  // Mint (or reuse) a guest-or-user read UCAN for a UCAN-gated app's `global`
  // space. The grant is bound to the current badge, so signing in re-scopes it.
  async getGrant(kind) {
    const base = STATUS_BASE[kind];
    const now = Date.now();
    this._grants = this._grants || {};
    const badge = this.readBadgeToken();
    const cached = this._grants[kind];
    if (cached && cached.badge === badge && cached.expiresAt - now > 30000) {
      return cached.token;
    }
    const headers = { "content-type": "application/json" };
    if (badge) {
      headers.authorization = `Bearer ${badge}`;
    }
    const data = await this.fetchJson(`${base}/auth/ucan/global`, {
      method: "POST",
      headers,
      body: JSON.stringify({ permissions: "read" }),
    });
    const token = data && (data.sessionToken || data.ucanToken);
    if (!token) {
      throw new Error("no grant token");
    }
    this._grants[kind] = {
      token,
      badge,
      expiresAt:
        typeof data.expiresAt === "number" ? data.expiresAt : now + 3600000,
    };
    return token;
  }

  async statusSummary() {
    const out = {
      weather: { ok: false, label: "offline", count: null },
      memory: { ok: false, label: "offline", count: null },
      todos: { ok: false, label: "offline", count: null },
      facts: { ok: false, label: "offline", count: null },
    };
    await Promise.allSettled([
      (async () => {
        const data = await this.fetchJson(
          `${STATUS_BASE.weather}/api/live/current-storms`
        );
        const n = Number(data && data.activeCount) || 0;
        out.weather = {
          ok: true,
          count: n,
          label: n > 0 ? `${n} active` : "Quiet skies",
        };
      })(),
      (async () => {
        const token = await this.getGrant("memory");
        const data = await this.fetchJson(
          `${STATUS_BASE.memory}/api/spaces/global/api/memory/pool`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        const n =
          typeof data.count === "number"
            ? data.count
            : Array.isArray(data.entries)
              ? data.entries.length
              : 0;
        out.memory = { ok: true, count: n, label: `${n} memories` };
      })(),
      (async () => {
        const token = await this.getGrant("todos");
        const data = await this.fetchJson(
          `${STATUS_BASE.todos}/api/spaces/global/api/sync/pull`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        const n = Array.isArray(data.operations) ? data.operations.length : 0;
        out.todos = { ok: true, count: n, label: `${n} ops` };
      })(),
      (async () => {
        const data = await this.fetchJson(
          `${STATUS_BASE.facts}/api/spaces/global/api/sync/pull`
        );
        const n = Array.isArray(data.nodes)
          ? data.nodes.length
          : Array.isArray(data.operations)
            ? data.operations.length
            : 0;
        out.facts = { ok: true, count: n, label: `${n} facts` };
      })(),
    ]);
    return out;
  }

  async walletSummary() {
    const badge = this.readBadgeToken();
    if (!badge) {
      return { signedIn: false };
    }
    try {
      const data = await this.fetchJson(`${EDGEWORK_BASE}/api/edgework/wallet`, {
        headers: { authorization: `Bearer ${badge}` },
      });
      return {
        signedIn: true,
        address: data.address || null,
        balanceWei: data.balanceWei || "0",
      };
    } catch (e) {
      return { signedIn: true, error: (e && e.message) || String(e) };
    }
  }

  async topup(cents) {
    const badge = this.readBadgeToken();
    if (!badge) {
      return { ok: false, error: "not signed in" };
    }
    const amount = Math.max(100, Math.trunc(Number(cents) || 500));
    try {
      const data = await this.fetchJson(`${EDGEWORK_BASE}/api/edgework/topup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${badge}`,
        },
        body: JSON.stringify({ cents: amount }),
      });
      return { ok: true, url: data.url || null };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  emit(event) {
    try {
      this.sendAsyncMessage("KenomaAgent:Event", event);
    } catch (e) {
      // The operator page may be gone; the loop continues.
    }
  }

  chromeWindow() {
    return Services.wm.getMostRecentWindow("navigator:browser");
  }

  pause(ms) {
    return new Promise(resolve => {
      const win = this.chromeWindow();
      (win || globalThis).setTimeout(resolve, ms);
    });
  }

  async runTask(task, forks) {
    if (this._running) {
      return { ok: false, error: "already running" };
    }
    this._running = true;
    this._stop = false;
    this._forks = Math.max(1, Math.min(5, Math.trunc(Number(forks) || 1)));
    this.emit({ kind: "start", task, forks: this._forks });

    let answer = null;
    let targetBrowser = null;
    try {
      const win = this.chromeWindow();
      if (!win || !win.gBrowser) {
        throw new Error("no browser window");
      }
      const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();

      for (let step = 0; step < MAX_STEPS; step++) {
        if (this._stop) {
          this.emit({ kind: "stopped", step });
          break;
        }
        const browser = targetBrowser || win.gBrowser.selectedBrowser;
        const observation = await this.observe(win, browser);
        this.emit({
          kind: "observe",
          step,
          tabs: observation.tabs.length,
          url: observation.active && observation.active.url,
        });

        const action = await this.decide(
          task,
          observation,
          this._forks,
          step
        );
        this.emit({ kind: "decide", step, action });

        const verb = action.action;
        if (verb === "done") {
          answer = action.answer != null ? action.answer : null;
          break;
        }

        // Stuck-loop guard: a weak model can repeat the same action (e.g. keep
        // navigating to the page it is already on). After it repeats, stop and
        // answer from what the active page already shows.
        const key = `${verb}|${action.url || ""}|${action.selector || ""}`;
        if (key === this._lastActionKey) {
          this._repeatCount = (this._repeatCount || 0) + 1;
        } else {
          this._repeatCount = 0;
          this._lastActionKey = key;
        }
        if (this._repeatCount >= 2 && observation.active) {
          answer =
            observation.active.title ||
            (observation.active.text || "").slice(0, 200) ||
            null;
          this.emit({ kind: "act", step, action: "settled" });
          break;
        }
        if (verb === "open") {
          // Open in the BACKGROUND: selecting the tab would background
          // about:kenoma and destroy the actor driving this loop. The content
          // actor still drives a background tab.
          const tab = win.gBrowser.addTab(String(action.url || "about:blank"), {
            triggeringPrincipal: systemPrincipal,
          });
          targetBrowser = tab.linkedBrowser;
          await this.pause(SETTLE_NAV_MS);
        } else if (verb === "navigate") {
          if (!targetBrowser) {
            // No target yet: open a background tab rather than navigating the
            // operator page (which would destroy this loop's actor).
            const tab = win.gBrowser.addTab(String(action.url || "about:blank"), {
              triggeringPrincipal: systemPrincipal,
            });
            targetBrowser = tab.linkedBrowser;
          } else {
            targetBrowser.fixupAndLoadURIString(String(action.url || ""), {
              triggeringPrincipal: systemPrincipal,
            });
          }
          await this.pause(SETTLE_NAV_MS);
        } else if (verb === "click") {
          targetBrowser = browser;
          await this.contentQuery(targetBrowser, "KenomaAgent:Click", {
            selector: String(action.selector || ""),
          });
          await this.pause(SETTLE_CLICK_MS);
        } else if (verb === "type") {
          targetBrowser = browser;
          await this.contentQuery(targetBrowser, "KenomaAgent:Type", {
            selector: String(action.selector || ""),
            text: String(action.text || ""),
          });
        }
        this.emit({ kind: "act", step, action: verb });
      }
    } catch (e) {
      this.emit({ kind: "error", error: (e && e.message) || String(e) });
    } finally {
      this._running = false;
      this.emit({ kind: "done", answer });
    }
    return { ok: true, answer };
  }

  async observe(win, browser) {
    const tabs = Array.from(win.gBrowser.tabs).map((tab, index) => ({
      index,
      url: tab.linkedBrowser && tab.linkedBrowser.currentURI
        ? tab.linkedBrowser.currentURI.spec
        : null,
      title: tab.label,
      active: tab.selected,
    }));
    let active = null;
    try {
      active = await this.contentQuery(browser, "KenomaAgent:ReadContent", {});
    } catch (e) {
      active = null;
    }
    return { tabs, active };
  }

  contentQuery(browser, name, data) {
    const bc = browser && browser.browsingContext;
    const wg = bc && bc.currentWindowGlobal;
    if (!wg) {
      throw new Error("no window global for tab");
    }
    return wg.getActor("KenomaAgent").sendQuery(name, data);
  }

  // FORK xN: spawn N moonshine deciders in parallel for one step, fold their
  // proposals by majority action (then first-valid). forks<=1 keeps the single
  // decideOnce path unchanged.
  async decide(task, observation, forks, step) {
    const n = Math.max(1, Math.min(5, Math.trunc(Number(forks) || 1)));
    if (n <= 1) {
      return this.decideOnce(task, observation);
    }
    const proposals = await Promise.all(
      Array.from({ length: n }, () => this.decideOnce(task, observation))
    );
    proposals.forEach((action, i) => {
      this.emit({ kind: "fork", step, fork: i, action });
    });
    return this.foldActions(proposals);
  }

  foldActions(proposals) {
    const valid = proposals.filter(
      a => a && typeof a.action === "string" && ACTIONS.has(a.action)
    );
    if (!valid.length) {
      return { action: "done", answer: "(no action parsed)" };
    }
    const counts = new Map();
    for (const a of valid) {
      counts.set(a.action, (counts.get(a.action) || 0) + 1);
    }
    let best = valid[0].action;
    let bestN = 0;
    for (const [verb, c] of counts) {
      if (c > bestN) {
        bestN = c;
        best = verb;
      }
    }
    return valid.find(a => a.action === best) || valid[0];
  }

  async decideOnce(task, observation) {
    const binary = await this.resolveMoonshine();
    if (!binary) {
      return { action: "done", answer: "(moonshine binary not found)" };
    }
    try {
      const proc = await lazy.Subprocess.call({
        command: binary,
        arguments: ["-c", `browser-step ${task}`],
        environment: { MOONSHINE_BROWSER_OBSERVATION: JSON.stringify(observation) },
        environmentAppend: true,
        // Merge stderr into stdout: one pipe to drain (no separate-stderr
        // deadlock, no null pipe), and parseAction ignores the trace lines.
        stderr: "stdout",
      });
      const stdout = await this.readAll(proc.stdout);
      await proc.wait();
      return this.parseAction(stdout);
    } catch (e) {
      return { action: "done", answer: "(inference unavailable)" };
    }
  }

  async readAll(pipe) {
    let out = "";
    let chunk;
    while ((chunk = await pipe.readString())) {
      out += chunk;
    }
    return out;
  }

  parseAction(stdout) {
    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("{")) {
        continue;
      }
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && typeof obj.action === "string" && ACTIONS.has(obj.action)) {
          return obj;
        }
      } catch (e) {
        // Mesh logs share stdout; keep scanning upward for the action line.
      }
    }
    return { action: "done", answer: "(no action parsed)" };
  }

  async resolveMoonshine() {
    const pref = Services.prefs.getStringPref("forkjoin.gnosis.moonshine.binary", "");
    const candidates = pref ? [pref, ...MOONSHINE_CANDIDATES] : MOONSHINE_CANDIDATES;
    for (const candidate of candidates) {
      try {
        if (await IOUtils.exists(candidate)) {
          return candidate;
        }
      } catch (e) {
        // Try the next candidate.
      }
    }
    return null;
  }
}
