/** Public lifetime and native rollback oracles for the new single-owner RPC installation. */
import { defineHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import type {
  IRpcAttempt,
  IRpcTimeoutFeature,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { probe, type IRpcProbeEventView } from '@migaia/rpc-host/plugins/probe'
import { RpcProbeLifecycle } from '@migaia/rpc-contract/interfaces'

it('publishes the original close Promise before provider abort listeners can reenter close', async () => {
  /** The origin and provider use real accepted semantic carriers and public host methods. */
  const server = coreMemoryServer('origin')
  /** This actual provider remains pending until the abort-listener identity assertion completes. */
  const lifetime = {
    entered: deferred<void>(),
    completion: deferred<void>(),
    reentrant: undefined as Promise<void> | undefined
  }
  /** Public construction owns the one native host and transport registration. */
  const host = await createRpcHost(server.options)
  /** The callback is invoked by the remote provider's real cancellation signal. */
  const client = await server.connect('provider', {
    provide: {
      wait: (_value: unknown, context: IRpcContext) => {
        context.signal.addEventListener(
          'abort',
          () => {
            lifetime.reentrant = client.host.close()
          },
          { once: true }
        )
        lifetime.entered.resolve()
        return lifetime.completion.promise
      }
    }
  })
  /** Rejection is observed immediately because close can settle the originating call synchronously. */
  const pending = host.memory.send('provider', 'wait').then(
    () => undefined,
    () => undefined
  )
  try {
    await lifetime.entered.promise
    /** The first close must be visible before abort synchronously calls back into the same owner. */
    const closing = client.host.close()
    expect(lifetime.reentrant).toBe(closing)
    expect(client.host.close()).toBe(closing)
    lifetime.completion.resolve()
    await closing
    await pending
  } finally {
    lifetime.completion.resolve()
    await Promise.all([client.host.close(), host.close()])
  }
})

it('withdraws rolled-back flow hooks, extensions and policy before an ordinary native host retries', async () => {
  /** This is the genuine ordinary native host; SDK definitions must reuse it directly. */
  const native = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** One original acquisition error must remain reachable through native transaction rejection. */
  const failure = new Error('first native transport failed')
  /** The rollback counter belongs to the exact failed flow installation. */
  const disposed = vi.fn()
  /** A rolled-back complete policy must not silently affect a later successful call. */
  const runs = { count: 0 }
  /** Complete policy instances execute through their one actual attempt port. */
  const timeout: IRpcTimeoutFeature = {
    kind: 'timeout',
    run<T>(attempt: IRpcAttempt<T>): Promise<T> {
      runs.count++
      return attempt.invoke(attempt.signal, attempt.remainingMs)
    }
  }
  /** These hooks and extension must disappear with their original native batch. */
  const failedFlow = defineFlowPlugin({
    name: 'failed-flow',
    setup: () => ({
      hooks: {},
      dispose: disposed,
      namespaceExtensions: () => ({ stale: () => true })
    })
  })
  /** The failed transport begins startup after flow installation, which initially freezes hooks. */
  const failedTransport = defineTransportPlugin({
    name: 'failed-transport',
    namespace: 'memory',
    open: () => {
      throw failure
    }
  })
  await expect(
    native.use(linkPolicy({ features: [timeout] }), failedFlow, failedTransport)
  ).rejects.toMatchObject({ cause: failure })
  expect(disposed).toHaveBeenCalledTimes(1)
  /** A new cold flow must be installable after the entire first batch rolled back. */
  const recovered = defineFlowPlugin({
    name: 'recovered-flow',
    setup: () => ({ hooks: {}, namespaceExtensions: () => ({ recovered: () => true }) })
  })
  /** The ordinary host's real SDK transport accepts the later public caller. */
  const server = coreMemoryServer('ordinary')
  await native.use(recovered, server.transport)
  /** Native publication is runtime-owned; its extension is intentionally read through reflection. */
  const surface = Reflect.get(native, 'memory')
  /** A real connected provider proves the failed policy was withdrawn from the existing RPC owner. */
  const client = await server.connect('provider', { provide: { echo: (value: unknown) => value } })
  try {
    expect(Object.hasOwn(surface, 'stale')).toBe(false)
    expect(surface.recovered()).toBe(true)
    expect(await surface.send('provider', 'echo', 42)).toBe(42)
    expect(runs.count).toBe(0)
  } finally {
    await Promise.all([client.host.close(), native.dispose()])
  }
  expect(disposed).toHaveBeenCalledTimes(1)
})

it('preserves real native Feature exposure and releases an ordinary transport exactly once on unUse', async () => {
  /** The receiving ordinary host remains the sole native plugin-host for both registrations. */
  const native = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The explicit whitelist is captured by the actual SDK transport definition. */
  const server = coreMemoryServer('server', 'server', 'memory', [], ['app.resize'])
  /** Native Feature output guards stay with their original receiving host registration. */
  const app = definePlugin({
    name: 'app',
    features: { view: defineFeature(() => ({ resize: (value: number) => value + 1 })) },
    install: () => ({})
  })
  await native.use(app, server.transport)
  /** This is a real public caller connected to the ordinary host's accepted namespace. */
  const client = await server.connect('client', { provide: { value: () => 17 } })
  /** Native shared-slot publication owns this namespace independently of its TS surface. */
  const surface = Reflect.get(native, 'memory')
  /** Observe the exact carrier close receipt, without substituting an RPC cleanup implementation. */
  const close = vi.spyOn(client.pair[0], 'close')
  try {
    expect(await client.host.memory.request('app.resize', 4)).toBe(5)
    expect(await surface.send('client', 'value')).toBe(17)
    expect(await native.unUse(server.transport.name)).toMatchObject({ ok: true })
    expect(close).toHaveBeenCalledTimes(1)
    /** BC1 replaces the old registration-addressed outlet with an explicitly retired namespace. */
    await expect(surface.send('client', 'value')).rejects.toMatchObject({
      code: 'ENDPOINT_DISPOSED'
    })
    await native.dispose()
    expect(close).toHaveBeenCalledTimes(1)
  } finally {
    await client.host.close()
    await native.dispose()
  }
})

it('rolls back actual native members in reverse opening order without replacing the assembly failure', async () => {
  /** The two actual receiving installations keep their own native Session authority. */
  const contexts: IRpcTransportContext[] = []
  /** BC3 moves assembly into the genuine native installation transaction. */
  const namespaces = ['first', 'second'] as const
  /** Each remote listener accepts a real physical pair before local construction fails. */
  const remote = await createRpcHost({
    self: { name: 'remote', instanceId: 'rollback-remote' },
    plugins: namespaces.map((namespace, index) =>
      defineTransportPlugin({
        name: `remote-${namespace}`,
        namespace,
        open(context) {
          contexts[index] = context
          return { dispose: () => undefined }
        }
      })
    ),
    report: () => undefined
  })
  /** Original physical close callbacks, rather than facade disposers, establish rollback order. */
  const closed: number[] = []
  /** This exact error must remain observable after the second physical member closes. */
  const cleanup = new Error('second member cleanup')
  /** The failed third acquisition remains construction's primary rejection. */
  const primary = new Error('assembler rejected')
  /** Rollback diagnostics retain the exact original secondary error. */
  const reports: unknown[] = []
  /** These are real native transport definitions, each acquiring one original physical pair. */
  const members = namespaces.map((namespace, index) =>
    defineTransportPlugin({
      name: `local-${namespace}`,
      namespace,
      async open(context) {
        /** The original local physical close receipt owns this member's native cleanup. */
        const local = new MemoryCarrier(`rollback-${namespace}-local`)
        /** The remote endpoint is attached through the already installed native listener. */
        const opposite = new MemoryCarrier(`rollback-${namespace}-remote`)
        local.link(opposite)
        opposite.link(local)
        /** Preserve the native callback's original exact close Promise before adding failure. */
        const close = local.close
        vi.spyOn(local, 'close').mockImplementation(async (reason) => {
          closed.push(index)
          await close(reason)
          if (index === 1) throw cleanup
        })
        /** Both accepted Session handles belong to their actual installing contexts. */
        const accepted = contexts[index]!.attach(opposite)
        /** The local host transaction already owns rollback before readiness is awaited. */
        const connected = context.attach(local)
        await Promise.all([accepted.ready, connected.ready])
        return { dispose: () => undefined }
      }
    })
  )
  /** Failure is independent of member cleanup, so it cannot be substituted by rollback. */
  const assembly = defineTransportPlugin({
    name: 'failed-assembly',
    namespace: 'failed',
    open: () => {
      throw primary
    }
  })
  try {
    await expect(
      createRpcHost({
        self: { name: 'assembled', instanceId: 'assembled' },
        plugins: [...members, assembly],
        report: (error) => reports.push(error)
      })
    ).rejects.toBe(primary)
    expect(closed).toEqual([1, 0])
    expect(
      reports.some((error) => error instanceof AggregateError && error.errors.includes(cleanup))
    ).toBe(true)
  } finally {
    await remote.close()
  }
})

it('reclaims a silent same-name Session with one ping and rejects a third concurrent candidate', async () => {
  /** The one actual listener accepts every candidate through its installed SessionTable. */
  const server = coreMemoryServer('server')
  /** BC3 moves the old exit observation to its canonical readonly probe consumer. */
  const exits: IRpcProbeEventView[] = []
  /** This original provider proves the old pending call belongs to the retired physical source. */
  const entered = deferred<void>()
  /** Public construction installs the genuine observation hook before native acquisition. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      probe({
        stages: ['peer'],
        emit(event) {
          if (event.lifecycle === RpcProbeLifecycle.closing && event.peerId === 'old-client')
            exits.push({ ...event })
        }
      }),
      ...server.options.plugins
    ]
  })
  /** The original accepted identity deliberately differs from the replacement's instance id. */
  const first = await server.connect(
    'client',
    {
      provide: {
        value: () => 1,
        pending: () => {
          entered.resolve()
          return new Promise(() => undefined)
        }
      }
    },
    'old-client'
  )
  /** Observe rejection immediately because physical retirement settles the original request. */
  const oldCall = host.memory.send('client', 'pending').catch((error) => error)
  await entered.promise
  /** Only native scheduling time is advanced; no fake response or Session is introduced. */
  vi.useFakeTimers()
  /** This exact native write receipt observes the one actual outgoing health control. */
  const original = first.pair[0].write
  /** Probe admission is awaited before the third contender is started. */
  const pingStarted = deferred<void>()
  /** Counts actual ping writes rather than inspection of private control tables. */
  let pings = 0
  vi.spyOn(first.pair[0], 'write').mockImplementation((frame, options) => {
    /** Identity fixture media remains canonical semantic traffic at this native boundary. */
    const control = frame.data as { kind?: string; operation?: string }
    if (control.kind === 'control' && control.operation === 'ping') {
      pings++
      pingStarted.resolve()
    }
    return original(frame, options)
  })
  vi.spyOn(first.pair[1], 'write').mockImplementation(() => Promise.resolve())
  /** The replacement is still the real public host and its original readiness Promise. */
  const replacement = server.connect('client', { provide: { value: () => 2 } }, 'new-client')
  /** Observe construction failure at once without changing its native propagation. */
  const accepted = replacement.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )
  try {
    await pingStarted.promise
    await expect(server.connect('client', {}, 'third-client')).rejects.toMatchObject({
      code: 'HOST_PEER_NAME_DUPLICATE'
    })
    await vi.advanceTimersByTimeAsync(10_000)
    /** This is actual accepted construction, not merely expiry of the old source. */
    const outcome = await accepted
    if (!outcome.ok) throw outcome.error
    const second = outcome.value
    try {
      expect(pings).toBe(1)
      expect(first.pair[0].closed).toBe(true)
      expect(exits).toHaveLength(1)
      expect(await host.memory.send('client', 'value')).toBe(2)
      expect(await oldCall).toMatchObject({ code: 'ENDPOINT_DISPOSED' })
    } finally {
      await second.host.close()
    }
  } finally {
    vi.restoreAllMocks()
    vi.useRealTimers()
    await first.host.close()
    await host.close()
  }
})
