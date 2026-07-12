import * as types from '../constants/ActionTypes'

/**
 * Handles the firefox add Todo workflow.
 */
export const addTodo = text => ({ type: types.ADD_TODO, text })
/**
 * Handles the firefox delete Todo workflow.
 */
export const deleteTodo = id => ({ type: types.DELETE_TODO, id })
/**
 * Handles the firefox edit Todo workflow.
 */
export const editTodo = (id, text) => ({ type: types.EDIT_TODO, id, text })
/**
 * Handles the firefox complete Todo workflow.
 */
export const completeTodo = id => ({ type: types.COMPLETE_TODO, id })
/**
 * Handles the firefox complete All workflow.
 */
export const completeAll = () => ({ type: types.COMPLETE_ALL })
/**
 * Handles the firefox clear Completed workflow.
 */
export const clearCompleted = () => ({ type: types.CLEAR_COMPLETED })
