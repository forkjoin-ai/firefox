/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

const KENOMA_ALLOWED = new Set(["truth.assess", "precog.forecast"]);
const KENOMA_REQ = "__kenoma_req";
const KENOMA_RES = "__kenoma_res";

window.addEventListener("message", event => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || data.channel !== KENOMA_REQ || typeof data.type !== "string") {
    return;
  }
  const rid = data.rid;
  if (!KENOMA_ALLOWED.has(data.type)) {
    window.postMessage(
      { channel: KENOMA_RES, rid, ok: false, error: `unsupported kenoma op: ${data.type}` },
      event.origin
    );
    return;
  }
  browser.runtime.sendMessage({ type: data.type, payload: data.payload }).then(
    result => window.postMessage({ channel: KENOMA_RES, rid, ok: true, result }, event.origin),
    error =>
      window.postMessage(
        {
          channel: KENOMA_RES,
          rid,
          ok: false,
          error: error && error.message ? error.message : String(error),
        },
        event.origin
      )
  );
});

{
  const script = document.createElement("script");
  script.src = browser.runtime.getURL("kenoma-page.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}
