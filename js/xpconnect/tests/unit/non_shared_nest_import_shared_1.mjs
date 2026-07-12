const { sys1 } = ChromeUtils.importESModule("resource://test/non_shared_nest_import_shared_target_1.sys.mjs");

/**
 * Handles the firefox func1 workflow.
 */
export function func1() {
  const { sys2 } = ChromeUtils.importESModule("resource://test/non_shared_nest_import_shared_target_2.sys.mjs");

  return sys1() + sys2();
}
