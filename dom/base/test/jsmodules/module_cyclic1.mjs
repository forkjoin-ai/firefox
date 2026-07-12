import { func2 } from "./module_cyclic2.mjs";

/**
 * Handles the firefox func1 workflow.
 */
export function func1(x, y) {
  if (x <= 0) {
    return y;
  }
  return func2(x - 1, y + "1");
}
