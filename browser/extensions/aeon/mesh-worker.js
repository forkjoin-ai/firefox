/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Kenoma mesh-worker: when the browser agent is IDLE, the browser joins the
// sovereign skymesh as ambient compute — it claims a pending inference "leg" from
// protocol69, answers it, and folds the answer back into the durable FOIL cache.
// Mirrors workers/cf-browser-fleet's controller loop (the same /protocol69/work
// claim+ack plane and leg-ack shape), but runs in a REAL browser. Background
// script: shares the run.js (browserApi) + browser-agent.js (KENOMA_AGENT) globals.

const KENOMA_MESH = {
  base: "https://skymesh.forkjoin.ai",
  pollMs: 20000,
  // The protocol69 leg-ack contract (must match MeshCacheNodeDO's validators).
  schemaVersion: "gnosis.protocol69.workflow-leg-ack.v1",
  contractId: "gnosis.protocol69.universe-cache.workflow-leg-ack.v1",
  theoremId:
    "Gnosis.AntiqueueNetworkDominance.completed_protocol69_input_ack_records_collection",
  skills: [
    "runInferenceX",
    "runInferenceY",
    "runInferenceTask",
    "computeFibStep",
    "executeGgStatement",
  ],
};

// FNV-1a over the leg identity + answer (mirrors cf-browser-fleet's resultHash).
function kenomaMeshResultHash(work, answerText) {
  const source = [
    work.workflowId || "",
    work.legId || "",
    work.dispatchId || "",
    work.cacheKey || "",
    answerText,
  ].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `kenoma-fleet:fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function kenomaMeshAnswerTokens(answerText) {
  return Array.from(answerText, c => c.charCodeAt(0));
}

function kenomaMeshEmit(event) {
  try {
    globalThis.browser.runtime.sendMessage({ type: "kenoma.mesh.event", event });
  } catch (_) {}
}

// Answer a claimed text-inference leg via the sovereign mesh's OpenAI-compatible
// plane. (Layer 1: route to the mesh; a future layer runs the forward locally.)
async function kenomaMeshAnswer(work) {
  const prompt =
    work.prompt ||
    (work.input && (work.input.prompt || work.input.text)) ||
    "";
  if (!prompt) {
    throw new Error("no prompt in claimed work");
  }
  const model = work.model || "q3";
  const resp = await fetch(`${KENOMA_MESH.base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 64,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    throw new Error(`answer http ${resp.status}`);
  }
  const json = await resp.json();
  const text =
    (json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : "") || "";
  if (!text.trim()) {
    throw new Error("empty mesh answer");
  }
  return text;
}

async function kenomaMeshTick() {
  // Yield to a real browser task: only contribute compute when the agent is idle.
  if (typeof KENOMA_AGENT !== "undefined" && KENOMA_AGENT.running) {
    return;
  }
  const claimResp = await fetch(`${KENOMA_MESH.base}/protocol69/work/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "kenoma-fleet",
      executor: "browserFleet",
      skills: KENOMA_MESH.skills,
    }),
  });
  const claim = await claimResp.json().catch(() => ({}));
  if (claim.status !== "claimed" || !claim.work) {
    return;
  }
  const work = claim.work;
  if (work.executor !== "browserFleet") {
    return;
  }
  kenomaMeshEmit({ kind: "claimed", workKind: work.workKind, cacheKey: work.cacheKey });

  let answerText;
  try {
    answerText = await kenomaMeshAnswer(work);
  } catch (error) {
    // Couldn't answer; let the 60s lease expire so another node re-claims it.
    kenomaMeshEmit({ kind: "skip", error: error && error.message });
    return;
  }

  const legAck = {
    schemaVersion: KENOMA_MESH.schemaVersion,
    contractId: KENOMA_MESH.contractId,
    certificate: work.certificate,
    workflowId: work.workflowId,
    legId: work.legId,
    dispatchId: work.dispatchId,
    cacheKey: work.cacheKey,
    executor: work.executor,
    workKind: work.workKind || "runInferenceX",
    resultHash: kenomaMeshResultHash(work, answerText),
    provenance: "kenoma-browser-fleet:protocol69-lazy-answer",
    theoremId: KENOMA_MESH.theoremId,
    projection:
      (work.leg && work.leg.projection) || (work.frame && work.frame.projection),
    answerText,
    answerTokens: kenomaMeshAnswerTokens(answerText),
  };

  const ackResp = await fetch(`${KENOMA_MESH.base}/protocol69/work/ack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ackKind: "legAck", legAck }),
  });
  const ack = await ackResp.json().catch(() => ({}));
  kenomaMeshEmit({
    kind: ackResp.ok && (ack.ok === true || ack.status === "accepted") ? "folded" : "rejected",
    workKind: work.workKind,
    cacheKey: work.cacheKey,
    error: ack && ack.error,
  });
}

// Opt-in gate. Defaults to ENABLED (the operator asked the browser fleet to join
// the skymesh); set `kenoma.mesh.worker` = { enabled: false } to opt out.
async function kenomaMeshEnabled() {
  try {
    const stored = await globalThis.browser.storage.local.get("kenoma.mesh.worker");
    const cfg = stored["kenoma.mesh.worker"];
    return !cfg || cfg.enabled !== false;
  } catch (_) {
    return true;
  }
}

async function kenomaMeshLoop() {
  if (!(await kenomaMeshEnabled())) {
    return;
  }
  try {
    await kenomaMeshTick();
  } catch (_) {
    // A failed tick is non-fatal; the next interval retries.
  }
}

setInterval(kenomaMeshLoop, KENOMA_MESH.pollMs);
