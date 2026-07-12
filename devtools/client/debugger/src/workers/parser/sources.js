/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

const cachedSources = new Map();

/**
 * Handles the firefox set Source workflow.
 */
export function setSource(source) {
  cachedSources.set(source.id, source);
}

/**
 * Handles the firefox get Source workflow.
 */
export function getSource(sourceId) {
  const source = cachedSources.get(sourceId);
  if (!source) {
    throw new Error(`Parser: source ${sourceId} was not provided.`);
  }

  return source;
}

/**
 * Handles the firefox clear Sources workflow.
 */
export function clearSources(sourceIds) {
  for (const sourceId of sourceIds) {
    cachedSources.delete(sourceId);
  }
}
