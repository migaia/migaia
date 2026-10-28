/** Check real package declarations for a DOM-free Node consumer, including native RPC message IO. */
// The neutral StorageHost owns its builtin memory backend; browser backends remain separate.
import { MessageChannel } from 'node:worker_threads'
import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'
import {
  createLogHost,
  type ILogEntry,
  type ILogPlugin,
  type ILogPluginCore
} from '@migaia/log-host'
import { createCapabilityHost } from '@migaia/capability'
import { jsonPlugin } from '@migaia/serialize'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { createStore } from '@migaia/store-light'
import { ObservableArray } from '@migaia/store-indexed'
import { atomDef, createAtomStore } from '@migaia/store-keyed'
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createMutationPolicy } from '@migaia/store-middleware'
import { getDependencyTree } from '@migaia/store-devtools'
import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'
import { createAbortController } from '@migaia/lifecycle'
import type { IAbortSignal } from '@migaia/utils/promise'

const capabilityHost = createCapabilityHost(undefined)
void capabilityHost.dispose()
jsonPlugin()
const runtime = createRuntime()
runtime.signal(0).dispose()
new Resource(() => 1, runtime).dispose()
/** This genuine neutral-memory installation is disposed through its original public Host. */
const memory = await createStorageHost({ plugins: [memoryBackendPlugin()] })
await memory.dispose()
createStore({ count: 0 }).$dispose()
new ObservableArray([0]).dispose()
createAtomStore(runtime).dispose()
atomDef(0)
createSSRRequestScope().dispose()
void createMutationPolicy
void getDependencyTree

const eventChannel = createEventChannel<number>()
const lifecycleSignal: IAbortSignal = createAbortController().signal
const eventSignal: IAbortSignal = lifecycleSignal
subscribeUntil(eventChannel, eventSignal, (event) => {
  void event.value
})

/** A real consumer observes the exact public entry through its installed plugin's core. */
const sink = (entry: ILogEntry): void => {
  void entry.message
}
/** Sink registration retains the package's actual plugin contract without widening its core. */
const capture: ILogPlugin = {
  name: 'consumer-sink',
  /** Register during the original host installation window. */
  install(core: ILogPluginCore) {
    core.useSink(sink)
    return {}
  }
}
/** The consumer owns the created log host and releases its original lifecycle. */
const logger = createLogHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [capture] as const
})
await logger.shutdown('manual')

/** The native channel remains the consumer's resource rather than a second RPC endpoint. */
const channel = new MessageChannel()
/** Node adapter authors implement native IO; the SDK alone owns carrier/codec/session behavior. */
const messageIO: IRpcMessageIO = {
  /** Native handoff preserves the actual transfer list and the SDK's write-start callback. */
  send: (value, transfer, options) => {
    options?.onWriteStart?.()
    channel.port1.postMessage(value, transfer)
  },
  /** The carrier owns this native listener's lifetime through its exact removal receipt. */
  onMessage: (listener) => {
    channel.port1.on('message', listener)
    return () => {
      channel.port1.off('message', listener)
    }
  },
  /** Native close notification retires the same carrier without a second connection owner. */
  onClose: (listener) => {
    channel.port1.on('close', listener)
    return () => {
      channel.port1.off('close', listener)
    }
  },
  /** Native cleanup belongs to the original channel endpoint. */
  close: () => channel.port1.close()
}
void messageIO
channel.port1.close()
channel.port2.close()
