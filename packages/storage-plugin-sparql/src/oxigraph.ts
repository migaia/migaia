import type { Store } from 'oxigraph'
import { namedNode, defaultGraph } from 'oxigraph'
import { sparqlFragment } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { capture, invalidArgument, sparqlError } from './errors.js'
import { SparqlErrorCode } from './error-code.js'
import { SparqlText } from './text.js'
import { SparqlErrorText } from './error-text.js'
import { snapshotGraphTarget, snapshotGraphDocument, snapshotGraphFormat } from './graph-store.js'
import { parseRdfDocument, writeRdfDocument } from './ntriples.js'
import { renderFragment } from './render.js'
import type {
  ISparqlEndpoint,
  ISparqlAbortSignal,
  IRdfGraphTarget,
  IRdfGraphDocument
} from './endpoint.js'
/** Borrow one caller-owned native store; its synchronous operations finish before returning. */
export function oxigraphEndpoint(store: Store): ISparqlEndpoint {
  const native = capture(() => ({
    query: store.query,
    update: store.update,
    load: store.load,
    dump: store.dump
  }))
  if (Object.values(native).some((method) => typeof method !== 'function')) throw invalidArgument()
  /** A started native transaction cannot be cancelled midway or be reported as a rollback. */
  const update = async (text: string, signal?: ISparqlAbortSignal): Promise<void> => {
    throwIfAborted(signal)
    try {
      Reflect.apply(native.update, store, [text])
    } catch (cause) {
      throw sparqlError(SparqlErrorCode.requestFailed, cause)
    }
  }
  const graphTerm = (value: IRdfGraphTarget) => {
    const target = snapshotGraphTarget(value)
    return target.default ? defaultGraph() : namedNode(target.graph.value)
  }
  const has = async (value: IRdfGraphTarget, signal?: ISparqlAbortSignal): Promise<boolean> => {
    const target = snapshotGraphTarget(value)
    throwIfAborted(signal)
    if (target.default) return true
    const body = await renderFragment(sparqlFragment`ASK { GRAPH ${target.graph} {} }`)
    try {
      return Reflect.apply(native.query, store, [body]) === true
    } catch (cause) {
      throw sparqlError(SparqlErrorCode.requestFailed, cause)
    }
  }
  /** Parsing/writing is delegated to the real RDF peer before one complete atomic native Update. */
  const write = async (
    value: IRdfGraphTarget,
    document: IRdfGraphDocument,
    replace: boolean,
    signal?: ISparqlAbortSignal
  ): Promise<void> => {
    const target = snapshotGraphTarget(value),
      doc = snapshotGraphDocument(document)
    const quads = parseRdfDocument(doc),
      text = await writeRdfDocument(quads, SparqlText.triples)
    throwIfAborted(signal)
    if (!replace) {
      try {
        Reflect.apply(native.load, store, [
          text,
          { format: SparqlText.triples, to_graph_name: graphTerm(target) }
        ])
        return
      } catch (cause) {
        throw sparqlError(SparqlErrorCode.requestFailed, cause)
      }
    }
    /**
     * N3 owns document grammar/blank escaping; only the graph IRI enters the shared SPARQL
     * compiler.
     */
    const graph = target.default ? undefined : await renderFragment(sparqlFragment`${target.graph}`)
    const body =
      graph === undefined
        ? `CLEAR DEFAULT; INSERT DATA { ${text} }`
        : `CLEAR SILENT GRAPH ${graph}; CREATE SILENT GRAPH ${graph}; INSERT DATA { GRAPH ${graph} { ${text} } }`
    await update(body, signal)
  }
  return Object.freeze({
    query: async (text, accept, signal) => {
      throwIfAborted(signal)
      try {
        const value = Reflect.apply(native.query, store, [text, { results_format: accept }])
        if (typeof value !== 'string') throw sparqlError(SparqlErrorCode.responseInvalid)
        return value
      } catch (cause) {
        throw sparqlError(SparqlErrorCode.requestFailed, cause)
      }
    },
    update,
    atomicUpdate: update,
    graphStore: {
      get: async (target, format, signal) => {
        const graph = graphTerm(target),
          type = snapshotGraphFormat(format)
        if (!(await has(target, signal))) {
          const cause = new Error(SparqlErrorText.requestFailed)
          Object.defineProperty(cause, 'status', { value: 404 })
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
        throwIfAborted(signal)
        try {
          return Reflect.apply(native.dump, store, [{ format: type, from_graph_name: graph }])
        } catch (cause) {
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
      },
      put: (target, doc, signal) => write(target, doc, true, signal),
      post: (target, doc, signal) => write(target, doc, false, signal),
      remove: async (value, signal) => {
        const target = snapshotGraphTarget(value)
        if (!(await has(target, signal))) {
          const cause = new Error(SparqlErrorText.requestFailed)
          Object.defineProperty(cause, 'status', { value: 404 })
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
        await update(
          await renderFragment(
            target.default
              ? sparqlFragment`CLEAR DEFAULT`
              : sparqlFragment`DROP GRAPH ${target.graph}`
          ),
          signal
        )
      },
      has
    }
  } satisfies ISparqlEndpoint)
}
