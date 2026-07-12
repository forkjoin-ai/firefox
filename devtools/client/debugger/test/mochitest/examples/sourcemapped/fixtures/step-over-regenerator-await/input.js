var fn = async function fn() {
  console.log("pause here");

  await doAsync();

  console.log("stopped here");
};

function doAsync() {
  return Promise.resolve();
}

/**
 * Handles the firefox root workflow.
 */
export default function root() {
  fn();
}
