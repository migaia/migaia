import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { sparqlBackendKind } from '../plugin.ts'
import {
  snapshotGraphTarget,
  snapshotGraphFormat,
  snapshotGraphDocument,
  requireGraphStore
} from '../graph-store.ts'
import { parseRdfDocument, writeRdfDocument } from '../ntriples.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { invalidArgument } from '../errors.ts'
import { SparqlText } from '../text.ts'
import type { IRdfGraphTarget, IRdfGraphFormat, IRdfGraphDocument } from '../endpoint.ts'
/** Import mode selects the existing native per-graph merge or replace operation. */
export type IOntologyImportOptions = { readonly mode?: 'merge' | 'replace' }
export type IOntologyApi = {
  importOntology(
    target: IRdfGraphTarget,
    document: IRdfGraphDocument,
    options?: IOntologyImportOptions,
    ctx?: IOperationContext
  ): Promise<number>
  exportOntology(
    target: IRdfGraphTarget,
    format?: IRdfGraphFormat,
    ctx?: IOperationContext
  ): Promise<IRdfGraphDocument>
}
export type IOntologyOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly ontology: IOntologyApi }; readonly transaction: {} }
>
/** Ontology uses only the same RDF parser/writer and the endpoint's original Graph Store port. */
export function ontologyFeature() {
  return defineFeature<typeof sparqlBackendKind, {}, IOntologyOutput>(sparqlBackendKind, (core) => {
    core.featureExpose.registerDetect(async () => {
      requireGraphStore(core.featureExpose.getClient())
    })
    return {
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          ontology: {
            async importOntology(
              target: IRdfGraphTarget,
              document: IRdfGraphDocument,
              options?: IOntologyImportOptions,
              ctx?: IOperationContext
            ): Promise<number> {
              /**
               * The import target, document scalars and chosen write mode must survive parsing and
               * serialization awaits.
               */
              const captured = snapshotGraphTarget(target),
                doc = snapshotGraphDocument(document),
                mode = readOntologyMode(options)
              if (mode !== 'merge' && mode !== 'replace') throw invalidArgument()
              /**
               * The real RDF parser/writer owns complete document conversion before one native
               * request.
               */
              const quads = parseRdfDocument(doc),
                text = await writeRdfDocument(quads, doc.format)
              return readNativeFeaturePort(this.store).run(
                SparqlText.ontologyImport,
                ctx,
                true,
                mode === 'merge' ? SparqlText.post : SparqlText.put,
                async (endpoint, signal, map) => {
                  /** The existing Graph Store port is required without issuing a hidden request. */
                  const port = requireGraphStore(endpoint)
                  if (mode === 'merge')
                    await port.post(map(captured), { format: doc.format, text }, signal)
                  else await port.put(map(captured), { format: doc.format, text }, signal)
                  return quads.length
                }
              )
            },
            async exportOntology(
              target: IRdfGraphTarget,
              format?: IRdfGraphFormat,
              ctx?: IOperationContext
            ): Promise<IRdfGraphDocument> {
              /**
               * The graph target and selected format must remain stable while native document work
               * awaits.
               */
              const captured = snapshotGraphTarget(target),
                type = snapshotGraphFormat(format)
              return readNativeFeaturePort(this.store).run(
                SparqlText.ontologyExport,
                ctx,
                false,
                SparqlText.get,
                async (endpoint, signal, map) => {
                  /**
                   * Native text and parsed quads share one accepted export before the real RDF
                   * writer runs.
                   */
                  const text = await requireGraphStore(endpoint).get(map(captured), type, signal),
                    quads = parseRdfDocument({ format: type, text })
                  return { format: type, text: await writeRdfDocument(quads, type) }
                }
              )
            }
          }
        },
        transaction: {}
      }
    }
  })
}

/** Only omission selects merge; invalid supplied modes keep the original argument rejection. */
function readOntologyMode(
  options: IOntologyImportOptions | undefined
): IOntologyImportOptions['mode'] {
  /** The chosen scalar must survive document parsing and writing awaits. */
  const value = options?.mode
  return value === undefined ? 'merge' : value
}
