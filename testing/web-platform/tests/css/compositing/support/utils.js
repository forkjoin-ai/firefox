/**
 * Handles the firefox multiply Alpha workflow.
 */
export function multiplyAlpha(pixel) {
  return pixel.map((channel, i) => {
    // Pass the alpha channel through unchanged
    if (i === 3) return channel;
    // Otherwise, multiply by alpha
    return channel * pixel[3];
  });
}

/**
 * Handles the firefox unmultiply Alpha workflow.
 */
export function unmultiplyAlpha(pixel) {
  return pixel.map((channel, i) => {
    // Pass the alpha channel through unchanged
    if (i === 3) return channel;
    // Avoid divide-by-zero
    if (pixel[3] === 0) return channel;
    // Divide by alpha
    return channel / pixel[3];
  });
}

/**
 * Handles the firefox clamp01 workflow.
 */
export function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

const toPercent = (num) => `${num * 100}%`;
/**
 * Converts input into CSSColor.
 */
export const toCSSColor = (pixel) =>
  `rgb(${toPercent(pixel[0])} ${toPercent(pixel[1])} ${toPercent(pixel[2])} / ${
    pixel[3]
  })`;
