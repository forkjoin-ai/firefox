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
const NATIVE_HOST = 'forkjoin-aeon-bridge';
const BINARY_SENTINEL = '__aeonBinaryBase64';
const SUPPORTED_TYPES = new Set([
  'aeon.frame.encode',
  'aeon.frame.decode',
  'aeon.udp.send',
  'aeon.udp.receive',
  'bitwise.pneuma.encode',
  'bitwise.pneuma.decode',
  'gnosis.lacey.seed',
  'gnosis.lacey.next',
]);

const state = {
  port: null,
  nextId: 1,
  pending: new Map(),
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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
        return { [BINARY_SENTINEL]: bytesToBase64(current) };
      }
      if (current instanceof ArrayBuffer) {
        return { [BINARY_SENTINEL]: bytesToBase64(new Uint8Array(current)) };
      }
      return current;
    })
  );
}

function fromNativeValue(value) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && typeof value[BINARY_SENTINEL] === 'string') {
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

function closePending(message) {
  const error = new Error(message);
  for (const { reject } of state.pending.values()) {
    reject(error);
  }
  state.pending.clear();
  state.port = null;
}

function attachNativePort(port) {
  port.onMessage.addListener((message) => {
    const payload = fromNativeValue(message);
    if (!isPlainObject(payload) || typeof payload.id !== 'number') {
      console.info('[aeon] Ignoring native notification', payload);
      return;
    }

    const pending = state.pending.get(payload.id);
    if (!pending) {
      return;
    }

    state.pending.delete(payload.id);
    if (payload.ok === false || typeof payload.error === 'string') {
      pending.reject(new Error(payload.error || 'Aeon native host error'));
      return;
    }

    pending.resolve(fromNativeValue(payload.result));
  });

  port.onDisconnect.addListener(() => {
    const lastError = browserApi.runtime.lastError;
    closePending(
      lastError && typeof lastError.message === 'string'
        ? lastError.message
        : 'Aeon native host disconnected'
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
  if (!isPlainObject(message) || typeof message.type !== 'string') {
    return Promise.reject(new TypeError('Aeon bridge messages must include a type'));
  }
  if (!SUPPORTED_TYPES.has(message.type)) {
    return Promise.reject(new TypeError(`Unsupported Aeon bridge type: ${message.type}`));
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
    state.pending.set(id, { resolve, reject });
    try {
      port.postMessage(request);
    } catch (error) {
      state.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

browserApi.runtime.onMessage.addListener((message) => {
  if (!isPlainObject(message) || typeof message.type !== 'string') {
    return undefined;
  }
  if (!SUPPORTED_TYPES.has(message.type)) {
    return undefined;
  }
  return sendBridgeRequest(message);
});
