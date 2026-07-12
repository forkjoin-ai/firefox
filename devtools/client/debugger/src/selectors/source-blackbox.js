/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox get Black Box Ranges workflow.
 */
export function getBlackBoxRanges(state) {
  return state.sourceBlackBox.blackboxedRanges;
}

/**
 * Returns whether is Source Black Boxed is true.
 */
export function isSourceBlackBoxed(state, source) {
  // Only sources with a URL can be blackboxed.
  if (!source.url) {
    return false;
  }
  return state.sourceBlackBox.blackboxedSet.has(source.url);
}

/**
 * Returns whether is Source On Source Map Ignore List is true.
 */
export function isSourceOnSourceMapIgnoreList(state, source) {
  if (!source) {
    return false;
  }
  return getIgnoreListSourceUrls(state).includes(source.url);
}

/**
 * Handles the firefox get Ignore List Source Urls workflow.
 */
export function getIgnoreListSourceUrls(state) {
  return state.sourceBlackBox.sourceMapIgnoreListUrls;
}
