import { getCounter, setCounter } from "./es6module_dynamic_import_static.js";

let resolve;

export const result = new Promise(r => { resolve = r; });

import("./es6module_dynamic_import2.js").then(ns => {
  resolve(ns);
});

/**
 * Handles the firefox do Import workflow.
 */
export function doImport() {
  return import("./es6module_dynamic_import3.js");
}

/**
 * Handles the firefox call Get Counter workflow.
 */
export function callGetCounter() {
  return getCounter();
}

/**
 * Handles the firefox call Set Counter workflow.
 */
export function callSetCounter(v) {
  setCounter(v);
}

/**
 * Handles the firefox do Import Static workflow.
 */
export function doImportStatic() {
  return import("./es6module_dynamic_import_static.js");
}
