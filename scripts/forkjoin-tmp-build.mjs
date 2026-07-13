#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const isWindows = process.platform === "win32";
function normalizeFileUrlPath(url) {
  const path = fileURLToPath(url);
  return isWindows ? path.replace(/^\/([A-Za-z]:[\\/])/, "$1") : path;
}

const sourceRoot = resolve(normalizeFileUrlPath(new URL("..", import.meta.url)));
const tmpRoot = resolve(
  process.env.FIREFOX_TMP_BUILD_DIR || join(tmpdir(), "forkjoin-firefox-build")
);
const remote =
  process.env.FIREFOX_MOZILLA_REMOTE ||
  "https://github.com/mozilla-firefox/firefox.git";
const ref = process.env.FIREFOX_MOZILLA_REF || "main";
const mozillaBuildPython = "C:\\mozilla-build\\python3\\python.exe";
const python =
  process.env.FIREFOX_PYTHON ||
  process.env.PYTHON ||
  (isWindows && existsSync(mozillaBuildPython) ? mozillaBuildPython : isWindows ? "python" : "python3.12");

const objectDir = isWindows
  ? "obj-x86_64-pc-windows-msvc"
  : "obj-aarch64-apple-darwin25.5.0";
const appBundleCandidates = ["Kenoma.app", "Nightly.app"];
const monorepoArtifactRoot = resolve(
  process.env.FIREFOX_MONOREPO_ARTIFACT_DIR ||
    join(sourceRoot, "build", "forkjoin")
);
const monorepoAppPath = join(monorepoArtifactRoot, "Kenoma.app");
const monorepoAppExecutable = join(monorepoAppPath, "Contents", "MacOS", "firefox");
const legacyMonorepoAppPaths = [
  join(monorepoArtifactRoot, "Nightly.app"),
  join(monorepoArtifactRoot, "Firefox Nightly.app"),
];

function run(command, commandArgs, cwd = tmpRoot, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function waitForSyncLock() {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, 100);
}

function withSyncLock(callback) {
  mkdirSync(tmpRoot, { recursive: true });
  const lockPath = join(tmpRoot, ".forkjoin-sync.lock");
  let fd = null;
  const start = Date.now();
  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST" || Date.now() - start > 120000) {
        throw error;
      }
      waitForSyncLock();
    }
  }

  try {
    return callback();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch (error) {}
  }
}

function ensureInsideTmp(path) {
  const resolved = resolve(path);
  const tmpRootResolved = resolve(tmpdir());
  const insideSystemTmp =
    resolved === tmpRootResolved || resolved.startsWith(`${tmpRootResolved}${sep}`);
  if (!insideSystemTmp || !basename(resolved).startsWith("forkjoin-firefox-build")) {
    throw new Error(`Refusing to remove non-Forkjoin tmp build path: ${resolved}`);
  }
}

function copyPath(relativePath) {
  const from = join(sourceRoot, relativePath);
  const to = join(tmpRoot, relativePath);
  if (!existsSync(from)) {
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  const stat = statSync(from);
  if (stat.isDirectory()) {
    cpSync(from, to, { recursive: true });
  } else {
    cpSync(from, to);
  }
}

function copyFileTo(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) {
    return;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { recursive: true, force: true });
  cpSync(sourcePath, targetPath);
}

function ensureMozBuildEntry(path, entry) {
  let contents = readFileSync(path, "utf8");
  if (contents.includes(`"${entry}"`) || contents.includes(`'${entry}'`)) {
    return;
  }
  contents = contents.replace(/DIRS \+= \[\n/, `DIRS += [\n    "${entry}",\n`);
  writeFileSync(path, contents);
}

function ensureForkjoinBuildEntries() {
  ensureMozBuildEntry(join(tmpRoot, "browser", "extensions", "moz.build"), "aeon");
  ensureMozBuildEntry(join(tmpRoot, "browser", "components", "moz.build"), "aeonprotocol");
}

function findBuiltAppPath() {
  if (isWindows) {
    return join(tmpRoot, objectDir, "dist", "bin");
  }
  for (const appBundleName of appBundleCandidates) {
    const candidate = join(tmpRoot, objectDir, "dist", appBundleName);
    if (existsSync(join(candidate, "Contents", "MacOS", "firefox"))) {
      return candidate;
    }
  }
  return join(tmpRoot, objectDir, "dist", appBundleCandidates[0]);
}

function findBuiltAppExecutable() {
  if (isWindows) {
    return join(findBuiltAppPath(), "firefox.exe");
  }
  return join(findBuiltAppPath(), "Contents", "MacOS", "firefox");
}

function findDistResources() {
  if (isWindows) {
    return join(tmpRoot, objectDir, "dist", "bin");
  }
  const resourceCandidates = [
    join(tmpRoot, objectDir, "dist", "Kenoma.app", "Contents", "Resources"),
    join(findBuiltAppPath(), "Contents", "Resources"),
    join(tmpRoot, objectDir, "dist", "bin"),
    join(tmpRoot, objectDir, "dist", "Nightly.app", "Contents", "Resources"),
  ];
  for (const candidate of resourceCandidates) {
    if (
      existsSync(
        join(
          candidate,
          "browser",
          "chrome",
          "browser",
          "content",
          "branding",
          "kenoma-home.html"
        )
      )
    ) {
      return candidate;
    }
  }
  return join(findBuiltAppPath(), "Contents", "Resources");
}

function ensureTmpClone() {
  if (args.has("--fresh")) {
    ensureInsideTmp(tmpRoot);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  if (!existsSync(join(tmpRoot, "mach"))) {
    mkdirSync(dirname(tmpRoot), { recursive: true });
    run("git", ["clone", "--depth=1", "--branch", ref, remote, tmpRoot], dirname(tmpRoot));
  }
}

function syncForkjoinFiles() {
  copyPath("mozconfig");
  copyPath("browser/components/about/AboutRedirector.cpp");
  copyPath("browser/components/about/components.conf");
  copyPath("browser/components/sessionstore/SessionStoreGnosis.sys.mjs");
  copyPath("browser/components/sessionstore/SessionWriter.sys.mjs");
  copyPath("browser/components/sessionstore/moz.build");
  copyPath("browser/components/sessionstore/test/unit/test_gnosis_sessionstore_receipts.js");
  copyPath("browser/components/sessionstore/test/unit/xpcshell.toml");
  copyPath("toolkit/modules/JSONFile.sys.mjs");
  copyPath("toolkit/modules/ProfileJSONGnosis.sys.mjs");
  copyPath("toolkit/modules/moz.build");
  copyPath("toolkit/modules/tests/xpcshell/test_JSONFile.js");
  copyPath("netwerk/cache2/CacheFileChunk.cpp");
  copyPath("netwerk/cache2/CacheFileMetadata.cpp");
  copyPath("netwerk/cache2/CacheGnosisTelemetry.cpp");
  copyPath("netwerk/cache2/CacheGnosisTelemetry.h");
  copyPath("netwerk/cache2/moz.build");
  copyPath("storage/mozStorageAsyncStatementExecution.cpp");
  copyPath("storage/QuotaVFS.cpp");
  copyPath("storage/StorageGnosisTelemetry.cpp");
  copyPath("storage/StorageGnosisTelemetry.h");
  copyPath("storage/moz.build");
  copyPath("dom/quota/OriginOperations.cpp");
  copyPath("dom/quota/QuotaGnosisTelemetry.cpp");
  copyPath("dom/quota/QuotaGnosisTelemetry.h");
  copyPath("dom/quota/moz.build");
  copyPath("xpcom/threads/TaskController.cpp");
  copyPath("xpcom/threads/TaskControllerGnosisTelemetry.cpp");
  copyPath("xpcom/threads/TaskControllerGnosisTelemetry.h");
  copyPath("xpcom/threads/moz.build");
  copyPath("xpcom/tests/gtest/TestTaskController.cpp");
  copyPath("browser/extensions/aeon");
  copyPath("browser/components/aeonprotocol");
  copyPath("browser/app/profile/firefox.js");
  copyPath("browser/app/distribution/policies.json");
  copyPath("browser/app/distribution/moz.build");
  copyPath("browser/branding/nightly/configure.sh");
  copyPath("browser/branding/nightly/locales/en-US/brand.ftl");
  copyPath("browser/branding/nightly/locales/en-US/brand.properties");
  copyPath("browser/branding/nightly/content");
  ensureForkjoinBuildEntries();
  syncBuiltSessionstoreArtifacts();
  syncBuiltToolkitModuleArtifacts();
}

function syncBuiltSessionstoreArtifacts() {
  const moduleFiles = [
    "SessionStoreGnosis.sys.mjs",
    "SessionWriter.sys.mjs",
  ];
  const resourceRoots = [
    join(tmpRoot, objectDir, "dist", "bin"),
    join(tmpRoot, objectDir, "dist", "Nightly.app", "Contents", "Resources"),
    join(tmpRoot, objectDir, "dist", "Kenoma.app", "Contents", "Resources"),
  ];
  for (const resourceRoot of resourceRoots) {
    const moduleRoot = join(resourceRoot, "browser", "modules", "sessionstore");
    if (!existsSync(moduleRoot)) {
      continue;
    }
    for (const file of moduleFiles) {
      copyFileTo(
        join(sourceRoot, "browser", "components", "sessionstore", file),
        join(moduleRoot, file)
      );
    }
  }

  const xpcshellRoot = join(
    tmpRoot,
    objectDir,
    "_tests",
    "xpcshell",
    "browser",
    "components",
    "sessionstore",
    "test",
    "unit"
  );
  if (existsSync(xpcshellRoot)) {
    for (const file of ["test_gnosis_sessionstore_receipts.js", "xpcshell.toml"]) {
      copyFileTo(
        join(sourceRoot, "browser", "components", "sessionstore", "test", "unit", file),
        join(xpcshellRoot, file)
      );
    }
  }
}

function syncBuiltToolkitModuleArtifacts() {
  const moduleFiles = [
    "JSONFile.sys.mjs",
    "ProfileJSONGnosis.sys.mjs",
  ];
  const resourceRoots = [
    join(tmpRoot, objectDir, "dist", "bin"),
    join(tmpRoot, objectDir, "dist", "Nightly.app", "Contents", "Resources"),
    join(tmpRoot, objectDir, "dist", "Kenoma.app", "Contents", "Resources"),
  ];
  for (const resourceRoot of resourceRoots) {
    const moduleRoot = join(resourceRoot, "modules");
    if (!existsSync(moduleRoot)) {
      continue;
    }
    for (const file of moduleFiles) {
      copyFileTo(
        join(sourceRoot, "toolkit", "modules", file),
        join(moduleRoot, file)
      );
    }
  }

  const xpcshellRoot = join(
    tmpRoot,
    objectDir,
    "_tests",
    "xpcshell",
    "toolkit",
    "modules",
    "tests",
    "xpcshell"
  );
  if (existsSync(xpcshellRoot)) {
    copyFileTo(
      join(sourceRoot, "toolkit", "modules", "tests", "xpcshell", "test_JSONFile.js"),
      join(xpcshellRoot, "test_JSONFile.js")
    );
  }
}

function syncPostGeneratedBrandingFiles() {
  copyPath("browser/branding/nightly/content/operator-tab");
}

function generateKenomaBranding() {
  run(process.execPath, [
    join(sourceRoot, "scripts", "generate-kenoma-branding.mjs"),
    "--target-root",
    tmpRoot,
    "--repo-root",
    resolve(sourceRoot, "..", ".."),
  ]);
}

function configureWindowsMozconfig(env) {
  if (!isWindows) {
    return env;
  }
  const windowsEnv = { ...env };
  const msvcOverlay =
    windowsEnv.FIREFOX_MSVC_OVERLAY ||
    "C:\\tmp\\vs-msvc-overlay\\VC\\Tools\\MSVC\\14.44.35207";
  const defaultVcPath = "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.44.35207";
  const defaultWindowsSdkDir = "C:\\Program Files (x86)\\Windows Kits\\10";
  if (!windowsEnv.VC_PATH && existsSync(msvcOverlay)) {
    windowsEnv.VC_PATH = msvcOverlay;
  }
  if (!windowsEnv.VC_PATH && existsSync(defaultVcPath)) {
    windowsEnv.VC_PATH = defaultVcPath;
  }
  if (!windowsEnv.WINDOWSSDKDIR && existsSync(defaultWindowsSdkDir)) {
    windowsEnv.WINDOWSSDKDIR = defaultWindowsSdkDir;
  }
  if (windowsEnv.MOZCONFIG) {
    return windowsEnv;
  }
  const mozconfigPath = join(tmpRoot, "mozconfig.windows");
  writeFileSync(
    mozconfigPath,
    [
      "ac_add_options --enable-bootstrap=no-update",
      "ac_add_options --with-branding=browser/branding/nightly",
      "",
    ].join("\n")
  );
  return {
    ...windowsEnv,
    MOZCONFIG: mozconfigPath,
  };
}

function verifyBuiltArtifact() {
  const appPath = findBuiltAppPath();
  const appExecutable = findBuiltAppExecutable();
  const distResources = findDistResources();
  const browserChromeRoot = isWindows
    ? join(distResources, "browser", "chrome", "browser")
    : join(appPath, "Contents", "Resources", "browser", "chrome", "browser");
  const expectedFiles = [
    join(browserChromeRoot, "builtin-addons", "aeon", "manifest.json"),
    join(browserChromeRoot, "builtin-addons", "aeon", "run.js"),
    join(distResources, "browser", "modules", "AeonProtocolHandler.sys.mjs"),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "kenoma-home.html"
    ),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "kenoma-sigil.svg"
    ),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "kenoma-home.js"
    ),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "skychat-home.html"
    ),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "weather-home.html"
    ),
    join(
      distResources,
      "browser",
      "chrome",
      "browser",
      "content",
      "branding",
      "operator-tab",
      "fonts",
      "AtkinsonHyperlegible-Regular.ttf"
    ),
    join(distResources, "distribution", "policies.json"),
  ];
  const missing = expectedFiles.filter(file => !existsSync(file));
  if (missing.length > 0) {
    console.error("Missing Firefox build artifacts:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  const policies = readFileSync(
    join(distResources, "distribution", "policies.json"),
    "utf8"
  );
  if (!policies.includes("https://wiki.forkjoin.ai/search?q={searchTerms}")) {
    console.error("Built policies.json does not contain the Wiki search template.");
    process.exit(1);
  }
  if (!policies.includes("about:kenoma")) {
    console.error("Built policies.json does not contain the Kenoma about page.");
    process.exit(1);
  }

  const prefCandidates = [
    join(distResources, "browser", "defaults", "preferences", "firefox.js"),
    join(distResources, "defaults", "pref", "firefox.js"),
    join(distResources, "defaults", "preferences", "firefox.js"),
    join(tmpRoot, objectDir, "dist", "bin", "browser", "defaults", "preferences", "firefox.js"),
    join(tmpRoot, objectDir, "dist", "bin", "defaults", "pref", "firefox.js"),
  ];
  const prefPath = prefCandidates.find(file => existsSync(file));
  if (!prefPath) {
    console.error("Could not locate packaged firefox.js defaults.");
    process.exit(1);
  }
  const prefs = readFileSync(prefPath, "utf8");
  for (const marker of [
    'pref("browser.newtabpage.activity-stream.discoverystream.enabled", false);',
    'pref("browser.topsites.contile.enabled", false);',
    'pref("browser.urlbar.suggest.weather", false);',
    'pref("browser.startup.homepage", "about:kenoma");',
  ]) {
    if (!prefs.includes(marker)) {
      console.error(`Packaged prefs missing marker: ${marker}`);
      process.exit(1);
    }
  }

  console.log(`Kenoma app: ${appPath}`);
  console.log(`Executable: ${appExecutable}`);
  console.log(`Packaged prefs: ${prefPath}`);
  console.log("Kenoma artifact verification passed.");
}

function mirrorBuiltAppToMonorepo() {
  const appPath = findBuiltAppPath();
  const appExecutable = findBuiltAppExecutable();
  if (!existsSync(appExecutable)) {
    console.error(`Cannot mirror Firefox app; executable missing: ${appExecutable}`);
    process.exit(1);
  }
  mkdirSync(monorepoArtifactRoot, { recursive: true });
  for (const legacyAppPath of legacyMonorepoAppPaths) {
    rmSync(legacyAppPath, { recursive: true, force: true });
  }
  rmSync(monorepoAppPath, { recursive: true, force: true });
  if (isWindows) {
    cpSync(appPath, monorepoArtifactRoot, { recursive: true });
  } else {
    cpSync(appPath, monorepoAppPath, { recursive: true });
  }
  console.log(`Monorepo Kenoma app: ${monorepoAppPath}`);
  console.log(`Monorepo executable: ${monorepoAppExecutable}`);
}

function printPaths() {
  const appPath = findBuiltAppPath();
  const appExecutable = findBuiltAppExecutable();
  console.log(`tmpRoot=${tmpRoot}`);
  console.log(`appPath=${appPath}`);
  console.log(`appExecutable=${appExecutable}`);
  console.log(`monorepoAppPath=${monorepoAppPath}`);
  console.log(`monorepoAppExecutable=${monorepoAppExecutable}`);
  console.log(`sourceRoot=${sourceRoot}`);
}

if (args.has("--paths")) {
  printPaths();
  process.exit(0);
}

ensureTmpClone();
withSyncLock(() => {
  syncForkjoinFiles();
  generateKenomaBranding();
  syncPostGeneratedBrandingFiles();
});

if (args.has("--sync-only")) {
  printPaths();
  console.log("Synced Forkjoin Firefox files into tmp build tree.");
  process.exit(0);
}

if (args.has("--verify-only")) {
  verifyBuiltArtifact();
  process.exit(0);
}

if (args.has("--mirror-only")) {
  verifyBuiltArtifact();
  mirrorBuiltAppToMonorepo();
  process.exit(0);
}

const machEnv = { ...process.env };
delete machEnv.PYTHON;
run(python, ["./mach", "--no-interactive", "build"], tmpRoot, configureWindowsMozconfig(machEnv));
verifyBuiltArtifact();
mirrorBuiltAppToMonorepo();
