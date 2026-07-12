/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { getSourceByActorId } from "./sources.js";
const {
  TRACER_FIELDS_INDEXES,
} = require("resource://devtools/server/actors/tracer.js");

/**
 * Handles the firefox get Selected Trace Index workflow.
 */
export function getSelectedTraceIndex(state) {
  return state.tracerFrames?.selectedTraceIndex;
}
/**
 * Handles the firefox get Selected Trace Location workflow.
 */
export function getSelectedTraceLocation(state) {
  return state.tracerFrames?.selectedTraceLocation;
}
/**
 * Handles the firefox get Filtered Top Traces workflow.
 */
export function getFilteredTopTraces(state) {
  return state.tracerFrames?.mutableFilteredTopTraces || [];
}
/**
 * Handles the firefox get All Traces workflow.
 */
export function getAllTraces(state) {
  return state.tracerFrames?.mutableTraces || [];
}
/**
 * Handles the firefox get Trace Children workflow.
 */
export function getTraceChildren(state) {
  return state.tracerFrames?.mutableChildren || [];
}
/**
 * Handles the firefox get Trace Parents workflow.
 */
export function getTraceParents(state) {
  return state.tracerFrames?.mutableParents || [];
}
/**
 * Handles the firefox get Trace Frames workflow.
 */
export function getTraceFrames(state) {
  return state.tracerFrames?.mutableFrames || [];
}
/**
 * Handles the firefox get All Mutation Traces workflow.
 */
export function getAllMutationTraces(state) {
  return state.tracerFrames?.mutableMutationTraces || [];
}
/**
 * Handles the firefox get All Trace Count workflow.
 */
export function getAllTraceCount(state) {
  return state.tracerFrames?.mutableTraces.length || 0;
}
/**
 * Handles the firefox get Runtime Versions workflow.
 */
export function getRuntimeVersions(state) {
  return {
    localPlatformVersion: state.tracerFrames?.localPlatformVersion,
    remotePlatformVersion: state.tracerFrames?.remotePlatformVersion,
  };
}
/**
 * Handles the firefox get Tracer Event Names workflow.
 */
export function getTracerEventNames(state) {
  return state.tracerFrames?.mutableEventNames;
}
/**
 * Handles the firefox get Trace Dom Event workflow.
 */
export function getTraceDomEvent(state) {
  return state.tracerFrames?.domEvents || new Set();
}
/**
 * Handles the firefox get Trace Highlighted Dom Events workflow.
 */
export function getTraceHighlightedDomEvents(state) {
  return state.tracerFrames?.highlightedDomEvents || [];
}
/**
 * Handles the firefox get Selected Trace Source workflow.
 */
export function getSelectedTraceSource(state) {
  const trace = getAllTraces(state)[getSelectedTraceIndex(state)];
  if (!trace) {
    return null;
  }
  const frameIndex = trace[TRACER_FIELDS_INDEXES.FRAME_INDEX];
  const frames = getTraceFrames(state);
  const frame = frames[frameIndex];
  if (!frame) {
    return null;
  }
  return getSourceByActorId(state, frame.sourceId);
}
/**
 * Handles the firefox get Trace Matching Search Traces workflow.
 */
export function getTraceMatchingSearchTraces(state) {
  return state.tracerFrames?.mutableMatchingTraces || [];
}
/**
 * Handles the firefox get Trace Matching Search Exception workflow.
 */
export function getTraceMatchingSearchException(state) {
  return state.tracerFrames?.searchExceptionMessage || null;
}
/**
 * Handles the firefox get Trace Matching Search Value Or Grip workflow.
 */
export function getTraceMatchingSearchValueOrGrip(state) {
  return state.tracerFrames?.searchValueOrGrip;
}
/**
 * Handles the firefox get Is Tracing Values workflow.
 */
export function getIsTracingValues(state) {
  return state.tracerFrames?.traceValues || false;
}
/**
 * Handles the firefox get Selected Location Traces workflow.
 */
export function getSelectedLocationTraces(state) {
  return state.tracerFrames?.selectedLocationTraces || null;
}
