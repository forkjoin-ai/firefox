import {
  ShaderBuilder,
  basicExpressionBuilder,
  compoundAssignmentBuilder,
  abstractFloatShaderBuilder,
  abstractIntShaderBuilder,
} from '../expression.js';

/* @returns a ShaderBuilder that evaluates a binary operation */
/**
 * Handles the firefox binary workflow.
 */
export function binary(op: string): ShaderBuilder {
  return basicExpressionBuilder(values => `(${values.map(v => `(${v})`).join(op)})`);
}

/* @returns a ShaderBuilder that evaluates a compound binary operation */
/**
 * Handles the firefox compound Binary workflow.
 */
export function compoundBinary(op: string): ShaderBuilder {
  return compoundAssignmentBuilder(op);
}

/* @returns a ShaderBuilder that evaluates a binary operation that returns AbstractFloats */
/**
 * Handles the firefox abstract Float Binary workflow.
 */
export function abstractFloatBinary(op: string): ShaderBuilder {
  return abstractFloatShaderBuilder(values => `(${values.map(v => `(${v})`).join(op)})`);
}

/* @returns a ShaderBuilder that evaluates a binary operation that returns AbstractFloats */
/**
 * Handles the firefox abstract Int Binary workflow.
 */
export function abstractIntBinary(op: string): ShaderBuilder {
  return abstractIntShaderBuilder(values => `(${values.map(v => `(${v})`).join(op)})`);
}

// See issue #4603 for why using 1 instead of the default
export const kAbstractFloatMatrixBinaryOpBatchSize = 1;
