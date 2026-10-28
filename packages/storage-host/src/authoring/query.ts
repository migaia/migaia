import {
  QueryOperation,
  type IQueryWriteContext,
  type IQueryCursor,
  type IQueryWatch,
  type IQueryResult,
  type IRecordQuery,
  type IVectorQueryOrigin,
  type IVectorReranker,
  type IVectorRerankOptions,
  type IVectorQueryRefinement,
  type IVectorNativeQuery,
  type IVectorQueryBuilder,
  type IVectorQuery,
  type IRdfQuery,
  RecordQueryMethod,
  VectorQueryMethod,
  RdfQueryMethod,
  type IRecordQuerySource,
  type IRecordQueryInput,
  type IQueryWatcher,
  type IVectorQueryInput,
  type IVectorQuerySource,
  type IRdfQueryInput,
  type IRdfQuerySource,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageKey,
  type IWriteConcurrencyOptions,
  type IQuad,
  type IRdfNamedNode
} from '@migaia/storage-contract'
import { snapshotStorageRdfPattern, snapshotStorageRdfQuad } from './rdf.js'
import { RecordQueryKeysetOwner } from './query-keyset.js'
import {
  invalidQueryCondition,
  snapshotStorageWhere,
  snapshotRecordQueryMethods,
  invalidQueryArgument
} from './query-condition.js'
import {
  assertQueryField,
  mutateRecordQuery,
  queryWriteContext,
  snapshotQueryPatch,
  consumeRecordQuery
} from './query-execution.js'
import {
  queryExecutionFailure,
  QueryOrderMode,
  snapshotQuerySource,
  sameQueryCondition,
  QueryKeyDirection,
  QueryOrderDirection,
  QueryOrderField
} from './query-plan.js'
import type { IQuerySourceSnapshot, IQueryNode } from './query-plan.js'
import {
  snapshotQueryOrder,
  queryOrderingBytes,
  snapshotQuerySourceKey,
  assertQueryActive,
  compileVectorGroupReader,
  compileQueryTraversal
} from './query-reader.js'
import { recordQueryReads } from './query-record-reads.js'
import { compileVectorRerankReader, snapshotVectorQueryOrigin } from './query-vector-rerank.js'
import {
  familyQueryReads,
  queryWatch,
  snapshotQueryWhere,
  snapshotQueryFields
} from './query-steps.js'

/** Creates selected terminals without falsely advertising another select or unsupported terminals. */
function selectedRecordQuery<
  R,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
>(
  source: IQuerySourceSnapshot,
  node: IQueryNode,
  strict: boolean,
  methods: TAugmentMethods | undefined
): IQueryResult<R, TContext, true, TAugmentMethods> {
  return {
    ...methods,
    ...familyQueryReads<R, TContext>(source, node, strict),
    ...(source.vector?.reranked || source.vector?.native !== undefined
      ? {}
      : {
          ...queryWatch(source, node),
          requirePushdown: () =>
            selectedRecordQuery<R, TContext, TAugmentMethods>(source, node, true, methods)
        })
  } as IQueryResult<R, TContext, true, TAugmentMethods>
}

/** Derivation shares history and captured source facts; each chain owns no I/O or resource lifetime. */
/** A fluent record branch owns only its source, persistent history and pure method definition. */
class RecordQueryBranch<
  T,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
> {
  /** Execution stays with the original source; this branch opens no native resource. */
  readonly #source: IQuerySourceSnapshot
  /** An appended branch retains the same immutable predecessor instead of cloning history. */
  readonly #node: IQueryNode | undefined
  /** Strict native pushdown is query intent consumed by the same original planner. */
  readonly #strict: boolean
  /** Pure Feature functions retain identity and use the actual published branch as receiver. */
  readonly #methods: TAugmentMethods | undefined
  /** Selector/comparator states remain mutually exclusive on the runtime facade. */
  readonly #ordering: 'selector' | 'comparator' | undefined
  /** Retain branch configuration without starting I/O or another lifetime. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    methods: TAugmentMethods | undefined,
    ordering?: 'selector' | 'comparator'
  ) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#methods = methods
    this.#ordering = ordering
  }
  /** Append one admitted condition node while sharing all prior history. */
  readonly #where = (...args: readonly unknown[]): IRecordQuery<T, TContext, TAugmentMethods> => {
    /** Family dispatch shares the canonical condition/path snapshot. */
    const step = snapshotQueryWhere(args)
    return recordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods,
      this.#ordering
    )
  }
  /** Preserve the single projection transition without granting another select terminal. */
  readonly #select = (
    ...args: readonly unknown[]
  ): IQueryResult<unknown, TContext, true, TAugmentMethods> => {
    /** A function is an opaque mapper; it is never parsed or presented as native projection. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods
    )
  }
  /** Publish finite fluent commands backed by this named branch owner. */
  build(): IRecordQuery<T, TContext, TAugmentMethods> {
    return {
      ...this.#methods,
      /** Limit is an immutable streaming node; zero requires no candidate advance. */
      limit: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.limit, count } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /** Distinct values retain the first row in this stage's current order. */
      distinct: (field: string) => {
        assertQueryField(field)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.distinct, field } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /** Offset is explicit linear work; native execution requires the source's finite opt-in. */
      skip: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.skip, count } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      after: (cursor: IQueryCursor) => {
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          {
            previous: this.#node,
            step: this.#source.keyset?.after(cursor) ?? this.#source.missingKeyset!()
          },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /**
       * Selector refinements use canonical byte ordering and preserve the original primary-key
       * tail.
       */
      orderBy: (selector: (row: T) => IStorageKey, direction?: 'asc' | 'desc') => {
        if (this.#ordering === QueryOrderMode.comparator)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: snapshotQueryOrder(selector, direction) },
          this.#strict,
          this.#methods,
          QueryOrderMode.selector
        )
      },
      /** Comparator state cannot execute until the next node supplies its bounded heap size. */
      ...(this.#ordering === QueryOrderMode.selector
        ? {}
        : {
            orderByComparator: (compare: (left: T, right: T) => number) => {
              if (typeof compare !== 'function')
                throw invalidQueryCondition(
                  undefined,
                  StorageContractErrorText.queryComparatorLimit
                )
              return recordQuery<T, TContext, TAugmentMethods>(
                this.#source,
                {
                  previous: this.#node,
                  step: {
                    operation: QueryOperation.comparator,
                    compare: compare as (left: unknown, right: unknown) => number
                  }
                },
                this.#strict,
                this.#methods,
                QueryOrderMode.comparator
              )
            }
          }),
      where: this.#where,
      select: this.#select,
      /** Actual record writes remain inside the backend's original pipeline and transaction. */
      delete: (ctx?: IQueryWriteContext<TContext>) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.delete,
          ...queryWriteContext(ctx)
        }),
      update: (patch: Partial<T>, ctx?: IQueryWriteContext<TContext>) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.update,
          patch: snapshotQueryPatch(patch),
          ...queryWriteContext(ctx)
        }),
      ...recordQueryReads<T, TContext>(this.#source, this.#node, this.#strict),
      ...queryWatch(this.#source, this.#node),
      requirePushdown: () =>
        recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          this.#node,
          true,
          this.#methods,
          this.#ordering
        )
    } as unknown as IRecordQuery<T, TContext, TAugmentMethods>
  }
}

function recordQuery<
  T,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  methods: TAugmentMethods | undefined,
  ordering?: 'selector' | 'comparator'
): IRecordQuery<T, TContext, TAugmentMethods> {
  return new RecordQueryBranch<T, TContext, TAugmentMethods>(
    source,
    node,
    strict,
    methods,
    ordering
  ).build()
}

/**
 * Creates the shared record condition/projection/limit/comparator read executor from one backend
 * author callback. Native projection rows are intentionally unknown; T declares the complete
 * pre-projection row domain. Construction performs no I/O. Every all invocation plans once, passes
 * only the safe native prefix, preserves callback order and awaits the original storage iterator's
 * disposal on success or failure. The original source owns operation timing and transaction
 * lifetime.
 */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource & { readonly watch: IQueryWatcher<IRecordQueryInput> },
  methods?: TAugmentMethods
): IRecordQuery<
  T,
  TContext,
  TAugmentMethods & (TContext extends undefined ? Record<never, never> : IQueryWatch<TContext>)
>

/** Sources without a declared native feed preserve their original read/write family shape. */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(source: IRecordQuerySource, methods?: TAugmentMethods): IRecordQuery<T, TContext, TAugmentMethods>

/** Captures original source support without subscribing or constructing another lifetime owner. */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource,
  methods?: TAugmentMethods
): IRecordQuery<T, TContext, TAugmentMethods> {
  /** Feature-owned pure functions are captured once and retained by reference on every branch. */
  const captured = snapshotRecordQueryMethods(methods)
  return recordQuery<T, TContext, TAugmentMethods>(
    { ...snapshotQuerySource(source), keyset: createRecordQueryKeysetOwner() },
    undefined,
    false,
    captured
  )
}

/** The keyset owner borrows finite pure helpers and the original accepted terminal runner. */
export type IRecordQueryKeysetContext = {
  readonly invalid: typeof invalidQueryCondition
  readonly sameCondition: typeof sameQueryCondition
  readonly orderingBytes: typeof queryOrderingBytes
  readonly sourceKey: typeof snapshotQuerySourceKey
  readonly consume: typeof consumeRecordQuery
  readonly active: typeof assertQueryActive
  readonly keyDirection: typeof QueryKeyDirection
  readonly orderDirection: typeof QueryOrderDirection
  readonly orderField: typeof QueryOrderField
}

/** Only full authoring constructors retain the keyset implementation and its helper references. */
function createRecordQueryKeysetOwner(): RecordQueryKeysetOwner {
  return new RecordQueryKeysetOwner({
    invalid: invalidQueryCondition,
    sameCondition: sameQueryCondition,
    orderingBytes: queryOrderingBytes,
    sourceKey: snapshotQuerySourceKey,
    consume: consumeRecordQuery,
    active: assertQueryActive,
    keyDirection: QueryKeyDirection,
    orderDirection: QueryOrderDirection,
    orderField: QueryOrderField
  })
}

/**
 * Construct the same record executor without retaining pagination implementation. The caller owns
 * the coded missing-unit error; ordinary reads and derived branches keep their original semantics.
 */
export function createRecordQueryWithoutKeyset<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource,
  methods?: TAugmentMethods,
  missingKeyset: () => never = () => {
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  }
): IRecordQuery<T, TContext, TAugmentMethods> {
  /** Feature callbacks retain their original identity on every derived branch. */
  const captured = snapshotRecordQueryMethods(methods)
  return recordQuery<T, TContext, TAugmentMethods>(
    { ...snapshotQuerySource(source), missingKeyset },
    undefined,
    false,
    captured
  )
}

/** The finite author closure derives an existing query; it grants no store, source or close handle. */
const vectorQueryRefinement = Symbol()

/** A source that explicitly accepts native facts can derive only its own already bounded query. */
type IVectorQueryAuthor = (refine: (topK: number) => IVectorQueryRefinement) => object

/**
 * Native Feature authors retain this exact source and immutable nodes. Only the selected backend
 * interprets its captured opaque fact; the common planner still owns conditions, context and
 * reads.
 */
export function refineStorageVectorQuery<
  TPayload,
  TGroupable extends boolean,
  TWithVector extends boolean,
  TMethods extends object
>(
  query: IVectorQuery<TPayload, TGroupable, TWithVector, TMethods>,
  refine: (topK: number) => IVectorQueryRefinement
): IVectorNativeQuery<TPayload, TGroupable, TWithVector, TMethods> {
  try {
    if (typeof query !== 'object' || query === null || typeof refine !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    /** This closure can derive only the original query that already granted it. */
    const author: unknown = Reflect.get(query, vectorQueryRefinement)
    if (typeof author !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return (author as IVectorQueryAuthor)(refine) as IVectorNativeQuery<
      TPayload,
      TGroupable,
      TWithVector,
      TMethods
    >
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}

/** Family branches retain the original source and immutable nodes without opening resources. */
class FamilyQueryBranch {
  /** The backend source remains the sole owner of native execution and resource lifetime. */
  readonly #source: IQuerySourceSnapshot
  /** One persistent node identifies this branch's conditions and refinements. */
  readonly #node: IQueryNode | undefined
  /** Strict branches require every stage to use the existing native pushdown path. */
  readonly #strict: boolean
  /** Feature methods retain their original function identities across branch derivation. */
  readonly #methods: object | undefined
  /** Only bounded vector branches expose terminals, grouping and reranking. */
  readonly #bounded: boolean
  /** The original engine bound constrains every finite vector refinement. */
  readonly #bound: number | undefined

  /** Captures branch facts without acquiring a cursor, lease or subscription. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    methods: object | undefined,
    bounded: boolean,
    bound?: number
  ) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#methods = methods
    this.#bounded = bounded
    this.#bound = bound
  }

  /** Appending one node preserves the persistent history and its original native bound. */
  #append(step: IQueryNode['step']): object {
    return familyQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods,
      this.#bounded || step.operation === QueryOperation.topK,
      step.operation === QueryOperation.topK ? step.count : this.#bound
    )
  }

  /** Selection ends family refinement while preserving the original read executor. */
  readonly #select = (...args: readonly unknown[]): object => {
    /** The existing dispatcher permits one field projection or asynchronous mapping transition. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods
    )
  }

  /** Vector projection retains the same source, score order and already captured request. */
  readonly #withVector = (): object =>
    familyQuery(
      { ...this.#source, vector: { ...this.#source.vector!, withVector: true } },
      this.#node,
      this.#strict,
      this.#methods,
      this.#bounded,
      this.#bound
    )

  /** Captures one scorer and validates its bound before any native or scorer execution. */
  readonly #rerank = (
    scorer: IVectorReranker<unknown, boolean>,
    options?: IVectorRerankOptions
  ): object => {
    /** A native refinement can narrow the candidate count without changing engine topK. */
    const vector = this.#source.vector!
    /** The selected native or engine limit remains authoritative for this branch. */
    const limit = vector.native?.topN ?? this.#bound!
    if (
      typeof scorer !== 'function' ||
      vector.origin === undefined ||
      (options !== undefined &&
        (typeof options !== 'object' || options === null || Array.isArray(options)))
    )
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
    /** Options are ordinary supported input; the bound is retained across later scorer awaits. */
    const topN = options?.topN ?? limit
    if (!Number.isSafeInteger(topN) || topN <= 0 || topN > limit)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
    /** Origin is already detached from caller mutation before the query begins execution. */
    const origin = vector.origin
    return familyQuery(
      { ...this.#source, vector: { ...vector, reranked: true } },
      {
        previous: this.#node,
        step: {
          operation: QueryOperation.rerank,
          compile: (upstream, ctx) => compileVectorRerankReader(upstream, ctx, origin, scorer, topN)
        }
      },
      this.#strict,
      this.#methods,
      true,
      this.#bound
    )
  }

  /** Grouping retains each key's bounded best-hit prefix within the original native topK. */
  readonly #groupBy = (field: string, options: { readonly perGroup: number }): object => {
    assertQueryField(field)
    /** The scalar count is captured before subsequent query and native execution awaits. */
    const perGroup = options.perGroup
    if (!Number.isSafeInteger(perGroup) || perGroup <= 0)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return selectedRecordQuery(
      this.#source,
      {
        previous: this.#node,
        step: {
          operation: QueryOperation.groupBy,
          field,
          perGroup,
          compile: (upstream) => compileVectorGroupReader(upstream, field, perGroup)
        }
      },
      this.#strict,
      this.#methods
    )
  }

  /** Native authors can derive only this already bounded query and receive no resource authority. */
  readonly #refine = (refine: (topK: number) => IVectorQueryRefinement): object => {
    /** Feature-owned facts are captured once before native execution begins. */
    const captured = refine(this.#bound!)
    if (captured === null || typeof captured !== 'object')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    /** The opaque fact belongs to the backend; only its finite bound is shared by the planner. */
    const { native, topN } = captured
    if (native === undefined || !Number.isSafeInteger(topN) || topN <= 0 || topN > this.#bound!)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return familyQuery(
      { ...this.#source, vector: { ...this.#source.vector!, native: { native, topN } } },
      this.#node,
      this.#strict,
      this.#methods,
      true,
      this.#bound
    )
  }

  /** Builds the finite native vector surface appropriate to this branch's current phase. */
  #vector(shared: object): object {
    /** Vector metadata is a branch fact, not a second execution or resource owner. */
    const vector = this.#source.vector!
    /** Group support is advertised only after the original source is bounded. */
    const groups = this.#bounded && vector.groupBy ? { groupBy: this.#groupBy } : {}
    if (vector.reranked || vector.native !== undefined)
      return {
        ...this.#methods,
        ...familyQueryReads(this.#source, this.#node, this.#strict),
        select: this.#select,
        ...groups,
        ...(vector.reranked ? {} : { withVector: this.#withVector, rerank: this.#rerank })
      }
    /** Ordinary branches preserve the original pre/post-topK runtime surface. */
    const result = {
      ...shared,
      minScore: (score: number) => {
        if (typeof score !== 'number' || !Number.isFinite(score))
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({ operation: QueryOperation.minScore, score })
      },
      withVector: this.#withVector,
      topK: (count: number) => {
        if (!Number.isSafeInteger(count) || count <= 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({ operation: QueryOperation.topK, count })
      },
      ...(this.#bounded
        ? {
            ...familyQueryReads(this.#source, this.#node, this.#strict),
            ...queryWatch(this.#source, this.#node),
            delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
              mutateRecordQuery(this.#source, this.#node, this.#strict, {
                operation: RecordQueryMethod.delete,
                ...queryWriteContext(ctx)
              }),
            select: this.#select,
            rerank: this.#rerank,
            distinct: (field: string) => {
              assertQueryField(field)
              return this.#append({ operation: QueryOperation.distinct, field })
            },
            ...groups
          }
        : {})
    }
    if (this.#bounded && vector.acceptsNative)
      Object.defineProperty(result, vectorQueryRefinement, { value: this.#refine })
    return result
  }

  /** RDF refinements reuse the canonical ground-term validators and the original cursor owner. */
  #rdf(shared: object): object {
    return {
      ...shared,
      ...familyQueryReads(this.#source, this.#node, this.#strict),
      ...queryWatch(this.#source, this.#node),
      delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.delete,
          ...queryWriteContext(ctx)
        }),
      replace: (
        oldQuad: IQuad,
        newQuad: IQuad,
        ctx?: IOperationContext & IWriteConcurrencyOptions
      ) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RdfQueryMethod.replace,
          oldQuad: snapshotStorageRdfQuad(oldQuad, undefined),
          newQuad: snapshotStorageRdfQuad(newQuad, undefined),
          ...queryWriteContext(ctx)
        }),
      select: this.#select,
      distinct: (field: string) => {
        assertQueryField(field)
        return this.#append({ operation: QueryOperation.distinct, field })
      },
      skip: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return this.#append({ operation: QueryOperation.skip, count })
      },
      after: (cursor: IQueryCursor) => this.#append(this.#source.keyset!.after(cursor)),
      orderBy: (selector: (quad: IQuad) => IStorageKey, direction?: 'asc' | 'desc') =>
        this.#append(snapshotQueryOrder(selector, direction)),
      limit: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return this.#append({ operation: QueryOperation.limit, count })
      },
      follow: (predicate: IRdfNamedNode, target?: IRdfNamedNode) => {
        /** Captured ground terms survive query construction and subsequent native awaits. */
        const captured = snapshotStorageRdfPattern(
          { predicate, ...(target === undefined ? {} : { subject: target }) },
          undefined
        )
        if (captured.predicate === undefined)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({
          operation: QueryOperation.follow,
          predicate: captured.predicate!,
          compile: compileQueryTraversal,
          ...(captured.subject === undefined ? {} : { target: captured.subject })
        })
      },
      inverse: (predicate: IRdfNamedNode) => {
        /** Predicate admission rejects request-local blank nodes before source I/O. */
        const captured = snapshotStorageRdfPattern({ predicate }, undefined)
        if (captured.predicate === undefined)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({
          operation: QueryOperation.inverse,
          predicate: captured.predicate!,
          compile: compileQueryTraversal
        })
      }
    }
  }

  /** Publishes only the family methods supported by the original source and branch phase. */
  build(): object {
    /** Condition dispatch and strict planning remain common to vector and RDF branches. */
    const shared = {
      ...this.#methods,
      where: (...args: readonly unknown[]) => this.#append(snapshotQueryWhere(args)),
      requirePushdown: () =>
        familyQuery(this.#source, this.#node, true, this.#methods, this.#bounded, this.#bound)
    }
    return this.#source.vector === undefined ? this.#rdf(shared) : this.#vector(shared)
  }
}

/** Derives a family branch without opening I/O or adding another resource lifetime. */
function familyQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  methods: object | undefined,
  bounded: boolean,
  bound?: number
): object {
  return new FamilyQueryBranch(source, node, strict, methods, bounded, bound).build()
}

/**
 * Creates a pre-topK vector builder. The backend keeps native scoring and ranking; the canonical
 * planner sends all translatable payload conditions before ranking, even across client predicates.
 * No cursor opens during construction, explanation or immutable refinement.
 */
export function createVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IVectorQuerySource<TPayload, TGroupable> & {
    readonly watch: IQueryWatcher<IVectorQueryInput>
  },
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods & IQueryWatch>

/** No native source watcher means the original pre-topK builder has no watch projection. */
export function createVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IVectorQuerySource<TPayload, TGroupable>,
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>

/** Captures one native vector source and no subscription or client ranking platform. */
export function createVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IVectorQuerySource<TPayload, TGroupable>,
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods> {
  /** Original descriptor admission captures every existing support/resource field once. */
  const captured = snapshotQuerySource(source as unknown as IRecordQuerySource)
  /** Optional finite source facts are borrowed only after existing descriptor admission finishes. */
  let exact: boolean | undefined
  /** Group support is finite author metadata rather than another provider or runtime registry. */
  let groupBy: boolean | undefined
  /** Origin and the finite native channel are optional author facts, not capability registration. */
  let origin: IVectorQueryOrigin | undefined
  /** The native extension channel is opt-in and carries no registration authority. */
  let native: true | undefined
  /** The finite original lease hook is captured without acquiring work during construction. */
  let beginOperation: (() => () => void) | undefined
  ;({ exact, groupBy } = source)
  if ('origin' in source) origin = source.origin
  if ('native' in source) native = source.native
  if ('beginOperation' in source) beginOperation = source.beginOperation
  if (
    (exact !== undefined && typeof exact !== 'boolean') ||
    (groupBy !== undefined && typeof groupBy !== 'boolean') ||
    (native !== undefined && native !== true) ||
    (beginOperation !== undefined && typeof beginOperation !== 'function')
  )
    throw invalidQueryArgument()
  origin = snapshotVectorQueryOrigin(origin)
  return familyQuery(
    {
      ...captured,
      vector: {
        exact: exact === true,
        groupBy: groupBy === true,
        withVector: false,
        origin,
        acceptsNative: native,
        ...(beginOperation === undefined
          ? {}
          : {
              beginOperation: () => source.beginOperation!()
            })
      }
    },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, VectorQueryMethod),
    false
  ) as IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
}

/** Creates a ground RDF match using the same immutable query and original native resource owner. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope> & {
    readonly watch: IQueryWatcher<IRdfQueryInput<TOperationScope>>
  },
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<
  TContext,
  TAugmentMethods & (TContext extends undefined ? Record<never, never> : IQueryWatch<TContext>)
>

/** Transaction and non-feed callers preserve their original exact RDF family shape. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope>,
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<TContext, TAugmentMethods>

/** Captures one ground native source without creating a subscription or lifecycle owner. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope>,
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<TContext, TAugmentMethods> {
  /** Pattern terms detach once; omitting graph retains the canonical all-graphs match semantics. */
  const capturedPattern = snapshotStorageRdfPattern(pattern, undefined)
  /** Native callbacks retain their exact original author receiver and original resource key. */
  const captured = snapshotQuerySource(source as unknown as IRecordQuerySource)
  return familyQuery(
    {
      ...captured,
      keyset: createRecordQueryKeysetOwner(),
      rdf: { pattern: capturedPattern, condition: snapshotStorageWhere(capturedPattern) }
    },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, RdfQueryMethod),
    true
  ) as IRdfQuery<TContext, TAugmentMethods>
}
export {
  snapshotStorageWhere,
  compileStorageWhere,
  compileStorageQueryCondition
} from './query-condition.js'
export type {
  IQueryNode,
  IQuerySourceSnapshot,
  IQueryCursorSnapshot,
  IRecordExecutionPlan
} from './query-plan.js'
export type {
  IQueryAdvance,
  IQueryReader,
  IFamilyReaderCompiler,
  IQueryReadResult,
  IQueryReaderInput,
  IQueryCompileContext
} from './query-reader.js'
