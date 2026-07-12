// Copyright (C) 2024 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

globalThis.evaluations.push("then");

/**
 * Handles the firefox then workflow.
 */
export function then(cb) { cb(); }
