/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Handles the firefox get Pending Breakpoints workflow.
 */
export function getPendingBreakpoints(state) {
  return state.pendingBreakpoints;
}

/**
 * Handles the firefox get Pending Breakpoint List workflow.
 */
export function getPendingBreakpointList(state) {
  return Object.values(getPendingBreakpoints(state));
}

/**
 * Handles the firefox get Pending Breakpoints For Source workflow.
 */
export function getPendingBreakpointsForSource(state, source) {
  return getPendingBreakpointList(state).filter(pendingBreakpoint => {
    return (
      pendingBreakpoint.location.sourceUrl === source.url ||
      pendingBreakpoint.generatedLocation.sourceUrl == source.url
    );
  });
}
