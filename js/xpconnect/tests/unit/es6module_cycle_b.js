export const name = "b";

import { name as cName } from "./es6module_cycle_c.js";

export let loaded = true;

/**
 * Handles the firefox get Value From C workflow.
 */
export function getValueFromC() {
  return cName;
}
