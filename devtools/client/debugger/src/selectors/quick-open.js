/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox get Quick Open Enabled workflow.
 */
export function getQuickOpenEnabled(state) {
  return state.quickOpen.enabled;
}

/**
 * Handles the firefox get Quick Open Query workflow.
 */
export function getQuickOpenQuery(state) {
  return state.quickOpen.query;
}

/**
 * Handles the firefox get Quick Open Type workflow.
 */
export function getQuickOpenType(state) {
  return state.quickOpen.searchType;
}
