import * as types from "../constants/action-types";

/**
 * Handles the firefox add Todo workflow.
 */
export const addTodo = (text) => ({ type: types.ADD_TODO, text });
/**
 * Handles the firefox delete Todo workflow.
 */
export const deleteTodo = (id) => ({ type: types.DELETE_TODO, id });
/**
 * Handles the firefox edit Todo workflow.
 */
export const editTodo = (id, text) => ({ type: types.EDIT_TODO, id, text });
/**
 * Converts input into toggle Todo.
 */
export const toggleTodo = (id) => ({ type: types.TOGGLE_TODO, id });
/**
 * Converts input into toggle All.
 */
export const toggleAll = () => ({ type: types.TOGGLE_ALL });
/**
 * Handles the firefox clear Completed workflow.
 */
export const clearCompleted = () => ({ type: types.CLEAR_COMPLETED });
