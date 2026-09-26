import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type IManifest = {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, Readonly<{ optional?: boolean }>>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/** Package root for manifest, documentation, and actual source inventory. */
const packageRoot = resolve(import.meta.dirname, '..')

/** Required peer ranges and package-local test versions from A1. */
const optionalPeers = {
  '@bufbuild/protobuf': { peer: '^2.14.0', dev: '2.14.0' },
  '@msgpack/msgpack': { peer: '^3.1.3', dev: '3.1.3' },
  'cbor-x': { peer: '^1.6.6', dev: '1.6.6' }
} as const

/** Read the package declaration used by both manifest and source rules. */
const readManifest = (): IManifest =>
  JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as IManifest

/** Collect source files under src without assuming codec directories are flat. */
const readSources = (directory: string): Record<string, string> => {
  const sources: Record<string, string> = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(sources, readSources(path))
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
      sources[relative(packageRoot, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8')
  }
  return sources
}

/** Extract static, side-effect, re-export, and literal dynamic imports from TypeScript syntax. */
const bareSpecifiers = (file: string, source: string): string[] => {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return specifiers.filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'))
}

/** Resolve scoped and unscoped subpaths to their owning package. */
const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
}

/** Report exactly one violation per forbidden dependency or import occurrence. */
const dependencyViolations = (
  manifest: IManifest,
  sources: Readonly<Record<string, string>>
): string[] => {
  const violations: string[] = []
  const peers = new Set(
    Object.keys(manifest.peerDependencies ?? {}).filter(
      (name) => manifest.peerDependenciesMeta?.[name]?.optional === true
    )
  )
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!name.startsWith('@migaia/')) violations.push(`dependency: ${name}`)
  }
  for (const [file, source] of Object.entries(sources)) {
    const isCodec = file.startsWith('src/codecs/')
    for (const specifier of bareSpecifiers(file, source)) {
      const name = packageNameOf(specifier)
      if (isCodec && !name.startsWith('@migaia/') && !peers.has(name))
        violations.push(`${file}: undeclared optional peer ${specifier}`)
      if (!isCodec && peers.has(name))
        violations.push(`${file}: optional peer outside codecs ${specifier}`)
    }
  }
  return violations
}

/** Validate one documentation section without accepting commands from adjacent sections. */
const codecSections = (document: string): Readonly<Record<string, string>> => {
  const headings = [...document.matchAll(/^### (@migaia\/serialize\/codecs\/[^\n]+)$/gm)]
  return Object.fromEntries(
    headings.map((heading) => {
      const start = heading.index! + heading[0].length
      const next = /^#{2,3} /gm
      next.lastIndex = start
      return [heading[1]!, document.slice(start, next.exec(document)?.index ?? document.length)]
    })
  )
}

describe('serialize optional peer declaration', () => {
  it('A1 declares workspace-only dependencies and exact optional peer versions', () => {
    const manifest = readManifest()
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@migaia/lifecycle',
      '@migaia/utils'
    ])
    expect(manifest.peerDependencies).toEqual(
      Object.fromEntries(
        Object.entries(optionalPeers).map(([name, version]) => [name, version.peer])
      )
    )
    expect(Object.keys(manifest.peerDependenciesMeta ?? {}).sort()).toEqual(
      Object.keys(optionalPeers).sort()
    )
    for (const [name, version] of Object.entries(optionalPeers)) {
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true)
      expect(manifest.devDependencies?.[name]).toBe(version.dev)
    }
  })

  it('A2 scans actual sources and rejects every forbidden declaration/import form', () => {
    const manifest = readManifest()
    const sources = readSources(join(packageRoot, 'src'))
    const observed = Object.entries(sources).flatMap(([file, source]) =>
      bareSpecifiers(file, source).map((specifier) => ({ file, specifier }))
    )
    expect(observed).toEqual(
      expect.arrayContaining([
        { file: 'src/codecs/protobuf.ts', specifier: '@bufbuild/protobuf' },
        { file: 'src/codecs/message-pack.ts', specifier: '@msgpack/msgpack' },
        { file: 'src/codecs/cbor.ts', specifier: 'cbor-x' }
      ])
    )
    expect(dependencyViolations(manifest, sources)).toEqual([])

    const configuredManifest: IManifest = {
      dependencies: { '@migaia/lifecycle': 'workspace:^', '@migaia/utils': 'workspace:^' },
      peerDependencies: Object.fromEntries(
        Object.entries(optionalPeers).map(([name, version]) => [name, version.peer])
      ),
      peerDependenciesMeta: Object.fromEntries(
        Object.keys(optionalPeers).map((name) => [name, { optional: true }])
      )
    }
    const fixtures: readonly Readonly<{
      manifest: IManifest
      sources: Readonly<Record<string, string>>
    }>[] = [
      {
        manifest: {
          ...configuredManifest,
          dependencies: { ...configuredManifest.dependencies, 'cbor-x': '1.6.6' }
        },
        sources: {}
      },
      { manifest: configuredManifest, sources: { 'src/codecs/x.ts': "import { a } from 'yaml'" } },
      { manifest: configuredManifest, sources: { 'src/codecs/x.ts': "export * from 'yaml'" } },
      { manifest: configuredManifest, sources: { 'src/codecs/x.ts': "await import('yaml')" } },
      { manifest: configuredManifest, sources: { 'src/codecs/x.ts': "import 'yaml'" } },
      {
        manifest: configuredManifest,
        sources: { 'src/codecs/x.ts': "import {\n  a,\n  b\n} from 'yaml'" }
      },
      {
        manifest: configuredManifest,
        sources: { 'src/registry.ts': "import '@msgpack/msgpack'" }
      },
      {
        manifest: configuredManifest,
        sources: { 'src/registry.ts': "import '@bufbuild/protobuf/codegenv2'" }
      },
      { manifest: configuredManifest, sources: { 'src/registry.ts': "import 'cbor-x/decode'" } }
    ]
    for (const fixture of fixtures)
      expect(dependencyViolations(fixture.manifest, fixture.sources)).toHaveLength(1)
    expect(
      dependencyViolations(configuredManifest, {
        'src/codecs/x.ts': "import '@bufbuild/protobuf/codegenv2'"
      })
    ).toEqual([])
    expect(
      dependencyViolations(configuredManifest, { 'src/codecs/x.ts': "import 'cbor-x/decode'" })
    ).toEqual([])
  })

  it('A4 explains installation and missing-peer errors for every codec in both guides', () => {
    const commands = {
      '@migaia/serialize/codecs/protobuf': 'pnpm add @bufbuild/protobuf',
      '@migaia/serialize/codecs/message-pack': 'pnpm add @msgpack/msgpack',
      '@migaia/serialize/codecs/cbor': 'pnpm add cbor-x'
    } as const
    for (const guide of ['README.md', 'USEGUIDE.md']) {
      const sections = codecSections(readFileSync(join(packageRoot, guide), 'utf8'))
      expect(Object.keys(sections)).toEqual(Object.keys(commands))
      for (const [heading, command] of Object.entries(commands)) {
        const section = sections[heading]!
        expect(section).toContain(command)
        expect(section).toContain('ERR_MODULE_NOT_FOUND')
        for (const other of Object.values(commands)) {
          if (other !== command) expect(section).not.toContain(other)
        }
      }
    }
  })
})
