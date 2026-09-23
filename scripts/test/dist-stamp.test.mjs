import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  DistStampErrorCode,
  assertFresh,
  cleanDist,
  distClosure,
  inputDigests,
  isStampable,
  writeStamp
} from '../dist-stamp.mjs'
import { distFreshnessGlobalSetup, withDistFreshness } from '../vitest-dist-freshness.mjs'

/** Temporary repositories created by this file, removed after the suite. */
const created = []
after(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true })
})

/**
 * Creates a throwaway git repository with workspace packages. Every package publishes `./dist/`
 * unless `stampable: false`.
 * @param {Record<string, { deps?: Record<string, string>, dev?: Record<string, string>, stampable?: boolean, files?: Record<string, string> }>} packages
 * @returns {{ root: string, dir: (name: string) => string }}
 */
const repository = (packages) => {
  const root = mkdtempSync(join(tmpdir(), 'dist-stamp-'))
  created.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, '.gitignore'), '**/dist/\nnode_modules/\n')
  for (const [name, spec] of Object.entries(packages)) {
    const directory = join(root, 'packages', name)
    mkdirSync(join(directory, 'src'), { recursive: true })
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: `@migaia/${name}`,
        main: spec.stampable === false ? './src/index.js' : './dist/index.js',
        scripts: { build: 'tsc' },
        dependencies: spec.deps ?? {},
        devDependencies: spec.dev ?? {}
      })
    )
    writeFileSync(join(directory, 'src/index.ts'), `export const ${name.replace(/-/g, '_')} = 1\n`)
    for (const [path, text] of Object.entries(spec.files ?? {})) {
      mkdirSync(join(directory, path, '..'), { recursive: true })
      writeFileSync(join(directory, path), text)
    }
  }
  return { root, dir: (name) => join(root, 'packages', name) }
}

/** Simulates a build: fresh dist/ followed by the stamp the build script writes. */
const build = (root, directory) => {
  cleanDist(directory)
  mkdirSync(join(directory, 'dist'), { recursive: true })
  writeFileSync(join(directory, 'dist/index.js'), 'export {}\n')
  writeStamp(directory, root)
}

/** Captures the error thrown by `fn`, failing the test when nothing is thrown. */
const thrown = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail('expected a throw')
}

describe('dist-stamp input digest', () => {
  it('changes when a source file changes and ignores tests, docs and vitest config', () => {
    const { root, dir } = repository({ a: {} })
    const digest = () => inputDigests([dir('a')], root).get(dir('a'))
    const initial = digest()
    assert.equal(digest(), initial, 'digest is deterministic')
    writeFileSync(join(dir('a'), 'README.md'), 'docs\n')
    mkdirSync(join(dir('a'), 'test'))
    writeFileSync(join(dir('a'), 'test/a.test.ts'), 'test\n')
    writeFileSync(join(dir('a'), 'vitest.config.ts'), 'export default {}\n')
    assert.equal(digest(), initial, 'build-irrelevant files do not change the digest')
    writeFileSync(join(dir('a'), 'src/index.ts'), 'export const a = 2\n')
    assert.notEqual(digest(), initial, 'a source edit changes the digest')
  })

  it('treats a deleted source file as an input change', () => {
    const { root, dir } = repository({ a: { files: { 'src/extra.ts': 'export {}\n' } } })
    execFileSync('git', ['add', '-A'], { cwd: root })
    const before = inputDigests([dir('a')], root).get(dir('a'))
    rmSync(join(dir('a'), 'src/extra.ts'))
    assert.notEqual(inputDigests([dir('a')], root).get(dir('a')), before)
  })

  it('never reads build output or its own stamp as an input', () => {
    const { root, dir } = repository({ a: {} })
    const before = inputDigests([dir('a')], root).get(dir('a'))
    build(root, dir('a'))
    assert.equal(inputDigests([dir('a')], root).get(dir('a')), before)
  })
})

describe('dist-stamp freshness', () => {
  it('passes for output built from the current sources', () => {
    const { root, dir } = repository({ a: {} })
    build(root, dir('a'))
    assert.doesNotThrow(() => assertFresh([dir('a')], root))
  })

  it('rejects a source edit made after the build as DIST_STALE/modified', () => {
    const { root, dir } = repository({ a: {}, b: {} })
    build(root, dir('a'))
    build(root, dir('b'))
    writeFileSync(join(dir('a'), 'src/index.ts'), 'export const a = 2\n')
    const error = thrown(() => assertFresh([dir('a'), dir('b')], root))
    assert.equal(error.code, DistStampErrorCode.stale)
    assert.deepEqual(error.packages, [{ name: 'a', reason: 'modified' }])
    assert.match(error.message, /--filter \.\/packages\/a run build/)
  })

  it('distinguishes unbuilt and unstamped output and reports every stale package at once', () => {
    const { root, dir } = repository({ a: {}, b: {} })
    mkdirSync(join(dir('b'), 'dist'))
    const error = thrown(() => assertFresh([dir('a'), dir('b')], root))
    assert.deepEqual(error.packages, [
      { name: 'a', reason: 'unbuilt' },
      { name: 'b', reason: 'unstamped' }
    ])
  })

  it('refuses to stamp a build that produced no dist/', () => {
    const { root, dir } = repository({ a: {} })
    const error = thrown(() => writeStamp(dir('a'), root))
    assert.equal(error.code, DistStampErrorCode.missingOutput)
  })

  it('ignores packages that publish no dist/', () => {
    const { root, dir } = repository({ w: { stampable: false } })
    assert.equal(isStampable(dir('w')), false)
    assert.doesNotThrow(() => assertFresh([dir('w')], root))
  })

  it('clean removes orphaned output left by deleted sources', () => {
    const { root, dir } = repository({ a: {} })
    build(root, dir('a'))
    writeFileSync(join(dir('a'), 'dist/orphan.js'), 'stale\n')
    build(root, dir('a'))
    assert.equal(existsSync(join(dir('a'), 'dist/orphan.js')), false)
  })
})

describe('dist-stamp closure', () => {
  it('includes declared dependencies transitively, dev dependencies only for the package itself', () => {
    const { root, dir } = repository({
      app: { deps: { '@migaia/mid': 'workspace:*' }, dev: { '@migaia/tool': 'workspace:*' } },
      mid: { deps: { '@migaia/base': 'workspace:*' }, dev: { '@migaia/mid-dev': 'workspace:*' } },
      base: {},
      tool: {},
      'mid-dev': {},
      unrelated: {}
    })
    assert.deepEqual(distClosure(dir('app'), root), [dir('base'), dir('mid'), dir('tool')])
  })

  it('adds packages read by dist path, every package for a templated path, and itself', () => {
    const named = repository({
      reader: { files: { 'test/x.test.ts': "import '../../other/dist/index.js'; const p = 'packages/other/dist/index.js'" } },
      other: {},
      unrelated: {}
    })
    assert.deepEqual(distClosure(named.dir('reader'), named.root), [named.dir('other')])

    const templated = repository({
      reader: { files: { 'test/x.test.ts': 'const p = `packages/${dir}/dist/index.js`' } },
      one: {},
      two: {}
    })
    assert.deepEqual(distClosure(templated.dir('reader'), templated.root), [
      templated.dir('one'),
      templated.dir('reader'),
      templated.dir('two')
    ])

    const self = repository({ reader: { files: { 'test/x.test.ts': "new URL('../dist/index.js', import.meta.url)" } } })
    assert.deepEqual(distClosure(self.dir('reader'), self.root), [self.dir('reader')])
  })
})

describe('vitest wiring', () => {
  it('appends the global setup while preserving existing config and setup entries', () => {
    const wrapped = withDistFreshness({ build: { x: 1 }, test: { environment: 'jsdom', globalSetup: 'own.mjs' } })
    assert.deepEqual(wrapped.build, { x: 1 })
    assert.equal(wrapped.test.environment, 'jsdom')
    assert.deepEqual(wrapped.test.globalSetup, ['own.mjs', distFreshnessGlobalSetup])
    assert.deepEqual(withDistFreshness().test.globalSetup, [distFreshnessGlobalSetup])
  })
})
