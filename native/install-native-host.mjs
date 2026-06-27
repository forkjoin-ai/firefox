#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = path.dirname(fileURLToPath(import.meta.url));
const hostPath = path.join(nativeDir, "forkjoin-aeon-bridge");
const manifestDir = path.join(
  homedir(),
  "Library/Application Support/Mozilla/NativeMessagingHosts"
);
const manifestPath = path.join(manifestDir, "forkjoin-aeon-bridge.json");

const manifest = {
  name: "forkjoin-aeon-bridge",
  description: "Forkjoin Aeon native bridge for Firefox",
  path: hostPath,
  type: "stdio",
  allowed_extensions: ["aeon@forkjoin.ai"],
};

mkdirSync(manifestDir, { recursive: true });
chmodSync(hostPath, 0o755);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`${manifestPath}\n`);
