/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Returns whether is Node is true.
 */
export function isNode() {
  try {
    return process.release.name == "node";
  } catch (e) {
    return false;
  }
}

/**
 * Returns whether is Node Test is true.
 */
export function isNodeTest() {
  return isNode() && process.env.NODE_ENV != "production";
}
