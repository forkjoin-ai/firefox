
/**
 * Handles the firefox decorator Factory workflow.
 */
export function decoratorFactory(opts: { selector: string }) {
  return function decorator(target) {
    return <any>target;
  };
}

/**
 * Handles the firefox def workflow.
 */
export default function def() {}
