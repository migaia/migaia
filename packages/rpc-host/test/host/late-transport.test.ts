import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Keeps late and cold installation on the same public native transaction boundary. */
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  defineFlowFeature,
  defineTransportPlugin,
  RpcFlowPoint,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from './core-fixture.ts'

it('late use returns the same public Host, inherits one shared setup and preserves the cold local override', async () => {
  /** The shared installation must exist even while every cold namespace overrides its placement. */
  const sharedDispatch = vi.fn()
  /** The local placement must remain isolated after a new namespace inherits the shared one. */
  const localDispatch = vi.fn()
  /** This original native stage witnesses actual provider dispatch in an inheriting namespace. */
  const sharedStage: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    sharedDispatch()
    await next(payload)
  }
  /** One real host-level Feature prepares one original installation for every namespace. */
  const sharedSetup = vi.fn(() => ({ stages: { [RpcFlowPoint.dispatchInbound]: sharedStage } }))
  /** Equal authentic Feature names select a transport-local override through the existing compiler. */
  const shared = defineFlowFeature({
    phase: 1000,
    name: 'late-shared-dispatch',
    setup: sharedSetup
  })
  /** This original local Feature owns only the cold transport's actual dispatch lane. */
  const local = defineFlowFeature({
    phase: 1001,
    name: 'late-shared-dispatch',
    setup: () => ({
      stages: {
        [RpcFlowPoint.dispatchInbound]: async (payload, next) => {
          localDispatch()
          await next(payload)
        }
      }
    })
  })
  /** The only cold listener deliberately overrides the shared placement. */
  const first = coreMemoryServer('late-host', 'late-host', 'first', { local })
  /** The late listener uses its own real native transport and inherits the original shared state. */
  const second = coreMemoryServer('late-host', 'late-host', 'second')
  /** Public construction owns the actual native Host, provider and both eventual namespace groups. */
  const host = await createRpcHost({
    ...first.options,
    plugins: [rpcFeaturesPlugin({ features: { shared } }), first.transport],
    provide: { echo: (value: unknown) => value }
  })
  /** The cold path already has a real physical client before the next transport is installed. */
  const a = await first.connect('late-first-client')
  try {
    expect(Object.isFrozen(host)).toBe(true)
    expect('unuse' in host).toBe(false)
    expect(Object.hasOwn(host, 'unuse')).toBe(false)
    expect(Reflect.set(host, 'use', () => undefined)).toBe(false)
    expect(Reflect.defineProperty(host, 'unUse', { value: () => undefined })).toBe(false)
    expect(Reflect.deleteProperty(host, 'use')).toBe(false)
    expect(sharedSetup).toHaveBeenCalledTimes(1)
    await expect(a.host.first.send('late-host', 'echo', 'cold')).resolves.toBe('cold')
    expect(localDispatch).toHaveBeenCalledTimes(1)
    expect(sharedDispatch).not.toHaveBeenCalled()
    /** Awaited projection widens the namespace surface while keeping public object identity. */
    const extended = await host.use(second.transport)
    expect(extended).toBe(host)
    expect(extended.second).toBeDefined()
    expect(sharedSetup).toHaveBeenCalledTimes(1)
    /** This actual handshake and call must cross the newly installed group's inherited stages. */
    const b = await second.connect('late-second-client')
    try {
      await expect(b.host.second.send('late-host', 'echo', 'late')).resolves.toBe('late')
      expect(sharedDispatch).toHaveBeenCalledTimes(1)
      expect(localDispatch).toHaveBeenCalledTimes(1)
      await expect(a.host.first.send('late-host', 'echo', 'cold-again')).resolves.toBe('cold-again')
      expect(localDispatch).toHaveBeenCalledTimes(2)
      expect(sharedDispatch).toHaveBeenCalledTimes(1)
      expect(sharedSetup).toHaveBeenCalledTimes(1)
    } finally {
      await b.host.close()
    }
  } finally {
    await Promise.all([a.host.close(), host.close()])
  }
})

it('a failed late batch preserves its original cause and old calls; duplicate and unUse retain native results', async () => {
  /**
   * A previously committed real listener and physical Session remain usable after another batch
   * fails.
   */
  const server = coreMemoryServer('late-survivor', 'late-survivor', 'memory')
  /** Original provider execution is observable independently from install rejection. */
  const echo = vi.fn((value: unknown) => value)
  /** Each error object must remain reachable by identity through the actual native transaction. */
  const cause = new Error('late source acquisition cause')
  /** Only the actual new transport acquisition throws this original primary. */
  const primary = new TypeError('late source acquisition failed', { cause })
  /** A successful sibling acquisition must be released when this same late batch fails. */
  const rollback = vi.fn()
  /** This genuine native source contributes no fabricated Session or business method. */
  const sibling = defineTransportPlugin({
    name: 'temporary',
    namespace: 'temporary',
    open: () => ({ dispose: rollback })
  })
  /** Rejection occurs at the public SDK transport's actual native acquisition hook. */
  const rejected = defineTransportPlugin({
    name: 'rejected',
    namespace: 'rejected',
    open() {
      throw primary
    }
  })
  /** Prior namespace publication belongs to this one real public Host. */
  const host = await createRpcHost({ ...server.options, provide: { echo } })
  /** Calls use the original carrier pair and real provider, never a test dispatcher. */
  const client = await server.connect('late-survivor-client')
  try {
    /** Consume the expected public rejection without changing its error family or cause chain. */
    const failure = await host.use(sibling, rejected).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toBe(primary)
    expect(primary.cause).toBe(cause)
    expect(rollback).toHaveBeenCalledTimes(1)
    expect('temporary' in host).toBe(false)
    expect(() =>
      Reflect.apply(Reflect.get(host as object, 'pipeline'), undefined, [
        'temporary.handshakeOutbound'
      ])
    ).toThrowError(expect.objectContaining({ code: 'PIPELINE_UNKNOWN' }))
    await expect(client.host.memory.send('late-survivor', 'echo', 'after-rejection')).resolves.toBe(
      'after-rejection'
    )
    expect(echo).toHaveBeenCalledTimes(1)
    await expect(host.use(server.transport)).rejects.toMatchObject({
      source: 'plugin.host',
      code: 'PLUGIN_DUPLICATE'
    })
    await expect(client.host.memory.send('late-survivor', 'echo', 'after-duplicate')).resolves.toBe(
      'after-duplicate'
    )
    /** Advanced lookup borrows the existing public native owner projection, not a private core. */
    expect(
      Reflect.apply(Reflect.get(host as object, 'pipeline'), undefined, [
        'memory.handshakeOutbound'
      ])
    ).toHaveProperty('run')
    /** The public result is the native logical-removal receipt, rather than an RPC boolean wrapper. */
    const removal = await host.unUse('memory')
    expect(removal).toMatchObject({ ok: true })
    // The seven values are fixed by RpcFlowPoint, not a collection growing with runtime traffic.
    for (const point of Object.values(RpcFlowPoint))
      expect(() =>
        Reflect.apply(Reflect.get(host as object, 'pipeline'), undefined, [`memory.${point}`])
      ).toThrowError(expect.objectContaining({ code: 'PIPELINE_UNKNOWN' }))
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('cold construction rolls back every acquired transport and the shared flow installation', async () => {
  /** Shared setup is a real host-level native Feature installation, even before any Session exists. */
  const sharedDispose = vi.fn()
  /** Cold outer construction must release this committed flow prefix after transport failure. */
  const sharedSetup = vi.fn(() => ({ stages: {}, dispose: sharedDispose }))
  /** No private setup or synthetic cleanup owner is used by this original Feature. */
  const shared = defineFlowFeature({ phase: 1002, name: 'late-cold-shared', setup: sharedSetup })
  /** The first genuine native acquisition has its own exact cleanup receipt. */
  const acquiredDispose = vi.fn()
  /** Observe actual acquisition order independently from later physical cleanup. */
  const acquiredOpen = vi.fn(() => ({ dispose: acquiredDispose }))
  /** One successful native source precedes the real failing source in the same cold batch. */
  const acquired = defineTransportPlugin({
    name: 'acquired',
    namespace: 'acquired',
    open: acquiredOpen
  })
  /** The public construction rejection must preserve this exact original error. */
  const primary = new Error('cold second native source failed')
  /** Only this genuine acquisition supplies the cold failure producer. */
  const rejectedOpen = vi.fn(() => {
    throw primary
  })
  /** No fallback host or fake ready receipt stands in for the failed native transport. */
  const rejected = defineTransportPlugin({
    name: 'coldRejected',
    namespace: 'coldRejected',
    open: rejectedOpen
  })
  await expect(
    createRpcHost({
      self: { name: 'cold-atomic', instanceId: 'cold-atomic' },
      plugins: [rpcFeaturesPlugin({ features: { shared } }), acquired, rejected],
      report: () => undefined
    })
  ).rejects.toBe(primary)
  expect(acquiredOpen).toHaveBeenCalledTimes(1)
  expect(rejectedOpen).toHaveBeenCalledTimes(1)
  expect(acquiredDispose).toHaveBeenCalledTimes(1)
  expect(sharedSetup).toHaveBeenCalledTimes(1)
  expect(sharedDispose).toHaveBeenCalledTimes(1)
})
