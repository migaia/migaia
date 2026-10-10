import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildCanonicalRetainedGraph } from './tree-shaking-canonical-build.mjs'

const packageDirectory = resolve(new URL('../..', import.meta.url).pathname)
const endpointSource = readFileSync(resolve(packageDirectory, 'src/core/composed.ts'), 'utf8')
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

/**
 * Internal bundler runtime modules are emitted after moduleParsed; retain their actual chunk
 * region.
 */
const generatedArtifacts = chunksWithCode.flatMap((chunk) =>
  Object.keys(chunk.modules)
    .filter((module) => module.startsWith('\u0000'))
    .flatMap((module) => {
      /** The canonical emitter labels each generated module without inventing a disk source. */
      const start = chunk.code.indexOf(`//#region ${module.replaceAll('\u0000', '\\0')}\n`)
      if (start === -1) return []
      /** Only the exact bounded region from this emitted chunk supplies the artifact bytes. */
      const end = chunk.code.indexOf('//#endregion', start)
      if (end === -1) return []
      /** Region and containing chunk hashes keep generated custody independently reproducible. */
      const code = chunk.code.slice(start, end + '//#endregion'.length)
      return [
        {
          artifact: module,
          artifactSha256: createHash('sha256').update(code).digest('hex'),
          generator: 'canonical emitted chunk region',
          emittedChunk: chunk.fileName,
          emittedChunkSha256: createHash('sha256').update(chunk.code).digest('hex'),
          sourceBytes: Buffer.byteLength(code)
        }
      ]
    })
)

console.log(
  JSON.stringify(
    {
      entry: 'root',
      root,
      modules,
      moduleAttribution,
      generatedArtifacts
    },
    null,
    2
  )
)
