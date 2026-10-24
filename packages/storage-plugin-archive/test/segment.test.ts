import { it, expect } from 'vitest'
import { createStorageBlobObject } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { readSegment } from '../src/segment.js'

/** The original public blob resource owns a genuinely blocked stream and its held native cancel. */
it('wakes a blocked decompression read on abort and drains original cancellation/close once', async () => {
  const pulled = deferred<void>(),
    cancelled = deferred<void>(),
    release = deferred<void>(),
    abort = new AbortController(),
    reports: unknown[] = []
  let cancels = 0,
    closes = 0,
    settled = false
  const source = new ReadableStream<Uint8Array>(
    {
      pull() {
        pulled.resolve()
      },
      cancel() {
        cancels++
        cancelled.resolve()
        return release.promise
      }
    },
    { highWaterMark: 0 }
  )
  const object = createStorageBlobObject(
    { key: 'segment', etag: 'original', size: 0, metadata: {}, updatedAt: 0 },
    source,
    {
      close: () => {
        closes++
      },
      report: (error) => {
        reports.push(error)
      }
    }
  )
  const result = readSegment(object, 'event:a', 0, { signal: abort.signal }, (error) => {
    reports.push(error)
  }).finally(() => {
    settled = true
  })
  const failed = expect(result).rejects.toMatchObject({
    code: 'ABORTED',
    cause: 'caller stopped stalled read'
  })
  await pulled.promise
  abort.abort('caller stopped stalled read')
  await cancelled.promise
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(closes).toBe(0)
  release.resolve()
  await failed
  expect(cancels).toBe(1)
  expect(closes).toBe(1)
  expect(reports).toEqual([])
  await object.dispose()
  expect(closes).toBe(1)
})

it('keeps the original abort first when native cancellation cleanup also rejects', async () => {
  const pulled = deferred<void>(),
    abort = new AbortController(),
    cleanup = new RangeError('native cancel cleanup')
  const source = new ReadableStream<Uint8Array>(
    {
      pull() {
        pulled.resolve()
      },
      cancel() {
        throw cleanup
      }
    },
    { highWaterMark: 0 }
  )
  const object = createStorageBlobObject(
    { key: 'segment', etag: 'original', size: 0, metadata: {}, updatedAt: 0 },
    source,
    { close: () => {}, report: () => {} }
  )
  const result = readSegment(object, 'event:a', 0, { signal: abort.signal }, () => {}).catch(
    (error) => error
  )
  await pulled.promise
  abort.abort('first reason')
  const error = await result
  expect(error).toBeInstanceOf(AggregateError)
  expect(error.errors[0]).toMatchObject({ code: 'ABORTED', cause: 'first reason' })
  expect(error.errors[1]).toBe(cleanup)
  expect(Reflect.get(cleanup, 'errors')).toBeUndefined()
})

it('measures exact UTF-8 line budgets and keeps embedded newlines inside their canonical record', async () => {
  const { defineCollectionsJsonCodec } = await import('@migaia/serialize/codecs/collections-json')
  const { createStorageHost, memoryBackendPlugin } = await import('@migaia/storage-host')
  const { archivePlugin } = await import('../src/index.js')
  const codec = defineCollectionsJsonCodec({ version: 1 }),
    value = { old: true, text: 'a\nb' }
  const budget = new TextEncoder().encode(
    codec.encode({ version: 1, state: { key: 'event:a', value } }) +
      '\n' +
      codec.encode({ version: 1, state: { key: 'event:b', value } }) +
      '\n'
  ).byteLength
  for (const exact of [true, false]) {
    const base = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
    })
    const host = await base.use(
      archivePlugin({
        id: 'archive',
        hot: 'hot',
        cold: 'cold',
        rules: [
          {
            name: 'all',
            prefix: 'event:',
            olderThanMs: 0,
            where: () => ({ old: true }),
            segmentBytes: exact ? budget : budget - 1
          }
        ]
      })
    )
    await host.detect()
    try {
      for (const key of ['event:a', 'event:b']) await host.backend('hot').putRecord(value, key)
      expect(await host.extensions.archive.run()).toEqual({
        archived: 2,
        skipped: 0,
        segments: exact ? 1 : 2
      })
      expect(await host.extensions.archive.get('event:a')).toEqual(value)
    } finally {
      await host.dispose()
    }
  }
})
