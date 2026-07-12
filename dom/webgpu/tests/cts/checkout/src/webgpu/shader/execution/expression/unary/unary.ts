import {
  abstractFloatShaderBuilder,
  abstractIntShaderBuilder,
  basicExpressionBuilder,
  ShaderBuilder,
} from '../expression.js';

/* @returns a ShaderBuilder that evaluates a prefix unary operation */
/**
 * Handles the firefox unary workflow.
 */
export function unary(op: string): ShaderBuilder {
  return basicExpressionBuilder(value => `${op}(${value})`);
}

/* @returns a ShaderBuilder that evaluates a prefix unary operation that returns AbstractFloats */
/**
 * Handles the firefox abstract Float Unary workflow.
 */
export function abstractFloatUnary(op: string): ShaderBuilder {
  return abstractFloatShaderBuilder(value => `${op}(${value})`);
}

/* @returns a ShaderBuilder that evaluates a prefix unary operation that returns AbstractInts */
/**
 * Handles the firefox abstract Int Unary workflow.
 */
export function abstractIntUnary(op: string): ShaderBuilder {
  return abstractIntShaderBuilder(value => `${op}(${value})`);
}
