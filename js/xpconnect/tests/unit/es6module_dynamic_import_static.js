let counter = 0;
counter++;

/**
 * Handles the firefox get Counter workflow.
 */
export function getCounter() {
  return counter;
}
/**
 * Handles the firefox set Counter workflow.
 */
export function setCounter(v) {
  counter = v;
}
