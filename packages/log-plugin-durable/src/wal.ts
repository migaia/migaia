import {
  captureDurableOptions,
  createDurableRuntime,
  type IDurableCore,
  type IDurableRuntime
} from './plugin-runtime.ts'
import { assertLogInteger } from './committed-index.ts'
import { snapshotLogRecords } from './snapshot.ts'
import { DurableKind, LogOperation, LogRecordState, LogStage } from './state-constants.ts'
import type { IDurablePlugin, IDurablePluginOptions, ILogRecord, IWalExt } from './types.ts'

/** One installation borrows the original store and owns no business transaction authority. */
class WalController {
  /** The existing runtime owns admission, cleanup and FIFO ordering. */
  readonly #runtime: IDurableRuntime
  /** Own callable receipt preserves the old nested method and extraction surface. */
  readonly api: IWalExt['wal']
  /** Create one immutable extension after acquiring its original store borrow. */
  constructor(core: IDurableCore, options: IDurablePluginOptions) {
    this.#runtime = createDurableRuntime(core, options, DurableKind.wal)
    this.api = {
      ready: this.#runtime.ready,
      whenIdle: this.#runtime.whenIdle,
      begin: (kind, payload) => this.#begin(kind, payload),
      complete: (seq) => this.#terminal(seq, LogRecordState.done, LogOperation.complete),
      abort: (seq) => this.#terminal(seq, LogRecordState.aborted, LogOperation.abort),
      pending: () => this.#runtime.run(LogOperation.pending, this.#pending)
    }
  }
  /** Capture one intent synchronously before its ordinary FIFO turn. */
  #begin(kind: string, payload: unknown): Promise<number> {
    /** Unsupported payloads reject without admitting any store work. */
    let captured: ReturnType<typeof snapshotLogRecords>
    try {
      this.#runtime.admit()
      captured = snapshotLogRecords([{ kind, payload }])
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.begin, () => this.#appendIntent(captured))
  }
  /** A begin result means the original durable append completed, with the same metadata notice. */
  async #appendIntent(captured: ReturnType<typeof snapshotLogRecords>): Promise<number> {
    /** One actual store append owns the intent's durable commit. */
    const [seq] = await this.#runtime.store.append(captured)
    this.#runtime.observe(() => ({
      stage: LogStage.onWalPending,
      owner: DurableKind.wal,
      operation: LogOperation.begin,
      seq
    }))
    return seq!
  }
  /** Both terminal operations retain identical validation and one-way store state semantics. */
  #terminal(seq: number, state: LogRecordState, operation: string): Promise<void> {
    try {
      assertLogInteger(seq)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(operation, () => this.#runtime.store.setState(seq, state))
  }
  /** Query only the original pending sequence index, preserving committed append order. */
  readonly #pending = (): Promise<readonly ILogRecord[]> => this.#readPending()
  /** Read one actual row for each active pending sequence without retaining historical data. */
  async #readPending(): Promise<readonly ILogRecord[]> {
    /** The caller receives detached store snapshots. */
    const records: ILogRecord[] = []
    for (const seq of await this.#runtime.store.states(LogRecordState.pending)) {
      /** A missing retained row contributes no fabricated intent. */
      const record = (await this.#runtime.store.read(seq, 1))[0]
      if (record?.seq === seq) records.push(record)
    }
    return records
  }
}

/** Record durable intent before business work and permit only original terminal transitions. */
export function walPlugin(options: IDurablePluginOptions): IDurablePlugin<IWalExt> {
  /** The real resource and observer are captured before installation. */
  const captured = captureDurableOptions(options)
  return {
    name: DurableKind.wal,
    config: {},
    install: (core) => ({ wal: new WalController(core, captured).api })
  }
}
