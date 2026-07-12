'use strict';

import {tryToCreateLock} from './bfcache-test-helpers.js';

let openSAH;

/**
 * Creates the SAH.
 */
export async function createSAH(mode, fileName) {
  if (openSAH) {
    throw new Error('Already have an open access handle.');
  }
  openSAH = await tryToCreateLock(
      fileName, fileHandle => fileHandle.createSyncAccessHandle({mode}));
  return openSAH !== undefined;
}

/**
 * Handles the firefox release SAH workflow.
 */
export async function releaseSAH() {
  if (!openSAH) {
    throw new Error('No open access handle.');
  }
  await openSAH.close();
  openSAH = undefined;
}

/**
 * Creates the And Release SAH.
 */
export async function createAndReleaseSAH(mode, fileName) {
  const sahLock = await tryToCreateLock(
      fileName, fileHandle => fileHandle.createSyncAccessHandle({mode}));
  await sahLock?.close();
  return sahLock !== undefined;
}

// Functions exposed to the renderer.
const funcs = {
  createSAH,
  releaseSAH,
  createAndReleaseSAH,
};

// Sets up a message handler that calls the `funcName` in `funcs` with `args`
// and then postMessages the result back to the renderer.
addEventListener('message', async ({data: {funcName, args}}) => {
  postMessage(await funcs[funcName](...args));
});
