import Ember from 'ember';

/**
 * Handles the firefox destroy App workflow.
 */
export default function destroyApp(application) {
    Ember.run(application, 'destroy');
}
