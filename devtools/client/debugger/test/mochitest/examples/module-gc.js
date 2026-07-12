import stuff from "./module-gc2.js";

var x = 10;

/**
 * Handles the firefox module Function workflow.
 */
export function moduleFunction() {
  stuff(x);
}

// GC the module scripts so the Debugger has to reparse (see bug 1605686)
setTimeout(() => SpecialPowers.gc(), 0);
