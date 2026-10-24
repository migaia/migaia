import { describe, expect, it, vi } from 'vitest'
import * as contract from '../src/index.js'

describe('blob input and resource owner', () => {
  it('classifies native content failures through the backend callback on the original reader', async () => {
    const original = new Error('native content read')
    const wrapped = new Error('backend content failed', { cause: original })
    const normalizeFailure = vi.fn((error: unknown) => (error === original ? wrapped : error))
    const close = vi.fn(async () => undefined)
    const object = contract.createStorageBlobObject(
      { key: 'a', size: 1, etag: 'e', metadata: {}, updatedAt: 1 },
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(original)
        }
      }),
      { close, report: vi.fn(), normalizeFailure }
    )
    await expect(object.bytes()).rejects.toBe(wrapped)
    expect(normalizeFailure).toHaveBeenCalledExactlyOnceWith(original)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('captures byte input, metadata, context and conditions before native work', () => {
    const body = new Uint8Array([1, 2])
    const metadata = { owner: 'first' }
    const captured = contract.snapshotStorageBlobPut(
      'key',
      body,
      { metadata, ifNoneMatch: true },
      'object'
    )
    body[0] = 9
    metadata.owner = 'later'
    expect(captured.body).toEqual(new Uint8Array([1, 2]))
    expect(captured.options.metadata).toEqual({ owner: 'first' })
    expect(captured.options.ifNoneMatch).toBe(true)
  })

  it('rejects bad conditions and option domains without acquiring an upload reader', () => {
    const source = new ReadableStream<Uint8Array>()
    const reader = vi.spyOn(source, 'getReader')
    for (const options of [
      { ifNoneMatch: false },
      { ifMatch: 'a', ifNoneMatch: true },
      { metadata: { bad: 1 } },
      { contentType: 1 }
    ])
      expect(() =>
        contract.snapshotStorageBlobPut('key', source, options as never, 'object')
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(reader).not.toHaveBeenCalled()
  })

  it('captures inclusive ranges and positive list limits without changing omitted context', () => {
    const range = { start: 2, end: 9 }
    const captured = contract.snapshotStorageBlobGet('key', { range }, 'object')
    range.start = 8
    expect(captured.options.range).toEqual({ start: 2, end: 9 })
    expect(contract.snapshotStorageBlobList(undefined, undefined, 'object')).toEqual({
      prefix: '',
      limit: 100,
      after: undefined,
      ctx: undefined
    })
    for (const invalid of [{ start: -1 }, { start: 1, end: 0 }, { start: 1.5 }])
      expect(() =>
        contract.snapshotStorageBlobGet('key', { range: invalid }, 'object')
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const limit of [0, -1, 1.5, Infinity])
      expect(() => contract.snapshotStorageBlobList({ limit }, undefined, 'object')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })

  it('uses one content right and one cached native cleanup for bytes, EOF and dispose', async () => {
    const close = vi.fn(async () => undefined)
    const report = vi.fn()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.close()
      }
    })
    const object = contract.createStorageBlobObject(
      { key: 'a', size: 2, etag: 'e', metadata: {}, updatedAt: 1 },
      source,
      { close, report, backend: 'object' }
    )
    expect(await object.bytes()).toEqual(new Uint8Array([1, 2]))
    expect(() => object.stream()).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(object.bytes()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(object.dispose()).toBe(object.dispose())
    await object.dispose()
    expect(close).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('cancels an outstanding native read before waiting for accepted work to drain', async () => {
    const cancel = vi.fn()
    const close = vi.fn(async () => undefined)
    const object = contract.createStorageBlobObject(
      { key: 'a', size: 1, etag: 'e', metadata: {}, updatedAt: 1 },
      new ReadableStream<Uint8Array>({ cancel }),
      { close, report: vi.fn(), backend: 'object' }
    )
    const reader = object.stream().getReader()
    const pending = reader.read()
    await object.dispose()
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps main cleanup rejection and reports symbolic cleanup through its separate promise', async () => {
    const cause = new Error('native close')
    const report = vi.fn()
    const object = contract.createStorageBlobObject(
      { key: 'a', size: 0, etag: 'e', metadata: {}, updatedAt: 1 },
      new ReadableStream<Uint8Array>(),
      {
        close: async () => {
          throw cause
        },
        report,
        backend: 'object'
      }
    )
    const primary = object.dispose()
    const symbolic = object[Symbol.asyncDispose]()
    expect(object[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(primary)
    await expect(primary).rejects.toBe(cause)
    await expect(symbolic).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledExactlyOnceWith(cause)
  })
})
