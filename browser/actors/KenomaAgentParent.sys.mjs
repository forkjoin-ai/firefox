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

export class KenomaAgentParent extends JSWindowActorParent {
  async receiveMessage(message) {
    switch (message.name) {
      case "KenomaAgent:Run":
        return this.runTask(String((message.data && message.data.task) || ""));
      case "KenomaAgent:Stop":
        this._stop = true;
        return true;
    }
    return null;
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

  async runTask(task) {
    if (this._running) {
      return { ok: false, error: "already running" };
    }
    this._running = true;
    this._stop = false;
    this.emit({ kind: "start", task });

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

        const action = await this.decide(task, observation);
        this.emit({ kind: "decide", step, action });

        const verb = action.action;
        if (verb === "done") {
          answer = action.answer != null ? action.answer : null;
          break;
        }
        if (verb === "open") {
          const tab = win.gBrowser.addTab(String(action.url || "about:blank"), {
            triggeringPrincipal: systemPrincipal,
          });
          win.gBrowser.selectedTab = tab;
          targetBrowser = tab.linkedBrowser;
          await this.pause(SETTLE_NAV_MS);
        } else if (verb === "navigate") {
          targetBrowser = browser;
          targetBrowser.fixupAndLoadURIString(String(action.url || ""), {
            triggeringPrincipal: systemPrincipal,
          });
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

  async decide(task, observation) {
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
