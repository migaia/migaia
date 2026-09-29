import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as registry from '../error-registry.mjs'

/** Repository root anchors the CLI assertion independently of the test runner's cwd. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** URL imported by locale-specific child processes. */
const registryUrl = pathToFileURL(join(repositoryRoot, 'scripts/error-registry.mjs')).href

/**
 * Creates an isolated source tree for one registry assertion. Callers own and remove the returned
 * directory in `finally`.
 *
 * @returns {string} Absolute fixture root.
 */
const fixture = () => mkdtempSync(join(tmpdir(), 'migai-registry-generation-'))

/**
 * Writes one package-owned error-code declaration into a fixture.
 *
 * @param {string} root Fixture root.
 * @param {string} directory Package directory name.
 * @param {string} name Package source identity.
 * @param {string} declaration Full TypeScript declaration text.
 * @param {string} [subdirectory] Optional layer below src.
 * @returns {string} Relative declaration path.
 */
const declareCodes = (root, directory, name, declaration, subdirectory = '') => {
  /** Directory that owns this declaration. */
  const packageRoot = join(root, 'packages', directory)
  /** Source directory for the package or its optional layer. */
  const sourceRoot = join(packageRoot, 'src', subdirectory)
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name }))
  /** Path reported when duplicate declarations are rejected. */
  const file = join(sourceRoot, 'error-code.ts')
  writeFileSync(file, declaration)
  return relative(root, file)
}

test('A1 registry rows use code-unit order and render identically across locales', () => {
  /** This fixture distinguishes locale collation from UTF-16 code-unit order. */
  const root = fixture()
  try {
    declareCodes(
      root,
      'a',
      '@fixture/a',
      "export const Code = {\n  /** AB scenario. */\n  ab: 'AB',\n  /** A underscore B scenario. */\n  aB: 'A_B'\n} as const\n"
    )
    declareCodes(
      root,
      'a-b',
      '@fixture/a-b',
      "export const Code = {\n  /** Dash source scenario. */\n  dash: 'DASH'\n} as const\n"
    )
    declareCodes(
      root,
      'a-slash',
      '@fixture/a-slash',
      "export const ERROR_SOURCE = '@fixture/a/b'\nexport const Code = {\n  /** Slash source scenario. */\n  slash: 'SLASH'\n} as const\n"
    )
    assert.deepEqual(
      registry.collectErrorRegistry(root).map(({ source, code }) => `${source}:${code}`),
      ['@fixture/a:AB', '@fixture/a:A_B', '@fixture/a-b:DASH', '@fixture/a/b:SLASH']
    )
    /**
     * A child process isolates each locale from the other assertion. @param {string} locale Locale
     * name.
     */
    const renderUnderLocale = (locale) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { collectErrorRegistry, renderErrorRegistry } from ${JSON.stringify(registryUrl)}; process.stdout.write(renderErrorRegistry(collectErrorRegistry(process.argv[1])))`,
          root
        ],
        { encoding: 'utf8', env: { ...process.env, LC_ALL: locale } }
      )
    /** Swedish locale rendering must match the C locale byte for byte. */
    const swedish = renderUnderLocale('sv_SE.UTF-8')
    /** C locale is the comparison rendering. */
    const cLocale = renderUnderLocale('C')
    assert.equal(swedish.status, 0, swedish.stderr)
    assert.equal(cLocale.status, 0, cLocale.stderr)
    assert.equal(swedish.stdout, cLocale.stdout)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A2 duplicate source and code fails before changing a registry document', () => {
  /** Two files under one package declare the same semantic code. */
  const root = fixture()
  try {
    /** First declaration path expected in the duplicate diagnostic. */
    const first = declareCodes(
      root,
      'a',
      '@fixture/a',
      "export const Code = {\n  /** First declaration. */\n  duplicate: 'DUP'\n} as const\n"
    )
    /** Second declaration path expected in the duplicate diagnostic. */
    const second = declareCodes(
      root,
      'a',
      '@fixture/a',
      "export const Code = {\n  /** Second declaration. */\n  duplicate: 'DUP'\n} as const\n",
      'x'
    )
    /** Existing document must survive a rejected write byte for byte. */
    const document = join(root, 'docs/contracts/error-codes.md')
    mkdirSync(dirname(document), { recursive: true })
    writeFileSync(document, 'existing registry\n')
    /**
     * Both API paths must expose the same code and file pair. @param {() => unknown} action
     * Registry operation.
     */
    const verify = (action) =>
      assert.throws(action, (error) => {
        assert.ok(error instanceof Error)
        assert.ok('code' in error && 'files' in error)
        assert.equal(error.code, 'REGISTRY_DUPLICATE_CODE')
        assert.deepEqual(error.files, [first, second])
        return true
      })
    verify(() => registry.collectErrorRegistry(root))
    verify(() => registry.writeErrorRegistry(root))
    assert.equal(readFileSync(document, 'utf8'), 'existing registry\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A3 source-only validation reports counts without reading or writing docs', () => {
  /** Stale docs distinguish source-only validation from a full registry check. */
  const root = fixture()
  try {
    declareCodes(
      root,
      'a',
      '@fixture/a',
      "export const Code = {\n  /** First scenario. */\n  first: 'FIRST',\n  /** Second scenario. */\n  second: 'SECOND'\n} as const\n"
    )
    declareCodes(
      root,
      'b',
      '@fixture/b',
      "export const Code = {\n  /** Third scenario. */\n  third: 'THIRD'\n} as const\n"
    )
    /** Existing stale document must retain its bytes and modification time. */
    const document = join(root, 'docs/contracts/error-codes.md')
    mkdirSync(dirname(document), { recursive: true })
    writeFileSync(document, `${registry.REGISTRY_START}\nstale\n${registry.REGISTRY_END}\n`)
    /** Byte and mtime baseline before the read-only check. */
    const before = [readFileSync(document), statSync(document).mtimeMs]
    assert.deepEqual(registry.checkErrorRegistrySources(root), [
      { source: '@fixture/a', count: 2 },
      { source: '@fixture/b', count: 1 }
    ])
    assert.deepEqual([readFileSync(document), statSync(document).mtimeMs], before)
    assert.throws(
      () => registry.checkErrorRegistry(root),
      (error) => error instanceof Error && 'code' in error && error.code === 'REGISTRY_STALE'
    )
    declareCodes(root, 'b', '@fixture/b', "export const Code = { third: 'THIRD' } as const\n")
    assert.throws(
      () => registry.checkErrorRegistrySources(root),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'REGISTRY_JSDOC_MISSING' &&
        /missing descriptive JSDoc/.test(error.message)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  /** The actual repository CLI must expose the source-only mode. */
  const cli = spawnSync(
    process.execPath,
    [join(repositoryRoot, 'scripts/error-registry.mjs'), '--check-sources'],
    {
      encoding: 'utf8'
    }
  )
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout.trim().split('\n').at(-1) ?? '', /^sources ok: /)
})

test('A4 generated region includes a source count table before code rows', () => {
  /** Minimal sorted rows make section order observable. */
  const rows = [
    { source: '@fixture/a', code: 'FIRST', scenario: 'First scenario.' },
    { source: '@fixture/a', code: 'SECOND', scenario: 'Second scenario.' },
    { source: '@fixture/b', code: 'THIRD', scenario: 'Third scenario.' }
  ]
  /** Generated text is compared by section position and stable commands. */
  const rendered = registry.renderErrorRegistry(rows)
  assert.ok(rendered.indexOf('### 4.1 逐码生成区') < rendered.indexOf('| source | 码数 |'))
  assert.ok(rendered.indexOf('| `@fixture/a` | 2 |') < rendered.indexOf('| source | code | 场景 |'))
  assert.ok(rendered.indexOf('| `@fixture/b` | 1 |') < rendered.indexOf('| source | code | 场景 |'))
  assert.match(rendered, /pnpm run registry:write/)
})

/**
 * Writes one fixture package whose exports resolve to concrete JavaScript files.
 *
 * @param {string} root Fixture root.
 * @param {string} directory Package directory.
 * @param {string} name Public package name.
 * @param {Record<string, string>} exportsMap Export subpaths and targets.
 * @param {Record<string, string>} modules Relative module paths and source.
 * @returns {string} Absolute package directory.
 */
const declareExports = (root, directory, name, exportsMap, modules) => {
  /** Package root contains both manifest and optional build output. */
  const packageRoot = join(root, 'packages', directory)
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, type: 'module', exports: exportsMap })
  )
  for (const [path, source] of Object.entries(modules)) {
    /** Each module is created only when the fixture declares it built. */
    const file = join(packageRoot, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
  }
  return packageRoot
}

/**
 * Writes a tracked-baseline shape into an isolated fixture.
 *
 * @param {string} root Fixture root.
 * @param {Record<string, Record<string, string[]>>} packages Expected names by package/subpath.
 * @returns {string} Absolute baseline path.
 */
const declareBaseline = (root, packages) => {
  /** Baseline location follows the repository's existing script contract. */
  const file = join(root, 'scripts/fixtures/public-exports.baseline.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ packages }, null, 2)}\n`)
  return file
}

test('A5 export collection fails on missing targets and preserves upstream errors', async () => {
  /** An isolated module tree exercises manifest coverage without a full build. */
  const root = fixture()
  /** Shared global exposes one exact Error instance to the fixture ESM module. */
  const fixtureGlobal = /** @type {typeof globalThis & { __publicExportsFixtureError?: Error }} */ (
    globalThis
  )
  try {
    /** The covered package has one present and one missing concrete target. */
    const packageRoot = declareExports(
      root,
      'a',
      'a',
      { '.': './dist/index.js', './x': './dist/x.js' },
      { 'dist/index.js': 'export const present = 1\n' }
    )
    declareExports(root, 'w', 'w', { '.': './src/w.js' }, { 'src/w.js': 'export const web = 1\n' })
    /** Generator import occurs after fixture creation so the red phase fails at the new module. */
    const exportsTool = await import('../public-exports.mjs')
    /** @type {string[]} Stub records exact directories without depending on fixture stamps. */
    const freshDirectories = []
    await assert.rejects(
      exportsTool.collectPublicExports({
        root,
        assertFresh: (directories) => freshDirectories.push(...directories)
      }),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'PUBLIC_EXPORTS_TARGET_MISSING' &&
        /a/.test(error.message) &&
        /\.\/x/.test(error.message)
    )
    assert.deepEqual(exportsTool.coveredPackages(root).excluded, ['w'])
    assert.deepEqual(freshDirectories, [packageRoot])
    /** A freshness failure must retain identity and its original DIST_STALE code. */
    const stale = Object.assign(new Error('stale'), { code: 'DIST_STALE' })
    await assert.rejects(
      exportsTool.collectPublicExports({
        root,
        assertFresh: () => {
          throw stale
        }
      }),
      (error) => error === stale
    )
    /** The module's own thrown object must survive dynamic import unchanged. */
    const importError = new Error('fixture module failed')
    fixtureGlobal.__publicExportsFixtureError = importError
    writeFileSync(
      join(packageRoot, 'dist/index.js'),
      'throw globalThis.__publicExportsFixtureError\n'
    )
    writeFileSync(join(packageRoot, 'dist/x.js'), 'export const x = 1\n')
    await assert.rejects(
      exportsTool.collectPublicExports({ root, assertFresh: () => {} }),
      (error) => error === importError
    )
  } finally {
    delete fixtureGlobal.__publicExportsFixtureError
    rmSync(root, { recursive: true, force: true })
  }
})

test('A6 scoped checks report only admitted differences without writing the baseline', async () => {
  /** Two packages distinguish admitted from unadmitted export drift. */
  const root = fixture()
  try {
    declareExports(
      root,
      'a',
      'a',
      { '.': './dist/index.js' },
      { 'dist/index.js': 'export const newName = 1\n' }
    )
    declareExports(
      root,
      'b',
      'b',
      { '.': './dist/index.js' },
      { 'dist/index.js': 'export const other = 1\n' }
    )
    /** The old baseline lacks a's new name and still expects b's old name. */
    const baseline = declareBaseline(root, { a: { '.': [] }, b: { '.': ['oldName', 'other'] } })
    /** Baseline bytes remain unchanged across every check mode. */
    const original = readFileSync(baseline)
    const exportsTool = await import('../public-exports.mjs')
    await assert.rejects(
      exportsTool.checkPublicExports({ root, scope: ['a'], assertFresh: () => {} }),
      (error) => {
        assert.ok(error instanceof Error && 'code' in error && 'packages' in error)
        assert.equal(error.code, 'PUBLIC_EXPORTS_DRIFT')
        assert.deepEqual(error.packages, ['b'])
        return true
      }
    )
    assert.deepEqual(
      await exportsTool.checkPublicExports({ root, scope: ['a', 'b'], assertFresh: () => {} }),
      [
        { sign: '+', pkg: 'a', subpath: '.', name: 'newName' },
        { sign: '-', pkg: 'b', subpath: '.', name: 'oldName' }
      ]
    )
    await assert.rejects(
      exportsTool.checkPublicExports({ root, scope: ['zzz'], assertFresh: () => {} }),
      (error) =>
        error instanceof Error && 'code' in error && error.code === 'PUBLIC_EXPORTS_SCOPE_UNKNOWN'
    )
    assert.deepEqual(readFileSync(baseline), original)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A8 merged source changes generate identical and idempotent registration bytes', async () => {
  /** Independent fixture copies model the two possible child integration orders. */
  const roots = [fixture(), fixture()]
  try {
    const exportsTool = await import('../public-exports.mjs')
    /**
     * Applies one package's code and export change to a fixture. @param {string} root Fixture root.
     * @param {string} packageName Branch package name.
     */
    const applyChange = (root, packageName) => {
      /** Public code and export names encode the same branch identity. */
      const letter = packageName.toUpperCase()
      declareCodes(
        root,
        packageName,
        `@fixture/${packageName}`,
        `export const Code = {\n  /** ${letter} added scenario. */\n  added: '${letter}_ADDED'\n} as const\n`
      )
      declareExports(
        root,
        packageName,
        `@fixture/${packageName}`,
        { '.': './dist/index.js' },
        { 'dist/index.js': `export const ${packageName}Added = 1\n` }
      )
    }
    /** Both integration orders end with the same two declarations. */
    applyChange(roots[0], 'a')
    applyChange(roots[0], 'b')
    applyChange(roots[1], 'b')
    applyChange(roots[1], 'a')
    /**
     * Each fixture starts with a local registry document and an empty baseline. @param {string}
     * root Fixture root.
     */
    const generate = async (root) => {
      /** The generator replaces only its marked region. */
      const document = join(root, 'docs/contracts/error-codes.md')
      mkdirSync(dirname(document), { recursive: true })
      writeFileSync(document, '# Registry\n## 5. 什么不是错误码\n')
      declareBaseline(root, {})
      registry.writeErrorRegistry(root)
      await exportsTool.writePublicExports({ root, assertFresh: () => {} })
      /** Snapshot covers both generated files. */
      const result = [
        readFileSync(document),
        readFileSync(join(root, 'scripts/fixtures/public-exports.baseline.json'))
      ]
      registry.writeErrorRegistry(root)
      await exportsTool.writePublicExports({ root, assertFresh: () => {} })
      assert.deepEqual(readFileSync(document), result[0])
      assert.deepEqual(
        readFileSync(join(root, 'scripts/fixtures/public-exports.baseline.json')),
        result[1]
      )
      assert.deepEqual((await import('node:fs')).readdirSync(join(root, 'scripts/fixtures')), [
        'public-exports.baseline.json'
      ])
      return result
    }
    assert.deepEqual(await generate(roots[0]), await generate(roots[1]))
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  }
})
