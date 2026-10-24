import type { Store } from 'oxigraph'
import { namedNode, defaultGraph } from 'oxigraph'
import { sparqlFragment } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { invalidArgument, sparqlError } from './errors.js'
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
/** Physical endpoint state is passed explicitly to named native and organization jobs. */
type IOxigraphEndpointContext = {
  /** Original store belongs to this physical namespace. */
  readonly store: Store
}
export function oxigraphEndpoint(store: Store): ISparqlEndpoint {
  /** Initialize physical owners in original order before a store escapes. */
  const endpointContext = { store } as IOxigraphEndpointContext

  if (
    [
      endpointContext.store.query,
      endpointContext.store.update,
      endpointContext.store.load,
      endpointContext.store.dump
    ].some((method) => typeof method !== 'function')
  )
    throw invalidArgument()
  return {
    query: async (text, accept, signal) => {
      throwIfAborted(signal)
      /**
       * The original native or user result is retained until its accepted write/read branch
       * settles.
       */
      let value: ReturnType<Store['query']>
      try {
        value = endpointContext.store.query(text, { results_format: accept })
      } catch (cause) {
        throw sparqlError(SparqlErrorCode.requestFailed, cause)
      }
      if (typeof value !== 'string') throw sparqlError(SparqlErrorCode.responseInvalid)
      return value
    },
    update: (text: string, signal?: ISparqlAbortSignal) => update(endpointContext, text, signal),
    atomicUpdate: (text: string, signal?: ISparqlAbortSignal) =>
      update(endpointContext, text, signal),
    graphStore: {
      get: async (target, format, signal) => {
        /** The graph identity and output format are chosen before asynchronous existence checking. */
        const graph = graphTerm(endpointContext, target),
          type = snapshotGraphFormat(format)
        if (!(await has(endpointContext, target, signal))) {
          /** A missing native graph preserves its actual 404 status on the original failure. */
          const cause = new Error(SparqlErrorText.requestFailed)
          Object.defineProperty(cause, 'status', { value: 404 })
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
        throwIfAborted(signal)
        try {
          return endpointContext.store.dump({ format: type, from_graph_name: graph })
        } catch (cause) {
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
      },
      put: (target, doc, signal) => write(endpointContext, target, doc, true, signal),
      post: (target, doc, signal) => write(endpointContext, target, doc, false, signal),
      remove: async (value, signal) => {
        /** The accepted graph must remain stable across fragment rendering and native I/O. */
        const target = snapshotGraphTarget(value)
        if (!(await has(endpointContext, target, signal))) {
          /** A missing native graph preserves its actual 404 status on the original failure. */
          const cause = new Error(SparqlErrorText.requestFailed)
          Object.defineProperty(cause, 'status', { value: 404 })
          throw sparqlError(SparqlErrorCode.requestFailed, cause)
        }
        await update(
          endpointContext,
          await renderFragment(
            target.default
              ? sparqlFragment`CLEAR DEFAULT`
              : sparqlFragment`DROP GRAPH ${target.graph}`
          ),
          signal
        )
      },
      has: (value: IRdfGraphTarget, signal?: ISparqlAbortSignal) =>
        has(endpointContext, value, signal)
    }
  } satisfies ISparqlEndpoint
}

/** A started native transaction cannot be cancelled midway or be reported as a rollback. */
async function update(
  endpointContext: IOxigraphEndpointContext,
  text: string,
  signal?: ISparqlAbortSignal
): Promise<void> {
  throwIfAborted(signal)
  try {
    endpointContext.store.update(text)
  } catch (cause) {
    throw sparqlError(SparqlErrorCode.requestFailed, cause)
  }
}

function graphTerm(endpointContext: IOxigraphEndpointContext, value: IRdfGraphTarget) {
  /** The accepted graph must remain stable across fragment rendering and native I/O. */
  const target = snapshotGraphTarget(value)
  return target.default ? defaultGraph() : namedNode(target.graph.value)
}

async function has(
  endpointContext: IOxigraphEndpointContext,
  value: IRdfGraphTarget,
  signal?: ISparqlAbortSignal
): Promise<boolean> {
  /** The accepted graph must remain stable across fragment rendering and native I/O. */
  const target = snapshotGraphTarget(value)
  throwIfAborted(signal)
  if (target.default) return true
  /** Complete native text is consumed before status or result validation can finish. */
  const body = await renderFragment(sparqlFragment`ASK { GRAPH ${target.graph} {} }`)
  try {
    return endpointContext.store.query(body) === true
  } catch (cause) {
    throw sparqlError(SparqlErrorCode.requestFailed, cause)
  }
}

/** Parsing/writing is delegated to the real RDF peer before one complete atomic native Update. */
async function write(
  endpointContext: IOxigraphEndpointContext,
  value: IRdfGraphTarget,
  document: IRdfGraphDocument,
  replace: boolean,
  signal?: ISparqlAbortSignal
): Promise<void> {
  /** Graph identity and document scalars must survive complete RDF conversion before mutation. */
  const target = snapshotGraphTarget(value),
    doc = snapshotGraphDocument(document)
  /** The real RDF parser/writer owns complete document conversion before one native request. */
  const quads = parseRdfDocument(doc),
    text = await writeRdfDocument(quads, SparqlText.triples)
  throwIfAborted(signal)
  if (!replace) {
    try {
      endpointContext.store.load(text, {
        format: SparqlText.triples,
        to_graph_name: graphTerm(endpointContext, target)
      })
      return
    } catch (cause) {
      throw sparqlError(SparqlErrorCode.requestFailed, cause)
    }
  }
  /** N3 owns document grammar/blank escaping; only the graph IRI enters the shared SPARQL compiler. */
  const graph = target.default ? undefined : await renderFragment(sparqlFragment`${target.graph}`)
  /** Complete native text is consumed before status or result validation can finish. */
  const body =
    graph === undefined
      ? `CLEAR DEFAULT; INSERT DATA { ${text} }`
      : `CLEAR SILENT GRAPH ${graph}; CREATE SILENT GRAPH ${graph}; INSERT DATA { GRAPH ${graph} { ${text} } }`
  await update(endpointContext, body, signal)
}
