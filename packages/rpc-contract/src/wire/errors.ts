/**
 * Projects the existing bounded RPC error tree into flat node references and restores that
 * topology. It owns no error metadata cache; source inspection and native class restoration stay in
 * utils.
 */
import { utf8ByteLength } from '@migaia/utils/bytes'
import { countErrorDataText } from '@migaia/utils/error'
import { normalizePortable } from '../portable/normalize.ts'
import {
  serializeRpcError,
  sanitizeText,
  deserializeRpcError,
  createInvalidWireError
} from '../contract/error.ts'

import { RpcWireLimit } from './limits.ts'
import { RpcWireErrorLimit, RpcWireErrorViolation } from '../contract/wire-error-constants.ts'
import type {
  IRpcSerializedError,
  IRpcWirePortableValue,
  IRpcSerializeErrorOptions,
  IRpcErrorWireMetadata
} from '../contract/types.ts'
import { RpcWireField as F, RpcWirePointer as P, rpcWirePointer } from './constants.ts'
import type { IRpcWireError, IRpcWireErrorNode } from './types.ts'

/** The five fixed scalar fields are charged by the existing RPC text-budget contract. */
const textFields = [F.source, F.code, F.name, F.message, F.stack] as const

/** Flat grammar failures retain the existing INVALID_WIRE_ERROR native boundary identity. */
function invalidGraph(
  pointer: string,
  cause?: unknown,
  metadata?: IRpcErrorWireMetadata,
  violation: RpcWireErrorViolation = RpcWireErrorViolation.type
): never {
  throw createInvalidWireError(cause, pointer, violation, metadata)
}

/** Native restoration projects scalar fields only after flat metadata admission is complete. */
function scalarNode(value: IRpcWireErrorNode): IRpcSerializedError {
  return {
    source: value.source,
    code: value.code,
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...(value.data === undefined ? {} : { data: value.data }),
    ...(value.route === undefined ? {} : { route: value.route }),
    ...(value.truncated === undefined ? {} : { truncated: value.truncated })
  }
}

/** Indexes may repeat or form cycles; only their actual bounded reference domain is constrained. */
function reference(
  value: unknown,
  length: number,
  pointer: string,
  metadata?: IRpcErrorWireMetadata
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= length)
    invalidGraph(pointer, undefined, metadata)
  return value as number
}

/** The original text policy validates surrogate and UTF-8 limits without changing received text. */
function countText(value: string, pointer: string, metadata?: IRpcErrorWireMetadata): number {
  /** Reuse the canonical scalar scanner rather than introducing a second Unicode codec. */
  const checked = sanitizeText(value, false)
  if (checked.changed) invalidGraph(pointer, undefined, metadata, RpcWireErrorViolation.surrogate)
  if (checked.bytes > RpcWireErrorLimit.maxStringBytes)
    invalidGraph(pointer, undefined, metadata, RpcWireErrorViolation.stringBytes)
  return checked.bytes
}

/** Retain the original atomic byte-record charging rule inside diagnostic portable data. */
function dataTextLeaf(
  record: Readonly<Record<string, unknown>>
): { text: string; key: string } | undefined {
  return record.$rpc === 'bytes' && typeof record.base64url === 'string'
    ? { text: record.base64url, key: 'base64url' }
    : undefined
}

/** Validate the five scalar fields and portable diagnostic domain on the original flat node. */
function validateNode(
  value: unknown,
  pointer: string,
  metadata?: IRpcErrorWireMetadata,
  causeProjector?: (cause: unknown) => unknown
): number {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidGraph(pointer, undefined, metadata)
  /** Only fixed known fields are read; numeric graph edges are validated by the graph owner. */
  const node = value as Record<string, unknown>
  /** A node keeps the existing scalar-first error order before optional data and routes. */
  let bytes = 0
  for (const field of textFields) {
    if (node[field] === undefined)
      invalidGraph(`${pointer}/${field}`, undefined, metadata, RpcWireErrorViolation.required)
    if (typeof node[field] !== 'string' || (field !== F.message && node[field].length === 0))
      invalidGraph(`${pointer}/${field}`, undefined, metadata)
    bytes += countText(node[field], `${pointer}/${field}`, metadata)
  }
  /** Structural JSON bytes use the same normalized data already produced by the portable walker. */
  let serializedBytes = bytes
  if (Object.hasOwn(node, F.data)) {
    /** Data keeps the original portable walker and embedding depth; protocol records are not copied. */
    let data: IRpcWirePortableValue
    try {
      data = normalizePortable(
        node.data,
        RpcWireErrorLimit.maxEmbeddingDepth + 1,
        undefined,
        false,
        metadata
      )
    } catch (cause) {
      invalidGraph(
        `${pointer}/data`,
        causeProjector ? causeProjector(cause) : cause,
        metadata,
        RpcWireErrorViolation.dataPortable
      )
    }
    bytes += countErrorDataText(
      data,
      `${pointer}/data`,
      (text, path) => countText(text, path, metadata),
      RpcWireErrorLimit.maxStringBytes,
      (path) => invalidGraph(path, undefined, metadata, RpcWireErrorViolation.dataBytes),
      dataTextLeaf
    )
    if (bytes > RpcWireErrorLimit.maxBytes)
      invalidGraph(`${pointer}/data`, undefined, metadata, RpcWireErrorViolation.totalBytes)
    serializedBytes += utf8ByteLength(JSON.stringify(data))
  }
  if (Object.hasOwn(node, F.truncated) && node.truncated !== true)
    invalidGraph(`${pointer}/truncated`, undefined, metadata, RpcWireErrorViolation.truncatedValue)
  if (Object.hasOwn(node, F.route)) {
    if (
      !Array.isArray(node.route) ||
      node.route.length < 1 ||
      node.route.length > RpcWireLimit.maxForwardRouteNodes ||
      node.route.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f]{32}$/u.test(id))
    )
      invalidGraph(`${pointer}/route`, undefined, metadata)
    bytes += node.route.length * 32
    serializedBytes += node.route.length * 32
    if (bytes > RpcWireErrorLimit.maxBytes)
      invalidGraph(`${pointer}/route`, undefined, metadata, RpcWireErrorViolation.totalBytes)
  }
  return serializedBytes
}

/** Validate bounded flat nodes and edges, retaining the original graph and node identities. */
export function normalizeRpcWireError(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  causeProjector?: (cause: unknown) => unknown
): IRpcWireError {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidGraph(P.error, undefined, metadata)
  /** Graph metadata is read directly, with no enumeration or descriptor/prototype restrictions. */
  const graph = value as Record<string, unknown>
  /** Retain the rejected record while handshake callers keep their existing privacy projection. */
  if (graph.root === undefined)
    invalidGraph(
      rpcWirePointer(P.error, F.root),
      causeProjector ? causeProjector(value) : value,
      metadata
    )
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length === 0 ||
    graph.nodes.length > RpcWireErrorLimit.maxNodes
  )
    invalidGraph(P.nodes, undefined, metadata)
  reference(graph.root, graph.nodes.length, rpcWirePointer(P.error, F.root), metadata)
  /** The existing total text/data allowance is charged once for every flat node. */
  let bytes = 0
  for (let index = 0; index < graph.nodes.length; index++) {
    /** Scalar domains precede outgoing graph edge validation for this node. */
    const pointer = rpcWirePointer(P.nodes, index)
    bytes += validateNode(graph.nodes[index], pointer, metadata, causeProjector)
    if (bytes > RpcWireErrorLimit.maxBytes) invalidGraph(P.nodes, undefined, metadata)
    /** Validation retains this exact node; no replacement scalar record is built. */
    const node = graph.nodes[index] as IRpcWireErrorNode
    if (node.cause !== undefined)
      reference(node.cause, graph.nodes.length, `${pointer}/cause`, metadata)
    if (node.errors !== undefined) {
      if (!Array.isArray(node.errors) || node.errors.length === 0)
        invalidGraph(`${pointer}/errors`, undefined, metadata)
      for (let edge = 0; edge < node.errors.length; edge++)
        reference(node.errors[edge], graph.nodes.length, `${pointer}/errors/${edge}`, metadata)
    }
  }
  return value as IRpcWireError
}

/** Assign one index per already normalized tree node without an identity scan. */
function indexNode(
  node: IRpcSerializedError,
  queue: IRpcSerializedError[],
  indexes: WeakMap<object, number>
): number {
  /** Normalized tree nodes are objects even when the original thrown value was primitive. */
  const existing = indexes.get(node)
  if (existing !== undefined) return existing
  /** The cursor queue makes new children available without shift/splice or recursive traversal. */
  const index = queue.length
  indexes.set(node, index)
  queue.push(node)
  return index
}

/**
 * Reuse source getter order, cycle truncation, privacy summaries and limits from serializeRpcError.
 * The resulting bounded projection is flattened once; no second hostile Error walker is created.
 */
export function serializeRpcWireError(
  value: unknown,
  options: IRpcSerializeErrorOptions,
  metadata?: IRpcErrorWireMetadata
): IRpcWireError {
  /** Existing serializer is the sole owner of live Error inspection and its bounded truncation. */
  const tree = serializeRpcError(value, options, metadata)
  /** These caches belong only to this completed serialization and retain no cross-call state. */
  const indexes = new WeakMap<object, number>()
  /** A cursor visits each admitted projected node once. */
  const queue: IRpcSerializedError[] = []
  /** Node zero is the original primary error projection. */
  const root = indexNode(tree, queue, indexes)
  /** The output list mirrors the same bounded node identities. */
  const nodes: IRpcWireErrorNode[] = []
  for (let cursor = 0; cursor < queue.length; cursor++) {
    /** Only trusted normalized source data is read during this representation pass. */
    const input = queue[cursor]!
    /** Copy scalar fields while replacing recursive edges with indexes. */
    const node: Record<string, unknown> = { ...input }
    delete node[F.cause]
    delete node[F.errors]
    if (input.cause) node.cause = indexNode(input.cause, queue, indexes)
    if (input.errors)
      node.errors = Object.freeze(input.errors.map((child) => indexNode(child, queue, indexes)))
    nodes.push(Object.freeze(node) as IRpcWireErrorNode)
  }
  return Object.freeze({ root, nodes: Object.freeze(nodes) })
}

/**
 * Validate the full bounded node list before restoring each native Error once, then connect exact
 * references in a second linear pass. Same-node aliases and cycles keep the same Error instance.
 */
export function deserializeRpcWireError(value: unknown, metadata?: IRpcErrorWireMetadata): Error {
  /** No native Error objects are published before complete flat input admission succeeds. */
  const graph = normalizeRpcWireError(value, metadata)
  return restoreRpcWireError(graph, metadata)
}

/** Restore an already admitted graph for internal callers without repeating its shape traversal. */
export function restoreRpcWireError(graph: IRpcWireError, metadata?: IRpcErrorWireMetadata): Error {
  /** Generic restoration retains native types, remote stacks, semantic identity and diagnostic data. */
  const errors = graph.nodes.map((node) =>
    deserializeRpcError(scalarNode(node), undefined, metadata)
  )
  for (let index = 0; index < graph.nodes.length; index++) {
    /** Edges point only into the admitted native object list. */
    const node = graph.nodes[index]!
    /** Each entry has exactly one native Error owner created above. */
    const error = errors[index]!
    if (node.route !== undefined) metadata?.routes?.set(error, node.route)
    if (node.cause !== undefined)
      Object.defineProperties(error, {
        [F.cause]: {
          value: errors[node.cause],
          configurable: true,
          writable: true
        }
      })
    if (node.errors)
      Object.defineProperties(error, {
        [F.errors]: {
          value: Object.freeze(node.errors.map((child) => errors[child]!)),
          configurable: true
        }
      })
  }
  return errors[graph.root]!
}
