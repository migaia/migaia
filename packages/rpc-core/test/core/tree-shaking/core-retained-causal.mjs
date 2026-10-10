import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const workspaceDirectory = resolve(packageDirectory, '../..')
const retainedScript = resolve(packageDirectory, 'test/core/tree-shaking-retained.mjs')
const baselineScript = resolve(packageDirectory, 'test/core/tree-shaking-baseline.mjs')
const frozenBaseline = resolve(
  packageDirectory,
  'test/core/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'
)
const consumerRoots = {
  core: ['dist/core/composed.js'],
  client: ['dist/core/client.js'],
  provider: ['dist/core/provider.js'],
  full: ['dist/core/full.js'],
  custom: [
    'dist/core/composed.js',
    'dist/core/features/outbound.js',
    'dist/core/features/provider.js',
    'dist/core/features/discovery.js',
    'dist/core/features/control.js',
    'dist/core/features/canonical-chunk.js'
  ]
}
const consumerNames = ['core', 'client', 'provider', 'full', 'custom']

/** Runs one canonical JSON-producing retained-evidence script. */
function readScriptJson(script, args = []) {
  return JSON.parse(
    execFileSync(process.execPath, [script, ...args], {
      cwd: workspaceDirectory,
      encoding: 'utf8'
    })
  )
}

/** Normalizes a generated absolute module path to retained-inventory identity. */
function normalizeInventoryModule(module) {
  if (module.startsWith(`${packageDirectory}/`)) return module.slice(packageDirectory.length + 1)
  if (module.startsWith(`${workspaceDirectory}/packages/`))
    return `workspace:${module.slice(workspaceDirectory.length + 1)}`
  return module
}

/** Normalizes a root-build module path to frozen baseline identity. */
function normalizeRootModule(module) {
  const relativeModule = module.includes('/packages/')
    ? module.slice(module.indexOf('/packages/') + 1)
    : module
  return relativeModule.startsWith('packages/rpc/') ||
    relativeModule.startsWith('packages/rpc-core/')
    ? relativeModule
    : relativeModule.startsWith('packages/')
      ? `workspace:${relativeModule}`
      : relativeModule
}

/** Converts frozen root identity to the source identity used by retained consumers. */
function normalizeCandidateModule(module) {
  if (module.startsWith('packages/rpc-core/')) return module.slice('packages/rpc-core/'.length)
  if (module.startsWith('packages/rpc/')) return module.slice('packages/rpc/'.length)
  return module
}

/** Sorts and deduplicates causal edges so fixture and source evidence share one identity. */
function uniqueSortedEdges(edges) {
  const unique = new Map(
    edges.map((edge) => [`${edge.consumer}\u0000${edge.from}\u0000${edge.to}`, edge])
  )
  return [...unique.values()].sort((left, right) =>
    `${left.consumer}\u0000${left.from}\u0000${left.to}`.localeCompare(
      `${right.consumer}\u0000${right.from}\u0000${right.to}`
    )
  )
}

/** Records actual source/artifact provenance for built modules without inventing edges. */
function generatedArtifactProvenance(module, retained, live) {
  /** Generated loader helpers have an actual virtual source in the canonical consumer build. */
  const generated = [
    ...live.generatedArtifacts,
    ...consumerNames.flatMap((consumer) => retained[consumer].generatedArtifacts)
  ].find((artifact) => artifact.artifact === module)
  if (generated)
    return {
      kind: 'generated-artifact',
      locator: generated
    }
  /** Own Core paths and external workspace paths both retain their actual physical identity. */
  const relativeArtifact = module.startsWith('workspace:packages/')
    ? module.slice('workspace:'.length)
    : module.startsWith('packages/rpc-core/')
      ? module
      : undefined
  if (relativeArtifact === undefined) return undefined
  const artifactPath = resolve(workspaceDirectory, relativeArtifact)
  if (!existsSync(artifactPath)) return undefined
  const sourceRelative = relativeArtifact.replace(
    /^packages\/([^/]+)\/dist\/(.*)\.js$/,
    (_match, packageName, name) => {
      const sourceName = name.replace(/-[A-Za-z0-9]{8}$/, '')
      return `packages/${packageName}/src/${sourceName}.ts`
    }
  )
  const sourcePath = resolve(workspaceDirectory, sourceRelative)
  /** Generated private bootstrap sources exist only in the compiler's real inline source map. */
  const sourceMapPath = `${artifactPath}.map`
  /** A real emitted map may be the sole retained source for compiler-generated private code. */
  const sourceMap = existsSync(sourceMapPath)
    ? JSON.parse(readFileSync(sourceMapPath, 'utf8'))
    : undefined
  /** Inline compiler bytes are attributed to their real map slot, never a nonexistent src file. */
  const inlineSourceIndex =
    sourceMap?.sourcesContent?.findIndex((source) => typeof source === 'string') ?? -1
  /** Prefer an existing source file; otherwise point at the exact inline map slot. */
  const source = existsSync(sourcePath)
    ? sourceRelative
    : inlineSourceIndex !== -1
      ? `${relativeArtifact}.map#sourcesContent[${inlineSourceIndex}]`
      : undefined
  /** Hash the bytes at that source locator rather than a guessed or nonexistent source path. */
  const sourceBytes = existsSync(sourcePath)
    ? readFileSync(sourcePath)
    : inlineSourceIndex !== -1
      ? sourceMap.sourcesContent[inlineSourceIndex]
      : undefined
  return {
    kind: 'generated-artifact',
    locator: {
      artifact: module,
      artifactSha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
      generator: relativeArtifact.includes('/dist/')
        ? 'canonical package build output'
        : 'canonical retained root source',
      source,
      sourceSha256:
        sourceBytes !== undefined
          ? createHash('sha256').update(sourceBytes).digest('hex')
          : undefined
    }
  }
}

/** Produces five-consumer retained attribution from canonical live and frozen module sets. */
function main() {
  const retained = readScriptJson(retainedScript, ['--include-edges'])
  const live = readScriptJson(baselineScript)
  const old = JSON.parse(readFileSync(frozenBaseline, 'utf8'))
  const liveRootModules = live.modules.map(normalizeRootModule).sort()
  const oldRootModules = old.modules.map(normalizeRootModule).sort()
  const liveSet = new Set(liveRootModules)
  const oldSet = new Set(oldRootModules)
  const addedModules = liveRootModules.filter((module) => !oldSet.has(module))
  const removedModules = oldRootModules.filter((module) => !liveSet.has(module))
  const consumers = Object.fromEntries(
    consumerNames.map((consumer) => {
      const modules = retained[consumer].modules.map(normalizeInventoryModule).sort()
      return [
        consumer,
        {
          roots: consumerRoots[consumer],
          moduleCount: modules.length,
          modules,
          edges: uniqueSortedEdges(retained[consumer].edges.map((edge) => ({ consumer, ...edge })))
        }
      ]
    })
  )
  const allEdges = consumerNames.flatMap((consumer) => consumers[consumer].edges)
  const candidateAttribution = addedModules.map((module) => {
    const incomingEdges = uniqueSortedEdges(
      allEdges.filter((edge) => edge.to === normalizeCandidateModule(module))
    )
    return {
      module,
      retainedBy: consumerNames.filter((consumer) =>
        consumers[consumer].modules.includes(normalizeCandidateModule(module))
      ),
      incomingEdges,
      provenance:
        incomingEdges.length > 0
          ? { kind: 'import-edge' }
          : generatedArtifactProvenance(module, retained, live)
    }
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        schema: 'WRC-C-B11f-five-consumer-causal-v2',
        rootModules: consumerRoots,
        oldRootModules,
        liveRootModules,
        consumers,
        retainedCounts: Object.fromEntries(
          consumerNames.map((consumer) => [consumer, consumers[consumer].moduleCount])
        ),
        addedModules,
        removedModules,
        candidateAttribution
      },
      null,
      2
    )}\n`
  )
}

main()
