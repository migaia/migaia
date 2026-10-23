import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  snapshotStorageBaseDetailed,
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
    Object.freeze(provided)
    /** Capture exact functions before the shape predicate can inspect them. */
    const dispose = base.dispose
    /** The symbolic disposer is captured separately and never invoked. */
    const asyncDispose = base[Symbol.asyncDispose]
    /** A frozen provider is a valid host subject even though it cannot be provided again. */
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

  it('captures fields and the outer fixed disposal key once', () => {
    /** Outer canonical identity is supplied, never synthesized by storage-contract. */
    const fixedKey: symbol = Symbol('outer-canonical')
    /** All public base getters are counted before any matcher receives the original object. */
    const reads = { backend: 0, capabilities: 0, dispose: 0, symbolic: 0, native: 0, key: 0 }
    /** One ordinary fixture supplies complete declared capability facts. */
    const fixture = createBase()
    /** Functions retain their native receiver and are not invoked during inspection. */
    const dispose = fixture.dispose
    /** Symbolic cleanup captures the exact supplied function. */
    const symbolic = fixture[Symbol.asyncDispose]
    /** Accessor-backed specialized base must remain valid without any key-value methods. */
    const candidate = {
      get backend() {
        reads.backend += 1
        return fixture.backend
      },
      get capabilities() {
        reads.capabilities += 1
        return fixture.capabilities
      },
      get dispose() {
        reads.dispose += 1
        return dispose
      },
      get [Symbol.asyncDispose](): never {
        reads.native += 1
        throw new Error('native key must not be read')
      }
    }
    Object.defineProperty(candidate, fixedKey, {
      get() {
        reads.symbolic += 1
        return symbolic
      }
    })
    /** The helper captures a getter-backed outer option once and uses only that fixed identity. */
    const admission = snapshotStorageBaseDetailed(candidate, {
      get asyncDisposeKey(): typeof Symbol.asyncDispose {
        reads.key += 1
        return fixedKey as typeof Symbol.asyncDispose
      }
    })
    expect(reads).toEqual({
      backend: 1,
      capabilities: 1,
      dispose: 1,
      symbolic: 1,
      native: 0,
      key: 1
    })
    expect(admission.valid).toBe(true)
    if (!admission.valid) return
    expect(Object.is(admission.store, candidate)).toBe(true)
    expect(admission.dispose).toBe(dispose)
    expect(admission.asyncDispose).toBe(symbolic)
  })

  it('preserves reflection failures without throwing or cleaning up', () => {
    /** Exact source error must remain reachable as failed-admission data. */
    const original = new Error('backend getter failed')
    /** Real resource cleanup remains owned by this caller when admission fails. */
    const base = createBase()
    Object.defineProperty(base, 'backend', {
      get() {
        throw original
      }
    })
    expect(snapshotStorageBaseDetailed(base)).toEqual({ valid: false, cause: original })
    expect(base.dispose).not.toHaveBeenCalled()
    expect(
      snapshotStorageBaseDetailed(base, {
        get asyncDisposeKey(): never {
          throw original
        }
      })
    ).toEqual({ valid: false, cause: original })
  })

  it.each([null, [], {}, { backend: 'Invalid Name' }, { backend: 'a'.repeat(65) }])(
    'rejects invalid base shape %#',
    (candidate) => {
      expect(snapshotStorageBaseDetailed(candidate).valid).toBe(false)
    }
  )

  it('rejects missing fixed disposal and preserves capability getter failures', () => {
    /** This separate canonical key has not been implemented by the candidate. */
    const fixedKey: symbol = Symbol('missing-canonical')
    /** Native resource methods alone do not prove support for a different outer fixed key. */
    const base = createBase()
    expect(
      snapshotStorageBaseDetailed(base, { asyncDisposeKey: fixedKey as typeof Symbol.asyncDispose })
        .valid
    ).toBe(false)
    /** Invalid declared facts must preserve the underlying getter failure for the host. */
    const original = new Error('fact getter failed')
    Object.defineProperty(base.capabilities, 'syncRead', {
      get() {
        throw original
      }
    })
    expect(snapshotStorageBaseDetailed(base)).toEqual({ valid: false, cause: original })
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
