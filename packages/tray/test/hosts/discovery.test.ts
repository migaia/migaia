import { describe, expect, it } from 'vitest'
import { fixture } from './helper.js'

describe('Tray discovery', () => {
  it('filters all six ready native instances by runtime, host and state and merges unit detail', async () => {
    /** The shared module defines one genuine host for each supported runtime. */
    const api = await fixture()
    /** Six admissions remain independently discoverable. */
    const tray = api.createTray({ hosts: api.hosts })
    try {
      for (const definition of api.hosts)
        for (let index = 0; index < 2; index += 1)
          await tray.spawn(definition.name, { id: `${definition.runtime}-${index}` })
      expect(tray.list({ runtime: 'thread' }).map((record: any) => record.id)).toEqual([
        'thread-0',
        'thread-1'
      ])
      expect(tray.list({ host: 'node-pr' }).map((record: any) => record.id)).toEqual([
        'process-0',
        'process-1'
      ])
      expect(tray.list({ state: 'ready' })).toHaveLength(6)
      /** Native unit detail and public numeric generation must describe the same running unit. */
      const detail = await tray.get('process-0')
      expect(detail).toMatchObject({
        host: 'node-pr',
        runtime: 'process',
        state: 'ready',
        unit: { generation: expect.any(Number) }
      })
      expect(detail.generation).toBe(detail.unit.generation)
      await expect(tray.get('missing')).rejects.toMatchObject({
        source: '@migaia/tray',
        code: 'TRAY_INSTANCE_UNKNOWN'
      })
    } finally {
      await tray.dispose()
    }
  }, 30000)
})
