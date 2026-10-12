import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Source root whose dependency direction is enforced by A2. */
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core/src')
/** Actual independent owner roots make the source-tree assertion non-vacuous after physical split. */
const ownerRoots = [
  'rpc-contract',
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-bridge-jsonrpc',
  'rpc-browser'
].map((owner) => ({ owner, root: resolve(import.meta.dirname, '../../..', owner, 'src') }))
/** Ordinary package entries are checked against real manifests, never against a wildcard path. */
const ordinaryRpcEntries = new Set(
  ownerRoots.flatMap(({ root }) => {
    const manifest = JSON.parse(readFileSync(join(root, '../package.json'), 'utf8')) as {
      name: string
      exports: Record<string, unknown>
    }
    return Object.keys(manifest.exports).map(
      (key) => manifest.name + (key === '.' ? '' : key.slice(1))
    )
  })
)
/** The mandatory six-owner graph permits only inward ordinary RPC dependencies. */
const inwardOwners: Record<string, readonly string[]> = {
  'rpc-contract': [],
  'rpc-core': ['rpc-contract'],
  'rpc-process': ['rpc-core', 'rpc-contract'],
  'rpc-threads': ['rpc-core', 'rpc-contract'],
  'rpc-bridge-jsonrpc': ['rpc-process', 'rpc-core', 'rpc-contract'],
  'rpc-browser': ['rpc-core', 'rpc-contract']
}
/**
 * Logical foundation labels retain the existing synthetic directional cases without merging package
 * roots.
 */
function logicalPath(file: string): string {
  const entry = ownerRoots.find(({ root }) => file.startsWith(root + sep))
  return entry
    ? relative(entry.root, file).split(sep).join('/')
    : relative(sourceRoot, file).split(sep).join('/')
}

/** Contract portable traversal depends inward on serialize alongside byte/error utilities. */
const contractBareAllowlist = new Set([
  '@migaia/serialize',
  '@migaia/utils/bytes',
  '@migaia/utils/error'
])
/** Published adapter boundary: shared primitives, errors, and local text only. */
const browserCoreAllowlist = new Set(['core/transport-kit.ts', 'core/index.ts'])

/** Return each import or re-export that violates the contract/core/browser direction. */
function layerViolations(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const owner = logicalPath(file).split('/')[0]
  const physicalOwner = ownerRoots.find(({ root }) => file.startsWith(root + sep))
  const failures: string[] = []
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const isRelative = specifier.startsWith('.')
    const resolved = isRelative ? resolve(dirname(file), specifier.replace(/\.js$/, '.ts')) : ''
    const target = isRelative ? logicalPath(resolved) : ''
    const outside =
      isRelative &&
      (physicalOwner
        ? !resolved.startsWith(physicalOwner.root + sep)
        : target === '..' || target.startsWith('../'))
    let invalid = !isRelative && specifier.startsWith('@migaia/rpc/')
    if (!isRelative && specifier.startsWith('@migaia/rpc-')) {
      const targetOwner = specifier.slice('@migaia/'.length).split('/')[0]!
      invalid ||=
        !ordinaryRpcEntries.has(specifier) ||
        Boolean(physicalOwner && !inwardOwners[physicalOwner.owner]!.includes(targetOwner))
    }
    if (owner === 'contract')
      invalid ||= isRelative
        ? outside || !target.startsWith('contract/')
        : !contractBareAllowlist.has(specifier)
    if (owner === 'threads')
      invalid ||= outside || target.startsWith('process/') || target.startsWith('browser/')
    if (owner === 'process')
      invalid ||= target.startsWith('threads/') || target.startsWith('browser/')
    if (owner === 'core')
      invalid ||=
        outside ||
        target.startsWith('browser/') ||
        target.startsWith('remote/') ||
        target.startsWith('bridge/') ||
        target.startsWith('threads/')
    if (owner === 'remote')
      invalid ||= outside || target.startsWith('browser/') || target.startsWith('threads/')
    if (owner === 'browser') {
      invalid ||= target.startsWith('process/') || target.startsWith('threads/')
      invalid ||=
        outside ||
        (!isRelative &&
          specifier !== '@migaia/utils/bytes' &&
          specifier !== '@migaia/utils/error' &&
          specifier !== '@migaia/utils/scheduler' &&
          specifier !== '@migaia/utils/promise' &&
          !ordinaryRpcEntries.has(specifier)) ||
        (target.startsWith('core/') && !browserCoreAllowlist.has(target))
    }
    if (owner === 'bridge')
      invalid ||=
        outside ||
        /^(?:browser|threads)\//.test(target) ||
        /^process\/(?:plugin|host|resilience)\//.test(target) ||
        /^remote\/(?:plugin|host|serve-plugin|serve-host)\.ts$/.test(target)
    if (isRelative && extname(specifier) !== '.js') invalid = true
    if (invalid) failures.push(`${relative(sourceRoot, file)}: ${specifier}`)
  }
  return failures
}

/** List TypeScript files under a layer without relying on a glob loader. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('A2 layer dependency direction', () => {
  it('[A10] keeps remote retry independent of process and coroutine launchers', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../rpc-core/src/remote/retry.ts'),
      'utf8'
    )
    const parsed = ts.createSourceFile('retry.ts', source, ts.ScriptTarget.Latest, true)
    const imports = parsed.statements
      .filter(ts.isImportDeclaration)
      .map((statement) =>
        ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ''
      )
    expect(imports.some((specifier) => /(?:process|threads|coroutine)/.test(specifier))).toBe(false)
  })

  it('accepts the complete real source tree', () => {
    const failures = ownerRoots.flatMap(({ root }) =>
      sourceFiles(root).flatMap((file) => layerViolations(file, readFileSync(file, 'utf8')))
    )
    expect(failures).toEqual([])
  })

  it.each([
    ['threads to process', 'threads/plugin.ts', "import '../process/index.js'"],
    ['threads to browser', 'threads/plugin.ts', "import '../browser/adapters/shared-worker.js'"],
    ['process to threads', 'process/x.ts', "import '../threads/index.js'"],
    ['browser to threads', 'browser/x.ts', "import '../threads/index.js'"],
    ['core to threads', 'core/x.ts', "import '../threads/index.js'"],
    ['remote to threads', 'remote/x.ts', "import '../threads/index.js'"],
    ['contract bare import', 'contract/x.ts', "import '@migaia/utils'"],
    ['contract to core', 'contract/framing/x.ts', "import '../../core/errors.js'"],
    ['core to browser', 'core/x.ts', "import '../browser/adapters/window.js'"],
    ['core to remote', 'core/x.ts', "import '../remote/host.js'"],
    ['core to bridge', 'core/x.ts', "import '../bridge/jsonrpc/index.js'"],
    ['bridge to process plugin', 'bridge/jsonrpc/x.ts', "import '../../process/plugin/client.js'"],
    ['remote to browser', 'remote/x.ts', "import '../browser/adapters/window.js'"],
    ['browser to private core', 'browser/x.ts', "import '../../core/internal/outbound-sender.js'"],
    ['browser bare import', 'browser/x.ts', "import '@migaia/lifecycle'"],
    ['browser escape', 'browser/x.ts', "import '../../../outside.js'"],
    ['core self-reference', 'core/x.ts', "import '@migaia/rpc/contract'"],
    ['browser re-export', 'browser/x.ts', "export * from '../../core/internal/outbound-sender.js'"],
    ['contract re-export', 'contract/x.ts', "export { x } from '../core/errors.js'"]
  ])('rejects %s once', (_case, file, source) => {
    expect(layerViolations(join(sourceRoot, file), source)).toHaveLength(1)
  })

  it.each([
    ['contract byte utility', 'contract/normalize.ts', "import '@migaia/utils/bytes'"],
    ['contract error utility', 'contract/contract-error.ts', "import '@migaia/utils/error'"],
    ['browser sibling', 'browser/adapters/window.ts', "import './broadcast-channel.js'"],
    ['browser approved core', 'browser/adapters/window.ts', "import '../../core/transport-kit.js'"],
    ['browser bytes', 'browser/adapters/web-transport.ts', "import '@migaia/utils/bytes'"],
    ['remote to core', 'remote/host.ts', "import '../core/typing.js'"],
    ['bridge IPC owner', 'bridge/jsonrpc/x.ts', "import '../../process/ipc-connection.js'"],
    ['bridge remote schema', 'bridge/jsonrpc/x.ts', "import '../../remote/contract.js'"]
  ])('accepts %s', (_case, file, source) => {
    expect(layerViolations(join(sourceRoot, file), source)).toEqual([])
  })
})
