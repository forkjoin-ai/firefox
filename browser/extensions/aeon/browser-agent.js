/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

const KENOMA_AGENT = { running: false, stop: false, maxSteps: 12 };

function kenomaAgentEmit(event) {
  try {
    globalThis.browser.runtime.sendMessage({ type: "kenoma.agent.event", event });
  } catch (_) {
    // No receiver (the operator console may be closed); the loop continues.
  }
}

function kenomaAgentBadge(on) {
  try {
    const action = globalThis.browser.browserAction;
    action.setBadgeText({ text: on ? "AI" : "" });
    if (on) {
      action.setBadgeBackgroundColor({ color: "#f5b942" });
    }
  } catch (_) {
    // browserAction may be unavailable in some contexts; non-fatal.
  }
}

function kenomaAgentWaitForLoad(tabId, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const onCompleted = details => {
      if (details.tabId === tabId && details.frameId === 0) {
        finish();
      }
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        globalThis.browser.webNavigation.onCompleted.removeListener(onCompleted);
      } catch (_) {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      globalThis.browser.webNavigation.onCompleted.addListener(onCompleted);
    } catch (_) {
      finish();
    }
  });
}

async function kenomaAgentObserve(tabId) {
  const tabs = await handleBrowserRequest({ type: "browser.tab.list" });
  let active = null;
  try {
    active = await handleBrowserRequest({ type: "browser.tab.read", payload: tabId ? { tabId } : {} });
  } catch (_) {
    active = null;
  }
  return { tabs, active };
}

async function kenomaAgentRunTask(task) {
  if (KENOMA_AGENT.running) {
    throw new Error("an agent task is already running");
  }
  const gate = await browserGate();
  if (!gate.enabled) {
    throw new Error("kenoma browser control is disabled");
  }
  KENOMA_AGENT.running = true;
  KENOMA_AGENT.stop = false;
  kenomaAgentBadge(true);
  kenomaAgentEmit({ kind: "start", task });

  let answer = null;
  let currentTabId = null;
  try {
    for (let step = 0; step < KENOMA_AGENT.maxSteps; step++) {
      if (KENOMA_AGENT.stop) {
        kenomaAgentEmit({ kind: "stopped", step });
        break;
      }
      const observation = await kenomaAgentObserve(currentTabId);
      kenomaAgentEmit({
        kind: "observe",
        step,
        tabs: observation.tabs.length,
        url: observation.active && observation.active.url,
      });

      const res = await sendBridgeRequest({
        type: "agent.browserStep",
        payload: { task, observation, timeoutMs: 90000 },
      });
      const action = res && res.action ? res.action : { action: "done", answer: "(no action)" };
      kenomaAgentEmit({ kind: "decide", step, action });

      const verb = action.action;
      if (verb === "done") {
        answer = typeof action.answer === "string" ? action.answer : null;
        break;
      }
      if (verb === "open") {
        const tab = await handleBrowserRequest({ type: "browser.tab.open", payload: { url: action.url, active: true } });
        currentTabId = tab.id;
        await kenomaAgentWaitForLoad(currentTabId, 20000);
      } else if (verb === "navigate") {
        const tab = await handleBrowserRequest({ type: "browser.tab.navigate", payload: { tabId: currentTabId, url: action.url } });
        currentTabId = tab.id;
        await kenomaAgentWaitForLoad(currentTabId, 20000);
      } else if (verb === "click") {
        await handleBrowserRequest({ type: "browser.tab.click", payload: { tabId: currentTabId, selector: action.selector } });
        await kenomaAgentWaitForLoad(currentTabId, 8000);
      } else if (verb === "type") {
        await handleBrowserRequest({ type: "browser.tab.type", payload: { tabId: currentTabId, selector: action.selector, text: action.text } });
      }
      kenomaAgentEmit({ kind: "act", step, action: verb });
    }
  } catch (error) {
    kenomaAgentEmit({ kind: "error", error: error && error.message ? error.message : String(error) });
  } finally {
    KENOMA_AGENT.running = false;
    kenomaAgentBadge(false);
    kenomaAgentEmit({ kind: "done", answer });
  }
  return { answer };
}

globalThis.browser.runtime.onMessage.addListener(message => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }
  if (message.type === "kenoma.agent.run" && typeof message.task === "string") {
    return kenomaAgentRunTask(message.task);
  }
  if (message.type === "kenoma.agent.stop") {
    KENOMA_AGENT.stop = true;
    return Promise.resolve({ stopping: true });
  }
  return undefined;
});
