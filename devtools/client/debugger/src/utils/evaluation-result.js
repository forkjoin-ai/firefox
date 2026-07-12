/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

function isFront(result) {
  return !!result && typeof result === "object" && !!result.getGrip;
}

/**
 * Handles the firefox get Grip workflow.
 */
export function getGrip(result) {
  if (isFront(result)) {
    return result.getGrip();
  }

  return result;
}

/**
 * Handles the firefox get Front workflow.
 */
export function getFront(result) {
  return isFront(result) ? result : null;
}
