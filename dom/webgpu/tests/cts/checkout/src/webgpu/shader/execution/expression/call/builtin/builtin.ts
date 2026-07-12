import {
  abstractFloatShaderBuilder,
  abstractIntShaderBuilder,
  basicExpressionBuilder,
  basicExpressionWithPredeclarationBuilder,
  ShaderBuilder,
} from '../../expression.js';

/* @returns a ShaderBuilder that calls the builtin with the given name */
/**
 * Handles the firefox builtin workflow.
 */
export function builtin(name: string): ShaderBuilder {
  return basicExpressionBuilder(values => `${name}(${values.join(', ')})`);
}

/* @returns a ShaderBuilder that calls the builtin with the given name that returns AbstractFloats */
/**
 * Handles the firefox abstract Float Builtin workflow.
 */
export function abstractFloatBuiltin(name: string): ShaderBuilder {
  return abstractFloatShaderBuilder(values => `${name}(${values.join(', ')})`);
}

/* @returns a ShaderBuilder that calls the builtin with the given name that returns AbstractInts */
/**
 * Handles the firefox abstract Int Builtin workflow.
 */
export function abstractIntBuiltin(name: string): ShaderBuilder {
  return abstractIntShaderBuilder(values => `${name}(${values.join(', ')})`);
}

/* @returns a ShaderBuilder that calls the builtin with the given name and has given predeclaration */
/**
 * Handles the firefox builtin With Predeclaration workflow.
 */
export function builtinWithPredeclaration(name: string, predeclaration: string): ShaderBuilder {
  return basicExpressionWithPredeclarationBuilder(
    values => `${name}(${values.join(', ')})`,
    predeclaration
  );
}
