/**
 * Owns actual Node Worker construction, bootstrap transfer, native exit/termination and channel
 * capture. Source-provided launch facts remain distinct from Host handshake admission.
 */
import { deferred, hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import type { ILaunchContext } from '@migaia/supervision'
import { readRpcLaunchFacts, defaultRpcId, IpcReporterContext } from '@migaia/rpc-host/sdk'
import { threadRuntimeResource } from './runtime-resource.ts'
import type { IThreadHandle, IThreadLauncher, IThreadUsage } from '@migaia/supervision/threads'
import { ThreadLimit } from '@migaia/supervision/threads'
import { attachErrorIdentity } from '@migaia/utils/error'
import { identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import {
  RPC_THREAD_ERROR_SOURCE as ERROR_SOURCE,
  RpcThreadErrorCode,
  RpcCoreErrorCode
} from '@migaia/rpc-contract/error-code'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import type {
  IThreadNativeWorker,
  IThreadRuntimeResource,
  IThreadNodePort
} from './runtime-types.ts'
import { ThreadErrorText } from './error-text.ts'
import { THREAD_FINGERPRINT_PREFIX, THREAD_HEAP_ERROR_CODE, ThreadEvent } from './constants.ts'
import { absoluteThreadEntry, portableThreadSpec } from './error.ts'
import { createNodeThreadCarrier } from './channel.ts'
import { createThreadBootstrap } from './bootstrap.ts'
import type { IThreadChannelFactory, IThreadChannelOptions, IThreadLaunchOptions } from './types.ts'

/** Native execution and its borrowed message port retain separate cleanup owners. */
export type INodeThreadHandle = IThreadHandle &
  Readonly<{
    port: IThreadNodePort
    open?(signal: IAbortSignal): Promise<IRpcCarrier>
  }>
/** Actual exit retains native failure and optional heap-limit classification. */
type INodeThreadExit = { code: number; error?: unknown; limit?: 'heapBytes' }

/** Own immediate native observation, one cold carrier and the original actual-exit Promise. */
class NodeThreadGeneration {
  /** All operations address only this exact acquired Worker. */
  readonly #worker: IThreadNativeWorker
  /** The original runtime supplies cold usage sampling only. */
  readonly #runtime: IThreadRuntimeResource
  /** Background native cleanup failures remain observable. */
  readonly #report: (error: unknown) => void
  /** A physical message resource is created before launch returns, preserving early hello. */
  readonly #carrier: IRpcCarrier
  /** Native error remains reachable until the corresponding actual exit. */
  #failure: unknown
  /** Only the native exit callback settles this receipt and releases the supervisor lease. */
  readonly #exited = deferred<INodeThreadExit>()
  /** Native termination is requested at most once; it is not an exit receipt. */
  #terminating = false
  /** Original exit Promise, immutable identity and cold sampler are published unchanged. */
  readonly value: INodeThreadHandle

  /** Observe failure and exit synchronously, then install the unique cold message reader. */
  constructor(
    worker: IThreadNativeWorker,
    runtime: IThreadRuntimeResource,
    fingerprint: string,
    report: (error: unknown) => void
  ) {
    this.#worker = worker
    this.#runtime = runtime
    this.#report = report
    worker.on(ThreadEvent.error, this.#onError)
    worker.once(ThreadEvent.exit, this.#onExit)
    this.#carrier = createNodeThreadCarrier(worker, fingerprint, report, ThreadEvent.exit)
    this.value = {
      identity: Object.freeze({ threadId: worker.threadId, fingerprint }),
      port: worker,
      exited: this.#exited.promise,
      terminate: this.#terminate,
      open: async (signal) => {
        if (signal.aborted) throw signal.reason
        return this.#carrier
      },
      sampleUsage: this.#sampleUsage
    }
  }
  /** A native failure retires messaging without inventing actual-exit evidence. */
  readonly #onError = (error: unknown): void => {
    this.#failure = error
    void this.#carrier.close(error).catch(this.#report)
  }
  /** Preserve native status, original failure and original heap classification. */
  readonly #onExit = (code: number): void => {
    this.#worker.off(ThreadEvent.error, this.#onError)
    void this.#carrier.close(this.#failure).catch(this.#report)
    this.#exited.resolve({
      code,
      ...(this.#failure === undefined ? {} : { error: this.#failure }),
      ...(this.#failure &&
      typeof this.#failure === 'object' &&
      'code' in this.#failure &&
      this.#failure.code === THREAD_HEAP_ERROR_CODE
        ? { limit: ThreadLimit.heapBytes }
        : {})
    })
    this.#failure = undefined
  }
  /** Detach the carrier before requesting actual native termination exactly once. */
  readonly #terminate = (): void => {
    if (this.#terminating) return
    this.#terminating = true
    void this.#carrier.close().catch(this.#report)
    void this.#worker.terminate().catch(this.#report)
  }
  /** Sample only this Worker isolate and preserve the original usage failure identity. */
  #sampleUsage = async (): Promise<IThreadUsage> => {
    if (this.#worker.threadId === -1) return {}
    try {
      /** Missing APIs remain absent; only supported native reads run in this cold query. */
      const [heap, cpu] = await Promise.all([
        typeof this.#worker.getHeapStatistics === 'function'
          ? this.#worker.getHeapStatistics()
          : undefined,
        typeof this.#worker.cpuUsage === 'function' ? this.#worker.cpuUsage() : undefined
      ])
      if (this.#worker.threadId === -1) return {}
      /** Shared PID is identity only; ELU has an independently labelled activity unit. */
      const elu =
        typeof this.#worker.performance?.eventLoopUtilization === 'function'
          ? this.#worker.performance.eventLoopUtilization()
          : undefined
      return {
        sharedPid: this.#runtime.pid,
        ...(heap
          ? { heapUsedBytes: heap.used_heap_size, heapTotalBytes: heap.total_heap_size }
          : {}),
        ...(cpu ? { cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system } : {}),
        ...(elu
          ? { elu: { active: elu.active, idle: elu.idle, utilization: elu.utilization } }
          : {})
      }
    } catch (cause) {
      throw attachErrorIdentity(new Error(ThreadErrorText.usageSampleFailed, { cause }), {
        source: ERROR_SOURCE,
        code: RpcThreadErrorCode.usageSampleFailed
      })
    }
  }
}

/** The actual lazy Worker launcher owns construction, native limits and no RPC negotiation. */
class NodeThreadLauncher {
  /** Runtime acquisition stays lazy and native to this package. */
  readonly #runtime: IThreadRuntimeResource
  /** Per-launch facts are explicit; native flags remain a stable caller snapshot. */
  readonly #options: IThreadLaunchOptions & Readonly<{ execArgv?: readonly string[] }>
  /** Native capability facts remain the supervisor's original enforcement contract. */
  readonly capabilities = Object.freeze({
    termination: 'enforced',
    'exit-observation': 'enforced',
    'heap-limit': 'enforced'
  })
  /** Retain only launcher configuration; no Worker is acquired at construction. */
  constructor(
    runtime: IThreadRuntimeResource,
    options: IThreadLaunchOptions & Readonly<{ execArgv?: readonly string[] }>
  ) {
    this.#runtime = runtime
    this.#options = options
  }
  /** Capture portable data before native acquisition and preserve constructor failure identity. */
  async launch(
    input: Parameters<IThreadLauncher['launch']>[0],
    context: ILaunchContext
  ): Promise<INodeThreadHandle> {
    if (context.signal.aborted) throw context.signal.reason
    /** Input capture remains before native Worker construction and before budget-owned execution. */
    const spec = portableThreadSpec(input)
    /** Load only the actual worker_threads runtime selected by this package. */
    const { Worker } = await this.#runtime.load()
    if (context.signal.aborted) throw context.signal.reason
    /** A unique launch address survives nested Worker realms and recycled native thread ids. */
    const fingerprint = THREAD_FINGERPRINT_PREFIX + defaultRpcId()
    /** Explicit source facts override only this same launcher's optional standalone configuration. */
    const facts = readRpcLaunchFacts(context)
    /** Native workerData carries initialization and real parent facts, never a protocol ACK. */
    const initial = createThreadBootstrap(spec.name || fingerprint, fingerprint, spec.data, facts)
    /** Construction is the only native acquisition in this operation. */
    let worker: IThreadNativeWorker
    try {
      worker = new Worker(absoluteThreadEntry(spec.entry, true), {
        name: spec.name,
        workerData: initial,
        ...(this.#options.execArgv ? { execArgv: [...this.#options.execArgv] } : {}),
        ...(spec.limits?.heapBytes === undefined
          ? {}
          : { resourceLimits: { maxOldGenerationSizeMb: spec.limits.heapBytes / 1024 / 1024 } })
      })
    } catch (error) {
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.invalidConfig,
        ThreadErrorText.workerOptionsInvalid
      )
    }
    return new NodeThreadGeneration(
      worker,
      this.#runtime,
      fingerprint,
      this.#options.report ?? defaultThreadReporter
    ).value
  }
}

/** Standalone raw launchers retain observable background failures without installing a Host. */
function defaultThreadReporter(error: unknown): void {
  hostRethrowReporter(error, IpcReporterContext)
}

/** Create the real Node-compatible execution owner without constructing a Worker. */
export function createNodeThreadLauncher(
  options: IThreadLaunchOptions & Readonly<{ execArgv?: readonly string[] }> = {},
  runtime: IThreadRuntimeResource = threadRuntimeResource
): IThreadLauncher<INodeThreadHandle> {
  return new NodeThreadLauncher(runtime, options)
}

/** Open the exact launcher's cold carrier, or borrow a caller-owned custom raw native port. */
export function createNodeThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<INodeThreadHandle> {
  return {
    isExclusive: (handle) => handle.port.listenerCount(ThreadEvent.message) === 1,
    async open(handle, signal) {
      if (signal.aborted) throw signal.reason
      return handle.open
        ? handle.open(signal)
        : createNodeThreadCarrier(
            handle.port,
            handle.identity.fingerprint,
            options.report ?? defaultThreadReporter
          )
    }
  }
}
