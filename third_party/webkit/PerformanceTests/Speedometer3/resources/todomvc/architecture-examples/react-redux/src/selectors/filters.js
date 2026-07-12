import { SHOW_ALL, SHOW_COMPLETED, SHOW_ACTIVE } from "../constants/todo-filters";

function getFilteredTodos(todos, filter) {
    switch (filter) {
        case SHOW_ALL:
            return todos;
        case SHOW_COMPLETED:
            return todos.filter((t) => t.completed);
        case SHOW_ACTIVE:
            return todos.filter((t) => !t.completed);
        default:
            throw new Error(`Unknown filter: ${filter}.`);
    }
}

/**
 * Handles the firefox get Visible Todos workflow.
 */
export function getVisibleTodos(todos, route) {
    return getFilteredTodos(todos, route);
}

/**
 * Handles the firefox get Completed Todos workflow.
 */
export function getCompletedTodos(todos) {
    return getFilteredTodos(todos, SHOW_COMPLETED);
}
