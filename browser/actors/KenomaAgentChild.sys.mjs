/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Content side of the Kenoma browser agent. On about:kenoma it injects a frozen
// window.KenomaAgent { run(task), stop(), onEvent(cb) } and relays the parent's
// progress events to the page. On any other page it answers the parent's
// read/click/type queries so the agent can see and drive that tab. The privileged
// loop (decisions via the moonshine subprocess, tab control) lives in the parent.

const OPERATOR_PAGE = "about:kenoma";

export class KenomaAgentChild extends JSWindowActorChild {
  actorCreated() {
    if (this.isOperatorPage()) {
      this.injectAPI();
    }
  }

  // Event-gated actors are instantiated by the event and dispatched through
  // handleEvent; without it the instantiation aborts before actorCreated, so
  // inject here too (idempotent).
  handleEvent(event) {
    if (event.type === "DOMDocElementInserted" && this.isOperatorPage()) {
      this.injectAPI();
    }
  }

  isOperatorPage() {
    try {
      const href = (this.contentWindow && this.contentWindow.location && this.contentWindow.location.href) || (this.document && this.document.documentURI) || "";
      return href.startsWith(OPERATOR_PAGE);
    } catch (e) {
      return false;
    }
  }

  injectAPI() {
    const window = this.contentWindow;
    if (!window || this._injected) {
      return;
    }
    this._injected = true;
    const api = Cu.createObjectIn(window, { defineAs: "KenomaAgent" });
    Cu.exportFunction(this.run.bind(this), api, { defineAs: "run" });
    Cu.exportFunction(this.stop.bind(this), api, { defineAs: "stop" });
    Cu.exportFunction(this.onEvent.bind(this), api, { defineAs: "onEvent" });
    try {
      Object.freeze(api);
    } catch (e) {
      // Methods remain non-writable function slots.
    }
    try {
      window.dispatchEvent(new window.Event("KenomaAgent:ready"));
    } catch (e) {
      // Window may be tearing down.
    }
  }

  wrapPromise(promise) {
    return new this.contentWindow.Promise((resolve, reject) =>
      promise.then(resolve, reject)
    );
  }

  run(task) {
    return this.wrapPromise(
      (async () =>
        Cu.cloneInto(
          await this.sendQuery("KenomaAgent:Run", { task: String(task || "") }),
          this.contentWindow
        ))()
    );
  }

  stop() {
    return this.wrapPromise(
      (async () => {
        await this.sendQuery("KenomaAgent:Stop");
      })()
    );
  }

  onEvent(callback) {
    const window = this.contentWindow;
    const handler = ev => {
      try {
        callback(ev.detail);
      } catch (e) {
        // Swallow content callback errors.
      }
    };
    window.addEventListener("KenomaAgent:event", handler);
    return Cu.exportFunction(
      () => window.removeEventListener("KenomaAgent:event", handler),
      window
    );
  }

  // ── content observation + interaction (runs in the driven tab) ─────────────

  readContent() {
    const doc = this.document;
    if (!doc) {
      return { title: "", url: "", text: "", links: [], buttons: [], fields: [] };
    }
    const txt = el =>
      (
        (el.innerText ||
          el.value ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("title") ||
          "") + ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    let n = 0;
    const tag = el => {
      const existing = el.getAttribute("data-kenoma-id");
      if (existing) {
        return `[data-kenoma-id="${existing}"]`;
      }
      const id = "k" + n++;
      el.setAttribute("data-kenoma-id", id);
      return `[data-kenoma-id="${id}"]`;
    };
    const MAX = 12;
    const links = [];
    const buttons = [];
    const fields = [];
    for (const el of doc.querySelectorAll("a[href]")) {
      if (links.length >= MAX) {
        break;
      }
      const t = txt(el);
      if (!t) {
        continue;
      }
      links.push({ text: t, href: el.href, selector: tag(el) });
    }
    for (const el of doc.querySelectorAll(
      "button,[role=button],input[type=submit],input[type=button]"
    )) {
      if (buttons.length >= MAX) {
        break;
      }
      buttons.push({ text: txt(el), selector: tag(el) });
    }
    for (const el of doc.querySelectorAll(
      "input:not([type=hidden]),textarea,select"
    )) {
      if (fields.length >= MAX) {
        break;
      }
      fields.push({ label: txt(el) || el.name || el.type || "", selector: tag(el) });
    }
    return {
      title: doc.title,
      url: (this.contentWindow && this.contentWindow.location.href) || "",
      text: (doc.body ? doc.body.innerText : "").slice(0, 1200),
      links,
      buttons,
      fields,
    };
  }

  clickSelector(selector) {
    const el = this.document && this.document.querySelector(selector);
    if (!el) {
      return { ok: false, error: "no match" };
    }
    try {
      el.scrollIntoView();
    } catch (e) {}
    el.click();
    return { ok: true };
  }

  typeSelector(selector, text) {
    const el = this.document && this.document.querySelector(selector);
    if (!el) {
      return { ok: false, error: "no match" };
    }
    try {
      el.focus();
    } catch (e) {}
    el.value = String(text == null ? "" : text);
    try {
      el.dispatchEvent(new this.contentWindow.Event("input", { bubbles: true }));
      el.dispatchEvent(new this.contentWindow.Event("change", { bubbles: true }));
    } catch (e) {}
    return { ok: true };
  }

  receiveMessage(message) {
    switch (message.name) {
      case "KenomaAgent:Event": {
        const window = this.contentWindow;
        if (window) {
          window.dispatchEvent(
            new window.CustomEvent("KenomaAgent:event", {
              detail: Cu.cloneInto(message.data, window),
            })
          );
        }
        return undefined;
      }
      case "KenomaAgent:ReadContent":
        return this.readContent();
      case "KenomaAgent:Click":
        return this.clickSelector(message.data.selector);
      case "KenomaAgent:Type":
        return this.typeSelector(message.data.selector, message.data.text);
    }
    return undefined;
  }
}
