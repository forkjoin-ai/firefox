/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/

export function keysOf(obj) {
  return Object.keys(obj);
}

/**
 * Handles the firefox numeric Keys Of workflow.
 */
export function numericKeysOf(obj) {
  return Object.keys(obj).map((n) => Number(n));
}

/**
 * @returns a new Record from `objects`, using the string returned by Object.toString() as the keys
 * and the objects as the values.
 */
export function objectsToRecord(objects) {
  const record = {};
  return objects.reduce((obj, type) => {
    return {
      ...obj,
      [type.toString()]: type
    };
  }, record);
}

/**
 * Creates an info lookup object from a more nicely-formatted table. See below for examples.
 *
 * Note: Using `as const` on the arguments to this function is necessary to infer the correct type.
 */
export function makeTable(




members,
defaults,
table)


{
  const result = {};
  for (const [k, v] of Object.entries(table)) {
    const item = {};
    for (let i = 0; i < members.length; ++i) {
      item[members[i]] = v[i] ?? defaults[i];
    }
    result[k] = item;
  }

  return result;
}

/**
 * Handles the firefox make Table Rename And Filter workflow.
 */
export function makeTableRenameAndFilter(





columnRenames,
columnsKept,
columns,
defaults,
table)


{
  const result = {};
  const keyToIndex = new Map(
    columnsKept.map((name) => {
      const remappedName = columnRenames[name] === undefined ? name : columnRenames[name];
      return [name, columns.indexOf(remappedName)];
    })
  );
  for (const [k, v] of Object.entries(table)) {
    const item = {};
    for (const member of columnsKept) {
      const ndx = keyToIndex.get(member);
      item[member] = v[ndx] ?? defaults[ndx];
    }
    result[k] = item;
  }

  return result;
}