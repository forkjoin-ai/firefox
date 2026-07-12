// eslint-disable-next-line import/no-unassigned-import, import/no-unresolved
import {} from "../circular_depdendency.mjs";

/**
 * Handles the firefox exported Function workflow.
 */
export function exportedFunction() {
  throw "Wrong version of function called";
}

throw "Shouldn't laod file bad/module_3.mjs";
