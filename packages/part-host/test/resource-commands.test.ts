import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  definePartPlugin,
  defineResource,
  PartHostErrorCode
} from '../src/index.ts'
import { ControlledLoad, settle } from './resource-support.ts'

describe('resource commands and invalidation', () => {
  it('refreshes only entries whose tags meet the command and validates arguments', async () => {
    /** Load controls per resource. */
    const loads = {
      orders: new ControlledLoad(),
      stats: new ControlledLoad(),
      other: new ControlledLoad(),
      audit: new ControlledLoad()
    }
    /** Calls of the create command. */
    const created: unknown[] = []
    /** Whether the next command run fails. */
    let failNext = false
    const orders = defineResource({
      id: 'orders@1',
      load: loads.orders.load,
      paging: { param: 'page', size: 20 },
      commands: {
        create: {
          args: z.object({ customer: z.string().min(1) }),
          run: async (args) => {
            if (failNext) throw new Error('create failed')
            created.push(args)
            return 'ok'
          }
        }
      }
    })
    const stats = defineResource({ id: 'stats@1', load: loads.stats.load, tags: () => ['orders'] })
    const other = defineResource({ id: 'other@1', load: loads.other.load })
    const audit = defineResource({ id: 'audit@1', load: loads.audit.load })
    const host = await createPartHost({
      plugins: [definePartPlugin({ name: 'data', resources: [orders, stats, other, audit] })]
    })
    const watches = [
      host.resources.watch({ $resource: 'orders@1', params: { page: 0 } }),
      host.resources.watch({ $resource: 'stats@1' }),
      host.resources.watch({ $resource: 'other@1' })
    ]
    await settle(host)
    loads.orders.last().result.resolve({ items: [1], total: 45 })
    loads.stats.last().result.resolve([1])
    loads.other.last().result.resolve([1])
    await settle(host)
    expect(watches[0]?.read().page).toEqual({ index: 0, size: 20, total: 45 })
    const firstLoad = host.resources.watch({ $resource: 'orders@1', params: { page: 1 } })
    await settle(host)
    const pendingFirst = loads.orders.last()

    await expect(host.resources.run('orders@1', 'create', { customer: 'A' })).resolves.toBe('ok')
    await settle(host)
    expect(created).toEqual([{ customer: 'A' }])
    expect(loads.orders.calls).toHaveLength(4)
    expect(pendingFirst.signal.aborted).toBe(true)
    expect(loads.stats.calls).toHaveLength(2)
    expect(loads.other.calls).toHaveLength(1)
    expect(loads.audit.calls).toHaveLength(0)

    /** Rejection of invalid arguments. */
    const invalid = await host.resources
      .run('orders@1', 'create', { customer: '' })
      .catch((error: unknown) => error)
    expect(invalid).toMatchObject({ code: 'ARGS_INVALID', source: 'part.host' })
    expect(Array.isArray((invalid as { cause?: unknown }).cause)).toBe(true)
    expect(created).toHaveLength(1)

    failNext = true
    await expect(host.resources.run('orders@1', 'create', { customer: 'B' })).rejects.toThrow(
      'create failed'
    )
    await settle(host)
    expect(loads.orders.calls).toHaveLength(4)

    await expect(host.resources.run('orders@1', 'nope', {})).rejects.toMatchObject({
      code: PartHostErrorCode.resourceCommandUnknown
    })
    const missing = host.resources.watch({ $resource: 'missing@1' })
    expect(missing.read()).toMatchObject({
      status: 'error',
      error: { code: PartHostErrorCode.resourceUnknown }
    })
    expect(() => host.resources.refresh('missing@1')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.resourceUnknown })
    )
    for (const watch of [...watches, firstLoad, missing]) watch.release()
    await host.dispose()
  })
})

describe('queries across reloads', () => {
  it('resolves with the newer load when an invalidation aborts the awaited one', async () => {
    /** Load control. */
    const load = new ControlledLoad()
    const orders = defineResource({ id: 'orders@1', load: load.load })
    const host = await createPartHost({
      plugins: [definePartPlugin({ name: 'data', resources: [orders] })]
    })
    /** Query started before the invalidation. */
    const query = host.resources.query('orders@1', {})
    await settle(host)
    /** The load the query first awaits. */
    const first = load.last()
    host.resources.invalidate(['orders'])
    expect(first.signal.aborted).toBe(true)
    first.result.reject(new DOMException('aborted', 'AbortError'))
    await settle(host)
    expect(load.calls).toHaveLength(2)
    load.last().result.resolve(['new'])
    await expect(query).resolves.toEqual(['new'])
    await host.dispose()
  })
})
