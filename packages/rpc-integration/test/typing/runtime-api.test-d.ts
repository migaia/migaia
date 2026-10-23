import { createProcessPlugin } from '../../../rpc-plugin-process/test/protocol.ts'
import type { IRuntimeExpose } from '@migaia/rpc-host/plugin'
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { createThreadPeer } from '../../../rpc-plugin-thread/test/protocol.ts'
import { threadProtocolDefinition as createThreadPlugin } from '../runtime-api/fixtures/thread-protocol.js'
import {
  type IRuntimeSurface,
  type IRuntimeDynamicSurface,
  type IRuntimeTypedPeer
} from '@migaia/rpc-host/plugin'

/** Real Feature output signatures supply the local, type-only exposure inventory. */
const math = definePlugin({
  name: 'math',
  features: {
    operations: defineFeature(() => ({
      version: 1,
      add: (payload: { x: number }) => payload.x + 1,
      sub: (payload: { x: number }) => payload.x - 1
    }))
  },
  install: () => ({})
})
/** The existing installed tuple identifies the registry without emitting a type catalog. */
const hostC = defineHost<Record<string, never>, never, readonly [typeof math]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** Own provide stays independent from the remote surface type argument. */
const provideC = { application: { echo: (payload: string) => payload } }
/** Explicit generic arguments retain exact name/expose metadata when Remote is also supplied. */
const pluginC = createThreadPlugin<
  Record<never, never>,
  typeof provideC,
  'b',
  readonly ['math.add'],
  typeof hostC
>({ name: 'b', expose: ['math.add'], provide: provideC, report: () => undefined })
/** The pure surface contains the exact provide and selected Feature methods. */
type ICSurface = IRuntimeSurface<typeof hostC, typeof pluginC>
/** B declares C's surface through a type import, without a production runtime table. */
const c = createThreadPlugin<ICSurface, Record<never, never>, 'c'>({
  name: 'c',
  report: () => undefined
})
/** B's installed tuple uses the real connection definition's type metadata. */
const hostB = defineHost<Record<string, never>, never, readonly [typeof c]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** A receives precisely the explicitly selected remote method prefixed by its connection name. */
const a = createThreadPlugin<
  Record<never, never>,
  Record<never, never>,
  'a',
  readonly ['c.math.add'],
  typeof hostB
>({ name: 'a', expose: ['c.math.add'], report: () => undefined })
/** Recursive composition preserves the original application payload and scalar result. */
type IBSurface = IRuntimeSurface<typeof hostB, typeof a>
/** Targeting B selects B's own composed surface, rather than a global method union. */
const b = createThreadPlugin<IBSurface, Record<never, never>, 'b'>({
  name: 'b',
  report: () => undefined
})
/** Only this registered connection contributes A's thread target. */
const hostA = defineHost<Record<string, never>, never, readonly [typeof b]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** A typed scalar invocation retains its numeric result. */
const result: Promise<number> = hostA.thread!.request('b', 'c.math.add', { x: 1 })
/** Typed instance selection retains the same target/method association. */
const instance: Promise<number> = hostA.thread!.request(
  { name: 'b', instanceId: 'b-1' },
  'c.math.add',
  { x: 2 }
)
// @ts-expect-error typo in local plugin name is outside the actual Host inventory.
const badPlugin: IRuntimeExpose<readonly [typeof math]> = 'maht'
// @ts-expect-error typo in local method does not become a runtime whitelist.
const badMethod: IRuntimeExpose<readonly [typeof math]> = 'math.ad'
// @ts-expect-error connection prefix must identify a declared connection.
const badConnection: IRuntimeExpose<readonly [typeof c]> = 'cc.math.add'
// @ts-expect-error remote method must belong to C's declared surface.
const badRemote: IRuntimeExpose<readonly [typeof c]> = 'c.math.sub'
// @ts-expect-error unregistered target cannot borrow a registered method surface.
hostA.thread!.request('other', 'c.math.add', { x: 1 })
// @ts-expect-error method whitelist is specific to B.
hostA.thread!.request('b', 'c.math.sub', { x: 1 })
// @ts-expect-error instance target keeps the registered connection name.
hostA.thread!.request({ name: 'other', instanceId: 'b-1' }, 'c.math.add', { x: 1 })
// @ts-expect-error the original application argument remains required.
hostA.thread!.request('b', 'c.math.add')
// @ts-expect-error payload shape does not widen to unknown.
hostA.thread!.request('b', 'c.math.add', { x: '1' })
// @ts-expect-error scalar result remains number.
const wrongResult: Promise<string> = hostA.thread!.request('b', 'c.math.add', { x: 1 })
// @ts-expect-error notify uses the same payload contract.
hostA.thread!.notify('b', 'c.math.add', { y: 1 })
// @ts-expect-error scalar methods cannot be called as streams.
hostA.thread!.stream('b', 'c.math.add', { x: 1 })
/** Omitting a remote surface intentionally offers no callable methods. */
const unknownPeer = createThreadPeer({ report: () => undefined })
// @ts-expect-error no remote surface means method never.
unknownPeer.then((peer) => peer.request('math.add', { x: 1 }))
/** The explicit escape remains subject to the real runtime whitelist. */
const dynamic = createThreadPlugin<IRuntimeDynamicSurface, Record<never, never>, 'dynamic'>({
  name: 'dynamic',
  report: () => undefined
})
// @ts-expect-error dynamic declarations cannot authorize forward exposure.
const dynamicExpose: IRuntimeExpose<readonly [typeof dynamic]> = 'dynamic.anything'
/** Direct Peer calls use the identical composed remote surface. */
declare const peer: IRuntimeTypedPeer<IBSurface>
/** Recursive method result is preserved outside the Host facade too. */
const peerResult: Promise<number> = peer.request('c.math.add', { x: 1 })
// @ts-expect-error provide and exposed methods compose, rather than erasing either.
const missing: keyof ICSurface = 'math.sub'
/** Own provide's result remains string. */
const echo: Promise<string> = (null as unknown as IRuntimeTypedPeer<ICSurface>).request(
  'application.echo',
  'value'
)
void result
void instance
void badPlugin
void badMethod
void badConnection
void badRemote
void wrongResult
void dynamicExpose
void peerResult
void missing
void echo

/** An unregistered Host does not acquire an accidental dynamic outlet through keyof never. */
const emptyHost = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
// @ts-expect-error there is no registered connection target.
emptyHost.thread!.request('b', 'any')
/** An explicit dynamic surface does not broaden the target name. */
const dynamicHost = defineHost<Record<string, never>, never, readonly [typeof dynamic]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
// @ts-expect-error only the declared dynamic connection may be selected.
dynamicHost.thread!.request('another', 'any')

/** Even a factory without a Host type is checked at the canonical install entry point. */
const misspelled = createThreadPlugin({ name: 'bad', expose: ['math.ad'], report: () => undefined })
// @ts-expect-error installing cannot authorize a misspelled expose path.
hostC.use(misspelled)
/** Current Host inventory admits the exact method without a separate runtime table. */
hostC.use(createThreadPlugin({ name: 'good', expose: ['math.add'], report: () => undefined }))

/** Two targets with disjoint surfaces cannot use one another's methods. */
const d = createThreadPlugin<{ hello: (payload: string) => string }, Record<never, never>, 'd'>({
  name: 'd',
  report: () => undefined
})
/** The same existing tuple may hold multiple independently declared remote surfaces. */
const multiHost = defineHost<Record<string, never>, never, readonly [typeof b, typeof d]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
// @ts-expect-error a second registered target does not authorize hello on B.
multiHost.thread!.request('b', 'hello', 'value')
// @ts-expect-error the second target does not authorize B's forwarded path.
multiHost.thread!.request('d', 'c.math.add', { x: 1 })

// @ts-expect-error a non-callable Feature member never becomes an exposed method.
const nonCallable: IRuntimeExpose<readonly [typeof math]> = 'math.version'
void nonCallable

/** Object and text overloads remain independent of the remote callable surface. */
const overview: Promise<import('@migaia/rpc-host/plugin').IRuntimeOverview> = hostA.thread!.list()
/** A selected format returns text, rather than an erased union or application description. */
const overviewText: Promise<string> = hostA.thread!.list({ format: 'toml' })
/** Local Peer identity and remote connection details are typed without widening methods. */
const detail: Promise<import('@migaia/rpc-host/plugin').IRuntimeDetail> = peer.describe()
/** All three supported formats use the same cold query surface. */
const detailText: Promise<string> = peer.describe({ format: 'yaml' })
// @ts-expect-error an unknown format cannot silently select a supported emitter.
peer.describe({ format: 'xml' })
void overview
void overviewText
void detail
void detailText

/** Process and thread factories retain platform-specific ownership options purely in types. */
const binaryProvide = { echo: (payload: ArrayBuffer) => payload }
/** These declarations exercise public factories; no runtime fixture or extra provider is emitted. */
const processBinary = import('../../../rpc-plugin-process/test/protocol.ts').then(
  ({ createProcessPeer }) => createProcessPeer<typeof binaryProvide>({ report: () => undefined })
)
processBinary.then((peer) => {
  // @ts-expect-error process rejects an own transfer field, including an empty list.
  peer.request('echo', new ArrayBuffer(1), { transfer: [] })
  // @ts-expect-error undefined does not erase own process transfer presence.
  peer.notify('echo', new ArrayBuffer(1), { transfer: undefined })
  // @ts-expect-error group process calls enforce the same carrier ownership rule.
  peer.group([{ method: 'echo', payload: new ArrayBuffer(1) }], { transfer: [] })
})
/** Thread accepts only original ArrayBuffer backings, rather than views or shared memory. */
const threadBinary = createThreadPeer<typeof binaryProvide>({ report: () => undefined })
threadBinary.then((peer) => {
  const backing = new ArrayBuffer(1)
  const result: Promise<ArrayBuffer> = peer.request('echo', backing, { transfer: [backing] })
  // @ts-expect-error the ownership list requires a backing, not a Uint8Array view.
  peer.request('echo', backing, { transfer: [new Uint8Array(backing)] })
  // @ts-expect-error group uses the same precise original backing list.
  peer.group([{ method: 'echo', payload: backing }], { transfer: [new Uint8Array(backing)] })
  void result
})

/** A process Plugin's typed Host outlet uses the same explicit process ownership boundary. */
const processPlugin = createProcessPlugin<
  typeof binaryProvide,
  Record<never, never>,
  'binary-process'
>({
  name: 'binary-process',
  report: () => undefined
})
const processHost = defineHost<Record<string, never>, never, readonly [typeof processPlugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
// @ts-expect-error a process Plugin does not authorize transfer through its Host facade.
processHost.process!.request('binary-process', 'echo', new ArrayBuffer(1), { transfer: [] })
/** Accepted thread group calls carry precise backing lists without widening payload or result. */
threadBinary.then((peer) => {
  const backing = new ArrayBuffer(1)
  peer.group([{ method: 'echo', payload: backing }], { transfer: [backing] })
})

/** Pair inference is crossed without supplying a remote generic or any runtime type table. */
const typedPair = import('../../../rpc-host/dist/testing/index.js').then(({ createPeerPair }) =>
  createPeerPair({
    a: { provide: { left: (value: string) => value.length } },
    b: { provide: { right: (value: number) => String(value) } }
  })
)
typedPair.then(({ a, b }) => {
  const right: Promise<string> = a.request('right', 1)
  const left: Promise<number> = b.request('left', 'value')
  // @ts-expect-error A calls B's provide, never its own.
  a.request('left', 'value')
  // @ts-expect-error crossed inference retains B's payload.
  a.request('right', 'value')
  void right
  void left
})

/** Throwing scalars and empty generators preserve their actual callable mode. */
declare const modeBoundary: IRuntimeTypedPeer<{
  fail: () => never
  empty: () => AsyncGenerator<never>
}>
const failedScalar: Promise<never> = modeBoundary.request('fail')
const emptyStream: AsyncIterableIterator<never> = modeBoundary.stream('empty')
// @ts-expect-error an empty generator cannot become a scalar method because its yield is never.
modeBoundary.request('empty')
// @ts-expect-error never-returning scalar functions do not manufacture a stream.
modeBoundary.stream('fail')
void failedScalar
void emptyStream
