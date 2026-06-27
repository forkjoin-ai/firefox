/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const PREF_STORAGE_ACTIVE = "forkjoin.gnosis.storage.active.enabled";
const PREF_AUTH_ACTIVE = "forkjoin.gnosis.auth.active.enabled";
const PREF_ROOT_DID = "forkjoin.fractal_iam.root_did";

const RECEIPT_FILE = "gnosis-sessionstore.knotchain.jsonl";

let gPreviousBlockHash = null;
let gSequence = 0;

function safeGetBoolPref(name, fallback = false) {
  try {
    return Services.prefs.getBoolPref(name, fallback);
  } catch (ex) {
    return fallback;
  }
}

function safeGetCharPref(name, fallback = "") {
  try {
    return Services.prefs.getCharPref(name, fallback);
  } catch (ex) {
    return fallback;
  }
}

function sha256Base64(text) {
  let bytes = new TextEncoder().encode(text);
  let hash = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hash.init(hash.SHA256);
  hash.update(bytes, bytes.length);
  return hash.finish(true);
}

function countTabs(state) {
  let windows = Array.isArray(state?.windows) ? state.windows : [];
  let closedWindows = Array.isArray(state?._closedWindows)
    ? state._closedWindows
    : [];
  let tabCount = 0;
  let closedTabCount = 0;
  for (let window of windows) {
    tabCount += Array.isArray(window?.tabs) ? window.tabs.length : 0;
    closedTabCount += Array.isArray(window?._closedTabs)
      ? window._closedTabs.length
      : 0;
  }
  for (let window of closedWindows) {
    tabCount += Array.isArray(window?.tabs) ? window.tabs.length : 0;
    closedTabCount += Array.isArray(window?._closedTabs)
      ? window._closedTabs.length
      : 0;
  }
  return {
    windowCount: windows.length,
    closedWindowCount: closedWindows.length,
    tabCount,
    closedTabCount,
  };
}

function targetForWrite(options) {
  return options?.isFinalWrite ? "clean" : "recovery";
}

async function previousBlockHash(receiptPath) {
  if (gPreviousBlockHash !== null) {
    return gPreviousBlockHash;
  }

  try {
    let text = await IOUtils.readUTF8(receiptPath);
    let lines = text
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
    let last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    gPreviousBlockHash =
      typeof last?.blockHash === "string" ? last.blockHash : "";
  } catch (ex) {
    gPreviousBlockHash = "";
  }

  return gPreviousBlockHash;
}

export const SessionStoreGnosis = {
  receiptPath(paths) {
    return PathUtils.join(paths.backups, RECEIPT_FILE);
  },

  isActive() {
    return safeGetBoolPref(PREF_STORAGE_ACTIVE, false);
  },

  async recordWrite({ state, options, paths, telemetry, targetPath }) {
    if (!this.isActive()) {
      return {
        recorded: false,
        reason: "inactive",
      };
    }

    await IOUtils.makeDirectory(paths.backups);
    let receiptPath = this.receiptPath(paths);
    let previous = await previousBlockHash(receiptPath);
    let sequence = ++gSequence;
    let shape = countTabs(state);
    let rootDid = safeGetCharPref(PREF_ROOT_DID, "");
    let authenticated =
      safeGetBoolPref(PREF_AUTH_ACTIVE, false) && rootDid.startsWith("did:");
    let receipt = {
      schema: "forkjoin.gnosis.sessionstore.knotchain.v1",
      route: "knotchain-append",
      sequence,
      writtenAt: Date.now(),
      target: targetForWrite(options),
      targetPath: PathUtils.filename(targetPath),
      previousBlockHash: previous,
      fileSizeBytes: telemetry?.fileSizeBytes ?? 0,
      writeFileMs: telemetry?.writeFileMs ?? 0,
      profilePathRedacted: true,
      did: authenticated ? rootDid : null,
      auth: authenticated ? "fractal-iam-did" : "anonymous-house",
      ...shape,
    };
    receipt.shapeHash = sha256Base64(
      JSON.stringify({
        schema: receipt.schema,
        route: receipt.route,
        sequence: receipt.sequence,
        target: receipt.target,
        previousBlockHash: receipt.previousBlockHash,
        fileSizeBytes: receipt.fileSizeBytes,
        ...shape,
      })
    );
    receipt.blockHash = sha256Base64(
      JSON.stringify({
        ...receipt,
        blockHash: undefined,
      })
    );

    await IOUtils.writeUTF8(receiptPath, `${JSON.stringify(receipt)}\n`, {
      mode: "appendOrCreate",
    });
    gPreviousBlockHash = receipt.blockHash;

    return {
      recorded: true,
      route: receipt.route,
      target: receipt.target,
      receiptPath,
      blockHash: receipt.blockHash,
      previousBlockHash: receipt.previousBlockHash,
      fileSizeBytes: receipt.fileSizeBytes,
    };
  },

  resetForTests() {
    gPreviousBlockHash = null;
    gSequence = 0;
  },
};
