import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cacheFingerprint64HexSync } from '../../bitwise/cache-fp64.js';

const DEFAULT_APP = resolve('build/forkjoin/Kenoma.app');
const DEFAULT_OUTPUT = resolve('build/forkjoin/archive');

function defaultRunCommand(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function defaultReadBundleValue(infoPlistPath, key) {
  const result = defaultRunCommand('plutil', [
    '-extract',
    key,
    'raw',
    '-o',
    '-',
    infoPlistPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`unable to read ${key} from ${infoPlistPath}: ${result.stderr || 'plutil failed'}`);
  }
  return result.stdout.trim();
}

function requireBundleValue(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`missing ${key} in Kenoma Info.plist`);
  }
  return value.trim();
}

function machOArchitecture(bytes) {
  if (bytes.length < 8) return undefined;
  const magic = bytes.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe') {
    const cpuType = bytes.readUInt32LE(4);
    if (cpuType === 0x0100000c) return 'arm64';
    if (cpuType === 0x01000007) return 'x64';
  }
  if (magic === 'feedfacf') {
    const cpuType = bytes.readUInt32BE(4);
    if (cpuType === 0x0100000c) return 'arm64';
    if (cpuType === 0x01000007) return 'x64';
  }
  return undefined;
}

function safeNamePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

export function packageKenomaArchive({
  appPath = DEFAULT_APP,
  outputDirectory = DEFAULT_OUTPUT,
  readBundleValue = defaultReadBundleValue,
  runCommand = defaultRunCommand,
} = {}) {
  const resolvedAppPath = resolve(appPath);
  const infoPlistPath = join(resolvedAppPath, 'Contents', 'Info.plist');
  if (!existsSync(resolvedAppPath) || !statSync(resolvedAppPath).isDirectory()) {
    throw new Error(`Kenoma app bundle not found: ${resolvedAppPath}`);
  }

  const bundleIdentifier = requireBundleValue(
    readBundleValue(infoPlistPath, 'CFBundleIdentifier'),
    'CFBundleIdentifier'
  );
  const executableName = requireBundleValue(
    readBundleValue(infoPlistPath, 'CFBundleExecutable'),
    'CFBundleExecutable'
  );
  const bundleVersion = requireBundleValue(
    readBundleValue(infoPlistPath, 'CFBundleShortVersionString'),
    'CFBundleShortVersionString'
  );
  if (basename(executableName) !== executableName) {
    throw new Error(`invalid CFBundleExecutable: ${executableName}`);
  }

  const executablePath = join(resolvedAppPath, 'Contents', 'MacOS', executableName);
  const executableBytes = readFileSync(executablePath);
  const arch = machOArchitecture(executableBytes);
  if (!arch) throw new Error(`unsupported Mach-O architecture: ${executablePath}`);

  const executableFp64 = cacheFingerprint64HexSync(executableBytes);
  const archiveName = [
    'kenoma',
    safeNamePart(bundleVersion),
    'darwin',
    arch,
    executableFp64,
  ].join('-') + '.zip';
  const resolvedOutputDirectory = resolve(outputDirectory);
  const archivePath = join(resolvedOutputDirectory, archiveName);
  mkdirSync(resolvedOutputDirectory, { recursive: true });

  const signatureCheck = runCommand('codesign', [
    '--verify',
    '--deep',
    '--strict',
    resolvedAppPath,
  ]);
  const archiveResult = runCommand('ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    resolvedAppPath,
    archivePath,
  ]);
  if (archiveResult.status !== 0) {
    throw new Error(`ditto failed to package Kenoma: ${archiveResult.stderr || 'unknown error'}`);
  }

  const archiveBytes = readFileSync(archivePath);
  const descriptorPath = `${archivePath}.json`;
  const document = {
    schema: 'kenoma-archive-publication.v1',
    descriptor: {
      path: basename(archivePath),
      contentType: 'application/zip',
      fp64: cacheFingerprint64HexSync(archiveBytes),
      byteLength: archiveBytes.byteLength,
      os: 'darwin',
      arch,
      entrypoint: `${basename(resolvedAppPath)}/Contents/MacOS/${executableName}`,
    },
    receipt: {
      schema: 'kenoma-archive-receipt.v1',
      ok: true,
      bundleIdentifier,
      bundleVersion,
      executableFp64,
      archiveMethod: 'ditto-zip-keep-parent',
      signing: {
        state: signatureCheck.status === 0 ? 'signed' : 'unsigned',
        codesignVerified: signatureCheck.status === 0,
      },
    },
  };
  writeFileSync(descriptorPath, `${JSON.stringify(document, null, 2)}\n`);
  return { archivePath, descriptorPath, document };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = packageKenomaArchive({
    appPath: argumentValue('--app') || DEFAULT_APP,
    outputDirectory: argumentValue('--out') || DEFAULT_OUTPUT,
  });
  process.stdout.write(`${JSON.stringify(result.document, null, 2)}\n`);
}
