import type { IAnyStorageCapability, IStorageStore } from '../capability.js'
import { kv } from '../capabilities/kv.js'
import type { ITransactionKeyValueApi } from '../transaction.js'
import { rdf, RdfTermType, RdfDatatype, type ITransactionRdfApi } from '../capabilities/rdf.js'
import type { IOperationContext } from '../context.js'
import type { IConformanceCase, IConformanceHarness } from './harness.js'
import { conformanceApi } from './harness.js'

/** Deliberate user failure tests atomic rollback without prescribing a backend's error family. */
const ROLLBACK_FAILURE = 'conformance native transaction rollback'
/** These finite views exercise only the actual token selected from this subject's declaration. */
type INativeValues = {
  write(name: string): Promise<void>
  remove(name: string): Promise<void>
  has(name: string): Promise<boolean>
}

/** Capture the original transaction entry; registration and lifecycle stay with the backend. */
function nativeTransaction(
  store: IStorageStore<never>,
  harness: IConformanceHarness,
  run: (scope: object) => unknown,
  ctx?: IOperationContext
): Promise<unknown> {
  /** A declared transaction without its native entry is an assertion failure, never a skipped case. */
  const native = store as unknown as {
    transaction(run: (scope: object) => unknown, ctx?: IOperationContext): Promise<unknown>
  }
  harness.expect(typeof native.transaction).toBe('function')
  return native.transaction(run, ctx)
}

/** Normalize only this suite's finite writes, without adding a store, runner or transaction owner. */
function nativeValues(
  store: IStorageStore<never>,
  capabilities: readonly IAnyStorageCapability[],
  harness: IConformanceHarness,
  scope?: object
): INativeValues {
  /** Pure RDF native scopes use their original overload; KV-only subjects use their short KV view. */
  const capability = capabilities.includes(rdf) ? rdf : kv
  harness.expect(capabilities.includes(capability)).toBe(true)
  /** Scope use is checked rather than casting the native base into a generic KV transaction. */
  const native = scope as { use(capability: IAnyStorageCapability): unknown } | undefined
  if (native !== undefined) harness.expect(typeof native.use).toBe('function')
  if (capability === rdf) {
    /** Quad identity is native ground RDF identity, so rollback is observable without any text key. */
    const api: ITransactionRdfApi =
      native === undefined ? conformanceApi(store, rdf) : (native.use(rdf) as ITransactionRdfApi)
    /** Each case owns fresh deterministic quads in the subject's isolated logical fixture. */
    const quad = (name: string) => ({
      subject: {
        termType: RdfTermType.namedNode,
        value: `urn:conformance:transaction:${name}`
      } as const,
      predicate: {
        termType: RdfTermType.namedNode,
        value: 'urn:conformance:transaction:value'
      } as const,
      object: {
        termType: RdfTermType.literal,
        value: name,
        datatype: RdfDatatype.string
      } as const,
      graph: { termType: RdfTermType.defaultGraph } as const
    })
    return {
      write: (name) => api.add([quad(name)]),
      remove: (name) => api.delete([quad(name)]),
      has: async (name) => (await api.match(quad(name)).count()) === 1
    }
  }
  /** The original root KV API is a structural superset of the native zero-context short view. */
  const api: ITransactionKeyValueApi =
    native === undefined ? conformanceApi(store, kv) : (native.use(kv) as ITransactionKeyValueApi)
  return {
    write: (name) => api.set(name, name),
    remove: (name) => api.remove(name),
    has: async (name) => (await api.get(name)) === name
  }
}

/** Non-record native transactions prove the same commit, rollback and accepted-work guarantees. */
export function nativeTransactionsConformance(
  check: IConformanceCase,
  harness: IConformanceHarness,
  capabilities: readonly IAnyStorageCapability[]
): void {
  /** Assertion behavior remains owned by the consumer's original harness. */
  const expect = harness.expect
  if (!capabilities.includes(kv) && !capabilities.includes(rdf)) {
    check('transactions · native callback result, failure and cancellation', async (store) => {
      /** Unknown/custom write semantics are not inferred; the common callback contract stays tested. */
      let calls = 0
      await expect(
        nativeTransaction(store, harness, () => {
          calls += 1
          return 'conformance-transaction-result'
        })
      ).resolves.toBe('conformance-transaction-result')
      expect(calls).toBe(1)
      await expect(
        nativeTransaction(store, harness, () => {
          throw new Error(ROLLBACK_FAILURE)
        })
      ).rejects.toThrow()
      const controller = new AbortController()
      await expect(
        nativeTransaction(
          store,
          harness,
          () => {
            controller.abort()
          },
          { signal: controller.signal }
        )
      ).rejects.toMatchObject({ code: 'ABORTED' })
    })
    return
  }
  check('transactions · native accepted writes drain before atomic commit', async (store) => {
    /** The backend must await this accepted operation even though the user callback returns first. */
    await nativeTransaction(store, harness, (scope) => {
      void nativeValues(store, capabilities, harness, scope).write('accepted')
    })
    await expect(nativeValues(store, capabilities, harness).has('accepted')).resolves.toBe(true)
  })
  check('transactions · native callback failure rolls back the complete draft', async (store) => {
    /** Existing and newly inserted values distinguish rollback from a silently discarded callback. */
    const values = nativeValues(store, capabilities, harness)
    await values.write('existing')
    await expect(
      nativeTransaction(store, harness, async (scope) => {
        /** Both draft mutations must share the native transaction. */
        const draft = nativeValues(store, capabilities, harness, scope)
        await draft.remove('existing')
        await draft.write('rolled-back')
        throw new Error(ROLLBACK_FAILURE)
      })
    ).rejects.toThrow()
    await expect(values.has('existing')).resolves.toBe(true)
    await expect(values.has('rolled-back')).resolves.toBe(false)
  })
  check('transactions · native callback abort prevents draft commit', async (store) => {
    /** The subject's original transaction option observes the caller's signal. */
    const controller = new AbortController()
    await expect(
      nativeTransaction(
        store,
        harness,
        async (scope) => {
          await nativeValues(store, capabilities, harness, scope).write('aborted')
          controller.abort()
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(nativeValues(store, capabilities, harness).has('aborted')).resolves.toBe(false)
  })
}
