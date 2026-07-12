// app/instance-initializers/global.js

/**
 * Handles the firefox initialize workflow.
 */
export function initialize(application) {
  window.App = application;  // or window.Whatever
}

export default {
  name: 'global',
  initialize: initialize
};