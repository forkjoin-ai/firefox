/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

(() => {
  const REQ = "__kenoma_req";
  const RES = "__kenoma_res";
  const pending = new Map();
  let nextId = 1;

  window.addEventListener("message", event => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.channel !== RES || typeof data.rid !== "number") {
      return;
    }
    const slot = pending.get(data.rid);
    if (!slot) {
      return;
    }
    pending.delete(data.rid);
    if (data.ok) {
      slot.resolve(data.result);
    } else {
      slot.reject(new Error(data.error || "kenoma bridge error"));
    }
  });

  function call(type, payload) {
    const rid = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(rid, { resolve, reject });
      window.postMessage({ channel: REQ, rid, type, payload }, window.location.origin);
    });
  }

  window.kenoma = Object.freeze({
    truth: Object.freeze({ assess: payload => call("truth.assess", payload) }),
    precog: Object.freeze({ forecast: payload => call("precog.forecast", payload) }),
  });
})();
