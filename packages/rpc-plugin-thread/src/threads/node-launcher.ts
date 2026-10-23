import type { IAbortSignal } from '@migaia/utils/promise'
import type { IThreadHandle, IThreadLauncher, IThreadUsage } from '@migaia/supervision/threads'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcThreadErrorCode } from '../error-code.js'
import type { IThreadNativeWorker, IThreadRuntimeResource } from './runtime-types.js'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { identifyRpcBoundaryFailure } from '@migaia/rpc-host/plugin'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-host/plugin'
import {
  createEventEmitterMessageResource,
  holdAdapterLaunch,
  type IAdapterMessageResource
} from '@migaia/rpc-host/plugin'
import { ThreadLimit } from '@migaia/supervision/threads'
import type { IAdapterEventEmitterMessagePort } from '@migaia/rpc-host/plugin'
import { readAdapterAbortReason } from '@migaia/rpc-host/plugin'
import { openThreadMessageResource, constructNodeThreadChannel } from './channel.js'
import { createThreadRuntimeBootstrap, intersectThreadCapabilities } from './bootstrap.js'
import type { IRuntimePeerSourceContext } from '@migaia/rpc-host/plugin'

import { ThreadErrorText } from './error-text.js'
import {
  THREAD_FINGERPRINT_PREFIX,
  THREAD_HEAP_ERROR_CODE,
  ThreadEvent,
  ThreadBootstrap
} from './constants.js'
import { absoluteThreadEntry, portableThreadSpec } from './error.js'
import type { IThreadChannelFactory, IThreadChannelOptions } from './types.js'

/** A public handle owns execution and messaging; startup records remain package-private. */
export type INodeThreadHandle = IThreadHandle &
  Readonly<{
    /** Native messaging surface; channel cleanup and supervisor termination retain separate owners. */
    port: IAdapterEventEmitterMessagePort
  }>

/** The constructed handle's ordinary operation opens its own generation without exposing handoff. */
export type IAdapterNodeThreadHandle = INodeThreadHandle &
  Readonly<{
    /**
     * Open the exact launcher's generation under cancellation; copied handles gain no startup
     * state.
     */
    open(signal: IAbortSignal, options: IThreadChannelOptions): Promise<IRuntimePeerSourceResult>
  }>

/** Exact constructed handles retain their original startup owner; copied shapes receive none. */
const nodePreparations = new WeakMap<
  INodeThreadHandle,
  Readonly<{
    resource: IAdapterMessageResource
    offer?: readonly string[]
  }>
>()

/** Native IDs may recycle; this sequence gives each handle a permanent adapter identity. */
let sequence = 0

/**
 * Create a lazy Node-compatible launcher using the caller's actual runtime resource. Each launch
 * snapshots portable data, requires an absolute entry, then constructs a Worker with immediate
 * error/exit observers. terminate requests at most once; exited settles only on native exit,
 * keeping the original Worker failure and heap-limit classification. Sampling is optional/cold and
 * reports THREAD_USAGE_SAMPLE_FAILED without changing execution state. Factory options default to
 * {}.
 */
export function createAdapterNodeThreadLauncher(
  runtime: IThreadRuntimeResource,
  options: Readonly<{
    /**
     * Optional explicit bootstrap context; the actual held supervisor launch proposal takes
     * precedence.
     */
    runtimeApi?: IRuntimePeerSourceContext
    /** Omission retains native inheritance; short different entries supply filtered runtime flags. */
    execArgv?: readonly string[]
  }> = {}
): IThreadLauncher<IAdapterNodeThreadHandle> {
  /** Only the source's actual compiled offer enters private capability negotiation. */
  const configuredRuntimeApi = options.runtimeApi
  /** The selected flag list is stable per launcher while each native construction receives a copy. */
  const configuredExecArgv = options.execArgv
  return {
    capabilities: Object.freeze({
      termination: 'enforced',
      'exit-observation': 'enforced',
      'heap-limit': 'enforced'
    }),
    async launch(input, context) {
      /** Per-launch metadata cannot leak across concurrent uses of a caller-owned launcher. */
      const runtimeApi = holdAdapterLaunch(context).proposal ?? configuredRuntimeApi
      if (context.signal.aborted) throw readAdapterAbortReason(context.signal)
      /** Snapshot data and resolve entry before importing or constructing a platform Worker. */
      const spec = portableThreadSpec(input)
      /** Only this deep adapter can load Node; the threads entry has no platform dependency. */
      const { Worker } = await runtime.load()
      if (context.signal.aborted) throw readAdapterAbortReason(context.signal)
      /** Address must be known before Worker creation so its endpoint can accept this peerId. */
      const fingerprint = `${THREAD_FINGERPRINT_PREFIX}${++sequence}`
      /** Runtime metadata is admitted before creating a genuine native Worker. */
      const bootstrap = runtimeApi
        ? createThreadRuntimeBootstrap(spec.name || fingerprint, fingerprint, runtimeApi)
        : undefined
      /** The native runtime receives this same actual raw initial message. */
      const initialMessage = {
        kind: ThreadBootstrap.data,
        peerId: fingerprint,
        ...(bootstrap ? { runtimeApi: bootstrap } : {}),
        ...(spec.data === undefined ? {} : { data: spec.data })
      }
      /** A successful native construction owns the Worker before listeners attach below. */
      let worker: IThreadNativeWorker
      try {
        worker = new Worker(absoluteThreadEntry(spec.entry, true), {
          name: spec.name,
          workerData: initialMessage,
          ...(configuredExecArgv ? { execArgv: [...configuredExecArgv] } : {}),
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
      /** Retain the original runtime failure until its corresponding actual exit. */
      let failure: unknown
      /** Native failures settle only the opt-in incomplete preparation owner. */
      let failedResolve!: (error: unknown) => void
      /** Core receives this actual native failure observation independently of eventual exit. */
      const failed = new Promise<unknown>((resolve) => {
        failedResolve = resolve
      })
      /** Resolve only from the real exit event, never the terminate request or Promise. */
      let exitedResolve!: (status: { code: number; error?: unknown; limit?: 'heapBytes' }) => void
      /** No external state machine is added to this settled runtime observation. */
      const exited = new Promise<{ code: number; error?: unknown; limit?: 'heapBytes' }>(
        (resolve) => {
          exitedResolve = resolve
        }
      )
      /** Worker error is observed before Node can treat it as an unhandled host exception. */
      const onError = (error: unknown): void => {
        failure = error
        failedResolve(error)
      }
      worker.on(ThreadEvent.error, onError)
      worker.once(ThreadEvent.exit, (code) => {
        worker.off(ThreadEvent.error, onError)
        failedResolve(failure)
        exitedResolve({
          code,
          ...(failure === undefined ? {} : { error: failure }),
          ...(failure &&
          typeof failure === 'object' &&
          'code' in failure &&
          failure.code === THREAD_HEAP_ERROR_CODE
            ? { limit: ThreadLimit.heapBytes }
            : {})
        })
        failure = undefined
      })
      /** Runtime threadId changes to -1 after exit, so capture it synchronously once. */
      const identity = Object.freeze({
        threadId: worker.threadId,
        fingerprint
      })
      /** Concurrent supervisor teardown requests terminate at most once. */
      let terminating = false
      /** Launcher provenance belongs to this exact borrowed surface, independent of public shape. */
      const native: import('@migaia/rpc-host/plugin').IAdapterEventEmitterMessagePort = {
        postMessage: (message, transfer) =>
          worker.postMessage(message, transfer as Parameters<typeof worker.postMessage>[1]),
        on: (event, listener) => worker.on(event === 'close' ? ThreadEvent.exit : event, listener),
        off: (event, listener) =>
          worker.off(event === 'close' ? ThreadEvent.exit : event, listener),
        once: (_event: 'close', listener: () => void) => worker.once(ThreadEvent.exit, listener),
        listenerCount: (_event: 'message') => worker.listenerCount(ThreadEvent.message)
      }
      /** The message resource borrows the launcher's actual completion and original raw input. */
      let resource: IAdapterMessageResource | undefined
      /** Concurrent supervisor requests terminate this actual Worker at most once. */
      const terminate = (): void => {
        if (terminating) return
        terminating = true
        void resource?.close()
        void worker.terminate()
      }
      resource = createEventEmitterMessageResource(native, {
        exited,
        failed,
        terminate,
        initialMessage
      })
      /** Public messaging retains the same borrowed raw port; Core keeps cold preparation private. */
      const port = native
      /** This exact resource exposes whole channel opening, never preparation callbacks. */
      const handle: IAdapterNodeThreadHandle = {
        identity,
        /** Worker emits exit, whereas core's borrowed MessagePort transport observes close. */
        port,
        exited,
        terminate,
        open: (signal, channelOptions) => openNodeThreadHandle(handle, signal, channelOptions),
        /** Native methods address only this Worker isolate, never process memory or aggregate CPU. */
        async sampleUsage(): Promise<IThreadUsage> {
          if (worker.threadId === -1) return {}
          try {
            /** Missing APIs remain absent; only supported native reads run in this cold query. */
            const [heap, cpu] = await Promise.all([
              typeof worker.getHeapStatistics === 'function'
                ? worker.getHeapStatistics()
                : undefined,
              typeof worker.cpuUsage === 'function' ? worker.cpuUsage() : undefined
            ])
            if (worker.threadId === -1) return {}
            /** Shared PID is identity only; ELU has an independently labelled activity unit. */
            const elu =
              typeof worker.performance?.eventLoopUtilization === 'function'
                ? worker.performance.eventLoopUtilization()
                : undefined
            return {
              sharedPid: runtime.pid,
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
      nodePreparations.set(handle, { resource, offer: bootstrap?.capabilities })
      return handle
    }
  }
}

/** Open the exact handle's preparation, or the existing strict raw-port path for custom handles. */
async function openNodeThreadHandle(
  handle: INodeThreadHandle,
  signal: IAbortSignal,
  options: IThreadChannelOptions
): Promise<IRuntimePeerSourceResult> {
  if (signal.aborted) throw readAdapterAbortReason(signal)
  /** Only the actual launcher retains this Core-owned capture and its own local launch proposal. */
  const preparation = nodePreparations.get(handle)
  if (preparation) {
    try {
      /** A raw launch keeps the fixed profile; only genuine runtime bootstrap enters ACK startup. */
      if (preparation.offer === undefined)
        return preparation.resource.openStatic({
          peerId: handle.identity.fingerprint,
          scheduler: options.scheduler,
          enabled: options.capabilities
        })
      /** Caller policy only narrows the actual runtime offer retained by this launcher. */
      const offer =
        options.capabilities === undefined
          ? preparation.offer
          : intersectThreadCapabilities(preparation.offer, options.capabilities)
      return await openThreadMessageResource(
        preparation.resource,
        handle.identity.fingerprint,
        {
          ...options,
          ...(offer === undefined ? {} : { capabilities: offer })
        },
        signal
      )
    } catch (error) {
      void preparation.resource.close()
      handle.terminate()
      throw error
    }
  }
  return await constructNodeThreadChannel(handle.port, handle.identity.fingerprint, options)
}

/**
 * Build a factory with required scheduler and optional local capability restriction. Exact launcher
 * handles retain their preparation and actual ACK; custom raw-port handles use the fixed borrowed
 * channel path and cannot mint private startup facts. Pre-cancelled opens reject the original abort
 * reason; failed opening of a genuine launched handle requests its release/termination.
 */
export function createAdapterNodeThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<INodeThreadHandle> {
  return {
    open: (handle, signal, timeoutMs) =>
      openNodeThreadHandle(
        handle,
        signal,
        timeoutMs === undefined ? options : { ...options, timeoutMs }
      )
  }
}
