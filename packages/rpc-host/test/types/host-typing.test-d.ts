/**
 * Compile the public namespace surface, preserving declared method, payload and result
 * correlations.
 */
import { expectTypeOf } from 'vitest'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcStepOutcome, IRpcOutcomeLookupResult } from '@migaia/rpc-contract/protocol'
import type { IRpcFanoutResult } from '@migaia/rpc-host'
import { createRpcHost, type IRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'

/** Client A owns one scalar route and one streaming route. */
type IAApi = { resize(width: number): string; frames(count: number): AsyncIterableIterator<number> }
/** Client B has a disjoint payload and method inventory. */
type IBApi = { save(text: string): boolean }
/** The public factory and addressed calls consume the same declared remote capability map. */
type IRemoteByName = { 'client-a': IAApi; 'client-b': IBApi }
/** The type fixture never opens a resource; this input exists only during compilation. */
declare const options: IRpcHostOptions
/** Public generic inference must survive the factory entry and its generated declaration. */
const typedCreation = createRpcHost<IRemoteByName>(options)
expectTypeOf(typedCreation).toEqualTypeOf<Promise<IRpcHost<IRemoteByName>>>()
/** Omitting capabilities keeps the public factory's portable dynamic surface. */
const dynamicCreation = createRpcHost(options)
expectTypeOf(dynamicCreation).toEqualTypeOf<Promise<IRpcHost>>()
/** Compile-time values do not acquire a transport. */
declare const mapped: IRpcHost<IRemoteByName>
expectTypeOf(mapped.memory.send('client-a', 'resize', 800)).toEqualTypeOf<Promise<string>>()
mapped.memory.dispatch('client-b', 'save', 'text')
// @ts-expect-error Client B's method cannot be invoked on client A.
mapped.memory.send('client-a', 'save', 'text')
// @ts-expect-error Unknown direct targets are not inferred from another argument.
mapped.memory.send('client-c', 'resize', 800)
// @ts-expect-error Payload type follows the selected target and method.
mapped.memory.send('client-a', 'resize', 'wrong')
// @ts-expect-error Dispatch preserves method correlation too.
mapped.memory.dispatch('client-b', 'resize', 800)
// @ts-expect-error Dispatch preserves payload correlation too.
mapped.memory.dispatch('client-b', 'save', 800)
expectTypeOf(mapped.memory.request('client-a.resize', 800)).toEqualTypeOf<
  Promise<string | IRpcFanoutResult<string>>
>()
// @ts-expect-error Namespaced forwarding retains its exact payload.
mapped.memory.request('client-a.resize', 'wrong')
// @ts-expect-error The namespace must contain a declared provider method.
mapped.memory.request('client-b.resize', 800)
expectTypeOf(mapped.memory.peers['client-a'].resize(800)).toEqualTypeOf<Promise<string>>()

/** Single-remote APIs retain their own nested method namespace. */
declare const single: IRpcHost<
  IAApi & { math: { add(pair: [number, number]): number } },
  readonly [IRpcTransportPlugin<'memory'>, ReturnType<typeof idempotency>]
>
expectTypeOf(single.memory.request('resize', 800)).toEqualTypeOf<
  Promise<string | IRpcFanoutResult<string>>
>()
expectTypeOf(single.memory.request('math.add', [20, 22])).toEqualTypeOf<
  Promise<number | IRpcFanoutResult<number>>
>()
// @ts-expect-error Nested method declarations still reject an unknown member after BC1.
single.memory.request('math.missing', [20, 22])
// @ts-expect-error The original declared pair cannot be replaced by an unrelated payload.
single.memory.request('math.add', 'wrong')
expectTypeOf(single.memory.notify('resize', 800)).toEqualTypeOf<
  Promise<void | IRpcFanoutResult<void>>
>()
expectTypeOf(single.memory.stream('frames', 2)).toEqualTypeOf<
  AsyncIterableIterator<number> | IRpcFanoutResult<AsyncIterableIterator<number>>
>()
expectTypeOf(single.memory.group([{ method: 'resize', payload: 800 }])).toEqualTypeOf<
  Promise<readonly IRpcStepOutcome[] | IRpcFanoutResult<readonly IRpcStepOutcome[]>>
>()
expectTypeOf(single.memory.outcome('key')).toEqualTypeOf<
  Promise<IRpcOutcomeLookupResult | IRpcFanoutResult<IRpcOutcomeLookupResult>>
>()
// @ts-expect-error Request does not accept generator routes as scalar results.
single.memory.request('frames', 2)
// @ts-expect-error Notification payload remains checked.
single.memory.notify('resize', 'wrong')
// @ts-expect-error Streaming cannot invoke scalar methods.
single.memory.stream('resize', 800)
// @ts-expect-error Generator payload remains checked.
single.memory.stream('frames', 'wrong')
// @ts-expect-error Group payload is correlated to each scalar route.
single.memory.group([{ method: 'resize', payload: 'wrong' }])
single.memory.notify('resize', 800).then((result) => {
  // @ts-expect-error Physical fanout records require narrowing away the scalar void result.
  void result.fulfilled
  if (result !== undefined)
    expectTypeOf(result.fulfilled).toEqualTypeOf<Partial<Record<string, void>>>()
})

/** Untyped callers may send only the existing portable value domain. */
declare const dynamic: IRpcHost
expectTypeOf(dynamic.memory.request('render', { width: 800 })).toEqualTypeOf<
  Promise<IRpcPortableValue | undefined | IRpcFanoutResult<IRpcPortableValue | undefined>>
>()
expectTypeOf(dynamic.memory.send('peer', 'render', 800)).toEqualTypeOf<
  Promise<IRpcPortableValue | undefined>
>()
dynamic.memory.notify('render', 800)
dynamic.memory.dispatch('peer', 'render', 800)
dynamic.memory.stream('frames', 2)
// @ts-expect-error A Date does not belong to the portable payload domain.
dynamic.memory.request('render', new Date())
// @ts-expect-error Untyped dispatch also checks portable payloads.
dynamic.memory.dispatch('peer', 'render', () => 1)

/** BC3 removes arbitrary feature-surface factories; only installed complete plugins add methods. */
// @ts-expect-error RPC calls require an installed namespace even when a remote API is declared.
single.request('resize', 800)
// @ts-expect-error The complete feature is required; numeric timeout configuration is not callable policy.
single.memory.request('resize', 800, { timeout: 20 })
// @ts-expect-error Only installed transports introduce namespaces.
single.other.request('resize', 800)
