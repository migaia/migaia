import { expectTypeOf } from 'vitest'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import type { IRuntimePeerOptions, IRuntimeTypedPeer, IRuntimePeer } from '@migaia/rpc-core/remote'

/** Bridge callers retain their nested remote surface without casting the public factory result. */
type IApi = { math: { add(pair: [number, number]): number } }
/** Compile the public generic call without acquiring a native resource. */
declare const options: IRuntimePeerOptions
/** The generic result preserves method, payload, and return correlations. */
const peer = createRuntimePeer<IApi>(options)
expectTypeOf(peer).toEqualTypeOf<Promise<IRuntimeTypedPeer<IApi>>>()
/** Omitting a remote surface preserves the existing dynamic factory contract. */
const dynamicPeer = createRuntimePeer(options)
expectTypeOf(dynamicPeer).toEqualTypeOf<Promise<IRuntimePeer>>()
peer.then((value) => {
  expectTypeOf(value.request('math.add', [20, 22])).toEqualTypeOf<Promise<number>>()
  // @ts-expect-error Unknown remote methods remain invalid after adding the generic.
  value.request('math.missing', [20, 22])
  // @ts-expect-error Payloads retain the exact declared pair type.
  value.request('math.add', 'wrong')
})
