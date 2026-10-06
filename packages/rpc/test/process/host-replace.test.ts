import { describe, expect, it, vi } from 'vitest'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture, runtimeHostFixture } from './fixtures/host-control.js'
import { nativeHostFixture } from './fixtures/host-native.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import * as processPeerModule from '../../src/process/peer.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { RuntimeEventName } from '../../src/remote/runtime-api/constants.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import { createUnitBudget } from '@migaia/supervision'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import { createPrewarmPool } from '@migaia/supervision/process'
import { parseProcessPluginDescriptor } from '../../src/process/plugin/descriptor.js'
import { readFileSync } from 'node:fs'
import { createProcessError } from '../../src/process/error.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import { DEFAULT_DRAIN_MS } from '../../src/process/resilience/constants.js'

/** Flush candidate cancellation and queued mutation continuations without changing time budgets. */
async function settle(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve()
}

describe('process Host replacement publication', () => {
  it('[A4] rejects a candidate released between ready and publication', async () => {
    /** The neutral native ports retain their actual supervisor and true Host install owner. */
    const fixture = runtimeHostFixture()
    /** Retain the genuine factory before observing the second prepared candidate only. */
    const original = processPeerModule.createProcessPeer
    /** Both calls construct genuine public Peers; no candidate state is held by this observer. */
    let constructions = 0
    /** Join the original Host release Promise instead of polling or constructing a close facade. */
    let releasing: ReturnType<typeof fixture.close> | undefined
    /** Release occurs after actual directory readiness, before the install continuation publishes. */
    const observer = vi
      .spyOn(processPeerModule, 'createProcessPeer')
      .mockImplementation((options) => {
        const preparing = original(options)
        if (++constructions !== 2) return preparing
        return preparing.then((peer) => {
          queueMicrotask(() => {
            releasing = fixture.close()
          })
          return peer
        })
      })
    try {
      await fixture.host.use(createProcessPlugin(fixture.options))
      const outlet = fixture.host.process!
      await expect(
        fixture.host.replace('child', createProcessPlugin(fixture.options))
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: { code: 'HOST_DISPOSING' } })
      await releasing
      expect(fixture.handles).toHaveLength(2)
      expect(() => outlet.request('child', RemoteMethodName.hostInspect, [])).toThrow(
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

  it('[A3] never resends an old sent idempotent request into the new real child', async () => {
    /** Real I/O retains production deadlines while the injected monotonic clock advances drain. */
    const fixture = nativeHostFixture('old')
    const scheduler = createManualScheduler()
    const original = fixture.options.endpointFactory
    let draining!: () => void
    const drainStarted = new Promise<void>((resolve) => {
      draining = resolve
    })
    const options = {
      ...fixture.options,
      spawn: {
        ...fixture.options.spawn,
        supervision: { ...fixture.options.spawn.supervision, scheduler }
      },
      endpointFactory: async (...args: Parameters<typeof original>) => {
        const served = await original(...args)
        return {
          ...served,
          endpoint: {
            ...served.endpoint,
            announceClose(...input: Parameters<typeof served.endpoint.announceClose>) {
              const announced = served.endpoint.announceClose(...input)
              draining()
              return announced
            }
          }
        }
      }
    }
    try {
      await fixture.host.use(createProcessPlugin(options))
      const outlet = fixture.host.process!
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      /** The actual old receipt remains captured so a stale call cannot select its successor. */
      const oldPeer = readRuntimeOutletConnection(outlet, 'child')!.peer
      const pending = outlet.request('child', 'p.request', 'hold', {
        idempotencyKey: 'old-request-fixture'
      })
      const outcome = Promise.allSettled([pending])
      expect(await outlet.request('child', 'p.request', 'count')).toMatchObject({ calls: 1 })
      const replacing = outlet
        .stop('child')
        .then(() => fixture.host.replace('child', createProcessPlugin(options)))
      await drainStarted
      scheduler.advance(DEFAULT_DRAIN_MS)
      await replacing
      expect((await outcome)[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'REMOTE_RESULT_UNKNOWN' }
      })
      await fixture.handles[0]!.exited
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      expect(await outlet.request('child', 'p.request', 'count')).toMatchObject({ calls: 0 })
      expect(() => oldPeer.request('p.request', 'old-proxy')).toThrow(
        expect.objectContaining({ code: 'REMOTE_CLOSED' })
      )
      expect(await outlet.request('child', 'p.request', 'count')).toMatchObject({ calls: 0 })
    } finally {
      await fixture.close()
    }
  })
  it.each(['stop-then-start', 'start-then-switch'] as const)(
    '[A3/A4] reclaims a real failed description and permits a fresh replacement (%s)',
    async (strategy) => {
      /** Real child exits prove the failed candidate cannot retain a process or budget lease. */
      const fixture = nativeHostFixture('old')
      /** Call-through observes the genuine factory readiness Promise, not a fixture ready facade. */
      const preparing = vi.spyOn(processPeerModule, 'createProcessPeer')
      const original = fixture.options.endpointFactory
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
      const options = {
        ...fixture.options,
        endpointFactory: async (...args: Parameters<typeof original>) => {
          const served = await original(...args)
          const ordinal = ++endpoints
          return {
            ...served,
            endpoint: {
              ...served.endpoint,
              async send<T>(...input: Parameters<IRpcEndpoint['send']>) {
                if (ordinal === 2 && input[1] === RemoteMethodName.runtimeDescribe) {
                  entered()
                  await gate
                  throw primary
                }
                return served.endpoint.send<T>(...input)
              }
            }
          }
        }
      }
      try {
        await fixture.host.use(createProcessPlugin(options))
        const outlet = fixture.host.process!
        await outlet.request('child', RemoteMethodName.hostUse, ['p'])
        const old = fixture.handles[0]!
        const candidate = createProcessPlugin(options)
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
          await outlet.request('child', RemoteMethodName.hostUse, ['p'])
          expect(await outlet.request('child', 'p.request', 'still-old')).toMatchObject({
            pid: old.identity.pid
          })
        } else {
          await old.exited
          expect(() => outlet.request('child', RemoteMethodName.hostUse, ['p'])).toThrow(
            expect.objectContaining({ code: 'TARGET_UNKNOWN' })
          )
        }
        if (strategy === 'start-then-switch') await outlet.stop('child')
        await fixture.host.replace('child', createProcessPlugin(options))
        expect(fixture.host.process).toBe(outlet)
        await outlet.request('child', RemoteMethodName.hostUse, ['p'])
        expect(await outlet.request('child', 'p.request', 'recovered')).toMatchObject({
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
  it('[A3] invalidates a real size-one pool after old exit without taking it for replacement', async () => {
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

  it('[A4] consumes a parsed Host descriptor and preserves its default switch strategy', async () => {
    const fixture = hostFixture()
    const vectors = JSON.parse(
      readFileSync(
        new URL('../../schema/vectors/process-plugin-descriptor.json', import.meta.url),
        'utf8'
      )
    )
    const base = vectors.cases.find((row: { id: string }) => row.id === 'host-spawn').value
    const descriptor = parseProcessPluginDescriptor({
      ...base,
      catalog: fixture.options.catalog,
      replaceStrategy: 'start-then-switch'
    })
    if (descriptor.target !== 'host') throw new Error('host descriptor required')
    expect(() =>
      parseProcessPluginDescriptor({ ...base, catalog: { wrong: fixture.options.catalog.p } })
    ).toThrow()
    const host = createProcessHost({
      ...fixture.options,
      catalog: descriptor.catalog,
      replaceStrategy: descriptor.replaceStrategy
    })
    try {
      await host.ready()
      expect(await host.replace()).toBe(host)
      expect(fixture.order).toEqual(['launch:1', 'launch:2', 'exit:1'])
      const features = await host.use('p')
      expect(Object.keys(features.f!)).toEqual(['m'])
    } finally {
      await host.release()
    }
  })
  it.each([true, false])(
    '[A3] guards actual Host terminal commands and retains liquidation diagnostics (restart=%s)',
    async (recover) => {
      const fixture = hostFixture()
      if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
      const host = createProcessHost({
        ...fixture.options,
        deployment: {
          ...fixture.options.deployment,
          supervision: {
            ...fixture.options.deployment.supervision,
            restart: { mode: 'on-failure', maxRestarts: 0 }
          }
        }
      })
      try {
        await host.ready()
        fixture.crashes[0]!({ code: 1, signal: null })
        await settle()
        expect(host.inspectRegistration()).toMatchObject({ state: 'terminal', unhandled: 1 })
        const frames = fixture.send.mock.calls.length
        for (const operation of [() => host.use('p'), () => host.unUse('p'), () => host.inspect()])
          await expect(operation()).rejects.toMatchObject({ code: 'PROCESS_TERMINAL_CALL' })
        expect(fixture.send.mock.calls).toHaveLength(frames)
        if (recover) {
          expect(await host.restart()).toMatchObject({ state: 'ready' })
          await host.ready()
          expect(host.inspectRegistration()).toMatchObject({ unhandled: 0, state: 'ready' })
          await host.use('p')
        } else {
          for (const delay of [60_000, 240_000, 600_000]) {
            fixture.scheduler.advance(delay)
            await settle()
          }
          expect(host.inspectRegistration()).toMatchObject({ liquidated: true, unhandled: 4 })
          expect(
            fixture.report.mock.calls.filter(([error]) => error?.code === 'SUPERVISION_EXHAUSTED')
          ).toHaveLength(4)
          expect(
            fixture.report.mock.calls.filter(([error]) => error?.code === 'REMOTE_CLOSED')
          ).toHaveLength(2)
          for (const operation of [() => host.ready(), () => host.replace(), () => host.restart()])
            expect(operation).toThrow(expect.objectContaining({ code: 'PROCESS_LIQUIDATED' }))
          expect(() => host.use('p')).toThrow(
            expect.objectContaining({ code: 'PROCESS_LIQUIDATED' })
          )
          expect(fixture.launch).toHaveBeenCalledTimes(1)
        }
      } finally {
        await host.release()
      }
    }
  )
  it.each(['stop-then-start', 'start-then-switch'] as const)(
    '[A3/A4] gates real Node replacement on describe and never replays installed plugins (%s)',
    async (strategy) => {
      /** A real endpoint is held only at its outbound describe boundary. */
      const fixture = nativeHostFixture('old')
      const original = fixture.options.endpointFactory
      let allow!: () => void
      let entered!: () => void
      const held = new Promise<void>((resolve) => {
        allow = resolve
      })
      const describing = new Promise<void>((resolve) => {
        entered = resolve
      })
      let endpoints = 0
      const options = {
        ...fixture.options,
        endpointFactory: async (
          channel: Parameters<typeof original>[0],
          signal: Parameters<typeof original>[1]
        ) => {
          const served = await original(channel, signal)
          const ordinal = ++endpoints
          return {
            ...served,
            endpoint: {
              ...served.endpoint,
              async send<T>(...args: Parameters<IRpcEndpoint['send']>) {
                const [peer, method, params, context] = args
                if (ordinal === 2 && method === RemoteMethodName.runtimeDescribe) {
                  entered()
                  await held
                }
                return served.endpoint.send<T>(peer, method, params, context)
              }
            }
          }
        }
      }
      /** Both transitions retain the actual shared outlet while the candidate is unpublished. */
      let removeReadiness: (() => void) | undefined
      /** Cleanup joins the real transaction even when an earlier assertion rejects. */
      let replacementOutcome: Promise<PromiseSettledResult<unknown>[]> | undefined
      try {
        await fixture.host.use(createProcessPlugin(options))
        const outlet = fixture.host.process!
        await outlet.request('child', RemoteMethodName.hostUse, ['p'])
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
        const candidate = createProcessPlugin({
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
          expect(() => outlet.request('child', RemoteMethodName.hostUse, ['p'])).toThrow(
            expect.objectContaining({ code: 'TARGET_UNKNOWN' })
          )
        } else {
          expect(process.kill(old.identity.pid!, 0)).toBe(true)
          await outlet.request('child', RemoteMethodName.hostUse, ['p'])
          expect(await outlet.request('child', 'p.request', 'old')).toMatchObject({
            pid: old.identity.pid,
            value: 'old'
          })
        }
        allow()
        await replacing
        expect(fixture.host.process).toBe(outlet)
        await prepared
        expect(await outlet.request('child', RemoteMethodName.hostInspect, [])).toMatchObject({
          plugins: []
        })
        await outlet.request('child', RemoteMethodName.hostUse, ['p'])
        expect(await outlet.request('child', 'p.request', 'new')).toMatchObject({
          pid: fixture.handles[1]!.identity.pid,
          value: 'new',
          resolutions: 1
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

  it('[A4] rejects a real overlapping candidate at a one-unit budget and preserves the old PID', async () => {
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
      await fixture.host.use(createProcessPlugin(options))
      await expect(
        fixture.host.replace('child', createProcessPlugin(options))
      ).rejects.toBeDefined()
      expect(fixture.handles).toHaveLength(1)
      expect(budget.inUse).toBe(1)
      const outlet = fixture.host.process!
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
      expect(await outlet.request('child', 'p.request', 'live')).toMatchObject({
        pid: fixture.handles[0]!.identity.pid
      })
    } finally {
      await fixture.close()
    }
    expect(budget.inUse).toBe(0)
  })

  it('[A3] stops the old owned unit before launching and retains the same facade', async () => {
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
      await outlet.request('child', RemoteMethodName.hostUse, ['p'])
    } finally {
      removeReady?.()
      await fixture.close()
    }
  })

  it('[A4] holds old service until description, publishes once and queues every spec', async () => {
    const fixture = hostFixture()
    let complete!: () => void
    const described = new Promise<void>((resolve) => {
      complete = resolve
    })
    const send = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async (peer, method) => {
      if (method === 'migaia.remote.runtime.describe' && fixture.launch.mock.calls.length === 2)
        await described
      return send(peer, method)
    })
    const host = createProcessHost({ ...fixture.options, replaceStrategy: 'start-then-switch' })
    await host.ready()
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const specA = { ...fixture.options.deployment.supervision.spec, args: ['A'] }
    const specB = { ...fixture.options.deployment.supervision.spec, args: ['B'] }
    const first = host.replace({ spec: specA })
    const second = host.replace({ spec: specB })
    expect(second).not.toBe(first)
    await settle()
    expect(fixture.launch.mock.calls).toHaveLength(2)
    expect(fixture.terminate).not.toHaveBeenCalled()
    await host.use('p')
    complete()
    try {
      expect(await first).toBe(host)
      expect(await second).toBe(host)
      expect(fixture.launch.mock.calls).toHaveLength(3)
      expect(fixture.order).toEqual(['launch:1', 'launch:2', 'exit:1', 'launch:3', 'exit:2'])
    } finally {
      await host.release()
    }
  })

  it('[A3/A4] cancels a delayed candidate and refuses queued replacement without another launch', async () => {
    const fixture = hostFixture()
    const send = fixture.send.getMockImplementation()!
    /** The actual core endpoint honors cancellation; this neutral held-send fixture must too. */
    let candidateSignal: IAbortSignal | undefined
    const factory = fixture.options.endpointFactory
    const options = {
      ...fixture.options,
      endpointFactory: async (...args: Parameters<typeof factory>) => {
        candidateSignal = args[1]
        return factory(...args)
      }
    }
    /** Release races a real describe boundary rather than an assumed number of microtasks. */
    let entered!: () => void
    const describing = new Promise<void>((resolve) => {
      entered = resolve
    })
    fixture.send.mockImplementation(async (peer, method) => {
      if (method === 'migaia.remote.runtime.describe' && fixture.launch.mock.calls.length > 1) {
        entered()
        return new Promise<never>((_resolve, reject) => {
          const signal = candidateSignal!
          const cancel = () => reject(signal.reason)
          signal.addEventListener('abort', cancel, { once: true })
          if (signal.aborted) cancel()
        })
      }
      return send(peer, method)
    })
    const host = createProcessHost(options)
    await host.ready()
    const first = host.replace()
    const second = host.replace()
    const results = Promise.allSettled([first, second])
    await describing
    await host.release()
    const outcomes = await results
    expect(outcomes[0]).toMatchObject({ status: 'rejected' })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'PROCESS_HOST_CLOSED' }
    })
    expect(fixture.launch.mock.calls).toHaveLength(2)
    expect(host.inspectRegistration()).toBeUndefined()
  })
})
