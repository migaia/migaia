import { resolve } from 'node:path'
import { build, resolveConfig } from 'vite'

const packageDirectory = resolve(new URL('..', import.meta.url).pathname)
const input = resolve(packageDirectory, 'test/fixtures/tree-shaking/root-entry.ts')
const canonicalBuildConfig = {
  root: packageDirectory,
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    sourcemap: true,
    minify: false,
    rollupOptions: { input }
  }
}

/** Creates the read-only Vite hook used to compile an exact in-memory predecessor. */
function createSourceOverridePlugin(sourceOverrides) {
  if (!(sourceOverrides instanceof Map) || sourceOverrides.size === 0) return undefined
  const overrides = new Map(
    [...sourceOverrides].map(([path, bytes]) => [resolve(path), Buffer.from(bytes)])
  )
  return {
    name: 'rpcc-canonical-source-override',
    enforce: 'pre',
    load(id) {
      const target = resolve(id.split('?')[0])
      const bytes = overrides.get(target)
      return bytes === undefined ? null : bytes.toString('utf8')
    }
  }
}

/** Resolves the exact config used by the canonical retained-graph build. */
export async function resolveCanonicalBuildConfig() {
  process.chdir(packageDirectory)
  return resolveConfig(canonicalBuildConfig, 'build')
}

/**
 * Runs the one retained-graph build used by both the frozen-size probe and provenance. Keeping this
 * call path shared prevents evidence instrumentation from changing output.
 */
export async function buildCanonicalRetainedGraph(options = {}) {
  process.chdir(packageDirectory)
  const plugin = createSourceOverridePlugin(options.sourceOverrides)
  return build(plugin ? { ...canonicalBuildConfig, plugins: [plugin] } : canonicalBuildConfig)
}

export { input, packageDirectory }
