/**
 * Index Tray admissions, relay receipts and current-generation init; RPC retains native work
 * ownership.
 */
import { createConcurrencyLimiter, type IConcurrencyLimiter } from '@migaia/utils/promise'
import { createTrayError } from '../../errors.js'
import { TrayErrorCode } from '../../error-code.js'
import { TrayInstanceState, TrayCallKind, type TrayManagementMode } from '../constants.js'
import type { IAnyTrayHost, ITrayInstance } from '../typing.js'
import type { ITrayInvocation, ITraySender } from '../remote.js'
/** Metadata belongs to one id admission; RPC remains the connection and generation owner. */
export type ITrayRecord = {
  definition: IAnyTrayHost
  id: string
  admission: object
  config: unknown
  state: TrayInstanceState
  generation: number
  instanceId?: string
  removed: boolean
  queue: IConcurrencyLimiter
  management?: TrayManagementMode
  install?: Promise<void>
  /** Only the current generation shares init; old waiters retain their own original Promise. */
  inits: Map<number, Promise<void>>
  receipts: Set<string>
  /** Pending business sends belong to this admission even after its id is re-admitted. */
  inFlight: number
}
/** Keep admitted metadata and relay receipts together so ended admissions cannot be revived. */
export function createRegistry(
  report: (error: unknown) => void,
  send: (record: ITrayRecord) => ITraySender
) {
  return new TrayRegistry(report, send)
}
/** Owns only admission metadata and exact receipt identities; RPC keeps native generation state. */
class TrayRegistry {
  /** Business metadata is indexed by one admission id. */
  readonly #records = new Map<string, ITrayRecord>()
  /** Authenticated sender projection is revoked before physical resource cleanup. */
  readonly #instanceIds = new Map<string, { record: ITrayRecord; generation: number }>()
  /** Opaque receipts refer to exact admissions, never current same-id replacements. */
  readonly #receipts = new Map<string, ITrayRecord>()
  /** Original native send selector is borrowed without replacing its lifecycle owner. */
  readonly #send: (record: ITrayRecord) => ITraySender
  /** Original reporter is forwarded to the canonical limiter. */
  readonly #report: (error: unknown) => void
  /** Capture the two canonical boundary operations once. */
  constructor(report: (error: unknown) => void, send: (record: ITrayRecord) => ITraySender) {
    this.#report = report
    this.#send = send
  }
  /** Expose the original metadata inventory to the parent admission owner. */
  get records() {
    return this.#records
  }
  /** Expose the exact authenticated identity projection to relay admission. */
  get instanceIds() {
    return this.#instanceIds
  }
  /** Expose original receipt identity for admission checks. */
  get receipts() {
    return this.#receipts
  }

  /** Frozen results capture each management entry's own committed outcome. */
  snapshot = (record: ITrayRecord): ITrayInstance =>
    Object.freeze({
      id: record.id,
      host: record.definition.name,
      runtime: record.definition.runtime,
      state: record.state,
      generation: record.generation,
      config: record.config,
      inFlight: record.inFlight
    })

  /** Validate a captured admission before every new call or lifecycle result. */
  assertCurrent = (record: ITrayRecord): void => {
    if (record.removed || this.#records.get(record.id) !== record)
      throw createTrayError(TrayErrorCode.instanceUnknown)
  }

  /** Lookup is by the admitted record, not an outlet's current same-name connection. */
  get = (id: string): ITrayRecord => {
    const record = this.#records.get(id)
    if (!record) throw createTrayError(TrayErrorCode.instanceUnknown)
    this.assertCurrent(record)
    return record
  }

  /** Remove all receipt and sender projections before resources are released. */
  revoke = (record: ITrayRecord): void => {
    record.removed = true
    this.#records.delete(record.id)
    if (record.instanceId) this.#instanceIds.delete(record.instanceId)
    for (const receipt of record.receipts) this.#receipts.delete(receipt)
    record.receipts.clear()
    record.inits.clear()
  }

  /** Count one original business operation without replacing its native sender. */
  sendCounted(
    record: ITrayRecord,
    kind: 'request',
    input: ITrayInvocation,
    options?: Parameters<ITraySender['request']>[1]
  ): Promise<unknown>
  sendCounted(
    record: ITrayRecord,
    kind: 'notify',
    input: ITrayInvocation,
    options?: Parameters<ITraySender['notify']>[1]
  ): Promise<void>
  sendCounted(
    record: ITrayRecord,
    kind: 'stream',
    input: ITrayInvocation,
    options?: Parameters<ITraySender['stream']>[1]
  ): AsyncIterableIterator<unknown>
  sendCounted(
    record: ITrayRecord,
    kind: TrayCallKind,
    input: ITrayInvocation,
    options?: Parameters<ITraySender['request']>[1]
  ): Promise<unknown> | AsyncIterableIterator<unknown> {
    if (kind === TrayCallKind.stream) return this.#sendStream(record, input, options)
    return this.#sendUnary(record, kind, input, options)
  }
  /** Count the original unary send synchronously and release this admission on either terminal. */
  async #sendUnary(
    record: ITrayRecord,
    kind: 'request' | 'notify',
    input: ITrayInvocation,
    options?: Parameters<ITraySender['request']>[1]
  ): Promise<unknown> {
    record.inFlight += 1
    try {
      return await this.#send(record)[kind](input, options)
    } finally {
      record.inFlight -= 1
    }
  }
  /** Lazy generator counts the original stream until terminal settlement, return or throw. */
  async *#sendStream(
    record: ITrayRecord,
    input: ITrayInvocation,
    options?: Parameters<ITraySender['stream']>[1]
  ): AsyncIterableIterator<unknown> {
    record.inFlight += 1
    try {
      return yield* this.#send(record).stream(input, options)
    } finally {
      record.inFlight -= 1
    }
  }
  /** Original admission operation; mutable registry state stays with this owner. */
  admit = (definition: IAnyTrayHost, id: string, config: unknown): ITrayRecord => {
    if (this.#records.has(id)) throw createTrayError(TrayErrorCode.instanceDuplicate)
    const record: ITrayRecord = {
      definition,
      id,
      admission: {},
      config,
      state: TrayInstanceState.starting,
      generation: 0,
      removed: false,
      queue: createConcurrencyLimiter({ concurrency: 1, report: this.#report }),
      inits: new Map(),
      receipts: new Set(),
      inFlight: 0
    }
    this.#records.set(id, record)
    return record
  }
  /** Original admission operation; mutable registry state stays with this owner. */
  identify = (record: ITrayRecord, generation: number, instanceId: string): void => {
    this.assertCurrent(record)
    if (record.instanceId) this.#instanceIds.delete(record.instanceId)
    if (record.generation !== generation) record.inits.clear()
    record.generation = generation
    record.instanceId = instanceId
    this.#instanceIds.set(instanceId, { record, generation })
  }
  /** Original admission operation; mutable registry state stays with this owner. */
  depart = (record: ITrayRecord, generation: number): void => {
    if (!record.instanceId) return
    const identity = this.#instanceIds.get(record.instanceId)
    if (identity?.record === record && identity.generation === generation)
      this.#instanceIds.delete(record.instanceId)
  }
  /** Original admission operation; mutable registry state stays with this owner. */
  bind = (host: string, id: string): string => {
    const record = this.get(id)
    if (record.definition.name !== host) throw createTrayError(TrayErrorCode.hostMismatch)
    const receipt = crypto!.randomUUID!()
    this.#receipts.set(receipt, record)
    record.receipts.add(receipt)
    return receipt
  }
  /** Original admission operation; mutable registry state stays with this owner. */
  receipt = (host: string, id: string, token: string): ITrayRecord => {
    const record = this.get(id)
    if (record.definition.name !== host) throw createTrayError(TrayErrorCode.hostMismatch)
    if (this.#receipts.get(token) !== record) throw createTrayError(TrayErrorCode.instanceUnknown)
    return record
  }
}

export type ITrayRegistry = ReturnType<typeof createRegistry>
