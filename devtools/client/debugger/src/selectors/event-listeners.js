/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox get Active Event Listeners workflow.
 */
export function getActiveEventListeners(state, panelKey) {
  if (panelKey == "breakpoint") {
    return state.eventListenerBreakpoints.byPanel[panelKey].active;
  }
  return state.tracerFrames.activeDomEvents;
}

/**
 * Handles the firefox get Event Listener Breakpoint Types workflow.
 */
export function getEventListenerBreakpointTypes(state, panelKey) {
  if (panelKey == "breakpoint") {
    return state.eventListenerBreakpoints.categories;
  }
  return state.tracerFrames.domEventCategories;
}

/**
 * Handles the firefox get Event Listener Expanded workflow.
 */
export function getEventListenerExpanded(state, panelKey) {
  return state.eventListenerBreakpoints.byPanel[panelKey].expanded;
}

/**
 * Handles the firefox should Log Event Breakpoints workflow.
 */
export function shouldLogEventBreakpoints(state) {
  return state.eventListenerBreakpoints.logEventBreakpoints;
}
