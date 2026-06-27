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
static Atomic<uint64_t, Relaxed> sQuotaVFSWrites(0);
static Atomic<uint64_t, Relaxed> sQuotaVFSTruncates(0);
static Atomic<uint64_t, Relaxed> sQuotaVFSSizeHints(0);
static Atomic<uint64_t, Relaxed> sQuotaVFSBytesProjected(0);

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

static uint64_t ProjectedKnotgraphBytes(uint64_t aBytes) {
  return 432 + ((aBytes + 4095) / 4096) * 64;
}

void StorageGnosisTelemetry::RecordQuotaVFSWrite(uint64_t aBytes,
                                                 bool aQuotaControlled,
                                                 int aSqliteResult) {
  if (!aQuotaControlled) {
    return;
  }
  sQuotaVFSWrites++;
  if (aSqliteResult == SQLITE_OK) {
    sProjectedKnotgraphBlocks++;
    sQuotaVFSBytesProjected += ProjectedKnotgraphBytes(aBytes);
  }
}

void StorageGnosisTelemetry::RecordQuotaVFSTruncate(uint64_t aSize,
                                                    bool aQuotaControlled,
                                                    int aSqliteResult) {
  if (!aQuotaControlled) {
    return;
  }
  sQuotaVFSTruncates++;
  if (aSqliteResult == SQLITE_OK) {
    sProjectedKnotgraphBlocks++;
    sQuotaVFSBytesProjected += ProjectedKnotgraphBytes(aSize);
  }
}

void StorageGnosisTelemetry::RecordQuotaVFSSizeHint(uint64_t aSize,
                                                    bool aQuotaControlled,
                                                    int aSqliteResult) {
  if (!aQuotaControlled) {
    return;
  }
  sQuotaVFSSizeHints++;
  if (aSqliteResult == SQLITE_OK) {
    sQuotaVFSBytesProjected += ProjectedKnotgraphBytes(aSize);
  }
}

StorageGnosisSnapshot StorageGnosisTelemetry::Snapshot() {
  return {
      sAsyncSteps,
      sAsyncWriteSteps,
      sCompletedWriteSteps,
      sBusyRetries,
      sProjectedKnotgraphBlocks,
      sQuotaVFSWrites,
      sQuotaVFSTruncates,
      sQuotaVFSSizeHints,
      sQuotaVFSBytesProjected,
  };
}

}  // namespace mozilla::storage
