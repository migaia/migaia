import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'bun:test'
import { parseSync } from 'oxc-parser'

/** Source and generated documentation share the website boundary. */
const website = fileURLToPath(new URL('../', import.meta.url))
/** Seven current package slugs replace the retired documentation owner. */
const loggingPackages = [
  'log-host',
  'log-plugin-console',
  'log-plugin-http',
  'log-plugin-file',
  'log-plugin-process',
  'log-plugin-reasoning',
  'log-plugin-durable'
] as const
/** Primary public factories must remain visible through real barrels and conditional entries. */
const loggingFactories = new Map([
  ['log-host:index', ['createLogHost', 'levelPlugin', 'forwardPlugin']],
  ['log-host:plugin', ['defineLogFeature', 'defineOutputPlugin', 'projectLogEntry']],
  ['log-plugin-console:index', ['consolePlugin', 'prettyFeature']],
  ['log-plugin-http:index', ['httpPlugin']],
  ['log-plugin-file:index', ['filePlugin']],
  ['log-plugin-process:index', ['processPlugin']],
  ['log-plugin-reasoning:index', ['reasoningPlugin']],
  ['log-plugin-durable:index', ['memoryLogStore', 'binlogPlugin', 'walPlugin', 'undoLogPlugin']],
  ['log-plugin-durable:file', ['fileLogStore']]
])
/** Generated module data is inspected without importing unpublished website runtime packages. */
type IGeneratedApi = { library: string; module: string; symbols: { name: string }[] }
/** Published runtime migration waits for the first registry release of the new packages. */
const runtimeAllowances = new Set(['package.json', 'bun.lock', 'app/log.ts', 'app/log-runtime.ts'])
/** Ignored build products and dependencies are not authored website documentation. */
const ignoredDirectories = new Set([
  'node_modules',
  'build',
  '.react-router',
  '.git',
  '.cache',
  'test-results',
  'playwright-report'
])
/** Only these fixed public RPC export names changed; subpaths and default local bindings did not. */
const rpcFactories = new Map([
  ['@migaia/rpc-host/features', new Set(['retry', 'timeout'])],
  [
    '@migaia/rpc-host/plugins',
    new Set(['auth', 'chunk', 'batch', 'errorMap', 'schema', 'limits', 'idempotency'])
  ],
  ['@migaia/rpc-plugin-process/features', new Set(['sendQueue', 'flowControl', 'ipcLog'])]
])
/** Existing direct subpaths identify the same original factory owners. */
const rpcLeaves = new Map([
  ['retry', 'retry'],
  ['timeout', 'timeout'],
  ['auth', 'auth'],
  ['chunk', 'chunk'],
  ['batch', 'batch'],
  ['error-map', 'errorMap'],
  ['schema', 'schema'],
  ['limits', 'limits'],
  ['idempotency', 'idempotency'],
  ['send-queue', 'sendQueue'],
  ['flow-control', 'flowControl'],
  ['log', 'ipcLog']
])

/** Enumerate maintained text without reading build output, binary assets or dependency sources. */
function sourceFiles(): string[] {
  /** Cursor traversal remains linear in the website tree. */
  const folders = [website]
  /** Each selected file is inspected once. */
  const files: string[] = []
  for (let cursor = 0; cursor < folders.length; cursor++) {
    for (const item of readdirSync(folders[cursor], { withFileTypes: true })) {
      /** Source-relative paths are stable across checkout locations. */
      const path = join(folders[cursor], item.name)
      if (item.isDirectory()) {
        if (!ignoredDirectories.has(item.name)) folders.push(path)
      } else if (/\.(?:ts|tsx|mts|mjs|json|md|mdx|lock)$/u.test(item.name)) files.push(path)
    }
  }
  return files
}

/** Recover the original exported key from an identifier or computed string member. */
function nodeName(node: any): string | undefined {
  return node?.type === 'Identifier'
    ? node.name
    : typeof node?.value === 'string'
      ? node.value
      : undefined
}

/** Match the aggregate or a declared direct subpath, leaving unrelated utils retry untouched. */
function retiredNames(module: string): ReadonlySet<string> | undefined {
  if (rpcFactories.has(module)) return rpcFactories.get(module)
  /** Exactly three compile-time public aggregates bound this lookup. */
  for (const [root, names] of rpcFactories)
    if (module.startsWith(root + '/')) {
      /** Direct-entry spellings remain unchanged by the feature rename. */
      const name = rpcLeaves.get(module.slice(root.length + 1))
      if (name && names.has(name)) return new Set([name])
    }
  return undefined
}

/** Parse with the website's existing parser and visit AST values once without evaluating examples. */
function nodes(code: string, path = 'website-example.ts'): any[] {
  /**
   * Partial prose snippets can have syntax diagnostics; complete import nodes still retain
   * ownership.
   */
  const pending: any[] = [parseSync(path, code).program]
  /** Oxc does not emit parent links, but identities still guard accidental repeated references. */
  const seen = new Set<object>()
  /** Only AST nodes enter the result; primitive prose does not become executable code. */
  const result: any[] = []
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** One AST or array value owns the next set of children. */
    const value = pending[cursor]
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (typeof value.type === 'string') result.push(value)
    for (const child of Object.values(value))
      if (child && typeof child === 'object') pending.push(child)
  }
  return result
}

/** Inspect named/static/dynamic/namespace reads according to their public source module. */
function retiredRpcReads(code: string, path?: string): string[] {
  /** Each module namespace retains its exact old-key set. */
  const namespaces = new Map<string, ReadonlySet<string>>()
  /** A finding names the exported key rather than an incidental local alias. */
  const findings: string[] = []
  /** Two linear passes first establish bindings, then inspect their member reads. */
  const parsed = nodes(code, path)
  for (const node of parsed) {
    if (node.type === 'ImportDeclaration') {
      /** Static imports identify named keys and namespace bindings directly. */
      const names = retiredNames(String(node.source.value))
      if (!names) continue
      for (const item of node.specifiers) {
        if (item.type === 'ImportNamespaceSpecifier') namespaces.set(item.local.name, names)
        else if (item.type === 'ImportSpecifier' && names.has(nodeName(item.imported)!))
          findings.push(nodeName(item.imported)!)
      }
    } else if (node.type === 'VariableDeclarator') {
      /** Await does not change the source of a dynamic import namespace. */
      const imported = node.init?.type === 'AwaitExpression' ? node.init.argument : node.init
      if (imported?.type !== 'ImportExpression') continue
      /** Literal module imports are the public documentation boundary. */
      const names = retiredNames(String(imported.source?.value))
      if (!names) continue
      if (node.id.type === 'Identifier') namespaces.set(node.id.name, names)
      else if (node.id.type === 'ObjectPattern')
        for (const property of node.id.properties)
          if (names.has(nodeName(property.key)!)) findings.push(nodeName(property.key)!)
    }
  }
  for (const node of parsed)
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
      /** Only a resolved namespace can make a same-named field an old factory read. */
      const names = namespaces.get(node.object.name)
      if (names?.has(nodeName(node.property)!)) findings.push(nodeName(node.property)!)
    }
  return findings
}

/** Decode JSON data without treating its object syntax as TypeScript source. */
function jsonStrings(source: string): string[] {
  /** Generated manifests are data trees with no cycles or executable getters. */
  const pending: unknown[] = [JSON.parse(source)]
  /** Only string values can contain authored code or emitted declaration examples. */
  const strings: string[] = []
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Each data value is visited once. */
    const value = pending[cursor]
    if (typeof value === 'string') strings.push(value)
    else if (value && typeof value === 'object') pending.push(...Object.values(value))
  }
  return strings
}

/** Decode maintained code fences and authored string literals without evaluating them. */
function codeExamples(source: string, path: string): string[] {
  if (path.endsWith('.json')) return jsonStrings(source)
  if (/\.mdx?$/u.test(path))
    return [...source.matchAll(/```(?:ts|tsx|typescript|js|javascript)\s*\n([\s\S]*?)```/gu)].map(
      (match) => match[1]
    )
  if (!/\.(?:ts|tsx|mts|mjs)$/u.test(path)) return []
  /** Literal values include complete examples in reference registries and guide data. */
  const examples: string[] = []
  for (const node of nodes(source, path)) {
    /** Static template segments remain inspectable even when later text interpolates labels. */
    const value =
      typeof node.value === 'string'
        ? node.value
        : node.type === 'TemplateLiteral'
          ? node.quasis[0]?.value.cooked
          : undefined
    if (typeof value === 'string') examples.push(value)
  }
  return examples
}

test('generates all seven logging packages and removes retired documentation routes', () => {
  /** The canonical generator owns these manifests, not this test. */
  const manifest = JSON.parse(
    readFileSync(join(website, 'src/generated/manifests/libraries.json'), 'utf8')
  )
  /** The generated library projection drives actual website navigation. */
  const libraries = new Set(manifest.libraries.map((library: { slug: string }) => library.slug))
  for (const name of loggingPackages) expect(libraries.has(name)).toBe(true)
  expect(libraries.has('logger')).toBe(false)
  expect(
    existsSync(join(website, 'src/content/zh/packages', 'logger')) &&
      readdirSync(join(website, 'src/content/zh/packages', 'logger')).length > 0
  ).toBe(false)
  /** Every module and symbol is indexed once; expected entries are the fixed factory table above. */
  const apis = JSON.parse(
    readFileSync(join(website, 'src/generated/manifests/apis.json'), 'utf8')
  ) as { apis: IGeneratedApi[] }
  /** Package/module identity must not depend on aggregate array position. */
  const exported = new Map<string, Set<string>>()
  for (const api of apis.apis)
    exported.set(`${api.library}:${api.module}`, new Set(api.symbols.map((symbol) => symbol.name)))
  for (const [entry, factories] of loggingFactories)
    for (const factory of factories) expect(exported.get(entry)?.has(factory), entry).toBe(true)
})

test('keeps legacy package references only in the four deferred published runtime files', () => {
  /** Findings carry paths, never runtime configuration or credentials. */
  const violations: string[] = []
  for (const file of sourceFiles()) {
    /** Match the retired package without creating another product import. */
    if (
      /@migaia\/logger/u.test(readFileSync(file, 'utf8')) &&
      !runtimeAllowances.has(relative(website, file))
    )
      violations.push(relative(website, file))
  }
  expect(violations).toEqual([])
})

test('uses current RPC factory exports in source and decoded authored examples', () => {
  /** Source-aware findings cannot confuse option fields or default binding names with old exports. */
  const violations: string[] = []
  for (const file of sourceFiles()) {
    /** Literal import statements inside examples are decoded once by the existing AST parser. */
    const source = readFileSync(file, 'utf8')
    if (!source.includes('@migaia/rpc-')) continue
    if (/\.(?:ts|tsx|mts|mjs)$/u.test(file))
      violations.push(
        ...retiredRpcReads(source, file).map((name) => relative(website, file) + ':' + name)
      )
    for (const value of codeExamples(source, file))
      if (value.includes('@migaia/rpc-'))
        violations.push(
          ...retiredRpcReads(value).map((name) => relative(website, file) + ':' + name)
        )
  }
  expect(violations).toEqual([])
})
