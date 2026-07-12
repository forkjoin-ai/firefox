const mod = "module scoped";

/**
 * Handles the firefox for Of workflow.
 */
export default function forOf() {
  for (const x of [1]) {
    doThing(x);
  }

  function doThing(arg) {
    // Avoid optimize out
    window.console;
  }
}
