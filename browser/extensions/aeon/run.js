/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Aeon Bridge background script.
 *
 * Firefox extension JS cannot bind UDP sockets directly, so this background
 * script keeps the browser side narrow: validate the bridge request, marshal
 * binary payloads, and hand the work to a native host.
 */

const browserApi = globalThis.browser;
const NATIVE_HOST = "forkjoin-aeon-bridge";
const BINARY_SENTINEL = "__aeonBinaryBase64";
const BINARY_VIEW = "__aeonBinaryView";
const DEFAULT_BRIDGE_TIMEOUT_MS = 30000;
const MAX_BRIDGE_TIMEOUT_MS = 120000;
const AEON_STREAMS = Object.freeze({
  pneumaBase: 0x07d0,
  pneumaInput: 0x07d0,
  pneumaOutput: 0x07d1,
  pneumaInternal: 0x07d2,
  pneumaAudit: 0x07d3,
  pneumaCertificate: 0x07d4,
});
const SUPPORTED_TYPES = new Set([
  "gnosis.runtime.capabilities",
  "gnosis.runtime.cache.stats",
  "gnosis.runtime.cache.clear",
  "gnosis.frf.run",
  "gnosis.frf.bench",
  "gnosis.foil.run",
  "gnosis.foil.telemetry",
  "gnosis.moonshine.exec",
  "gnosis.moonshine.serve",
  "gnosis.amplituhedron.lookup",
  "gnosis.amplituhedron.prefetch",
  "gnosis.antiqueue.schedule",
  "gnosis.antiqueue.telemetry",
  "gnosis.scheduler.observe",
  "gnosis.scheduler.plan",
  "gnosis.scheduler.telemetry",
  "gnosis.scheduler.bench",
  "gnosis.storage.observe",
  "gnosis.storage.plan",
  "gnosis.storage.victims",
  "gnosis.storage.bench",
  "gnosis.auth.observe",
  "gnosis.auth.plan",
  "gnosis.entropy.observe",
  "gnosis.entropy.plan",
  "gnosis.entropy.bench",
  "aeon3d.render.status",
  "aeon3d.render.bench",
  "aether.simd.status",
  "aether.simd.bench",
  "xgnosis.status",
  "xgnosis.bench",
  "gnosis.uring.status",
  "gnosis.uring.bench",
  "aeon.frame.encode",
  "aeon.frame.decode",
  "aeon.frame.reassemble",
  "aeon.frame.streams",
  "aeon.wall.request",
  "aeon.wall.bench",
  "aeon.udp.send",
  "aeon.udp.receive",
  "bitwise.pneuma.encode",
  "bitwise.pneuma.decode",
  "bitwise.pneuma.residual.encode",
  "bitwise.pneuma.residual.decode",
  "bitwise.pneuma.voice-flac.encode",
  "bitwise.pneuma.voice-flac.decode",
  "gnosis.lacey.seed",
  "gnosis.lacey.next",
  "truth.assess",
  "precog.forecast",
]);
const LOCAL_TYPES = new Set(["aeon.frame.streams"]);

const state = {
  port: null,
  nextId: 1,
  pending: new Map(),
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function binaryEnvelope(bytes, viewName = "Uint8Array") {
  return {
    [BINARY_SENTINEL]: bytesToBase64(bytes),
    [BINARY_VIEW]: viewName,
  };
}

function base64ToBytes(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toNativeValue(value) {
  return JSON.parse(
    JSON.stringify(value, (_, current) => {
      if (current instanceof Uint8Array) {
        return binaryEnvelope(current);
      }
      if (current instanceof ArrayBuffer) {
        return binaryEnvelope(new Uint8Array(current), "ArrayBuffer");
      }
      if (ArrayBuffer.isView(current)) {
        return binaryEnvelope(
          new Uint8Array(current.buffer, current.byteOffset, current.byteLength),
          current.constructor.name
        );
      }
      return current;
    })
  );
}

function fromNativeValue(value) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (
      keys.includes(BINARY_SENTINEL) &&
      typeof value[BINARY_SENTINEL] === "string"
    ) {
      return base64ToBytes(value[BINARY_SENTINEL]);
    }

    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = fromNativeValue(nested);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((item) => fromNativeValue(item));
  }

  return value;
}

function handleLocalRequest(message) {
  if (message.type === "aeon.frame.streams") {
    return Promise.resolve(AEON_STREAMS);
  }
  return null;
}

function timeoutMsFor(message) {
  const payload = isPlainObject(message.payload) ? message.payload : {};
  const requested = Number(payload.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_BRIDGE_TIMEOUT_MS;
  }
  return Math.min(MAX_BRIDGE_TIMEOUT_MS, Math.max(1000, requested));
}

function closePending(message) {
  const error = new Error(message);
  for (const { reject, timer } of state.pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  state.pending.clear();
  state.port = null;
}

function attachNativePort(port) {
  port.onMessage.addListener(message => {
    const payload = fromNativeValue(message);
    if (!isPlainObject(payload) || typeof payload.id !== "number") {
      console.info("[aeon] Ignoring native notification", payload);
      return;
    }

    const pending = state.pending.get(payload.id);
    if (!pending) {
      return;
    }

    state.pending.delete(payload.id);
    clearTimeout(pending.timer);
    if (payload.ok === false || typeof payload.error === "string") {
      pending.reject(new Error(payload.error || "Aeon native host error"));
      return;
    }

    pending.resolve(fromNativeValue(payload.result));
  });

  port.onDisconnect.addListener(() => {
    const lastError = browserApi.runtime.lastError;
    closePending(
      lastError && typeof lastError.message === "string"
        ? lastError.message
        : "Aeon native host disconnected"
    );
  });
}

function connectNativePort() {
  if (state.port) {
    return state.port;
  }

  const port = browserApi.runtime.connectNative(NATIVE_HOST);
  attachNativePort(port);
  state.port = port;
  return port;
}

function sendBridgeRequest(message) {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return Promise.reject(new TypeError("Aeon bridge messages must include a type"));
  }
  if (!SUPPORTED_TYPES.has(message.type)) {
    return Promise.reject(new TypeError(`Unsupported Aeon bridge type: ${message.type}`));
  }
  if (LOCAL_TYPES.has(message.type)) {
    return handleLocalRequest(message);
  }

  let port;
  try {
    port = connectNativePort();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const id = state.nextId++;
  const request = {
    id,
    type: message.type,
    payload: toNativeValue(message.payload),
  };

  return new Promise((resolve, reject) => {
    const timeoutMs = timeoutMsFor(message);
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`Aeon native host timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    try {
      port.postMessage(request);
    } catch (error) {
      const pending = state.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        state.pending.delete(id);
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function handleExtensionMessage(message) {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return undefined;
  }
  if (!SUPPORTED_TYPES.has(message.type)) {
    return undefined;
  }
  return sendBridgeRequest(message);
}

browserApi.runtime.onMessage.addListener(message => {
  return handleExtensionMessage(message);
});

browserApi.runtime.onConnect.addListener(extensionPort => {
  if (extensionPort.name && extensionPort.name !== "aeon-bridge") {
    return;
  }

  extensionPort.onMessage.addListener(message => {
    const clientId = isPlainObject(message) ? message.id : undefined;
    const promise = handleExtensionMessage(message);
    if (!promise) {
      return;
    }

    promise.then(
      result => {
        extensionPort.postMessage({ id: clientId, ok: true, result });
      },
      error => {
        extensionPort.postMessage({
          id: clientId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  });
});
