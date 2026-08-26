import { gzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildCanonicalRetainedGraph } from './tree-shaking-canonical-build.mjs'

const packageDirectory = resolve(new URL('..', import.meta.url).pathname)
const endpointSource = readFileSync(resolve(packageDirectory, 'src/core.ts'), 'utf8')
const output = await buildCanonicalRetainedGraph()
const chunks = Array.isArray(output) ? output : [output]
const bundle = chunks.flatMap((result) => result.output)
const chunksWithCode = bundle.filter((item) => item.type === 'chunk')
const code = chunksWithCode.map((item) => item.code).join('\n')
const modules = [...new Set(chunksWithCode.flatMap((item) => Object.keys(item.modules)))].sort()
const moduleAttribution = [
  ...chunksWithCode.reduce((attribution, item) => {
    for (const [module, metadata] of Object.entries(item.modules)) {
      const previous = attribution.get(module) ?? { originalBytes: 0, renderedBytes: 0 }
      const originalBytes =
        metadata.originalLength ??
        (existsSync(module) ? Buffer.byteLength(readFileSync(module)) : 0)
      attribution.set(module, {
        originalBytes: previous.originalBytes + originalBytes,
        renderedBytes: previous.renderedBytes + (metadata.renderedLength ?? 0)
      })
    }
    return attribution
  }, new Map())
]
  .map(([module, bytes]) => ({ module, ...bytes }))
  .sort(
    (left, right) =>
      right.renderedBytes - left.renderedBytes || left.module.localeCompare(right.module)
  )
const root = {
  moduleCount: modules.length,
  rawBytes: Buffer.byteLength(code),
  gzipBytes: gzipSync(code).byteLength,
  endpointStaticImportCount: (endpointSource.match(/^import /gm) ?? []).length
}

console.log(
  JSON.stringify(
    {
      entry: 'root',
      root,
      modules,
      moduleAttribution
    },
    null,
    2
  )
)
