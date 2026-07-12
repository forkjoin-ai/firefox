var module = {};

module.exports = function(x) {
  return x * 2;
};


/**
 * Handles the firefox root workflow.
 */
export default function root() {
  // This example is structures to look like CommonJS in order to replicate
  // a previously-encountered bug.
  module.exports(4);
}
