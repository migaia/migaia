import { describe, expect, it, vi } from 'vitest'
import { IdentifyError, walkErrorCauses } from '@migaia/utils/error'
import { STORAGE_HOST_SOURCE } from '../src/errors.js'
import {
  planChannelWrite,
  collectUniqueIndexOwners,
  normalizeError,
  isStorageErrorFamily,
  invokeExtension,
  subscribeToAbort
} from '../src/authoring/backend.js'

/** A native backend error keeps its real source and original native cause through shared rules. */
const backendError = (cause?: unknown) =>
  IdentifyError.from(new TypeError('backend failure', { cause }), {
    source: '@fixture/backend',
    code: 'NATIVE_FAILED'
  })

describe('backend error and cancellation boundaries', () => {
  it('retains a backend-owned error constructor for channel conflicts and normalization', () => {
    /** Shared mutation planning must throw the exact backend-owned error. */
    const original = backendError()
    expect(() =>
      planChannelWrite('key', 'record', new Set(['value']), 'conflict', 'native', () => original)
    ).toThrow(original)
    expect(isStorageErrorFamily(original, IdentifyError.is)).toBe(true)
    expect(normalizeError(original, backendError, IdentifyError.is)).toBe(original)
    /** Unknown callback failures become the backend's own native error cause. */
    const cause = new Error('original callback')
    expect(normalizeError(cause, backendError, IdentifyError.is).cause).toBeInstanceOf(TypeError)
    expect(walkErrorCauses(normalizeError(cause, backendError, IdentifyError.is))).toContain(cause)
  })

  it('preserves unique-index validation while delegating only backend error construction', () => {
    /** Definitions retain the same provider-independent uniqueness metadata. */
    const definitions = [{ name: 'email', unique: true, multiEntry: true, revision: 1 }]
    /** Duplicate multi-entry values on one actual row remain valid. */
    const row = {
      key: 'one',
      projection: { email: { kind: 'multiple' as const, keys: ['same', 'same'] } }
    }
    expect(collectUniqueIndexOwners(definitions, [row], 'native').size).toBe(1)
    /** Several projected values still read and encode the logical owner only once. */
    let keyReads = 0
    /** The original key accessor exposes accidental per-projection owner encoding. */
    const projected = {
      get key() {
        keyReads += 1
        return 'projected'
      },
      projection: { email: { kind: 'multiple' as const, keys: ['a', 'b', 'c'] } }
    }
    expect(collectUniqueIndexOwners(definitions, [projected], 'native').size).toBe(3)
    expect(keyReads).toBe(1)
    /** A second row must reject the whole proposed commit with the backend's exact error. */
    const original = backendError()
    expect(() =>
      collectUniqueIndexOwners(definitions, [row, { ...row, key: 'two' }], 'native', {
        invalidConfig: () => original,
        uniqueConflict: () => original
      })
    ).toThrow(original)
  })

  it('keeps extension failures and cancellation on the original reporting and reason channels', async () => {
    /** A backend-coded callback error is retained by its own constructor policy. */
    const original = backendError()
    /** Shared normalization reports secondary diagnostic getter failures without replacing primary. */
    const report = vi.fn()
    await expect(
      invokeExtension(
        () => {
          throw original
        },
        'native',
        'read',
        'codec',
        undefined,
        { reporter: report },
        (error) => error as Error
      )
    ).rejects.toBe(original)
    /** Native cancellation reason remains exactly reachable and prevents the business callback. */
    const controller = new AbortController()
    controller.abort(original)
    /** Callback count proves that an aborted operation never enters native work. */
    const work = vi.fn()
    await expect(
      invokeExtension(work, 'native', 'read', 'codec', controller.signal, { reporter: report })
    ).rejects.toMatchObject({ code: 'ABORTED', cause: original })
    expect(work).not.toHaveBeenCalled()
    /** A supported extension can throw an Error with a hostile diagnostic accessor. */
    const diagnostic = new Error('code getter')
    /** Keep that exact thrown Error as the primary cause at the existing extension boundary. */
    const failure = Object.defineProperty(new Error('extension'), 'code', {
      get: () => {
        throw diagnostic
      }
    })
    await expect(
      invokeExtension(
        () => {
          throw failure
        },
        'native',
        'read',
        'codec',
        undefined,
        { reporter: report }
      )
    ).rejects.toMatchObject({ code: 'EXTENSION_FAILED', cause: failure })
    expect(report).toHaveBeenCalledExactlyOnceWith(diagnostic)
  })

  it('classifies user pipeline failures while retaining the caller-admitted backend family', async () => {
    /** A pipeline callback is an extension failure rather than evidence of native network failure. */
    const failure = new RangeError('application pipeline failed')
    const report = vi.fn()
    await expect(
      invokeExtension(
        () => {
          throw failure
        },
        'native',
        'search',
        'pipeline',
        undefined,
        { reporter: report }
      )
    ).rejects.toMatchObject({
      source: STORAGE_HOST_SOURCE,
      code: 'EXTENSION_FAILED',
      operation: 'search',
      extensionStage: 'pipeline',
      cause: failure
    })
    /** The existing optional normalizer retains the exact real backend-coded object. */
    const original = backendError()
    await expect(
      invokeExtension(
        () => {
          throw original
        },
        'native',
        'search',
        'pipeline',
        undefined,
        { reporter: report },
        (error) => (isStorageErrorFamily(error, IdentifyError.is) ? error : backendError(error))
      )
    ).rejects.toBe(original)
    expect(report).not.toHaveBeenCalled()
  })

  it('reports native listener-cleanup failure once without changing the operation result', () => {
    /** Use the actual supported signal boundary rather than a second cancellation implementation. */
    const controller = new AbortController()
    /** The native cleanup failure remains the same object supplied to the original reporter. */
    const original = new Error('remove listener')
    /** Direct cleanup is idempotent even when the host remover fails. */
    const remove = vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(() => {
      throw original
    })
    /** A callback that never ran must not be fabricated by cleanup. */
    const work = vi.fn()
    /** One reporter owns this actual operation only. */
    const report = vi.fn()
    const off = subscribeToAbort(controller.signal, work, report)
    off()
    off()
    expect(report).toHaveBeenCalledExactlyOnceWith(original)
    expect(work).not.toHaveBeenCalled()
    remove.mockRestore()
  })
})
