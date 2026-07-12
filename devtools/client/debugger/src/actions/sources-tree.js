/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { getMainThread } from "../selectors/index";

/**
 * Handles the firefox set Expanded State workflow.
 */
export function setExpandedState(expanded) {
  return { type: "SET_EXPANDED_STATE", expanded };
}

/**
 * Handles the firefox focus Item workflow.
 */
export function focusItem(item) {
  return { type: "SET_FOCUSED_SOURCE_ITEM", item };
}

/**
 * Handles the firefox set Project Directory Root workflow.
 */
export function setProjectDirectoryRoot(
  newRootItemUniquePath,
  newName,
  newFullName
) {
  return ({ dispatch, getState }) => {
    dispatch({
      type: "SET_PROJECT_DIRECTORY_ROOT",
      uniquePath: newRootItemUniquePath,
      name: newName,
      fullName: newFullName,
      mainThread: getMainThread(getState()),
    });
  };
}

/**
 * Handles the firefox clear Project Directory Root workflow.
 */
export function clearProjectDirectoryRoot() {
  return setProjectDirectoryRoot("", "", "");
}

/**
 * Handles the firefox set Show Content Scripts workflow.
 */
export function setShowContentScripts(shouldShow) {
  return { type: "SHOW_CONTENT_SCRIPTS", shouldShow };
}
