import { setGlobal } from "./non_shared_2.mjs";

globalThis["loaded"].push(1);

globalThis["counter"] = 0;

let counter = 0;

/**
 * Handles the firefox get Counter workflow.
 */
export function getCounter() {
  return counter;
}

/**
 * Handles the firefox inc Counter workflow.
 */
export function incCounter() {
  counter++;
}

/**
 * Handles the firefox put Counter workflow.
 */
export function putCounter() {
  setGlobal("counter", counter);
}
