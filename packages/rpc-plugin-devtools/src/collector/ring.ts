/** Owns bounded event columns, reference retirement and query or recording representations. */
import { orderStringKeys } from '@migaia/utils/string'
import {
  RpcProbeDirectionName,
  RpcProbeDirection,
  RpcProbeStage,
  RpcProbeKindName,
  RpcProbeOutcomeName,
  RpcProbeStageName,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { serializeRpcError, type IRpcSerializeErrorOptions } from '@migaia/rpc-contract/errors'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import type { IRpcDevtoolsRecordEvent } from '../contract/record.js'
import { CarrierTable, NameTable } from './intern.js'
import { reportFailure } from './report.js'

/**
 * Numeric columns snapshot the view; routes are owned snapshots and other sparse values are
 * borrowed.
 */
type IRingColumns = {
  seq: Float64Array
  carrierSeq: Float64Array
  sourceSeq: Float64Array
  at: Float64Array
  stage: Uint8Array
  direction: Uint8Array
  kind: Uint8Array
  outcome: Uint8Array
  endpoint: (string | undefined)[]
  method: (string | undefined)[]
  message: (string | undefined)[]
  sender: (string | undefined)[]
  target: (string | undefined)[]
  receiver: (string | undefined)[]
  peer: (string | undefined)[]
  trace: (string | undefined)[]
  hop: Int32Array
  maxHops: Int32Array
  route: (readonly string[] | undefined)[]
  carrier: (string | undefined)[]
  rejection: (string | undefined)[]
  lifecycle: (string | undefined)[]
  variation: (string | undefined)[]
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
  /** Watch delivery stores resolved links before its shared raw origin window retires. */
  #resolvedCarrierSeq: Float64Array
  /** A cold observed reset limits each retained origin to children before that collector sequence. */
  #carrierValidUntil: Float64Array
  /** Cached wire projections are built once per slot at a real query/service boundary. */
  #wire: (IRpcDevtoolsWireEvent | undefined)[]
  /** Metadata service projections separately enforce the content exposure boundary. */
  #metadata: (IRpcDevtoolsWireEvent | undefined)[]
  /** Canonical error projection reports failed graph reads through the same collector reporter. */
  #serializeOptions: IRpcSerializeErrorOptions

  /** Allocate columns once; the hot writer never creates an event object. */
  constructor(capacity: number, names: NameTable, onError?: (error: unknown) => void) {
    this.capacity = capacity
    this.#names = names
    this.#resolvedCarrierSeq = new Float64Array(capacity).fill(-1)
    this.#carrierValidUntil = new Float64Array(capacity).fill(Infinity)
    this.#serializeOptions = { report: (failure) => reportFailure(failure.error, onError) }
    this.#wire = []
    this.#wire.length = capacity
    this.#metadata = []
    this.#metadata.length = capacity
    this.columns = {
      seq: new Float64Array(capacity),
      carrierSeq: new Float64Array(capacity),
      sourceSeq: new Float64Array(capacity),
      at: new Float64Array(capacity),
      stage: new Uint8Array(capacity),
      direction: new Uint8Array(capacity),
      kind: new Uint8Array(capacity),
      outcome: new Uint8Array(capacity),
      endpoint: Array.from<string | undefined>({ length: capacity }),
      method: Array.from<string | undefined>({ length: capacity }),
      message: Array.from<string | undefined>({ length: capacity }),
      sender: Array.from<string | undefined>({ length: capacity }),
      target: Array.from<string | undefined>({ length: capacity }),
      receiver: Array.from<string | undefined>({ length: capacity }),
      peer: Array.from<string | undefined>({ length: capacity }),
      trace: Array.from<string | undefined>({ length: capacity }),
      hop: new Int32Array(capacity),
      maxHops: new Int32Array(capacity),
      route: Array.from<readonly string[] | undefined>({ length: capacity }),
      carrier: Array.from<string | undefined>({ length: capacity }),
      rejection: Array.from<string | undefined>({ length: capacity }),
      lifecycle: Array.from<string | undefined>({ length: capacity }),
      variation: Array.from<string | undefined>({ length: capacity }),
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
    this.bytes -= this.columns.contentBytes[slot]!
    this.columns.content[slot] = undefined
    this.columns.error[slot] = undefined
    this.columns.detail[slot] = undefined
    this.columns.endpoint[slot] = undefined
    this.columns.method[slot] = undefined
    this.columns.message[slot] = undefined
    this.columns.sender[slot] = undefined
    this.columns.target[slot] = undefined
    this.columns.receiver[slot] = undefined
    this.columns.peer[slot] = undefined
    this.columns.trace[slot] = undefined
    this.columns.route[slot] = undefined
    this.columns.carrier[slot] = undefined
    this.columns.rejection[slot] = undefined
    this.columns.lifecycle[slot] = undefined
    this.columns.variation[slot] = undefined
    this.#resolvedCarrierSeq[slot] = -1
    this.#carrierValidUntil[slot] = Infinity
    this.#wire[slot] = undefined
    this.#metadata[slot] = undefined
    this.head = (slot + 1) % this.capacity
    this.count--
  }

  /** Snapshot primitives and the bounded borrowed route; content/detail/error remain references. */
  write(view: IRpcProbeEventView, seq: number, content: unknown, contentBytes: number): number {
    if (this.count === this.capacity) this.drop()
    /** All writes share one physical slot, calculated without allocating a row. */
    const slot = (this.head + this.count) % this.capacity
    /** Fixed-shape columns keep field dispatch outside the hot path. */
    const c = this.columns
    c.seq[slot] = seq
    c.carrierSeq[slot] = view.carrierSeq
    c.sourceSeq[slot] = view.seq
    c.at[slot] = view.at
    c.stage[slot] = view.stage
    c.direction[slot] = view.direction
    c.kind[slot] = view.kind
    c.outcome[slot] = view.outcome
    c.endpoint[slot] = view.endpointId
    c.method[slot] = view.method
    c.message[slot] = view.messageId
    c.sender[slot] = view.senderId
    c.target[slot] = view.targetId
    c.receiver[slot] = view.receiverId
    c.peer[slot] = view.peerId
    c.trace[slot] = view.trace
    c.hop[slot] = view.hop
    c.maxHops[slot] = view.maxHops
    c.route[slot] = view.route === undefined ? undefined : Object.freeze([...view.route])
    c.carrier[slot] = view.carrier
    c.rejection[slot] = view.rejection
    c.lifecycle[slot] = view.lifecycle
    c.variation[slot] = view.variation
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

  /** One representation conversion per retained slot; repeated queries return the stored projection. */
  event(
    slot: number,
    exposeContent: boolean,
    nativeError = false,
    carrierSequences?: ReadonlyMap<number, number>
  ): IRpcDevtoolsRecordEvent {
    /** Recording wants original errors; wire queries use their canonical serialized graph. */
    const cached = exposeContent ? this.#wire[slot] : this.#metadata[slot]
    if (!nativeError && cached) return cached
    /** Conversion at the query/service/record representation boundary is the permitted copy point. */
    const c = this.columns
    /** Every optional scalar is restored from the columns, never from the reusable input view. */
    const event: IRpcDevtoolsRecordEvent = {
      seq: c.seq[slot]!,
      at: c.at[slot]!,
      endpointId: this.#names.name(this.#names.id(c.endpoint[slot]))!,
      stage: RpcProbeStageName[c.stage[slot]!]!,
      direction: RpcProbeDirectionName[c.direction[slot]!]!,
      kind: RpcProbeKindName[c.kind[slot]!]!,
      outcome: RpcProbeOutcomeName[c.outcome[slot]!]!
    }
    /** Cold projection mutation completes before the object is exposed to a caller. */
    const result = event as Record<string, unknown>
    /** Cold correlation never substitutes a source ordinal for a collector ordinal. */
    const carrierSeq = carrierSequences?.get(c.seq[slot]!) ?? this.#resolvedCarrierSeq[slot]!
    if (carrierSeq >= 0) {
      this.#resolvedCarrierSeq[slot] = carrierSeq
      result.carrierSeq = carrierSeq
    }
    if (c.message[slot] !== undefined) result.messageId = c.message[slot]
    if (c.method[slot] !== undefined)
      result.method = this.#names.name(this.#names.id(c.method[slot]))
    if (c.sender[slot] !== undefined)
      result.senderId = this.#names.name(this.#names.id(c.sender[slot]))
    if (c.target[slot] !== undefined)
      result.targetId = this.#names.name(this.#names.id(c.target[slot]))
    if (c.receiver[slot] !== undefined)
      result.receiverId = this.#names.name(this.#names.id(c.receiver[slot]))
    if (c.peer[slot] !== undefined) result.peerId = this.#names.name(this.#names.id(c.peer[slot]))
    if (c.trace[slot] !== undefined) result.trace = this.#names.name(this.#names.id(c.trace[slot]))
    if (c.hop[slot]! >= 0) result.hop = c.hop[slot]
    if (c.maxHops[slot]! >= 0) result.maxHops = c.maxHops[slot]
    if (c.route[slot] !== undefined) result.route = c.route[slot]
    if (c.carrier[slot] !== undefined)
      result.carrier = this.#names.name(this.#names.id(c.carrier[slot]))
    if (c.rejection[slot] !== undefined)
      result.rejection = this.#names.name(this.#names.id(c.rejection[slot]))
    if (c.lifecycle[slot] !== undefined)
      result.lifecycle = this.#names.name(this.#names.id(c.lifecycle[slot]))
    if (c.variation[slot] !== undefined) result.variation = c.variation[slot]
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

  /** A scheduled watch read reconstructs one owned row; ingestion never creates this object. */
  view(slot: number): IRpcProbeEventView {
    /** These columns already own the source primitives and caller-owned sparse references. */
    const c = this.columns
    return {
      seq: c.sourceSeq[slot]!,
      carrierSeq: c.carrierSeq[slot]!,
      at: c.at[slot]!,
      endpointId: c.endpoint[slot]!,
      stage: c.stage[slot]!,
      direction: c.direction[slot]!,
      kind: c.kind[slot]!,
      outcome: c.outcome[slot]!,
      messageId: c.message[slot],
      method: c.method[slot],
      variation: c.variation[slot],
      senderId: c.sender[slot],
      targetId: c.target[slot],
      receiverId: c.receiver[slot],
      peerId: c.peer[slot],
      trace: c.trace[slot],
      hop: c.hop[slot]!,
      maxHops: c.maxHops[slot]!,
      route: c.route[slot],
      carrier: c.carrier[slot],
      rejection: c.rejection[slot],
      lifecycle: c.lifecycle[slot],
      sizeBytes: c.size[slot]!,
      chunkIndex: c.chunkIndex[slot]!,
      chunkCount: c.chunkCount[slot]!,
      members: c.members[slot]!,
      durationMs: c.duration[slot]!,
      error: c.error[slot],
      detail: c.detail[slot],
      content: c.content[slot]
    }
  }

  /**
   * A previously resolved link remains available to other projections and retained copies of this
   * event.
   */
  knownCarrierSequence(slot: number): number {
    return this.#resolvedCarrierSeq[slot]!
  }

  /** Readers use the earliest observed reset without adding ingestion-time generation lookup. */
  carrierValidUntil(slot: number): number {
    return this.#carrierValidUntil[slot]!
  }

  /** A cold reset expires old origins only for later children; historical joins remain valid. */
  expireCarrier(slot: number, sequence: number): void {
    this.#carrierValidUntil[slot] = Math.min(this.#carrierValidUntil[slot]!, sequence)
  }

  /** Watch queues retain a link resolved while the shared raw origin was still readable. */
  resolveCarrier(slot: number, carrierSequences: ReadonlyMap<number, number>): void {
    this.#resolvedCarrierSeq[slot] = carrierSequences.get(this.columns.seq[slot]!) ?? -1
  }

  /** Clearing releases all reference ownership before any name table can be reset. */
  clear(): void {
    while (this.count !== 0) this.drop()
    this.head = 0
  }
}

/**
 * Resolve retained raw origins at a read boundary, including independently retained record/watch
 * rows.
 */
export function readCarrierSequences(rings: readonly EventRing[]): ReadonlyMap<number, number> {
  /**
   * Multiple rings hold copies of one collector event; sequence deduplicates them before generation
   * detection.
   */
  const rows = new Map<number, { ring: EventRing; slot: number; validUntil: number }>()
  /** Retained copies share links already learned by an earlier read, even after the origin retires. */
  const result = new Map<number, number>()
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      /** Physical slots never stand in for collector ordinals. */
      const slot = (ring.head + i) % ring.capacity
      /** Existing cold state proves a link without retaining any additional originating row. */
      const known = ring.knownCarrierSequence(slot)
      if (known >= 0) result.set(ring.columns.seq[slot]!, known)
      if (
        ring.columns.carrierSeq[slot]! >= 0 ||
        (ring.columns.stage[slot] === RpcProbeStage.carrier &&
          ring.columns.direction[slot] === RpcProbeDirection.inbound)
      ) {
        /** Copies share the earliest known generation cutoff even after the reset row retires. */
        const validUntil = Math.min(
          rows.get(ring.columns.seq[slot]!)?.validUntil ?? Infinity,
          ring.carrierValidUntil(slot)
        )
        rows.set(ring.columns.seq[slot]!, { ring, slot, validUntil })
      }
    }
  }
  /** Collector ordinals are nonnegative doubles; their big-endian IEEE bits preserve numeric order. */
  const bits = new DataView(new ArrayBuffer(8))
  /** A fixed-width key keeps the shared linear string owner independent of numeric comparators. */
  const keyed = new Map<string, number>()
  for (const sequence of rows.keys()) {
    bits.setFloat64(0, sequence)
    keyed.set(bits.getBigUint64(0).toString(16).padStart(16, '0'), sequence)
  }
  /** Ordering remains a cold read and costs O(retained rows), with exactly sixteen key digits. */
  const sequences = orderStringKeys(Array.from(keyed.keys())).map((key) => keyed.get(key)!)
  /** The existing carrier identity owner now exists only for this retained reader snapshot. */
  const carriers = new CarrierTable()
  for (const sequence of sequences) {
    /** A deduplicated row preserves its actual endpoint string, not an overflow alias. */
    const { ring, slot } = rows.get(sequence)!
    /** Raw columns contain both source-local and collector-global ordinals. */
    const c = ring.columns
    if (
      c.stage[slot] === RpcProbeStage.carrier &&
      c.direction[slot] === RpcProbeDirection.inbound
    ) {
      /** The canonical cold carrier owner identifies resets while origins remain observable. */
      const retired = carriers.acquireCarrier(c.endpoint[slot]!, c.sourceSeq[slot]!, sequence)
      if (retired !== undefined)
        for (const origin of retired) {
          /** Only currently retained old origins acquire a bounded per-row cutoff. */
          const row = rows.get(origin)!
          row.validUntil = Math.min(row.validUntil, sequence)
        }
    }
    if (c.carrierSeq[slot]! >= 0) {
      /** An entirely evicted unread origin intentionally produces no join. */
      const link = carriers.carrierSequence(c.endpoint[slot]!, c.carrierSeq[slot]!)
      if (link >= 0 && sequence < rows.get(link)!.validUntil && !result.has(sequence))
        result.set(sequence, link)
    }
  }
  /** Every retained copy keeps the same learned link using its existing cold numeric column. */
  for (const ring of rings)
    for (let i = 0; i < ring.count; i++) {
      /** The event sequence identifies the same raw row across independent retention owners. */
      const slot = (ring.head + i) % ring.capacity
      if (result.has(ring.columns.seq[slot]!)) ring.resolveCarrier(slot, result)
      /** Known cutoffs travel between retained copies without keeping the replacement origin alive. */
      const row = rows.get(ring.columns.seq[slot]!)
      if (row !== undefined && row.validUntil < Infinity) ring.expireCarrier(slot, row.validUntil)
    }
  return result
}
