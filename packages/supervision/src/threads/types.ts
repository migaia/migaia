import type {
  ILaunchContext,
  ISupervisor,
  ISupervisorBaseOptions,
  IUnitBudget,
  IUnitHandle,
  IUnitLauncher
} from '../index.js'
import type { ThreadLimit, ThreadUnitKind } from './constants.js'

/** Positive limits forwarded unchanged to the launcher. */
export type IThreadLimits = {
  readonly heapBytes?: number
  readonly callWallTimeMs?: number
}

/** An entry and cloneable data interpreted by the launcher. */
export type IThreadSpec = {
  readonly entry: string
  readonly name?: string
  readonly data?: unknown
  readonly limits?: IThreadLimits
}

/** A settled exit, including any runtime-reported limit or original failure. */
export type IThreadExitStatus = {
  readonly code: number | null
  readonly error?: unknown
  readonly limit?: ThreadLimit
}

/** The fingerprint distinguishes a worker from a reused numeric identifier. */
export type IThreadIdentity = {
  readonly threadId?: number
  readonly fingerprint: string
}

/** Termination requests and actual exit are separate lifecycle events. */
export type IThreadHandle = IUnitHandle<IThreadExitStatus> & {
  readonly identity: IThreadIdentity
  terminate(): void
}

/** A runtime adapter must resolve exited only after execution has stopped. */
export type IThreadLauncher<THandle extends IThreadHandle = IThreadHandle> = IUnitLauncher<
  IThreadSpec,
  THandle,
  ILaunchContext
>

/** A thread lease cannot be mixed with a process or coroutine lease. */
export type IThreadBudget = IUnitBudget<ThreadUnitKind>

/** Core policy plus the thread-specific launcher, specification, and budget. */
export type IThreadSupervisorOptions<THandle extends IThreadHandle = IThreadHandle> =
  ISupervisorBaseOptions<THandle> & {
    readonly launcher: IThreadLauncher<THandle>
    readonly spec: IThreadSpec
    readonly budget: IThreadBudget
  }

/** Public command and inspection surface of a supervised thread. */
export type IThreadSupervisor<THandle extends IThreadHandle = IThreadHandle> = ISupervisor<
  THandle,
  IThreadSpec
>
