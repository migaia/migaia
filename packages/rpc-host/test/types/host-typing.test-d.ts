import { expectTypeOf } from 'vitest'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/runtime'
import type { IRpcFanoutResult, IRpcRuntimeOutcomeResult } from '../../dist/core/typing.js'
import { createRpcHost, type IRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'

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
expectTypeOf(mapped.send('client-a', 'resize', 800)).toEqualTypeOf<Promise<string>>()
mapped.dispatch('client-b', 'save', 'text')
// @ts-expect-error Client B's method cannot be invoked on client A.
mapped.send('client-a', 'save', 'text')
// @ts-expect-error Unknown direct targets are not inferred from another argument.
mapped.send('client-c', 'resize', 800)
// @ts-expect-error Payload type follows the selected target and method.
mapped.send('client-a', 'resize', 'wrong')
// @ts-expect-error Dispatch preserves method correlation too.
mapped.dispatch('client-b', 'resize', 800)
// @ts-expect-error Dispatch preserves payload correlation too.
mapped.dispatch('client-b', 'save', 800)
expectTypeOf(mapped.request('client-a.resize', 800)).toEqualTypeOf<
  Promise<string | IRpcFanoutResult<string>>
>()
// @ts-expect-error Namespaced forwarding retains its exact payload.
mapped.request('client-a.resize', 'wrong')
// @ts-expect-error The namespace must contain a declared provider method.
mapped.request('client-b.resize', 800)
expectTypeOf(mapped.peers['client-a'].resize(800)).toEqualTypeOf<Promise<string>>()

/** Single-remote APIs retain their own nested method namespace. */
declare const single: IRpcHost<IAApi & { math: { add(pair: [number, number]): number } }>
expectTypeOf(single.request('resize', 800)).toEqualTypeOf<
  Promise<string | IRpcFanoutResult<string>>
>()
expectTypeOf(single.request('math.add', [20, 22])).toEqualTypeOf<
  Promise<number | IRpcFanoutResult<number>>
>()
expectTypeOf(single.notify('resize', 800)).toEqualTypeOf<Promise<void | IRpcFanoutResult<void>>>()
expectTypeOf(single.stream('frames', 2)).toEqualTypeOf<
  AsyncIterableIterator<number> | IRpcFanoutResult<AsyncIterableIterator<number>>
>()
expectTypeOf(single.group([{ method: 'resize', payload: 800 }])).toEqualTypeOf<
  Promise<readonly IRpcRuntimeStepOutcome[] | IRpcFanoutResult<readonly IRpcRuntimeStepOutcome[]>>
>()
expectTypeOf(single.outcome('key')).toEqualTypeOf<
  Promise<IRpcRuntimeOutcomeResult | IRpcFanoutResult<IRpcRuntimeOutcomeResult>>
>()
// @ts-expect-error Request does not accept generator routes as scalar results.
single.request('frames', 2)
// @ts-expect-error Notification payload remains checked.
single.notify('resize', 'wrong')
// @ts-expect-error Streaming cannot invoke scalar methods.
single.stream('resize', 800)
// @ts-expect-error Generator payload remains checked.
single.stream('frames', 'wrong')
// @ts-expect-error Group payload is correlated to each scalar route.
single.group([{ method: 'resize', payload: 'wrong' }])
single.notify('resize', 800).then((result) => {
  // @ts-expect-error Physical fanout records require narrowing away the scalar void result.
  void result.fulfilled
  if (result !== undefined)
    expectTypeOf(result.fulfilled).toEqualTypeOf<Partial<Record<string, void>>>()
})

/** Untyped callers may send only the existing portable value domain. */
declare const dynamic: IRpcHost
expectTypeOf(dynamic.request('render', { width: 800 })).toEqualTypeOf<
  Promise<IRpcPortableValue | undefined | IRpcFanoutResult<IRpcPortableValue | undefined>>
>()
expectTypeOf(dynamic.send('peer', 'render', 800)).toEqualTypeOf<
  Promise<IRpcPortableValue | undefined>
>()
dynamic.notify('render', 800)
dynamic.dispatch('peer', 'render', 800)
dynamic.stream('frames', 2)
// @ts-expect-error A Date does not belong to the portable payload domain.
dynamic.request('render', new Date())
// @ts-expect-error Untyped dispatch also checks portable payloads.
dynamic.dispatch('peer', 'render', () => 1)

/** Void configuration is ergonomic while configured factories retain their required payload. */
const noOptionsFeature = defineFeaturePlugin((_options: void) => ({ name: 'optional' }))
noOptionsFeature()
/** Surface inference survives both factory and native definition admission. */
const configuredFeature = defineFeaturePlugin((value: number) => ({
  name: 'configured',
  surface: { value }
}))
expectTypeOf(configuredFeature(1).value).toEqualTypeOf<number>()
// @ts-expect-error A required feature configuration must still be provided.
configuredFeature()
