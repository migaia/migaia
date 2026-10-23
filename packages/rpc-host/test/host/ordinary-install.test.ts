import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { defineTransportPlugin } from '../../dist/plugin/define.js'
import { readRpcPluginMetadata } from '../../dist/plugin/metadata.js'
import {
  createAdapterDeployment,
  readAdapterDeployment
} from '../../dist/runtime-adapter/deployment.js'
import {
  readRuntimeOutletConnection,
  type IRuntimeOutlet
} from '../../dist/remote/runtime-api/outlet.js'
import { typegenFeature } from '../../dist/features/typegen.js'
import { memoryServer } from './fixture.js'

/** Native Host defaults remain the same as tray's receiving plugin-host runtime. */
function ordinaryHost() {
  return new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
}

/** Reuse the real listener token while giving its native definition an explicit publication name. */
function namedTransport(
  server: ReturnType<typeof memoryServer>,
  name = 'worker',
  expose: readonly string[] = []
) {
  const metadata = readRpcPluginMetadata(server.transport)!
  if (metadata.kind !== 'transport') throw new Error('fixture requires a transport')
  return defineTransportPlugin({ ...metadata.definition, name, expose })
}

/** The existing native outlet is published on the receiving Host, independently of its TS surface. */
function outlet(host: object): IRuntimeOutlet {
  return Reflect.get(host, 'process') as IRuntimeOutlet
}

describe('ordinary native Host RPC installation', () => {
  it('preserves registration name, exposed feature calls and exactly-once unuse cleanup', async () => {
    const host = ordinaryHost()
    const server = memoryServer('server')
    const transport = namedTransport(server, 'worker', ['app.resize'])
    const app = definePlugin({
      name: 'app',
      features: { view: defineFeature(() => ({ resize: (value: number) => value + 1 })) },
      install: () => ({})
    })
    await host.use(app, transport)
    const client = await server.connect('client', { provide: { value: () => 17 } })
    const runtime = outlet(host)
    const close = vi.spyOn(client.pair[0], 'close')
    try {
      expect(await client.host.request('app.resize', 4)).toBe(5)
      expect(await runtime.request('worker', 'value')).toBe(17)
      expect(await host.unUse('worker')).toMatchObject({ ok: true })
      expect(close).toHaveBeenCalledTimes(1)
      expect(() => runtime.request('worker', 'value')).toThrowError(
        expect.objectContaining({ code: 'TARGET_UNKNOWN' })
      )
      await host.dispose()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      await client.host.close()
      await host.dispose()
    }
  })

  it('keeps old publication after candidate failure and retires it only after successful replacement', async () => {
    const host = ordinaryHost()
    const server = memoryServer('first')
    await host.use(namedTransport(server))
    const first = await server.connect('first-client', { provide: { value: () => 1 } })
    const close = vi.spyOn(first.pair[0], 'close')
    const held = readRuntimeOutletConnection(outlet(host), 'worker')!.peer
    const failure = new Error('candidate listener failed')
    const failed = defineTransportPlugin({
      name: 'worker',
      mode: 'listen',
      deployment: createAdapterDeployment({
        open: async () => {
          throw failure
        },
        listen: async () => {
          throw failure
        }
      })
    })
    try {
      await expect(host.replace('worker', failed)).rejects.toMatchObject({ cause: failure })
      expect(await outlet(host).request('worker', 'value')).toBe(1)
      expect(close).not.toHaveBeenCalled()
      const next = memoryServer('next')
      const metadata = readRpcPluginMetadata(namedTransport(next))!
      if (metadata.kind !== 'transport') throw new Error('fixture requires a transport')
      const recipe = readAdapterDeployment(metadata.definition.deployment)!
      const order: string[] = []
      // Count ordering without replacing the actual memory transport's close operation.
      close.mockRestore()
      const originalClose = first.pair[0].close
      const orderedClose = vi.spyOn(first.pair[0], 'close').mockImplementation(() => {
        order.push('old:close')
        return originalClose()
      })
      const candidate = defineTransportPlugin({
        ...metadata.definition,
        deployment: createAdapterDeployment({
          ...recipe,
          listen: async (context, accept) => {
            const listener = await recipe.listen!(context, accept)
            order.push('candidate:listening')
            expect(await outlet(host).request('worker', 'value')).toBe(1)
            return listener
          }
        })
      })
      await host.replace('worker', candidate)
      expect(order).toEqual(['candidate:listening', 'old:close'])
      expect(orderedClose).toHaveBeenCalledTimes(1)
      await expect(held.request('value')).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' })
      const second = await next.connect('next-client', { provide: { value: () => 2 } })
      try {
        expect(await outlet(host).request('worker', 'value')).toBe(2)
      } finally {
        await second.host.close()
      }
    } finally {
      await first.host.close()
      await host.dispose()
    }
  })

  it('ends typegen writes when its original feature is removed while transport remains installed', async () => {
    const host = ordinaryHost()
    const server = memoryServer('server')
    const write = vi.fn()
    await host.use(typegenFeature({ out: { write } }), namedTransport(server))
    const first = await server.connect('first', { provide: { value: () => 1 } })
    try {
      expect(write).toHaveBeenCalledTimes(1)
      expect(write.mock.calls[0]![1]).toContain('"value"')
      await host.unUse('rpc-typegen')
      const second = await server.connect('second', { provide: { other: () => 2 } })
      try {
        expect(write).toHaveBeenCalledTimes(1)
        expect(await outlet(host).request({ name: 'worker', instanceId: 'second' }, 'other')).toBe(
          2
        )
      } finally {
        await second.host.close()
      }
    } finally {
      await first.host.close()
      await host.dispose()
    }
  })
})
