import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  snapshotStorageBaseDetailed,
  snapshotStorageCapabilities,
  provideCapabilities,
  StorageStageKind,
  type IStorageBase,
  type IBackendStageBindings,
  type ICodecStageObserver,
  type ITransactionStageObserver
} from '../src/index.js'

/** Creates a specialized resource with no KV methods or hidden ownership changes. */
function createBase(): IStorageBase {
  /** The base retains one actual cleanup lifetime and two cached Promise identities. */
  const primary = Promise.resolve()
  /** Symbol cleanup remains independently cached, as required by the resource contract. */
  const symbolic = primary.then(() => undefined)
  return {
    backend: 'catalog',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: vi.fn(() => primary),
    [Symbol.asyncDispose]: vi.fn(() => symbolic)
  }
}

describe('resource base admission', () => {
  it('admits the original specialized base without KV, ownership or mutable-provider requirements', () => {
    /** Ordinary provider admission creates use/has; host admission must still accept that result. */
    const base = createBase()
    /** Host checks shape after native capabilities are already installed. */
    const provided = provideCapabilities(base, [])
    /** Capture exact functions before the shape predicate can inspect them. */
    const dispose = base.dispose
    /** The symbolic disposer is captured separately and never invoked. */
    const asyncDispose = base[Symbol.asyncDispose]
    /** An already-provided base remains the original host subject. */
    const admission = snapshotStorageBaseDetailed(provided)
    expect(admission.valid).toBe(true)
    if (!admission.valid) return
    expect(admission.store === base).toBe(true)
    expect(admission.receiver === base).toBe(true)
    expect(admission.dispose).toBe(dispose)
    expect(admission.asyncDispose).toBe(asyncDispose)
    expect(dispose).not.toHaveBeenCalled()
    expect(asyncDispose).not.toHaveBeenCalled()
  })

  it('captures the supplied outer fixed disposal identity', () => {
    /** The outer key is authoritative even when it differs from the native resource symbol. */
    const fixedKey: symbol = Symbol('outer-canonical')
    /** Ordinary resource functions retain their original receiver and are not invoked here. */
    const candidate = createBase()
    /** The supplied symbol selects this exact function for later host cleanup. */
    const symbolic = vi.fn(() => Promise.resolve())
    Object.defineProperty(candidate, fixedKey, { value: symbolic })
    /** Native disposal is deliberately absent; it is not the selected identity. */
    Reflect.deleteProperty(candidate, Symbol.asyncDispose)
    /** Host admission borrows functions and detached facts without taking resource ownership. */
    const admission = snapshotStorageBaseDetailed(candidate, {
      asyncDisposeKey: fixedKey as typeof Symbol.asyncDispose
    })
    expect(admission.valid).toBe(true)
    if (!admission.valid) return
    expect(Object.is(admission.store, candidate)).toBe(true)
    expect(admission.receiver).toBe(candidate)
    expect(admission.dispose).toBe(candidate.dispose)
    expect(admission.asyncDispose).toBe(symbolic)
    expect(symbolic).not.toHaveBeenCalled()
  })

  it.each([null, [], {}, { backend: 'Invalid Name' }, { backend: 'a'.repeat(65) }])(
    'rejects invalid base shape %#',
    (candidate) => {
      expect(snapshotStorageBaseDetailed(candidate).valid).toBe(false)
    }
  )

  it('rejects a missing fixed disposal function', () => {
    /** This separate canonical key has not been implemented by the candidate. */
    const fixedKey: symbol = Symbol('missing-canonical')
    /** Native resource methods alone do not prove support for a different outer fixed key. */
    const base = createBase()
    expect(
      snapshotStorageBaseDetailed(base, { asyncDisposeKey: fixedKey as typeof Symbol.asyncDispose })
        .valid
    ).toBe(false)
  })
})

describe('captured capability facts', () => {
  it('normalizes legacy flag omissions in the independent host descriptor', () => {
    /** Legacy providers have no declared index or change-feed capability. */
    const capabilities = {
      syncRead: true,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    }
    expect(snapshotStorageCapabilities(capabilities)).toMatchObject({
      secondaryIndexes: false,
      changeFeed: false
    })
  })
})

describe('canonical observer bindings', () => {
  it('retains distinct family types across the original seven observer ports', () => {
    /** Codec and transaction ports must not be structurally interchangeable. */
    function verifyFamilies(
      codec: ICodecStageObserver,
      transaction: ITransactionStageObserver
    ): void {
      // @ts-expect-error The canonical kind keeps different observer families incompatible.
      const wrong: ICodecStageObserver = transaction
      void wrong
      expectTypeOf(codec.kind).toEqualTypeOf<typeof StorageStageKind.codec>()
    }
    void verifyFamilies
    expectTypeOf<ReturnType<IBackendStageBindings['sqlStages']>['kind']>().toEqualTypeOf<
      typeof StorageStageKind.sql
    >()
    expectTypeOf<ReturnType<IBackendStageBindings['queryStages']>['kind']>().toEqualTypeOf<
      typeof StorageStageKind.query
    >()
    expectTypeOf<ReturnType<IBackendStageBindings['concurrencyStages']>['kind']>().toEqualTypeOf<
      typeof StorageStageKind.concurrency
    >()
    expectTypeOf<IBackendStageBindings['backendStages']['kind']>().toEqualTypeOf<
      typeof StorageStageKind.backend
    >()
  })
})
