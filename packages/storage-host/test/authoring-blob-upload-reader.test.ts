import * as contractAuthoringBlob from '../src/authoring/blob.js'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'

/** Native upload sinks borrow the same finite reader owner without sharing their buffer strategy. */
describe('blob upload body reader', () => {
  it('reads detached chunks on demand and releases the native reader once at EOF', async () => {
    const pulls = vi.fn()
    const chunk = new Uint8Array([1, 2])
    const source = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls()
          controller.enqueue(chunk)
          controller.close()
        }
      },
      { highWaterMark: 0 }
    )
    const native = source.getReader()
    const release = vi.spyOn(native, 'releaseLock')
    const acquire = vi.spyOn(source, 'getReader').mockReturnValue(native)
    const reader = contractAuthoringBlob.createStorageBlobBodyReader(source, { report: vi.fn() })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(pulls).not.toHaveBeenCalled()
    const first = await reader.next()
    chunk[0] = 9
    expect(first).toEqual({ done: false, value: new Uint8Array([1, 2]) })
    expect(await reader.next()).toEqual({ done: true, value: undefined })
    await reader.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(await reader.next()).toMatchObject({ done: true })
    await using bytes = contractAuthoringBlob.createStorageBlobBodyReader(new Uint8Array([3]), {
      report: vi.fn()
    })
    expect(await bytes.next()).toEqual({ done: false, value: new Uint8Array([3]) })
  })

  it('cancels blocked native reads before draining and preserves cached main and symbolic promises', async () => {
    const finish = deferred<void>()
    const reason = new Error('upload sink stopped')
    const cancel = vi.fn(() => finish.promise)
    const source = new ReadableStream<Uint8Array>({ cancel })
    const native = source.getReader()
    const release = vi.spyOn(native, 'releaseLock')
    vi.spyOn(source, 'getReader').mockReturnValue(native)
    const reader = contractAuthoringBlob.createStorageBlobBodyReader(source, { report: vi.fn() })
    const pending = reader.next()
    const returned = reader.return!(reason)
    expect(reader.return!(reason)).toBe(returned)
    const main = reader.dispose()
    expect(reader.dispose()).toBe(main)
    const symbolic = reader[Symbol.asyncDispose]()
    expect(reader[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(release).not.toHaveBeenCalled()
    finish.resolve()
    await Promise.all([returned, main, symbolic])
    expect(await pending).toMatchObject({ done: true })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('retains cancellation failure as primary and reports native release failure once', async () => {
    const cancellation = new Error('native upload cancel')
    const cancellationBoundary = new Error('classified upload cancel', { cause: cancellation })
    const releaseFailure = new Error('native upload release')
    const source = new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(cancellation) })
    const native = source.getReader()
    const originalRelease = () =>
      Reflect.apply(ReadableStreamDefaultReader.prototype.releaseLock, native, [])
    const release = vi.spyOn(native, 'releaseLock').mockImplementation(() => {
      originalRelease()
      throw releaseFailure
    })
    vi.spyOn(source, 'getReader').mockReturnValue(native)
    const report = vi.fn()
    const normalizeFailure = vi.fn((error: unknown) =>
      error === cancellation ? cancellationBoundary : error
    )
    const reader = contractAuthoringBlob.createStorageBlobBodyReader(source, {
      report,
      normalizeFailure
    })
    const main = reader.dispose()
    const symbolic = reader[Symbol.asyncDispose]()
    await expect(main).rejects.toBe(cancellationBoundary)
    await symbolic
    expect(report.mock.calls).toEqual([[releaseFailure], [cancellationBoundary]])
    expect(release).toHaveBeenCalledTimes(1)
    expect(normalizeFailure.mock.calls).toEqual([[cancellation], [releaseFailure]])
  })

  it('does not cancel a rejected read again and validates chunks on the original argument chain', async () => {
    const failure = new Error('native upload read')
    const boundary = new Error('classified upload read', { cause: failure })
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure)
      },
      cancel
    })
    const reader = contractAuthoringBlob.createStorageBlobBodyReader(source, {
      report: vi.fn(),
      normalizeFailure: (error) => (error === failure ? boundary : error)
    })
    await expect(reader.next()).rejects.toBe(boundary)
    await reader.dispose()
    expect(cancel).not.toHaveBeenCalled()
    const invalid = contractAuthoringBlob.createStorageBlobBodyReader(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue('invalid' as never)
        }
      }),
      { report: vi.fn(), backend: 'memory' }
    )
    await expect(invalid.next()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      backend: 'memory'
    })
    await invalid.dispose()
    const detached = new Uint8Array([1])
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(detached)
      }
    })
    structuredClone(detached, { transfer: [detached.buffer] })
    const invalidBytes = contractAuthoringBlob.createStorageBlobBodyReader(input, {
      report: vi.fn()
    })
    await expect(invalidBytes.next()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      cause: expect.any(TypeError)
    })
    await invalidBytes.dispose()
  })
})
