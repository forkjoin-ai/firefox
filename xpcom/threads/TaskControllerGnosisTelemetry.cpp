/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "TaskControllerGnosisTelemetry.h"

#include "mozilla/Atomics.h"
#include "mozilla/EventQueue.h"

namespace mozilla {

static Atomic<uint64_t, Relaxed> sQueued;
static Atomic<uint64_t, Relaxed> sMainThreadQueued;
static Atomic<uint64_t, Relaxed> sOffMainThreadQueued;
static Atomic<uint64_t, Relaxed> sProtectedQueued;
static Atomic<uint64_t, Relaxed> sSafeLaneCandidates;
static Atomic<uint64_t, Relaxed> sManagedTasks;

/* static */
bool TaskControllerGnosisTelemetry::IsProtectedPriority(uint32_t aPriority) {
  switch (static_cast<EventQueuePriority>(aPriority)) {
    case EventQueuePriority::Control:
    case EventQueuePriority::InputHighest:
    case EventQueuePriority::InputHigh:
    case EventQueuePriority::Vsync:
    case EventQueuePriority::RenderBlocking:
      return true;
    default:
      return false;
  }
}

/* static */
bool TaskControllerGnosisTelemetry::IsSafeLaneCandidate(uint32_t aPriority,
                                                        bool aMainThread) {
  return aMainThread && !IsProtectedPriority(aPriority);
}

/* static */
void TaskControllerGnosisTelemetry::RecordTaskQueued(uint32_t aPriority,
                                                     bool aMainThread,
                                                     bool aManaged) {
  sQueued++;
  if (aMainThread) {
    sMainThreadQueued++;
  } else {
    sOffMainThreadQueued++;
  }
  if (IsProtectedPriority(aPriority)) {
    sProtectedQueued++;
  }
  if (IsSafeLaneCandidate(aPriority, aMainThread)) {
    sSafeLaneCandidates++;
  }
  if (aManaged) {
    sManagedTasks++;
  }
}

/* static */
TaskControllerGnosisSnapshot TaskControllerGnosisTelemetry::Snapshot() {
  return {
      sQueued,
      sMainThreadQueued,
      sOffMainThreadQueued,
      sProtectedQueued,
      sSafeLaneCandidates,
      sManagedTasks,
  };
}

/* static */
void TaskControllerGnosisTelemetry::ResetForTests() {
  sQueued = 0;
  sMainThreadQueued = 0;
  sOffMainThreadQueued = 0;
  sProtectedQueued = 0;
  sSafeLaneCandidates = 0;
  sManagedTasks = 0;
}

}  // namespace mozilla
