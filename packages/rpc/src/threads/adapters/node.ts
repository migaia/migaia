import type { IThreadHandle, IThreadLauncher, IThreadUsage } from '@migaia/supervision/threads'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcThreadErrorCode } from '../error-code.js'
import { parentPort } from 'node:worker_threads'
import {
  registerLazyNativeReplayOwner,
  registerNativeReplayOwner
} from '../../core/internal/native-replay.js'
import { ThreadLimit } from '@migaia/supervision/threads'
import type { INodeMessagePortLike } from '../../core/adapters/message-port.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { awaitThreadPreparation, createNodeThreadChannel } from '../channel.js'
import {
  createThreadRuntimeBootstrap,
  readThreadRuntimeAcknowledgement,
  intersectThreadCapabilities
} from '../bootstrap.js'
import { createNodeThreadBootstrapHandoff } from '../receive-handoff.js'
import type { IRuntimePeerSourceContext } from '../../remote/runtime-api/peer.js'
import { readRuntimeLaunchContext } from '../../remote/runtime-api/launch-context.js'
import { invalidThreadConfig } from '../error.js'
import { ThreadErrorText } from '../error-text.js'
import {
  THREAD_FINGERPRINT_PREFIX,
  THREAD_HEAP_ERROR_CODE,
  ThreadEvent,
  ThreadBootstrap
} from '../constants.js'
import { absoluteThreadEntry, portableThreadSpec } from '../error.js'
import type { IThreadChannelFactory, IThreadChannelOptions } from '../types.js'

/** Borrowed message surface remains separate from the launcher's termination owner. */
export type INodeThreadHandle = IThreadHandle &
  Readonly<{
    port: INodeMessagePortLike
    runtimeApi?: Readonly<{
      prepared: Promise<readonly string[]>
      handoff: ReturnType<typeof createNodeThreadBootstrapHandoff>
    }>
  }>
/** Native IDs may recycle; this sequence gives each handle a permanent adapter identity. */
let sequence = 0

/** Only opening a canonical child channel installs the native lifetime observer. */
if (parentPort) {
  /** Native object identity grants provenance; bootstrap fields never do. */
  const port = parentPort
  registerLazyNativeReplayOwner(port, () => {
    /** Remains live until the exact port's physical close event. */
    let alive = true
    port.once('close', () => {
      alive = false
    })
    return { alive: () => alive, exclusive: () => port.listenerCount('message') <= 1 }
  })
}

/** Launch Node Workers with immediate error/exit listeners and true two-phase termination. */
export function createNodeThreadLauncher(
  options: Readonly<{ runtimeApi?: IRuntimePeerSourceContext }> = {}
): IThreadLauncher<INodeThreadHandle> {
  /** Only the source's actual compiled offer enters private capability negotiation. */
  const configuredRuntimeApi = options.runtimeApi
  return {
    capabilities: Object.freeze({
      termination: 'enforced',
      'exit-observation': 'enforced',
      'heap-limit': 'enforced'
    }),
    async launch(input, context) {
      /** Per-launch metadata cannot leak across concurrent uses of a caller-owned launcher. */
      const runtimeApi = readRuntimeLaunchContext(context) ?? configuredRuntimeApi
      if (context.signal.aborted) throw resolveAbortReason(context.signal)
      /** Snapshot data and resolve entry before importing or constructing a platform Worker. */
      const spec = portableThreadSpec(input)
      /** Only this deep adapter can load Node; the threads entry has no platform dependency. */
      const { Worker } = await import('node:worker_threads')
      if (context.signal.aborted) throw resolveAbortReason(context.signal)
      /** Address must be known before Worker creation so its endpoint can accept this peerId. */
      const fingerprint = `${THREAD_FINGERPRINT_PREFIX}${++sequence}`
      /** Runtime metadata is admitted before creating a genuine native Worker. */
      const bootstrap = runtimeApi
        ? createThreadRuntimeBootstrap(spec.name || fingerprint, fingerprint, runtimeApi)
        : undefined
      /** Error and exit hooks attach in this same synchronous construction segment. */
      const worker = new Worker(absoluteThreadEntry(spec.entry, true), {
        name: spec.name,
        workerData: {
          kind: ThreadBootstrap.data,
          peerId: fingerprint,
          ...(bootstrap ? { runtimeApi: bootstrap } : {}),
          ...(spec.data === undefined ? {} : { data: spec.data })
        },
        ...(spec.limits?.heapBytes === undefined
          ? {}
          : { resourceLimits: { maxOldGenerationSizeMb: spec.limits.heapBytes / 1024 / 1024 } })
      })
      /** Retain the original runtime failure until its corresponding actual exit. */
      let failure: unknown
      /** Native failures settle only the opt-in incomplete preparation owner. */
      let rejectPreparation: ((error?: unknown) => void) | undefined
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
        rejectPreparation?.(error)
      }
      worker.on(ThreadEvent.error, onError)
      worker.once(ThreadEvent.exit, (code) => {
        worker.off(ThreadEvent.error, onError)
        rejectPreparation?.(failure)
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
      const native: INodeMessagePortLike = {
        postMessage: (message, transfer) =>
          worker.postMessage(message, transfer as Parameters<typeof worker.postMessage>[1]),
        on: (event, listener) => worker.on(event === 'close' ? ThreadEvent.exit : event, listener),
        off: (event, listener) => worker.off(event === 'close' ? ThreadEvent.exit : event, listener)
      }
      /** The original launcher retains termination/exit while preparation holds one cold message. */
      let preparation: INodeThreadHandle['runtimeApi']
      /** The launch-only abort listener is withdrawn when the exact handle is handed off. */
      let detachLaunchAbort: (() => void) | undefined
      /** Concurrent supervisor requests terminate this actual Worker at most once. */
      const terminate = (): void => {
        if (terminating) return
        terminating = true
        preparation?.handoff.close()
        void worker.terminate()
      }
      if (bootstrap) {
        /** The independent child declaration determines the negotiated static agreement. */
        let resolvePrepared!: (capabilities: readonly string[]) => void
        /** Abort, exit, malformed ACK and cold overflow settle the same preparation consumer. */
        let rejectPrepared!: (error: unknown) => void
        /** Duplicate ACK is invalid during this private negotiation. */
        let acknowledged = false
        /** Capability acknowledgement does not assert endpoint receive readiness. */
        const prepared = new Promise<readonly string[]>((resolve, reject) => {
          resolvePrepared = resolve
          rejectPrepared = reject
        })
        /** Canonical receive becomes direct after the endpoint finishes provider/stream setup. */
        const handoff = createNodeThreadBootstrapHandoff(native, {
          consume(message) {
            if (
              !message ||
              typeof message !== 'object' ||
              !('kind' in message) ||
              message.kind !== ThreadBootstrap.runtimeAcknowledged
            )
              return false
            if (acknowledged) invalidThreadConfig('runtimeApi.ack', ThreadErrorText.bootstrapFailed)
            /** Closed ACK grammar and bounds are validated by the bootstrap owner. */
            const peer = readThreadRuntimeAcknowledgement(message)
            acknowledged = true
            resolvePrepared(intersectThreadCapabilities(bootstrap.capabilities, peer))
            return true
          },
          onFailure: (error) => {
            rejectPrepared(error)
            terminate()
          }
        })
        preparation = Object.freeze({ prepared, handoff })
        rejectPreparation = handoff.fail
        /** Launch cancellation retains its original reason and original native termination owner. */
        const abort = (): void => {
          /** Settle cancellation before cold cleanup can publish its bootstrap wrapper. */
          const reason = resolveAbortReason(context.signal)
          rejectPrepared(reason)
          handoff.fail(reason)
          terminate()
        }
        context.signal.addEventListener('abort', abort, { once: true })
        detachLaunchAbort = () => context.signal.removeEventListener('abort', abort)
        if (context.signal.aborted) abort()
        void exited.then(() => context.signal.removeEventListener('abort', abort))
        // The open consumer owns this rejection; this observer prevents late unhandled rejection.
        void prepared.catch(() => undefined)
      }
      /** The default launcher keeps its original port; opt-in changes cold subscription only. */
      const port = preparation?.handoff.port ?? native
      registerNativeReplayOwner(port, {
        alive: () => !terminating && worker.threadId !== -1,
        exclusive: () => worker.listenerCount('message') <= 1
      })
      detachLaunchAbort?.()
      return {
        identity,
        /** Worker emits exit, whereas core's borrowed MessagePort transport observes close. */
        port,
        ...(preparation ? { runtimeApi: preparation } : {}),
        exited,
        terminate,
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
              sharedPid: process.pid,
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
    }
  }
}

/** Borrow Worker messaging; remote owns the transport and supervision owns actual exit. */
export function createNodeThreadChannelFactory(
  options: IThreadChannelOptions
): IThreadChannelFactory<INodeThreadHandle> {
  return {
    open: async (handle, signal) => {
      if (signal.aborted) throw resolveAbortReason(signal)
      if (handle.runtimeApi) {
        try {
          /** Channel capabilities come from the child's real ACK and this parent's real offer. */
          const negotiated = await awaitThreadPreparation(handle.runtimeApi.prepared, signal)
          /** Explicit adapter policy may only narrow the real bilateral agreement. */
          const capabilities =
            options.capabilities === undefined
              ? negotiated
              : intersectThreadCapabilities(negotiated, options.capabilities)
          return createNodeThreadChannel(
            handle.port,
            handle.identity.fingerprint,
            { ...options, capabilities },
            handle.runtimeApi.handoff
          )
        } catch (error) {
          handle.runtimeApi.handoff.close()
          /** Incomplete native preparation rolls back through the handle's original force owner. */
          handle.terminate()
          throw error
        }
      }
      return createNodeThreadChannel(handle.port, handle.identity.fingerprint, options)
    }
  }
}
