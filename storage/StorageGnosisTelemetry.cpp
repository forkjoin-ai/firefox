/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "StorageGnosisTelemetry.h"

#include "mozilla/Atomics.h"
#include "sqlite3.h"

namespace mozilla::storage {

static Atomic<uint64_t, Relaxed> sAsyncSteps(0);
static Atomic<uint64_t, Relaxed> sAsyncWriteSteps(0);
static Atomic<uint64_t, Relaxed> sCompletedWriteSteps(0);
static Atomic<uint64_t, Relaxed> sBusyRetries(0);
static Atomic<uint64_t, Relaxed> sProjectedKnotgraphBlocks(0);

void StorageGnosisTelemetry::RecordAsyncStep(bool aReadOnly,
                                             int aSqliteResult) {
  sAsyncSteps++;
  if (aSqliteResult == SQLITE_BUSY) {
    sBusyRetries++;
  }
  if (aReadOnly) {
    return;
  }
  sAsyncWriteSteps++;
  if (aSqliteResult == SQLITE_DONE || aSqliteResult == SQLITE_ROW) {
    sCompletedWriteSteps++;
    sProjectedKnotgraphBlocks++;
  }
}

StorageGnosisSnapshot StorageGnosisTelemetry::Snapshot() {
  return {
      sAsyncSteps,
      sAsyncWriteSteps,
      sCompletedWriteSteps,
      sBusyRetries,
      sProjectedKnotgraphBlocks,
  };
}

}  // namespace mozilla::storage
