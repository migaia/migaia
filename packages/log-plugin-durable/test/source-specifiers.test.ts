import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/** The source owner and its copied fixtures share one physical package root. */
const root = fileURLToPath(new URL('../', import.meta.url))

/** Every supported static, bare, re-export and dynamic relative source import names a real TS file. */
function sourceSpecifiers(): void {
  /** A cursor visits growing source directories once without sorting or shifting them. */
  const directories = [resolve(root, 'src'), resolve(root, 'test')]
  /** Collect every real relative module read for explicit positive assertions. */
  const specifiers: { file: string; specifier: string }[] = []
  for (let cursor = 0; cursor < directories.length; cursor++) {
    for (const entry of readdirSync(directories[cursor]!, { withFileTypes: true })) {
      /** All test and source files are owned by the current package. */
      const file = resolve(directories[cursor]!, entry.name)
      if (entry.isDirectory()) directories.push(file)
      else if (file.endsWith('.ts')) {
        /** A source string is scanned once for the fixed set of admitted module forms. */
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(
          /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)(['"])(\.[^'"]+)\1/g
        ))
          specifiers.push({ file, specifier: match[2]! })
      }
    }
  }
  expect(specifiers.length).toBeGreaterThan(0)
  for (const { file, specifier } of specifiers) {
    expect(specifier, file).toMatch(/\.(?:ts|tsx|mts)$/)
    expect(specifier, file).not.toMatch(/\.js$/)
    expect(existsSync(resolve(dirname(file), specifier)), `${file}:${specifier}`).toBe(true)
  }
}

/** Node imports the actual rewritten publications without a source loader or package alias. */
function emittedEntries(): void {
  /** Absolute URLs select the real emitted files without creating false source specifiers. */
  const rootEntry = new URL('../dist/index.js', import.meta.url).href
  /** This is the exact Node condition target declared by the package manifest. */
  const fileEntry = new URL('../dist/file.js', import.meta.url).href
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { strict as assert } from 'node:assert';
const root = await import(${JSON.stringify(rootEntry)});
const file = await import(${JSON.stringify(fileEntry)});
const published = await import('@migaia/log-plugin-durable/file');
assert.deepEqual(new Set(Object.keys(root)), new Set([
  'LOG_DURABLE_ERROR_SOURCE', 'LogDurableErrorCode', 'LogRecordState', 'LogStage',
  'assertLogInteger', 'binlogPlugin', 'createLogStoreIndex', 'memoryLogStore',
  'prepareLogAppend', 'snapshotLogRecords', 'snapshotLogStoreState', 'undoLogPlugin', 'walPlugin'
]));
assert.deepEqual(Object.keys(file), ['fileLogStore']);
assert.equal(file.fileLogStore, published.fileLogStore);
const { createLogHost, levelPlugin } = await import('@migaia/log-host');
const categorized = createLogHost({ plugins: [levelPlugin()] });
assert.equal(typeof categorized.atLevel, 'function');
await categorized.shutdown('manual');`
    ],
    { cwd: root, stdio: 'pipe' }
  )
  /** The publication keeps native-only resources behind the explicit conditional file entry. */
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  expect(manifest.exports['./file'].browser.default).toBe('./dist/file.browser.js')
  expect(manifest.dependencies).not.toHaveProperty('@migaia/storage-contract')
  expect(manifest.dependencies).not.toHaveProperty('fs-ext')
  expect(manifest.peerDependencies).toEqual({ '@migaia/log-host': manifest.version })
}

it('names every real relative source file with its TypeScript extension', sourceSpecifiers)
it('loads the rewritten root and Node file publications directly', emittedEntries)
