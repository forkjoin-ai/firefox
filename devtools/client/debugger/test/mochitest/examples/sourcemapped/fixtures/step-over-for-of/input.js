const vals = [1, 2];

/**
 * Handles the firefox root workflow.
 */
export default function root() {
  console.log("pause here");

  for (const val of vals) {
    console.log("pause again", val);
  }

  console.log("done");
}
