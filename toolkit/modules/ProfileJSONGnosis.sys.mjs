/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const PREF_STORAGE_ACTIVE = "forkjoin.gnosis.storage.active.enabled";
const PREF_AUTH_ACTIVE = "forkjoin.gnosis.auth.active.enabled";
const PREF_ROOT_DID = "forkjoin.fractal_iam.root_did";

let gSequence = 0;
let gLastProjection = null;

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

function projectedBitwiseEnvelopeBytes(jsonBytes) {
  return 18 + Math.ceil(jsonBytes * 0.58);
}

function authState() {
  let rootDid = safeGetCharPref(PREF_ROOT_DID, "");
  let authenticated =
    safeGetBoolPref(PREF_AUTH_ACTIVE, false) && rootDid.startsWith("did:");
  return {
    did: authenticated ? rootDid : null,
    auth: authenticated ? "fractal-iam-did" : "anonymous-house",
  };
}

function recordProjection({ serialized, sanitizedBasename, options, safe }) {
  let jsonBytes = new TextEncoder().encode(serialized).length;
  let projection = {
    schema: "forkjoin.gnosis.profile-json.bitwise.v1",
    route: "bitwise-binary",
    sequence: ++gSequence,
    sanitizedBasename,
    jsonBytes,
    bitwiseEnvelopeBytes: projectedBitwiseEnvelopeBytes(jsonBytes),
    compression: options?.compress ? "jsonlz4" : "json",
    contentHash: sha256Base64(serialized),
    profilePathRedacted: true,
    safeFallback: !!safe,
    ...authState(),
  };
  projection.envelopeHash = sha256Base64(
    JSON.stringify({
      schema: projection.schema,
      route: projection.route,
      sequence: projection.sequence,
      sanitizedBasename: projection.sanitizedBasename,
      jsonBytes: projection.jsonBytes,
      bitwiseEnvelopeBytes: projection.bitwiseEnvelopeBytes,
      compression: projection.compression,
      contentHash: projection.contentHash,
      safeFallback: projection.safeFallback,
    })
  );
  gLastProjection = projection;
  return projection;
}

export const ProfileJSONGnosis = {
  isActive() {
    return safeGetBoolPref(PREF_STORAGE_ACTIVE, false);
  },

  prepareWrite({ data, sanitizedBasename, options }) {
    if (!this.isActive()) {
      return {
        active: false,
      };
    }

    let serialized = JSON.stringify(data);
    return {
      active: true,
      serialized,
      projection: recordProjection({
        serialized,
        sanitizedBasename,
        options,
        safe: false,
      }),
    };
  },

  prepareSerializedWrite({ serialized, sanitizedBasename, options }) {
    if (!this.isActive()) {
      return {
        active: false,
        serialized,
      };
    }

    return {
      active: true,
      serialized,
      projection: recordProjection({
        serialized,
        sanitizedBasename,
        options,
        safe: true,
      }),
    };
  },

  snapshotForTests() {
    return gLastProjection;
  },

  resetForTests() {
    gSequence = 0;
    gLastProjection = null;
  },
};
