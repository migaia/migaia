import { defineByteAdapter, defineMessageAdapter } from '../../dist/adapter.js'
import type { IAdapterDefinitionPeerOptions } from '../../dist/adapter.js'

/** Compile only; the normal options are never used to acquire a native resource. */
declare const options: IAdapterDefinitionPeerOptions<unknown>
/** Generic byte adapters use process-style call options because their carrier cannot transfer. */
const bytes = defineByteAdapter({
  open() {
    throw new Error('compile only')
  }
})
bytes.peer<{ echo(value: number): number }>(options).then((peer) => {
  peer.request('echo', 7)
  // @ts-expect-error Byte carriers reject transfer presence at their public typed boundary.
  peer.request('echo', 7, { transfer: [] })
})
/** Message adapters keep the thread-style transfer surface on their supported physical carrier. */
const messages = defineMessageAdapter({
  open() {
    throw new Error('compile only')
  }
})
messages.peer<{ echo(value: number): number }>(options).then((peer) => {
  peer.request('echo', 7, { transfer: [] })
})
