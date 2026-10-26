/** Check real package declarations for a DOM-free Node consumer, including native RPC message IO. */
// The neutral StorageHost owns its builtin memory backend; browser backends remain separate.
import { MessageChannel } from 'node:worker_threads'
import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'
import { Logger, type ILogEntry, type ISink } from '@migaia/logger'
import { createCapabilityHost } from '@migaia/capability'
import { jsonPlugin } from '@migaia/serialize'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
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

const sink: ISink = (entry: ILogEntry) => {
  void entry.message
}
new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    {
      name: 'consumer-sink',
      install: (core: any) => {
        core.useSink(sink)
        return {}
      }
    }
  ] as const
})

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
