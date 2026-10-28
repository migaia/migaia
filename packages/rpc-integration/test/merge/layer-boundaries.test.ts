import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Source root whose dependency direction is enforced here. */
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-host/src')
/** Actual independent owner roots make the source-tree assertion non-vacuous after physical split. */
const ownerRoots = [
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser'
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
/** The mandatory five-owner graph permits only inward ordinary RPC dependencies. */
const inwardOwners: Record<string, readonly string[]> = {
  'rpc-contract': [],
  'rpc-host': ['rpc-contract'],
  'rpc-plugin-process': ['rpc-host', 'rpc-contract'],
  'rpc-plugin-thread': ['rpc-host', 'rpc-contract'],
  'rpc-plugin-browser': ['rpc-host', 'rpc-contract']
}
/**
 * Contract portable traversal depends inward on serialize alongside byte/error utilities, and on
 * utils/function so the framer observes thenable rejections instead of swallowing them.
 */
const contractBareAllowlist = new Set([
  '@migaia/serialize',
  '@migaia/serialize/core',
  '@migaia/utils/bytes',
  '@migaia/utils/error',
  '@migaia/utils/function',
  '@migaia/utils/string'
])
/** Return each import or re-export that violates the current physical package direction. */
function layerViolations(file: string, source: string): string[] {
  /** Actual package roots remain independent after the old core/remote directories were removed. */
  const owner = ownerRoots.find(({ root }) => file.startsWith(root + sep))!
  /** The parser distinguishes source edges from documentation strings and comments. */
  const parsed = parseSync(file, source).program
  /** Exact source edges retain actionable package-relative diagnostics. */
  const failures: string[] = []
  for (const statement of parsed.body) {
    /** Import and re-export have the same ownership obligation. */
    const specifier =
      statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration'
        ? statement.source.value
        : statement.type === 'ExportNamedDeclaration'
          ? statement.source?.value
          : undefined
    if (specifier === undefined) continue
    /** Source imports name their actual TypeScript source files. */
    const isRelative = specifier.startsWith('.')
    /** No package may reach a sibling's private files, including through re-exports. */
    const resolved = isRelative ? resolve(dirname(file), specifier) : ''
    let invalid =
      isRelative && (!resolved.startsWith(owner.root + sep) || extname(specifier) !== '.ts')
    if (!isRelative && specifier.startsWith('@migaia/rpc/')) invalid = true
    if (!isRelative && specifier.startsWith('@migaia/rpc-')) {
      /** Ordinary entries must exist and point inward to the owning package's public surface. */
      const target = specifier.slice('@migaia/'.length).split('/')[0]!
      invalid ||= !ordinaryRpcEntries.has(specifier) || !inwardOwners[owner.owner]!.includes(target)
    }
    if (owner.owner === 'rpc-contract' && !isRelative) {
      /** Signal shapes are type-only contracts; no promise runtime or lifecycle enters contract. */
      const signalType =
        specifier === '@migaia/utils/promise' &&
        statement.type === 'ImportDeclaration' &&
        statement.importKind === 'type'
      invalid ||= !signalType && !contractBareAllowlist.has(specifier)
    }
    if (owner.owner === 'rpc-host' && !isRelative) invalid ||= /^(?:node:|bun:)/u.test(specifier)
    if (invalid) failures.push(`${owner.owner}/${relative(owner.root, file)}: ${specifier}`)
  }
  return failures
}

/** Synthetic edges use the same real package roots as maintained production sources. */
function ownerFile(owner: string, path: string): string {
  return join(ownerRoots.find((entry) => entry.owner === owner)!.root, path)
}

/** List TypeScript files under a layer without relying on a glob loader. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('layer dependency direction', () => {
  it('keeps five Host runtime dependencies and one exact Contract peer', () => {
    /** Borrows the application's Contract peer while Host retains five runtime dependencies. */
    const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@migaia/lifecycle',
      '@migaia/plugin-host',
      '@migaia/serialize',
      '@migaia/supervision',
      '@migaia/utils'
    ])
    expect(manifest.peerDependencies['@migaia/rpc-contract']).toBe('workspace:*')
  })

  it('keeps the retry feature independent of process and coroutine launchers', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../rpc-host/src/features/retry.ts'),
      'utf8'
    )
    const imports = parseSync('retry.ts', source).program.body.flatMap((statement) =>
      statement.type === 'ImportDeclaration' ? [statement.source.value] : []
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
    [
      'thread to process',
      'rpc-plugin-thread',
      'threads/plugin.ts',
      "import '@migaia/rpc-plugin-process'"
    ],
    [
      'thread to browser',
      'rpc-plugin-thread',
      'threads/plugin.ts',
      "import '@migaia/rpc-plugin-browser'"
    ],
    [
      'process to thread',
      'rpc-plugin-process',
      'process/plugin.ts',
      "import '@migaia/rpc-plugin-thread'"
    ],
    [
      'browser to thread',
      'rpc-plugin-browser',
      'browser/plugin.ts',
      "import '@migaia/rpc-plugin-thread'"
    ],
    ['host to thread', 'rpc-host', 'host/rpc-host.ts', "import '@migaia/rpc-plugin-thread'"],
    ['host to process', 'rpc-host', 'features/retry.ts', "import '@migaia/rpc-plugin-process'"],
    ['contract bare import', 'rpc-contract', 'wire/frame.ts', "import '@migaia/utils'"],
    ['contract to host', 'rpc-contract', 'wire/frame.ts', "import '@migaia/rpc-host'"],
    ['host to browser', 'rpc-host', 'host/rpc-host.ts', "import '@migaia/rpc-plugin-browser'"],
    ['host to pool', 'rpc-host', 'host/rpc-host.ts', "import '@migaia/rpc-plugin-pool'"],
    ['contract to process', 'rpc-contract', 'wire/frame.ts', "import '@migaia/rpc-plugin-process'"],
    [
      'process to private host',
      'rpc-plugin-process',
      'process/plugin.ts',
      "import '../../../rpc-host/src/call/table.ts'"
    ],
    [
      'host to private browser',
      'rpc-host',
      'host/rpc-host.ts',
      "import '../../../rpc-plugin-browser/src/browser/plugin.ts'"
    ],
    [
      'browser to private host',
      'rpc-plugin-browser',
      'browser/plugin.ts',
      "import '../../../rpc-host/src/call/table.ts'"
    ],
    [
      'browser legacy import',
      'rpc-plugin-browser',
      'browser/plugin.ts',
      "import '@migaia/rpc/contract'"
    ],
    ['browser escape', 'rpc-plugin-browser', 'browser/plugin.ts', "import '../../../outside.ts'"],
    ['host self-reference', 'rpc-host', 'host/rpc-host.ts', "import '@migaia/rpc/contract'"],
    [
      'browser private re-export',
      'rpc-plugin-browser',
      'browser/plugin.ts',
      "export * from '../../../rpc-host/src/call/table.ts'"
    ],
    [
      'contract host re-export',
      'rpc-contract',
      'wire/frame.ts',
      "export { x } from '@migaia/rpc-host'"
    ]
  ])('rejects %s once', (_case, owner, file, source) => {
    expect(layerViolations(ownerFile(owner, file), source)).toHaveLength(1)
  })

  it.each([
    ['contract byte utility', 'rpc-contract', 'wire/frame.ts', "import '@migaia/utils/bytes'"],
    ['contract error utility', 'rpc-contract', 'contract/error.ts', "import '@migaia/utils/error'"],
    [
      'browser sibling',
      'rpc-plugin-browser',
      'browser/adapters/window.ts',
      "import './broadcast-channel.ts'"
    ],
    [
      'browser public SDK',
      'rpc-plugin-browser',
      'browser/plugin.ts',
      "import '@migaia/rpc-host/sdk'"
    ],
    [
      'browser bytes',
      'rpc-plugin-browser',
      'browser/adapters/web-transport.ts',
      "import '@migaia/utils/bytes'"
    ],
    [
      'host contract errors',
      'rpc-host',
      'host/error-owner.ts',
      "import '@migaia/rpc-contract/errors'"
    ],
    [
      'process public SDK',
      'rpc-plugin-process',
      'process/plugin.ts',
      "import '@migaia/rpc-host/sdk'"
    ],
    ['contract sibling owner', 'rpc-contract', 'contract/error.ts', "import '../wire/limits.ts'"]
  ])('accepts %s', (_case, owner, file, source) => {
    expect(layerViolations(ownerFile(owner, file), source)).toEqual([])
  })
})
