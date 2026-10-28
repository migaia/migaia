/** Closing a mounted watch releases cancellation without waiting for another consumer pull. */
import { expect, it, vi } from 'vitest'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import type { IRpcContext } from '@migaia/rpc-host'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'
import { subscribeProbeStages } from '@migaia/rpc-host/plugins/probe'
import { RpcDevtoolsErrorCode } from '@migaia/rpc-contract/error-code'
import { connectedCoreHosts } from '../../../rpc-host/test/host/core-fixture.ts'
import type { IRpcDevtoolsServiceApi } from '../../src/contract/service.ts'
import { collectorView } from './fixture.ts'

/** Observe the original first pull after registration, retaining the same native generator. */
function observedWatch(
  original: IRpcDevtoolsServiceApi['watch'],
  input: Parameters<IRpcDevtoolsServiceApi['watch']>[0],
  context: IRpcContext,
  entered: IDeferred<IRpcContext>
) {
  /** Provider execution keeps the exact service iterator and its original next method. */
  const iterator = Reflect.apply(original, undefined, [input, context]) as ReturnType<
    typeof original
  >
  /** One explicit call context lends only native pull and observation identities to the callback. */
  const invocation = { iterator, next: iterator.next, context, entered }
  iterator.next = (value?: unknown) => {
    /** Native first next registers the watcher synchronously before returning its waiting Promise. */
    const pending = Reflect.apply(invocation.next, invocation.iterator, [value])
    invocation.entered.resolve(invocation.context)
    return pending
  }
  return iterator
}

it('releases the actual service signal when collector close interrupts a paused watch', async () => {
  /** The caller owns the collector while its service uses the real RPC provider cancellation. */
  const collector = devtoolsPlugin().collector
  /** This original service object is mounted directly, without another request or stream facade. */
  const service = collector.service as IRpcDevtoolsServiceApi
  /** Capture only the provider's genuine context, never a reconstructed test signal. */
  const entered = deferred<IRpcContext>()
  /** The original function still returns its exact native generator. */
  const originalWatch = service.watch
  service.watch = (input, context?: IRpcContext) =>
    observedWatch(originalWatch, input, context!, entered)
  /** Both real Hosts exchange the original physical frames over the existing memory fixture. */
  const fixture = await connectedCoreHosts({}, { devtools: service })
  /** One accepted provider returns the ordinary public iterator rather than fanout. */
  const watch = fixture.a.memory.stream('devtools.watch') as AsyncIterableIterator<unknown>
  try {
    /** First delivery leaves the provider generator suspended at its real yield. */
    const pending = watch.next()
    /** The registered signal is owned by ProviderDispatcher on the serving Host. */
    const context = await entered.promise
    /** Observe the native removal rather than inferring cleanup from generator completion. */
    const remove = vi.spyOn(context.signal, 'removeEventListener')
    collector.emit(collectorView(1))
    expect((await pending).done).toBe(false)
    collector.close()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(remove).toHaveBeenCalledTimes(1)
    collector.close()
    expect(remove).toHaveBeenCalledTimes(1)
  } finally {
    collector.close()
    await watch.return?.()
    await fixture.a.close()
    await fixture.b.close()
    vi.restoreAllMocks()
  }
})

it('finishes a pending public watch when a stage subscriber throws during close', async () => {
  /** The same public collector owns both the genuine stage handle and pending watch. */
  const collector = devtoolsPlugin().collector
  /** Preserve the original native aggregate, primary cause and member identity through notification. */
  const cause = new RangeError('stage subscriber cause')
  const failure = new AggregateError([cause], 'stage subscriber failure', { cause })
  /** Only the real public subscription throws; no lifecycle or watch operation is replaced. */
  const listener = vi.fn(() => {
    throw failure
  })
  /** The caller retains the original native stage subscription remover. */
  const remove = subscribeProbeStages(collector, listener)
  /** First next activates the real watcher before awaiting its existing notification. */
  const watch = collector.watch()
  /** Observe the original pending rejection before close can wake it. */
  const pending = watch.next().then(
    () => undefined,
    (error: unknown) => error
  )
  try {
    /** Stage notification failure must remain the exact originally supplied native error. */
    let thrown: unknown
    try {
      collector.close()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(failure)
    expect(thrown).toBeInstanceOf(AggregateError)
    expect(failure.cause).toBe(cause)
    expect(failure.errors).toEqual([cause])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await pending).toMatchObject({
      source: 'rpc.devtools',
      code: RpcDevtoolsErrorCode.closed
    })
    expect(() => collector.close()).not.toThrow()
    expect(listener).toHaveBeenCalledTimes(1)
  } finally {
    remove()
    collector.close()
    await watch.return(undefined)
  }
})
