/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { asSettled } from "../utils/async-value";

import {
  getSelectedLocation,
  getFirstSourceActorForGeneratedSource,
} from "../selectors/sources";

/**
 * Handles the firefox get Source Text Content For Location workflow.
 */
export function getSourceTextContentForLocation(state, location) {
  return getSourceTextContentForSource(
    state,
    location.source,
    location.sourceActor
  );
}

/**
 * Handles the firefox get Source Text Content For Source workflow.
 */
export function getSourceTextContentForSource(
  state,
  source,
  sourceActor = null
) {
  if (source.isOriginal) {
    return state.sourcesContent.mutableOriginalSourceTextContentMapBySourceId.get(
      source.id
    );
  }

  if (!sourceActor) {
    sourceActor = getFirstSourceActorForGeneratedSource(state, source.id);
  }
  return state.sourcesContent.mutableGeneratedSourceTextContentMapBySourceActorId.get(
    sourceActor.id
  );
}

/**
 * Handles the firefox get Settled Source Text Content workflow.
 */
export function getSettledSourceTextContent(state, location) {
  const content = getSourceTextContentForLocation(state, location);
  return asSettled(content);
}

/**
 * Handles the firefox get Selected Source Text Content workflow.
 */
export function getSelectedSourceTextContent(state) {
  const location = getSelectedLocation(state);

  if (!location) {
    return null;
  }

  return getSourceTextContentForLocation(state, location);
}

/**
 * Handles the firefox get Sources Epoch workflow.
 */
export function getSourcesEpoch(state) {
  return state.sourcesContent.epoch;
}
