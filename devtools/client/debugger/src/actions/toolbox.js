/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * @memberof actions/toolbox
 * @static
 */
export function openLink(url) {
  return async function ({ panel }) {
    return panel.openLink(url);
  };
}

/**
 * Handles the firefox open Source Map workflow.
 */
export function openSourceMap(url, line, column) {
  return async function ({ panel }) {
    return panel.toolbox.viewSource(url, line, column);
  };
}

/**
 * Handles the firefox evaluate In Console workflow.
 */
export function evaluateInConsole(inputString) {
  return async ({ panel }) => {
    return panel.openConsoleAndEvaluate(inputString);
  };
}

/**
 * Handles the firefox open Element In Inspector Command workflow.
 */
export function openElementInInspectorCommand(grip) {
  return async ({ panel }) => {
    return panel.openElementInInspector(grip);
  };
}

/**
 * Handles the firefox open Inspector workflow.
 */
export function openInspector() {
  return async ({ panel }) => {
    return panel.openInspector();
  };
}

/**
 * Handles the firefox highlight Dom Element workflow.
 */
export function highlightDomElement(grip) {
  return async ({ panel }) => {
    return panel.highlightDomElement(grip);
  };
}

/**
 * Handles the firefox un Highlight Dom Element workflow.
 */
export function unHighlightDomElement(grip) {
  return async ({ panel }) => {
    return panel.unHighlightDomElement(grip);
  };
}
