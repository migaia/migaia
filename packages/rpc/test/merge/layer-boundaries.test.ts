import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Source root whose dependency direction is enforced by A2. */
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src')
/** Only byte classification and error identity utilities may cross into contract. */
const contractBareAllowlist = new Set(['@migaia/utils/bytes', '@migaia/utils/error'])
/** Published adapter boundary: shared primitives, errors, and local text only. */
const browserCoreAllowlist = new Set(['core/transport-kit.ts', 'core/errors.ts'])

/** Return each import or re-export that violates the contract/core/browser direction. */
function layerViolations(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const owner = relative(sourceRoot, file).split(sep)[0]
  const failures: string[] = []
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const isRelative = specifier.startsWith('.')
    const resolved = isRelative ? resolve(dirname(file), specifier.replace(/\.js$/, '.ts')) : ''
    const target = isRelative ? relative(sourceRoot, resolved).split(sep).join('/') : ''
    const outside = isRelative && (target === '..' || target.startsWith('../'))
    let invalid = !isRelative && specifier.startsWith('@migaia/rpc/')
    if (owner === 'contract')
      invalid ||= isRelative
        ? outside || !target.startsWith('contract/')
        : !contractBareAllowlist.has(specifier)
    if (owner === 'core')
      invalid ||= outside || target.startsWith('browser/') || target.startsWith('remote/')
    if (owner === 'remote') invalid ||= outside || target.startsWith('browser/')
    if (owner === 'browser') {
      invalid ||=
        outside ||
        (!isRelative && specifier !== '@migaia/utils/bytes') ||
        (target.startsWith('core/') && !browserCoreAllowlist.has(target))
    }
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
  it('accepts the complete real source tree', () => {
    const failures = sourceFiles(sourceRoot).flatMap((file) =>
      layerViolations(file, readFileSync(file, 'utf8'))
    )
    expect(failures).toEqual([])
  })

  it.each([
    ['contract bare import', 'contract/x.ts', "import '@migaia/utils'"],
    ['contract to core', 'contract/framing/x.ts', "import '../../core/errors.js'"],
    ['core to browser', 'core/x.ts', "import '../browser/adapters/window.js'"],
    ['core to remote', 'core/x.ts', "import '../remote/host.js'"],
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
    ['remote to core', 'remote/host.ts', "import '../core/typing.js'"]
  ])('accepts %s', (_case, file, source) => {
    expect(layerViolations(join(sourceRoot, file), source)).toEqual([])
  })
})
