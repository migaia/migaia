import type {
  IAdapterProcessRuntimeLoader,
  IAdapterProcessRuntimeModule
} from '@migaia/rpc-core/adapter/process'

/** This runtime resource retains the original native module selection and bare import Promise. */
export class NativeProcessRuntimeLoader implements IAdapterProcessRuntimeLoader {
  /** Platform discovery performs no channel opening before Core has admitted the peer options. */
  load(): Promise<IAdapterProcessRuntimeModule> | undefined {
    if (Reflect.get(globalThis, 'Deno')) return import('./adapters/deno-peer.js')
    if (typeof process !== 'undefined' && process.versions?.node !== undefined)
      return import('./adapters/node-peer.js')
    return undefined
  }
}
