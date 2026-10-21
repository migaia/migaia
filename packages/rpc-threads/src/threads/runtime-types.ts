import type { INodeMessagePortLike } from '@migaia/rpc-core/adapters/message-port'

/** A held parent port supplies its real physical close and reader-count operations. */
export type IThreadParentPort = INodeMessagePortLike &
  Readonly<{
    /** Observe this actual parent port's close event once. */
    once(event: 'close', listener: () => void): unknown
    /** Read native message-listener occupancy before Core installs its own reader. */
    listenerCount(event: 'message'): number
  }>

/** Worker queries retain only the native values that the existing resource operation reads. */
export type IThreadNativeWorker = Readonly<{
  /** Native thread identifier; the launcher snapshots it before exit can change it to -1. */
  threadId: number
  /** Post to the actual Worker and preserve the runtime's structured-clone/transfer semantics. */
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  /** Attach native message/error/exit observers to this Worker. */
  on(event: string, listener: (...args: any[]) => void): unknown
  /** Remove only the exact native observer installed by its owner. */
  off(event: string, listener: (...args: any[]) => void): unknown
  /** Observe actual execution exit independently of a terminate request's settlement. */
  once(event: 'exit', listener: (code: number) => void): unknown
  /** Read native message-listener occupancy for exclusive reader admission. */
  listenerCount(event: 'message'): number
  /** Request native termination; the launcher still waits for the real exit event. */
  terminate(): Promise<number>
  /** Optional cold isolate heap sample; absence stays unavailable rather than using process memory. */
  getHeapStatistics?: () => Promise<{ used_heap_size: number; total_heap_size: number }>
  /** Optional cold isolate CPU sample in microseconds, independent of the shared process CPU total. */
  cpuUsage?: () => Promise<{ user: number; system: number }>
  /** Optional native event-loop activity sample, kept distinct from CPU time. */
  performance?: Readonly<{
    eventLoopUtilization(): { active: number; idle: number; utilization: number }
  }>
}>

/** Native construction receives the exact launch metadata and limits admitted by Core. */
export type IThreadNativeWorkerConstructor = new (
  entry: string | URL,
  options: {
    /** Optional native Worker name from the admitted thread specification. */
    name?: string
    /** Original launcher bootstrap and portable business data delivered through workerData. */
    workerData: unknown
    /** Optional selected runtime flags; omission retains native Worker inheritance. */
    execArgv?: string[]
    /** Optional admitted heap bound converted from bytes to Node's old-generation MiB unit. */
    resourceLimits?: { maxOldGenerationSizeMb: number }
  }
) => IThreadNativeWorker

/** Only native construction and automatic parent messaging are acquired at the lazy import boundary. */
export type IThreadNativeRuntimeModule = Readonly<{
  /** Actual Worker constructor; a returned metadata object cannot replace native acquisition. */
  Worker: IThreadNativeWorkerConstructor
  /** Actual child parentPort, or null in the main thread. */
  parentPort: IThreadParentPort | null
  /** Original native workerData input used for bootstrap admission. */
  workerData: unknown
}>

/**
 * An adapter holds actual native module acquisition. Core retains the original import boundary
 * without requiring Node declarations from an unrelated browser-only adapter consumer.
 */
export type IThreadRuntimeResource = Readonly<{
  /** Lazily acquire the actual runtime module; preserve failures for the operation's owner. */
  load(): Promise<IThreadNativeRuntimeModule>
  /** Shared OS process identity for diagnostics, not a per-Worker memory or CPU sample. */
  readonly pid: number
}>
