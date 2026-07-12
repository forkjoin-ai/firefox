/**
 * Handles the firefox pm workflow.
 */
export function pm(x) {
  const message = {value: x, checks: pm.checks};
  postMessage(message);
}
