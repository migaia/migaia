import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root used as the source of the publish-boundary tarball. */
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** Isolated consumer workspace proving the tarball instead of workspace source. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-utils-packed-'));

/** Packs utils, installs it by symlink in an isolated consumer, and typechecks `/typing`. */
function main() {
  try {
    const packDirectory = join(smokeDirectory, 'pack');
    const extractDirectory = join(smokeDirectory, 'extract');
    const consumerDirectory = join(smokeDirectory, 'consumer');
    mkdirSync(packDirectory, { recursive: true });
    mkdirSync(extractDirectory, { recursive: true });
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true });
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory,
      stdio: 'inherit'
    });
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1)
      throw new Error(`Expected one utils tarball, found ${tarballs.length}`);
    execFileSync('tar', ['-xzf', join(packDirectory, tarballs[0]), '-C', extractDirectory]);
    symlinkSync(
      join(extractDirectory, 'package'),
      join(consumerDirectory, 'node_modules', '@migaia/utils'),
      'dir'
    );
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');
    writeFileSync(
      join(consumerDirectory, 'types.ts'),
      "import type { IDiscriminatedByField, IDiscriminatedByPath, IObjectPathInput, IObjectPathValue } from '@migaia/utils/typing';\ntype IEvent = { type: 'created'; meta: { type: 'write' }; value: number } | { type: 'deleted'; meta: { type: 'delete' }; value: string };\ntype IByField = IDiscriminatedByField<'type', IEvent>;\ntype IByPath = IDiscriminatedByPath<IEvent, 'meta.type'>;\nconst created: IByField['created'] = { type: 'created', meta: { type: 'write' }, value: 1 };\nconst deleted: IByPath['delete'] = { type: 'deleted', meta: { type: 'delete' }, value: 'x' };\nconst path: IObjectPathInput<IEvent> = 'meta.type';\ntype IValue = IObjectPathValue<IEvent, typeof path>;\nconst value: IValue = 'write';\nvoid created; void deleted; void value;\n",
      'utf8'
    );
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

main();
