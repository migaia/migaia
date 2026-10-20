import { describe, expect, it } from 'vitest'
import {
  assembled,
  chainHas,
  fixture,
  lines,
  liveThreads,
  marker,
  processAlive,
  until
} from './helper.js'

describe('Tray instance admission and discovery', () => {
  it('admits two genuine units per runtime, filters discovery and physically removes them', async () => {
    /** Six declarations use one shared business Feature implementation. */
    const api = await fixture()
    /** Canonical family outlets reveal physical connection removal. */
    const { tray, host } = await assembled({ hosts: api.hosts })
    /** Process pids remain observable after records are removed. */
    const pids: number[] = []
    /** Native Worker ids independently establish absence of recursive child spawning. */
    const before = await liveThreads()
    try {
      for (const definition of api.hosts)
        for (let index = 0; index < 2; index += 1) {
          /** Native parent spawn admission produces one remote per record. */
          const remote = await tray.spawn(definition.name, {
            id: `${definition.runtime}-${index}`,
            config: { index }
          })
          expect(await remote.request('node.svc.hello')).toMatchObject({
            initCount: 1,
            config: { validated: true }
          })
          if (definition.runtime === 'process')
            pids.push((await remote.request('node.svc.hello')).pid)
        }
      expect(tray.list({ runtime: 'thread' })).toHaveLength(2)
      expect(tray.list({ host: 'node-pr' })).toHaveLength(2)
      expect(tray.list({ state: 'ready' })).toHaveLength(6)
      expect((await liveThreads()).length - before.length).toBe(2)
      expect(await tray.get('thread-0')).toMatchObject({
        state: 'ready',
        unit: { generation: expect.any(Number) },
        generation: expect.any(Number)
      })
      await expect(tray.get('missing')).rejects.toMatchObject({ code: 'TRAY_INSTANCE_UNKNOWN' })
      await expect(tray.spawn('absent', { id: 'absent' })).rejects.toMatchObject({
        code: 'TRAY_HOST_UNKNOWN'
      })
      await expect(tray.spawn('node-co', { id: 'coroutine-0' })).rejects.toMatchObject({
        code: 'TRAY_INSTANCE_DUPLICATE'
      })
      for (const record of tray.list()) await tray.remove(record.id)
      expect(tray.list()).toEqual([])
      for (const runtime of ['coroutine', 'thread', 'process'])
        expect(await (host[runtime]?.list() ?? [])).toEqual([])
      expect(await liveThreads()).toEqual(before)
      for (const pid of pids)
        await until(
          () => processAlive(pid),
          (alive) => !alive
        )
    } finally {
      await tray.dispose()
    }
    await expect(tray.spawn('node-co', { id: 'after' })).rejects.toMatchObject({
      code: 'TRAY_DISPOSED'
    })
  }, 30000)

  it('rejects every named non-portable config before admitting a connection', async () => {
    /** Deliberate cycle exercises the canonical portability owner. */
    const cyclic: any = {}
    cyclic.self = cyclic
    /** Config failures are independent examples from the required acceptance matrix. */
    const values = [
      { u: undefined },
      new Date(),
      () => undefined,
      cyclic,
      1n,
      new Map(),
      new Set(),
      Number.NaN
    ]
    /** Genuine branded default-runtime host is the target of failed admissions. */
    const api = await fixture()
    /** The existing internal outlet exposes whether validation happened before installation. */
    const { tray, host } = await assembled({ hosts: [api.nodeCo] })
    try {
      for (const config of values) {
        await expect(tray.spawn('node-co', { id: 'invalid', config })).rejects.toMatchObject({
          source: '@migaia/tray',
          code: 'TRAY_VALUE_NOT_PORTABLE',
          cause: expect.anything()
        })
        expect(tray.list()).toEqual([])
        expect(await (host.coroutine?.list() ?? [])).toEqual([])
      }
    } finally {
      await tray.dispose()
    }
  })

  it('retains the primary init failure and reports rollback cleanup failure without a leftover unit', async () => {
    /** File receives genuine child reports from PluginHost rollback. */
    const reportMarker = marker('rollback')
    /** Parent report list observes only the actual runtime reporter. */
    const reports: unknown[] = []
    /** Business failure occurs inside the child factory or install transaction. */
    const api = await fixture()
    /** Canonical coroutine outlet remains empty after both failed admissions. */
    const { tray, host } = await assembled({
      hosts: [api.faulty, api.nodeCo],
      report: (error: unknown) => reports.push(error)
    })
    try {
      await expect(tray.spawn('faulty', { id: 'factory' })).rejects.toMatchObject({
        source: '@migaia/tray',
        code: 'TRAY_INSTANCE_START_FAILED',
        cause: expect.anything()
      })
      /** Captures the thrown boundary while retaining native primary/cause classification. */
      const failure = await tray
        .spawn('node-co', {
          id: 'rollback',
          config: { rollbackFail: true, cleanupFail: true, reportMarker }
        })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'TRAY_INSTANCE_START_FAILED' })
      expect(chainHas(failure, 'INIT_FAILED')).toBe(true)
      await until(
        () =>
          reports.some((error) => chainHas(error, 'CLEANUP_FAILED')) ||
          lines(reportMarker).some((line) => line.includes('CLEANUP_FAILED')),
        Boolean
      )
      expect(tray.list()).toEqual([])
      expect(await (host.coroutine?.list() ?? [])).toEqual([])
    } finally {
      await tray.dispose()
    }
  }, 15000)

  it.each([0, 1, 2])(
    'runtime %i removes pending install and pending init without a stale ready write',
    async (index) => {
      /** Config marker confirms init has begun before the second remove. */
      const initMarker = marker('pending-init')
      /** Branded declaration selects a real native runtime. */
      const api = await fixture()
      /** Pending admissions stay owned by the same real registry. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      try {
        /** Rejection handler attaches before removal can reject this admission. */
        const installing = tray
          .spawn(api.hosts[index].name, { id: 'installing' })
          .catch((error: unknown) => error)
        await tray.remove('installing')
        expect(await installing).toMatchObject({ code: 'TRAY_INSTANCE_START_FAILED' })
        /** The business install delay is a real PluginHost transaction, not a fake connection. */
        const initializing = tray
          .spawn(api.hosts[index].name, {
            id: 'initializing',
            config: { initDelayMs: 200, initMarker }
          })
          .catch((error: unknown) => error)
        await until(
          () => lines(initMarker).length,
          (count) => count === 1
        )
        await tray.remove('initializing')
        expect(await initializing).toMatchObject({ code: 'TRAY_INSTANCE_START_FAILED' })
        expect(tray.list()).toEqual([])
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i disposes a pending init with TRAY_DISPOSED',
    async (index) => {
      /** Init marker proves disposal overlaps the child's actual install transaction. */
      const initMarker = marker('dispose-init')
      /** Runtime source remains the shared fixture DSL. */
      const api = await fixture()
      /** The pending admission belongs to this disposable parent. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      /** Rejection is observed immediately to avoid a fixture-created unhandled rejection. */
      const spawning = tray
        .spawn(api.hosts[index].name, { id: 'pending', config: { initDelayMs: 200, initMarker } })
        .catch((error: unknown) => error)
      await until(
        () => lines(initMarker).length,
        (count) => count === 1
      )
      await tray.dispose()
      expect(await spawning).toMatchObject({ code: 'TRAY_DISPOSED' })
      expect(() => tray.list()).toThrowError(expect.objectContaining({ code: 'TRAY_DISPOSED' }))
    },
    30000
  )
})
