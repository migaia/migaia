import type { IThreadHandle, IThreadLauncher } from '@migaia/supervision/threads'
import { parentPort } from 'node:worker_threads'
import {
  registerLazyNativeReplayOwner,
  registerNativeReplayOwner
} from '../../core/internal/native-replay.js'
import { ThreadLimit } from '@migaia/supervision/threads'
import type { INodeMessagePortLike } from '../../core/adapters/message-port.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { createNodeThreadChannel } from '../channel.js'
import {
  THREAD_FINGERPRINT_PREFIX,
  THREAD_HEAP_ERROR_CODE,
  ThreadEvent,
  ThreadBootstrap
} from '../constants.js'
import { absoluteThreadEntry, portableThreadSpec } from '../error.js'
import type { IThreadChannelFactory, IThreadChannelOptions } from '../types.js'

/** Borrowed message surface remains separate from the launcher's termination owner. */
export type INodeThreadHandle = IThreadHandle & Readonly<{ port: INodeMessagePortLike }>
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
export function createNodeThreadLauncher(): IThreadLauncher<INodeThreadHandle> {
  return {
    capabilities: Object.freeze({
      termination: 'enforced',
      'exit-observation': 'enforced',
      'heap-limit': 'enforced'
    }),
    async launch(input, context) {
      if (context.signal.aborted) throw resolveAbortReason(context.signal)
      /** Snapshot data and resolve entry before importing or constructing a platform Worker. */
      const spec = portableThreadSpec(input)
      /** Only this deep adapter can load Node; the threads entry has no platform dependency. */
      const { Worker } = await import('node:worker_threads')
      if (context.signal.aborted) throw resolveAbortReason(context.signal)
      /** Address must be known before Worker creation so its endpoint can accept this peerId. */
      const fingerprint = `${THREAD_FINGERPRINT_PREFIX}${++sequence}`
      /** Error and exit hooks attach in this same synchronous construction segment. */
      const worker = new Worker(absoluteThreadEntry(spec.entry, true), {
        name: spec.name,
        workerData: {
          kind: ThreadBootstrap.data,
          peerId: fingerprint,
          ...(spec.data === undefined ? {} : { data: spec.data })
        },
        ...(spec.limits?.heapBytes === undefined
          ? {}
          : { resourceLimits: { maxOldGenerationSizeMb: spec.limits.heapBytes / 1024 / 1024 } })
      })
      /** Retain the original runtime failure until its corresponding actual exit. */
      let failure: unknown
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
      }
      worker.on(ThreadEvent.error, onError)
      worker.once(ThreadEvent.exit, (code) => {
        worker.off(ThreadEvent.error, onError)
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
      const port: INodeMessagePortLike = {
        postMessage: (message) => worker.postMessage(message, undefined),
        on: (event, listener) => worker.on(event === 'close' ? ThreadEvent.exit : event, listener),
        off: (event, listener) => worker.off(event === 'close' ? ThreadEvent.exit : event, listener)
      }
      registerNativeReplayOwner(port, {
        alive: () => !terminating && worker.threadId !== -1,
        exclusive: () => worker.listenerCount('message') <= 1
      })
      return {
        identity,
        /** Worker emits exit, whereas core's borrowed MessagePort transport observes close. */
        port,
        exited,
        terminate() {
          if (terminating) return
          terminating = true
          void worker.terminate()
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
      return createNodeThreadChannel(handle.port, handle.identity.fingerprint, options)
    }
  }
}
