// Capability, SQL, record and RDF query access inside a transaction (see ./transaction.ts).
import {
  type ITransactionRecordsApi,
  type IAnyStorageCapability,
  type ITransactionCapabilityApi,
  StorageCapabilityMethod,
  readCapabilityTokenFacts,
  type records,
  type IQuad,
  SqlQueryMethod,
  type ISqlExecutor,
  type ISqlTag,
  type ISqlInput,
  type ISqlQuery,
  RecordQueryMethod,
  RdfQueryMethod,
  type IQueryResult,
  type IRdfQuery,
  type IStorageKey,
  type IOperationContext
} from '@migaia/storage-contract'
import { readTransactionImplementation } from './capability.ts'
import { deriveStorageSqlQuery } from './sql.ts'
import type { ICodecValue } from '@migaia/serialize/codec'
import { transactionView, invalidTransaction, failTransaction } from './transaction-registration.ts'
import type { ITransactionState } from './transaction-registration.ts'
import { runTransactionOperation } from './transaction.ts'

/**
 * Reads the original backend attempt's context from an authentic live view. Every user, operation
 * and finalizer view shares the same snapshot and original signal. Omitted registration context
 * returns undefined; forged or expired views throw INVALID_ARGUMENT. This grants no registration,
 * cancellation-controller, budget or close authority.
 */
export function readTransactionOperationContext(scope: object): IOperationContext | undefined {
  /** Identity and lifetime use the same private view record as transaction composition. */
  const state = transactionView(scope).state
  if (!state || state.closed || state.firstFailure) throw invalidTransaction()
  return state.context
}

/** Actual record projection values follow the original full backend scope. */
type IScopeRecordValue<TScope> = TScope extends {
  getRecord(key: IStorageKey): Promise<(infer TValue) | undefined>
}
  ? TValue
  : ICodecValue

/** Retrieves only authentic live scope state, never a public store/capabilities lookalike. */
function liveTransactionCapability(
  scope: object,
  capability: IAnyStorageCapability
): {
  readonly state: ITransactionState
  readonly binding: ReturnType<typeof readTransactionImplementation>
} {
  /** The same view record owns cache lifetime, transaction validity and its exact original store. */
  const view = transactionView(scope)
  /** Pure lookup cannot revive an invalidated user, operation or check view. */
  const state = view.state
  if (!state || state.closed || state.firstFailure) throw invalidTransaction()
  return { state, binding: readTransactionImplementation(state.owner.store, capability) }
}

/** Executes one projected method with the original owner's exact authenticated operation view. */
function runTransactionCapabilityMethod(
  scope: object,
  capability: IAnyStorageCapability,
  method: string,
  args: readonly unknown[]
): Promise<unknown> {
  return runTransactionOperation(scope, (operationScope) => {
    /** Re-read publication authority rather than retaining an installation after Feature release. */
    const { binding } = liveTransactionCapability(operationScope, capability)
    /** Only the current operation view reaches backend binding; old views are never reused. */
    const api = (binding as unknown as { forTransaction(scope: object): unknown }).forTransaction(
      operationScope
    )
    return (api as Record<string, (...args: readonly unknown[]) => unknown>)[method]!(...args)
  })
}

/** Fresh native SQL binding runs only inside the original accepted operation and its budget. */
function runTransactionSqlQuery(
  scope: object,
  capability: IAnyStorageCapability,
  fragment: ISqlQuery,
  method: (typeof SqlQueryMethod)[keyof typeof SqlQueryMethod]
): Promise<unknown> {
  return runTransactionOperation(scope, (operationScope) => {
    /** Binding authority is re-read for every terminal, including a saved derived query. */
    const { binding } = liveTransactionCapability(operationScope, capability)
    /** The actual backend tag receives the new full operation view, never the old constructor view. */
    const native = (
      binding as unknown as { forTransaction(scope: object): unknown }
    ).forTransaction(operationScope) as ISqlExecutor
    /** One fragment reference reuses captured nodes and bytes without rereading caller input. */
    const query = native.sql`${fragment}`
    return query[method]()
  })
}

/** Pure SQL composition retains its fragment owner; terminals acquire no independent lifetime. */
function transactionSqlTag(
  scope: object,
  capability: IAnyStorageCapability,
  root: ISqlExecutor
): ISqlTag {
  /** Capture the published pure constructor and tools without entering a binder or native call. */
  const original = root.sql
  /** No SQL text or fragment is compiled during capability lookup or query construction. */
  const empty = original.empty
  /** Construction only captures the original graph; every data terminal enters the same owner. */
  const tag = (strings: TemplateStringsArray, ...values: readonly ISqlInput[]) => {
    /** An expired saved tag cannot construct another transaction-bound operation. */
    const { state } = liveTransactionCapability(scope, capability)
    try {
      /** The root tag supplies pure composition only; its execution callbacks are never selected. */
      const fragment = root.sql(strings, ...values) as ISqlQuery
      return deriveStorageSqlQuery(fragment, {
        all: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.all) as ReturnType<
            ISqlQuery['all']
          >,
        get: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.get) as ReturnType<
            ISqlQuery['get']
          >,
        run: () =>
          runTransactionSqlQuery(scope, capability, fragment, SqlQueryMethod.run) as ReturnType<
            ISqlQuery['run']
          >
      })
    } catch (error) {
      throw failTransaction(state, error)
    }
  }
  return Object.assign(tag, {
    id: (...parts: readonly [string, ...string[]]) => original.id(...parts),
    join: (...args: Parameters<ISqlTag['join']>) => original.join(...args),
    empty
  }) as ISqlTag
}

/** Complete read terminals enter the original operation before validation, execution and cleanup. */
function transactionQueryReads<R>(scope: object, query: IQueryResult<R, undefined>) {
  /** Only business arguments cross this zero-context projection; stream retains its iterator owner. */
  const methods = [
    [RecordQueryMethod.all, 0],
    [RecordQueryMethod.first, 0],
    [RecordQueryMethod.maybe, 0],
    [RecordQueryMethod.firstOrThrow, 0],
    [RecordQueryMethod.pluck, 1],
    [RecordQueryMethod.exists, 0],
    [RecordQueryMethod.count, 0],
    [RecordQueryMethod.each, 1],
    [RecordQueryMethod.chunk, 2],
    [RecordQueryMethod.min, 1],
    [RecordQueryMethod.max, 1],
    [RecordQueryMethod.sum, 1],
    [RecordQueryMethod.avg, 1],
    [RecordQueryMethod.page, 1]
  ] as const
  /** These wrappers borrow the immutable query rather than copying its nodes or owning execution. */
  const reads: Record<string, unknown> = {}
  for (const [method, argumentCount] of methods)
    reads[method] = (...args: readonly unknown[]) =>
      runTransactionOperation(scope, () =>
        (query as unknown as Record<string, (...values: readonly unknown[]) => unknown>)[method]!(
          ...args.slice(0, argumentCount)
        )
      )
  return reads as Pick<IQueryResult<R, undefined>, (typeof methods)[number][0]>
}

/** Actual family writes enter the same original operation before validation or draft access. */
function transactionQueryWrites(scope: object, query: object): Record<string, unknown> {
  /** Only actual family write methods are wrapped; selected read results never enter this helper. */
  const writes: Record<string, unknown> = {}
  for (const [name, argumentCount] of [
    [RecordQueryMethod.delete, 0],
    [RecordQueryMethod.update, 1],
    [RdfQueryMethod.replace, 2]
  ] as const) {
    /** The original method and receiver remain fixed across the borrowed transaction view. */
    const method = Reflect.get(query, name)
    if (typeof method === 'function')
      writes[name] = (...args: readonly unknown[]) =>
        runTransactionOperation(scope, () =>
          (query as Record<string, (...values: readonly unknown[]) => unknown>)[name]!(
            ...args.slice(0, argumentCount)
          )
        )
  }
  return writes
}

/** Adds original-owner admission to the actual selected chain without copying its nodes or plan. */
function transactionQueryResult<R>(
  scope: object,
  query: IQueryResult<R, undefined>
): IQueryResult<R, undefined> {
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    explain: () => query.explain(),
    requirePushdown: () => transactionQueryResult(scope, query.requirePushdown())
  }
}

/**
 * Rewraps only real pure branch constructors. Each returned chain keeps its original method state,
 * while the original terminal wrapper remains responsible for transaction operation admission.
 */
function transactionQueryBranches<TQuery extends IQueryResult<unknown, undefined>>(
  query: TQuery,
  names: readonly string[],
  project: (query: TQuery) => TQuery
): Record<string, unknown> {
  /** The finite result contains functions only, without a query registry, plan or lifecycle state. */
  const branches: Record<string, unknown> = {}
  for (const name of names) {
    /** Canonical immutable query constructors are captured once with their original receiver. */
    const method = Reflect.get(query, name)
    if (typeof method === 'function')
      branches[name] = (...args: readonly unknown[]) =>
        project(
          (query as unknown as Record<string, (...values: readonly unknown[]) => TQuery>)[name]!(
            ...args
          )
        )
  }
  return branches
}

/** Pure controls common to record and RDF queries keep their original family state after branching. */
const transactionQueryBranchMethods = [
  RecordQueryMethod.where,
  RecordQueryMethod.limit,
  RecordQueryMethod.skip,
  RecordQueryMethod.distinct,
  RecordQueryMethod.orderBy,
  RecordQueryMethod.after
] as const

/** Preserves the actual immutable query and every typed branch; only terminal admission is added. */
function transactionRecordQuery<TQuery extends IQueryResult<unknown, undefined>>(
  scope: object,
  query: TQuery
): TQuery {
  /** Original selector/comparator type states are retained by projecting the exact returned chain. */
  const branches = transactionQueryBranches(query, transactionQueryBranchMethods, (next) =>
    transactionRecordQuery(scope, next)
  )
  /** Only comparator-capable states expose this original bounded transition. */
  const comparator = Reflect.get(query, RecordQueryMethod.orderByComparator)
  if (typeof comparator === 'function')
    branches.orderByComparator = (compare: (left: unknown, right: unknown) => number) => {
      /** Comparator admission remains pure and keeps its one original immediate-bound protocol. */
      const pending = (
        query as unknown as {
          orderByComparator(compare: (left: unknown, right: unknown) => number): unknown
        }
      ).orderByComparator(compare) as {
        first(): Promise<unknown>
        limit(count: number): IQueryResult<unknown, undefined>
      }
      return {
        first: () => runTransactionOperation(scope, () => pending.first()),
        limit: (count: number) => transactionRecordQuery(scope, pending.limit(count))
      }
    }
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    ...branches,
    ...transactionQueryWrites(scope, query),
    select: (...args: readonly unknown[]) =>
      transactionQueryResult(
        scope,
        (
          query as unknown as {
            select(...args: readonly unknown[]): IQueryResult<unknown, undefined>
          }
        ).select(...args)
      ),
    explain: () => query.explain(),
    requirePushdown: (): IQueryResult<unknown, undefined> =>
      transactionRecordQuery(scope, query.requirePushdown())
  } as TQuery
}

/** RDF branches reuse the same original node constructors and complete read admission table. */
function transactionRdfQuery(scope: object, query: IRdfQuery<undefined>): IRdfQuery<undefined> {
  return {
    ...query,
    ...transactionQueryReads(scope, query),
    ...transactionQueryWrites(scope, query),
    ...transactionQueryBranches(
      query,
      [...transactionQueryBranchMethods, RdfQueryMethod.follow, RdfQueryMethod.inverse],
      (next) => transactionRdfQuery(scope, next)
    ),
    select: (...args: readonly unknown[]) =>
      transactionQueryResult(
        scope,
        (
          query as unknown as {
            select(...args: readonly unknown[]): IQueryResult<unknown, undefined>
          }
        ).select(...args)
      ),
    explain: () => query.explain(),
    requirePushdown: () => transactionRdfQuery(scope, query.requirePushdown())
  } as IRdfQuery<undefined>
}

/**
 * Reads the original store capability table from an authentic view. Pure lookup invokes no binder
 * or I/O. Cached finite projections keep only this view/token identity; invalidation clears them.
 * Data calls still enter the original operation owner; record query construction remains pure and
 * its authentic backend source supplies the existing iterator/complete-terminal ownership.
 */
export function useTransactionCapability<
  TScope extends { use: (...args: never[]) => unknown },
  TCap extends IAnyStorageCapability & Parameters<TScope['use']>[0]
>(
  scope: TScope,
  capability: TCap
): TCap extends typeof records
  ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
  : ITransactionCapabilityApi<TCap> {
  /** Membership is checked before returning even a previously cached projection. */
  const { binding } = liveTransactionCapability(scope, capability)
  /** The current view is already proved authentic and active by the same owner lookup. */
  const view = transactionView(scope)
  /** One cached API object per actual implementation and view preserves pure lookup identity. */
  const previous = view.capabilities?.get(capability)
  if (previous?.implementation === binding.implementation)
    return previous.api as TCap extends typeof records
      ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
      : ITransactionCapabilityApi<TCap>
  /** Complete finite methods delegate to the original binder only when an operation actually runs. */
  const api: Record<string, unknown> = {}
  /** Projection facts remain on the authentic token row, outside the backend binder receiver. */
  const transaction = readCapabilityTokenFacts(capability)!.transaction!
  if (transaction.query) {
    /**
     * Queries bind the current user/check/operation view without opening a cursor during
     * construction.
     */
    api.query = () => {
      /**
       * Actual native sources retain this original view and register their iterators with its
       * owner.
       */
      const { state, binding } = liveTransactionCapability(scope, capability)
      try {
        /** The backend's pure query constructor must use its real scope, never a root API. */
        const bound = (
          binding as unknown as { forTransaction(scope: object): unknown }
        ).forTransaction(scope)
        return transactionRecordQuery(
          scope,
          (bound as { query(): IQueryResult<unknown, undefined> }).query()
        )
      } catch (error) {
        throw failTransaction(state, error)
      }
    }
    api.removeByPrefix = (prefix: IStorageKey) =>
      runTransactionCapabilityMethod(scope, capability, StorageCapabilityMethod.removeByPrefix, [
        prefix
      ])
  }
  if (transaction.rdf)
    api.match = (pattern: Partial<IQuad>) => {
      /** Pure construction binds the actual native scope without registering another owner. */
      const { state, binding } = liveTransactionCapability(scope, capability)
      try {
        /** The backend supplies its real ground query source and original iterator registration. */
        const bound = (
          binding as unknown as { forTransaction(scope: object): unknown }
        ).forTransaction(scope)
        return transactionRdfQuery(
          scope,
          (bound as { match(pattern: Partial<IQuad>): IRdfQuery<undefined> }).match(pattern)
        )
      } catch (error) {
        throw failTransaction(state, error)
      }
    }
  if (transaction.sql)
    api.sql = transactionSqlTag(scope, capability, binding.implementation.api as ISqlExecutor)
  /** Standard scalar methods use the original fresh-view operation path, without token imports. */
  for (const method of transaction.methods)
    api[method] = (...args: readonly unknown[]) =>
      runTransactionCapabilityMethod(
        scope,
        capability,
        method,
        transaction.rdf ? args.slice(0, 1) : args
      )
  /** Cache only the projection identity; the original backend scope and API remain borrowed. */
  ;(view.capabilities ??= new Map()).set(capability, {
    implementation: binding.implementation,
    api
  })
  return api as TCap extends typeof records
    ? ITransactionRecordsApi<IScopeRecordValue<TScope>>
    : ITransactionCapabilityApi<TCap>
}
