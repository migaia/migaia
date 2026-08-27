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
    minify: false,
    rollupOptions: { input }
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
export async function buildCanonicalRetainedGraph() {
  process.chdir(packageDirectory)
  return build(canonicalBuildConfig)
}

export { input, packageDirectory }
