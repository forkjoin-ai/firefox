export const name = "c";

import { name as aName } from "./es6module_cycle_a.js";

export let loaded = true;

/**
 * Handles the firefox get Value From A workflow.
 */
export function getValueFromA() {
  return aName;
}
