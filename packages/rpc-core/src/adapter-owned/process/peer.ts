import { assertRuntimeProcessTransfer } from '../../core/internal/runtime-call-options.js'
import {
  readRuntimePreparationContext,
  withRuntimePreparationContext
} from '../../remote/runtime-api/launch-context.js'
import { readRuntimeDefaultTimeout } from '../../remote/runtime-api/timeout.js'
import { createRuntimePeer, RuntimePluginKey } from '../../remote/index.js'
import type { IRuntimePeerOptions, IRuntimeTypedPeer, IRuntimeFlatten } from '../../remote/index.js'
import { createProcessSourcePeer } from './runtime-peer.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
import { createAutomaticProcessPeer } from './automatic-peer.js'
import type { IProcessByteChannel } from './types.js'

/** A runtime adapter reads discovery from the environment it holds and opens its actual stdio. */
export type IAdapterProcessRuntimeIO = Readonly<{
  discover(): Readonly<{ marker: string | undefined; runtime: string }>
  open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
}>
/**
 * The loaded native module supplies its actual stdio resource rather than a peer-construction
 * callback.
 */
export type IAdapterProcessRuntimeModule = Readonly<{
  processRuntimeIO: IAdapterProcessRuntimeIO
}>
/** Native runtime loading stays outside Core and returns the original import Promise unchanged. */
export type IAdapterProcessRuntimeLoader = Readonly<{
  load(): Promise<IAdapterProcessRuntimeModule> | undefined
}>

/**
 * A third-party process adapter supplies its held runtime I/O loader. Core owns source assembly,
 * transfer restrictions, authenticated bootstrap and private preparation state for this peer.
 */
export function createAdapterProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** The original untyped construction retains its Promise and actual native source ordering. */
export function createAdapterProcessPeer(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader
): Promise<object> {
  readRuntimeDefaultTimeout(options)
  return withRuntimePreparationContext(
    options,
    {
      ...readRuntimePreparationContext(options),
      restrictTransfer: assertRuntimeProcessTransfer
    },
    () => {
      /** Loading stays within the original preparation scope and adds no extra import continuation. */
      const loaded = runtime.load()
      if (!loaded) return createRuntimePeer(options as IRuntimePeerOptions)
      return loaded.then((module) => {
        readRuntimeDefaultTimeout(options)
        /** Discovery precedes explicit-source effects exactly as in the native adapter. */
        const discovery = module.processRuntimeIO.discover()
        if (
          !discovery.marker &&
          (typeof options.spawn === 'object' ||
            typeof options.connect === 'object' ||
            typeof options.listen === 'object')
        )
          return createProcessSourcePeer(options, discovery.runtime)
        return createAutomaticProcessPeer(options as IRuntimePeerOptions, {
          marker: discovery.marker,
          runtime: discovery.runtime,
          open: () => module.processRuntimeIO.open()
        })
      })
    }
  )
}
