import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { packageKenomaArchive } from './kenoma-archive.mjs';

function arm64MachO() {
  const bytes = new Uint8Array(8);
  bytes.set([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
  return bytes;
}

test('packages an unsigned Kenoma app with a content-addressed descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'kenoma-archive-test-'));
  const appPath = join(root, 'Kenoma.app');
  const executablePath = join(appPath, 'Contents', 'MacOS', 'firefox');
  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(executablePath, arm64MachO(), { mode: 0o755 });

  const commandCalls = [];
  const result = packageKenomaArchive({
    appPath,
    outputDirectory: join(root, 'out'),
    readBundleValue(_path, key) {
      return {
        CFBundleIdentifier: 'ai.forkjoin.kenoma',
        CFBundleExecutable: 'firefox',
        CFBundleShortVersionString: '144.0a1',
      }[key];
    },
    runCommand(command, args) {
      commandCalls.push([command, ...args]);
      if (command === 'codesign') return { status: 1 };
      assert.equal(command, 'ditto');
      const archivePath = args.at(-1);
      writeFileSync(archivePath, new TextEncoder().encode('fixture-archive'));
      return { status: 0 };
    },
  });

  assert.match(
    result.archivePath,
    /kenoma-144\.0a1-darwin-arm64-[0-9a-f]{16}\.zip$/
  );
  assert.deepEqual(commandCalls[1]?.slice(0, 5), [
    'ditto',
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
  ]);
  assert.equal(result.document.descriptor.fp64.length, 16);
  assert.equal(result.document.descriptor.byteLength, 15);
  assert.equal(result.document.descriptor.os, 'darwin');
  assert.equal(result.document.descriptor.arch, 'arm64');
  assert.equal(
    result.document.descriptor.entrypoint,
    'Kenoma.app/Contents/MacOS/firefox'
  );
  assert.equal(result.document.receipt.bundleIdentifier, 'ai.forkjoin.kenoma');
  assert.deepEqual(result.document.receipt.signing, {
    state: 'unsigned',
    codesignVerified: false,
  });
  assert.deepEqual(
    JSON.parse(readFileSync(result.descriptorPath, 'utf8')),
    result.document
  );
});

test('fails closed when the bundle executable is not a supported Mach-O', () => {
  const root = mkdtempSync(join(tmpdir(), 'kenoma-archive-test-'));
  const appPath = join(root, 'Kenoma.app');
  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(appPath, 'Contents', 'MacOS', 'firefox'), 'not-mach-o', {
    mode: 0o755,
  });

  assert.throws(
    () =>
      packageKenomaArchive({
        appPath,
        outputDirectory: join(root, 'out'),
        readBundleValue(_path, key) {
          return key === 'CFBundleExecutable'
            ? 'firefox'
            : key === 'CFBundleIdentifier'
              ? 'ai.forkjoin.kenoma'
              : '144.0a1';
        },
        runCommand() {
          return { status: 1 };
        },
      }),
    /unsupported Mach-O architecture/
  );
});
