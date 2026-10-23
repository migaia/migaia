import { detectServerRuntime } from '@migaia/utils'
import type { IProcessByteChannel } from './types.js'

/** Native discovery opens the actual runtime I/O, never returns a constructed/trusted Peer DTO. */
export type IAdapterProcessRuntimeIO = Readonly<{
  /** Read native child discovery without opening streams or granting authentication. */
  discover(): Readonly<{ marker: string | undefined; runtime: string }>
  /** Acquire the actual child I/O and optional already-read bootstrap for Core's one handoff. */
  open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
}>
/** Loaded native resources retain their original I/O operations. */
export type IAdapterProcessRuntimeModule = Readonly<{ processRuntimeIO: IAdapterProcessRuntimeIO }>
/** The runtime owner retains its real native import Promise. */
export type IAdapterProcessRuntimeLoader = Readonly<{
  /** Return the original optional runtime import Promise; undefined selects Core's source path. */
  load(): Promise<IAdapterProcessRuntimeModule> | undefined
}>

/** This runtime resource retains the original native module selection and bare import Promise. */
export class NativeProcessRuntimeLoader implements IAdapterProcessRuntimeLoader {
  /** Platform discovery performs no channel opening before Core has admitted the peer options. */
  load(): Promise<IAdapterProcessRuntimeModule> | undefined {
    const runtime = detectServerRuntime()
    if (runtime === 'deno') return import('./adapters/deno-peer.js')
    if (runtime === 'node' || runtime === 'bun') return import('./adapters/node-peer.js')
    return undefined
  }
}
