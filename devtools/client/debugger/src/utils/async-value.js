/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox pending workflow.
 */
export function pending() {
  return { state: "pending" };
}
/**
 * Handles the firefox fulfilled workflow.
 */
export function fulfilled(value) {
  return { state: "fulfilled", value };
}
/**
 * Handles the firefox rejected workflow.
 */
export function rejected(value) {
  return { state: "rejected", value };
}

/**
 * Handles the firefox as Settled workflow.
 */
export function asSettled(value) {
  return value && value.state !== "pending" ? value : null;
}

/**
 * Returns whether is Pending is true.
 */
export function isPending(value) {
  return value.state === "pending";
}
/**
 * Returns whether is Fulfilled is true.
 */
export function isFulfilled(value) {
  return value.state === "fulfilled";
}
/**
 * Returns whether is Rejected is true.
 */
export function isRejected(value) {
  return value.state === "rejected";
}
