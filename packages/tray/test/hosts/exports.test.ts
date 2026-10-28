import { describe, expect, it } from 'vitest'
import { fixture } from './helper.js'

describe('Tray public boundary and lifecycle events', () => {
  it('exports routing capabilities and registered mesh diagnostics', async () => {
    /** The source package root exercises the public consumer boundary. */
    const api = await fixture()
    for (const name of ['defineRoutingPolicy', 'roundRobin', 'leastInFlight'])
      expect(api[name]).toBeDefined()
    expect('defineLoadBalanceStrategy' in api).toBe(false)
    for (const code of [
      'TRAY_ROUTING_INVALID',
      'TRAY_ROUTING_UNKNOWN',
      'TRAY_HOST_UNAVAILABLE',
      'TRAY_TOPIC_INVALID'
    ])
      expect(Object.values(api.TrayErrorCode)).toContain(code)
  })
  it('exposes the complete instances runtime API and coded messages', async () => {
    /** Source root exercises the same public contract as native Node fixtures. */
    const api = await fixture()
    for (const symbol of [
      'defineTrayHost',
      'createTray',
      'serveTrayHost',
      'defineRoutingPolicy',
      'TrayInstanceState',
      'TrayInstanceEvent'
    ])
      expect(api[symbol]).toBeDefined()
    expect('trayClient' in api).toBe(false)
    expect(Object.keys(api).some((name) => /^(emit|publishInstanceEvent|trigger)/.test(name))).toBe(
      false
    )
    /** Package-owned errors remain the one runtime constructor and canonical code owner. */
    const errorsUrl = new URL('../../src/errors.ts', import.meta.url).href
    /** Canonical table is consumed directly rather than copied into the fixture. */
    const codesUrl = new URL('../../src/error-code.ts', import.meta.url).href
    /** Runtime constructors must provide non-placeholder registered messages for every added code. */
    const errors = await import(errorsUrl)
    /** Unique semantic code values are declared only in this existing owner. */
    const codes = Object.values((await import(codesUrl)).TrayErrorCode)
    for (const code of [
      'TRAY_HOST_INVALID',
      'TRAY_HOST_UNKNOWN',
      'TRAY_HOST_MISMATCH',
      'TRAY_RESERVED_NAME',
      'TRAY_VALUE_NOT_PORTABLE',
      'TRAY_INSTANCE_DUPLICATE',
      'TRAY_INSTANCE_UNKNOWN',
      'TRAY_INSTANCE_NOT_READY',
      'TRAY_INSTANCE_START_FAILED',
      'TRAY_PATH_NOT_EXPOSED',
      'TRAY_CHILD_STATE_INVALID',
      'TRAY_DISPOSED',
      'TRAY_ROUTING_INVALID'
    ]) {
      expect(codes).toContain(code)
      /** Message generation uses the same code registry as production throw sites. */
      const error = errors.createTrayError(code)
      expect(error).toMatchObject({ source: 'tray', code })
      expect(error.message.length).toBeGreaterThan(0)
      expect(error.message).not.toBe(code)
    }
    expect(() => api.createTray({ entries: [] })).toThrowError(
      expect.objectContaining({ code: 'TRAY_HOST_INVALID' })
    )
  })

  it('freezes lifecycle records before listeners and watch, reports listener failure and preserves event order', async () => {
    /** A lifecycle mutation attempt must not affect any later observer. */
    const reports: unknown[] = []
    /** Read-only API and child Feature use the same plain coroutine host. */
    const api = await fixture()
    /** No method on this frozen public value emits lifecycle events. */
    const tray = api.createTray({
      hosts: [api.nodeCo],
      report: (error: unknown) => reports.push(error)
    })
    expect(Object.isFrozen(tray)).toBe(true)
    expect('emit' in tray).toBe(false)
    /** First listener tries to change the exact record shared with later readers. */
    /** These exact native TypeErrors must remain reachable through the report's AggregateError. */
    const mutations: unknown[] = []
    tray.on('ready', (event: any) => {
      try {
        event.id = 'changed'
      } catch (error) {
        mutations.push(error)
        throw error
      }
    })
    /** Later listener must retain the original immutable identity. */
    const seen: any[] = []
    for (const event of Object.values(api.TrayInstanceEvent))
      tray.on(event, (value: any) => seen.push(value))
    /** Native lifecycle stream sees the same frozen events in the same publication order. */
    const watched: any[] = []
    /** Watch is the existing iterator owner, not a test event queue. */
    const watcher = tray.watch()
    /** Reader ends at removal so it never depends on a test timeout for normal completion. */
    const reading = (async () => {
      for await (const event of watcher) {
        watched.push(event)
        if (event.event === 'removed') break
      }
    })()
    try {
      /** Child introspection verifies deps.tray carries no lifecycle trigger. */
      const remote = await tray.spawn('node-co', { id: 'immutable' })
      expect(await remote.request('node.svc.hello')).toMatchObject({ hasEmit: false })
      await tray.restart('immutable')
      await tray.stop('immutable')
      await tray.remove('immutable')
      await reading
      expect(seen.map((event) => event.event)).toEqual([
        'spawned',
        'ready',
        'restarting',
        'ready',
        'stopped',
        'removed'
      ])
      expect(watched.map((event) => event.event)).toEqual(seen.map((event) => event.event))
      expect(seen.every((event) => event.id === 'immutable' && Object.isFrozen(event))).toBe(true)
      expect(watched.every((event) => event.id === 'immutable' && Object.isFrozen(event))).toBe(
        true
      )
      expect(mutations).toHaveLength(2)
      expect(mutations.every((error) => error instanceof TypeError)).toBe(true)
      for (const original of mutations)
        expect(
          reports.some((error: any) => error === original || error?.errors?.includes(original))
        ).toBe(true)
    } finally {
      await watcher.return?.()
      await tray.dispose()
    }
  }, 30000)
})
