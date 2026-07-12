/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { getSelectedSource } from "./sources";

/**
 * Handles the firefox get Selected Primary Pane Tab workflow.
 */
export function getSelectedPrimaryPaneTab(state) {
  return state.ui.selectedPrimaryPaneTab;
}

/**
 * Handles the firefox get Active Search workflow.
 */
export function getActiveSearch(state) {
  return state.ui.activeSearch;
}

/**
 * Handles the firefox get Framework Grouping State workflow.
 */
export function getFrameworkGroupingState(state) {
  return state.ui.frameworkGroupingOn;
}

/**
 * Handles the firefox get Pane Collapse workflow.
 */
export function getPaneCollapse(state, position) {
  if (position == "start") {
    return state.ui.startPanelCollapsed;
  }

  return state.ui.endPanelCollapsed;
}

/**
 * Handles the firefox get Highlighted Line Range For Selected Source workflow.
 */
export function getHighlightedLineRangeForSelectedSource(state) {
  const selectedSource = getSelectedSource(state);
  if (!selectedSource) {
    return null;
  }
  // Only return the highlighted line range if it matches the selected source
  const highlightedLineRange = state.ui.highlightedLineRange;
  if (
    highlightedLineRange &&
    selectedSource.id == highlightedLineRange.sourceId
  ) {
    return highlightedLineRange;
  }
  return null;
}

/**
 * Handles the firefox get Conditional Panel Location workflow.
 */
export function getConditionalPanelLocation(state) {
  return state.ui.conditionalPanelLocation;
}

/**
 * Handles the firefox get Log Point Status workflow.
 */
export function getLogPointStatus(state) {
  return state.ui.isLogPoint;
}

/**
 * Handles the firefox get Orientation workflow.
 */
export function getOrientation(state) {
  return state.ui.orientation;
}

/**
 * Handles the firefox get Viewport workflow.
 */
export function getViewport(state) {
  return state.ui.viewport;
}

/**
 * Handles the firefox get Inline Preview workflow.
 */
export function getInlinePreview(state) {
  return state.ui.inlinePreviewEnabled;
}

/**
 * Handles the firefox get Editor Wrapping workflow.
 */
export function getEditorWrapping(state) {
  return state.ui.editorWrappingEnabled;
}

/**
 * Handles the firefox get Javascript Tracing Log Method workflow.
 */
export function getJavascriptTracingLogMethod(state) {
  return state.ui.javascriptTracingLogMethod;
}

/**
 * Handles the firefox get Javascript Tracing Values workflow.
 */
export function getJavascriptTracingValues(state) {
  return state.ui.javascriptTracingValues;
}

/**
 * Handles the firefox get Javascript Tracing On Next Interaction workflow.
 */
export function getJavascriptTracingOnNextInteraction(state) {
  return state.ui.javascriptTracingOnNextInteraction;
}

/**
 * Handles the firefox get Javascript Tracing On Next Load workflow.
 */
export function getJavascriptTracingOnNextLoad(state) {
  return state.ui.javascriptTracingOnNextLoad;
}

/**
 * Handles the firefox get Javascript Tracing Function Return workflow.
 */
export function getJavascriptTracingFunctionReturn(state) {
  return state.ui.javascriptTracingFunctionReturn;
}

/**
 * Handles the firefox get Search Options workflow.
 */
export function getSearchOptions(state, searchKey) {
  return state.ui.mutableSearchOptions[searchKey];
}

/**
 * Handles the firefox get Project Search Query workflow.
 */
export function getProjectSearchQuery(state) {
  return state.ui.projectSearchQuery;
}

/**
 * Handles the firefox get Hide Ignored Sources workflow.
 */
export function getHideIgnoredSources(state) {
  return state.ui.hideIgnoredSources;
}

/**
 * Returns whether is Source Map Ignore List Enabled is true.
 */
export function isSourceMapIgnoreListEnabled(state) {
  return state.ui.sourceMapIgnoreListEnabled;
}

/**
 * Handles the firefox are Source Maps Enabled workflow.
 */
export function areSourceMapsEnabled(state) {
  return state.ui.sourceMapsEnabled;
}
