import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
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
    const packedFiles = readdirSync(join(packedPackage, 'dist'), { recursive: true });
    if (
      packedFiles.some((entry) => {
        const filePath = join(packedPackage, 'dist', String(entry));
        return (
          existsSync(filePath) &&
          statSync(filePath).isFile() &&
          readFileSync(filePath, 'utf8').includes('setSubscriptionReleaseProbe')
        );
      })
    ) {
      throw new Error('packed artifact contains subscription probe instrumentation');
    }
    symlinkSync(
      packedPackage,
      join(consumerDirectory, 'node_modules', '@migaia/event-subscriber'),
      'dir'
    );
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');
    writeFileSync(
      join(consumerDirectory, 'runtime.mjs'),
      "import { createEventChannel, createEventHub } from '@migaia/event-subscriber';\nconst channel = createEventChannel(); const legacy = channel.subscribe(() => {}); if (legacy.unsubscribe !== legacy) throw new Error('legacy self identity'); const chain = legacy.subscribe(() => {}); chain.unsubscribe(); if (channel.size !== 0) throw new Error('channel chain close'); const hub = createEventHub(); const hubHandle = hub.subscribe('ready', () => {}); if (hubHandle.unsubscribe !== hubHandle) throw new Error('hub self identity'); hubHandle.subscribe('done', () => {}); hubHandle(); if (hub.size() !== 0) throw new Error('hub chain close');\n",
      'utf8'
    );
    writeFileSync(
      join(consumerDirectory, 'types.ts'),
      "import { createEventChannel, createEventHub, type IEventChannelSubscription, type IEventHubSubscription, type IEventContext } from '@migaia/event-subscriber';\nconst channel = createEventChannel<number>();\nconst listener = (event: IEventContext<number>): void => { void event.value; };\nconst channelHandle: IEventChannelSubscription<number> = channel.subscribe(listener);\nchannelHandle.subscribe(listener);\nconst hub = createEventHub<{ ready: number; done: string }>();\nconst hubHandle: IEventHubSubscription<{ ready: number; done: string }, 'ready'> = hub.subscribe('ready', listener);\nhubHandle.subscribe('done', (event) => { const value: string = event.value; void value; });\n// @ts-expect-error finite key cannot repeat in one chain\nhubHandle.subscribe('ready', listener);\nconst wide = createEventHub<Record<string, number>>();\nwide.subscribe('dynamic', listener).subscribe('dynamic', listener);\n",
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
