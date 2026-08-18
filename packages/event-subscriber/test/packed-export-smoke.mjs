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
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-event-subscriber-packed-'));
const extractDirectory = join(smokeDirectory, 'extract');
const consumerDirectory = join(smokeDirectory, 'consumer');

/**
 * Verifies the published root at both runtime and TypeScript declaration resolution boundaries. The
 * package is resolved from an extracted tarball, never from the workspace source tree.
 */
function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true });
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true });
    const packedPackage = join(extractDirectory, 'package');
    execFileSync('tar', ['-xzf', pack(), '-C', extractDirectory]);
    symlinkSync(
      packedPackage,
      join(consumerDirectory, 'node_modules', '@migaia/event-subscriber'),
      'dir'
    );
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');
    writeFileSync(
      join(consumerDirectory, 'runtime.mjs'),
      "await import('@migaia/event-subscriber');\n",
      'utf8'
    );
    writeFileSync(
      join(consumerDirectory, 'types.ts'),
      "import { createEventChannel, type IEventContext } from '@migaia/event-subscriber';\nconst channel = createEventChannel<number>();\nconst listener = (event: IEventContext<number>): void => { void event.value; };\nchannel.subscribe(listener);\n",
      'utf8'
    );
    execFileSync(process.execPath, [join(consumerDirectory, 'runtime.mjs')], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    });
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsc',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'types.ts'
      ],
      { cwd: consumerDirectory, stdio: 'inherit' }
    );
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true });
  }
}

/** Packs the current package and returns the only generated tarball. */
function pack() {
  const packDirectory = join(smokeDirectory, 'pack');
  mkdirSync(packDirectory, { recursive: true });
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  });
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0])))
    throw new Error(`Expected exactly one event-subscriber tarball, found ${tarballs.length}`);
  return join(packDirectory, tarballs[0]);
}

main();
