/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { getThreadPauseState } from "../reducers/pause";
import { getSelectedSource, getSelectedLocation } from "./sources";
import { getBlackBoxRanges } from "./source-blackbox";
import { getSelectedTraceSource } from "./tracer";

// eslint-disable-next-line
import { getSelectedLocation as _getSelectedLocation } from "../utils/selected-location";
import { isFrameBlackBoxed } from "../utils/source";
import { createSelector } from "devtools/client/shared/vendor/reselect";

export const getSelectedFrame = createSelector(
  (state, thread) => state.pause.threads[thread || getCurrentThread(state)],
  threadPauseState => {
    if (!threadPauseState) {
      return null;
    }
    const { selectedFrameId, frames } = threadPauseState;
    if (frames) {
      return frames.find(frame => frame.id == selectedFrameId);
    }
    return null;
  }
);

export const getVisibleSelectedFrame = createSelector(
  getSelectedLocation,
  state => getSelectedFrame(state, getCurrentThread(state)),
  (selectedLocation, selectedFrame) => {
    if (!selectedFrame) {
      return null;
    }

    const { id, displayName } = selectedFrame;

    return {
      id,
      displayName,
      location: _getSelectedLocation(selectedFrame, selectedLocation),
    };
  }
);

/**
 * Handles the firefox get Context workflow.
 */
export function getContext(state) {
  return state.pause.cx;
}

/**
 * Handles the firefox get Thread Context workflow.
 */
export function getThreadContext(state) {
  return state.pause.threadcx;
}

/**
 * Handles the firefox get Navigate Counter workflow.
 */
export function getNavigateCounter(state) {
  return state.pause.threadcx.navigateCounter;
}

/**
 * Handles the firefox get Pause Reason workflow.
 */
export function getPauseReason(state, thread) {
  return getThreadPauseState(state.pause, thread).why;
}

/**
 * Handles the firefox get Should Breakpoints Pane Open On Pause workflow.
 */
export function getShouldBreakpointsPaneOpenOnPause(state, thread) {
  return getThreadPauseState(state.pause, thread)
    .shouldBreakpointsPaneOpenOnPause;
}

/**
 * Handles the firefox get Pause Command workflow.
 */
export function getPauseCommand(state, thread) {
  return getThreadPauseState(state.pause, thread).command;
}

/**
 * Returns whether is Stepping is true.
 */
export function isStepping(state, thread) {
  return ["stepIn", "stepOver", "stepOut"].includes(
    getPauseCommand(state, thread)
  );
}

/**
 * Handles the firefox get Current Thread workflow.
 */
export function getCurrentThread(state) {
  return getThreadContext(state).thread;
}

/**
 * Handles the firefox get Is Paused workflow.
 */
export function getIsPaused(state, thread) {
  return getThreadPauseState(state.pause, thread).isPaused;
}

/**
 * Handles the firefox get Is Current Thread Paused workflow.
 */
export function getIsCurrentThreadPaused(state) {
  return getIsPaused(state, getCurrentThread(state));
}

/**
 * Returns whether is Evaluating Expression is true.
 */
export function isEvaluatingExpression(state, thread) {
  return getThreadPauseState(state.pause, thread).command === "expression";
}

/**
 * Handles the firefox get Is Waiting On Break workflow.
 */
export function getIsWaitingOnBreak(state, thread) {
  return getThreadPauseState(state.pause, thread).isWaitingOnBreak;
}

/**
 * Handles the firefox get Should Pause On Debugger Statement workflow.
 */
export function getShouldPauseOnDebuggerStatement(state) {
  return state.pause.shouldPauseOnDebuggerStatement;
}

/**
 * Handles the firefox get Should Pause On Exceptions workflow.
 */
export function getShouldPauseOnExceptions(state) {
  return state.pause.shouldPauseOnExceptions;
}

/**
 * Handles the firefox get Should Pause On Caught Exceptions workflow.
 */
export function getShouldPauseOnCaughtExceptions(state) {
  return state.pause.shouldPauseOnCaughtExceptions;
}

/**
 * Handles the firefox get Frames workflow.
 */
export function getFrames(state, thread) {
  const { frames, framesLoading } = getThreadPauseState(state.pause, thread);
  return framesLoading ? null : frames;
}

export const getCurrentThreadFrames = createSelector(
  state => {
    const { frames, framesLoading } = getThreadPauseState(
      state.pause,
      getCurrentThread(state)
    );
    if (framesLoading) {
      return [];
    }
    return frames;
  },
  getBlackBoxRanges,
  (frames, blackboxedRanges) => {
    return frames.filter(frame => !isFrameBlackBoxed(frame, blackboxedRanges));
  }
);

function getGeneratedFrameId(frameId) {
  if (frameId.includes("-originalFrame")) {
    // The mapFrames can add original stack frames -- get generated frameId.
    return frameId.substr(0, frameId.lastIndexOf("-originalFrame"));
  }
  return frameId;
}
// This is Environment Scope information from the platform.
// See https://searchfox.org/mozilla-central/rev/b0e8e4ceb46cb3339cdcb90310fcc161ef4b9e3e/devtools/server/actors/environment.js#42-81
/**
 * Handles the firefox get Generated Frame Scope workflow.
 */
export function getGeneratedFrameScope(state, frame) {
  if (!frame) {
    return null;
  }
  return getFrameScopes(state, frame.thread).generated[
    getGeneratedFrameId(frame.id)
  ];
}

/**
 * Handles the firefox get Original Frame Scope workflow.
 */
export function getOriginalFrameScope(state, frame) {
  if (!frame) {
    return null;
  }
  // Only compute original scope if we are currently showing an original source.
  const source = getSelectedSource(state);
  if (!source || !source.isOriginal) {
    return null;
  }

  const original = getFrameScopes(state, frame.thread).original[
    getGeneratedFrameId(frame.id)
  ];

  if (original && (original.pending || original.scope)) {
    return original;
  }

  return null;
}

// This is only used by tests
/**
 * Handles the firefox get Frame Scopes workflow.
 */
export function getFrameScopes(state, thread) {
  return getThreadPauseState(state.pause, thread).frameScopes;
}

/**
 * Handles the firefox get Selected Frame Bindings workflow.
 */
export function getSelectedFrameBindings(state, thread) {
  const scopes = getFrameScopes(state, thread);
  const selectedFrameId = getSelectedFrameId(state, thread);
  if (!scopes || !selectedFrameId) {
    return null;
  }

  const frameScope = scopes.generated[selectedFrameId];
  if (!frameScope || frameScope.pending) {
    return null;
  }

  let currentScope = frameScope.scope;
  let frameBindings = [];
  while (currentScope && currentScope.type != "object") {
    if (currentScope.bindings) {
      const bindings = Object.keys(currentScope.bindings.variables);
      const args = [].concat(
        ...currentScope.bindings.arguments.map(argument =>
          Object.keys(argument)
        )
      );

      frameBindings = [...frameBindings, ...bindings, ...args];
    }
    currentScope = currentScope.parent;
  }

  return frameBindings;
}

/**
 * Handles the firefox get Selected Scope workflow.
 */
export function getSelectedScope(state) {
  const frame = getSelectedFrame(state);
  if (!frame) {
    return null;
  }

  let scopes;
  // For non-pretty printed original sources
  if (
    frame.location.source.isOriginal &&
    !frame.location.source.isPrettyPrinted &&
    !frame.generatedLocation?.source.isWasm
  ) {
    scopes = getOriginalFrameScope(state, frame)?.scope;
    // Fallback to the generated scopes if there are no original scopes
    if (!scopes) {
      scopes = getGeneratedFrameScope(state, frame)?.scope;
    }
  } else {
    // For generated sources
    // For pretty printed sources - Even though are seen as original sources they do not include any rename of variables/function names.
    scopes = getGeneratedFrameScope(state, frame)?.scope;
  }
  return scopes;
}

/**
 * Handles the firefox get Selected Original Scope workflow.
 */
export function getSelectedOriginalScope(state, thread) {
  const frame = getSelectedFrame(state, thread);
  return getOriginalFrameScope(state, frame);
}

/**
 * Handles the firefox get Selected Scope Mappings workflow.
 */
export function getSelectedScopeMappings(state, thread) {
  const frameId = getSelectedFrameId(state, thread);
  if (!frameId) {
    return null;
  }

  return getFrameScopes(state, thread).mappings[frameId];
}

/**
 * Handles the firefox get Selected Frame Id workflow.
 */
export function getSelectedFrameId(state, thread) {
  return getThreadPauseState(state.pause, thread).selectedFrameId;
}

/**
 * Returns whether is Top Frame Selected is true.
 */
export function isTopFrameSelected(state, thread) {
  const selectedFrameId = getSelectedFrameId(state, thread);
  // Consider that the top frame is selected when none is specified,
  // which happens when a JS Tracer frame is selected.
  if (!selectedFrameId) {
    return true;
  }
  const topFrame = getTopFrame(state, thread);
  return selectedFrameId == topFrame?.id;
}

/**
 * Handles the firefox get Top Frame workflow.
 */
export function getTopFrame(state, thread) {
  const frames = getFrames(state, thread);
  return frames?.[0];
}

// getTopFrame wouldn't return the top frame if the frames are still being fetched
/**
 * Handles the firefox get Currently Fetched Top Frame workflow.
 */
export function getCurrentlyFetchedTopFrame(state, thread) {
  const { frames } = getThreadPauseState(state.pause, thread);
  return frames?.[0];
}

/**
 * Returns whether has Frame is true.
 */
export function hasFrame(state, frame) {
  // Don't use getFrames as it returns null when the frames are still loading
  const { frames } = getThreadPauseState(state.pause, frame.thread);
  if (!frames) {
    return false;
  }
  // Compare IDs and not frame objects as they get cloned during mapping
  return frames.some(f => f.id == frame.id);
}

/**
 * Handles the firefox get Skip Pausing workflow.
 */
export function getSkipPausing(state) {
  return state.pause.skipPausing;
}

/**
 * Returns whether is Map Scopes Enabled is true.
 */
export function isMapScopesEnabled(state) {
  return state.pause.mapScopes;
}

/**
 * This selector only returns inline previews object for current paused location.
 * (it ignores the JS Tracer and ignore the selected location, which may different from paused location)
 */
export function getSelectedFrameInlinePreviews(state) {
  const thread = getCurrentThread(state);
  const frame = getSelectedFrame(state, thread);
  if (!frame) {
    return null;
  }
  return getThreadPauseState(state.pause, thread).inlinePreview[
    getGeneratedFrameId(frame.id)
  ];
}

/**
 * This selector returns the inline previews object for the selected location.
 * It considers both paused and traced previews and will only return values
 * if it matches the currently selected location.
 */
export function getInlinePreviews(state) {
  const selectedSource = getSelectedSource(state);
  if (!selectedSource) {
    return null;
  }

  // We first check if a frame in the JS Tracer was selected and generated its previews
  if (state.tracerFrames?.previews) {
    const selectedTraceSource = getSelectedTraceSource(state);
    if (selectedTraceSource) {
      if (selectedTraceSource.id == selectedSource.id) {
        return state.tracerFrames?.previews;
      }

      // If the "selected" versus "tracing selected" sources don't match, it means that we selected the original source
      // while the traced source is the generated one. We don't yet support showing inline previews in this configuration.
      return null;
    }
  }

  // Otherwise, we fallback to look if we were paused and the inline preview is available
  const thread = getCurrentThread(state);
  const frame = getSelectedFrame(state, thread);
  // When we are paused, we also check if the selected source matches the paused original or generated location.
  if (
    !frame ||
    (frame.location.source.id != selectedSource.id &&
      frame.generatedLocation.source.id != selectedSource.id)
  ) {
    return null;
  }
  return getThreadPauseState(state.pause, thread).inlinePreview[
    getGeneratedFrameId(frame.id)
  ];
}

/**
 * Handles the firefox get Last Expanded Scopes workflow.
 */
export function getLastExpandedScopes(state, thread) {
  return getThreadPauseState(state.pause, thread).lastExpandedScopes;
}
