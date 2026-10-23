import type { IRecordIndexHandle } from '../secondary-index.js'
import type { IStorageCapabilities } from '../capabilities.js'
import type { IAnyStorageCapability, ICapabilityApi, IStorageStore } from '../capability.js'
import type { IStorageIterator, IStorageResource } from '../resource.js'
import { snapshotStorageBaseDetailed } from '../store.js'
import { isCapabilityToken, readCapabilityTokenFacts } from '../capability-token.js'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { kv } from '../capabilities/kv.js'
import { records } from '../capabilities/records.js'
import { ttl } from '../capabilities/ttl.js'
import { counter } from '../capabilities/counter.js'
import { sql } from '../capabilities/sql.js'
import { vector } from '../capabilities/vector.js'
import { rdf } from '../capabilities/rdf.js'
import { sparql } from '../capabilities/sparql.js'
import { blob } from '../capabilities/blob.js'
import { durableChangeFeed } from '../capabilities/durable-change-feed.js'

/** Consumer-owned assertion vocabulary; this entry imports no test runner. */
export type IConformanceMatchers = {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
  toBeUndefined(): void
  toBeDefined(): void
  toThrow(expected?: string | RegExp): void
  toMatchObject(expected: object): void
}
/** Async assertions retain the arguments of their synchronous counterparts. */
export type IConformanceAsyncMatchers = {
  [K in keyof IConformanceMatchers]: (...args: Parameters<IConformanceMatchers[K]>) => Promise<void>
}
/** Registration and execution remain entirely with the consumer's existing runner. */
export type IConformanceHarness = {
  describe(name: string, run: () => void | PromiseLike<void>): void
  it(name: string, run: () => void | PromiseLike<void>): void
  expect(actual: unknown): IConformanceMatchers & {
    readonly resolves: IConformanceAsyncMatchers
    readonly rejects: IConformanceAsyncMatchers
  }
}
/**
 * Each invocation creates an empty isolated logical fixture; no store or data survives between
 * cases.
 */
export type IConformanceSubject<TStore extends IStorageStore<never>> = {
  readonly name: string
  readonly create: () => TStore | PromiseLike<TStore>
  readonly capabilities: readonly IAnyStorageCapability[]
  readonly features: IStorageCapabilities
  /** Let the native owner prepare this fresh empty fixture's index generation before assertions. */
  readonly prepareSecondaryIndexes?: (
    store: TStore,
    handle: IRecordIndexHandle
  ) => void | PromiseLike<void>
}
/** Private registration adapter borrows one original store for exactly one case. */
export type IConformanceCase = (
  name: string,
  run: (store: IStorageStore<never>) => void | PromiseLike<void>
) => void
/** Fixed standard identities catch both false declarations and omitted actual capabilities. */
const STANDARD_CAPABILITIES = [
  kv,
  records,
  ttl,
  counter,
  sql,
  vector,
  rdf,
  sparql,
  blob,
  durableChangeFeed
]

/** Uses the subject's original use method, so direct contract implementations need no host. */
export function conformanceApi<TCap extends IAnyStorageCapability>(
  store: IStorageStore<never>,
  capability: TCap
): ICapabilityApi<TCap> {
  return Reflect.apply(store.use, store, [capability]) as ICapabilityApi<TCap>
}

/** Assert the complete declared snapshots and authentic token shape for every fresh fixture. */
export function inspectConformanceSubject<TStore extends IStorageStore<never>>(
  harness: IConformanceHarness,
  subject: IConformanceSubject<TStore>,
  store: TStore
): void {
  /** Original admission owns resource, backend and capability descriptor validation. */
  const admitted = snapshotStorageBaseDetailed(store, { asyncDisposeKey: Symbol.asyncDispose })
  harness.expect(admitted.valid).toBe(true)
  harness.expect(admitted.valid ? admitted.capabilities : undefined).toEqual(subject.features)
  harness.expect(typeof store.has).toBe('function')
  harness.expect(typeof store.use).toBe('function')
  for (const capability of STANDARD_CAPABILITIES)
    harness.expect(store.has(capability)).toBe(subject.capabilities.includes(capability))
  for (const capability of subject.capabilities) {
    harness.expect(isCapabilityToken(capability)).toBe(true)
    harness.expect(store.has(capability)).toBe(true)
    /** Standard shape rules reuse the token's original validator; custom semantics stay unknown. */
    const api = conformanceApi(store, capability)
    readCapabilityTokenFacts(capability)?.validate(api)
  }
}

/** Run one case body and finally dispose only its borrowed original resource, retaining both errors. */
export async function conformanceCleanup<T>(
  resource: IStorageResource | (() => void | PromiseLike<void>),
  run: () => T | PromiseLike<T>
): Promise<Awaited<T>> {
  /** Captured success is returned only after the original cleanup has settled. */
  let result: Awaited<T> | undefined
  /** A separate flag retains even a deliberately thrown undefined as the primary failure. */
  let failed = false
  /** The consumer's original assertion or backend error remains reachable after cleanup. */
  let primary: unknown
  /** Cleanup failure is raised after finally so it cannot override the captured primary. */
  let cleanupFailed = false
  /** The exact original disposal rejection remains the secondary failure. */
  let cleanupFailure: unknown
  try {
    result = await run()
  } catch (error) {
    failed = true
    primary = error
  } finally {
    try {
      await (typeof resource === 'function' ? resource() : resource.dispose())
    } catch (error) {
      cleanupFailed = true
      cleanupFailure = error
    }
  }
  if (cleanupFailed)
    throw failed ? attachSecondaryErrors(primary, [cleanupFailure]) : cleanupFailure
  if (failed) throw primary
  return result as Awaited<T>
}

/** Every selected case creates its own fixture; no owner, resource cache or runner is introduced. */
export function conformanceCases<TStore extends IStorageStore<never>>(
  harness: IConformanceHarness,
  subject: IConformanceSubject<TStore>
): IConformanceCase {
  return (name, run) =>
    harness.it(name, async () => {
      /** Construction failure creates no cleanup obligation; successful construction does. */
      const store = await subject.create()
      await conformanceCleanup(store, async () => {
        inspectConformanceSubject(harness, subject, store)
        await run(store)
      })
    })
}

/** Exhaust a provider's original stream and dispose through its original cached cleanup path. */
export function conformanceRows<T>(iterator: IStorageIterator<T>): Promise<T[]> {
  return conformanceCleanup(iterator, async () => {
    /** Only this case's observed rows are retained, never a resource or cross-case cache. */
    const rows: T[] = []
    for await (const row of iterator) rows.push(row)
    return rows
  })
}
