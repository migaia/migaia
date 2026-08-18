import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(packageDirectory, '../..');
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-packed-'));
const extractDirectory = join(smokeDirectory, 'extract');
const consumerDirectory = join(smokeDirectory, 'consumer');
const packageDependencies = ['event-subscriber', 'lifecycle'];
const publicSubpaths = [
  './protocol-constants',
  './adapters/window',
  './adapters/message-port',
  './adapters/web-worker',
  './adapters/broadcast-channel',
  './adapters/memory',
  './adapters/shared-worker',
  './adapters/service-worker',
  './adapters/rtc-data-channel',
  './adapters/web-transport'
];
const obsoleteSubpaths = ['./memory', './message-port', './web-worker'];

/**
 * Packs web-rpc, resolves it from a clean consumer directory, and checks both every declared public
 * subpath and the removed legacy adapter paths.
 */
function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true });
    execFileSync('tar', ['-xzf', pack(), '-C', extractDirectory]);
    const packedPackage = join(extractDirectory, 'package');
    const dependencyDirectory = join(extractDirectory, 'node_modules', '@migaia');
    const consumerDependencyDirectory = join(consumerDirectory, 'node_modules', '@migaia');
    mkdirSync(dependencyDirectory, { recursive: true });
    mkdirSync(consumerDependencyDirectory, { recursive: true });
    symlinkSync(packedPackage, join(consumerDependencyDirectory, 'web-rpc'), 'dir');
    for (const dependency of packageDependencies) {
      const workspacePackage = resolve(repositoryRoot, `packages/${dependency}`);
      symlinkSync(workspacePackage, join(dependencyDirectory, dependency), 'dir');
    }
    const consumerModule = join(consumerDirectory, 'smoke.mjs');
    writeFileSync(consumerModule, createSmokeModule(), 'utf8');
    execFileSync(process.execPath, [consumerModule], { cwd: consumerDirectory, stdio: 'inherit' });
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true });
  }
}

/** Creates the consumer module used to force Node's package export-map resolution. */
function createSmokeModule() {
  const publicImports = [
    "await import('@migaia/web-rpc');",
    ...publicSubpaths.map((subpath) => `await import('@migaia/web-rpc${subpath.slice(1)}');`)
  ].join('\n');
  const obsoleteImports = obsoleteSubpaths
    .map((subpath) => `await expectNotExported('@migaia/web-rpc${subpath.slice(1)}');`)
    .join('\n');
  return `
async function expectNotExported(specifier) {
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    throw error;
  }
  throw new Error('Legacy web-rpc subpath unexpectedly resolved: ' + specifier);
}

${publicImports}
${obsoleteImports}
`;
}

/** Packs the current package and returns the generated tarball path. */
function pack() {
  const packDirectory = join(smokeDirectory, 'pack');
  mkdirSync(packDirectory, { recursive: true });
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  });
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0]))) {
    throw new Error(`Expected exactly one web-rpc tarball, found ${tarballs.length}`);
  }
  return join(packDirectory, tarballs[0]);
}

main();
