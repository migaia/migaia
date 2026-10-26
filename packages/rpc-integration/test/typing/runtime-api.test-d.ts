/** Public native namespaces preserve remote method, payload and result correlations. */
import { expectTypeOf } from 'vitest'
import type { IRpcHost, IRpcNamespace, IRpcFanoutResult } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** This cold native definition contributes only its actual namespace and closing capability. */
const transport = threadPlugin({ namespace: 'thread', connectToParent: true })
/** Local business signatures remain the source of the explicitly declared remote surface. */
const math = {
  version: 1,
  add: (payload: { x: number }) => payload.x + 1,
  sub: (payload: { x: number }) => payload.x - 1
}
/** C advertises its own provide tree and one selected callable business method. */
type ICSurface = {
  application: { echo(payload: string): string }
  math: Pick<typeof math, 'add' | 'version'>
}
/** B's forwarded path retains C's original argument and scalar result. */
type IBSurface = { c: { math: Pick<typeof math, 'add'> } }
/** Each declared physical target retains an independent remote callable inventory. */
type ITargets = { b: IBSurface; d: { hello(payload: string): string } }
/** Type-only Host values never acquire a native parent or publish a provider. */
declare const hostA: IRpcHost<ITargets, readonly [typeof transport]>
expectTypeOf(hostA.thread.send('b', 'c.math.add', { x: 1 })).toEqualTypeOf<Promise<number>>()
expectTypeOf(hostA.thread.request('b.c.math.add', { x: 2 })).toEqualTypeOf<
  Promise<number | IRpcFanoutResult<number>>
>()
// @ts-expect-error An unregistered target cannot borrow a registered method surface.
hostA.thread.send('other', 'c.math.add', { x: 1 })
// @ts-expect-error The selected target publishes add, rather than every local math member.
hostA.thread.send('b', 'c.math.sub', { x: 1 })
// @ts-expect-error The original application argument remains required.
hostA.thread.send('b', 'c.math.add')
// @ts-expect-error The payload does not widen to unknown.
hostA.thread.send('b', 'c.math.add', { x: '1' })
// @ts-expect-error Scalar results retain the original numeric result.
const wrongResult: Promise<string> = hostA.thread.send('b', 'c.math.add', { x: 1 })
// @ts-expect-error Notification dispatch uses the same payload contract.
hostA.thread.dispatch('b', 'c.math.add', { y: 1 })
// @ts-expect-error Scalar methods cannot be selected as streams.
hostA.thread.streamTo('b', 'c.math.add', { x: 1 })
// @ts-expect-error A second target does not authorize its method on B.
hostA.thread.send('b', 'hello', 'value')
// @ts-expect-error D cannot invoke B's forwarded path.
hostA.thread.send('d', 'c.math.add', { x: 1 })
// @ts-expect-error The forwarded dotted route retains its declared target.
hostA.thread.request('other.c.math.add', { x: 1 })
// @ts-expect-error Forwarding retains the original argument type.
hostA.thread.request('b.c.math.add', { x: 'wrong' })
// @ts-expect-error The removed root-level facade does not bypass namespace ownership.
hostA.request('b', 'c.math.add', { x: 1 })
void wrongResult

/** A single remote capability tree exposes both own provide and selected business methods. */
declare const peer: IRpcNamespace<{ c: ICSurface }, true>
expectTypeOf(peer.send('c', 'application.echo', 'value')).toEqualTypeOf<Promise<string>>()
expectTypeOf(peer.send('c', 'math.add', { x: 1 })).toEqualTypeOf<Promise<number>>()
// @ts-expect-error Unselected math methods are absent from C's declared surface.
peer.send('c', 'math.sub', { x: 1 })
// @ts-expect-error Non-callable members do not become methods.
peer.send('c', 'math.version')
// @ts-expect-error Own provide retains its string argument.
peer.send('c', 'application.echo', 1)

/** An explicitly dynamic namespace still admits only portable payloads. */
declare const dynamic: IRpcHost<Record<never, never>, readonly [typeof transport]>
dynamic.thread.send('any', 'application.echo', { value: 'portable' })
// @ts-expect-error A function does not become a portable dynamic payload.
dynamic.thread.send('any', 'application.echo', () => 1)

/** Original ArrayBuffer backings are the public ownership list for native thread calls. */
declare const binary: IRpcHost<
  { echo(payload: ArrayBuffer): ArrayBuffer },
  readonly [typeof transport]
>
/** This fixture-owned backing is never transferred at runtime by the compile-only case. */
const backing = new ArrayBuffer(1)
expectTypeOf(binary.thread.send('binary', 'echo', backing, { transfer: [backing] })).toEqualTypeOf<
  Promise<ArrayBuffer>
>()
binary.thread.group([{ method: 'echo', payload: backing }], { transfer: [backing] })
// @ts-expect-error Ownership lists accept backings rather than Uint8Array views.
binary.thread.send('binary', 'echo', backing, { transfer: [new Uint8Array(backing)] })
// @ts-expect-error Group calls use the same backing ownership domain.
binary.thread.group([{ method: 'echo', payload: backing }], { transfer: [new Uint8Array(backing)] })

/** Throwing scalars and empty generators retain their actual callable mode. */
declare const modeBoundary: IRpcNamespace<{
  fail(): never
  empty(): AsyncGenerator<never>
}>
expectTypeOf(modeBoundary.send('peer', 'fail')).toEqualTypeOf<Promise<never>>()
expectTypeOf(modeBoundary.streamTo('peer', 'empty')).toEqualTypeOf<AsyncIterableIterator<never>>()
// @ts-expect-error Empty generators remain streaming methods even when their yield is never.
modeBoundary.send('peer', 'empty')
// @ts-expect-error A never-returning scalar does not manufacture a stream.
modeBoundary.streamTo('peer', 'fail')
