/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { DEBUGGER_PAUSED_REASONS_L10N_MAPPING } from "devtools/shared/constants";

/**
 * Handles the firefox get Pause Reason workflow.
 */
export function getPauseReason(why) {
  if (!why) {
    return null;
  }

  const reasonType = why.type;
  if (!DEBUGGER_PAUSED_REASONS_L10N_MAPPING[reasonType]) {
    console.log("Please file an issue: reasonType=", reasonType);
  }

  return DEBUGGER_PAUSED_REASONS_L10N_MAPPING[reasonType];
}

/**
 * Returns whether is Exception is true.
 */
export function isException(why) {
  return why?.type === "exception";
}

/**
 * Returns whether is Interrupted is true.
 */
export function isInterrupted(why) {
  return why?.type === "interrupted";
}

/**
 * Handles the firefox in Debugger Eval workflow.
 */
export function inDebuggerEval(why) {
  if (
    why &&
    why.type === "exception" &&
    why.exception &&
    why.exception.preview &&
    why.exception.preview.fileName
  ) {
    return why.exception.preview.fileName === "debugger eval code";
  }

  return false;
}
