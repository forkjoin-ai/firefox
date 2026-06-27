/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "QuotaGnosisTelemetry.h"

#include "mozilla/Atomics.h"

namespace mozilla::dom::quota {

static Atomic<uint64_t, Relaxed> sDirectoryOpens(0);
static Atomic<uint64_t, Relaxed> sExclusiveOpens(0);
static Atomic<uint64_t, Relaxed> sInitializeOriginOpens(0);
static Atomic<uint64_t, Relaxed> sProjectedKnotgraphBlocks(0);

void QuotaGnosisTelemetry::RecordStorageDirectoryOpen(
    bool aExclusive, bool aInitializeOrigins) {
  sDirectoryOpens++;
  if (aExclusive) {
    sExclusiveOpens++;
  }
  if (aInitializeOrigins) {
    sInitializeOriginOpens++;
  }
  sProjectedKnotgraphBlocks++;
}

QuotaGnosisSnapshot QuotaGnosisTelemetry::Snapshot() {
  return {
      sDirectoryOpens,
      sExclusiveOpens,
      sInitializeOriginOpens,
      sProjectedKnotgraphBlocks,
  };
}

}  // namespace mozilla::dom::quota
