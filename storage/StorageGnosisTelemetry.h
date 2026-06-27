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
};

class StorageGnosisTelemetry final {
 public:
  static void RecordAsyncStep(bool aReadOnly, int aSqliteResult);
  static StorageGnosisSnapshot Snapshot();
};

}  // namespace mozilla::storage

#endif  // StorageGnosisTelemetry_h__
