import { describe, expect, it, vi } from 'vitest'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture } from './fixtures/host-control.js'
import { nativeHostOptions } from './fixtures/host-native.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createPrewarmPool } from '@migaia/supervision/process'
import { parseProcessPluginDescriptor } from '../../src/process/plugin/descriptor.js'
import { readFileSync } from 'node:fs'

/** Flush candidate cancellation and queued mutation continuations without changing time budgets. */
async function settle(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve()
}

describe('process Host replacement publication', () => {
  it('[A3] invalidates a real size-one pool after old exit without taking it for replacement', async () => {
    const fixture = hostFixture()
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const deployment = fixture.options.deployment
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
    const host = createProcessHost({
      ...fixture.options,
      deployment: {
        ...deployment,
        supervision: { ...deployment.supervision, budget, prewarm: { ...pool, invalidate, take } }
      }
    })
    try {
      await host.ready()
      const initialTakes = take.mock.calls.length
      const oldLaunches = fixture.launch.mock.calls.length
      await host.replace()
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(take).toHaveBeenCalledTimes(initialTakes)
      expect(fixture.order.indexOf('invalidate')).toBeGreaterThan(
        fixture.order.findIndex((event) => event.startsWith('exit:'))
      )
      expect(fixture.launch.mock.calls.length).toBeGreaterThan(oldLaunches)
      expect(budget.inUse).toBeLessThanOrEqual(3)
    } finally {
      await host.release()
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
      const fixture = nativeHostOptions('old')
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
      const host = createProcessHost({
        ...fixture.options,
        endpointFactory: async (channel, signal) => {
          const served = await original(channel, signal)
          const ordinal = ++endpoints
          return {
            ...served,
            endpoint: {
              ...served.endpoint,
              async send<T>(...args: Parameters<IRpcEndpoint['send']>) {
                const [peer, method, params, context] = args
                if (ordinal === 2 && method === RemoteMethodName.describe) {
                  entered()
                  await held
                }
                return served.endpoint.send<T>(peer, method, params, context)
              }
            }
          }
        }
      })
      try {
        await host.ready()
        await host.use('p')
        if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
        const old = fixture.handles[0]!
        const spec = {
          ...fixture.options.deployment.supervision.spec,
          env: { inherit: [], set: { RPC_VALUE: 'new' } }
        }
        const replacing = host.replace({ spec, strategy })
        await describing
        let ready = false
        const readiness = host.ready().then(() => {
          ready = true
        })
        await Promise.resolve()
        if (strategy === 'stop-then-start') {
          await old.exited
          expect(ready).toBe(false)
          await expect(host.use('p')).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
        } else {
          expect(process.kill(old.identity.pid!, 0)).toBe(true)
          const feature = await host.use('p')
          expect(await feature.f!.request!(['old'])).toMatchObject({
            pid: old.identity.pid,
            value: 'old'
          })
        }
        allow()
        expect(await replacing).toBe(host)
        await readiness
        expect(await host.inspect()).toMatchObject({ plugins: [] })
        const fresh = await host.use('p')
        expect(await fresh.f!.request!(['new'])).toMatchObject({
          pid: fixture.handles[1]!.identity.pid,
          value: 'new',
          resolutions: 1
        })
        await old.exited
      } finally {
        allow()
        await host.release()
      }
    }
  )

  it('[A4] rejects a real overlapping candidate at a one-unit budget and preserves the old PID', async () => {
    const fixture = nativeHostOptions()
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const budget = createUnitBudget({
      kind: 'process',
      maxUnits: 1,
      overflow: 'reject',
      scheduler: systemScheduler
    })
    const host = createProcessHost({
      ...fixture.options,
      deployment: {
        ...fixture.options.deployment,
        supervision: {
          ...fixture.options.deployment.supervision,
          budget,
          restart: { mode: 'on-failure', maxRestarts: 0 }
        }
      }
    })
    try {
      await host.ready()
      await expect(host.replace({ strategy: 'start-then-switch' })).rejects.toBeDefined()
      expect(fixture.handles).toHaveLength(1)
      expect(budget.inUse).toBe(1)
      const feature = await host.use('p')
      expect(await feature.f!.request!(['live'])).toMatchObject({
        pid: fixture.handles[0]!.identity.pid
      })
    } finally {
      await host.release()
    }
    expect(budget.inUse).toBe(0)
  })

  it('[A3] stops the old owned unit before launching and retains the same facade', async () => {
    const fixture = hostFixture()
    const host = createProcessHost(fixture.options)
    await host.ready()
    const oldId = host.inspectRegistration()?.id
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const spec = { ...fixture.options.deployment.supervision.spec, args: ['replacement'] }
    try {
      expect(await host.replace({ spec })).toBe(host)
      expect(fixture.order).toEqual(['launch:1', 'exit:1', 'launch:2'])
      expect(fixture.launch.mock.calls).toHaveLength(2)
      expect(host.inspectRegistration()?.id).not.toBe(oldId)
      await host.use('p')
    } finally {
      await host.release()
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
      if (method === 'migaia.remote.describe' && fixture.launch.mock.calls.length === 2)
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
      if (method === 'migaia.remote.describe' && fixture.launch.mock.calls.length > 1) {
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
