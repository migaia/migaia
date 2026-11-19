import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  definePartPlugin,
  defineResource,
  PartHostErrorCode
} from '../src/index.ts'
import { ControlledLoad, settle } from './resource-support.ts'

/** Plugin `api` providing `orders@1` with the given load. */
function apiPlugin(load: ControlledLoad) {
  return definePartPlugin({
    name: 'api',
    resources: [defineResource({ id: 'orders@1', load: load.load })]
  })
}

describe('resource generations', () => {
  it('re-subscribes watches when the providing plugin is replaced, removed or reinstalled', async () => {
    const first = new ControlledLoad()
    const second = new ControlledLoad()
    const third = new ControlledLoad()
    const host = await createPartHost({ plugins: [apiPlugin(first)] })
    const watch = host.resources.watch({ $resource: 'orders@1' })
    await settle(host)
    const firstCall = first.last()

    await host.replace('api', apiPlugin(second))
    await settle(host)
    expect(firstCall.signal.aborted).toBe(true)
    expect(watch.read().status).toBe('loading')
    firstCall.result.resolve(['a'])
    second.last().result.resolve(['b'])
    await settle(host)
    expect(watch.read()).toMatchObject({ status: 'ready', data: ['b'] })

    await host.unUse('api')
    await settle(host)
    expect(watch.read()).toMatchObject({
      status: 'error',
      error: { code: PartHostErrorCode.resourceUnknown }
    })
    expect(() => host.resources.errorOf('orders@1', {})).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.resourceUnknown })
    )

    await host.use(apiPlugin(third))
    await settle(host)
    third.last().result.resolve(['c'])
    await settle(host)
    expect(watch.read()).toMatchObject({ status: 'ready', data: ['c'] })
    watch.release()
    await host.dispose()
  })
})
