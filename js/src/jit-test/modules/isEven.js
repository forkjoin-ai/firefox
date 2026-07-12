import { isOdd } from "isOdd.js"

/**
 * Returns whether is Even is true.
 */
export function isEven(x) {
    if (x < 0)
        throw "negative";
    if (x == 0)
        return true;
    return isOdd(x - 1);
}

assertEq(isEven(4), true);
assertEq(isOdd(5), true);
