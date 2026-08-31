import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root used as the source of the publish-boundary tarball. */
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Isolated consumer workspace proving the tarball instead of workspace source. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-utils-packed-'))

/** Packs utils, installs it by symlink in an isolated consumer, and typechecks `/typing`. */
function main() {
  try {
    const packDirectory = join(smokeDirectory, 'pack')
    const extractDirectory = join(smokeDirectory, 'extract')
    const consumerDirectory = join(smokeDirectory, 'consumer')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true })
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory,
      stdio: 'inherit'
    })
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1)
      throw new Error(`Expected one utils tarball, found ${tarballs.length}`)
    execFileSync('tar', ['-xzf', join(packDirectory, tarballs[0]), '-C', extractDirectory])
    symlinkSync(
      join(extractDirectory, 'package'),
      join(consumerDirectory, 'node_modules', '@migaia/utils'),
      'dir'
    )
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'types.ts'),
      "import { collect } from '@migaia/utils';\nimport type { IDiscriminatedByField, IDiscriminatedByPath, IObjectPathInput, IObjectPathValue } from '@migaia/utils/typing';\ntype IEvent = { type: 'created'; meta: { type: 'write' }; value: number } | { type: 'deleted'; meta: { type: 'delete' }; value: string };\ntype IByField = IDiscriminatedByField<'type', IEvent>;\ntype IByPath = IDiscriminatedByPath<IEvent, 'meta.type'>;\nconst created: IByField['created'] = { type: 'created', meta: { type: 'write' }, value: 1 };\nconst deleted: IByPath['delete'] = { type: 'deleted', meta: { type: 'delete' }, value: 'x' };\nconst path: IObjectPathInput<IEvent> = 'meta.type';\ntype IValue = IObjectPathValue<IEvent, typeof path>;\nconst value: IValue = 'write';\nconst collector = collect([created, deleted]);\n// @ts-expect-error field predicates require fieldBy\ncollector.like('write');\nconst collected = collector.fieldBy('meta.type').equals('write').result;\nvoid created; void deleted; void value; void collected;\n",
      'utf8'
    )
    writeFileSync(
      join(consumerDirectory, 'bytes.mjs'),
      "import { collect, createAbortTimeoutSignal as rootAbortTimeoutSignal, format as rootFormat, formatNumber as rootFormatNumber, isEmptyValue as rootIsEmptyValue, toPromise as rootToPromise } from '@migaia/utils'\nimport { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'\nimport { formatNumber } from '@migaia/utils/number'\nimport { createAbortTimeoutSignal, toPromise } from '@migaia/utils/promise'\nimport { format } from '@migaia/utils/string'\nimport { isEmptyValue } from '@migaia/utils/value'\nif (rootAbortTimeoutSignal !== createAbortTimeoutSignal) throw new Error('abort-timeout export identity failed')\nif (rootToPromise !== toPromise) throw new Error('toPromise export identity failed')\nif (rootFormat !== format || rootFormatNumber !== formatNumber || rootIsEmptyValue !== isEmptyValue) throw new Error('new utility export identity failed')\nif (await toPromise(() => 42) !== 42) throw new Error('toPromise packed runtime failed')\nif (!isUint8Array(new Uint8Array(1))) throw new Error('Uint8Array guard failed')\nif (!isArrayBuffer(new ArrayBuffer(1))) throw new Error('ArrayBuffer guard failed')\nif (format('value={value}', { value: 0 }) !== 'value=0') throw new Error('format packed runtime failed')\nif (formatNumber(1234, { locales: 'en-US' }) !== '1,234') throw new Error('number packed runtime failed')\nif (!isEmptyValue('  ')) throw new Error('value packed runtime failed')\nconst collected = collect([{ profile: { name: 'Ada' } }, {}]).fieldBy('profile.name').like('ada').result\nif (collected.length !== 1 || collected[0].profile.name !== 'Ada') throw new Error('collector packed runtime failed')\nconst merged = createAbortTimeoutSignal({ timeoutMs: 0, timeoutReason: () => 'packed deadline' })\nif (!merged.signal?.aborted || merged.signal.reason !== 'packed deadline') throw new Error('abort-timeout signal failed')\nmerged.dispose()\n",
      'utf8'
    )
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
    )
    execFileSync(process.execPath, ['bytes.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
