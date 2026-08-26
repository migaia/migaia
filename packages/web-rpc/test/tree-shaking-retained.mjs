import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const packageDirectory = resolve(new URL('..', import.meta.url).pathname)
const workspaceDirectory = resolve(packageDirectory, '../..')
const includeEdges = process.argv.includes('--include-edges')
process.chdir(packageDirectory)

const entries = {
  core: `import * as selected from ${JSON.stringify(resolve(packageDirectory, 'src/core.ts'))}; globalThis.__webRpcRetained = selected;`,
  client: `import * as selected from ${JSON.stringify(resolve(packageDirectory, 'src/client.ts'))}; globalThis.__webRpcRetained = selected;`,
  provider: `import * as selected from ${JSON.stringify(resolve(packageDirectory, 'src/provider.ts'))}; globalThis.__webRpcRetained = selected;`,
  full: `import * as selected from ${JSON.stringify(resolve(packageDirectory, 'src/full.ts'))}; globalThis.__webRpcRetained = selected;`,
  custom: [
    `import * as core from ${JSON.stringify(resolve(packageDirectory, 'src/core.ts'))};`,
    `import * as outbound from ${JSON.stringify(resolve(packageDirectory, 'src/features/outbound.ts'))};`,
    `import * as provider from ${JSON.stringify(resolve(packageDirectory, 'src/features/provider.ts'))};`,
    `import * as discovery from ${JSON.stringify(resolve(packageDirectory, 'src/features/discovery.ts'))};`,
    `import * as control from ${JSON.stringify(resolve(packageDirectory, 'src/features/control.ts'))};`,
    `import * as chunk from ${JSON.stringify(resolve(packageDirectory, 'src/features/chunk.ts'))};`,
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
  const edges = modules
    .filter((module) => normalizeModule(module).startsWith('src/'))
    .flatMap((module) =>
      (runtimeImports.get(module) ?? [])
        .filter((dependency) => retainedModuleIds.has(dependency))
        .map((dependency) => ({
          from: normalizeModule(module),
          to: normalizeModule(dependency)
        }))
    )
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
    ...(includeEdges ? { edges } : {})
  }
}

console.log(JSON.stringify(retained, null, 2))
