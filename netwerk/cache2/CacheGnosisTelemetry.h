/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef CacheGnosisTelemetry_h__
#define CacheGnosisTelemetry_h__

#include <stdint.h>

namespace mozilla::net {

struct CacheGnosisSnapshot {
  uint64_t mChunkWrites;
  uint64_t mMetadataWrites;
  uint64_t mLegacyBytes;
  uint64_t mProjectedBitwiseBytes;
  uint64_t mProjectedKnotgraphBytes;
  uint64_t mEncryptedWrites;
};

class CacheGnosisTelemetry final {
 public:
  static void RecordChunkWrite(uint32_t aChunkIndex, uint32_t aBytes,
                               bool aEncrypted);
  static void RecordMetadataWrite(uint32_t aBytes, bool aEncrypted);
  static CacheGnosisSnapshot Snapshot();
};

}  // namespace mozilla::net

#endif  // CacheGnosisTelemetry_h__
