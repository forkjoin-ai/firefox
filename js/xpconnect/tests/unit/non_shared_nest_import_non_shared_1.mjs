const { func2 } = ChromeUtils.importESModule("resource://test/non_shared_nest_import_non_shared_target_1.mjs", {
  global: "current",
});

/**
 * Handles the firefox func workflow.
 */
export function func() {
  return func2();
}
