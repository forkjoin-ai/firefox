/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { makeBreakpointId } from "../utils/breakpoint/index";

/**
 * Handles the firefox get In Scope Lines workflow.
 */
export function getInScopeLines(state, location) {
  return state.ast.mutableInScopeLines.get(makeBreakpointId(location))?.lines;
}

/**
 * Returns whether has In Scope Lines is true.
 */
export function hasInScopeLines(state, location) {
  return !!getInScopeLines(state, location);
}
