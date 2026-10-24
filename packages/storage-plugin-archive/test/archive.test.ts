import { describe, it, expect, vi } from 'vitest'
import { createStorageHost, memoryBackendPlugin, definePlugin } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import type { IStoragePipelineInput } from '@migaia/storage-host'
import { archivePlugin } from '../src/index.js'

/** Each scenario has genuine isolated hot records, cold objects and an ordinary later extension. */
async function fixture(
  segmentBytes?: number,
  stage?: (
    input: IStoragePipelineInput,
    next: (input: IStoragePipelineInput) => Promise<void>
  ) => Promise<void>,
  report?: (error: unknown) => void
) {
  const initial = await createStorageHost({
    report,
    plugins: [
      memoryBackendPlugin({ id: 'hot' }),
      memoryBackendPlugin({ id: 'cold' }),
      definePlugin('observer', (core) => ({
        install() {
          if (stage) core.useAsyncPipeline(stage)
          return {}
        }
      }))
    ]
  })
  const host = await initial.use(
    archivePlugin({
      id: 'history',
      hot: 'hot',
      cold: 'cold',
      rules: [
        {
          name: 'old',
          prefix: 'event:',
          olderThanMs: 0,
          where: () => ({ old: true }),
          segmentBytes
        }
      ]
    })
  )
  await host.detect()
  return {
    host,
    hot: host.backend('hot'),
    cold: host.backend('cold').use(blob),
    archive: {
      run: host.extensions.historyRun,
      get: host.extensions.historyGet,
      sweep: host.extensions.historySweep
    }
  }
}

describe('explicit Archive over genuine Memory records and blobs', () => {
  it('commits canonical segments and manifests, reads through EOF, restores and sweeps orphans', async () => {
    const { host, hot, cold, archive } = await fixture()
    try {
      await hot.putRecord({ old: true, value: new Map([['a', new Set([1, 2])]]) }, 'event:a')
      await hot.putRecord({ old: true, value: null }, 'event:b')
      await hot.putRecord({ old: false }, 'event:c')
      expect(await archive.run()).toEqual({ archived: 2, skipped: 0, segments: 1 })
      expect(await hot.getRecord('event:a')).toBeUndefined()
      expect(await archive.get('event:a')).toEqual({
        old: true,
        value: new Map([['a', new Set([1, 2])]])
      })
      expect(await archive.get('event:b', { restore: true })).toEqual({ old: true, value: null })
      expect(await archive.sweep()).toEqual({ scanned: 1, removed: 0 })
      expect(await archive.get('event:a', { restore: true })).toEqual({
        old: true,
        value: new Map([['a', new Set([1, 2])]])
      })
      expect(await archive.sweep()).toEqual({ scanned: 1, removed: 1 })
      expect(await archive.sweep()).toEqual({ scanned: 0, removed: 0 })
      expect(await archive.get('absent')).toBeUndefined()
      expect((await cold.list()).items).toHaveLength(0)
    } finally {
      await host.dispose()
    }
  })
  it('uses ordered prefix selection, unique candidate limits and separate oversized segments', async () => {
    const { host, hot, archive } = await fixture(1)
    try {
      for (const key of ['event:c', 'unrelated', 'event:b', 'event:a'])
        await hot.putRecord({ old: true }, key)
      expect(await archive.run({ limit: 2 })).toEqual({ archived: 2, skipped: 0, segments: 2 })
      expect(await hot.getRecord('event:c')).toEqual({ old: true })
      expect(await hot.getRecord('unrelated')).toEqual({ old: true })
      expect(await archive.get('event:a')).toEqual({ old: true })
    } finally {
      await host.dispose()
    }
  })
  it('uses the actual runtime org for default and two independent saved nested APIs', async () => {
    const { host, hot, archive } = await fixture()
    try {
      await hot.putRecord({ old: true, value: 0 }, 'event:a')
      const a = host.org('11111111-1111-4111-8111-111111111111'),
        b = host.org('22222222-2222-4222-8222-222222222222')
      await a.backend('hot').putRecord({ old: true, value: 1 }, 'event:a')
      await b.backend('hot').putRecord({ old: true, value: 2 }, 'event:a')
      const saved = a.extensions.historyRun
      expect((await saved()).archived).toBe(1)
      expect((await b.extensions.historyRun()).archived).toBe(1)
      expect(await a.extensions.historyGet('event:a')).toEqual({ old: true, value: 1 })
      expect(await b.extensions.historyGet('event:a')).toEqual({ old: true, value: 2 })
      expect(await archive.get('event:a')).toEqual({ old: true, value: 0 })
    } finally {
      await host.dispose()
    }
  })
})

describe('Archive original failure and race boundaries', () => {
  it('skips changed hot rows after upload and lets sweep remove the unreferenced segment', async () => {
    let afterPut: (() => Promise<void>) | undefined
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      const result = await next(input)
      if (input.backendId === 'cold' && input.operation === 'blob.put' && afterPut) {
        const action = afterPut
        afterPut = undefined
        await action()
      }
      return result
    })
    try {
      await hot.putRecord({ old: true, value: 1 }, 'event:a')
      afterPut = () => hot.putRecord({ old: false, value: 2 }, 'event:a').then(() => undefined)
      expect(await archive.run()).toEqual({ archived: 0, skipped: 1, segments: 0 })
      expect(await archive.get('event:a')).toEqual({ old: false, value: 2 })
      expect(await archive.sweep()).toEqual({ scanned: 1, removed: 1 })
    } finally {
      await host.dispose()
    }
  })
  it('rolls the whole original hot segment transaction back and reports only committed progress', async () => {
    let enabled = false,
      writes = 0
    const failure = new RangeError('second manifest fails')
    const { host, hot, cold, archive } = await fixture(undefined, async (input, next) => {
      if (
        enabled &&
        input.backendId === 'hot' &&
        input.operation === 'putRecord' &&
        input.scope !== undefined &&
        Array.isArray((input.input as { key?: unknown }).key) &&
        (input.input as { key: unknown[] }).key[2] === 'manifest' &&
        ++writes === 2
      )
        throw failure
      return next(input)
    })
    try {
      await hot.putRecord({ old: true }, 'event:a')
      await hot.putRecord({ old: true }, 'event:b')
      enabled = true
      await expect(archive.run()).rejects.toMatchObject({
        code: 'ARCHIVE_OPERATION_FAILED',
        cause: expect.objectContaining({ cause: failure }),
        progress: { archived: 0, skipped: 0, segments: 0 }
      })
      expect(await hot.getRecord('event:a')).toEqual({ old: true })
      expect(await hot.getRecord('event:b')).toEqual({ old: true })
      expect(await hot.getRecord(['$archive', 'history', 'manifest', 'event:a'])).toBeUndefined()
      expect((await cold.list()).items).toHaveLength(1)
      expect((await archive.sweep()).removed).toBe(1)
    } finally {
      await host.dispose()
    }
  })
  it('retains earlier committed progress when a later upload fails without retrying it', async () => {
    let enabled = false,
      puts = 0
    const failure = new TypeError('later cold upload fails')
    const { host, hot, archive } = await fixture(1, async (input, next) => {
      if (enabled && input.backendId === 'cold' && input.operation === 'blob.put' && ++puts === 2)
        throw failure
      return next(input)
    })
    try {
      await hot.putRecord({ old: true }, 'event:a')
      await hot.putRecord({ old: true }, 'event:b')
      enabled = true
      await expect(archive.run()).rejects.toMatchObject({
        code: 'ARCHIVE_OPERATION_FAILED',
        cause: failure,
        progress: { archived: 1, skipped: 0, segments: 1 }
      })
      expect(puts).toBe(2)
      expect(await hot.getRecord('event:a')).toBeUndefined()
      expect(await hot.getRecord('event:b')).toEqual({ old: true })
    } finally {
      await host.dispose()
    }
  })
  for (const damage of [
    'crc',
    'truncated',
    'tail-json',
    'version',
    'key',
    'line',
    'missing'
  ] as const)
    it(`validates complete EOF and target identity for ${damage}`, async () => {
      const { host, hot, cold, archive } = await fixture()
      try {
        await hot.putRecord({ old: true }, 'event:a')
        await archive.run()
        const info = (await cold.list()).items[0]!,
          object = await cold.get(info.key),
          bytes = await object!.bytes()
        await object!.dispose()
        let body = bytes
        if (damage === 'crc') {
          body = bytes.slice()
          body[body.length - 8] ^= 1
        } else if (damage === 'truncated') body = bytes.slice(0, -4)
        else if (damage === 'missing') await cold.remove(info.key)
        else if (damage === 'line')
          await hot.putRecord(
            { version: 1, state: { segmentId: info.key.split(':').at(-1), line: 99, rule: 'old' } },
            ['$archive', 'history', 'manifest', 'event:a']
          )
        else {
          const line =
            damage === 'version'
              ? JSON.stringify({ version: 2, state: { key: 'event:a', value: { old: true } } })
              : damage === 'key'
                ? JSON.stringify({ version: 1, state: { key: 'other', value: { old: true } } })
                : JSON.stringify({ version: 1, state: { key: 'event:a', value: { old: true } } }) +
                  '\ninvalid'
          body = new Uint8Array(
            await new Response(
              new Blob([line + '\n']).stream().pipeThrough(new CompressionStream('gzip'))
            ).arrayBuffer()
          )
        }
        if (damage !== 'line' && damage !== 'missing')
          await cold.put(info.key, body, { metadata: info.metadata })
        await expect(archive.get('event:a')).rejects.toMatchObject({
          code: 'ARCHIVE_SEGMENT_INVALID'
        })
        await expect(archive.get('event:a', { restore: true })).rejects.toMatchObject({
          code: 'ARCHIVE_SEGMENT_INVALID'
        })
        expect(await hot.getRecord('event:a')).toBeUndefined()
        expect(await hot.getRecord(['$archive', 'history', 'manifest', 'event:a'])).toBeDefined()
      } finally {
        await host.dispose()
      }
    })
  it('keeps wrong-format objects and rejects corrupted reference directories instead of deleting them', async () => {
    const { host, hot, cold, archive } = await fixture()
    try {
      await hot.putRecord({ old: true }, 'event:a')
      await archive.run()
      const info = (await cold.list()).items[0]!,
        segmentId = info.key.split(':').at(-1)!
      await cold.put(info.key + '-foreign', new Uint8Array([1]), {
        metadata: { format: 'other', version: '1' }
      })
      await hot.putRecord({ version: 1, state: { refs: -1 } }, [
        '$archive',
        'history',
        'segment',
        segmentId
      ])
      await expect(archive.sweep()).rejects.toMatchObject({ code: 'ARCHIVE_SEGMENT_INVALID' })
      expect((await cold.list()).items).toHaveLength(2)
    } finally {
      await host.dispose()
    }
  })
  it('does not overwrite a colliding immutable segment or delete its candidate', async () => {
    const { host, hot, cold, archive } = await fixture()
    try {
      const random = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue('00000000-0000-4000-8000-000000000001')
      try {
        await hot.putRecord({ old: true, value: 1 }, 'event:a')
        await archive.run()
        const first = (await cold.list()).items[0]!
        await hot.putRecord({ old: true, value: 2 }, 'event:b')
        await expect(archive.run()).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        expect(await cold.head(first.key)).toEqual(first)
        expect(await hot.getRecord('event:b')).toEqual({ old: true, value: 2 })
      } finally {
        random.mockRestore()
      }
    } finally {
      await host.dispose()
    }
  })
})

describe('Archive finite read, cancellation and observation behavior', () => {
  it('closes initial miss, concurrent restore, hot precedence and changed-manifest races without loops', async () => {
    let action: ((input: IStoragePipelineInput) => Promise<void>) | undefined
    const { host, hot, cold, archive } = await fixture(undefined, async (input, next) => {
      await next(input)
      if (action) await action(input)
    })
    const once = (match: (input: IStoragePipelineInput) => boolean, run: () => Promise<void>) => {
      action = async (input) => {
        if (match(input)) {
          action = undefined
          await run()
        }
      }
    }
    const business = (input: IStoragePipelineInput) =>
      input.backendId === 'hot' &&
      input.operation === 'getRecord' &&
      input.scope === undefined &&
      input.input === 'event:a'
    const manifest = (input: IStoragePipelineInput) =>
      input.backendId === 'hot' &&
      input.operation === 'getRecord' &&
      input.scope === undefined &&
      Array.isArray(input.input) &&
      input.input[2] === 'manifest'
    const coldGet = (input: IStoragePipelineInput) =>
      input.backendId === 'cold' && input.operation === 'blob.get'
    try {
      await hot.putRecord({ old: true, value: 1 }, 'event:a')
      await archive.run()
      once(business, async () => {
        await archive.get('event:a', { restore: true })
      })
      expect(await archive.get('event:a')).toEqual({ old: true, value: 1 })
      await archive.run()
      once(coldGet, async () => {
        await hot.putRecord({ old: true, value: 2 }, 'event:a')
      })
      expect(await archive.get('event:a', { restore: true })).toEqual({ old: true, value: 2 })
      await archive.run()
      once(coldGet, async () => {
        await hot.putRecord({ old: true, value: 3 }, 'event:a')
        await archive.run()
      })
      await expect(archive.get('event:a', { restore: true })).rejects.toMatchObject({
        code: 'ARCHIVE_OPERATION_FAILED'
      })
      expect(await archive.get('event:a')).toEqual({ old: true, value: 3 })
      await archive.get('event:a', { restore: true })
      await hot.deleteRecord('event:a')
      once(manifest, async () => {
        await hot.putRecord({ old: true, value: 4 }, 'event:a')
        await archive.run()
      })
      await expect(archive.get('event:a')).rejects.toMatchObject({
        code: 'ARCHIVE_OPERATION_FAILED'
      })
      expect(await archive.get('event:a')).toEqual({ old: true, value: 4 })
      expect((await cold.list()).items.length).toBeGreaterThan(0)
    } finally {
      await host.dispose()
    }
  })
  it('returns restored hot data when another restore and sweep remove the original cold object', async () => {
    let action: (() => Promise<void>) | undefined
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      if (action && input.backendId === 'cold' && input.operation === 'blob.get') {
        const current = action
        action = undefined
        await current()
      }
      await next(input)
    })
    try {
      await hot.putRecord({ old: true, value: 1 }, 'event:a')
      await archive.run()
      action = async () => {
        await archive.get('event:a', { restore: true })
        await archive.sweep()
      }
      expect(await archive.get('event:a')).toEqual({ old: true, value: 1 })
    } finally {
      await host.dispose()
    }
  })
  it('preserves actual native revision conflict and the new business value', async () => {
    let change: (() => Promise<void>) | undefined
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      await next(input)
      if (
        change &&
        input.backendId === 'hot' &&
        input.scope !== undefined &&
        input.operation === 'getRecord' &&
        input.input === 'event:a'
      ) {
        const action = change
        change = undefined
        await action()
      }
    })
    try {
      await hot.putRecord({ old: true, value: 1 }, 'event:a')
      change = async () => {
        await hot.putRecord({ old: true, value: 2 }, 'event:a')
        await hot.putRecord({ old: true, value: 1 }, 'event:a')
      }
      await expect(archive.run()).rejects.toMatchObject({
        code: 'WRITE_CONFLICT'
      })
      expect(await hot.getRecord('event:a')).toEqual({ old: true, value: 1 })
    } finally {
      await host.dispose()
    }
  })
  it('keeps accepted real work leased until cancellation and host close have actually drained it', async () => {
    let enabled = false,
      enter!: () => void,
      resume!: () => void
    const entered = new Promise<void>((resolve) => {
        enter = resolve
      }),
      held = new Promise<void>((resolve) => {
        resume = resolve
      })
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      if (enabled && input.backendId === 'cold' && input.operation === 'blob.put') {
        enabled = false
        enter()
        await held
      }
      await next(input)
    })
    await hot.putRecord({ old: true }, 'event:a')
    enabled = true
    const abort = new AbortController(),
      run = archive.run({ signal: abort.signal }),
      failed = expect(run).rejects.toMatchObject({ code: 'HOST_DISPOSING' })
    await entered
    abort.abort('cancel accepted upload')
    let closed = false
    const disposing = host.dispose().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(closed).toBe(false)
    resume()
    await failed
    await disposing
    expect(closed).toBe(true)
    expect(() => archive.run()).toThrowError()
  })
  it('counts one outer operation and exact original internal requests with lazy data-free hooks', async () => {
    const operations: string[] = []
    const { host, hot, archive } = await fixture(1, async (input, next) => {
      operations.push(input.operation)
      await next(input)
    })
    const results: unknown[] = [],
      restore: unknown[] = [],
      swept: unknown[] = [],
      errors: unknown[] = []
    host.hooks.on('afterArchiveRun', (value) => {
      results.push(value)
    })
    host.hooks.on('afterArchiveRestore', (value) => {
      restore.push(value)
    })
    host.hooks.on('afterArchiveSweep', (value) => {
      swept.push(value)
    })
    host.hooks.on('onArchiveRunError', (value) => {
      errors.push(value)
    })
    try {
      await hot.putRecord({ old: true }, 'event:a')
      await hot.putRecord({ old: true }, 'event:b')
      operations.length = 0
      await archive.run()
      await archive.get('event:a', { restore: true })
      await archive.sweep()
      for (const method of ['archive.run', 'archive.get', 'archive.sweep'])
        expect(operations.filter((item) => item === method)).toHaveLength(1)
      expect(operations.filter((item) => item === 'blob.put')).toHaveLength(2)
      expect(results).toEqual([
        expect.objectContaining({ archived: 2, skipped: 0, segments: 2, orgId: expect.any(String) })
      ])
      expect(restore).toEqual([expect.objectContaining({ restored: true })])
      expect(swept).toEqual([expect.objectContaining({ scanned: 2, removed: 1 })])
      expect(errors).toEqual([])
      for (const result of [...results, ...restore, ...swept]) {
        expect(result).not.toHaveProperty('key')
        expect(result).not.toHaveProperty('value')
      }
    } finally {
      await host.dispose()
    }
  })
})

describe('Archive rule and wire admission', () => {
  it('captures rule order and compiles one cutoff per selected rule', async () => {
    let whereCalls = 0
    const initial = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
    })
    const rules = [
      {
        name: 'first',
        prefix: '',
        olderThanMs: 10,
        where: (cutoff: number) => {
          whereCalls++
          expect(cutoff).toBeLessThanOrEqual(Date.now() - 10)
          return { old: true }
        }
      },
      {
        name: 'second',
        prefix: 'event:',
        olderThanMs: 0,
        where: () => {
          whereCalls++
          return { old: true }
        }
      }
    ]
    const plugin = archivePlugin({
      id: 'snapshot',
      hot: 'hot',
      cold: 'cold',
      rules
    })
    const host = await initial.use(plugin)
    await host.detect()
    try {
      rules.reverse()
      for (const key of ['event:z', 'event:a', 'other', '\uffff'])
        await host.backend('hot').putRecord({ old: true, value: key }, key)
      await host.backend('hot').putRecord({ old: true }, ['metadata'])
      expect(await host.extensions.snapshotRun({ limit: 3 })).toEqual({
        archived: 3,
        skipped: 0,
        segments: 1
      })
      expect(whereCalls).toBe(1)
      expect(await host.backend('hot').getRecord('\uffff')).toBeDefined()
      expect(await host.backend('hot').getRecord(['metadata'])).toEqual({ old: true })
      await expect(host.extensions.snapshotRun({ rule: 'missing' })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      await expect(host.extensions.snapshotRun({ limit: 0 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
    } finally {
      await host.dispose()
    }
  })
  it('rejects unsupported codec values before the first cold put and preserves canonical bytes and null', async () => {
    let puts = 0
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      if (input.operation === 'blob.put') puts++
      await next(input)
    })
    try {
      await hot.putRecord({ old: true, value: new Date() }, 'event:a')
      await expect(archive.run()).rejects.toMatchObject({ code: 'ARCHIVE_OPERATION_FAILED' })
      expect(puts).toBe(0)
      await hot.putRecord({ old: true, value: new Uint8Array([0, 255]) }, 'event:a')
      await archive.run()
      expect(await archive.get('event:a')).toEqual({
        old: true,
        value: { $rpc: 'bytes', base64url: 'AP8' }
      })
    } finally {
      await host.dispose()
    }
  })
  it('keeps caller cancellation coded and does no cold IO for pre-abort', async () => {
    let puts = 0
    const { host, hot, archive } = await fixture(undefined, async (input, next) => {
      if (input.operation === 'blob.put') puts++
      await next(input)
    })
    try {
      await hot.putRecord({ old: true }, 'event:a')
      const abort = new AbortController()
      abort.abort(new RangeError('caller'))
      await expect(archive.run({ signal: abort.signal })).rejects.toMatchObject({ code: 'ABORTED' })
      expect(puts).toBe(0)
    } finally {
      await host.dispose()
    }
  })
  it('rejects invalid options and a real published non-record backend without closing earlier targets', async () => {
    for (const options of [
      { id: '', hot: 'h', cold: 'c', rules: [] },
      {
        id: 'x',
        hot: 'h',
        cold: 'c',
        rules: [{ name: 'a', prefix: '', where: () => ({}), olderThanMs: -1 }]
      },
      {
        id: 'x',
        hot: 'h',
        cold: 'c',
        rules: [{ name: 'a', prefix: '', where: () => ({}), olderThanMs: 0, segmentBytes: 0 }]
      }
    ])
      expect(() => archivePlugin(options)).toThrowError(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      )
    const { host, hot } = await fixture()
    try {
      await expect(
        host.use(
          archivePlugin({
            id: 'later',
            hot: 'missing',
            cold: 'cold',
            rules: [{ name: 'all', prefix: '', where: () => ({}), olderThanMs: 0 }]
          })
        )
      ).rejects.toBeDefined()
      await hot.putRecord({ safe: true }, 'safe')
      expect(await hot.getRecord('safe')).toEqual({ safe: true })
    } finally {
      await host.dispose()
    }
  })
})

describe('Archive opaque maintenance and observer boundaries', () => {
  it('visits each original opaque page once and stops after the first failed removal', async () => {
    let lists = 0,
      removes = 0,
      failRemove = false
    const failure = new RangeError('cold removal unavailable')
    const { host, hot, cold, archive } = await fixture(undefined, async (input, next) => {
      if (input.backendId === 'cold' && input.operation === 'blob.list') {
        lists++
        await next({ ...input, input: { ...(input.input as object), limit: 1 } })
        return
      }
      if (input.backendId === 'cold' && input.operation === 'blob.remove') {
        removes++
        if (failRemove) throw failure
      }
      await next(input)
    })
    try {
      await hot.putRecord({ old: true }, 'event:a')
      await archive.run()
      const info = (await cold.list()).items[0]!,
        prefix = info.key.slice(0, info.key.lastIndexOf(':') + 1)
      await cold.put(prefix + 'a-orphan', new Uint8Array([1]), { metadata: info.metadata })
      await cold.put(prefix + 'b-orphan', new Uint8Array([2]), { metadata: info.metadata })
      lists = 0
      removes = 0
      failRemove = true
      await expect(archive.sweep()).rejects.toMatchObject({
        code: 'ARCHIVE_OPERATION_FAILED',
        cause: expect.objectContaining({ cause: failure })
      })
      expect(removes).toBe(1)
      failRemove = false
      lists = 0
      removes = 0
      expect(await archive.sweep()).toEqual({ scanned: 3, removed: 2 })
      expect(lists).toBe(3)
      expect(removes).toBe(2)
      expect((await archive.sweep()).removed).toBe(0)
    } finally {
      await host.dispose()
    }
  })
  it('reports observer throw and rejected Promise without changing results', async () => {
    const reported: unknown[] = []
    const { host, hot, archive } = await fixture(undefined, undefined, (error) => {
      reported.push(error)
    })
    const failures = [new RangeError('sync observer'), new Error('async observer')]
    try {
      host.hooks.on('beforeArchiveRun', () => {
        throw failures[0]
      })
      host.hooks.on('afterArchiveRun', () => Promise.reject(failures[1]) as never)
      await hot.putRecord({ old: true }, 'event:a')
      expect(await archive.run()).toEqual({ archived: 1, skipped: 0, segments: 1 })
      await Promise.resolve()
      for (const failure of failures) expect(reported).toContain(failure)
      expect(await archive.run()).toEqual({ archived: 0, skipped: 0, segments: 0 })
    } finally {
      await host.dispose()
    }
  })
})

it('honors original pipeline replacement and operation options', async () => {
  const { host, hot, archive } = await fixture(undefined, async (input, next) => {
    if (input.operation === 'archive.run') {
      await next({ ...input, input: { ...(input.input as object), limit: 1 } })
      return
    }
    if (input.operation === 'archive.get') {
      await next({ ...input, input: { key: 'event:b', restore: false } })
      return
    }
    await next(input)
  })
  try {
    await hot.putRecord({ old: true, value: 'a' }, 'event:a')
    await hot.putRecord({ old: true, value: 'b' }, 'event:b')
    expect(
      await archive.run({
        rule: 'old',
        limit: 2,
        signal: undefined,
        timeoutMs: 10000
      })
    ).toEqual({ archived: 1, skipped: 0, segments: 1 })
    expect(
      await archive.get('event:a', {
        restore: true
      })
    ).toEqual({ old: true, value: 'b' })
  } finally {
    await host.dispose()
  }
})

it('gives an overlapping candidate only to its first selected rule even when its commit is skipped', async () => {
  let update: (() => Promise<void>) | undefined,
    puts = 0,
    whereCalls = 0
  const initial = await createStorageHost({
    plugins: [
      memoryBackendPlugin({ id: 'hot' }),
      memoryBackendPlugin({ id: 'cold' }),
      definePlugin('overlap', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            await next(input)
            if (input.backendId === 'cold' && input.operation === 'blob.put') {
              puts++
              if (update) {
                const current = update
                update = undefined
                await current()
              }
            }
          })
          return {}
        }
      }))
    ]
  })
  const host = await initial.use(
    archivePlugin({
      id: 'archive',
      hot: 'hot',
      cold: 'cold',
      rules: [
        {
          name: 'first',
          prefix: 'event:',
          olderThanMs: 0,
          where: () => {
            whereCalls++
            return { old: true }
          }
        },
        {
          name: 'second',
          prefix: 'event:',
          olderThanMs: 0,
          where: () => {
            whereCalls++
            return { old: true }
          }
        }
      ]
    })
  )
  await host.detect()
  try {
    await host.backend('hot').putRecord({ old: true, value: 1 }, 'event:a')
    update = () =>
      host
        .backend('hot')
        .putRecord({ old: true, value: 2 }, 'event:a')
        .then(() => undefined)
    expect(await host.extensions.archiveRun()).toEqual({ archived: 0, skipped: 1, segments: 0 })
    expect(puts).toBe(1)
    expect(whereCalls).toBe(2)
  } finally {
    await host.dispose()
  }
})

it('handles maximum UTF-16 prefixes without visiting private tuple metadata', async () => {
  const initial = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
  })
  const host = await initial.use(
    archivePlugin({
      id: 'archive',
      hot: 'hot',
      cold: 'cold',
      rules: [{ name: 'last', prefix: '\uffff', olderThanMs: 0, where: () => ({}) }]
    })
  )
  await host.detect()
  try {
    await host.backend('hot').putRecord(null, '\uffff')
    await host.backend('hot').putRecord({ safe: true }, ['metadata'])
    expect(await host.extensions.archiveRun()).toEqual({ archived: 1, skipped: 0, segments: 1 })
    expect(await host.extensions.archiveGet('\uffff')).toBeNull()
    expect(await host.backend('hot').getRecord(['metadata'])).toEqual({ safe: true })
  } finally {
    await host.dispose()
  }
})

it('restores concurrent callers once under the original control lock', async () => {
  let restoring = false,
    writes = 0
  const { host, hot, archive } = await fixture(undefined, async (input, next) => {
    if (
      restoring &&
      input.backendId === 'hot' &&
      input.scope !== undefined &&
      input.operation === 'putRecord' &&
      (input.input as { key?: unknown }).key === 'event:a'
    )
      writes++
    await next(input)
  })
  try {
    await hot.putRecord({ old: true, value: 'shared' }, 'event:a')
    await archive.run()
    restoring = true
    expect(
      await Promise.all([
        archive.get('event:a', { restore: true }),
        archive.get('event:a', { restore: true })
      ])
    ).toEqual([
      { old: true, value: 'shared' },
      { old: true, value: 'shared' }
    ])
    expect(writes).toBe(1)
    expect((await archive.sweep()).removed).toBe(1)
  } finally {
    await host.dispose()
  }
})
