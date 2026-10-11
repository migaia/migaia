import type { INodeMessagePortLike } from '@migaia/rpc-core/adapters/message-port'

/** A held parent port supplies its real physical close and reader-count operations. */
export type IThreadParentPort = INodeMessagePortLike &
  Readonly<{
    once(event: 'close', listener: () => void): unknown
    listenerCount(event: 'message'): number
  }>

/** Worker queries retain only the native values that the existing resource operation reads. */
export type IThreadNativeWorker = Readonly<{
  threadId: number
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  listenerCount(event: 'message'): number
  terminate(): Promise<number>
  getHeapStatistics?: () => Promise<{ used_heap_size: number; total_heap_size: number }>
  cpuUsage?: () => Promise<{ user: number; system: number }>
  performance?: Readonly<{
    eventLoopUtilization(): { active: number; idle: number; utilization: number }
  }>
}>

/** Native construction receives the exact launch metadata and limits admitted by Core. */
export type IThreadNativeWorkerConstructor = new (
  entry: string | URL,
  options: {
    name?: string
    workerData: unknown
    resourceLimits?: { maxOldGenerationSizeMb: number }
  }
) => IThreadNativeWorker

/** Only native construction and automatic parent messaging are acquired at the lazy import boundary. */
export type IThreadNativeRuntimeModule = Readonly<{
  Worker: IThreadNativeWorkerConstructor
  parentPort: IThreadParentPort | null
  workerData: unknown
}>

/**
 * An adapter holds actual native module acquisition. Core retains the original import boundary
 * without requiring Node declarations from an unrelated browser-only adapter consumer.
 */
export type IThreadRuntimeResource = Readonly<{
  load(): Promise<IThreadNativeRuntimeModule>
  readonly pid: number
}>
