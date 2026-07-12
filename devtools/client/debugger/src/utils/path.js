/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox basename workflow.
 */
export function basename(path) {
  return path.split("/").pop();
}

/**
 * Handles the firefox dirname workflow.
 */
export function dirname(path) {
  const idx = path.lastIndexOf("/");
  return path.slice(0, idx);
}

/**
 * Returns whether is URL is true.
 */
export function isURL(str) {
  return str.includes("://");
}

/**
 * Returns whether is Absolute is true.
 */
export function isAbsolute(str) {
  return str[0] === "/";
}

/**
 * Handles the firefox join workflow.
 */
export function join(base, dir) {
  return `${base}/${dir}`;
}
