import { hashBytes } from '@migaia/part-contract'
import { describe, expect, it, vi } from 'vitest'
import {
  answer,
  blueprint,
  bytesOf,
  codes,
  control,
  memoryCache,
  moduleRef,
  remoteHost,
  snapshotText
} from './support.ts'

/** Snapshot text of a tag whose order blueprint shows `label` and uses the remote notify effect. */
function version(tag: string, label: string): string {
  return snapshotText({
    tag,
    blueprints: [blueprint('orders', label, { click: 'notify@1' })],
    definitions: ['button@1', 'notify@1'],
    modules: [moduleRef('remote', 'effects/notify.ts')]
  })
}

describe('fetch, cache, revalidation and offline start', () => {
  it('serves from cache, revalidates with ETag, shares concurrent revalidations and starts offline', async () => {
    /** Shared cache backend of the three hosts. */
    const cache = await memoryCache()
    /** V1 text. */
    const v1 = version('v1', 'v1')
    await answer('prod', { snapshot: v1 })
    /** First host: empty cache. */
    const first = await remoteHost({ cache })
    await first.remote.ready()
    first.host.mount({}, 'orders')
    expect(first.screen.label('orders')).toBe('v1')
    expect(first.remote.current()).toEqual({ tag: 'v1', snapshot: await hashBytes(bytesOf(v1)) })

    await answer('prod', { status: 500 })
    /** Second host: cached v1 while the service fails. */
    const second = await remoteHost({ cache })
    await second.remote.ready()
    second.host.mount({}, 'orders')
    expect(second.screen.label('orders')).toBe('v1')
    await vi.waitFor(() => expect(codes(second.reported)).toContain('REMOTE_FETCH_FAILED'))
    expect(codes(second.reported).filter((code) => code === 'REMOTE_FETCH_FAILED')).toHaveLength(1)

    await answer('prod', { snapshot: v1 })
    /** Tree before the 304 revalidation. */
    const before = first.screen.trees.get('orders')
    await first.remote.revalidate()
    expect(first.screen.trees.get('orders')).toBe(before)
    expect(first.remote.current()?.tag).toBe('v1')

    /** V2 text. */
    const v2 = version('v2', 'v2')
    await answer('prod', { snapshot: v2 })
    await first.remote.revalidate()
    expect(first.screen.label('orders')).toBe('v2')
    expect(first.remote.current()?.tag).toBe('v2')
    expect(
      new TextDecoder().decode((await cache.getBytes('part-remote:orders:prod')) ?? undefined)
    ).toBe(v2)

    await control('reset')
    await Promise.all([
      first.remote.revalidate(),
      first.remote.revalidate(),
      first.remote.revalidate()
    ])
    expect(
      (await control('reset')).filter((request) => request.endsWith('/env/prod/snapshot'))
    ).toHaveLength(1)

    await control('down', { down: true })
    try {
      /** Third host: service down, everything from the cache. */
      const third = await remoteHost({ cache })
      await third.remote.ready()
      third.host.mount({}, 'orders')
      expect(third.screen.label('orders')).toBe('v2')
      expect(third.host.catalog.get('notify@1')).toBeDefined()
      expect((await control('reset')).filter((request) => request.includes('/m/'))).toEqual([])
      await third.host.dispose()
    } finally {
      await control('down', { down: false })
    }
    await first.host.dispose()
    await second.host.dispose()
  })
})
