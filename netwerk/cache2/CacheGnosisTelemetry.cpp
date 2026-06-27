/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "CacheGnosisTelemetry.h"

#include "mozilla/Atomics.h"

namespace mozilla::net {

static Atomic<uint64_t, Relaxed> sChunkWrites(0);
static Atomic<uint64_t, Relaxed> sMetadataWrites(0);
static Atomic<uint64_t, Relaxed> sLegacyBytes(0);
static Atomic<uint64_t, Relaxed> sProjectedBitwiseBytes(0);
static Atomic<uint64_t, Relaxed> sProjectedKnotgraphBytes(0);
static Atomic<uint64_t, Relaxed> sEncryptedWrites(0);

static uint64_t ProjectBitwiseBytes(uint32_t aBytes) {
  return 18ULL + ((uint64_t(aBytes) * 58ULL + 99ULL) / 100ULL);
}

static uint64_t ProjectKnotgraphBytes() { return 54ULL * 8ULL; }

static void RecordWrite(uint32_t aBytes, bool aEncrypted, bool aMetadata) {
  if (aMetadata) {
    sMetadataWrites++;
  } else {
    sChunkWrites++;
  }
  if (aEncrypted) {
    sEncryptedWrites++;
  }
  sLegacyBytes += aBytes;
  sProjectedBitwiseBytes += ProjectBitwiseBytes(aBytes);
  sProjectedKnotgraphBytes += ProjectKnotgraphBytes();
}

void CacheGnosisTelemetry::RecordChunkWrite(uint32_t, uint32_t aBytes,
                                            bool aEncrypted) {
  RecordWrite(aBytes, aEncrypted, false);
}

void CacheGnosisTelemetry::RecordMetadataWrite(uint32_t aBytes,
                                               bool aEncrypted) {
  RecordWrite(aBytes, aEncrypted, true);
}

CacheGnosisSnapshot CacheGnosisTelemetry::Snapshot() {
  return {
      sChunkWrites,
      sMetadataWrites,
      sLegacyBytes,
      sProjectedBitwiseBytes,
      sProjectedKnotgraphBytes,
      sEncryptedWrites,
  };
}

}  // namespace mozilla::net
