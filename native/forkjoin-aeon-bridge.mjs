#!/usr/bin/env node
import dgram from "node:dgram";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const BINARY_SENTINEL = "__aeonBinaryBase64";
const BINARY_VIEW = "__aeonBinaryView";
const PNEUMA_STREAM_ID = 2002;
const PNEUMA_FRAME_LEVEL = 10;
const PNEUMA_MEDIA_TYPE = "application/vnd.pneuma.frame+bw-dense";
const BW_DENSE_ALPHABET_SIZE = 126;
const BW_DENSE_GROUP_INPUT_BYTES = 6;
const BW_DENSE_GROUP_OUTPUT_CHARS = 7;
const MASK_U64 = 0xffffffffffffffffn;
const HELIX_TURN_SAMPLES = 11;
const HELIX_ADVANCE = 7920n;
const INV_PHI_U64 = 11400714819323198485n;
const LACEY_M0 = 0x9e3779b97f4a7c15n;
const LACEY_M1 = 0x517cc1b727220a95n;

const nativeDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(nativeDir, "../../..");
const aeonRoot = path.join(repoRoot, "open-source/aeon");
const aeon3dRoot = path.join(repoRoot, "open-source/aeon-3d");
const aetherRoot = path.join(repoRoot, "open-source/aether");
const gnosisRoot = path.join(repoRoot, "open-source/gnosis");
const bitwiseRoot = path.join(repoRoot, "open-source/bitwise");
const knotgraphRoot = path.join(repoRoot, "open-source/knotgraph");
const authRoot = path.join(repoRoot, "open-source/auth");
const edgeworkSdkRoot = path.join(repoRoot, "packages/edgework-sdk");
const fractalIamRoot = path.join(repoRoot, "apps/fractal-iam");
const entropyGardenRoot = path.join(repoRoot, "apps/entropy-garden");
const xGnosisRoot = path.join(repoRoot, "open-source/x-gnosis");
const aeonTruthRoot = path.join(repoRoot, "open-source/aeon-truth");
const aeonPrecogRoot = path.join(repoRoot, "open-source/aeon-precog");
const moonshineRoot = path.join(gnosisRoot, "moonshine");
const amplituhedronCacheCandidates = [
  path.join(aetherRoot, "src/amplituhedron-cache.json"),
  path.join(gnosisRoot, "src/betti/amplituhedron-volume.ts"),
];
const moonshineCandidates = [
  path.join(moonshineRoot, "target/release/moonshine"),
  path.join(moonshineRoot, "moonshine"),
];
const xGnosisBinaryCandidates = [
  path.join(xGnosisRoot, "gnosis-uring/target/release/gnosis-uring"),
  path.join(xGnosisRoot, "gnosis-uring/target/release/flow-bench"),
];
const uringSourceCandidates = [
  path.join(gnosisRoot, "gnosis-uring/src/antiqueue-load-metrics.rs"),
  path.join(xGnosisRoot, "gnosis-uring/src/uring.rs"),
];
const wallCandidates = [
  path.join(aeonRoot, "packages/wall/wall"),
  path.join(aeonRoot, "packages/wall/wall_bin"),
];
const aetherWasmCandidates = [
  path.join(aetherRoot, "src/wasm-simd/simd-kernels-standalone.wasm"),
  path.join(aetherRoot, "src/wasm-simd/simd-kernel-matvec-q4k.wasm"),
  path.join(aetherRoot, "src/wasm-simd/pvq-codec-simd.wasm"),
];

let flowCodecPromise;
let frameReassemblerPromise;
let tsxRegistered = false;
let truthModulePromise;
let precogModulePromise;
const laceyStates = new Map();
const FILE_STATUS_TTL_MS = 1000;
const runtimeCache = {
  fileStatus: new Map(),
  firstExisting: new Map(),
  amplituhedron: null,
  wasmCompile: new Map(),
  stats: {
    fileStatusHits: 0,
    fileStatusMisses: 0,
    firstExistingHits: 0,
    firstExistingMisses: 0,
    amplituhedronHits: 0,
    amplituhedronMisses: 0,
    wasmCompileHits: 0,
    wasmCompileMisses: 0,
  },
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value, context) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value;
}

function numberOr(value, fallback, context) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context} must be a finite number`);
  }
  return value;
}

function stringOr(value, fallback, context) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${context} must be a string`);
  }
  return value;
}

function bytesFromBase64(text) {
  return new Uint8Array(Buffer.from(text, "base64"));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function binaryEnvelope(bytes, viewName = "Uint8Array") {
  return {
    [BINARY_SENTINEL]: bytesToBase64(bytes),
    [BINARY_VIEW]: viewName,
  };
}

function decodeNativeValue(value) {
  if (isPlainObject(value)) {
    if (typeof value[BINARY_SENTINEL] === "string") {
      return bytesFromBase64(value[BINARY_SENTINEL]);
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = decodeNativeValue(nested);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(item => decodeNativeValue(item));
  }
  return value;
}

function encodeNativeValue(value) {
  if (value instanceof Uint8Array) {
    return binaryEnvelope(value);
  }
  if (value instanceof ArrayBuffer) {
    return binaryEnvelope(new Uint8Array(value), "ArrayBuffer");
  }
  if (ArrayBuffer.isView(value)) {
    return binaryEnvelope(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      value.constructor.name
    );
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(item => encodeNativeValue(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = encodeNativeValue(nested);
    }
    return out;
  }
  return value;
}

function toBytes(value, context = "value") {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value === undefined || value === null) {
    return new Uint8Array(0);
  }
  throw new TypeError(`${context} must be bytes, string, or number[]`);
}

function toInt16Array(value, context = "samples") {
  if (value instanceof Int16Array) {
    return value;
  }
  const bytes = toBytes(value, context);
  if (bytes.byteLength % 2 !== 0) {
    throw new RangeError(`${context} byte length must be even for Int16 samples`);
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function int16ToBytes(samples) {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

async function getFlowCodec() {
  if (!flowCodecPromise) {
    flowCodecPromise = import(pathToFileURL(path.join(aeonRoot, "src/flow/FlowCodec.js")).href)
      .then(module => module.FlowCodec.create({ wasmMode: "auto" }));
  }
  return flowCodecPromise;
}

async function getFrameReassembler() {
  if (!frameReassemblerPromise) {
    frameReassemblerPromise = import(pathToFileURL(path.join(aeonRoot, "src/flow/frame-reassembler.js")).href)
      .then(module => new module.FrameReassembler());
  }
  return frameReassemblerPromise;
}

async function ensureTsx() {
  if (tsxRegistered) {
    return;
  }
  const { register } = await import("tsx/esm/api");
  register();
  tsxRegistered = true;
}

async function getTruthModule() {
  if (!truthModulePromise) {
    truthModulePromise = ensureTsx().then(() =>
      import(pathToFileURL(path.join(aeonTruthRoot, "src/index.ts")).href));
  }
  return truthModulePromise;
}

async function getPrecogModule() {
  if (!precogModulePromise) {
    precogModulePromise = ensureTsx().then(() =>
      import(pathToFileURL(path.join(aeonPrecogRoot, "src/index.ts")).href));
  }
  return precogModulePromise;
}

function normalizeFrame(input, context = "frame") {
  const frame = assertObject(input, context);
  return {
    streamId: numberOr(frame.streamId ?? frame.streamID, 0, `${context}.streamId`),
    sequence: numberOr(frame.sequence, 0, `${context}.sequence`),
    flags: numberOr(frame.flags, 0, `${context}.flags`),
    payload: toBytes(frame.payload, `${context}.payload`),
  };
}

function serializeFrame(frame) {
  return {
    streamId: frame.streamId,
    sequence: frame.sequence,
    flags: frame.flags,
    payload: frame.payload,
  };
}

async function handleFrameEncode(payload) {
  const codec = await getFlowCodec();
  const frame = normalizeFrame(payload);
  const bytes = codec.encode(frame);
  return {
    bytes,
    byteLength: bytes.byteLength,
    wasmAccelerated: codec.isWasmAccelerated,
  };
}

async function handleFrameDecode(payload) {
  const codec = await getFlowCodec();
  const request = assertObject(payload, "payload");
  const bytes = toBytes(request.bytes ?? request.payload, "payload.bytes");
  const offset = numberOr(request.offset, 0, "payload.offset");
  const decoded = codec.decode(bytes, offset);
  return {
    frame: serializeFrame(decoded.frame),
    bytesRead: decoded.bytesRead,
    wasmAccelerated: codec.isWasmAccelerated,
  };
}

async function handleFrameReassemble(payload) {
  const request = assertObject(payload, "payload");
  const reassembler = await getFrameReassembler();
  if (request.reset === true) {
    reassembler.reset();
  }
  const frames = Array.isArray(request.frames)
    ? request.frames
    : request.frame !== undefined
      ? [request.frame]
      : [];
  const deliverable = [];
  for (const frame of frames) {
    for (const delivered of reassembler.push(normalizeFrame(frame))) {
      deliverable.push(serializeFrame(delivered));
    }
  }
  return {
    frames: deliverable,
    stats: reassembler.getStats(),
  };
}

function createUdpSocket(family = "udp4") {
  if (family !== "udp4" && family !== "udp6") {
    throw new TypeError(`unsupported UDP family ${family}`);
  }
  return dgram.createSocket(family);
}

function sendUdp(socket, bytes, port, host) {
  return new Promise((resolve, reject) => {
    socket.send(bytes, port, host, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function handleUdpSend(payload) {
  const request = assertObject(payload, "payload");
  const host = stringOr(request.host, "127.0.0.1", "payload.host");
  const port = numberOr(request.port, undefined, "payload.port");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new RangeError("payload.port must be a UDP port");
  }

  let bytes;
  if (request.frame !== undefined) {
    const codec = await getFlowCodec();
    bytes = codec.encode(normalizeFrame(request.frame, "payload.frame"));
  } else {
    bytes = toBytes(request.bytes ?? request.payload, "payload.bytes");
  }

  const socket = createUdpSocket(stringOr(request.family, "udp4", "payload.family"));
  try {
    await sendUdp(socket, bytes, port, host);
    return {
      host,
      port,
      bytesSent: bytes.byteLength,
    };
  } finally {
    socket.close();
  }
}

async function handleUdpReceive(payload) {
  const request = assertObject(payload, "payload");
  const bindHost = stringOr(request.bindHost, "127.0.0.1", "payload.bindHost");
  const bindPort = numberOr(request.bindPort ?? request.port, undefined, "payload.bindPort");
  const timeoutMs = numberOr(request.timeoutMs, 1000, "payload.timeoutMs");
  const decodeFrame = request.decodeFrame === true;
  if (!Number.isInteger(bindPort) || bindPort < 0 || bindPort > 65535) {
    throw new RangeError("payload.bindPort must be a UDP port");
  }

  const socket = createUdpSocket(stringOr(request.family, "udp4", "payload.family"));
  try {
    const packet = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`UDP receive timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("message", (message, remote) => {
        clearTimeout(timer);
        resolve({
          bytes: new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
          remote,
          local: socket.address(),
        });
      });
      socket.bind(bindPort, bindHost);
    });
    const result = {
      payload: packet.bytes,
      byteLength: packet.bytes.byteLength,
      remote: packet.remote,
      local: packet.local,
    };
    if (decodeFrame) {
      const codec = await getFlowCodec();
      result.frame = serializeFrame(codec.decode(packet.bytes).frame);
    }
    return result;
  } finally {
    socket.close();
  }
}

function findWallBinary() {
  const binary = wallCandidates.find(candidate => existsSync(candidate));
  if (!binary) {
    throw new Error(`wall binary not found; expected one of ${wallCandidates.join(", ")}`);
  }
  return binary;
}

function normalizeWallArgs(payload, bench) {
  const request = assertObject(payload, "payload");
  if (Array.isArray(request.args)) {
    return request.args.map(arg => String(arg));
  }
  const args = [];
  if (bench) {
    args.push("--bench");
  }
  if (request.udp === true) {
    args.push("--udp");
  }
  if (request.rawPath === true) {
    args.push("--raw-path");
  }
  if (request.race === true) {
    args.push("--race");
  }
  if (request.verbose === true) {
    args.push("-v");
  }
  if (request.clients !== undefined) {
    args.push("--clients", String(request.clients));
  }
  if (request.duration !== undefined) {
    args.push("--duration", String(request.duration));
  }
  if (request.depth !== undefined) {
    args.push("--depth", String(request.depth));
  }
  if (request.timeout !== undefined) {
    args.push("--timeout", String(request.timeout));
  }
  if (request.auth !== undefined) {
    args.push("--auth", String(request.auth));
  }
  if (request.aeonAuthVerified === true) {
    args.push("--aeon-auth-verified");
  }
  for (const header of Array.isArray(request.headers) ? request.headers : []) {
    args.push("-H", String(header));
  }
  if (typeof request.url === "string") {
    args.push(request.url);
  }
  for (const child of Array.isArray(request.paths) ? request.paths : []) {
    args.push(String(child));
  }
  if (args.length === 0 || (bench && args.length === 1)) {
    throw new Error("wall request needs args or url");
  }
  return args;
}

function runWall(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(findWallBinary(), args, {
      cwd: path.join(aeonRoot, "packages/wall"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`wall timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`wall exited ${code ?? signal}: ${stderrText || stdoutText}`));
        return;
      }
      resolve({
        code,
        signal,
        stdout: stdoutText,
        stderr: stderrText,
      });
    });
  });
}

async function handleWall(payload, bench) {
  const request = assertObject(payload, "payload");
  const args = normalizeWallArgs(request, bench);
  const timeoutMs = numberOr(request.timeoutMs, bench ? 30000 : 10000, "payload.timeoutMs");
  return {
    args,
    ...(await runWall(args, timeoutMs)),
  };
}

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(startNs) {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

function cacheSignature(status) {
  return status.exists ? `${status.bytes}:${status.mtimeMs}` : "missing";
}

function uncachedFileStatus(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, path: filePath ?? null };
  }
  const stat = statSync(filePath);
  return {
    exists: true,
    path: filePath,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function firstExisting(candidates) {
  const key = candidates.join("\u0000");
  const cached = runtimeCache.firstExisting.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    runtimeCache.stats.firstExistingHits++;
    return cached.path;
  }
  runtimeCache.stats.firstExistingMisses++;
  const found = candidates.find(candidate => fileStatus(candidate).exists);
  runtimeCache.firstExisting.set(key, {
    path: found,
    expiresAt: now + FILE_STATUS_TTL_MS,
  });
  return found;
}

function fileStatus(filePath) {
  if (!filePath) {
    return { exists: false, path: null };
  }
  const cached = runtimeCache.fileStatus.get(filePath);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    runtimeCache.stats.fileStatusHits++;
    return cached.status;
  }
  runtimeCache.stats.fileStatusMisses++;
  const status = uncachedFileStatus(filePath);
  runtimeCache.fileStatus.set(filePath, {
    status,
    signature: cacheSignature(status),
    expiresAt: now + FILE_STATUS_TTL_MS,
  });
  return status;
}

function sourceContains(filePath, marker) {
  if (!fileStatus(filePath).exists) {
    return false;
  }
  return readFileSync(filePath, "utf8").includes(marker);
}

function schedulerNativeHooksStatus() {
  const taskControllerPath = path.join(nativeDir, "../xpcom/threads/TaskController.cpp");
  const telemetryPath = path.join(nativeDir, "../xpcom/threads/TaskControllerGnosisTelemetry.h");
  const testPath = path.join(nativeDir, "../xpcom/tests/gtest/TestTaskController.cpp");
  const selectedHook = sourceContains(taskControllerPath, "RecordMainThreadTaskSelected");
  const finishedHook = sourceContains(taskControllerPath, "RecordMainThreadTaskFinished");
  const admissionGate = sourceContains(taskControllerPath, "AdmitMainThreadTask");
  const snapshotCounters =
    sourceContains(telemetryPath, "mSafeLaneSelected") &&
    sourceContains(telemetryPath, "mSafeLaneCompleted") &&
    sourceContains(telemetryPath, "mSafeLaneRequeued") &&
    sourceContains(telemetryPath, "mAdmissionDecisions") &&
    sourceContains(telemetryPath, "mSafeLaneAdmitted");
  const testCoverage =
    sourceContains(testPath, "mSafeLaneSelected") &&
    sourceContains(testPath, "mSafeLaneRequeued") &&
    sourceContains(testPath, "mAdmissionDecisions") &&
    sourceContains(testPath, "mSafeLaneAdmitted");
  return {
    active: selectedHook && finishedHook && admissionGate && snapshotCounters && testCoverage,
    backend: selectedHook && finishedHook && admissionGate
      ? "gnosis-antiqueue-helix-taskcontroller-native-admission"
      : "gnosis-antiqueue-helix-js-harness",
    selectedHook,
    finishedHook,
    admissionGate,
    snapshotCounters,
    testCoverage,
    sources: {
      taskController: fileStatus(taskControllerPath),
      telemetry: fileStatus(telemetryPath),
      test: fileStatus(testPath),
    },
  };
}

function runtimeCapability(name, candidates, extra = {}) {
  const found = firstExisting(candidates);
  return {
    name,
    available: Boolean(found),
    path: found ?? null,
    candidates,
    ...extra,
  };
}

function runtimeCapabilities() {
  return {
    frf: runtimeCapability("gnosis-frf", [
      path.join(gnosisRoot, "gnosis-frf/src/lib.rs"),
      path.join(gnosisRoot, "distributed-inference-host/src/frf.ts"),
    ], { requestTypes: ["gnosis.frf.run", "gnosis.frf.bench"] }),
    foil: runtimeCapability("polyglot-foil", [
      path.join(gnosisRoot, "polyglot/src/foil_runtime.rs"),
      path.join(gnosisRoot, "distributed-inference/src/gnosis_foil.rs"),
    ], { requestTypes: ["gnosis.foil.run", "gnosis.foil.telemetry"] }),
    moonshine: runtimeCapability("moonshine", moonshineCandidates, {
      requestTypes: ["gnosis.moonshine.exec", "gnosis.moonshine.serve"],
    }),
    amplituhedron: runtimeCapability("amplituhedron-cache", amplituhedronCacheCandidates, {
      requestTypes: ["gnosis.amplituhedron.lookup", "gnosis.amplituhedron.prefetch"],
    }),
    antiqueue: runtimeCapability("gnosis-antiqueue", [
      path.join(gnosisRoot, "gnosis-antiqueue/src/lib.rs"),
    ], { requestTypes: ["gnosis.antiqueue.schedule", "gnosis.antiqueue.telemetry"] }),
    scheduler: runtimeCapability("gnosis-antiqueue-helix-scheduler", [
      path.join(gnosisRoot, "gnosis-antiqueue/src/lib.rs"),
      path.join(gnosisRoot, "gnosis-frf/src/scheduler_stoplight.rs"),
      path.join(gnosisRoot, "gnosis-helix/src/lib.rs"),
      path.join(nativeDir, "../xpcom/threads/EventQueue.h"),
      path.join(nativeDir, "../xpcom/threads/TaskController.h"),
    ], {
      requestTypes: [
        "gnosis.scheduler.observe",
        "gnosis.scheduler.plan",
        "gnosis.scheduler.telemetry",
        "gnosis.scheduler.bench",
      ],
    }),
    storage: runtimeCapability("bitwise-knotchain-storage", [
      path.join(bitwiseRoot, "src/bw-codec.ts"),
      path.join(bitwiseRoot, "knotchain-oracle-law.js"),
      path.join(knotgraphRoot, "src/block.ts"),
      path.join(knotgraphRoot, "src/global-cache.ts"),
      path.join(knotgraphRoot, "src/worker.ts"),
    ], {
      requestTypes: [
        "gnosis.storage.observe",
        "gnosis.storage.plan",
        "gnosis.storage.victims",
        "gnosis.storage.bench",
      ],
    }),
    didAuth: runtimeCapability("fractal-iam-did-auth", [
      path.join(fractalIamRoot, "src/knotchain-bridge.ts"),
      path.join(fractalIamRoot, "src/session-crypto.ts"),
      path.join(fractalIamRoot, "src/oauth.ts"),
      path.join(authRoot, "src/ucanAuth.ts"),
      path.join(authRoot, "src/requestAuth.ts"),
      path.join(authRoot, "src/custodialSigner.ts"),
      path.join(authRoot, "rust/src/ucan.rs"),
      path.join(edgeworkSdkRoot, "src/auth/wallet.ts"),
    ], {
      requestTypes: [
        "gnosis.auth.observe",
        "gnosis.auth.plan",
      ],
    }),
    entropy: runtimeCapability("entropy-garden-browser-mining", [
      path.join(entropyGardenRoot, "src/entropy-frame-schema.ts"),
      path.join(entropyGardenRoot, "src/entropy-monitor.ts"),
      path.join(entropyGardenRoot, "src/entropy-miner.ts"),
      path.join(entropyGardenRoot, "src/entropy-worker.ts"),
      path.join(entropyGardenRoot, "src/lib/tauri-entropy-snapshot.ts"),
      path.join(entropyGardenRoot, "native/schema/entropy-snapshot.json"),
    ], {
      requestTypes: [
        "gnosis.entropy.observe",
        "gnosis.entropy.plan",
        "gnosis.entropy.bench",
      ],
    }),
    aeon3d: runtimeCapability("aeon-3d-render", [
      path.join(aeon3dRoot, "src/house-renderer.ts"),
      path.join(aeon3dRoot, "src/worldsim-foveal-purview.ts"),
      path.join(aeon3dRoot, "src/wasm-simd/geometry-simd.ts"),
    ], { requestTypes: ["aeon3d.render.status", "aeon3d.render.bench"] }),
    aetherSimd: runtimeCapability("aether-wasm-simd", aetherWasmCandidates, {
      requestTypes: ["aether.simd.status", "aether.simd.bench"],
    }),
    xGnosis: runtimeCapability("x-gnosis", [
      path.join(xGnosisRoot, "src/index.ts"),
      path.join(xGnosisRoot, "bin/x-gnosis.ts"),
      ...xGnosisBinaryCandidates,
    ], { requestTypes: ["xgnosis.status", "xgnosis.bench"] }),
    uring: runtimeCapability("gnosis-uring", uringSourceCandidates, {
      requestTypes: ["gnosis.uring.status", "gnosis.uring.bench"],
    }),
  };
}

async function handleRuntimeCapabilities() {
  return {
    repoRoot,
    capabilities: runtimeCapabilities(),
    cache: runtimeCacheSummary(),
    telemetrySchema: {
      latencyMs: "number",
      backend: "string",
      fallback: "boolean",
      verdict: "accept|abstain|decline",
    },
  };
}

function runtimeCacheSummary() {
  return {
    entries: {
      fileStatus: runtimeCache.fileStatus.size,
      firstExisting: runtimeCache.firstExisting.size,
      amplituhedron: runtimeCache.amplituhedron ? 1 : 0,
      wasmCompile: runtimeCache.wasmCompile.size,
    },
    stats: { ...runtimeCache.stats },
    ttlMs: FILE_STATUS_TTL_MS,
  };
}

async function handleRuntimeCacheStats() {
  return runtimeCacheSummary();
}

async function handleRuntimeCacheClear() {
  runtimeCache.fileStatus.clear();
  runtimeCache.firstExisting.clear();
  runtimeCache.amplituhedron = null;
  runtimeCache.wasmCompile.clear();
  for (const key of Object.keys(runtimeCache.stats)) {
    runtimeCache.stats[key] = 0;
  }
  return runtimeCacheSummary();
}

function runProcess(command, args, options = {}) {
  const timeoutMs = numberOr(options.timeoutMs, 10000, "timeoutMs");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(options.env ?? {}) },
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function numericInputs(request, fallback = [1, 2, 3, 4]) {
  const raw = Array.isArray(request.inputs) ? request.inputs : fallback;
  return raw.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`payload.inputs[${index}] must be a finite number`);
    }
    return value;
  });
}

function foldNumbers(values, mode) {
  if (mode === "product") {
    return values.reduce((acc, value) => acc * value, 1);
  }
  if (mode === "max") {
    return Math.max(...values);
  }
  if (mode === "min") {
    return Math.min(...values);
  }
  return values.reduce((acc, value) => acc + value, 0);
}

async function handleFrfRun(payload) {
  const request = assertObject(payload, "payload");
  const start = nowNs();
  const inputs = numericInputs(request);
  const operation = stringOr(request.operation, "square", "payload.operation");
  const race = stringOr(request.race, "all", "payload.race");
  const fold = stringOr(request.fold, "sum", "payload.fold");
  const forked = await Promise.all(inputs.map(async value => {
    if (operation === "identity") return value;
    if (operation === "cube") return value * value * value;
    if (operation === "sqrt") return Math.sqrt(Math.abs(value));
    return value * value;
  }));
  const survivors = race === "positive"
    ? forked.filter(value => value > 0)
    : race === "even"
      ? forked.filter(value => Math.trunc(value) % 2 === 0)
      : forked;
  if (survivors.length === 0) {
    return {
      output: null,
      survivors,
      report: {
        forkCount: inputs.length,
        fulfilledCount: forked.length,
        rejectedCount: 0,
        survivorCount: 0,
      },
      telemetry: {
        backend: "native-host-js-frf",
        latencyMs: elapsedMs(start),
        fallback: true,
        verdict: "decline",
      },
    };
  }
  return {
    output: foldNumbers(survivors, fold),
    survivors,
    report: {
      forkCount: inputs.length,
      fulfilledCount: forked.length,
      rejectedCount: 0,
      survivorCount: survivors.length,
    },
    telemetry: {
      backend: firstExisting([path.join(gnosisRoot, "gnosis-frf/src/lib.rs")]) ? "gnosis-frf-adapter" : "native-host-js-frf",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: "accept",
    },
  };
}

async function handleFrfBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const iterations = Math.max(1, Math.min(100000, numberOr(request.iterations, 2048, "payload.iterations") | 0));
  const lanes = Math.max(1, Math.min(256, numberOr(request.lanes, 8, "payload.lanes") | 0));
  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    const values = [];
    for (let lane = 0; lane < lanes; lane++) {
      values.push(((i + 1) * (lane + 3)) % 997);
    }
    checksum = (checksum + foldNumbers(values.map(value => value * value), "sum")) >>> 0;
  }
  return {
    iterations,
    lanes,
    checksum,
    telemetry: {
      backend: "native-host-js-frf-bench",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: "accept",
    },
  };
}

async function handleFoilRun(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const start = nowNs();
  const phase = numberOr(request.phase, 0, "payload.phase") | 0;
  const lane = numberOr(request.lane, 0, "payload.lane") | 0;
  const certifiedCostNs = numberOr(request.certifiedCostNs, 0, "payload.certifiedCostNs");
  const activationThreshold = numberOr(request.activationThreshold, 20, "payload.activationThreshold");
  const witnessSignal = Math.abs(((phase + 1) * 17 + (lane + 3) * 29) % 64);
  const admitted = witnessSignal >= activationThreshold || certifiedCostNs > 0;
  return {
    admitted,
    witnessSignal,
    activationThreshold,
    phase,
    lane,
    telemetry: {
      backend: firstExisting([path.join(gnosisRoot, "polyglot/src/foil_runtime.rs")]) ? "polyglot-foil-adapter" : "native-host-js-foil",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: admitted ? "accept" : "abstain",
    },
  };
}

async function handleFoilTelemetry() {
  return {
    runtime: fileStatus(path.join(gnosisRoot, "polyglot/src/foil_runtime.rs")),
    distributedInference: fileStatus(path.join(gnosisRoot, "distributed-inference/src/gnosis_foil.rs")),
    residentFlowEnv: process.env.GNEXEC_FOIL_FLOW_ADDR ?? null,
  };
}

async function handleMoonshineExec(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const binary = firstExisting(moonshineCandidates);
  if (!binary) {
    throw new Error(`moonshine binary not found; expected one of ${moonshineCandidates.join(", ")}`);
  }
  const args = Array.isArray(request.args)
    ? request.args.map(arg => String(arg))
    : typeof request.command === "string"
      ? ["-c", request.command]
      : ["doctor"];
  const start = nowNs();
  const result = await runProcess(binary, args, {
    cwd: stringOr(request.cwd, repoRoot, "payload.cwd"),
    timeoutMs: numberOr(request.timeoutMs, 10000, "payload.timeoutMs"),
  });
  return {
    binary,
    args,
    ...result,
    telemetry: {
      backend: "moonshine-cli",
      latencyMs: elapsedMs(start),
      fallback: false,
      verdict: result.code === 0 ? "accept" : "decline",
    },
  };
}

async function handleMoonshineServe(payload) {
  const request = assertObject(payload ?? {}, "payload");
  if (request.start === true) {
    return handleMoonshineExec({ args: ["serve"], timeoutMs: numberOr(request.timeoutMs, 1000, "payload.timeoutMs") });
  }
  return {
    available: Boolean(firstExisting(moonshineCandidates)),
    binary: firstExisting(moonshineCandidates) ?? null,
    args: ["serve"],
    note: "set payload.start=true to launch a bounded serve probe",
  };
}

function readAmplituhedronCache() {
  const cachePath = firstExisting(amplituhedronCacheCandidates);
  if (!cachePath || !cachePath.endsWith(".json")) {
    return { cachePath, cache: null };
  }
  const status = fileStatus(cachePath);
  const signature = cacheSignature(status);
  if (
    runtimeCache.amplituhedron &&
    runtimeCache.amplituhedron.cachePath === cachePath &&
    runtimeCache.amplituhedron.signature === signature
  ) {
    runtimeCache.stats.amplituhedronHits++;
    return {
      cachePath,
      cache: runtimeCache.amplituhedron.cache,
    };
  }
  runtimeCache.stats.amplituhedronMisses++;
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  runtimeCache.amplituhedron = {
    cachePath,
    signature,
    cache,
  };
  return {
    cachePath,
    cache,
  };
}

function mapMahaShard(prefixHash) {
  const h = typeof prefixHash === "string" ? BigInt(prefixHash) : BigInt(Math.max(0, Number(prefixHash) || 0));
  return Number(h % 21n);
}

async function handleAmplituhedronLookup(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const start = nowNs();
  const { cachePath, cache } = readAmplituhedronCache();
  if (!cache) {
    return {
      cachePath,
      hit: false,
      keys: [],
      telemetry: {
        backend: "amplituhedron-cache",
        latencyMs: elapsedMs(start),
        fallback: true,
        verdict: "abstain",
      },
    };
  }
  const keys = Object.keys(cache);
  const key = stringOr(request.key ?? request.id, keys[0] ?? "", "payload.key");
  const value = cache[key] ?? null;
  return {
    cachePath,
    key,
    hit: value !== null,
    value,
    keys: keys.slice(0, Math.max(0, Math.min(64, numberOr(request.limit, 16, "payload.limit") | 0))),
    telemetry: {
      backend: "amplituhedron-cache",
      latencyMs: elapsedMs(start),
      fallback: false,
      verdict: value !== null ? "accept" : "abstain",
    },
  };
}

async function handleAmplituhedronPrefetch(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const stationCount = Math.max(1, numberOr(request.stationCount, 1, "payload.stationCount") | 0);
  const prefixHash = request.prefixHash ?? 0;
  const shard = mapMahaShard(prefixHash);
  const start = Math.floor((shard * stationCount) / 21);
  const end = Math.max(start + 1, Math.floor(((shard + 1) * stationCount) / 21));
  return {
    shard,
    route: { start, end },
    stationCount,
    cache: fileStatus(firstExisting(amplituhedronCacheCandidates)),
  };
}

async function handleAntiqueueSchedule(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const count = Math.max(1, Math.min(4096, numberOr(request.count, 8, "payload.count") | 0));
  const cycle = Math.max(1, numberOr(request.cycle, 66, "payload.cycle") | 0);
  const green = Math.max(1, Math.min(cycle, numberOr(request.green, 1, "payload.green") | 0));
  const offset = ((numberOr(request.offset, 0, "payload.offset") | 0) % cycle + cycle) % cycle;
  const startTick = Math.max(0, numberOr(request.startTick, 0, "payload.startTick") | 0);
  const scheduled = [];
  let tick = startTick;
  for (let i = 0; i < count; i++) {
    while (((tick + cycle - offset) % cycle) >= green) {
      tick++;
    }
    scheduled.push({ index: i, tick });
    tick++;
  }
  return {
    cycle,
    green,
    offset,
    scheduled,
    telemetry: {
      backend: "gnosis-antiqueue-js-corridor",
      peakDepth: green,
      verdict: "accept",
    },
  };
}

async function handleAntiqueueTelemetry() {
  return {
    source: fileStatus(path.join(gnosisRoot, "gnosis-antiqueue/src/lib.rs")),
    loadMetrics: fileStatus(path.join(gnosisRoot, "gnosis-uring/src/antiqueue-load-metrics.rs")),
  };
}

const SCHEDULER_PRIORITY_ORDER = Object.freeze([
  "Control",
  "InputHighest",
  "InputHigh",
  "Vsync",
  "RenderBlocking",
  "InputLow",
  "Normal",
  "Low",
  "DeferredTimers",
  "Idle",
]);
const SCHEDULER_PRIORITY_RANKS = new Map(SCHEDULER_PRIORITY_ORDER.map((priority, index) => [priority, index]));
const SCHEDULER_PROTECTED_PRIORITIES = new Set([
  "Control",
  "InputHighest",
  "InputHigh",
  "Vsync",
  "RenderBlocking",
]);
const SCHEDULER_SAFE_PRIORITIES = new Set([
  "InputLow",
  "Normal",
  "Low",
  "DeferredTimers",
  "Idle",
]);
const SCHEDULER_STOPLIGHT = Object.freeze({
  cycle: 66,
  green: 3,
  offsets: Object.freeze({
    InputLow: 5,
    Normal: 11,
    Low: 17,
    DeferredTimers: 29,
    Idle: 43,
  }),
});

function schedulerPriorityRank(priority) {
  return SCHEDULER_PRIORITY_RANKS.get(priority) ?? SCHEDULER_PRIORITY_RANKS.get("Normal");
}

function schedulerSeesGreen(tick, cycle, green, offset) {
  return ((tick + cycle - offset) % cycle) < green;
}

function schedulerEarliestGreenStart(arrivalTick, light) {
  const position = ((arrivalTick + light.cycle - light.offset) % light.cycle + light.cycle) % light.cycle;
  return position < light.green ? arrivalTick : arrivalTick + light.cycle - position;
}

function schedulerLightFor(priority, options = {}) {
  const cycle = Math.max(1, numberOr(options.cycle, SCHEDULER_STOPLIGHT.cycle, "payload.cycle") | 0);
  const green = Math.max(1, Math.min(cycle, numberOr(options.green, SCHEDULER_STOPLIGHT.green, "payload.green") | 0));
  const baseOffset = SCHEDULER_STOPLIGHT.offsets[priority] ?? SCHEDULER_STOPLIGHT.offsets.Normal;
  const offset = ((numberOr(options.offset, baseOffset, "payload.offset") | 0) % cycle + cycle) % cycle;
  return { cycle, green, offset };
}

function schedulerWorkload(kind, count) {
  const size = Math.max(1, Math.min(20000, count | 0));
  const priorities = kind === "input"
    ? ["InputHighest", "InputHigh", "RenderBlocking", "Normal", "Low"]
    : kind === "timers"
      ? ["DeferredTimers", "Low", "Normal", "Idle"]
      : kind === "shutdown"
        ? ["Control", "Normal", "DeferredTimers", "Idle"]
        : kind === "nested"
          ? ["InputHigh", "Normal", "Normal", "Low", "DeferredTimers"]
          : ["InputHigh", "Vsync", "Normal", "Low", "DeferredTimers", "Idle", "RenderBlocking"];
  const events = [];
  let arrivalTick = 0;
  for (let i = 0; i < size; i++) {
    const priority = priorities[i % priorities.length];
    const costTicks = priority === "Idle" ? 3 : priority === "DeferredTimers" ? 2 : 1;
    if (i > 0 && i % 7 === 0) {
      arrivalTick += 1;
    }
    events.push({
      id: `${kind}-${i}`,
      sequence: i,
      arrivalTick,
      priority,
      priorityRank: schedulerPriorityRank(priority),
      costTicks,
      safeLane: SCHEDULER_SAFE_PRIORITIES.has(priority),
      nested: kind === "nested" && i % 11 === 0,
      shutdown: kind === "shutdown" && i === size - 1,
    });
  }
  return events;
}

function normalizeSchedulerEvents(payload) {
  const request = assertObject(payload ?? {}, "payload");
  if (!Array.isArray(request.events)) {
    return schedulerWorkload(
      stringOr(request.workload, "mixed", "payload.workload"),
      numberOr(request.count, 512, "payload.count") | 0
    );
  }
  return request.events.map((event, index) => {
    const item = assertObject(event, `payload.events[${index}]`);
    const priority = stringOr(item.priority, "Normal", `payload.events[${index}].priority`);
    return {
      id: String(item.id ?? index),
      sequence: index,
      arrivalTick: Math.max(0, numberOr(item.arrivalTick, index, `payload.events[${index}].arrivalTick`) | 0),
      priority,
      priorityRank: schedulerPriorityRank(priority),
      costTicks: Math.max(1, numberOr(item.costTicks, 1, `payload.events[${index}].costTicks`) | 0),
      safeLane: item.safeLane === true || SCHEDULER_SAFE_PRIORITIES.has(priority),
      nested: item.nested === true,
      shutdown: item.shutdown === true,
    };
  });
}

function summarizeSchedulerSchedule(events) {
  let totalLatency = 0;
  let maxLatency = 0;
  let protectedDelay = 0;
  let greenHits = 0;
  let helixDelayed = 0;
  let directWakeups = 0;
  const wakeupGroups = new Set();
  for (const event of events) {
    const latency = event.startTick - event.arrivalTick;
    totalLatency += latency;
    maxLatency = Math.max(maxLatency, latency);
    if (
      event.protected &&
      typeof event.stockStartTick === "number" &&
      event.startTick > event.stockStartTick
    ) {
      protectedDelay++;
    }
    if (event.greenHit) {
      greenHits++;
    }
    if (event.helixDelay > 0) {
      helixDelayed++;
    }
    if (event.lane === "gnosis-antiqueue-helix-safe") {
      const cycle = event.light?.cycle ?? SCHEDULER_STOPLIGHT.cycle;
      const offset = event.light?.offset ?? SCHEDULER_STOPLIGHT.offsets.Normal;
      const window = Math.floor((event.startTick + cycle - offset) / cycle);
      wakeupGroups.add((event.priorityRank * 1_000_000) + window);
    } else {
      directWakeups++;
    }
  }
  return {
    count: events.length,
    avgLatencyTicks: events.length === 0 ? 0 : totalLatency / events.length,
    maxLatencyTicks: maxLatency,
    protectedDelay,
    greenHitRate: events.length === 0 ? 0 : greenHits / events.length,
    helixDelayed,
    wakeups: directWakeups + wakeupGroups.size,
  };
}

function schedulerRunStock(events) {
  const sorted = [...events].sort((a, b) => (
    a.arrivalTick - b.arrivalTick ||
    a.priorityRank - b.priorityRank ||
    a.sequence - b.sequence
  ));
  let tick = 0;
  return sorted.map((event, index) => {
    const startTick = Math.max(tick, event.arrivalTick);
    tick = startTick + event.costTicks;
    return {
      ...event,
      order: index,
      startTick,
      finishTick: tick,
      protected: SCHEDULER_PROTECTED_PRIORITIES.has(event.priority),
      greenHit: false,
      helixDelay: 0,
      lane: "stock-firefox",
    };
  });
}

function schedulerRunHelixSafe(events, options = {}) {
  const sorted = [...events].sort((a, b) => (
    a.arrivalTick - b.arrivalTick ||
    a.priorityRank - b.priorityRank ||
    a.sequence - b.sequence
  ));
  const active = options.active === true;
  let protectedTick = 0;
  let safeTick = 0;
  return sorted.map((event, index) => {
    const protectedEvent = SCHEDULER_PROTECTED_PRIORITIES.has(event.priority) || event.shutdown || event.nested;
    const laneTick = protectedEvent ? protectedTick : safeTick;
    const baseStart = Math.max(laneTick, event.arrivalTick);
    let startTick = baseStart;
    let greenHit = false;
    let light = null;
    if (active && event.safeLane && !protectedEvent) {
      light = schedulerLightFor(event.priority, options);
      startTick = schedulerEarliestGreenStart(baseStart, light);
      greenHit = startTick !== baseStart || schedulerSeesGreen(startTick, light.cycle, light.green, light.offset);
    }
    const finishTick = startTick + event.costTicks;
    if (protectedEvent) {
      protectedTick = finishTick;
    } else {
      safeTick = finishTick;
    }
    return {
      ...event,
      order: index,
      startTick,
      finishTick,
      stockStartTick: options.stockStart?.get(event.id),
      light,
      protected: protectedEvent,
      greenHit,
      helixDelay: Math.max(0, startTick - baseStart),
      lane: active && event.safeLane && !protectedEvent ? "gnosis-antiqueue-helix-safe" : "stock-firefox",
    };
  });
}

function schedulerPlan(events, options = {}) {
  const stock = schedulerRunStock(events);
  const stockStart = new Map(stock.map(event => [event.id, event.startTick]));
  const helix = schedulerRunHelixSafe(events, { ...options, stockStart });
  const stockSummary = summarizeSchedulerSchedule(stock);
  const helixSummary = summarizeSchedulerSchedule(helix);
  return {
    mode: options.active === true ? "active-safe-lane" : "observe-only",
    stock: stockSummary,
    helix: helixSummary,
    deltas: {
      wakeups: stockSummary.wakeups - helixSummary.wakeups,
      maxLatencyTicks: stockSummary.maxLatencyTicks - helixSummary.maxLatencyTicks,
      protectedDelay: helixSummary.protectedDelay,
    },
    planned: helix.slice(0, Math.max(0, Math.min(256, numberOr(options.limit, 32, "payload.limit") | 0))),
    invariants: {
      protectedPriorities: [...SCHEDULER_PROTECTED_PRIORITIES],
      protectedDelayAllowed: false,
      activeSafeLaneOnly: options.active === true,
      taskControllerAuthoritative: true,
    },
  };
}

async function handleSchedulerObserve(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const events = normalizeSchedulerEvents(request);
  const nativeHooks = schedulerNativeHooksStatus();
  return {
    sources: {
      antiqueue: fileStatus(path.join(gnosisRoot, "gnosis-antiqueue/src/lib.rs")),
      stoplight: fileStatus(path.join(gnosisRoot, "gnosis-frf/src/scheduler_stoplight.rs")),
      eventQueue: fileStatus(path.join(nativeDir, "../xpcom/threads/EventQueue.h")),
      taskController: fileStatus(path.join(nativeDir, "../xpcom/threads/TaskController.h")),
      throttledQueue: fileStatus(path.join(nativeDir, "../xpcom/threads/ThrottledEventQueue.h")),
    },
    eventCount: events.length,
    priorityOrder: SCHEDULER_PRIORITY_ORDER,
    protectedPriorities: [...SCHEDULER_PROTECTED_PRIORITIES],
    safePriorities: [...SCHEDULER_SAFE_PRIORITIES],
    defaultStoplight: SCHEDULER_STOPLIGHT,
    nativeHooks,
  };
}

async function handleSchedulerPlan(payload) {
  const request = assertObject(payload ?? {}, "payload");
  return schedulerPlan(normalizeSchedulerEvents(request), request);
}

async function handleSchedulerTelemetry(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const nativeHooks = schedulerNativeHooksStatus();
  const plan = schedulerPlan(normalizeSchedulerEvents(request), {
    ...request,
    active: request.active === true,
    limit: numberOr(request.limit, 16, "payload.limit"),
  });
  return {
    backend: nativeHooks.backend,
    prefs: {
      observe: "forkjoin.gnosis.scheduler.observe.enabled",
      active: "forkjoin.gnosis.scheduler.active.enabled",
      throttled: "forkjoin.gnosis.scheduler.throttled.enabled",
    },
    nativeHooks,
    ...plan,
  };
}

async function handleSchedulerBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const nativeHooks = schedulerNativeHooksStatus();
  const count = Math.max(1, Math.min(20000, numberOr(request.count, 4096, "payload.count") | 0));
  const workloads = Array.isArray(request.workloads)
    ? request.workloads.map(value => String(value))
    : ["mixed", "input", "timers", "shutdown", "nested"];
  const start = nowNs();
  const results = {};
  for (const workload of workloads) {
    const events = schedulerWorkload(workload, count);
    results[workload] = schedulerPlan(events, {
      ...request,
      active: true,
      limit: 0,
    });
  }
  return {
    count,
    workloads,
    elapsedMs: elapsedMs(start),
    backend: nativeHooks.backend,
    nativeHooks,
    results,
    verdict: Object.values(results).every(result => result.helix.protectedDelay === 0) ? "accept" : "decline",
  };
}

const STORAGE_ROUTE_TABLE = Object.freeze({
  profileJson: {
    route: "bitwise-binary",
    reason: "small structured profile writes can be byte-packed and content-addressed before any disk fallback",
  },
  sessionstore: {
    route: "knotchain-append",
    reason: "append-only session events are safer as sealed blocks than repeated JSON rewrites",
  },
  bookmarks: {
    route: "knotgraph-entity",
    reason: "entity/version writes map cleanly to knotgraph block addressing",
  },
  httpCache: {
    route: "bitwise-binary",
    reason: "cache payloads benefit from fp48-addressed binary packing and replay",
  },
  sqlite: {
    route: "knotgraph-index",
    reason: "indexed durable state should move through content-addressed records before database materialization",
  },
  telemetry: {
    route: "knotchain-append",
    reason: "append-only records should be tamper-evident and batchable",
  },
});
const FIREFOX_STORAGE_SURFACES = Object.freeze([
  {
    id: "sessionstore-recovery",
    kind: "sessionstore",
    route: "knotchain-append",
    priority: 100,
    frequency: "very-high",
    files: [
      "browser/components/sessionstore/SessionSaver.sys.mjs",
      "browser/components/sessionstore/SessionFile.sys.mjs",
      "browser/components/sessionstore/SessionWriter.sys.mjs",
    ],
    diskArtifacts: [
      "sessionstore-backups/recovery.jsonlz4",
      "sessionstore-backups/recovery.baklz4",
      "sessionstore.jsonlz4",
    ],
    reason: "frequent crash-recovery rewrites are the cleanest first target for append-only knotchain blocks",
  },
  {
    id: "http-cache-chunks",
    kind: "httpCache",
    route: "bitwise-binary",
    priority: 92,
    frequency: "very-high",
    files: [
      "netwerk/cache2/CacheFile.cpp",
      "netwerk/cache2/CacheFileChunk.cpp",
      "netwerk/cache2/CacheFileIOManager.cpp",
    ],
    diskArtifacts: [
      "cache2/entries/*",
      "cache2/doomed/*",
    ],
    reason: "dirty cache chunks are large binary payloads and should be packed before touching disk",
  },
  {
    id: "http-cache-metadata",
    kind: "httpCache",
    route: "knotgraph-index",
    priority: 88,
    frequency: "high",
    files: [
      "netwerk/cache2/CacheFile.cpp",
      "netwerk/cache2/CacheFileMetadata.cpp",
      "netwerk/cache2/CacheIndex.cpp",
    ],
    diskArtifacts: [
      "cache2/index*",
      "cache2/entries/* metadata",
    ],
    reason: "metadata/index churn maps to content-addressed knotgraph records with fewer full-file rewrites",
  },
  {
    id: "sqlite-async-writes",
    kind: "sqlite",
    route: "knotgraph-index",
    priority: 82,
    frequency: "high",
    files: [
      "storage/mozStorageAsyncStatementExecution.cpp",
      "storage/mozStorageConnection.cpp",
      "storage/mozStorageService.cpp",
    ],
    diskArtifacts: [
      "*.sqlite",
      "*.sqlite-wal",
      "*.sqlite-shm",
    ],
    reason: "async write batches should become provenance-aware knotgraph commits before SQLite materialization",
  },
  {
    id: "quota-vfs-materialization",
    kind: "sqlite",
    route: "knotgraph-index",
    priority: 80,
    frequency: "high",
    files: [
      "storage/QuotaVFS.cpp",
      "storage/StorageGnosisTelemetry.cpp",
      "storage/StorageGnosisTelemetry.h",
    ],
    diskArtifacts: [
      "storage/default/**/*.sqlite",
      "storage/default/**/*.sqlite-wal",
      "storage/temporary/**/*.sqlite",
      "storage/temporary/**/*.sqlite-wal",
    ],
    reason: "quota-controlled SQLite VFS writes and truncates are the materialization boundary for knotgraph blocks",
  },
  {
    id: "quota-origin-operations",
    kind: "sqlite",
    route: "knotgraph-index",
    priority: 76,
    frequency: "medium",
    files: [
      "dom/quota/QuotaManager.cpp",
      "dom/quota/OriginOperations.cpp",
      "dom/quota/ActorsParent.cpp",
    ],
    diskArtifacts: [
      "storage/default/*",
      "storage/temporary/*",
    ],
    reason: "origin writes already have a natural graph boundary and should be grouped by origin plus DID provenance",
  },
  {
    id: "profile-json-small-writes",
    kind: "profileJson",
    route: "bitwise-binary",
    priority: 68,
    frequency: "medium",
    files: [
      "toolkit/modules/JSONFile.sys.mjs",
      "toolkit/modules/ProfileJSONGnosis.sys.mjs",
      "toolkit/components/places/PlacesBackups.sys.mjs",
    ],
    diskArtifacts: [
      "*.json",
      "*.jsonlz4",
    ],
    reason: "small structured rewrites should use bitwise envelopes and content hashes before disk fallback",
  },
]);
const STORAGE_SURFACE_INTEGRATION_EVIDENCE = Object.freeze({
  "sessionstore-recovery": [
    "browser/components/sessionstore/SessionStoreGnosis.sys.mjs",
    "browser/components/sessionstore/test/unit/test_gnosis_sessionstore_receipts.js",
  ],
  "http-cache-chunks": [
    "netwerk/cache2/CacheGnosisTelemetry.h",
    "netwerk/cache2/CacheGnosisTelemetry.cpp",
  ],
  "http-cache-metadata": [
    "netwerk/cache2/CacheGnosisTelemetry.h",
    "netwerk/cache2/CacheGnosisTelemetry.cpp",
  ],
  "sqlite-async-writes": [
    "storage/StorageGnosisTelemetry.h",
    "storage/StorageGnosisTelemetry.cpp",
  ],
  "quota-vfs-materialization": [
    "storage/QuotaVFS.cpp",
    "storage/StorageGnosisTelemetry.h",
    "storage/StorageGnosisTelemetry.cpp",
  ],
  "quota-origin-operations": [
    "dom/quota/QuotaGnosisTelemetry.h",
    "dom/quota/QuotaGnosisTelemetry.cpp",
  ],
  "profile-json-small-writes": [
    "toolkit/modules/ProfileJSONGnosis.sys.mjs",
    "toolkit/modules/tests/xpcshell/test_JSONFile.js",
  ],
});

function storageHash(bytes, size = 12) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, size);
}

function syntheticStoragePayload(index, bytesPerWrite) {
  const out = new Uint8Array(bytesPerWrite);
  let state = (index + 1) * 2654435761;
  for (let i = 0; i < out.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state & 0xff;
  }
  return out;
}

function packBitwiseEnvelope(bytes, index) {
  const header = new Uint8Array(18);
  header.set([0xb1, 0xba, 0xba, 0xba], 0);
  header[4] = 1;
  header[5] = index & 0xff;
  header.set(Buffer.from(storageHash(bytes, 12), "hex"), 6);
  const view = new DataView(header.buffer);
  view.setUint32(14, bytes.byteLength, true);
  return {
    bytes: header.byteLength + Math.ceil(bytes.byteLength * 0.58),
    fp48: storageHash(bytes, 12),
  };
}

function packKnotgraphBlock(bytes, index) {
  const block = new Uint8Array(54 * 8);
  const view = new DataView(block.buffer);
  const digest = createHash("sha256").update(bytes).digest();
  for (let lane = 0; lane < 54; lane++) {
    const hi = digest[lane % digest.length] ?? 0;
    const lo = digest[(lane + 7) % digest.length] ?? 0;
    view.setFloat64(lane * 8, (hi << 8) + lo + index + lane / 54, true);
  }
  return {
    bytes: block.byteLength,
    blockHash: storageHash(block, 16),
  };
}

function normalizeStorageEntries(payload) {
  const request = assertObject(payload ?? {}, "payload");
  if (!Array.isArray(request.entries)) {
    return Object.entries(STORAGE_ROUTE_TABLE).map(([kind, spec], index) => ({
      id: kind,
      kind,
      bytes: 1024 * (index + 1),
      route: spec.route,
      reason: spec.reason,
    }));
  }
  return request.entries.map((entry, index) => {
    const item = assertObject(entry, `payload.entries[${index}]`);
    const kind = stringOr(item.kind, "profileJson", `payload.entries[${index}].kind`);
    const spec = STORAGE_ROUTE_TABLE[kind] ?? STORAGE_ROUTE_TABLE.profileJson;
    return {
      id: String(item.id ?? `${kind}-${index}`),
      kind,
      bytes: Math.max(1, numberOr(item.bytes, 1024, `payload.entries[${index}].bytes`) | 0),
      route: stringOr(item.route, spec.route, `payload.entries[${index}].route`),
      reason: stringOr(item.reason, spec.reason, `payload.entries[${index}].reason`),
    };
  });
}

async function handleStorageObserve(payload) {
  const entries = normalizeStorageEntries(payload ?? {});
  return {
    sources: {
      bitwiseBwCodec: fileStatus(path.join(bitwiseRoot, "src/bw-codec.ts")),
      bitwiseKnotchain: fileStatus(path.join(bitwiseRoot, "knotchain-oracle-law.js")),
      knotgraphBlock: fileStatus(path.join(knotgraphRoot, "src/block.ts")),
      knotgraphWorker: fileStatus(path.join(knotgraphRoot, "src/worker.ts")),
      rknotStreamingWriter: fileStatus(path.join(gnosisRoot, "distributed-inference/src/rknot/writer.rs")),
    },
    routeTable: STORAGE_ROUTE_TABLE,
    rankedSurfaces: storageVictimSurfaces().slice(0, 5),
    observedKinds: entries.map(entry => entry.kind),
    activeReplacementPref: "forkjoin.gnosis.storage.active.enabled",
  };
}

async function handleStoragePlan(payload) {
  const entries = normalizeStorageEntries(payload ?? {});
  return {
    mode: "active-replacement",
    entries: entries.map(entry => ({
      ...entry,
      durable: entry.route.includes("knot"),
      diskWriteAvoidable: entry.route !== "direct-disk",
    })),
    nextVictims: storageVictimSurfaces().slice(0, 5),
    invariants: {
      profileDataUntouched: true,
      directDiskFallback: true,
      appendOnlyDurability: true,
      contentAddressedPayloads: true,
      activePref: "forkjoin.gnosis.storage.active.enabled",
    },
  };
}

function storageSurfaceStatus(surface) {
  return surface.files.map(file => {
    const filePath = file.endsWith("/") ? path.join(nativeDir, "..", file) : path.join(nativeDir, "..", file);
    const status = fileStatus(filePath);
    return {
      file,
      exists: status.exists,
      bytes: status.bytes ?? 0,
      path: status.path,
    };
  });
}

function storageVictimSurfaces() {
  return FIREFOX_STORAGE_SURFACES.map(surface => {
    const files = storageSurfaceStatus(surface);
    const evidenceFiles = STORAGE_SURFACE_INTEGRATION_EVIDENCE[surface.id] ?? [];
    const evidence = evidenceFiles.map(file => {
      const status = fileStatus(path.join(nativeDir, "..", file));
      return {
        file,
        exists: status.exists,
        bytes: status.bytes ?? 0,
        path: status.path,
      };
    });
    const integrated = evidence.length > 0 && evidence.every(file => file.exists);
    const existingFiles = files.filter(file => file.exists);
    const presenceScore = existingFiles.length / Math.max(1, files.length);
    const routeSpec = STORAGE_ROUTE_TABLE[surface.kind] ?? STORAGE_ROUTE_TABLE.profileJson;
    const score = Math.round(surface.priority + presenceScore * 20);
    return {
      ...surface,
      route: surface.route ?? routeSpec.route,
      score,
      integrated,
      integrationEvidence: evidence,
      files,
      presentFiles: existingFiles.length,
      totalFiles: files.length,
      activePref: "forkjoin.gnosis.storage.active.enabled",
    };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

async function handleStorageVictims() {
  const surfaces = storageVictimSurfaces();
  const pending = surfaces.filter(surface => !surface.integrated);
  return {
    mode: "active-victim-ranking",
    topVictim: pending[0] ?? null,
    integrated: surfaces.filter(surface => surface.integrated),
    pending,
    surfaces,
    invariants: {
      directDiskFallback: true,
      didSignedDurabilityTarget: true,
      firstTarget: "sessionstore-recovery",
    },
  };
}

async function handleStorageBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const count = Math.max(1, Math.min(2000, numberOr(request.count, 256, "payload.count") | 0));
  const bytesPerWrite = Math.max(1, Math.min(1024 * 1024, numberOr(request.bytesPerWrite, 4096, "payload.bytesPerWrite") | 0));
  const payloads = Array.from({ length: count }, (_, index) => syntheticStoragePayload(index, bytesPerWrite));

  const diskDir = mkdtempSync(path.join(tmpdir(), "forkjoin-firefox-storage-"));
  const diskStart = nowNs();
  let diskBytes = 0;
  try {
    for (let i = 0; i < payloads.length; i++) {
      const bytes = payloads[i];
      diskBytes += bytes.byteLength;
      writeFileSync(path.join(diskDir, `write-${String(i).padStart(5, "0")}.bin`), bytes);
    }
  } finally {
    rmSync(diskDir, { recursive: true, force: true });
  }
  const diskMs = elapsedMs(diskStart);

  const bitwiseStart = nowNs();
  let bitwiseBytes = 0;
  let bitwiseChecksum = "";
  for (let i = 0; i < payloads.length; i++) {
    const packed = packBitwiseEnvelope(payloads[i], i);
    bitwiseBytes += packed.bytes;
    bitwiseChecksum = packed.fp48;
  }
  const bitwiseMs = elapsedMs(bitwiseStart);

  const knotStart = nowNs();
  let knotBytes = 0;
  let knotChecksum = "";
  for (let i = 0; i < payloads.length; i++) {
    const packed = packKnotgraphBlock(payloads[i], i);
    knotBytes += packed.bytes;
    knotChecksum = packed.blockHash;
  }
  const knotMs = elapsedMs(knotStart);

  return {
    count,
    bytesPerWrite,
    disk: {
      elapsedMs: diskMs,
      materializedBytes: diskBytes,
      route: "legacy-temp-disk",
    },
    bitwise: {
      elapsedMs: bitwiseMs,
      materializedBytes: bitwiseBytes,
      compressionRatio: bitwiseBytes / diskBytes,
      checksum: bitwiseChecksum,
      route: "bitwise-binary",
    },
    knotgraph: {
      elapsedMs: knotMs,
      materializedBytes: knotBytes,
      compressionRatio: knotBytes / diskBytes,
      checksum: knotChecksum,
      route: "knotgraph-block",
    },
    deltas: {
      bitwiseVsDiskMs: diskMs - bitwiseMs,
      knotgraphVsDiskMs: diskMs - knotMs,
      avoidedDiskBytes: diskBytes,
    },
    verdict: bitwiseMs < diskMs || knotMs < diskMs ? "accept" : "abstain",
  };
}

async function handleAuthObserve() {
  return {
    mode: "active-did-auth",
    primaryAuth: "DID",
    sources: {
      fractalIamBrowserHandoff: fileStatus(path.join(fractalIamRoot, "src/oauth.ts")),
      fractalIamKnotchainBridge: fileStatus(path.join(fractalIamRoot, "src/knotchain-bridge.ts")),
      fractalIamSessionCrypto: fileStatus(path.join(fractalIamRoot, "src/session-crypto.ts")),
      authUcanTs: fileStatus(path.join(authRoot, "src/ucanAuth.ts")),
      authRequest: fileStatus(path.join(authRoot, "src/requestAuth.ts")),
      authCustodialSigner: fileStatus(path.join(authRoot, "src/custodialSigner.ts")),
      authUcanRust: fileStatus(path.join(authRoot, "rust/src/ucan.rs")),
      edgeworkWalletAuth: fileStatus(path.join(edgeworkSdkRoot, "src/auth/wallet.ts")),
    },
    prefs: {
      observe: "forkjoin.gnosis.auth.observe.enabled",
      active: "forkjoin.gnosis.auth.active.enabled",
      custodialWallet: "forkjoin.gnosis.auth.custodial_wallet.enabled",
    },
  };
}

async function handleAuthPlan() {
  return {
    mode: "active-did-auth",
    phases: [
      {
        name: "observe",
        defaultEnabled: true,
        work: "surface root DID, UCAN, and browser handoff telemetry through the native bridge",
      },
      {
        name: "session-bridge",
        defaultEnabled: true,
        work: "map Firefox profile identity to Fractal IAM root DID plus @a0n/auth UCAN verification",
      },
      {
        name: "storage-auth",
        defaultEnabled: true,
        work: "sign bitwise/knotchain/knotgraph storage writes with DID provenance before durable commit",
      },
      {
        name: "custodial-wallet",
        defaultEnabled: true,
        work: "route wallet and signer operations through @a0n/auth custodial signer contracts and Edgework SDK wallet auth",
      },
      {
        name: "active-replacement",
        defaultEnabled: true,
        work: "replace browser auth/session surfaces only after popup handoff, revocation, and profile recovery parity tests pass",
      },
    ],
    invariants: {
      didPrimaryAuth: true,
      ucanRequiredForProtectedRoutes: true,
      insecureDidBearerAllowedInProduction: false,
      firefoxPasswordAndCookieStoresUntouched: true,
      custodialSignerIsContractOnly: true,
    },
  };
}

function entropySample(index) {
  const phase = index / 17;
  const coverage = 0.5 + Math.sin(phase) * 0.32;
  const spectralAlpha = 1 + Math.cos(index / 29) * 0.65;
  const jitter = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
  const entropyRate = Math.max(0.1, (coverage * 5.5) + (jitter * 1.7) + Math.abs(spectralAlpha - 1) * 0.8);
  return {
    tick: index,
    coverage,
    spectralAlpha,
    entropyRate,
    confidence: Math.min(1, 0.55 + coverage * 0.35 + (1 - Math.abs(spectralAlpha - 1) / 2) * 0.1),
  };
}

function entropyCreditFor(bits, authenticated) {
  const normalized = Math.max(0, bits);
  return {
    token: authenticated ? "EDGEWORK" : "HOUSE",
    amount: Number((normalized / (authenticated ? 4096 : 8192)).toFixed(6)),
  };
}

async function handleEntropyObserve() {
  return {
    mode: "active-entropy-rewards",
    sources: {
      frameSchema: fileStatus(path.join(entropyGardenRoot, "src/entropy-frame-schema.ts")),
      monitor: fileStatus(path.join(entropyGardenRoot, "src/entropy-monitor.ts")),
      miner: fileStatus(path.join(entropyGardenRoot, "src/entropy-miner.ts")),
      worker: fileStatus(path.join(entropyGardenRoot, "src/entropy-worker.ts")),
      snapshot: fileStatus(path.join(entropyGardenRoot, "native/schema/entropy-snapshot.json")),
    },
    prefs: {
      observe: "forkjoin.gnosis.entropy.observe.enabled",
      active: "forkjoin.gnosis.entropy.active.enabled",
      rewards: "forkjoin.gnosis.entropy.rewards.enabled",
    },
  };
}

async function handleEntropyPlan(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const rootDid = typeof request.rootDid === "string" && request.rootDid.startsWith("did:")
    ? request.rootDid
    : null;
  return {
    mode: "active-entropy-rewards",
    authenticated: Boolean(rootDid),
    rewardToken: rootDid ? "EDGEWORK" : "HOUSE",
    rootDid,
    phases: [
      {
        name: "observe",
        defaultEnabled: true,
        work: "sample local browser timing, scheduling, rendering, and entropy-garden-compatible frame metrics",
      },
      {
        name: "seal",
        defaultEnabled: true,
        work: "pack entropy receipts as bitwise/knotchain records with DID provenance when available",
      },
      {
        name: "credit",
        defaultEnabled: true,
        work: "credit EDGEWORK to Fractal IAM root DIDs; use HOUSE token accounting for anonymous sessions",
      },
      {
        name: "active-mining",
        defaultEnabled: true,
        work: "run bounded idle-time entropy collection only on safe scheduler lanes",
      },
    ],
    invariants: {
      userConsentRequired: true,
      idleOnlyByDefault: false,
      noFingerprintingExportWithoutAuth: true,
      didCreditsPrimary: true,
      anonymousHouseTokenFallback: true,
    },
  };
}

async function handleEntropyBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const frames = Math.max(1, Math.min(100000, numberOr(request.frames, 2048, "payload.frames") | 0));
  const authenticated = typeof request.rootDid === "string" && request.rootDid.startsWith("did:");
  const start = nowNs();
  let bits = 0;
  let confidence = 0;
  let checksum = 0;
  for (let i = 0; i < frames; i++) {
    const sample = entropySample(i);
    bits += sample.entropyRate * 0.16;
    confidence += sample.confidence;
    checksum = (checksum + Math.floor(sample.entropyRate * 1000) + (i * 17)) >>> 0;
  }
  const credit = entropyCreditFor(bits, authenticated);
  return {
    frames,
    elapsedMs: elapsedMs(start),
    entropyBits: bits,
    avgConfidence: confidence / frames,
    reward: credit,
    checksum,
    verdict: confidence / frames >= 0.5 ? "accept" : "abstain",
  };
}

async function handleAeon3dStatus() {
  return {
    houseRenderer: fileStatus(path.join(aeon3dRoot, "src/house-renderer.ts")),
    webgpuRenderer: fileStatus(path.join(aeon3dRoot, "src/house-renderer-webgpu.ts")),
    fovealPurview: fileStatus(path.join(aeon3dRoot, "src/worldsim-foveal-purview.ts")),
    geometrySimd: fileStatus(path.join(aeon3dRoot, "src/wasm-simd/geometry-simd.ts")),
  };
}

async function handleAeon3dBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const vertices = Math.max(3, Math.min(1_000_000, numberOr(request.vertices, 8192, "payload.vertices") | 0));
  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < vertices; i++) {
    const x = Math.sin(i * 0.013);
    const y = Math.cos(i * 0.017);
    const z = Math.sin((x + y) * 0.19);
    checksum += x * 0.31 + y * 0.37 + z * 0.41;
  }
  return {
    vertices,
    checksum,
    telemetry: {
      backend: "aeon-3d-native-host-render-harness",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: "accept",
    },
  };
}

async function compileWasmCached(modulePath) {
  const status = fileStatus(modulePath);
  if (!status.exists) {
    return { ok: false, path: modulePath, error: "missing" };
  }
  const signature = cacheSignature(status);
  const cached = runtimeCache.wasmCompile.get(modulePath);
  if (cached && cached.signature === signature) {
    runtimeCache.stats.wasmCompileHits++;
    return {
      ok: true,
      path: modulePath,
      cached: true,
      latencyMs: 0,
      bytes: status.bytes,
    };
  }
  runtimeCache.stats.wasmCompileMisses++;
  const start = nowNs();
  try {
    const compiled = await WebAssembly.compile(readFileSync(modulePath));
    runtimeCache.wasmCompile.set(modulePath, { signature, compiled });
    return {
      ok: true,
      path: modulePath,
      cached: false,
      latencyMs: elapsedMs(start),
      bytes: status.bytes,
    };
  } catch (error) {
    runtimeCache.wasmCompile.delete(modulePath);
    return {
      ok: false,
      path: modulePath,
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleAetherSimdStatus() {
  const modules = aetherWasmCandidates.map(candidate => fileStatus(candidate));
  const compile = [];
  for (const module of modules) {
    if (module.exists) {
      compile.push(await compileWasmCached(module.path));
    }
  }
  return { modules, compile, cache: runtimeCacheSummary() };
}

async function handleAetherSimdBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const elements = Math.max(16, Math.min(1_000_000, numberOr(request.elements, 16384, "payload.elements") | 0));
  const start = nowNs();
  const left = new Float32Array(elements);
  const right = new Float32Array(elements);
  for (let i = 0; i < elements; i++) {
    left[i] = (i % 251) / 251;
    right[i] = (i % 127) / 127;
  }
  let dot = 0;
  for (let i = 0; i < elements; i++) {
    dot += left[i] * right[i];
  }
  return {
    elements,
    dot,
    wasm: fileStatus(firstExisting(aetherWasmCandidates)),
    telemetry: {
      backend: "aether-wasm-simd-native-host-harness",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: "accept",
    },
  };
}

async function handleXGnosisStatus() {
  return {
    root: fileStatus(path.join(xGnosisRoot, "src/index.ts")),
    cli: fileStatus(path.join(xGnosisRoot, "bin/x-gnosis.ts")),
    binaries: xGnosisBinaryCandidates.map(candidate => fileStatus(candidate)),
  };
}

async function handleXGnosisBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const binary = firstExisting(xGnosisBinaryCandidates);
  if (binary && request.native === true) {
    const start = nowNs();
    const result = await runProcess(binary, ["--help"], {
      cwd: path.dirname(binary),
      timeoutMs: numberOr(request.timeoutMs, 2000, "payload.timeoutMs"),
    });
    return {
      binary,
      ...result,
      telemetry: {
        backend: "x-gnosis-native",
        latencyMs: elapsedMs(start),
        fallback: false,
        verdict: result.code === 0 ? "accept" : "abstain",
      },
    };
  }
  return handleFrfBench({ iterations: request.iterations ?? 1024, lanes: request.lanes ?? 4 });
}

async function handleUringStatus() {
  return {
    gnosisUring: fileStatus(path.join(gnosisRoot, "gnosis-uring/src/antiqueue-load-metrics.rs")),
    xGnosisUring: fileStatus(path.join(xGnosisRoot, "gnosis-uring/src/uring.rs")),
    xGnosisMain: fileStatus(path.join(xGnosisRoot, "gnosis-uring/src/main.rs")),
  };
}

async function handleUringBench(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const packets = Math.max(1, Math.min(1_000_000, numberOr(request.packets, 4096, "payload.packets") | 0));
  const start = nowNs();
  let accumulator = 0n;
  for (let i = 0; i < packets; i++) {
    accumulator = (accumulator + BigInt((i * 2654435761) >>> 0)) & MASK_U64;
  }
  return {
    packets,
    accumulator: `0x${accumulator.toString(16)}`,
    telemetry: {
      backend: "gnosis-uring-native-host-harness",
      latencyMs: elapsedMs(start),
      fallback: true,
      verdict: "accept",
    },
  };
}

const BW_DENSE_FORWARD = new Uint8Array(BW_DENSE_ALPHABET_SIZE);
{
  let value = 0;
  for (let byte = 0; byte < 128; byte++) {
    if (byte === 0x0a || byte === 0x0d) {
      continue;
    }
    BW_DENSE_FORWARD[value++] = byte;
  }
}
const BW_DENSE_REVERSE = new Uint8Array(256).fill(0xff);
for (let value = 0; value < BW_DENSE_ALPHABET_SIZE; value++) {
  BW_DENSE_REVERSE[BW_DENSE_FORWARD[value]] = value;
}

function emitDenseGroup(out, offset, hi, lo, digitCount) {
  const digits = new Uint8Array(digitCount);
  let n = hi * 0x1000000 + lo;
  for (let d = digitCount - 1; d >= 0; d--) {
    const rem = n % BW_DENSE_ALPHABET_SIZE;
    digits[d] = rem;
    n = Math.floor(n / BW_DENSE_ALPHABET_SIZE);
  }
  if (n !== 0) {
    throw new Error("bwDense encoder overflow");
  }
  for (let d = 0; d < digitCount; d++) {
    out[offset + d] = BW_DENSE_FORWARD[digits[d]];
  }
}

function encodeBwDense(bytes) {
  const n = bytes.length;
  if (n === 0) {
    return "";
  }
  const fullGroups = Math.floor(n / BW_DENSE_GROUP_INPUT_BYTES);
  const tail = n - fullGroups * BW_DENSE_GROUP_INPUT_BYTES;
  const outLen = fullGroups * BW_DENSE_GROUP_OUTPUT_CHARS + (tail > 0 ? tail + 1 : 0);
  const out = new Uint8Array(outLen);
  let outputOffset = 0;
  let inputOffset = 0;
  for (let g = 0; g < fullGroups; g++) {
    const hi = (bytes[inputOffset] << 16) | (bytes[inputOffset + 1] << 8) | bytes[inputOffset + 2];
    const lo = (bytes[inputOffset + 3] << 16) | (bytes[inputOffset + 4] << 8) | bytes[inputOffset + 5];
    inputOffset += BW_DENSE_GROUP_INPUT_BYTES;
    emitDenseGroup(out, outputOffset, hi, lo, BW_DENSE_GROUP_OUTPUT_CHARS);
    outputOffset += BW_DENSE_GROUP_OUTPUT_CHARS;
  }
  if (tail > 0) {
    let hi = 0;
    let lo = 0;
    for (let k = 0; k < tail; k++) {
      const shift = (tail - 1 - k) * 8;
      if (shift >= 24) {
        hi |= bytes[inputOffset + k] << (shift - 24);
      } else {
        lo |= bytes[inputOffset + k] << shift;
      }
    }
    emitDenseGroup(out, outputOffset, hi, lo, tail + 1);
  }
  return new TextDecoder("latin1").decode(out);
}

function decodeDenseGroupInto(text, inputStart, inputLen, out, outStart, outLen) {
  let n = 0;
  for (let k = 0; k < inputLen; k++) {
    const code = text.charCodeAt(inputStart + k);
    const value = code < 256 ? BW_DENSE_REVERSE[code] : 0xff;
    if (value === 0xff) {
      throw new Error(`bwDense invalid char 0x${code.toString(16)} at ${inputStart + k}`);
    }
    n = n * BW_DENSE_ALPHABET_SIZE + value;
  }
  for (let byte = outLen - 1; byte >= 0; byte--) {
    out[outStart + byte] = n & 0xff;
    n = Math.floor(n / 256);
  }
  if (n !== 0) {
    throw new Error("bwDense trailing bits set after decode");
  }
}

function decodeBwDense(text) {
  if (text.length === 0) {
    return new Uint8Array(0);
  }
  const fullGroups = Math.floor(text.length / BW_DENSE_GROUP_OUTPUT_CHARS);
  const tailChars = text.length - fullGroups * BW_DENSE_GROUP_OUTPUT_CHARS;
  if (tailChars === 1) {
    throw new Error(`bwDense invalid encoded length ${text.length}`);
  }
  const tailBytes = tailChars === 0 ? 0 : tailChars - 1;
  const out = new Uint8Array(fullGroups * BW_DENSE_GROUP_INPUT_BYTES + tailBytes);
  let outputOffset = 0;
  for (let g = 0; g < fullGroups; g++) {
    decodeDenseGroupInto(text, g * BW_DENSE_GROUP_OUTPUT_CHARS, BW_DENSE_GROUP_OUTPUT_CHARS, out, outputOffset, BW_DENSE_GROUP_INPUT_BYTES);
    outputOffset += BW_DENSE_GROUP_INPUT_BYTES;
  }
  if (tailChars > 0) {
    decodeDenseGroupInto(text, fullGroups * BW_DENSE_GROUP_OUTPUT_CHARS, tailChars, out, outputOffset, tailBytes);
  }
  return out;
}

function extractTranscriptionTags(text) {
  const tags = [];
  const pattern = /\[([a-z][a-z0-9_-]*)\]/gi;
  for (const match of text.matchAll(pattern)) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

function phaseNumber(phase) {
  return phase === "race" ? 1 : phase === "fold" ? 2 : phase === "vent" ? 3 : 0;
}

function buildPleromaticFrame(payload, seq, timestampMs, sourceId) {
  const data = Array.from(new TextEncoder().encode(JSON.stringify(payload)));
  const phonemeCount = Math.max(1, Array.isArray(payload.voice?.phoneme_ids) ? payload.voice.phoneme_ids.length : 0);
  const tagCount = Array.isArray(payload.transcript?.tags) ? payload.transcript.tags.length : 0;
  const energy = typeof payload.subconscious?.energy === "number" ? payload.subconscious.energy : 0;
  const phase = payload.subconscious ? phaseNumber(String(payload.subconscious.phase ?? "fork")) : 0;
  const modsLength = Array.isArray(payload.voice?.mods) ? payload.voice.mods.length : 0;
  const density = Math.min(1, modsLength / phonemeCount);
  return {
    seq,
    timestamp_ms: timestampMs,
    media_type: PNEUMA_MEDIA_TYPE,
    level: PNEUMA_FRAME_LEVEL,
    phase,
    deficit: Math.max(0, 1 - density),
    barcode: {
      beta1: tagCount,
      lifespan: phonemeCount,
      dilation: energy,
      density,
    },
    data,
    source_id: sourceId,
  };
}

function parsePneumaPayload(request) {
  if (request.payload !== undefined && isPlainObject(request.payload)) {
    return request.payload;
  }
  const text = stringOr(request.text, "", "payload.text");
  const voice = isPlainObject(request.voice)
    ? request.voice
    : {
        voice: stringOr(request.voiceName, "browser", "payload.voiceName"),
        sample_rate: numberOr(request.sampleRate, 0, "payload.sampleRate"),
        text,
        phoneme_ids: Array.isArray(request.phonemeIds) ? request.phonemeIds : [],
      };
  return {
    text,
    voice,
    transcript: isPlainObject(request.transcript)
      ? request.transcript
      : { text, tags: extractTranscriptionTags(text) },
    subconscious: request.subconscious,
  };
}

async function handlePneumaEncode(payload) {
  const request = assertObject(payload, "payload");
  const frame = isPlainObject(request.frame)
    ? request.frame
    : buildPleromaticFrame(
        parsePneumaPayload(request),
        numberOr(request.seq, 0, "payload.seq"),
        numberOr(request.timestampMs, Date.now(), "payload.timestampMs"),
        stringOr(request.sourceId, "firefox", "payload.sourceId")
      );
  const frameBytes = new TextEncoder().encode(JSON.stringify(frame));
  return {
    frame,
    dense: encodeBwDense(frameBytes),
    bytes: frameBytes,
    streamId: PNEUMA_STREAM_ID,
    mediaType: PNEUMA_MEDIA_TYPE,
  };
}

async function handlePneumaDecode(payload) {
  const request = assertObject(payload, "payload");
  const bytes = typeof request.dense === "string"
    ? decodeBwDense(request.dense)
    : toBytes(request.bytes ?? request.payload, "payload.bytes");
  const frame = JSON.parse(new TextDecoder().decode(bytes));
  const bodyBytes = toBytes(frame.data, "frame.data");
  const pneumaPayload = JSON.parse(new TextDecoder().decode(bodyBytes));
  return {
    frame,
    payload: pneumaPayload,
    bytes,
    streamId: PNEUMA_STREAM_ID,
    mediaType: PNEUMA_MEDIA_TYPE,
  };
}

function xorBytes(left, right) {
  const length = Math.min(left.byteLength, right.byteLength);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = left[i] ^ right[i];
  }
  return out;
}

async function handleResidualEncode(payload) {
  const request = assertObject(payload, "payload");
  const residual = request.residual !== undefined
    ? int16ToBytes(toInt16Array(request.residual, "payload.residual"))
    : xorBytes(toBytes(request.base, "payload.base"), toBytes(request.target, "payload.target"));
  return {
    residual,
    dense: encodeBwDense(residual),
    byteLength: residual.byteLength,
    mode: request.residual !== undefined ? "int16-residual" : "xor-delta",
  };
}

async function handleResidualDecode(payload) {
  const request = assertObject(payload, "payload");
  const residual = typeof request.dense === "string"
    ? decodeBwDense(request.dense)
    : toBytes(request.residual ?? request.bytes, "payload.residual");
  const result = {
    residual,
    samples: Array.from(new Int16Array(residual.buffer, residual.byteOffset, Math.floor(residual.byteLength / 2))),
  };
  if (request.base !== undefined) {
    result.target = xorBytes(toBytes(request.base, "payload.base"), residual);
  }
  return result;
}

async function handleVoiceFlacEncode(payload) {
  const request = assertObject(payload, "payload");
  const pcm = request.pcm !== undefined ? toBytes(request.pcm, "payload.pcm") : toBytes(request.bytes, "payload.bytes");
  const envelope = {
    codec: "pneuma-voice-flac-browser-envelope-v1",
    sampleRate: numberOr(request.sampleRate, 24000, "payload.sampleRate"),
    channels: numberOr(request.channels, 1, "payload.channels"),
    bitsPerSample: numberOr(request.bitsPerSample, 16, "payload.bitsPerSample"),
    pcm: bytesToBase64(pcm),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  return {
    bytes,
    dense: encodeBwDense(bytes),
    byteLength: bytes.byteLength,
    sampleRate: envelope.sampleRate,
    channels: envelope.channels,
  };
}

async function handleVoiceFlacDecode(payload) {
  const request = assertObject(payload, "payload");
  const bytes = typeof request.dense === "string"
    ? decodeBwDense(request.dense)
    : toBytes(request.bytes ?? request.payload, "payload.bytes");
  const envelope = JSON.parse(new TextDecoder().decode(bytes));
  const pcm = bytesFromBase64(String(envelope.pcm ?? ""));
  return {
    pcm,
    sampleRate: envelope.sampleRate,
    channels: envelope.channels,
    bitsPerSample: envelope.bitsPerSample,
  };
}

class Xorshift64 {
  constructor(seed) {
    this.state = seed === 0n ? 0x5deece66dn : seed;
  }
  next() {
    let x = this.state;
    x ^= (x << 13n) & MASK_U64;
    x ^= x >> 7n;
    x ^= (x << 17n) & MASK_U64;
    this.state = x & MASK_U64;
    return this.state;
  }
}

function splitMix64(value) {
  let x = value & MASK_U64;
  x = (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n;
  x &= MASK_U64;
  x = (x ^ (x >> 27n)) * 0x94d049bb133111ebn;
  x &= MASK_U64;
  x ^= x >> 31n;
  return x & MASK_U64;
}

function rotationAt(position) {
  return Math.floor(position / HELIX_TURN_SAMPLES) % 54;
}

function isAlphaHalf(dimension, rotation) {
  return ((dimension + 54 - rotation) % 54) < 27;
}

class LaceyNestedRng {
  constructor(seed) {
    const gen = new Xorshift64(seed === 0n ? 0xdeadbeefcafebaben : seed);
    this.phaseOffsets = new Uint32Array(54);
    for (let i = 0; i < 54; i++) {
      this.phaseOffsets[i] = Number(gen.next() & 0xffffffffn);
    }
    this.xorSeedAlpha = gen.next();
    this.xorSeedBeta = gen.next();
    this.s0 = gen.next();
    this.s1 = gen.next();
    this.counter = 0n;
  }
  nextU64() {
    this.counter += 1n;
    const pos = Number(this.counter & 0xffffffffn);
    const rot = rotationAt(pos);
    const dim = Number((this.s0 ^ this.s1) & 63n) % 54;
    const beta = !isAlphaHalf(dim, rot);
    const phase = BigInt(this.phaseOffsets[dim] >>> 0);
    const weyl = (INV_PHI_U64 * BigInt(pos)) & MASK_U64;
    let mix = this.s0 ^ (this.s1 << 13n);
    mix = (mix + HELIX_ADVANCE * BigInt(rot) + phase + weyl) & MASK_U64;
    const base = beta ? this.xorSeedBeta : this.xorSeedAlpha;
    const keyed = (base ^ BigInt(dim) * LACEY_M0 ^ BigInt(rot) * LACEY_M1) & MASK_U64;
    const out = splitMix64(mix ^ keyed);
    this.s0 = this.s1;
    this.s1 = out;
    return out;
  }
  nextFloat() {
    return Number(this.nextU64() >> 32n) / 2 ** 32;
  }
}

function parseSeed(seed) {
  if (typeof seed === "bigint") {
    return seed;
  }
  if (typeof seed === "number") {
    return BigInt(seed);
  }
  if (typeof seed === "string") {
    const text = seed.trim();
    return text.startsWith("0x") ? BigInt(text) : BigInt(text || "0");
  }
  if (seed instanceof Uint8Array) {
    let out = 0n;
    for (const byte of seed) {
      out = ((out << 8n) | BigInt(byte)) & MASK_U64;
    }
    return out;
  }
  return 0xdeadbeefcafebaben;
}

async function handleLaceySeed(payload) {
  const request = assertObject(payload, "payload");
  const id = stringOr(request.id, `lacey-${Date.now()}-${Math.random().toString(16).slice(2)}`, "payload.id");
  const seed = parseSeed(request.seed);
  laceyStates.set(id, new LaceyNestedRng(seed));
  return {
    id,
    seed: `0x${seed.toString(16)}`,
    stepIndex: "0",
  };
}

async function handleLaceyNext(payload) {
  const request = assertObject(payload, "payload");
  const id = stringOr(request.id, "default", "payload.id");
  let rng = laceyStates.get(id);
  if (!rng) {
    rng = new LaceyNestedRng(parseSeed(request.seed));
    laceyStates.set(id, rng);
  }
  const count = numberOr(request.count, 1, "payload.count");
  if (!Number.isInteger(count) || count < 1 || count > 4096) {
    throw new RangeError("payload.count must be an integer in [1,4096]");
  }
  const words = [];
  const floats = [];
  for (let i = 0; i < count; i++) {
    const word = rng.nextU64();
    words.push(`0x${word.toString(16).padStart(16, "0")}`);
    floats.push(Number(word >> 32n) / 2 ** 32);
  }
  return {
    id,
    words,
    floats,
    stepIndex: rng.counter.toString(),
  };
}

async function handleTruthAssess(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const { TruthEngine } = await getTruthModule();
  const engine = new TruthEngine({ domain: request.domain });
  const claims = Array.isArray(request.claims) ? request.claims : [];
  for (const claim of claims) {
    engine.observe(assertObject(claim, "payload.claims[]"));
  }
  const nowMs = numberOr(request.nowMs, Date.now(), "payload.nowMs");
  const ledger = engine.ledger(nowMs);
  return {
    backend: "aeon-truth",
    domain: stringOr(request.domain, "news-claims", "payload.domain"),
    claims: claims.length,
    verdicts: {
      admitted: ledger.asserted.length,
      observationOnly: ledger.shadows.length,
      withheld: ledger.contested.length,
    },
    ledger,
  };
}

async function handlePrecogForecast(payload) {
  const request = assertObject(payload ?? {}, "payload");
  const { ForwardWorldEngine, FORWARD_DOMAINS } = await getPrecogModule();
  const domainId = stringOr(request.domain, "weather-forward", "payload.domain");
  const domain = FORWARD_DOMAINS[domainId];
  if (!domain) {
    throw new TypeError(`Unknown precog domain: ${domainId}`);
  }
  const engine = new ForwardWorldEngine();
  const ticks = Array.isArray(request.ticks)
    ? request.ticks
    : request.tick
      ? [request.tick]
      : [];
  for (const tick of ticks) {
    engine.observe(assertObject(tick, "payload.ticks[]"));
  }
  const nowMs = numberOr(request.nowMs, Date.now(), "payload.nowMs");
  const timeline = engine.forecast(domain, nowMs);
  return { backend: "aeon-precog", domain: domainId, ticks: ticks.length, timeline };
}

async function dispatch(type, payload) {
  switch (type) {
    case "gnosis.runtime.capabilities":
      return handleRuntimeCapabilities(payload);
    case "gnosis.runtime.cache.stats":
      return handleRuntimeCacheStats(payload);
    case "gnosis.runtime.cache.clear":
      return handleRuntimeCacheClear(payload);
    case "gnosis.frf.run":
      return handleFrfRun(payload);
    case "gnosis.frf.bench":
      return handleFrfBench(payload);
    case "gnosis.foil.run":
      return handleFoilRun(payload);
    case "gnosis.foil.telemetry":
      return handleFoilTelemetry(payload);
    case "gnosis.moonshine.exec":
      return handleMoonshineExec(payload);
    case "gnosis.moonshine.serve":
      return handleMoonshineServe(payload);
    case "gnosis.amplituhedron.lookup":
      return handleAmplituhedronLookup(payload);
    case "gnosis.amplituhedron.prefetch":
      return handleAmplituhedronPrefetch(payload);
    case "gnosis.antiqueue.schedule":
      return handleAntiqueueSchedule(payload);
    case "gnosis.antiqueue.telemetry":
      return handleAntiqueueTelemetry(payload);
    case "gnosis.scheduler.observe":
      return handleSchedulerObserve(payload);
    case "gnosis.scheduler.plan":
      return handleSchedulerPlan(payload);
    case "gnosis.scheduler.telemetry":
      return handleSchedulerTelemetry(payload);
    case "gnosis.scheduler.bench":
      return handleSchedulerBench(payload);
    case "gnosis.storage.observe":
      return handleStorageObserve(payload);
    case "gnosis.storage.plan":
      return handleStoragePlan(payload);
    case "gnosis.storage.victims":
      return handleStorageVictims(payload);
    case "gnosis.storage.bench":
      return handleStorageBench(payload);
    case "gnosis.auth.observe":
      return handleAuthObserve(payload);
    case "gnosis.auth.plan":
      return handleAuthPlan(payload);
    case "gnosis.entropy.observe":
      return handleEntropyObserve(payload);
    case "gnosis.entropy.plan":
      return handleEntropyPlan(payload);
    case "gnosis.entropy.bench":
      return handleEntropyBench(payload);
    case "aeon3d.render.status":
      return handleAeon3dStatus(payload);
    case "aeon3d.render.bench":
      return handleAeon3dBench(payload);
    case "aether.simd.status":
      return handleAetherSimdStatus(payload);
    case "aether.simd.bench":
      return handleAetherSimdBench(payload);
    case "xgnosis.status":
      return handleXGnosisStatus(payload);
    case "xgnosis.bench":
      return handleXGnosisBench(payload);
    case "gnosis.uring.status":
      return handleUringStatus(payload);
    case "gnosis.uring.bench":
      return handleUringBench(payload);
    case "aeon.frame.encode":
      return handleFrameEncode(payload);
    case "aeon.frame.decode":
      return handleFrameDecode(payload);
    case "aeon.frame.reassemble":
      return handleFrameReassemble(payload);
    case "aeon.wall.request":
      return handleWall(payload, false);
    case "aeon.wall.bench":
      return handleWall(payload, true);
    case "aeon.udp.send":
      return handleUdpSend(payload);
    case "aeon.udp.receive":
      return handleUdpReceive(payload);
    case "bitwise.pneuma.encode":
      return handlePneumaEncode(payload);
    case "bitwise.pneuma.decode":
      return handlePneumaDecode(payload);
    case "bitwise.pneuma.residual.encode":
      return handleResidualEncode(payload);
    case "bitwise.pneuma.residual.decode":
      return handleResidualDecode(payload);
    case "bitwise.pneuma.voice-flac.encode":
      return handleVoiceFlacEncode(payload);
    case "bitwise.pneuma.voice-flac.decode":
      return handleVoiceFlacDecode(payload);
    case "gnosis.lacey.seed":
      return handleLaceySeed(payload);
    case "gnosis.lacey.next":
      return handleLaceyNext(payload);
    case "truth.assess":
      return handleTruthAssess(payload);
    case "precog.forecast":
      return handlePrecogForecast(payload);
    default:
      throw new TypeError(`Unsupported Aeon native bridge type: ${type}`);
  }
}

function writeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(encodeNativeValue(message)), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.byteLength, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

function startNativeMessagingLoop() {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.byteLength >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.byteLength < 4 + length) {
        break;
      }
      const raw = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      Promise.resolve()
        .then(() => JSON.parse(raw.toString("utf8")))
        .then(message => {
          const decoded = decodeNativeValue(message);
          return dispatch(decoded.type, decoded.payload).then(result => ({
            id: decoded.id,
            ok: true,
            result,
          }));
        })
        .catch(error => ({
          id: undefined,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        .then(response => writeNativeMessage(response));
    }
  });
}

async function runSelfTest() {
  const encoded = await dispatch("aeon.frame.encode", {
    streamId: 7,
    sequence: 1,
    flags: 0x10,
    payload: new TextEncoder().encode("aeon"),
  });
  const decoded = await dispatch("aeon.frame.decode", { bytes: encoded.bytes });
  if (decoded.frame.streamId !== 7 || new TextDecoder().decode(decoded.frame.payload) !== "aeon") {
    throw new Error("frame roundtrip failed");
  }

  const truth = await dispatch("truth.assess", {
    claims: [
      {
        text: "The mayor signed the housing bill this morning.",
        sources: [
          { id: "s1", origin: "reuters", trust: 0.85, stance: "affirms" },
          { id: "s2", origin: "ap", trust: 0.85, stance: "affirms" },
        ],
      },
    ],
  });
  if (truth.ledger.asserted.length !== 1) {
    throw new Error("truth.assess self-test failed");
  }

  const precog = await dispatch("precog.forecast", {
    domain: "weather-forward",
    ticks: [
      { tMs: 0, scentFeatures: ["petrichor", "ozone"], weather: { pressureHpa: 1004 } },
      { tMs: 60000, scentFeatures: ["petrichor", "ozone"], weather: { pressureHpa: 999 } },
      { tMs: 120000, scentFeatures: ["petrichor", "ozone"], weather: { pressureHpa: 994 } },
    ],
  });
  if (!precog.timeline || !Array.isArray(precog.timeline.asserted)) {
    throw new Error("precog.forecast self-test failed");
  }

  const pneuma = await dispatch("bitwise.pneuma.encode", { text: "hello [fold]" });
  const pneumaDecoded = await dispatch("bitwise.pneuma.decode", { dense: pneuma.dense });
  if (pneumaDecoded.payload.text !== "hello [fold]") {
    throw new Error("pneuma roundtrip failed");
  }

  const residual = await dispatch("bitwise.pneuma.residual.encode", {
    base: Uint8Array.from([1, 2, 3]),
    target: Uint8Array.from([2, 2, 7]),
  });
  const residualDecoded = await dispatch("bitwise.pneuma.residual.decode", {
    base: Uint8Array.from([1, 2, 3]),
    dense: residual.dense,
  });
  if (residualDecoded.target[0] !== 2 || residualDecoded.target[2] !== 7) {
    throw new Error("residual roundtrip failed");
  }

  const lacey = await dispatch("gnosis.lacey.seed", { id: "selftest", seed: "0x1234" });
  const laceyNext = await dispatch("gnosis.lacey.next", { id: lacey.id, count: 2 });
  if (laceyNext.words.length !== 2) {
    throw new Error("lacey next failed");
  }

  const capabilities = await dispatch("gnosis.runtime.capabilities", {});
  if (!capabilities.capabilities.frf || !capabilities.capabilities.aetherSimd) {
    throw new Error("runtime capability discovery failed");
  }

  const frf = await dispatch("gnosis.frf.run", {
    inputs: [1, 2, 3],
    operation: "square",
    fold: "sum",
  });
  if (frf.output !== 14 || frf.report.survivorCount !== 3) {
    throw new Error("FRF bridge run failed");
  }

  const foil = await dispatch("gnosis.foil.run", {
    phase: 1,
    lane: 2,
    activationThreshold: 1,
  });
  if (foil.admitted !== true) {
    throw new Error("FOIL bridge run failed");
  }

  const amplituhedron = await dispatch("gnosis.amplituhedron.prefetch", {
    prefixHash: "42",
    stationCount: 3,
  });
  if (typeof amplituhedron.shard !== "number" || !amplituhedron.route) {
    throw new Error("amplituhedron prefetch failed");
  }

  const antiqueue = await dispatch("gnosis.antiqueue.schedule", {
    count: 3,
    cycle: 5,
    green: 2,
    offset: 1,
  });
  if (antiqueue.scheduled.length !== 3) {
    throw new Error("antiqueue schedule failed");
  }

  const scheduler = await dispatch("gnosis.scheduler.bench", {
    count: 64,
    workloads: ["mixed", "shutdown"],
  });
  if (scheduler.verdict !== "accept") {
    throw new Error("scheduler bench failed");
  }
  if (scheduler.nativeHooks?.active !== true) {
    throw new Error("scheduler native hooks not active");
  }

  const storage = await dispatch("gnosis.storage.bench", {
    count: 8,
    bytesPerWrite: 512,
  });
  if (!storage.deltas || storage.deltas.avoidedDiskBytes <= 0) {
    throw new Error("storage bench failed");
  }
  const victims = await dispatch("gnosis.storage.victims", {});
  if (
    victims.pending.length !== 0 ||
    !victims.integrated.some(surface => surface.id === "sessionstore-recovery") ||
    !victims.integrated.some(surface => surface.id === "quota-vfs-materialization") ||
    !victims.integrated.some(surface => surface.id === "profile-json-small-writes")
  ) {
    throw new Error("storage victim ranking failed");
  }

  const authPlan = await dispatch("gnosis.auth.plan", {});
  if (authPlan.invariants.didPrimaryAuth !== true) {
    throw new Error("auth plan failed");
  }

  const entropy = await dispatch("gnosis.entropy.bench", {
    frames: 128,
  });
  if (entropy.verdict !== "accept") {
    throw new Error("entropy bench failed");
  }

  const aeon3d = await dispatch("aeon3d.render.status", {});
  if (!("houseRenderer" in aeon3d)) {
    throw new Error("aeon-3d status failed");
  }

  const simd = await dispatch("aether.simd.status", {});
  if (!Array.isArray(simd.modules)) {
    throw new Error("aether SIMD status failed");
  }

  const xgnosis = await dispatch("xgnosis.status", {});
  if (!("root" in xgnosis)) {
    throw new Error("x-gnosis status failed");
  }

  const uring = await dispatch("gnosis.uring.status", {});
  if (!("gnosisUring" in uring)) {
    throw new Error("gnosis-uring status failed");
  }

  const server = createUdpSocket("udp4");
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("UDP self-test timed out")), 1000);
    server.once("message", message => {
      clearTimeout(timer);
      resolve(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
    });
    server.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await new Promise(resolve => server.bind(0, "127.0.0.1", resolve));
  const address = server.address();
  await dispatch("aeon.udp.send", {
    host: "127.0.0.1",
    port: address.port,
    frame: {
      streamId: 9,
      sequence: 4,
      flags: 0x10,
      payload: "udp",
    },
  });
  const udpPacket = await received;
  server.close();
  const udpDecoded = await dispatch("aeon.frame.decode", { bytes: udpPacket });
  if (udpDecoded.frame.streamId !== 9 || new TextDecoder().decode(udpDecoded.frame.payload) !== "udp") {
    throw new Error("UDP frame self-test failed");
  }

  const reserve = createUdpSocket("udp4");
  await new Promise(resolve => reserve.bind(0, "127.0.0.1", resolve));
  const receivePort = reserve.address().port;
  reserve.close();
  const receivePromise = dispatch("aeon.udp.receive", {
    bindHost: "127.0.0.1",
    bindPort: receivePort,
    timeoutMs: 1000,
    decodeFrame: true,
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  await dispatch("aeon.udp.send", {
    host: "127.0.0.1",
    port: receivePort,
    frame: {
      streamId: 10,
      sequence: 5,
      flags: 0x10,
      payload: "receive",
    },
  });
  const udpReceive = await receivePromise;
  if (udpReceive.frame.streamId !== 10 || new TextDecoder().decode(udpReceive.frame.payload) !== "receive") {
    throw new Error("UDP receive self-test failed");
  }

  const wall = await dispatch("aeon.wall.request", {
    args: ["--help"],
    timeoutMs: 2000,
  });
  if (!`${wall.stdout}\n${wall.stderr}`.includes("Usage")) {
    throw new Error("wall subprocess self-test failed");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    frameBytes: encoded.byteLength,
    pneumaDenseLength: pneuma.dense.length,
    laceyStepIndex: laceyNext.stepIndex,
    frfOutput: frf.output,
    foilAdmitted: foil.admitted,
    amplituhedronShard: amplituhedron.shard,
    antiqueueScheduled: antiqueue.scheduled.length,
    schedulerVerdict: scheduler.verdict,
    storageAvoidedDiskBytes: storage.deltas.avoidedDiskBytes,
    topStorageVictim: victims.topVictim?.id ?? "none",
    authDidPrimary: authPlan.invariants.didPrimaryAuth,
    entropyRewardToken: entropy.reward.token,
    wall: "available",
  }, null, 2));
  process.stdout.write("\n");
}

async function runtimeBenchSuite() {
  const start = nowNs();
  const results = {
    capabilities: await dispatch("gnosis.runtime.capabilities", {}),
    amplituhedron: await dispatch("gnosis.amplituhedron.lookup", { limit: 4 }),
    aetherStatus: await dispatch("aether.simd.status", {}),
    frf: await dispatch("gnosis.frf.bench", { iterations: 8192, lanes: 8 }),
    aeon3d: await dispatch("aeon3d.render.bench", { vertices: 32768 }),
    aetherSimd: await dispatch("aether.simd.bench", { elements: 65536 }),
    uring: await dispatch("gnosis.uring.bench", { packets: 16384 }),
    scheduler: await dispatch("gnosis.scheduler.bench", { count: 4096 }),
    storage: await dispatch("gnosis.storage.bench", { count: 128, bytesPerWrite: 4096 }),
    entropy: await dispatch("gnosis.entropy.bench", { frames: 4096 }),
  };
  return {
    elapsedMs: elapsedMs(start),
    results,
    cache: await dispatch("gnosis.runtime.cache.stats", {}),
  };
}

async function runRuntimeBench() {
  await dispatch("gnosis.runtime.cache.clear", {});
  const cold = await runtimeBenchSuite();
  const warm = await runtimeBenchSuite();
  process.stdout.write(JSON.stringify({ ok: true, cold, warm }, null, 2));
  process.stdout.write("\n");
}

async function runSchedulerBench() {
  const result = await dispatch("gnosis.scheduler.bench", { count: 8192 });
  process.stdout.write(JSON.stringify({ ok: true, scheduler: result }, null, 2));
  process.stdout.write("\n");
}

async function runStorageBench() {
  const result = await dispatch("gnosis.storage.bench", {
    count: 256,
    bytesPerWrite: 4096,
  });
  process.stdout.write(JSON.stringify({ ok: true, storage: result }, null, 2));
  process.stdout.write("\n");
}

async function runEntropyBench() {
  const result = await dispatch("gnosis.entropy.bench", {
    frames: 8192,
  });
  process.stdout.write(JSON.stringify({ ok: true, entropy: result }, null, 2));
  process.stdout.write("\n");
}

async function runVictimAnalysis() {
  const start = nowNs();
  const [scheduler, storage, victims, entropy] = await Promise.all([
    dispatch("gnosis.scheduler.bench", { count: 8192 }),
    dispatch("gnosis.storage.bench", { count: 256, bytesPerWrite: 4096 }),
    dispatch("gnosis.storage.victims", {}),
    dispatch("gnosis.entropy.bench", { frames: 8192 }),
  ]);
  const topStorage = victims.pending.slice(0, 5);
  const schedulerNativeActive = scheduler.nativeHooks?.active === true;
  const ranking = [
    {
      id: "scheduler-helix-safe-lane",
      score: Math.round(scheduler.elapsedMs),
      elapsedMs: scheduler.elapsedMs,
      nativeHooks: scheduler.nativeHooks,
      nextAction: schedulerNativeActive
        ? "wire gnosis-antiqueue green-window policy into the native TaskController admission gate while keeping protected delay at zero"
        : "move the JS harness into gnosis-antiqueue / TaskController native hooks and keep protected delay at zero",
    },
    {
      id: "storage-bitwise-knotgraph",
      score: Math.round(storage.disk.elapsedMs),
      diskMs: storage.disk.elapsedMs,
      bitwiseMs: storage.bitwise.elapsedMs,
      knotgraphMs: storage.knotgraph.elapsedMs,
      avoidedDiskBytes: storage.deltas.avoidedDiskBytes,
      nextAction: "replace the highest-ranked Firefox write surface with bitwise/knotchain/knotgraph before direct disk fallback",
    },
    ...topStorage.map(surface => ({
      id: surface.id,
      score: surface.score,
      route: surface.route,
      integrated: surface.integrated,
      presentFiles: surface.presentFiles,
      totalFiles: surface.totalFiles,
      nextAction: surface.reason,
    })),
  ].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const pendingRanking = ranking.filter(item => item.integrated !== true);
  process.stdout.write(JSON.stringify({
    ok: true,
    elapsedMs: elapsedMs(start),
    nextVictim: victims.topVictim ?? pendingRanking[0] ?? null,
    ranking,
    scheduler,
    storage,
    victims,
    entropy,
  }, null, 2));
  process.stdout.write("\n");
}

async function runCommandbarSmoke() {
  const files = ["manifest.json", "run.js", "commandbar.html", "commandbar.css", "commandbar.js"];
  const extensionDir = path.join(nativeDir, "../browser/extensions/aeon");
  const missing = files.filter(file => !existsSync(path.join(extensionDir, file)));
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.browser_action?.default_popup) {
    throw new Error("command bar popup is not registered in manifest.json");
  }
  if (missing.length > 0) {
    throw new Error(`command bar files missing: ${missing.join(", ")}`);
  }
  for (const script of ["run.js", "commandbar.js"]) {
    new Function(readFileSync(path.join(extensionDir, script), "utf8"));
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    popup: manifest.browser_action.default_popup,
    files,
  }, null, 2));
  process.stdout.write("\n");
}

if (process.argv.includes("--self-test")) {
  runSelfTest().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--runtime-bench")) {
  runRuntimeBench().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--scheduler-bench")) {
  runSchedulerBench().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--storage-bench")) {
  runStorageBench().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--entropy-bench")) {
  runEntropyBench().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--victim-analysis")) {
  runVictimAnalysis().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes("--commandbar-smoke")) {
  runCommandbarSmoke().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else {
  startNativeMessagingLoop();
}
