/** Original resource cleanup behavior is observed through genuine native RPC installations. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { walkErrorCauses } from '@migaia/utils/error'
import { expect, it } from 'vitest'

it('releases actual native resources in reverse order and collects exactly one failure', async () => {
  /** Real installation disposers own this observable acquisition/release order. */
  const order: string[] = []
  /** The second acquired resource fails without replacing its original error identity. */
  const original = new Error('b')
  /** Each native definition transfers its actual installed resource into the receiving host. */
  const a = defineTransportPlugin({
    name: 'resource-a',
    namespace: 'a',
    open: () => ({
      dispose: () => {
        order.push('a')
      }
    })
  })
  /** Failure cannot prevent release of the earlier acquired resource. */
  const b = defineTransportPlugin({
    name: 'resource-b',
    namespace: 'b',
    open: () => ({
      dispose: () => {
        order.push('b')
        throw original
      }
    })
  })
  /** The public host owns the native transaction and its complete cleanup result. */
  const host = await createRpcHost({ plugins: [a, b], report: () => undefined })
  /** Public close retains the native owner's selected aggregate and original failure chain. */
  const failure: unknown = await host.close().catch((error: unknown) => error)
  expect(order).toEqual(['b', 'a'])
  expect(failure).toBeInstanceOf(Error)
  /** Global close collects the native host's cleanup failures in its existing cause aggregate. */
  const aggregate = (failure as Error).cause
  expect(aggregate).toBeInstanceOf(AggregateError)
  /** This is the real collected result, without a replacement ResourceScope or test-side filter. */
  const errors = (aggregate as AggregateError).errors
  expect(errors).toHaveLength(1)
  expect(walkErrorCauses(errors[0])).toContain(original)
})

it('shares the public close Promise and releases an asynchronous resource exactly once', async () => {
  /** Count only the actual resource disposer, independently from the number of public callers. */
  let released = 0
  /** The native installation owns its original asynchronous cleanup callback. */
  const resource = defineTransportPlugin({
    name: 'shared-resource',
    namespace: 'resource',
    open: () => ({
      dispose: async () => {
        await Promise.resolve()
        released += 1
      }
    })
  })
  /** No per-session RPC facade or substitute lifecycle scope is introduced. */
  const host = await createRpcHost({ plugins: [resource], report: () => undefined })
  /** Concurrent public callers borrow the original completion before cleanup settles. */
  const first = host.close()
  /** The second close joins rather than restarting resource release. */
  const second = host.close()
  expect(first).toBe(second)
  await Promise.all([first, second])
  expect(released).toBe(1)
})

it('releases actual transport resources before application flow disposers', async () => {
  /** Only real native installation disposers append to this public cleanup observation. */
  const order: string[] = []
  /** The former middleware resource is now the actual flow installation's disposer. */
  const middleware = defineFlowPlugin({
    name: 'resource-middleware',
    setup: () => ({
      hooks: {},
      dispose: () => {
        order.push('middleware')
      }
    })
  })
  /** Native transport acquisition remains separate from application flow cleanup. */
  const transport = defineTransportPlugin({
    name: 'resource-transport',
    namespace: 'resource',
    open: () => ({
      dispose: () => {
        order.push('transport')
      }
    })
  })
  /** Cold installation publishes both real owners before public shutdown begins. */
  const host = await createRpcHost({ plugins: [middleware, transport], report: () => undefined })
  await host.close()
  expect(order).toEqual(['transport', 'middleware'])
})
