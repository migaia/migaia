import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import type { IRemoteHostCatalog } from '../../src/remote/contract.js'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'
import { createRemoteHost } from '../../src/remote/host.js'
import { serveRemoteHost, type IRemoteServeHostOptions } from '../../src/remote/serve-host.js'
import { streamRoots } from '../streaming/fixture.js'
import { remoteHarness, remoteDescription } from './fixture.js'

/** One catalog covers trusted resolver admission and Host control projection. */
const catalog: IRemoteHostCatalog = {
  p: {
    schemaVersion: 1,
    plugin: 'p',
    features: { f: { methods: { m: { mode: 'request', idempotent: false } } } }
  }
}

/** Captures core providers without inventing another wire protocol. */
function endpointHarness() {
  /** Core provider callbacks are invoked with the same data and success shape. */
  const providers = new Map<
    string,
    (context: { readonly data: unknown; success(value?: unknown): unknown }) => unknown
  >()
  const dispose = vi.fn(async () => undefined)
  const endpoint = {
    provide(method: string, provider: unknown) {
      providers.set(method, provider as typeof providers extends Map<string, infer T> ? T : never)
    },
    dispose
  } as unknown as IRpcEndpoint
  return {
    endpoint,
    dispose,
    invoke: async (method: string, data: unknown) => {
      const provider = providers.get(method)
      if (!provider) throw new Error(`missing ${method}`)
      return provider({ data, success: (value?: unknown) => value })
    }
  }
}

/** Give Host control mocks a canonical registration identity without mocking its owner. */
async function currentHandleFixture(output: Record<string, unknown>) {
  /** Identity authority lives in this actual Host registration. */
  const owner = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const [handle] = await owner.use(
    definePlugin({
      name: 'p',
      features: { f: defineFeature(() => output) },
      install: () => ({})
    })
  )
  return { owner, handle }
}

describe('remote Host trusted control', () => {
  it('rejects a Host catalog key mismatch before resolver or Host admission', async () => {
    const endpoint = endpointHarness()
    const use = vi.fn()
    const resolvePlugin = vi.fn()
    await expect(
      serveRemoteHost({
        host: {
          use,
          unUse: vi.fn(),
          plugin: { disabled: () => [] },
          revision: 0
        } as unknown as IRemoteServeHostOptions['host'],
        catalog: { other: catalog.p! },
        resolvePlugin,
        endpoint: { endpoint: endpoint.endpoint },
        report: vi.fn()
      })
    ).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.contractInvalid })
    expect(resolvePlugin).not.toHaveBeenCalled()
    expect(use).not.toHaveBeenCalled()
  })

  it('leaves no inspect or callable ghost after Host.use fails', async () => {
    const endpoint = endpointHarness()
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: () => 'live' })) },
      install: () => ({})
    })
    /** Admission fails once before a valid handle is returned. */
    let fail = true
    const output = { m: () => 'live' }
    const fixture = await currentHandleFixture(output)
    const use = vi.fn(async () => {
      if (fail) throw new Error('admission failed')
      return [fixture.handle]
    })
    const host = {
      use,
      unUse: vi.fn(async () => ({ ok: true })),
      plugin: { disabled: () => [] },
      revision: 1
    } as unknown as IRemoteServeHostOptions['host']
    const service = await serveRemoteHost({
      host,
      catalog,
      resolvePlugin: () => definition,
      endpoint: { endpoint: endpoint.endpoint },
      report: vi.fn()
    })
    try {
      await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toThrow(
        'admission failed'
      )
      expect(await endpoint.invoke(RemoteMethodName.hostInspect, [])).toMatchObject({ plugins: [] })
      await expect(endpoint.invoke('p.f.m', [])).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      fail = false
      await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).resolves.toMatchObject({
        name: 'p'
      })
      expect(use).toHaveBeenCalledTimes(2)
      expect(await endpoint.invoke(RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: [{ name: 'p' }]
      })
    } finally {
      await service.close()
      await fixture.owner.dispose()
    }
  })

  it('adopts an identical shared definition and closes stale connection handles', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let calls = 0
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: () => ++calls })) },
      install: () => ({})
    })
    const use = vi.spyOn(host, 'use')
    const first = endpointHarness()
    const second = endpointHarness()
    const options = {
      host: host as never,
      catalog,
      resolvePlugin: () => definition,
      report: vi.fn()
    }
    const a = await serveRemoteHost({ ...options, endpoint: { endpoint: first.endpoint } })
    const b = await serveRemoteHost({ ...options, endpoint: { endpoint: second.endpoint } })
    try {
      await first.invoke(RemoteMethodName.hostUse, ['p'])
      await expect(first.invoke('p.f.m', [])).resolves.toBe(1)
      await expect(second.invoke(RemoteMethodName.hostUse, ['p'])).resolves.toMatchObject({
        name: 'p'
      })
      expect(use).toHaveBeenCalledTimes(1)
      await expect(second.invoke('p.f.m', [])).resolves.toBe(2)
      const conflicting = endpointHarness()
      const duplicate = await serveRemoteHost({
        ...options,
        resolvePlugin: () =>
          definePlugin({
            name: 'p',
            features: { f: defineFeature(() => ({ m: () => 0 })) },
            install: () => ({})
          }),
        endpoint: { endpoint: conflicting.endpoint }
      })
      await expect(conflicting.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
        code: 'PLUGIN_DUPLICATE'
      })
      await duplicate.close()
      await second.invoke(RemoteMethodName.hostUnUse, ['p'])
      await expect(first.invoke('p.f.m', [])).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      expect(calls).toBe(2)
      const replacement = definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ m: () => ++calls })) },
        install: () => ({})
      })
      const third = endpointHarness()
      const c = await serveRemoteHost({
        ...options,
        resolvePlugin: () => replacement,
        endpoint: { endpoint: third.endpoint }
      })
      try {
        await third.invoke(RemoteMethodName.hostUse, ['p'])
        await expect(first.invoke('p.f.m', [])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.closed
        })
        await expect(third.invoke('p.f.m', [])).resolves.toBe(3)
      } finally {
        await c.close()
      }
    } finally {
      await a.close()
      await b.close()
      await host.dispose()
    }
  })

  it('[D5] shares an in-flight Host use across two remote connections', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: () => 'live' })) },
      install: () => ({})
    })
    const use = vi.spyOn(host, 'use')
    const first = endpointHarness()
    const second = endpointHarness()
    const options = {
      host: host as never,
      catalog,
      resolvePlugin: () => definition,
      report: vi.fn()
    }
    const a = await serveRemoteHost({ ...options, endpoint: { endpoint: first.endpoint } })
    const b = await serveRemoteHost({ ...options, endpoint: { endpoint: second.endpoint } })
    try {
      const results = await Promise.all([
        first.invoke(RemoteMethodName.hostUse, ['p']),
        second.invoke(RemoteMethodName.hostUse, ['p'])
      ])
      expect(results).toEqual([
        expect.objectContaining({ name: 'p' }),
        expect.objectContaining({ name: 'p' })
      ])
      expect(use).toHaveBeenCalledTimes(1)
      await expect(first.invoke('p.f.m', [])).resolves.toBe('live')
      await expect(second.invoke('p.f.m', [])).resolves.toBe('live')
    } finally {
      await a.close()
      await b.close()
      await host.dispose()
    }
  })

  it('prunes an externally removed plugin before shared Host adoption', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: () => 'live' })) },
      install: () => ({})
    })
    const first = endpointHarness()
    const second = endpointHarness()
    const options = {
      host: host as never,
      catalog,
      resolvePlugin: () => definition,
      report: vi.fn()
    }
    const a = await serveRemoteHost({ ...options, endpoint: { endpoint: first.endpoint } })
    const b = await serveRemoteHost({ ...options, endpoint: { endpoint: second.endpoint } })
    try {
      await first.invoke(RemoteMethodName.hostUse, ['p'])
      await host.unUse('p')
      await expect(first.invoke('p.f.m', [])).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      expect(await second.invoke(RemoteMethodName.hostInspect, [])).toMatchObject({ plugins: [] })
      await expect(second.invoke(RemoteMethodName.hostUse, ['p'])).resolves.toMatchObject({
        name: 'p'
      })
      await expect(first.invoke('p.f.m', [])).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      await expect(second.invoke('p.f.m', [])).resolves.toBe('live')
    } finally {
      await a.close()
      await b.close()
      await host.dispose()
    }
  })

  it('closes resources after a failed first preparation and retries the same Host', async () => {
    const fixture = remoteHarness()
    /** A transient endpoint factory failure must not poison later ready calls. */
    let fail = true
    let opens = 0
    const remote = createRemoteHost({
      catalog,
      binding: {
        ...fixture.binding,
        async openChannel() {
          opens += 1
          return fixture.channel
        }
      },
      endpointFactory: async () => {
        if (fail) throw new Error('transient endpoint failure')
        return {
          endpoint: {
            ...fixture.served.endpoint,
            async send(_peer: string, method: string) {
              return method === RemoteMethodName.runtimeDescribe
                ? remoteDescription(Object.values(catalog), 'peer', true)
                : { revision: 1, plugins: [] }
            }
          } as unknown as IRpcEndpoint
        }
      },
      report: vi.fn()
    })
    await expect(remote.ready()).rejects.toThrow('transient endpoint failure')
    expect(fixture.calls.filter((call) => call === 'channel.close')).toHaveLength(1)
    fail = false
    await expect(remote.ready()).resolves.toBeUndefined()
    expect(opens).toBe(2)
    await remote.release()
  })

  it('opens one borrowed channel when a ready event precedes the first ready call', async () => {
    const fixture = remoteHarness()
    await fixture.supervisor.start()
    let opens = 0
    const remote = createRemoteHost({
      catalog,
      binding: {
        ...fixture.binding,
        async openChannel() {
          opens += 1
          return fixture.channel
        }
      },
      endpointFactory: async () => ({
        endpoint: {
          ...fixture.served.endpoint,
          async send() {
            return remoteDescription(Object.values(catalog), 'peer', true)
          }
        } as unknown as IRpcEndpoint
      }),
      report: vi.fn()
    })
    fixture.emit({ type: 'state', from: 'starting', to: 'ready', generation: 1 })
    await remote.ready()
    expect(opens).toBe(1)
    await remote.release()
  })

  it('rejects thenables, forged definitions, wrong names and unknown names before Host.use', async () => {
    const endpoint = endpointHarness()
    const fixture = await currentHandleFixture({})
    const use = vi.fn(async () => [fixture.handle])
    const unUse = vi.fn(async () => ({ ok: true }))
    /** Resolver output changes without changing the Host or the exposed providers. */
    let candidate: unknown = definePlugin({ name: 'p', install: () => ({}) })
    const resolvePlugin = vi.fn(() => candidate)
    const host = {
      use,
      unUse,
      plugin: { disabled: () => [] },
      get revision() {
        return 7
      }
    } as unknown as IRemoteServeHostOptions['host']
    const served = await serveRemoteHost({
      host,
      catalog,
      resolvePlugin,
      endpoint: { endpoint: endpoint.endpoint },
      report: vi.fn()
    })
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['q'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    expect(resolvePlugin).toHaveBeenCalledTimes(0)
    candidate = Promise.resolve(definePlugin({ name: 'p', install: () => ({}) }))
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    candidate = { name: 'p', install: () => ({}) }
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    candidate = definePlugin({ name: 'q', install: () => ({}) })
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    candidate = 7
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    /** Resolver exceptions remain the original value before Host admission. */
    const resolverError = new Error('resolver failed')
    candidate = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'then') throw resolverError
          return undefined
        }
      }
    )
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p'])).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid,
      cause: resolverError
    })
    expect(use).toHaveBeenCalledTimes(0)
    candidate = definePlugin({ name: 'p', install: () => ({}) })
    await expect(endpoint.invoke(RemoteMethodName.hostUse, ['p', { answer: 1 }])).resolves.toEqual({
      name: 'p',
      state: 'enabled',
      revision: 7,
      features: ['f']
    })
    expect(use).toHaveBeenCalledExactlyOnceWith(candidate)
    expect(resolvePlugin).toHaveBeenLastCalledWith('p', { answer: 1 })
    await served.close()
    await served.close()
    expect(endpoint.dispose).toHaveBeenCalledTimes(1)
    await fixture.owner.dispose()
  })

  it('shares inspect receipts and keeps dry runs distinct from committed removal', async () => {
    const fixture = await currentHandleFixture({})
    const use = vi.fn(async () => [fixture.handle])
    const unUse = vi.fn(async (_name: string, options: { dryRun?: boolean }) =>
      options.dryRun
        ? { policy: 'reject', order: ['p'], steps: [{ name: 'p', action: 'release' }], edges: [] }
        : { ok: true }
    )
    const host = {
      use,
      unUse,
      plugin: { disabled: () => [] },
      revision: 9
    } as unknown as IRemoteServeHostOptions['host']
    const first = endpointHarness()
    const second = endpointHarness()
    const options = {
      host,
      catalog,
      resolvePlugin: () => definePlugin({ name: 'p', install: () => ({}) }),
      report: vi.fn()
    }
    const a = await serveRemoteHost({ ...options, endpoint: { endpoint: first.endpoint } })
    const b = await serveRemoteHost({ ...options, endpoint: { endpoint: second.endpoint } })
    await first.invoke(RemoteMethodName.hostUse, ['p'])
    expect(await second.invoke(RemoteMethodName.hostInspect, [])).toEqual({
      revision: 9,
      plugins: [{ name: 'p', state: 'enabled', revision: 9, features: ['f'] }]
    })
    expect(await first.invoke(RemoteMethodName.hostUnUse, ['p', { dryRun: true }])).toMatchObject({
      dryRun: true,
      order: ['p']
    })
    expect(
      (await second.invoke(RemoteMethodName.hostInspect, [])) as { plugins: unknown[] }
    ).toHaveProperty('plugins.length', 1)
    await expect(
      first.invoke(RemoteMethodName.hostUnUse, ['p', { policy: 'cascade' }])
    ).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    await first.invoke(RemoteMethodName.hostUnUse, ['p', { dryRun: false }])
    expect(unUse).toHaveBeenLastCalledWith('p', { policy: 'reject' })
    expect(
      (await second.invoke(RemoteMethodName.hostInspect, [])) as { plugins: unknown[] }
    ).toHaveProperty('plugins.length', 0)
    await a.close()
    await b.close()
    await fixture.owner.dispose()
  })

  it('uses one Host generation for describe and reserved control methods', async () => {
    const harness = remoteHarness()
    const sends: { method: string; params: unknown }[] = []
    /** Guard failure must precede the Host control frame. */
    let guardFailure: Error | undefined
    const beforeDispatch = vi.fn(() => {
      if (guardFailure) throw guardFailure
    })
    const endpoint = {
      ...harness.served.endpoint,
      async send(_peer: string, method: string, params: unknown) {
        sends.push({ method, params })
        if (method === RemoteMethodName.runtimeDescribe)
          return remoteDescription(Object.values(catalog), 'peer', true)
        if (method === RemoteMethodName.hostUse)
          return { name: 'p', state: 'enabled', revision: 1, features: ['f'] }
        if (method === RemoteMethodName.hostInspect) return { revision: 1, plugins: [] }
        return { ok: true }
      }
    } as unknown as IRpcEndpoint
    const remote = createRemoteHost({
      catalog,
      binding: harness.binding as never,
      endpointFactory: async () => ({ endpoint }),
      callGuard: { beforeDispatch },
      report: vi.fn()
    })
    await remote.ready()
    guardFailure = new Error('guard rejected')
    await expect(remote.inspect()).rejects.toBe(guardFailure)
    expect(sends).toHaveLength(1)
    guardFailure = undefined
    await expect(remote.use('missing')).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.contractInvalid
    })
    expect(sends).toHaveLength(1)
    const features = await remote.use('p')
    expect(features.f).toHaveProperty('m')
    await remote.inspect()
    await remote.unUse('p')
    expect(sends.map((call) => call.method)).toEqual([
      RemoteMethodName.runtimeDescribe,
      RemoteMethodName.hostUse,
      RemoteMethodName.hostInspect,
      RemoteMethodName.hostUnUse
    ])
    expect(sends[1]?.params).toEqual(['p'])
    expect(beforeDispatch).toHaveBeenCalledWith({
      method: RemoteMethodName.hostUse,
      mode: 'host-control',
      generation: 1
    })
    const released = remote.release()
    expect(remote.release()).toBe(released)
    await released
  })

  it('uses a trusted definition over a real core channel and returns the declared feature proxy', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), abort()]
      },
      streamRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      streamRoots()
    )
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: (value: unknown) => value })) },
      install: () => ({})
    })
    const resolver = vi.fn(() => definition)
    const service = await serveRemoteHost({
      host: host as never,
      catalog,
      resolvePlugin: resolver,
      endpoint: { endpoint: server as unknown as IRpcEndpoint },
      report: (error) => {
        throw error
      }
    })
    const fixture = remoteHarness()
    const remote = createRemoteHost({
      catalog,
      binding: {
        ...fixture.binding,
        async openChannel() {
          return { ...fixture.channel, peerId: 'server' }
        }
      },
      endpointFactory: async () => ({ endpoint: client as unknown as IRpcEndpoint }),
      report: (error) => {
        throw error
      }
    })
    try {
      await remote.ready()
      const features = await remote.use('p', { color: 'blue' })
      expect(await features.f!.m!(['value'])).toBe('value')
      expect(resolver).toHaveBeenCalledExactlyOnceWith('p', { color: 'blue' })
      expect(await remote.inspect()).toEqual({
        revision: host.revision,
        plugins: [{ name: 'p', state: 'enabled', revision: host.revision, features: ['f'] }]
      })
      expect(await remote.unUse('p')).toEqual({ ok: true })
      expect(await remote.inspect()).toEqual({ revision: host.revision, plugins: [] })
    } finally {
      await remote.release()
      await service.close()
      await host.dispose()
    }
  })

  it('revokes control calls during a generation switch and shares the next ready promise', async () => {
    const harness = remoteHarness()
    /** Hold the replacement endpoint until both ready observers have joined. */
    let completeReplacement: (() => void) | undefined
    const replacement = new Promise<void>((resolve) => {
      completeReplacement = resolve
    })
    let constructions = 0
    const endpoint = {
      async send(_peer: string, method: string) {
        if (method === RemoteMethodName.runtimeDescribe)
          return remoteDescription(Object.values(catalog), 'peer', true)
        return { revision: 2, plugins: [] }
      },
      async dispose() {}
    } as unknown as IRpcEndpoint
    const remote = createRemoteHost({
      catalog,
      binding: harness.binding as never,
      endpointFactory: async () => {
        constructions += 1
        if (constructions === 2) await replacement
        return { endpoint }
      },
      report: vi.fn()
    })
    const first = remote.ready()
    await first
    harness.nextGeneration()
    harness.emit({ type: 'switched', from: 1, to: 2, unit: 'unit' })
    const next = remote.ready()
    expect(remote.ready()).toBe(next)
    expect(next).not.toBe(first)
    await expect(remote.inspect()).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed
    })
    completeReplacement?.()
    await next
    expect(await remote.inspect()).toEqual({ revision: 2, plugins: [] })
    await remote.release()
  })
})

describe('K203 remote Host removal adoption', () => {
  it('rejects unadopted and local installations, permits live adopters, and expires other adopters', async () => {
    /** Real Host identity distinguishes local installation from successful remote admission. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Observe the protected Host mutation boundary, including dryRun. */
    const unUse = vi.spyOn(host, 'unUse')
    /** Both connections resolve this exact trusted plugin definition. */
    const definition = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: () => 'live' })) },
      install: () => ({})
    })
    /** First connection owns its independent remote adoption record. */
    const a = endpointHarness()
    /** Second connection cannot inherit removal authority without hostUse. */
    const b = endpointHarness()
    /** First remote service owns only its endpoint, never local Host installations. */
    const serviceA = await serveRemoteHost({
      host: host as unknown as IRemoteServeHostOptions['host'],
      catalog,
      resolvePlugin: () => definition,
      endpoint: { endpoint: a.endpoint },
      report: vi.fn()
    })
    /** Second service shares Host installations but retains separate adoption authority. */
    const serviceB = await serveRemoteHost({
      host: host as unknown as IRemoteServeHostOptions['host'],
      catalog,
      resolvePlugin: () => definition,
      endpoint: { endpoint: b.endpoint },
      report: vi.fn()
    })
    try {
      for (const options of [{}, { dryRun: true }])
        await expect(b.invoke(RemoteMethodName.hostUnUse, ['p', options])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.hostNotAdopted
        })
      expect(unUse).not.toHaveBeenCalled()
      const [local] = await host.use(definition)
      for (const options of [{}, { dryRun: true }])
        await expect(b.invoke(RemoteMethodName.hostUnUse, ['p', options])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.hostNotAdopted
        })
      expect(unUse).not.toHaveBeenCalled()
      expect(local.getFeature('f')).toBeDefined()
      await host.unUse('p')
      unUse.mockClear()
      await a.invoke(RemoteMethodName.hostUse, ['p'])
      for (const options of [{}, { dryRun: true }])
        await expect(b.invoke(RemoteMethodName.hostUnUse, ['p', options])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.hostNotAdopted
        })
      expect(unUse).not.toHaveBeenCalled()
      await b.invoke(RemoteMethodName.hostUse, ['p'])
      await expect(
        a.invoke(RemoteMethodName.hostUnUse, ['p', { dryRun: true }])
      ).resolves.toMatchObject({ dryRun: true })
      await host.plugin.disable('p', { policy: 'suspend' })
      await expect(a.invoke(RemoteMethodName.hostUnUse, ['p'])).resolves.toEqual({ ok: true })
      expect(unUse).toHaveBeenCalledTimes(2)
      await expect(b.invoke('p.f.m', [])).rejects.toMatchObject({
        code: RpcRemoteLayerErrorCode.closed
      })
      for (const options of [{}, { dryRun: true }])
        await expect(b.invoke(RemoteMethodName.hostUnUse, ['p', options])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.hostNotAdopted
        })
      expect(unUse).toHaveBeenCalledTimes(2)
    } finally {
      await serviceA.close()
      await serviceB.close()
      await host.dispose()
    }
  })
})

describe('K203 exact remote installation lifetime', () => {
  it.each([false, true])(
    'rejects local replacement with reused Feature output (disabled=%s)',
    async (disabled) => {
      /** Supported Feature factories may deliberately reuse one frozen output across installations. */
      const output = { m: () => 'shared output' }
      /** The initial installation is admitted by the remote control path. */
      const remoteDefinition = definePlugin({
        name: 'p',
        features: { f: defineFeature(() => output) },
        install: () => ({})
      })
      /** A different local definition proves output identity is not installation authority. */
      const localDefinition = definePlugin({
        name: 'p',
        features: { f: defineFeature(() => output) },
        install: () => ({})
      })
      /** The real name-addressed Host handle deliberately survives replacement generations. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Count only attempts after the legitimate local removal and replacement. */
      const unUse = vi.spyOn(host, 'unUse')
      const endpoint = endpointHarness()
      const service = await serveRemoteHost({
        host: host as unknown as IRemoteServeHostOptions['host'],
        catalog,
        resolvePlugin: () => remoteDefinition,
        endpoint: { endpoint: endpoint.endpoint },
        report: vi.fn()
      })
      try {
        await endpoint.invoke(RemoteMethodName.hostUse, ['p'])
        await host.unUse('p')
        const [local] = await host.use(localDefinition)
        if (disabled) await host.plugin.disable('p', { policy: 'suspend' })
        unUse.mockClear()
        await expect(endpoint.invoke(RemoteMethodName.hostUnUse, ['p'])).rejects.toMatchObject({
          code: RpcRemoteLayerErrorCode.hostNotAdopted
        })
        expect(unUse).not.toHaveBeenCalled()
        if (disabled) expect(host.plugin.disabled()).toContain('p')
        else expect(local.getFeature('f')).toBe(output)
      } finally {
        await service.close()
        await host.dispose()
      }
    }
  )
})
