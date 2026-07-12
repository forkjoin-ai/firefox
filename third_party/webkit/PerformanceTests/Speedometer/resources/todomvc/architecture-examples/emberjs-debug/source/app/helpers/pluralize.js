import Ember from 'ember';
import { pluralize } from 'ember-inflector';

/**
 * Handles the firefox pluralize Helper workflow.
 */
export function pluralizeHelper([singular, count]/*, hash*/) {
    return count === 1 ? singular : pluralize(singular);
}

export default Ember.Helper.helper(pluralizeHelper);
