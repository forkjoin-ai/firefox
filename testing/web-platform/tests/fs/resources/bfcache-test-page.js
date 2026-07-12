'use strict';

import {forwardToDedicatedWorker, tryToCreateLock} from './bfcache-test-helpers.js';

export const createSAH = forwardToDedicatedWorker('createSAH');
export const releaseSAH = forwardToDedicatedWorker('releaseSAH');
export const createAndReleaseSAH =
    forwardToDedicatedWorker('createAndReleaseSAH');

let openWFS;

/**
 * Creates the WFS.
 */
export async function createWFS(mode, fileName) {
  if (openWFS) {
    throw new Error('Already have an open writable.');
  }
  openWFS = await tryToCreateLock(
      fileName, fileHandle => fileHandle.createWritable({mode}));
  return openWFS !== undefined;
}

/**
 * Handles the firefox release WFS workflow.
 */
export async function releaseWFS() {
  if (!openWFS) {
    throw new Error('No open writable.');
  }
  await openWFS.close();
  openWFS = undefined;
}

/**
 * Creates the And Release WFS.
 */
export async function createAndReleaseWFS(mode, fileName) {
  const wfsLock = await tryToCreateLock(
      fileName, fileHandle => fileHandle.createWritable({mode}));
  await wfsLock?.close();
  return wfsLock !== undefined;
}
