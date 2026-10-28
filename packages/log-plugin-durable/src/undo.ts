import { noop } from '@migaia/utils/function'
import { createDurableError, createDurableTypeError, LogDurableErrorCode } from './errors.ts'
import {
  captureDurableOptions,
  captureAppendPort,
  captureUndoListOptions,
  createDurableRuntime,
  type IDurableCore,
  type IDurableRuntime
} from './plugin-runtime.ts'
import { requireText, snapshotPayload } from './snapshot.ts'
import { DurableKind, UNDO_PLUGIN_NAME, LogOperation, LogRecordState } from './state-constants.ts'
import { DurableText } from './error-text.ts'
import type {
  IDurablePlugin,
  IDurablePluginOptions,
  ILogAppendNotice,
  ILogAppendOptions,
  ILogPayload,
  ILogRecord,
  IUndoImage,
  IUndoLogExt
} from './types.ts'

/** Active images remain linked in nondecreasing committed append/time order. */
type IUndoNode = {
  txId: string
  seq: number
  time: number
  images: readonly IUndoImage[]
  previous?: IUndoNode
  next?: IUndoNode
}

/** Recovery and caller admission preserve their distinct existing durable error codes. */
function invalidUndoPayload(recovering: boolean): never {
  if (recovering) throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt)
  throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
}
/** Project owned undo fields only after shared JSON admission has excluded accessors. */
function undoPayload(
  value: ILogPayload,
  recovering = true
): { txId: string; images: readonly IUndoImage[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidUndoPayload(recovering)
  /** Only the persisted owned envelope determines undo recovery. */
  const record = value as Record<string, ILogPayload>
  if (typeof record.txId !== 'string' || record.txId.length === 0 || !Array.isArray(record.images))
    return invalidUndoPayload(recovering)
  /** Each returned image detaches the envelope while preserving JSON value semantics. */
  const images: IUndoImage[] = []
  for (const value of record.images) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return invalidUndoPayload(recovering)
    // Exactly three persisted image keys define the existing undo format.
    for (const key of ['target', 'before', 'after'])
      if (!Object.hasOwn(value, key)) return invalidUndoPayload(recovering)
    /** The shared snapshot already guarantees this plain JSON object has no accessors. */
    const image = value as Record<string, ILogPayload>
    images.push({ target: image.target, before: image.before, after: image.after })
  }
  return { txId: record.txId, images }
}

/** An installed undo plugin owns only its index and provisional identity reservations. */
class UndoController {
  /** The actual injected resource remains owned by its creator. */
  readonly #options: IDurablePluginOptions
  /** Canonical lifecycle/FIFO ownership is borrowed from the existing host runtime. */
  readonly #runtime: IDurableRuntime
  /** Active transaction identity lookup avoids scans during admission and forget. */
  readonly #index = new Map<string, IUndoNode>()
  /** Committed sequence lookup makes source replay idempotent. */
  readonly #bySeq = new Map<number, IUndoNode>()
  /** Descending list traversal starts at the newest active committed image. */
  #tail: IUndoNode | undefined
  /** Reservations represent only currently staged native transaction identities. */
  readonly #reservations = new Map<string, object>()
  /** Source progress follows committed sequence numbers independently of plugin callbacks. */
  #cursor = 0
  /** Native resource notices advance this committed high watermark. */
  #notified = 0
  /** Own callbacks preserve the original nested public method identities. */
  readonly api: IUndoLogExt['undo']

  /** Acquire the original store borrow and register index cleanup on the same installation. */
  constructor(core: IDurableCore, options: IDurablePluginOptions) {
    this.#options = options
    this.#runtime = createDurableRuntime(core, options, DurableKind.undo, this.#initialize)
    this.#runtime.afterIdle.add(this.#clearIndexes)
    this.api = {
      ready: this.#runtime.ready,
      whenIdle: this.#runtime.whenIdle,
      record: (txId, images, appendOptions) => this.#record(txId, images, appendOptions),
      get: (txId) => this.#get(txId),
      list: (listOptions) => this.#list(listOptions),
      forget: (txId) => this.#forget(txId)
    }
  }
  /** Accept owned committed rows exactly once, rejecting different active duplicate identities. */
  #accept(record: ILogRecord): void {
    if (record.kind !== DurableKind.undo || this.#bySeq.has(record.seq)) return
    /** Recovery projects only the pre-existing undo envelope. */
    const payload = undoPayload(record.payload)
    if (this.#index.has(payload.txId))
      throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt)
    /** Each active image owns its append-order neighbors until explicitly forgotten. */
    const node: IUndoNode = { ...payload, seq: record.seq, time: record.time, previous: this.#tail }
    if (this.#tail) this.#tail.next = node
    this.#tail = node
    this.#index.set(node.txId, node)
    this.#bySeq.set(node.seq, node)
  }
  /** The runtime schedules this stable callback as its initialization task. */
  readonly #initialize = (): Promise<void> => this.#recover()
  /** Subscribe before reading the committed head so live commits cannot fall through a gap. */
  async #recover(): Promise<void> {
    /** The actual resource notice survives plugin replacement and late native commits. */
    const off = this.#options.store.onAppend(this.#onAppend)
    this.#runtime.cleanups.add(off)
    this.#runtime.cleanups.add(this.#clearReservations)
    /** Recovery considers exactly the head visible at this point. */
    const high = await this.#options.store.lastSeq()
    for (const seq of await this.#options.store.states(LogRecordState.pending)) {
      if (seq > high) break
      /** Only actual retained pending rows enter the undo index. */
      const record = (await this.#options.store.read(seq, 1))[0]
      if (record?.seq === seq) this.#accept(record)
    }
    this.#cursor = high
    this.#notified = Math.max(this.#notified, high)
  }
  /** Resource notices retain one stable callback rather than per-commit captured state. */
  readonly #onAppend = (notice: ILogAppendNotice): void => this.#notice(notice)
  /** Synchronize committed resource progress through the installation's original FIFO. */
  #notice(notice: ILogAppendNotice): void {
    this.#notified = Math.max(this.#notified, notice.lastSeq)
    void this.#runtime.run(LogOperation.read, this.#synchronizeTask).catch(this.#stop)
  }
  /** Failed source synchronization has already been reported by the runtime boundary. */
  readonly #stop = (): void => this.#runtime.stop()
  /** Revocation releases provisional identities without publishing them. */
  readonly #clearReservations = (): void => this.#reservations.clear()
  /** Index cleanup waits until all previously accepted operations complete. */
  readonly #clearIndexes = (): void => {
    this.#index.clear()
    this.#bySeq.clear()
    this.#reservations.clear()
    this.#tail = undefined
  }
  /** A stable task is borrowed by ordinary work and native commit reservation completion. */
  readonly #synchronizeTask = (): Promise<void> => this.#synchronize()
  /** Advance once across committed source records, retaining the original fixed read page. */
  async #synchronize(): Promise<void> {
    while (this.#cursor < this.#notified) {
      /** Each page advances the sequence cursor without copying historical pages again. */
      const records = await this.#options.store.read(this.#cursor + 1, 128)
      if (records.length === 0) {
        this.#cursor = this.#notified
        break
      }
      for (const record of records) {
        if (record.seq > this.#notified) break
        this.#accept(record)
        this.#cursor = record.seq
      }
    }
  }
  /** Same-sequence notice replay is idempotent; different active duplicates remain corruption. */
  async #publish(seqs: readonly number[]): Promise<void> {
    for (const seq of seqs) {
      /** Native append results project only their actual committed rows. */
      const record = (await this.#options.store.read(seq, 1))[0]
      if (record?.seq === seq) this.#accept(record)
    }
  }
  /** Reject identities already committed or provisionally owned by this installation. */
  #check(txId: string): void {
    if (this.#index.has(txId) || this.#reservations.has(txId))
      throw createDurableError(LogDurableErrorCode.undoRecordExists, DurableText.undoExists)
  }
  /** Capture payload and transaction authority synchronously before any native append starts. */
  #record(txId: string, images: readonly unknown[], options?: ILogAppendOptions): Promise<void> {
    /** Shared JSON admission snapshots all caller images before a FIFO wait. */
    let payload: ILogPayload
    /** The exact optional native transaction is borrowed, never replaced or committed here. */
    let port: ReturnType<typeof captureAppendPort>
    try {
      this.#runtime.admit()
      requireText(txId)
      payload = snapshotPayload({ txId, images })
      undoPayload(payload, false)
      port = captureAppendPort(options)
    } catch (error) {
      return Promise.reject(error)
    }
    if (port) {
      try {
        this.#check(txId)
      } catch (error) {
        return Promise.reject(error)
      }
      /** One receipt owns the provisional identity until actual commit, rollback or rejection. */
      const reservation = new UndoReservation(
        this.#reservations,
        txId,
        this.#runtime,
        this.#synchronizeTask
      )
      /** Immediate native append does not wait behind an ordinary blocked task. */
      const result = this.#runtime.appendPort(
        port,
        [{ kind: DurableKind.undo, payload }],
        reservation.committed,
        reservation.release
      )
      void result.catch(reservation.release)
      return result.then(noop)
    }
    return this.#runtime.run(LogOperation.record, () => this.#recordOrdinary(txId, payload))
  }
  /** A normal record becomes visible only after its real durable append succeeds. */
  async #recordOrdinary(txId: string, payload: ILogPayload): Promise<void> {
    await this.#synchronize()
    this.#check(txId)
    /** The native resource alone commits these captured images. */
    const seqs = await this.#options.store.append([{ kind: DurableKind.undo, payload }])
    await this.#publish(seqs)
  }
  /** Validate identity before borrowing the original FIFO. */
  #get(txId: string): Promise<readonly IUndoImage[] | undefined> {
    try {
      requireText(txId)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.get, () => this.#getCommitted(txId))
  }
  /** Return an independent snapshot after catching up to actual resource notices. */
  async #getCommitted(txId: string): Promise<readonly IUndoImage[] | undefined> {
    await this.#synchronize()
    /** The original active identity index is the sole source of undo images. */
    const node = this.#index.get(txId)
    return node ? (snapshotPayload(node.images) as readonly IUndoImage[]) : undefined
  }
  /** Capture inclusive-zero limits and nonnegative time before queueing. */
  #list(options?: {
    readonly limit?: number
    readonly sinceTime?: number
  }): Promise<readonly { readonly txId: string; readonly time: number }[]> {
    /** Read caller accessors once before asynchronous work. */
    let captured: ReturnType<typeof captureUndoListOptions>
    try {
      captured = captureUndoListOptions(options)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.list, () =>
      this.#listCommitted(captured.limit, captured.sinceTime)
    )
  }
  /** Descending linked traversal preserves append order without sorting a growable collection. */
  async #listCommitted(
    limit: number,
    sinceTime: number
  ): Promise<readonly { readonly txId: string; readonly time: number }[]> {
    await this.#synchronize()
    /** Public list rows contain metadata only, never mutable internal nodes. */
    const result: { txId: string; time: number }[] = []
    for (
      let node = this.#tail;
      node && result.length < limit && node.time >= sinceTime;
      node = node.previous
    )
      result.push({ txId: node.txId, time: node.time })
    return result
  }
  /** Missing identities remain an idempotent forget success. */
  #forget(txId: string): Promise<void> {
    try {
      requireText(txId)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.forget, () => this.#forgetCommitted(txId))
  }
  /** Persist terminal state before unlinking this active image from both indexes. */
  async #forgetCommitted(txId: string): Promise<void> {
    await this.#synchronize()
    /** Only this actual committed node can become forgotten. */
    const node = this.#index.get(txId)
    if (!node) return
    await this.#options.store.setState(node.seq, LogRecordState.done)
    if (node.previous) node.previous.next = node.next
    if (node.next) node.next.previous = node.previous
    else this.#tail = node.previous
    this.#index.delete(txId)
    this.#bySeq.delete(node.seq)
  }
}

/** One staged identity has its own explicit release state and original runtime accounting. */
class UndoReservation {
  /** Only this installation's provisional map is borrowed. */
  readonly #reservations: Map<string, object>
  /** The immutable transaction identity belongs to this one native append. */
  readonly #txId: string
  /** Object identity prevents late callbacks from deleting a replacement reservation. */
  readonly #identity = {}
  /** Commit projection rejoins the canonical original FIFO. */
  readonly #runtime: IDurableRuntime
  /** Synchronization is borrowed from the owning undo index. */
  readonly #synchronize: () => Promise<void>
  /** Claim a checked identity before native port invocation can synchronously reenter. */
  constructor(
    reservations: Map<string, object>,
    txId: string,
    runtime: IDurableRuntime,
    synchronize: () => Promise<void>
  ) {
    this.#reservations = reservations
    this.#txId = txId
    this.#runtime = runtime
    this.#synchronize = synchronize
    reservations.set(txId, this.#identity)
  }
  /** Release remains stable when borrowed by rollback and rejection callbacks. */
  readonly release = (): void => {
    if (this.#reservations.get(this.#txId) === this.#identity) this.#reservations.delete(this.#txId)
  }
  /** Native commit only schedules original source synchronization before releasing its identity. */
  readonly committed = (): void => {
    void this.#runtime
      .run(LogOperation.read, this.#synchronizeAndRelease)
      .catch(this.#runtime.report)
  }
  /** The original committed source notice determines visibility, never provisional append results. */
  readonly #synchronizeAndRelease = (): Promise<void> => this.#finishCommit()
  /** A failed source sync leaves its original rejection and reservation lifetime intact. */
  async #finishCommit(): Promise<void> {
    await this.#synchronize()
    this.release()
  }
}

/** Store undo images without authority to apply, commit or roll back business data. */
export function undoLogPlugin(options: IDurablePluginOptions): IDurablePlugin<IUndoLogExt> {
  /** Cold capture keeps caller resources out of cloneable plugin configuration. */
  const captured = captureDurableOptions(options)
  return {
    name: UNDO_PLUGIN_NAME,
    config: {},
    install: (core) => ({ undo: new UndoController(core, captured).api })
  }
}
