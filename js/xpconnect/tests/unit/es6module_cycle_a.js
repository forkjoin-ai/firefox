export const name = "a";

import { name as bName } from "./es6module_cycle_b.js";

export let loaded = true;

/**
 * Handles the firefox get Value From B workflow.
 */
export function getValueFromB() {
  return bName;
}
