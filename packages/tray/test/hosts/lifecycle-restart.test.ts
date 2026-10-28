import { TrayInternal } from '../../src/hosts/constants.ts'
import { describe, expect, it, vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { assembled, chainHas, fixture, marker, until } from './helper.ts'

describe('Tray lifecycle management', () => {
  it('publishes real RPC exit before Tray restarting and reads the deferred supervision snapshot', async () => {
    /** Longer native backoff holds the restart state long enough for its own event read. */
    const api = await fixture()
    /** A genuine process exit proves the cross-realm outlet event path. */
    const definition = api.defineTrayHost({
      ...api.nodePr,
      supervisor: { restart: { initialDelayMs: 500 } }
    })
    /** Existing internal outlet supplies the first event in the required order. */
    const { tray, host } = await assembled({ hosts: [definition] })
    /** Synchronous event order is independent from later polling. */
    const order: string[] = []
    /** The Tray listener reads the public snapshot immediately when restarting is emitted. */
    const snapshots: Promise<any>[] = []
    try {
      /** Child crash is initiated only through deps.tray.exit. */
      const remote = await tray.spawn(definition.name, { id: 'timeline' })
      host[`${TrayInternal.namespacePrefix}timeline`].members.on('exit', () =>
        order.push('rpc-exit')
      )
      tray.on('restarting', () => {
        order.push('tray-restarting')
        snapshots.push(tray.get('timeline'))
      })
      await remote.notify('node.svc.exitCrash', undefined)
      await until(
        () => snapshots.length,
        (count) => count === 1
      )
      expect(order.slice(0, 2)).toEqual(['rpc-exit', 'tray-restarting'])
      expect(await snapshots[0]).toMatchObject({ state: 'restarting' })
      await until(
        () => tray.list()[0],
        (record: any) => record.state === 'ready'
      )
      /** Replacement overtakes later exit snapshots only through the existing queue. */
      const replaced = await tray.replace('timeline', { config: { label: 'replace' } })
      expect(await tray.get('timeline')).toMatchObject({
        generation: replaced.generation,
        state: replaced.state,
        config: replaced.config
      })
      /** Removed admissions ignore subsequent native exit events. */
      await tray.remove('timeline')
      /** Captured event count may not change when the removed unit settles. */
      const count = order.length
      await Promise.resolve()
      expect(order.length).toBe(count)
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it('drops a deferred old exit snapshot after a newer process replace commits', async () => {
    /** Tray's existing accessor reads the actual RPC outlet without creating another facade owner. */
    const runtimeUrl = new URL('../../src/hosts/runtime.ts', import.meta.url).href
    /** This exact package module is also consumed by the parent registry. */
    const owner = await import(runtimeUrl)
    /** Original accessor remains the sole runtime-family selector. */
    const original = owner.membersOf
    /** Only this assembled parent gets a held read; child construction stays unchanged. */
    let parent: any
    /** Only the exit snapshot is held; background and manual reads remain unmodified. */
    let armed = false
    /** Test barrier keeps a real old snapshot outstanding while a real replacement finishes. */
    let release!: () => void
    /** First captured exit read proves the old native generation was actually sampled. */
    let captured!: () => void
    /** Existing inspector promise retains its original receipt rather than manufacturing a detail. */
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Parent observes when the canonical deferred exit inspector reaches the hold point. */
    const sampled = new Promise<void>((resolve) => {
      captured = resolve
    })
    /** Read instrumentation delegates every operation to the original canonical outlet. */
    const observing = vi.spyOn(owner, 'membersOf').mockImplementation((...args: unknown[]) => {
      /** Dynamic module instrumentation receives the unchanged native helper arguments. */
      const [actualHost, id] = args
      /** The original facade keeps its brands, private slot and native receipt ownership. */
      const members = original(actualHost, id)
      if (actualHost !== parent) return members
      return {
        ...members,
        get: async (...args: any[]) => {
          /** Only the first old-generation exit read waits behind this test barrier. */
          const hold = armed
          armed = false
          /** Real get captures supervision before its real native resources sampler awaits. */
          const snapshot = await members.get(...args)
          if (hold) {
            captured()
            await blocked
          }
          return snapshot
        }
      }
    })
    /** Process DSL uses native on-failure restart with its existing 250 ms backoff. */
    const api = await fixture()
    /** Actual parent outlet, not a cloned facade, drives this race. */
    const { tray, host } = await assembled({ hosts: [api.nodePr] })
    parent = host
    try {
      /** First generation becomes ready through ordinary spawn and init. */
      const remote = await tray.spawn('node-pr', { id: 'late' })
      /** Late snapshot belongs only to this old unit generation. */
      const initial = (await tray.get('late')).generation
      host[`${TrayInternal.namespacePrefix}late`].members.on('exit', (event: any) => {
        if (event.generation === initial) armed = true
      })
      await remote.notify('node.svc.exitCrash', undefined)
      await sampled
      await until(
        () => tray.list()[0],
        (record: any) => record.state === 'ready' && record.generation > initial
      )
      /** New manual generation commits before the old inspector promise is released. */
      const replaced = await tray.replace('late', { config: { label: 'new' } })
      release()
      await delay(0)
      expect(await tray.get('late')).toMatchObject({
        state: 'ready',
        generation: replaced.generation,
        config: replaced.config
      })
    } finally {
      release()
      await tray.dispose()
      observing.mockRestore()
      vi.restoreAllMocks()
    }
  }, 30000)

  it('returns a successful replace and then a failed startup restart in the same queue order', async () => {
    /** The second queued entry sees this file only after the first entry's new init writes it. */
    const launchFailureMarker = marker('queued-start-failure')
    /** Native startup diagnostic remains available on the failed result's original cause. */
    const reports: unknown[] = []
    /** One existing directly Node-invoked entry supplies a real launch-side failure. */
    const api = await fixture()
    /** Strict startup failure enters terminal immediately rather than adding background retries. */
    const definition = api.defineTrayHost({
      ...api.nodePr,
      entry: new URL('./fixtures/restart-failure-entry.mjs', import.meta.url),
      supervisor: { restart: { mode: 'never' } },
      sandbox: {
        name: 'launch-marker',
        wrap: (command: any) => ({
          ...command,
          command: '/usr/bin/env',
          args: [`TRAY_LAUNCH_FAILURE=${launchFailureMarker}`, command.command, ...command.args]
        })
      }
    })
    /** Both public calls use the same existing per-record limiter. */
    const tray = api.createTray({
      hosts: [definition],
      report: (error: unknown) => reports.push(error)
    })
    try {
      await tray.spawn(definition.name, { id: 'outcomes', config: { label: 'old' } })
      /** This snapshot belongs to the last generation before the overlapping operations. */
      const generation = (await tray.get('outcomes')).generation
      /** First entry installs successfully and commits a config that breaks the next launch. */
      const replacing = tray.replace('outcomes', { config: { label: 'new', launchFailureMarker } })
      /** Second entry is admitted before replace resolves, and must return its own failed result. */
      const restarting = tray.restart('outcomes').catch((error: unknown) => error)
      /** Success may not be replaced by the following entry's terminal result. */
      const replaced = await replacing
      expect(replaced).toMatchObject({
        state: 'ready',
        generation: generation + 1,
        config: { label: 'new' }
      })
      expect(await restarting).toMatchObject({
        code: 'TRAY_INSTANCE_START_FAILED',
        cause: expect.anything()
      })
      expect(await tray.get('outcomes')).toMatchObject({ state: 'failed', config: replaced.config })
      expect(reports.length).toBeGreaterThan(0)
    } finally {
      await tray.dispose()
    }
  }, 30000)

  it('background process relaunch failures reach terminal without another Tray call', async () => {
    /** First init creates this launch-side marker for every subsequent process generation. */
    const launchFailureMarker = marker('launch-failure')
    /** The original supervision report must explain terminal exhaustion. */
    const reports: unknown[] = []
    /** Native process entry performs the next-launch failure before a handle becomes ready. */
    const api = await fixture()
    /** Wrapper supplies launch state only to the fixture, without a production crash hook. */
    const definition = api.defineTrayHost({
      ...api.nodePr,
      entry: new URL('./fixtures/restart-failure-entry.mjs', import.meta.url),
      sandbox: {
        name: 'launch-marker',
        wrap: (command: any) => ({
          ...command,
          command: '/usr/bin/env',
          args: [`TRAY_LAUNCH_FAILURE=${launchFailureMarker}`, command.command, ...command.args]
        })
      },
      supervisor: { restart: { initialDelayMs: 1 } }
    })
    /** No management call is made after the first crash. */
    const tray = api.createTray({
      hosts: [definition],
      report: (error: unknown) => reports.push(error)
    })
    try {
      /** First process serves normally and writes its next-launch flag during init. */
      const remote = await tray.spawn(definition.name, {
        id: 'relaunch',
        config: { launchFailureMarker }
      })
      await remote.notify('node.svc.exitCrash', undefined)
      await until(
        () => tray.list()[0],
        (record: any) => record.state === 'failed',
        30000
      )
      expect(reports.some((error) => chainHas(error, 'SUPERVISION_EXHAUSTED'))).toBe(true)
    } finally {
      await tray.dispose()
    }
  }, 40000)

  it('resubscribes a recreated thread family before crash re-init', async () => {
    /** Removing the last native Worker removes its existing family outlet. */
    const api = await fixture()
    /** Family recreation must attach fresh lifecycle subscriptions. */
    const tray = api.createTray({ hosts: [api.nodeTh] })
    try {
      await tray.spawn('node-th', { id: 'first' })
      await tray.remove('first')
      /** This is a new native runtime family outlet, not the retired object. */
      const remote = await tray.spawn('node-th', { id: 'second' })
      /** Captured generation identifies successful background re-init. */
      const generation = (await tray.get('second')).generation
      await remote.notify('node.svc.exitCrash', undefined)
      await until(
        () => tray.list()[0],
        (record: any) => record.state === 'ready' && record.generation > generation
      )
      expect(await remote.request('node.svc.hello')).toMatchObject({ initCount: 1 })
    } finally {
      await tray.dispose()
    }
  }, 30000)
})
