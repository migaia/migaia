import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  definePartPlugin,
  defineResource,
  PartHostErrorCode,
  type IPartHost
} from '../src/index.ts'
import { ControlledLoad, settle } from './resource-support.ts'

/** Host with one `orders@1` resource driven by the given load. */
async function hostWith(load: ControlledLoad, errors: unknown[] = []): Promise<IPartHost> {
  /** Orders resource. */
  const orders = defineResource({
    id: 'orders@1',
    params: z.object({ status: z.string() }),
    load: load.load
  })
  return await createPartHost({
    plugins: [definePartPlugin({ name: 'data', resources: [orders] })],
    onError: (error) => errors.push(error)
  })
}

describe('resource state machine', () => {
  it('shares one load per entry and moves through loading, ready, empty and error', async () => {
    /** Load control. */
    const load = new ControlledLoad()
    /** Reported errors. */
    const errors: unknown[] = []
    const host = await hostWith(load, errors)
    const binding = { $resource: 'orders@1', params: { status: 'open' } }
    const first = host.resources.watch(binding)
    const second = host.resources.watch(binding)
    await settle(host)
    expect(first.read().status).toBe('loading')
    expect(load.calls).toHaveLength(1)
    load.last().result.resolve([{ id: 1 }])
    await settle(host)
    expect(first.read()).toMatchObject({ status: 'ready', data: [{ id: 1 }], refreshing: false })
    expect(second.read().data).toBe(first.read().data)
    for (let read = 0; read < 5; read += 1) first.read()
    expect(load.calls).toHaveLength(1)

    host.resources.refresh('orders@1', { status: 'open' })
    await settle(host)
    load.last().result.resolve([])
    await settle(host)
    expect(first.read().status).toBe('empty')

    /** Failure with a code. */
    const failure = Object.assign(new Error('boom'), { code: 'X' })
    host.resources.refresh('orders@1', { status: 'open' })
    await settle(host)
    load.last().result.reject(failure)
    await settle(host)
    expect(first.read()).toMatchObject({ status: 'error', data: [], error: { code: 'X' } })
    expect(host.resources.errorOf('orders@1', { status: 'open' })).toBe(failure)
    expect(errors.filter((error) => error === failure)).toHaveLength(1)

    const invalid = host.resources.watch({ $resource: 'orders@1', params: { status: 3 } })
    await settle(host)
    expect(invalid.read()).toMatchObject({ status: 'error', error: { code: 'ARGS_INVALID' } })
    expect(load.calls).toHaveLength(3)
    first.release()
    second.release()
    invalid.release()
    await host.dispose()
  })

  it('aborts superseded loads, keeps previous data on a key change and frees entries', async () => {
    const load = new ControlledLoad()
    const host = await hostWith(load)
    host.state.write('page.status', 'open')
    const watch = host.resources.watch({
      $resource: 'orders@1',
      params: { status: { $state: 'page.status' } }
    })
    await settle(host)
    load.last().result.resolve(['a'])
    await settle(host)

    host.resources.refresh('orders@1', { status: 'open' })
    await settle(host)
    const firstRefresh = load.last()
    host.resources.refresh('orders@1', { status: 'open' })
    await settle(host)
    const secondRefresh = load.last()
    expect(firstRefresh.signal.aborted).toBe(true)
    expect(watch.read()).toMatchObject({ status: 'ready', refreshing: true })
    secondRefresh.result.resolve(['c'])
    firstRefresh.result.resolve(['late'])
    await settle(host)
    expect(watch.read()).toMatchObject({ status: 'ready', data: ['c'], refreshing: false })

    host.state.write('page.status', 'closed')
    await settle(host)
    const closed = load.last()
    expect(closed.params).toEqual({ status: 'closed' })
    expect(watch.read()).toMatchObject({ status: 'ready', data: ['c'], refreshing: true })
    closed.result.resolve(['d'])
    await settle(host)
    expect(watch.read()).toMatchObject({ status: 'ready', data: ['d'], refreshing: false })

    host.state.write('page.status', 'pending')
    await settle(host)
    const pending = load.last()
    host.state.write('page.status', 'other')
    await settle(host)
    expect(pending.signal.aborted).toBe(true)

    watch.release()
    watch.release()
    const again = host.resources.watch({ $resource: 'orders@1', params: { status: 'open' } })
    await settle(host)
    expect(again.read().status).toBe('loading')
    again.release()
    await host.dispose()
    expect(() => host.resources.watch({ $resource: 'orders@1' })).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.hostDisposed })
    )
  })
})
