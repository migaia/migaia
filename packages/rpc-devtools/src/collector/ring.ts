import {
  RpcProbeDirectionName,
  RpcProbeDirection,
  RpcProbeStage,
  RpcProbeKindName,
  RpcProbeOutcomeName,
  RpcProbeStageName,
  type IRpcProbeEventView
} from '@migaia/rpc-core/probe'
import { serializeRpcError, type IRpcSerializeErrorOptions } from '@migaia/rpc-contract/errors'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import type { IRpcDevtoolsRecordEvent } from '../contract/record.js'
import { MessageTable, NameTable } from './intern.js'
import { reportFailure } from './report.js'

/** Numeric columns snapshot the reusable view; sparse arrays retain caller-owned references. */
type IRingColumns = {
  seq: Float64Array
  carrierSeq: Float64Array
  carrierAlias: Int32Array
  at: Float64Array
  stage: Uint8Array
  direction: Uint8Array
  kind: Uint8Array
  outcome: Uint8Array
  endpoint: Int32Array
  method: Int32Array
  message: Int32Array
  sender: Int32Array
  target: Int32Array
  receiver: Int32Array
  peer: Int32Array
  trace: Int32Array
  carrier: Int32Array
  rejection: Int32Array
  lifecycle: Int32Array
  size: Int32Array
  chunkIndex: Int32Array
  chunkCount: Int32Array
  members: Int32Array
  duration: Float64Array
  contentBytes: Float64Array
  error: unknown[]
  detail: IRpcProbeEventView['detail'][]
  content: unknown[]
}

/** A fixed-capacity struct-of-arrays store writes and retires each slot in O(1). */
export class EventRing {
  /** One capacity is shared by every typed column and sparse reference slot. */
  readonly capacity: number
  /** Storage columns are read directly by the single-pass query and statistics owners. */
  readonly columns: IRingColumns
  /** Oldest retained slot; modulo indexing never shifts a retained array. */
  head = 0
  /** Number of retained events, always bounded by capacity. */
  count = 0
  /** Content bytes retained by this ring; eviction releases the previous charge. */
  bytes = 0
  /** Name restoration is shared with all collector boundaries. */
  #names: NameTable
  /** Every occupied slot holds a reference in the recyclable message pool. */
  #messages: MessageTable
  /** Cached wire projections are built once per slot at a real query/service boundary (SC9b). */
  #wire: (IRpcDevtoolsWireEvent | undefined)[]
  /** Metadata service projections separately enforce the content exposure boundary. */
  #metadata: (IRpcDevtoolsWireEvent | undefined)[]
  /** Canonical error projection reports failed graph reads through the same collector reporter. */
  #serializeOptions: IRpcSerializeErrorOptions

  /** Allocate columns once; the hot writer never creates an event object. */
  constructor(
    capacity: number,
    names: NameTable,
    messages: MessageTable,
    onError?: (error: unknown) => void
  ) {
    this.capacity = capacity
    this.#names = names
    this.#messages = messages
    this.#serializeOptions = { report: (failure) => reportFailure(failure.error, onError) }
    this.#wire = []
    this.#wire.length = capacity
    this.#metadata = []
    this.#metadata.length = capacity
    this.columns = {
      seq: new Float64Array(capacity),
      carrierSeq: new Float64Array(capacity),
      carrierAlias: new Int32Array(capacity),
      at: new Float64Array(capacity),
      stage: new Uint8Array(capacity),
      direction: new Uint8Array(capacity),
      kind: new Uint8Array(capacity),
      outcome: new Uint8Array(capacity),
      endpoint: new Int32Array(capacity),
      method: new Int32Array(capacity),
      message: new Int32Array(capacity),
      sender: new Int32Array(capacity),
      target: new Int32Array(capacity),
      receiver: new Int32Array(capacity),
      peer: new Int32Array(capacity),
      trace: new Int32Array(capacity),
      carrier: new Int32Array(capacity),
      rejection: new Int32Array(capacity),
      lifecycle: new Int32Array(capacity),
      size: new Int32Array(capacity),
      chunkIndex: new Int32Array(capacity),
      chunkCount: new Int32Array(capacity),
      members: new Int32Array(capacity),
      duration: new Float64Array(capacity),
      contentBytes: new Float64Array(capacity),
      error: [],
      detail: [],
      content: []
    }
    this.columns.error.length = capacity
    this.columns.detail.length = capacity
    this.columns.content.length = capacity
  }

  /** Retire the oldest slot and release all its object/message ownership. */
  drop(): void {
    if (this.count === 0) return
    /** One old slot holds exactly the references released by this retirement. */
    const slot = this.head
    this.#messages.release(this.columns.message[slot]!)
    this.#messages.release(this.columns.carrierAlias[slot]!)
    this.bytes -= this.columns.contentBytes[slot]!
    this.columns.content[slot] = undefined
    this.columns.error[slot] = undefined
    this.columns.detail[slot] = undefined
    this.#wire[slot] = undefined
    this.#metadata[slot] = undefined
    this.head = (slot + 1) % this.capacity
    this.count--
  }

  /** Snapshot primitives immediately; content/detail/error remain references under root SC9. */
  write(
    view: IRpcProbeEventView,
    seq: number,
    content: unknown,
    contentBytes: number,
    endpoint?: number,
    method?: number
  ): number {
    /** Acquire first so a repeated id cannot disappear during its own eviction. */
    const message = this.#messages.acquire(view.messageId)
    /** One existing endpoint id also scopes the emitter's local carrier sequence. */
    const endpointId = endpoint ?? this.#names.id(view.endpointId)
    /** Acquisition precedes eviction so a one-slot ring cannot retire its own current alias. */
    const carrierAlias =
      view.stage === RpcProbeStage.carrier && view.direction === RpcProbeDirection.inbound
        ? this.#messages.acquireCarrier(endpointId, view.seq, seq)
        : -1
    /** Translate once per writer without touching the publisher-owned reusable view. */
    const carrierSeq =
      view.carrierSeq >= 0 ? this.#messages.carrierSequence(endpointId, view.carrierSeq) : -1
    if (this.count === this.capacity) this.drop()
    /** All writes share one physical slot, calculated without allocating a row. */
    const slot = (this.head + this.count) % this.capacity
    /** Fixed-shape columns keep field dispatch outside the hot path. */
    const c = this.columns
    c.seq[slot] = seq
    c.carrierSeq[slot] = carrierSeq
    c.carrierAlias[slot] = carrierAlias
    c.at[slot] = view.at
    c.stage[slot] = view.stage
    c.direction[slot] = view.direction
    c.kind[slot] = view.kind
    c.outcome[slot] = view.outcome
    c.endpoint[slot] = endpointId
    c.method[slot] = method ?? this.#names.id(view.method)
    c.message[slot] = message
    c.sender[slot] = this.#names.id(view.senderId)
    c.target[slot] = this.#names.id(view.targetId)
    c.receiver[slot] = this.#names.id(view.receiverId)
    c.peer[slot] = this.#names.id(view.peerId)
    c.trace[slot] = this.#names.id(view.trace)
    c.carrier[slot] = this.#names.id(view.carrier)
    c.rejection[slot] = this.#names.id(view.rejection)
    c.lifecycle[slot] = this.#names.id(view.lifecycle)
    c.size[slot] = view.sizeBytes
    c.chunkIndex[slot] = view.chunkIndex
    c.chunkCount[slot] = view.chunkCount
    c.members[slot] = view.members
    c.duration[slot] = view.durationMs
    c.error[slot] = view.error
    c.detail[slot] = view.detail
    c.content[slot] = content
    c.contentBytes[slot] = contentBytes
    this.bytes += contentBytes
    this.count++
    return slot
  }

  /** One SC9b conversion per retained slot; repeated queries return the stored projection. */
  event(slot: number, exposeContent: boolean, nativeError = false): IRpcDevtoolsRecordEvent {
    /** Recording wants original errors; wire queries use their canonical serialized graph. */
    const cached = exposeContent ? this.#wire[slot] : this.#metadata[slot]
    if (!nativeError && cached) return cached
    /** Conversion at the query/service/record representation boundary is permitted by SC9b. */
    const c = this.columns
    /** Every optional scalar is restored from the columns, never from the reusable input view. */
    const event: IRpcDevtoolsRecordEvent = {
      seq: c.seq[slot]!,
      at: c.at[slot]!,
      endpointId: this.#names.name(c.endpoint[slot]!)!,
      stage: RpcProbeStageName[c.stage[slot]!]!,
      direction: RpcProbeDirectionName[c.direction[slot]!]!,
      kind: RpcProbeKindName[c.kind[slot]!]!,
      outcome: RpcProbeOutcomeName[c.outcome[slot]!]!
    }
    /** Cold projection mutation completes before the object is exposed to a caller. */
    const result = event as Record<string, unknown>
    if (c.carrierSeq[slot]! >= 0) result.carrierSeq = c.carrierSeq[slot]
    if (c.message[slot]! >= 0) result.messageId = this.#messages.name(c.message[slot]!)
    if (c.method[slot]! >= 0) result.method = this.#names.name(c.method[slot]!)
    if (c.sender[slot]! >= 0) result.senderId = this.#names.name(c.sender[slot]!)
    if (c.target[slot]! >= 0) result.targetId = this.#names.name(c.target[slot]!)
    if (c.receiver[slot]! >= 0) result.receiverId = this.#names.name(c.receiver[slot]!)
    if (c.peer[slot]! >= 0) result.peerId = this.#names.name(c.peer[slot]!)
    if (c.trace[slot]! >= 0) result.trace = this.#names.name(c.trace[slot]!)
    if (c.carrier[slot]! >= 0) result.carrier = this.#names.name(c.carrier[slot]!)
    if (c.rejection[slot]! >= 0) result.rejection = this.#names.name(c.rejection[slot]!)
    if (c.lifecycle[slot]! >= 0) result.lifecycle = this.#names.name(c.lifecycle[slot]!)
    if (c.size[slot]! >= 0) result.sizeBytes = c.size[slot]
    if (c.chunkIndex[slot]! >= 0)
      result.chunk = { index: c.chunkIndex[slot], count: c.chunkCount[slot] }
    if (c.members[slot]! >= 0) result.members = c.members[slot]
    if (c.duration[slot]! >= 0) result.durationMs = c.duration[slot]
    if (c.error[slot] !== undefined)
      result.error = nativeError
        ? c.error[slot]
        : serializeRpcError(c.error[slot], this.#serializeOptions)
    if (c.detail[slot] !== undefined) result.detail = c.detail[slot]
    if (exposeContent && c.content[slot] !== undefined) result.content = c.content[slot]
    if (!nativeError) {
      if (exposeContent) this.#wire[slot] = event as IRpcDevtoolsWireEvent
      else this.#metadata[slot] = event as IRpcDevtoolsWireEvent
    }
    return event
  }

  /** Clearing releases all reference ownership before any name table can be reset. */
  clear(): void {
    while (this.count !== 0) this.drop()
    this.head = 0
  }
}
