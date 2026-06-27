/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef StorageGnosisTelemetry_h__
#define StorageGnosisTelemetry_h__

#include <stdint.h>

namespace mozilla::storage {

struct StorageGnosisSnapshot {
  uint64_t mAsyncSteps;
  uint64_t mAsyncWriteSteps;
  uint64_t mCompletedWriteSteps;
  uint64_t mBusyRetries;
  uint64_t mProjectedKnotgraphBlocks;
  uint64_t mQuotaVFSWrites;
  uint64_t mQuotaVFSTruncates;
  uint64_t mQuotaVFSSizeHints;
  uint64_t mQuotaVFSBytesProjected;
};

class StorageGnosisTelemetry final {
 public:
  static void RecordAsyncStep(bool aReadOnly, int aSqliteResult);
  static void RecordQuotaVFSWrite(uint64_t aBytes, bool aQuotaControlled,
                                  int aSqliteResult);
  static void RecordQuotaVFSTruncate(uint64_t aSize, bool aQuotaControlled,
                                     int aSqliteResult);
  static void RecordQuotaVFSSizeHint(uint64_t aSize, bool aQuotaControlled,
                                     int aSqliteResult);
  static StorageGnosisSnapshot Snapshot();
};

}  // namespace mozilla::storage

#endif  // StorageGnosisTelemetry_h__
