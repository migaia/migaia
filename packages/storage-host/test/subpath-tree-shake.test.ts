import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import packageJson from '../package.json' with { type: 'json' }
import viteConfig from '../vite.config.js'

/** Published export map: subpath to built file. */
const exportsMap = packageJson.exports as Record<string, { readonly default: string }>
/** Build entries: built file name (without extension) to its source module. */
const sourceEntries = (viteConfig.build!.lib as { readonly entry: Record<string, string> }).entry

/**
 * Source module behind one published subpath. Bundling source keeps declaration names, which the
 * minified dist output does not; the bundler tree-shakes source modules the same way.
 */
function sourceOf(subpath: string): string {
  const built = exportsMap[subpath]!.default.replace(/^\.\/dist\//, '').replace(/\.js$/, '')
  const source = sourceEntries[built]
  if (source === undefined) throw new Error('no build entry for ' + subpath)
  return resolve(import.meta.dirname, '..', source)
}

/**
 * Leaf subpaths and the factory each one exists to publish. A consumer that imports any other
 * subpath must not receive these factories in its bundle.
 */
const leafFactories: Readonly<Record<string, readonly string[]>> = {
  './plugins/memory': ['memoryBackendPlugin'],
  './plugins/journal': ['storageJournalPlugin', 'storageLogStore'],
  './plugins/probe': ['storageProbe'],
  './features/memory-notifications': ['memoryNotificationsFeature'],
  './features/memory-change-feed': ['memoryChangeFeedFeature'],
  './entity/features/query': ['entityQueryFeature'],
  './entity/features/unique': ['entityUniqueFeature'],
  './entity/features/migration': ['entityMigrationFeature'],
  './entity/features/indexes': ['entityIndexesFeature'],
  './entity/features/keyset': ['entityKeysetFeature']
}

/** One scratch directory holds the minimal consumer programs. */
const scratch = mkdtempSync(join(tmpdir(), 'storage-host-subpaths-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/**
 * Bundle a consumer that re-exports one subpath, unminified so declarations keep their names. Every
 * other package stays external, so the output holds only this package's code.
 */
async function bundleSubpath(subpath: string): Promise<string> {
  const entry = join(scratch, subpath.replaceAll(/[./]+/g, '-') + '.mjs')
  writeFileSync(entry, `export * from ${JSON.stringify(sourceOf(subpath))}\n`)
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'consumer' },
      rollupOptions: { external: (id) => /^(?:@migaia\/|node:)/.test(id) }
    }
  })
  const bundles = Array.isArray(output) ? output : [output]
  return bundles
    .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
    .map((chunk) => ('code' in chunk ? chunk.code : ''))
    .join('\n')
}

/** A declaration of `name` in bundled code, allowing the suffix the bundler adds on collision. */
const declares = (code: string, name: string): boolean =>
  new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}(?:\\$\\d+)?\\b`).test(code)

describe('storage-host subpath tree shaking', () => {
  it.each(Object.keys(exportsMap))(
    'a consumer of %s receives no other leaf subpath factory',
    async (subpath) => {
      const code = await bundleSubpath(subpath)
      const leaked = Object.entries(leafFactories)
        .filter(([leaf]) => leaf !== subpath)
        .flatMap(([, names]) => names)
        .filter((name) => declares(code, name))
      expect(leaked).toEqual([])
      /** Positive control: a leaf subpath's own factory is found, so absence above is meaningful. */
      for (const name of leafFactories[subpath] ?? []) expect(declares(code, name)).toBe(true)
    },
    60000
  )
})
