import { definePlugin } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  definePart,
  definePartPlugin,
  PartHostErrorCode,
  type IPartPlugin
} from '../src/index.ts'
import { RenderLog, rendererPlugin } from './fixtures.ts'

/** Plugin registering one part. */
const ordersPlugin = definePartPlugin({
  name: 'orders',
  parts: [definePart({ id: 'orders-table@1' })]
})

describe('host and plugins', () => {
  it('disposes once, registers and withdraws plugin contributions', async () => {
    const host = await createPartHost({ plugins: [ordersPlugin] })
    expect(host.catalog.get('orders-table@1')).toBeDefined()
    await host.unUse('orders')
    expect(host.catalog.get('orders-table@1')).toBeUndefined()
    const first = host.dispose()
    expect(host.dispose()).toBe(first)
    expect((await first).cleanupErrors).toEqual([])
  })

  it('reports cleanup failures once and returns them in the dispose result', async () => {
    const failure = new Error('cleanup failed')
    const errors: unknown[] = []
    const broken = definePlugin({
      name: 'broken',
      install: () => ({}),
      dispose: () => {
        throw failure
      }
    }) as unknown as IPartPlugin
    const host = await createPartHost({ plugins: [broken], onError: (error) => errors.push(error) })
    const result = await host.dispose()
    expect(result.cleanupErrors.length).toBeGreaterThan(0)
    expect(errors).toHaveLength(result.cleanupErrors.length)
  })

  it('rejects a second renderer plugin with another name', async () => {
    const log = new RenderLog()
    const host = await createPartHost({ plugins: [rendererPlugin('r1', log.factory())] })
    await expect(host.use(rendererPlugin('r2', log.factory()))).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: { code: PartHostErrorCode.rendererDuplicate, source: 'part.host' }
    })
    await host.dispose()
  })
})
