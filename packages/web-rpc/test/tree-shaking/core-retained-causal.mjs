import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const workspaceDirectory = resolve(packageDirectory, '../..')
const retainedScript = resolve(packageDirectory, 'test/tree-shaking-retained.mjs')
const baselineScript = resolve(packageDirectory, 'test/tree-shaking-baseline.mjs')
const frozenBaseline = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'
)
const consumerRoots = {
  core: ['src/core.ts'],
  client: ['src/client.ts'],
  provider: ['src/provider.ts'],
  full: ['src/full.ts'],
  custom: [
    'src/core.ts',
    'src/features/outbound.ts',
    'src/features/provider.ts',
    'src/features/discovery.ts',
    'src/features/control.ts',
    'src/features/canonical-chunk.ts'
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
  const relativeModule = module.startsWith(`${workspaceDirectory}/`)
    ? module.slice(workspaceDirectory.length + 1)
    : module
  return relativeModule.startsWith('packages/web-rpc/')
    ? relativeModule
    : relativeModule.startsWith('packages/')
      ? `workspace:${relativeModule}`
      : relativeModule
}

/** Converts frozen root identity to the source identity used by retained consumers. */
function normalizeCandidateModule(module) {
  if (module.startsWith('packages/web-rpc/')) return module.slice('packages/web-rpc/'.length)
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

/** Records source/artifact custody for generated workspace modules without inventing edges. */
function generatedArtifactProvenance(module) {
  if (!module.startsWith('workspace:packages/')) return undefined
  const relativeArtifact = module.slice('workspace:'.length)
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
  return {
    kind: 'generated-artifact',
    locator: {
      artifact: module,
      artifactSha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
      generator: 'canonical package build output',
      source: existsSync(sourcePath) ? sourceRelative : undefined,
      sourceSha256: existsSync(sourcePath)
        ? createHash('sha256').update(readFileSync(sourcePath)).digest('hex')
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
        incomingEdges.length > 0 ? { kind: 'import-edge' } : generatedArtifactProvenance(module)
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
