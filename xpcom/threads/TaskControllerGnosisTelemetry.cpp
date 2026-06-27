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
static Atomic<uint64_t, Relaxed> sMainThreadSelected;
static Atomic<uint64_t, Relaxed> sSafeLaneSelected;
static Atomic<uint64_t, Relaxed> sProtectedSelected;
static Atomic<uint64_t, Relaxed> sManagedSelected;
static Atomic<uint64_t, Relaxed> sSafeLaneCompleted;
static Atomic<uint64_t, Relaxed> sSafeLaneRequeued;
static Atomic<uint64_t, Relaxed> sAdmissionDecisions;
static Atomic<uint64_t, Relaxed> sProtectedAdmitted;
static Atomic<uint64_t, Relaxed> sSafeLaneAdmitted;
static Atomic<uint64_t, Relaxed> sSafeLaneHeld;

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
TaskControllerGnosisAdmission TaskControllerGnosisTelemetry::AdmitMainThreadTask(
    uint32_t aPriority) {
  const bool isProtected = IsProtectedPriority(aPriority);
  const bool isSafeLane = IsSafeLaneCandidate(aPriority, true);

  sAdmissionDecisions++;
  if (isProtected) {
    sProtectedAdmitted++;
  }
  if (isSafeLane) {
    sSafeLaneAdmitted++;
  }

  return {
      true,
      isProtected,
      isSafeLane,
  };
}

/* static */
void TaskControllerGnosisTelemetry::RecordMainThreadTaskSelected(
    uint32_t aPriority, bool aManaged) {
  sMainThreadSelected++;
  if (IsProtectedPriority(aPriority)) {
    sProtectedSelected++;
  }
  if (IsSafeLaneCandidate(aPriority, true)) {
    sSafeLaneSelected++;
  }
  if (aManaged) {
    sManagedSelected++;
  }
}

/* static */
void TaskControllerGnosisTelemetry::RecordMainThreadTaskFinished(
    uint32_t aPriority, bool aComplete) {
  if (!IsSafeLaneCandidate(aPriority, true)) {
    return;
  }
  if (aComplete) {
    sSafeLaneCompleted++;
  } else {
    sSafeLaneRequeued++;
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
      sMainThreadSelected,
      sSafeLaneSelected,
      sProtectedSelected,
      sManagedSelected,
      sSafeLaneCompleted,
      sSafeLaneRequeued,
      sAdmissionDecisions,
      sProtectedAdmitted,
      sSafeLaneAdmitted,
      sSafeLaneHeld,
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
  sMainThreadSelected = 0;
  sSafeLaneSelected = 0;
  sProtectedSelected = 0;
  sManagedSelected = 0;
  sSafeLaneCompleted = 0;
  sSafeLaneRequeued = 0;
  sAdmissionDecisions = 0;
  sProtectedAdmitted = 0;
  sSafeLaneAdmitted = 0;
  sSafeLaneHeld = 0;
}

}  // namespace mozilla
