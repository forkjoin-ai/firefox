/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_TaskControllerGnosisTelemetry_h
#define mozilla_TaskControllerGnosisTelemetry_h

#include <stdint.h>

namespace mozilla {

struct TaskControllerGnosisSnapshot {
  uint64_t mQueued = 0;
  uint64_t mMainThreadQueued = 0;
  uint64_t mOffMainThreadQueued = 0;
  uint64_t mProtectedQueued = 0;
  uint64_t mSafeLaneCandidates = 0;
  uint64_t mManagedTasks = 0;
  uint64_t mMainThreadSelected = 0;
  uint64_t mSafeLaneSelected = 0;
  uint64_t mProtectedSelected = 0;
  uint64_t mManagedSelected = 0;
  uint64_t mSafeLaneCompleted = 0;
  uint64_t mSafeLaneRequeued = 0;
};

class TaskControllerGnosisTelemetry {
 public:
  static void RecordTaskQueued(uint32_t aPriority, bool aMainThread,
                               bool aManaged);
  static void RecordMainThreadTaskSelected(uint32_t aPriority, bool aManaged);
  static void RecordMainThreadTaskFinished(uint32_t aPriority, bool aComplete);
  static TaskControllerGnosisSnapshot Snapshot();
  static void ResetForTests();

  static bool IsProtectedPriority(uint32_t aPriority);
  static bool IsSafeLaneCandidate(uint32_t aPriority, bool aMainThread);
};

}  // namespace mozilla

#endif  // mozilla_TaskControllerGnosisTelemetry_h
