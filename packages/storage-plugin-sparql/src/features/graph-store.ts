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
import { SparqlText } from '../text.ts'
import type { IRdfGraphTarget, IRdfGraphFormat, IRdfGraphDocument } from '../endpoint.ts'
/** Root-only Graph Store operations never acquire a transaction projection. */
export type IGraphStoreApi = {
  getGraph(
    target: IRdfGraphTarget,
    format?: IRdfGraphFormat,
    ctx?: IOperationContext
  ): Promise<IRdfGraphDocument>
  putGraph(
    target: IRdfGraphTarget,
    document: IRdfGraphDocument,
    ctx?: IOperationContext
  ): Promise<void>
  mergeGraph(
    target: IRdfGraphTarget,
    document: IRdfGraphDocument,
    ctx?: IOperationContext
  ): Promise<void>
  removeGraph(target: IRdfGraphTarget, ctx?: IOperationContext): Promise<void>
  hasGraph(target: IRdfGraphTarget, ctx?: IOperationContext): Promise<boolean>
}
export type IGraphStoreOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly graphStore: IGraphStoreApi }; readonly transaction: {} }
>
/** The Feature borrows the original endpoint and its actual per-graph protocol implementation. */
export function graphStoreFeature() {
  return defineFeature<typeof sparqlBackendKind, {}, IGraphStoreOutput>(
    sparqlBackendKind,
    (core) => {
      core.featureExpose.registerDetect(async () => {
        requireGraphStore(core.featureExpose.getClient())
      })
      return {
        capabilities: [] as const,
        chain: {},
        api: {
          store: {
            graphStore: {
              async getGraph(
                target: IRdfGraphTarget,
                format?: IRdfGraphFormat,
                ctx?: IOperationContext
              ): Promise<IRdfGraphDocument> {
                /**
                 * The graph target and selected format must remain stable while native document
                 * work awaits.
                 */
                const captured = snapshotGraphTarget(target),
                  type = snapshotGraphFormat(format)
                return readNativeFeaturePort(this.store).run(
                  SparqlText.graphGet,
                  ctx,
                  false,
                  SparqlText.get,
                  async (endpoint, signal, map) => ({
                    format: type,
                    text: await requireGraphStore(endpoint).get(map(captured), type, signal)
                  })
                )
              },
              async putGraph(
                target: IRdfGraphTarget,
                document: IRdfGraphDocument,
                ctx?: IOperationContext
              ): Promise<void> {
                /**
                 * The accepted graph and document produce one complete payload before a native
                 * mutation is sent.
                 */
                const captured = snapshotGraphTarget(target),
                  doc = snapshotGraphDocument(document),
                  quads = parseRdfDocument(doc),
                  text = await writeRdfDocument(quads, doc.format)
                return readNativeFeaturePort(this.store).run(
                  SparqlText.graphPut,
                  ctx,
                  true,
                  SparqlText.put,
                  async (endpoint, signal, map) =>
                    requireGraphStore(endpoint).put(
                      map(captured),
                      { format: doc.format, text },
                      signal
                    )
                )
              },
              async mergeGraph(
                target: IRdfGraphTarget,
                document: IRdfGraphDocument,
                ctx?: IOperationContext
              ): Promise<void> {
                /**
                 * The accepted graph and document produce one complete payload before a native
                 * mutation is sent.
                 */
                const captured = snapshotGraphTarget(target),
                  doc = snapshotGraphDocument(document),
                  quads = parseRdfDocument(doc),
                  text = await writeRdfDocument(quads, doc.format)
                return readNativeFeaturePort(this.store).run(
                  SparqlText.graphMerge,
                  ctx,
                  true,
                  SparqlText.post,
                  async (endpoint, signal, map) =>
                    requireGraphStore(endpoint).post(
                      map(captured),
                      { format: doc.format, text },
                      signal
                    )
                )
              },
              async removeGraph(target: IRdfGraphTarget, ctx?: IOperationContext): Promise<void> {
                /**
                 * This accepted input is retained across native, pipeline or rendering awaits;
                 * caller mutation must not change that accepted operation.
                 */
                const captured = snapshotGraphTarget(target)
                return readNativeFeaturePort(this.store).run(
                  SparqlText.graphRemove,
                  ctx,
                  true,
                  SparqlText.remove,
                  async (endpoint, signal, map) =>
                    requireGraphStore(endpoint).remove(map(captured), signal)
                )
              },
              async hasGraph(target: IRdfGraphTarget, ctx?: IOperationContext): Promise<boolean> {
                /**
                 * This accepted input is retained across native, pipeline or rendering awaits;
                 * caller mutation must not change that accepted operation.
                 */
                const captured = snapshotGraphTarget(target)
                return readNativeFeaturePort(this.store).run(
                  SparqlText.graphHas,
                  ctx,
                  false,
                  SparqlText.head,
                  async (endpoint, signal, map) =>
                    requireGraphStore(endpoint).has(map(captured), signal)
                )
              }
            }
          },
          transaction: {}
        }
      }
    }
  )
}
