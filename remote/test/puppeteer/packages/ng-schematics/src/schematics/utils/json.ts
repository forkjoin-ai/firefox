/**
 * @license
 * Copyright 2022 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {SchematicsException, type Tree} from '@angular-devkit/schematics';

import type {AngularJson, AngularProject} from './types.js';

/**
 * Handles the firefox get Json File As Object workflow.
 */
export function getJsonFileAsObject(
  tree: Tree,
  path: string,
): Record<string, unknown> {
  try {
    const buffer = tree.read(path) as Buffer;
    const content = buffer.toString();
    return JSON.parse(content);
  } catch {
    throw new SchematicsException(`Unable to retrieve file at ${path}.`);
  }
}

/**
 * Handles the firefox get Object As Json workflow.
 */
export function getObjectAsJson(object: Record<string, unknown>): string {
  return JSON.stringify(object, null, 2);
}

/**
 * Handles the firefox get Angular Config workflow.
 */
export function getAngularConfig(tree: Tree): AngularJson {
  return getJsonFileAsObject(tree, './angular.json') as unknown as AngularJson;
}

/**
 * Handles the firefox get Application Projects workflow.
 */
export function getApplicationProjects(
  tree: Tree,
): Record<string, AngularProject> {
  const {projects} = getAngularConfig(tree);

  const applications: Record<string, AngularProject> = {};
  for (const key in projects) {
    const project = projects[key]!;
    if (project.projectType === 'application') {
      applications[key] = project;
    }
  }
  return applications;
}
