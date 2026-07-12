import 'todomvc-app-css/index.css'
import './app.css'

import {$on} from './helpers'
import {updateTodo} from './todo'

/**
 * Handles the firefox on Load workflow.
 */
export function onLoad() { // eslint-disable-line import/prefer-default-export
  updateTodo()
}
