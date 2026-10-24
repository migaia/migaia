import type { IAbortSignal } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import { createMutationQueue } from '@migaia/lifecycle'
import { hostFixture, runtimeHostFixture } from './fixtures/host-control.js'
import { nativeHostFixture } from './fixtures/host-native.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import * as runtimePeerModule from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { RemoteMethodName } from '@migaia/rpc-host/plugin'
import { RuntimeEventName } from '@migaia/rpc-host/plugin'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { createSpawnProcessBinding } from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import {
  createManagedRuntimePeer,
  readManagedRuntimeHolder
} from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createPrewarmPool } from '@migaia/supervision/process'
import { createProcessError } from '../../../rpc-plugin-process/dist/process/error.js'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import { DEFAULT_DRAIN_MS } from '@migaia/rpc-host/plugin'

/** Flush candidate cancellation and queued mutation continuations without changing time budgets. */
async function settle(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve()
}

/** Declarative registration only: each case owns its own runtime resources and mutable state. */
describe('process native replacement rollback', () => {
  it('rejects a candidate released between ready and publication', async () => {
    /** The neutral native ports retain their actual supervisor and true Host install owner. */
    const fixture = runtimeHostFixture()
    /** Retain the genuine factory before observing the second prepared candidate only. */
    const original =
      vi.mocked(runtimePeerModule.createRuntimePeer).getMockImplementation() ??
      runtimePeerModule.createRuntimePeer
    /** Both calls construct genuine public Peers; no candidate state is held by this observer. */
    let constructions = 0
    /** Join the original Host release Promise instead of polling or constructing a close facade. */
    let releasing: ReturnType<typeof fixture.close> | undefined
    /** Release occurs after actual directory readiness, before the install continuation publishes. */
    const observer = vi
      .spyOn(runtimePeerModule, 'createRuntimePeer')
      .mockImplementation((options, runtime) => {
        const preparing = original(options, runtime)
        if (options.self?.instanceId !== 'parent' || ++constructions !== 2) return preparing
        return preparing.then((peer) => {
          queueMicrotask(() => {
            releasing = fixture.close()
          })
          return peer
        })
      })
    try {
      await fixture.host.use(processPlugin(fixture.options))
      const outlet = fixture.host.process!
      await expect(
        fixture.host.replace('child', processPlugin(fixture.options))
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: { code: 'HOST_DISPOSING' } })
      await releasing
      expect(fixture.handles).toHaveLength(2)
      expect(() => outlet.request('child', 'p.f.request', 'probe')).toThrow(
        expect.objectContaining({ code: 'HOST_DISPOSED' })
      )
    } finally {
      try {
        await fixture.close()
      } finally {
        observer.mockRestore()
      }
    }
  })
  it('never resends an old sent idempotent request into the new real child', async () => {
    /** Real I/O retains production deadlines while the injected monotonic clock advances drain. */
    const fixture = nativeHostFixture('old')
    const scheduler = createManualScheduler()

    let draining!: () => void
    const drainStarted = new Promise<void>((resolve) => {
      draining = resolve
    })
    fixture.observeEndpoint((served) => {
      return {
        ...served,
        endpoint: Object.create(
          served.endpoint,
          Object.getOwnPropertyDescriptors({
            announceClose(...input: Parameters<typeof served.endpoint.announceClose>) {
              const announced = served.endpoint.announceClose(...input)
              draining()
              return announced
            }
          })
        )
      }
    })
    const options = {
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: { ...fixture.options.spawn.supervision, scheduler }
      }
    }
    try {
      await fixture.host.use(processPlugin(options))
      const outlet = fixture.host.process!
      await fixture.ready(fixture.handles[0]!)

      /** The actual old receipt remains captured so a stale call cannot select its successor. */
      const oldPeer = readRuntimeOutletConnection(outlet, 'child')!.peer
      const pending = outlet.request('child', 'p.f.request', 'hold', {
        idempotencyKey: 'old-request-fixture'
      })
      const outcome = Promise.allSettled([pending])
      expect(await outlet.request('child', 'p.f.request', 'count')).toMatchObject({ calls: 1 })
      const replacing = outlet
        .stop('child')
        .then(() => fixture.host.replace('child', processPlugin(options)))
      await drainStarted
      scheduler.advance(DEFAULT_DRAIN_MS)
      await replacing
      await fixture.ready()
      expect((await outcome)[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'REMOTE_RESULT_UNKNOWN' }
      })
      await fixture.handles[0]!.exited

      expect(await outlet.request('child', 'p.f.request', 'count')).toMatchObject({ calls: 0 })
      expect(() => oldPeer.request('p.f.request', 'old-proxy')).toThrow(
        expect.objectContaining({ code: 'REMOTE_CLOSED' })
      )
      expect(await outlet.request('child', 'p.f.request', 'count')).toMatchObject({ calls: 0 })
    } finally {
      await fixture.close()
    }
  })
  it.each(['stop-then-start', 'start-then-switch'] as const)(
    'reclaims a real failed description and permits a fresh replacement (%s)',
    async (strategy) => {
      /** Real child exits prove the failed candidate cannot retain a process or budget lease. */
      const fixture = nativeHostFixture('old')
      /** Call-through observes the genuine factory readiness Promise, not a fixture ready facade. */
      const preparing = vi.spyOn(runtimePeerModule, 'createRuntimePeer')

      const primary = createProcessError(RpcProcessErrorCode.hostInvalidOption)
      let endpoints = 0
      let entered!: () => void
      let fail!: () => void
      const describing = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        fail = resolve
      })
      fixture.observeEndpoint((served) => {
        const ordinal = ++endpoints
        return {
          ...served,
          endpoint: Object.create(
            served.endpoint,
            Object.getOwnPropertyDescriptors({
              async send<T>(...input: Parameters<IRpcEndpoint['send']>) {
                if (ordinal === 2 && input[1] === RemoteMethodName.runtimeDescribe) {
                  entered()
                  await gate
                  throw primary
                }
                return served.endpoint.send<T>(...input)
              }
            })
          )
        }
      })
      const options = {
        ...fixture.options
      }
      try {
        await fixture.host.use(processPlugin(options))
        const outlet = fixture.host.process!
        await fixture.ready(fixture.handles[0]!)

        const old = fixture.handles[0]!
        const candidate = processPlugin(options)
        const replacing =
          strategy === 'stop-then-start'
            ? outlet.stop('child').then(() => fixture.host.replace('child', candidate))
            : fixture.host.replace('child', candidate)
        const outcome = Promise.allSettled([replacing])
        await describing
        const readiness =
          strategy === 'stop-then-start'
            ? Promise.allSettled([preparing.mock.results[1]!.value])
            : undefined
        fail()
        const failed = (await outcome)[0]!
        expect(failed).toMatchObject({
          status: 'rejected',
          reason: { code: 'PLUGIN_INSTALL_FAILED' }
        })
        if (failed.status === 'rejected') expect(failed.reason.cause).toBe(primary)
        if (readiness)
          expect((await readiness)[0]).toMatchObject({ status: 'rejected', reason: primary })
        await fixture.handles[1]!.exited
        expect(fixture.options.spawn.supervision.budget!.inUse).toBe(
          strategy === 'start-then-switch' ? 1 : 0
        )
        if (strategy === 'start-then-switch') {
          expect(await outlet.request('child', 'p.f.request', 'still-old')).toMatchObject({
            pid: old.identity.pid
          })
        } else {
          await old.exited
          expect(() => outlet.request('child', 'p.f.request', 'probe')).toThrow(
            expect.objectContaining({ code: 'TARGET_UNKNOWN' })
          )
        }
        if (strategy === 'start-then-switch') await outlet.stop('child')
        await fixture.host.replace('child', processPlugin(options))
        await fixture.ready()
        expect(fixture.host.process).toBe(outlet)

        expect(await outlet.request('child', 'p.f.request', 'recovered')).toMatchObject({
          pid: fixture.handles[2]!.identity.pid
        })
      } finally {
        fail()
        try {
          await fixture.close()
        } finally {
          preparing.mockRestore()
        }
      }
    }
  )
})

/** Declarative registration only: each case owns its own runtime resources and mutable state. */
describe('process native budget and terminal governance', () => {
  it('invalidates a real size-one pool after old exit without taking it for replacement', async () => {
    const fixture = runtimeHostFixture()
    const deployment = fixture.options.spawn
    const budget = createUnitBudget({ kind: 'process', maxUnits: 3, scheduler: fixture.scheduler })
    const pool = createPrewarmPool({
      size: 1,
      id: 'host-pool',
      spec: deployment.supervision.spec,
      launcher: deployment.supervision.launcher,
      budget,
      scheduler: fixture.scheduler,
      report: fixture.report
    })
    const invalidate = vi.fn(() => {
      expect(fixture.order.some((event) => event.startsWith('exit:'))).toBe(true)
      expect(budget.inUse).toBeLessThanOrEqual(3)
      fixture.order.push('invalidate')
      pool.invalidate()
    })
    const take = vi.fn(() => pool.take())
    /** Prewarming belongs to the retained original process binding and supervisor, not bootstrap. */
    const binding = createSpawnProcessBinding(
      {
        ...deployment,
        supervision: { ...deployment.supervision, budget, prewarm: { ...pool, invalidate, take } }
      },
      fixture.report
    )
    try {
      await binding.supervisor.start()
      const initialTakes = take.mock.calls.length
      const oldLaunches = fixture.launch.mock.calls.length
      await binding.supervisor.replace()
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(take).toHaveBeenCalledTimes(initialTakes)
      expect(fixture.order.indexOf('invalidate')).toBeGreaterThan(
        fixture.order.findIndex((event) => event.startsWith('exit:'))
      )
      expect(fixture.launch.mock.calls.length).toBeGreaterThan(oldLaunches)
      expect(budget.inUse).toBeLessThanOrEqual(3)
    } finally {
      await binding.supervisor.dispose()
      await fixture.close()
      await pool.dispose()
    }
    expect(budget.inUse).toBe(0)
  })
  it('publishes the actual native replacement before the old process exits', async () => {
    const fixture = runtimeHostFixture()
    try {
      await fixture.host.use(fixture.plugin)
      const outlet = fixture.host.process!
      await fixture.host.replace('child', processPlugin(fixture.options))
      expect(fixture.host.process).toBe(outlet)
      expect(fixture.order).toEqual(['launch:1', 'launch:2', 'exit:1'])

      expect(
        readRuntimeOutletConnection(outlet, 'child')!
          .description!.methods.filter((method) => method.name.startsWith('p.f.'))
          .map((method) => method.name.slice('p.f.'.length))
      ).toEqual(['m'])
    } finally {
      await fixture.close()
    }
  })
  it.each([true, false])(
    'guards actual Host terminal commands and retains liquidation diagnostics (restart=%s)',
    async (recover) => {
      const fixture = hostFixture()
      if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
      /** Original governance observes the same real supervisor used by the lower remote owner. */
      const binding = createSpawnProcessBinding(
        {
          ...fixture.options.deployment,
          supervision: {
            ...fixture.options.deployment.supervision,
            restart: { mode: 'on-failure', maxRestarts: 0 }
          }
        },
        fixture.report
      )
      /** This retained owner supplies terminal counters, report scheduling and liquidation. */
      const resilience = createProcessResilience({
        scheduler: fixture.scheduler,
        report: fixture.report
      })
      /** Canonical managed Peer consumes this same actual native binding and drain policy. */
      const host = await createManagedRuntimePeer(
        { self: { name: 'parent', instanceId: 'parent' }, report: fixture.report },
        binding,
        (channel, endpoint) => binding.bindEndpoint(channel, endpoint)
      )
      /** Exact original registration owns its diagnostic tombstone independently of remote release. */
      const registration = resilience.attachRegistration(
        'terminal-host',
        {
          ownership: 'spawn-owned',
          health: binding.health,
          supervisor: binding.registrationSupervisor
        },
        { kind: 'standalone-host', release: host.close }
      )
      /** The same existing guard protects native commands after committed liquidation. */
      const guard = resilience.callGuard('terminal-host')
      const assertCommand = () =>
        guard.beforeDispatch({
          method: 'p.f.m',
          mode: 'request',
          generation: binding.supervisor.generation
        })
      try {
        await readManagedRuntimeHolder(host)!.prepareRebind(new AbortController().signal)
        fixture.crashes[0]!({ code: 1, signal: null })
        await settle()
        expect(registration.inspect()).toMatchObject({ state: 'terminal', unhandled: 1 })
        const frames = fixture.send.mock.calls.length
        for (let index = 0; index < 3; index++)
          expect(assertCommand).toThrow(expect.objectContaining({ code: 'PROCESS_TERMINAL_CALL' }))
        expect(fixture.send.mock.calls).toHaveLength(frames)
        if (recover) {
          expect(await registration.restart()).toMatchObject({ state: 'ready' })
          await readManagedRuntimeHolder(host)!.prepareRebind(new AbortController().signal)
          expect(registration.inspect()).toMatchObject({ unhandled: 0, state: 'ready' })
          await host.request('p.f.m')
        } else {
          for (const delay of [60_000, 240_000, 600_000]) {
            fixture.scheduler.advance(delay)
            await settle()
          }
          await vi.waitFor(() =>
            expect(registration.inspect()).toMatchObject({ liquidated: true, unhandled: 4 })
          )
          expect(
            fixture.report.mock.calls.filter(([error]) => error?.code === 'SUPERVISION_EXHAUSTED')
          ).toHaveLength(4)
          /**
           * Graceful actual ManagedRuntimePeer.close reports no failure; the removed facade's two
           * incidental REMOTE_CLOSED reports are not terminal-governance diagnostics.
           */
          for (const operation of [
            () => {
              assertCommand()
              return readManagedRuntimeHolder(host)!.prepareRebind(new AbortController().signal)
            },
            () => {
              assertCommand()
              return binding.supervisor.replace()
            },
            () => {
              assertCommand()
              return registration.restart()
            }
          ])
            expect(operation).toThrow(expect.objectContaining({ code: 'PROCESS_LIQUIDATED' }))
          expect(() => {
            assertCommand()
            return host.request('p.f.m')
          }).toThrow(expect.objectContaining({ code: 'PROCESS_LIQUIDATED' }))
          expect(fixture.launch).toHaveBeenCalledTimes(1)
        }
      } finally {
        await host.close()
        await registration.close()
        await resilience.close()
        await fixture.close()
      }
    }
  )
})

/** Declarative registration only: each case owns its own runtime resources and mutable state. */
describe('process native replacement publication and queued mutation', () => {
  it.each(['stop-then-start', 'start-then-switch'] as const)(
    'gates real Node replacement on describe and never replays installed plugins (%s)',
    async (strategy) => {
      /** A real endpoint is held only at its outbound describe boundary. */
      const fixture = nativeHostFixture('old')

      let allow!: () => void
      let entered!: () => void
      const held = new Promise<void>((resolve) => {
        allow = resolve
      })
      const describing = new Promise<void>((resolve) => {
        entered = resolve
      })
      let endpoints = 0
      fixture.observeEndpoint((served) => {
        const ordinal = ++endpoints
        return {
          ...served,
          endpoint: Object.create(
            served.endpoint,
            Object.getOwnPropertyDescriptors({
              async send<T>(...args: Parameters<IRpcEndpoint['send']>) {
                const [peer, method, params, context] = args
                if (ordinal === 2 && method === RemoteMethodName.runtimeDescribe) {
                  entered()
                  await held
                }
                return served.endpoint.send<T>(peer, method, params, context)
              }
            })
          )
        }
      })
      const options = {
        ...fixture.options
      }
      /** Both transitions retain the actual shared outlet while the candidate is unpublished. */
      let removeReadiness: (() => void) | undefined
      /** Cleanup joins the real transaction even when an earlier assertion rejects. */
      let replacementOutcome: Promise<PromiseSettledResult<unknown>[]> | undefined
      try {
        await fixture.host.use(processPlugin(options))
        const outlet = fixture.host.process!
        await fixture.ready(fixture.handles[0]!)

        const old = fixture.handles[0]!
        const spec = {
          ...fixture.options.spawn.supervision.spec,
          env: { inherit: [], set: { RPC_VALUE: 'new' } }
        }
        let ready = false
        const prepared = new Promise<void>((resolve) => {
          removeReadiness = outlet.on(RuntimeEventName.ready, () => {
            ready = true
            resolve()
          })
        })
        const candidate = processPlugin({
          ...options,
          spawn: { ...options.spawn, supervision: { ...options.spawn.supervision, spec } }
        })
        const replacing =
          strategy === 'stop-then-start'
            ? outlet.stop('child').then(() => fixture.host.replace('child', candidate))
            : fixture.host.replace('child', candidate)
        replacementOutcome = Promise.allSettled([replacing])
        await describing
        await Promise.resolve()
        if (strategy === 'stop-then-start') {
          await old.exited
          expect(ready).toBe(false)
          expect(() => outlet.request('child', 'p.f.request', 'probe')).toThrow(
            expect.objectContaining({ code: 'TARGET_UNKNOWN' })
          )
        } else {
          expect(process.kill(old.identity.pid!, 0)).toBe(true)

          expect(await outlet.request('child', 'p.f.request', 'old')).toMatchObject({
            pid: old.identity.pid,
            value: 'old'
          })
        }
        allow()
        await replacing
        await fixture.ready()
        expect(fixture.host.process).toBe(outlet)
        await prepared

        expect(await outlet.request('child', 'p.f.request', 'new')).toMatchObject({
          pid: fixture.handles[1]!.identity.pid,
          value: 'new'
        })
        await old.exited
      } finally {
        allow()
        removeReadiness?.()
        await replacementOutcome
        await fixture.close()
      }
    }
  )
  it('rejects a real overlapping candidate at a one-unit budget and preserves the old PID', async () => {
    const fixture = nativeHostFixture()
    const budget = createUnitBudget({
      kind: 'process',
      maxUnits: 1,
      overflow: 'reject',
      scheduler: systemScheduler
    })
    /** Both genuine definitions borrow the same one-unit native admission owner. */
    const options = {
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: {
          ...fixture.options.spawn.supervision,
          budget,
          restart: { mode: 'on-failure' as const, maxRestarts: 0 }
        }
      }
    }
    try {
      await fixture.host.use(processPlugin(options))
      await expect(fixture.host.replace('child', processPlugin(options))).rejects.toBeDefined()
      expect(fixture.handles).toHaveLength(1)
      expect(budget.inUse).toBe(1)
      const outlet = fixture.host.process!
      await fixture.ready(fixture.handles[0]!)

      expect(await outlet.request('child', 'p.f.request', 'live')).toMatchObject({
        pid: fixture.handles[0]!.identity.pid
      })
    } finally {
      await fixture.close()
    }
    expect(budget.inUse).toBe(0)
  })
  it('stops the old owned unit before launching and retains the same facade', async () => {
    const fixture = runtimeHostFixture()
    await fixture.host.use(fixture.plugin)
    const outlet = fixture.host.process!
    const oldGeneration = (await outlet.get('child')).unit
    const spec = { ...fixture.options.spawn.supervision.spec, args: ['replacement'] }
    /** Native readiness and callable directory publication are separate existing observations. */
    let removeReady: (() => void) | undefined
    const prepared = new Promise<void>((resolve) => {
      removeReady = outlet.on(RuntimeEventName.ready, () => resolve())
    })
    try {
      expect(await outlet.replace('child', spec)).toMatchObject({ kind: 'replaced' })
      expect(fixture.host.process).toBe(outlet)
      expect(fixture.order).toEqual(['launch:1', 'exit:1', 'launch:2'])
      expect(fixture.launch.mock.calls).toHaveLength(2)
      await prepared
      await vi.waitFor(async () => {
        const current = (await outlet.get('child')).unit
        expect(current).toHaveProperty('state', 'ready')
        expect(current).not.toEqual(oldGeneration)
      })
    } finally {
      removeReady?.()
      await fixture.close()
    }
  })
  it('holds old service until description, publishes once and queues every spec', async () => {
    const fixture = runtimeHostFixture()
    let complete!: () => void
    const described = new Promise<void>((resolve) => {
      complete = resolve
    })
    const send = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async (...args) => {
      const [_peer, method] = args
      if (method === 'migaia.remote.runtime.describe' && fixture.launch.mock.calls.length === 2)
        await described
      return send(...args)
    })
    await fixture.host.use(fixture.plugin)
    const outlet = fixture.host.process!
    const specA = { ...fixture.options.spawn.supervision.spec, args: ['A'] }
    const specB = { ...fixture.options.spawn.supervision.spec, args: ['B'] }
    /** The retained foundation queue owns caller ordering; Host lifecycle admission stays strict. */
    const mutations = createMutationQueue({ scheduler: fixture.scheduler })
    const first = mutations.enqueue(() =>
      fixture.host.replace(
        'child',
        processPlugin({
          ...fixture.options,
          spawn: {
            ...fixture.options.spawn,
            supervision: { ...fixture.options.spawn.supervision, spec: specA }
          }
        })
      )
    )
    const second = mutations.enqueue(() =>
      fixture.host.replace(
        'child',
        processPlugin({
          ...fixture.options,
          spawn: {
            ...fixture.options.spawn,
            supervision: { ...fixture.options.spawn.supervision, spec: specB }
          }
        })
      )
    )
    const outcomes = Promise.allSettled([first, second])
    expect(second).not.toBe(first)
    await vi.waitFor(() => expect(fixture.launch.mock.calls).toHaveLength(2))
    expect(fixture.terminate).not.toHaveBeenCalled()

    complete()
    try {
      await first
      expect(fixture.host.process).toBe(outlet)
      await second
      expect(fixture.host.process).toBe(outlet)
      expect(fixture.launch.mock.calls).toHaveLength(3)
      expect(fixture.order).toEqual(['launch:1', 'launch:2', 'exit:1', 'launch:3', 'exit:2'])
    } finally {
      complete()
      await outcomes
      await fixture.close()
    }
  })
  it('cancels a delayed candidate and refuses queued replacement without another launch', async () => {
    const fixture = runtimeHostFixture()
    const send = fixture.send.getMockImplementation()!
    /** The actual core endpoint honors cancellation; this neutral held-send fixture must too. */
    let candidateSignal: IAbortSignal | undefined

    fixture.observeEndpoint((served, _channel, signal) => {
      candidateSignal = signal
      return served
    })
    const options = fixture.options
    /** Release races a real describe boundary rather than an assumed number of microtasks. */
    let entered!: () => void
    const describing = new Promise<void>((resolve) => {
      entered = resolve
    })
    fixture.send.mockImplementation(async (...args) => {
      const [_peer, method] = args
      if (method === 'migaia.remote.runtime.describe' && fixture.launch.mock.calls.length > 1) {
        entered()
        return new Promise<never>((_resolve, reject) => {
          const signal = candidateSignal!
          const cancel = () => reject(signal.reason)
          signal.addEventListener('abort', cancel, { once: true })
          if (signal.aborted) cancel()
        })
      }
      return send(...args)
    })
    await fixture.host.use(processPlugin(options))
    /** Original queue callbacks consult actual Host admission when they reach the head. */
    const mutations = createMutationQueue({ scheduler: fixture.scheduler })
    const first = mutations.enqueue(() => fixture.host.replace('child', processPlugin(options)))
    const second = mutations.enqueue(() => fixture.host.replace('child', processPlugin(options)))
    const results = Promise.allSettled([first, second])
    await describing
    await fixture.close()
    const outcomes = await results
    expect(outcomes[0]).toMatchObject({ status: 'rejected' })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'HOST_DISPOSING' }
    })
    expect(fixture.launch.mock.calls).toHaveLength(2)
    expect(fixture.host.process).toBeUndefined()
  })
})
