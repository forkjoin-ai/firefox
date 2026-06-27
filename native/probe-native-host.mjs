#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = path.dirname(fileURLToPath(import.meta.url));
const hostPath = path.join(nativeDir, "forkjoin-aeon-bridge");
const BINARY_SENTINEL = "__aeonBinaryBase64";
const REQUEST_TIMEOUT_MS = 30000;

function binaryEnvelope(bytes) {
  return {
    [BINARY_SENTINEL]: Buffer.from(bytes).toString("base64"),
    __aeonBinaryView: "Uint8Array",
  };
}

function writeMessage(child, message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.byteLength, 0);
  child.stdin.write(header);
  child.stdin.write(body);
}

function readMessages(child, onMessage) {
  let buffer = Buffer.alloc(0);
  child.stdout.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.byteLength >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.byteLength < 4 + length) {
        break;
      }
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body.toString("utf8")));
    }
  });
}

async function main() {
  const child = spawn(hostPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 1;
  readMessages(child, message => {
    const slot = pending.get(message.id);
    if (!slot) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(slot.timer);
    if (message.ok === false) {
      slot.reject(new Error(message.error || "native host error"));
      return;
    }
    slot.resolve(message.result);
  });
  child.stderr.on("data", chunk => process.stderr.write(chunk));
  child.on("exit", (code, signal) => {
    const error = new Error(`native host exited ${code ?? signal ?? "unknown"}`);
    for (const slot of pending.values()) {
      clearTimeout(slot.timer);
      slot.reject(error);
    }
    pending.clear();
  });

  function request(type, payload) {
    const id = nextId++;
    writeMessage(child, { id, type, payload });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  }

  const encoded = await request("aeon.frame.encode", {
    streamId: 42,
    sequence: 2,
    flags: 16,
    payload: binaryEnvelope(Buffer.from("browser")),
  });
  const decoded = await request("aeon.frame.decode", { bytes: encoded.bytes });
  const pneuma = await request("bitwise.pneuma.encode", { text: "native [race]" });
  const lacey = await request("gnosis.lacey.seed", { id: "probe", seed: "0xfeed" });
  const laceyNext = await request("gnosis.lacey.next", { id: lacey.id, count: 1 });

  child.stdin.end();
  child.kill("SIGTERM");

  process.stdout.write(JSON.stringify({
    ok: true,
    frameStreamId: decoded.frame.streamId,
    encodedBytes: encoded.byteLength,
    pneumaDenseLength: pneuma.dense.length,
    laceyWord: laceyNext.words[0],
  }, null, 2));
  process.stdout.write("\n");
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
