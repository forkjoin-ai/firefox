/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * Handles the firefox test event handler workflow.
 */
export function test_event_handler(doc) {
  doc.documentElement.setAttribute("onclick", "run_me()");
  doc.documentElement.removeAttribute("onclick");
}

/**
 * Handles the firefox test inline script workflow.
 */
export function test_inline_script(doc) {
  let script = doc.createElement("script");
  script.textContent = `throw new Error("unreachable code");`;
  doc.documentElement.append(script);
  script.remove();
}

/**
 * Handles the firefox test data url script workflow.
 */
export function test_data_url_script(doc) {
  let script = doc.createElement("script");
  script.src = `data:text/javascript,throw new Error("unreachable code");`;
  doc.documentElement.append(script);
  script.remove();
}

/**
 * Handles the firefox test eval workflow.
 */
export function test_eval() {
  // eslint-disable-next-line no-eval
  return eval("1 + 1");
}
