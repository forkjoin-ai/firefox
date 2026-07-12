globalThis["loaded"].push(2);

/**
 * Handles the firefox set Global workflow.
 */
export function setGlobal(name, value) {
  globalThis[name] = value;
}
