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
