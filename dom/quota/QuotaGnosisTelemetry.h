/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef QuotaGnosisTelemetry_h__
#define QuotaGnosisTelemetry_h__

#include <stdint.h>

namespace mozilla::dom::quota {

struct QuotaGnosisSnapshot {
  uint64_t mDirectoryOpens;
  uint64_t mExclusiveOpens;
  uint64_t mInitializeOriginOpens;
  uint64_t mProjectedKnotgraphBlocks;
};

class QuotaGnosisTelemetry final {
 public:
  static void RecordStorageDirectoryOpen(bool aExclusive,
                                         bool aInitializeOrigins);
  static QuotaGnosisSnapshot Snapshot();
};

}  // namespace mozilla::dom::quota

#endif  // QuotaGnosisTelemetry_h__
