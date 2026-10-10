import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const packageDirectory = resolve(new URL('../..', import.meta.url).pathname)
const workspaceDirectory = resolve(packageDirectory, '../..')
const includeEdges = process.argv.includes('--include-edges')
process.chdir(packageDirectory)

const entries = {
  core: "import * as selected from '@migaia/rpc-core/composed'; globalThis.__webRpcRetained = selected;",
  client:
    "import * as selected from '@migaia/rpc-core/client'; globalThis.__webRpcRetained = selected;",
  provider:
    "import * as selected from '@migaia/rpc-core/provider'; globalThis.__webRpcRetained = selected;",
  full: "import * as selected from '@migaia/rpc-core/full'; globalThis.__webRpcRetained = selected;",
  custom: [
    "import * as core from '@migaia/rpc-core/composed';",
    "import * as outbound from '@migaia/rpc-core/features/outbound';",
    "import * as provider from '@migaia/rpc-core/features/provider';",
    "import * as discovery from '@migaia/rpc-core/features/discovery';",
    "import * as control from '@migaia/rpc-core/features/control';",
    "import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream';",
    'const chunk = { createCanonicalChunkFeature };',
    'globalThis.__webRpcRetained = { core, outbound, provider, discovery, control, chunk };'
  ].join('\n')
}

/** Normalizes one Rollup module id to the retained-inventory identity. */
function normalizeModule(module) {
  return module
    .replace(`${packageDirectory}/`, '')
    .replace(`${workspaceDirectory}/packages/`, 'workspace:packages/')
}

const retained = {}
for (const [entry, entrySource] of Object.entries(entries)) {
  const virtualId = `virtual:web-rpc-${entry}`
  /** Runtime dependency ids reported after TypeScript erasure and module resolution. */
  const runtimeImports = new Map()
  /**
   * Virtual loader/runtime source is captured from the same canonical build, never a fake disk
   * file.
   */
  const generatedArtifacts = new Map()
  const output = await build({
    root: packageDirectory,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: virtualId }
    },
    plugins: [
      {
        name: 'web-rpc-retained-entry',
        resolveId(id) {
          return id === virtualId ? virtualId : undefined
        },
        load(id) {
          return id === virtualId ? entrySource : undefined
        },
        moduleParsed(module) {
          runtimeImports.set(module.id, [...module.importedIds, ...module.dynamicallyImportedIds])
          if (module.id.startsWith('\u0000') && typeof module.code === 'string')
            generatedArtifacts.set(module.id, {
              artifactSha256: createHash('sha256').update(module.code).digest('hex'),
              generator: 'canonical Vite moduleParsed source',
              sourceBytes: Buffer.byteLength(module.code)
            })
        }
      }
    ]
  })
  const results = Array.isArray(output) ? output : [output]
  const chunks = results.flatMap((result) => result.output.filter((item) => item.type === 'chunk'))
  const code = chunks.map((item) => item.code).join('\n')
  const modules = [...new Set(chunks.flatMap((item) => Object.keys(item.modules)))].sort()
  /** Dependencies whose source and target both survive in this emitted consumer closure. */
  const retainedModuleIds = new Set(modules)
  /** Preserve the actual resolved path when an import/re-export barrel has no emitted body. */
  const retainedDependencies = (module) => {
    /** Breadth-first traversal keeps one shortest observed path for each surviving dependency. */
    const pending = (runtimeImports.get(module) ?? []).map((dependency) => ({
      dependency,
      via: []
    }))
    /** Resolved-module identity terminates import cycles without inventing a source edge. */
    const visited = new Set([module])
    /** Each result records either the original direct edge or its actual elided module path. */
    const dependencies = []
    for (let index = 0; index < pending.length; index += 1) {
      const { dependency, via } = pending[index]
      if (visited.has(dependency)) continue
      visited.add(dependency)
      if (retainedModuleIds.has(dependency)) {
        dependencies.push({
          from: normalizeModule(module),
          to: normalizeModule(dependency),
          ...(via.length === 0 ? {} : { via: via.map(normalizeModule) })
        })
        continue
      }
      for (const next of runtimeImports.get(dependency) ?? [])
        pending.push({ dependency: next, via: [...via, dependency] })
    }
    return dependencies
  }
  const edges = modules
    .filter((module) => {
      const path = normalizeModule(module)
      return path.startsWith('dist/') || path.startsWith('workspace:packages/rpc-contract/dist/')
    })
    .flatMap(retainedDependencies)
    .sort((left, right) =>
      `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`)
    )
  retained[entry] = {
    entryProvenance: {
      virtualId,
      sourceSha256: createHash('sha256').update(entrySource).digest('hex')
    },
    moduleCount: modules.length,
    rawBytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).byteLength,
    bundleSha256: createHash('sha256').update(code).digest('hex'),
    modules: modules.map(normalizeModule).sort(),
    generatedArtifacts: modules
      .filter((module) => generatedArtifacts.has(module))
      .map((module) => ({ artifact: normalizeModule(module), ...generatedArtifacts.get(module) })),
    ...(includeEdges ? { edges } : {})
  }
}

console.log(JSON.stringify(retained, null, 2))
