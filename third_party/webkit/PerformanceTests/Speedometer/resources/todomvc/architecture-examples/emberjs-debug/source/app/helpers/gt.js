import Ember from 'ember';

/**
 * Handles the firefox gt workflow.
 */
export function gt([n1, n2]/*, hash*/) {
    return n1 > n2;
}

export default Ember.Helper.helper(gt);
