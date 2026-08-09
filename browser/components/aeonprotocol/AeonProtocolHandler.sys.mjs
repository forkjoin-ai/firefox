/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const RESOURCE_RESOLVER_ORIGIN = "https://api.edgework.ai";
const WIKI_RESOLVER_ORIGIN = "https://wiki.forkjoin.ai";
const AEON_WALL_ENABLED_PREF = "aeon.protocol.wall.experimental.enabled";
const AEON_WALL_PATH_PREF = "aeon.protocol.wall.path";
const AEON_WALL_TIMEOUT_PREF = "aeon.protocol.wall.timeout_ms";

const AEON_RESOURCE_HOSTS = new Set([
  "artifact",
  "install",
  "logs",
  "notification",
  "rhizome",
  "system",
]);

function isLoopbackHost(host) {
  return (
    host == "localhost" ||
    host == "127.0.0.1" ||
    host == "::1" ||
    host.endsWith(".localhost")
  );
}

function isHostStyleAddress(host) {
  return (
    isLoopbackHost(host) ||
    host.includes(".") ||
    host.includes(":") ||
    /^[0-9.]+$/.test(host)
  );
}

function pathForAeonIngress(uri) {
  let filePath = uri.filePath || "/";
  if (filePath == "/") {
    return "/.aeon/";
  }
  if (!filePath.startsWith("/")) {
    filePath = `/${filePath}`;
  }
  return `/.aeon${filePath}`;
}

function pathForWebFallback(uri) {
  let filePath = uri.filePath || "/";
  if (!filePath.startsWith("/")) {
    filePath = `/${filePath}`;
  }
  return filePath;
}

function resolveHostStyleAddress(uri) {
  const host = uri.host;
  const scheme = isLoopbackHost(host) ? "http" : "https";
  const target = new URL(`${scheme}://${uri.hostPort || host}`);
  target.pathname = isLoopbackHost(host)
    ? pathForAeonIngress(uri)
    : pathForWebFallback(uri);
  if (uri.query) {
    target.search = `?${uri.query}`;
  }
  if (uri.ref) {
    target.hash = `#${uri.ref}`;
  }
  return target.href;
}

function resolveResourceAddress(uri) {
  const target =
    uri.host == "rhizome"
      ? new URL("/v1/rhizome/resolve", RESOURCE_RESOLVER_ORIGIN)
      : new URL("/search", WIKI_RESOLVER_ORIGIN);
  const param = uri.host == "rhizome" ? "address" : "q";
  target.searchParams.set(param, uri.spec);
  return target.href;
}

function resolveAeonURI(uri) {
  if (!uri?.host) {
    const target = new URL("/search", WIKI_RESOLVER_ORIGIN);
    target.searchParams.set("q", uri?.spec || "aeon://");
    return target.href;
  }

  if (AEON_RESOURCE_HOSTS.has(uri.host)) {
    return resolveResourceAddress(uri);
  }

  if (isHostStyleAddress(uri.host)) {
    return resolveHostStyleAddress(uri);
  }

  const target = new URL("/search", WIKI_RESOLVER_ORIGIN);
  target.searchParams.set("q", uri.spec);
  return target.href;
}

function getWallPath() {
  return Services.prefs.getStringPref(AEON_WALL_PATH_PREF, "");
}

function shouldUseWall(uri) {
  return (
    Services.prefs.getBoolPref(AEON_WALL_ENABLED_PREF, false) &&
    uri?.host &&
    isHostStyleAddress(uri.host) &&
    getWallPath()
  );
}

function guessContentType(uri) {
  const filePath = uri.filePath || "";
  if (filePath.endsWith(".json")) {
    return "application/json";
  }
  if (filePath.endsWith(".css")) {
    return "text/css";
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "application/javascript";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".txt")) {
    return "text/plain";
  }
  return "text/html";
}

function errorDocument(title, error) {
  const escaped = String(error?.message || error)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><pre>${escaped}</pre>`;
}

async function readPipeString(pipe) {
  let result = "";
  let chunk;
  while ((chunk = await pipe.readString())) {
    result += chunk;
  }
  return result;
}

async function runWall(uri) {
  const timeoutMs = Services.prefs.getIntPref(AEON_WALL_TIMEOUT_PREF, 10000);
  const proc = await lazy.Subprocess.call({
    command: getWallPath(),
    arguments: ["--udp", uri.spec],
  });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        proc.kill();
      } catch (_) {
        // Process may already be gone.
      }
      reject(new Error(`wall timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, waitResult] = await Promise.race([
      Promise.all([
        readPipeString(proc.stdout),
        readPipeString(proc.stderr),
        proc.wait(),
      ]),
      timeout,
    ]);
    if (waitResult.exitCode !== 0) {
      throw new Error(stderr || `wall exited ${waitResult.exitCode}`);
    }
    return stdout;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function createWallBackedChannel(uri, loadInfo) {
  const { channel, outputStream } = (() => {
    const innerChannel = Cc["@mozilla.org/network/input-stream-channel;1"]
      .createInstance(Ci.nsIInputStreamChannel)
      .QueryInterface(Ci.nsIChannel);
    innerChannel.loadInfo = loadInfo;
    innerChannel.setURI(uri);
    innerChannel.contentType = guessContentType(uri);
    const pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
    pipe.init(true, true, 0, 0);
    innerChannel.contentStream = pipe.inputStream;
    return { channel: innerChannel, outputStream: pipe.outputStream };
  })();

  function writeAndClose(text) {
    const converter = Cc[
      "@mozilla.org/intl/converter-output-stream;1"
    ].createInstance(Ci.nsIConverterOutputStream);
    converter.init(outputStream, "UTF-8");
    converter.writeString(text);
    converter.close();
  }

  runWall(uri)
    .then(body => {
      writeAndClose(body);
    })
    .catch(error => {
      channel.contentType = "text/html";
      writeAndClose(errorDocument("Aeon load failed", error));
    });

  return channel;
}

/**
 * Renders the Aeon Protocol Handler view.
 */
export function AeonProtocolHandler() {}

AeonProtocolHandler.prototype = {
  scheme: "aeon",
  defaultPort: -1,
  protocolFlags:
    Ci.nsIProtocolHandler.URI_STD |
    Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |
    Ci.nsIProtocolHandler.URI_IS_POTENTIALLY_TRUSTWORTHY,

  newChannel(uri, loadInfo) {
    if (shouldUseWall(uri)) {
      return createWallBackedChannel(uri, loadInfo);
    }

    const resolvedURI = NetUtil.newURI(resolveAeonURI(uri));
    const channel = Services.io.newChannelFromURIWithLoadInfo(
      resolvedURI,
      loadInfo
    );
    channel.originalURI = uri;
    loadInfo.resultPrincipalURI = resolvedURI;
    return channel;
  },

  QueryInterface: ChromeUtils.generateQI(["nsIProtocolHandler"]),
};
