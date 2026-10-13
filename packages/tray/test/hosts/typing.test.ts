import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineFeature, definePlugin, type IFeatureReference } from '@migaia/plugin-host'
import { defineTrayHost } from '../../src/hosts/define-host.js'
import { defineRoutingPolicy } from '../../src/hosts/routing-policy.js'
import type { ITray, ITrayClient, ITrayClientPlugin, ITrayRemote } from '../../src/hosts/typing.js'

/** Custom tuple entry proves policy names survive host inference. */
const aaa = defineRoutingPolicy('aaa', (candidates) => candidates[0]!.id)
/** Business Feature provides each supported first-parameter shape and stream result. */
const serviceFeature = defineFeature(() => ({
  hello: () => 'hello',
  echo: (value: string) => value,
  optional: (value?: string) => value ?? 'empty',
  count: async function* (limit: number) {
    for (let i = 0; i < limit; i++) yield i
  }
}))
/** Capturing Feature metadata before plugin contextualization preserves precise method inference. */
const service = definePlugin({
  name: 'node',
  features: { svc: serviceFeature },
  install: () => ({})
})
/** Runtime-free host declaration retains plugin and policy literals. */
const host = defineTrayHost({
  name: 'typed',
  routing: [aaa],
  config: (input) => input as { language: string },
  plugins: (info, trayPlugin) => {
    /** Native references must expose exact tray methods to dependent Feature factories. */
    const reference: IFeatureReference<ITrayClient, false, 'trayClient'> =
      trayPlugin.getFeature('tray')
    /** Validator result remains visible at the DSL callback. */
    const language: string = info.config.language
    void reference
    void language
    return [service]
  },
  exposes: ['node.svc']
})

/** Compile-time cases are never invoked: the package typecheck consumes every negative assertion. */
async function checkCalls(
  remote: ITrayRemote<typeof host>,
  tray: ITray<readonly [typeof host]>,
  trayPlugin: ITrayClientPlugin<readonly [typeof aaa]>
) {
  expectTypeOf(remote.request('node.svc.hello')).toEqualTypeOf<Promise<'hello'>>()
  expectTypeOf(remote.stream('node.svc.count', 3)).toEqualTypeOf<AsyncIterableIterator<number>>()
  /** Policy tuple retains its exact name rather than broadening to string. */
  const policyName: 'aaa' = host.routing![0].name
  /** Ordinary strings remain ordinary request results, despite being synchronously iterable. */
  const hello: string = await remote.request('node.svc.hello')
  /** Empty methods keep options in the explicit third slot. */
  const helloTimed: string = await remote.request('node.svc.hello', undefined, { timeoutMs: 10 })
  /** Optional payload retains its own shape, with or without a supplied argument. */
  const optional: string = await remote.request('node.svc.optional')
  await remote.request('node.svc.optional', 'value')
  await remote.request('node.svc.optional', undefined, { timeoutMs: 10 })
  await remote.notify('node.svc.echo', 'value')
  for await (const item of remote.stream('node.svc.count', 3)) {
    /** Stream methods expose the element rather than the iterator. */
    const number: number = item
    void number
  }
  await tray.spawn('typed', { id: 'typed-1', config: { language: 'en' } })
  // @ts-expect-error A1: required validator output requires config at spawn.
  await tray.spawn('typed', { id: 'typed-1' })
  // @ts-expect-error A1: empty methods cannot interpret second-slot objects as options.
  await remote.request('node.svc.hello', { timeoutMs: 10 })
  // @ts-expect-error A1: empty methods reject non-undefined payloads.
  await remote.request('node.svc.hello', 'bad')
  // @ts-expect-error A1: optional payload keeps its string domain.
  await remote.request('node.svc.optional', 1)
  // @ts-expect-error A1: required payload remains required.
  await remote.request('node.svc.echo')
  // @ts-expect-error A1: call options accept no unowned retry mechanism.
  await remote.request('node.svc.echo', 'value', { retries: 1 })
  // @ts-expect-error A1: only the precise tray Feature exists on the per-init plugin.
  trayPlugin.getFeature('other')
  void policyName
  void hello
  void helloTimed
  void optional
}

/** Runtime constraints are checked by TypeScript without executing invalid definitions. */
function checkDefinitions() {
  // @ts-expect-error A1: coroutine has no entry.
  defineTrayHost({ name: 'co', entry: 'co.mjs', plugins: () => [service], exposes: ['node.svc'] })
  // @ts-expect-error A1: thread must supply an entry.
  defineTrayHost({ name: 'th', runtime: 'thread', plugins: () => [service], exposes: ['node.svc'] })
  // @ts-expect-error A1: process has no heap limit.
  defineTrayHost({
    name: 'pr',
    runtime: 'process',
    entry: 'pr.mjs',
    limits: { heapBytes: 1 },
    plugins: () => [service],
    exposes: ['node.svc']
  })
  // @ts-expect-error A1: thread cannot carry a process sandbox.
  defineTrayHost({
    name: 'th',
    runtime: 'thread',
    entry: 'th.mjs',
    sandbox: { name: 'env', wrap: (command: never) => command },
    plugins: () => [service],
    exposes: ['node.svc']
  })
  // @ts-expect-error A1: exposure must name a native PluginHost Feature.
  defineTrayHost({ name: 'bad', plugins: () => [service], exposes: ['node.missing'] })
}
void checkCalls
void checkDefinitions

describe('instances A1 typing', () => {
  it('retains the routing tuple and literal exposure at runtime', () => {
    expect(host.routing).toEqual([aaa])
    expect(host.exposes).toEqual(['node.svc'])
  })
})
