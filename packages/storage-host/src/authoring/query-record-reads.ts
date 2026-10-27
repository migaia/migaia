// Record query read and stream owners for the query SDK (see ./query.ts).
import {
  QueryOperation,
  type IQueryRead,
  type IQueryStatistics,
  type IQueryPages,
  RecordQueryMethod,
  type IQueryReduction,
  type IQueryReductionResult,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageIterator
} from '@migaia/storage-contract'
import type { IMaybe } from '@migaia/utils'
import { createStorageIteratorLifetime } from './resource.js'
import { runTransactionIteratorOperation, deriveTransactionIterator } from './transaction.js'
import { invalidQueryCondition } from './query-condition.js'
import {
  consumeRecordQuery,
  prepareQueryExecution,
  assertQueryField,
  openRecordQuery,
  beginVectorQueryOperation,
  failedRecordQuery,
  releaseVectorQueryOperation
} from './query-execution.js'
import type { IPreparedQueryExecution } from './query-execution.js'
import { planRecordQuery } from './query-plan.js'
import type { IQuerySourceSnapshot, IQueryNode, IRecordExecutionPlan } from './query-plan.js'
import { assertQueryActive, completeQueryCleanup } from './query-reader.js'
import type { IQueryReader, ICompiledQueryReader, IQueryAdvance } from './query-reader.js'

/** Common read and numeric terminals borrow only the existing planner, reader and resource owner. */
/** Read terminals share one explicit query definition while original source resources own execution. */
class RecordQueryReads<R, TContext extends IOperationContext | undefined>
  implements IQueryRead<R, TContext>, IQueryStatistics<R, TContext>, IQueryPages<R, TContext>
{
  /** Original source facts and callbacks are borrowed without another native reader owner. */
  readonly #source: IQuerySourceSnapshot
  /** Persistent query history is shared without copying previous branch nodes. */
  readonly #node: IQueryNode | undefined
  /** Strictness applies to the real source plan and client terminal admission. */
  readonly #strict: boolean
  /** Comparator.first alone adds its established one-row retained bound. */
  readonly #firstNode: IQueryNode | undefined
  /** Admit no I/O; terminals retain only this query’s source, history and pushdown intent. */
  constructor(source: IQuerySourceSnapshot, node: IQueryNode | undefined, strict: boolean) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#firstNode =
      this.#node?.step.operation === QueryOperation.comparator
        ? { previous: this.#node, step: { operation: QueryOperation.limit, count: 1 } }
        : this.#node
  }
  /** Reject a client-only terminal when the current query requires complete native pushdown. */
  #assertClientTerminal(): void {
    if (this.#strict)
      throw new StorageContractError(
        StorageContractErrorCode.queryNotPushable,
        {},
        StorageContractErrorText.queryNotPushable([StorageContractErrorText.queryUnsupported])
      )
  }
  /** Select a real supported scalar cursor after planning the complete original query. */
  #nativeReduction(
    request: IQueryReduction,
    ctx: TContext | undefined
  ): { readonly native?: Promise<IQueryReductionResult>; readonly plan?: IRecordExecutionPlan } {
    if (
      this.#source.reduce === undefined ||
      (this.#source.plan === undefined &&
        !this.#source.pushdown.operations.includes(request.operation))
    )
      return {}
    /** The original planner drops only irrelevant output/order nodes for the requested reduction. */
    const countOnly =
      request.operation === QueryOperation.aggregate
        ? QueryOperation.aggregate
        : request.operation === QueryOperation.count
    const plan = planRecordQuery(this.#source, this.#node, countOnly)
    if (
      plan.client.length > 0 ||
      !(plan.sourcePlan?.pushdown ?? this.#source.pushdown).operations.includes(request.operation)
    )
      return this.#source.plan === undefined ? {} : { plan }
    return {
      plan,
      native: consumeRecordQuery<IQueryReductionResult, IQueryReductionResult>(
        this.#source,
        this.#node,
        this.#strict,
        ctx,
        async (read) => {
          /**
           * A native scalar result remains inside its original accepted cursor operation until
           * cleanup.
           */
          const next = await read()
          if (next.done)
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
          /** Read the finite result once; no backend rows are materialized by a scalar terminal. */
          const value = next.value
          if (
            request.operation === QueryOperation.count ||
            (request.operation === QueryOperation.aggregate &&
              request.aggregate === RecordQueryMethod.sum)
          ) {
            if (typeof value !== 'number')
              throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
            return value
          }
          if (request.operation === QueryOperation.exists) {
            if (typeof value !== 'boolean')
              throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
            return value
          }
          if (typeof value !== 'object' || value === null)
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
          /** Native Maybe results use the same presence discriminator as client reductions. */
          const some = value.some
          if (some === false) return { some: false }
          const sample = some === true ? value.value : undefined
          if (some !== true || typeof sample !== 'number')
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
          return { some: true, value: sample }
        },
        countOnly,
        undefined,
        { request, plan }
      )
    }
  }
  /** Reuse the original prepared plan and one admitted operation context for a client fallback. */
  readonly #prepareFallback = (
    plan: IRecordExecutionPlan | undefined,
    ctx: TContext | undefined
  ): IPreparedQueryExecution | undefined =>
    plan === undefined
      ? undefined
      : {
          plan,
          ctx: prepareQueryExecution(this.#source, plan, this.#strict, ctx)
        }
  /** Preserve presence and the implicit comparator first bound through the original reader. */
  readonly #first = (ctx?: TContext, planned?: IRecordExecutionPlan): Promise<IteratorResult<R>> =>
    consumeRecordQuery<R, IteratorResult<R>>(
      this.#source,
      this.#firstNode,
      this.#strict,
      ctx,
      (read) => read(),
      false,
      undefined,
      undefined,
      this.#prepareFallback(planned, ctx)
    )
  /** Accumulate numeric values through the same original source and accepted cursor lifetime. */
  async #aggregate(
    operation:
      | typeof RecordQueryMethod.min
      | typeof RecordQueryMethod.max
      | typeof RecordQueryMethod.sum
      | typeof RecordQueryMethod.avg,
    field: string,
    ctx?: TContext
  ): Promise<number | IMaybe<number>> {
    assertQueryField(field)
    const { native, plan } = this.#nativeReduction(
      { operation: QueryOperation.aggregate, aggregate: operation, field },
      ctx
    )
    if (native !== undefined) return native as Promise<number | IMaybe<number>>
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number | IMaybe<number>>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read) => {
        /** Missing optional samples do not turn a real zero into an empty result. */
        let count = 0
        /** The same scalar holds a running sum or the current extremum. */
        let value = 0
        while (true) {
          /** The canonical reader applies every condition, projection and bound before aggregation. */
          const next = await read()
          if (next.done) break
          /** A typed numeric field may be absent; real nonnumeric/nonfinite data is invalid. */
          const sample = next.value == null ? undefined : Reflect.get(Object(next.value), field)
          if (sample === undefined || sample === null) continue
          if (typeof sample !== 'number' || !Number.isFinite(sample))
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
          if (operation === RecordQueryMethod.min)
            value = count === 0 || sample < value ? sample : value
          else if (operation === RecordQueryMethod.max)
            value = count === 0 || sample > value ? sample : value
          else value += sample
          count++
        }
        if (operation === RecordQueryMethod.sum) return value
        return count === 0
          ? { some: false }
          : { some: true, value: operation === RecordQueryMethod.avg ? value / count : value }
      },
      QueryOperation.aggregate,
      undefined,
      undefined,
      this.#prepareFallback(plan, ctx)
    )
  }
  /** An explicitly selected keyset owner borrows this same terminal execution. */
  readonly page: IQueryPages<R, TContext>['page'] = async (size, ctx) => {
    if (this.#source.keyset === undefined) return this.#source.missingKeyset!()
    return this.#source.keyset.page<R, TContext>(this.#source, this.#node, this.#strict, size, ctx)
  }
  /** The all terminal stays inside this query’s original planner, cursor and error owner. */
  readonly all: IQueryRead<R, TContext>['all'] = (ctx) =>
    consumeRecordQuery<R, R[]>(this.#source, this.#node, this.#strict, ctx, async (read) => {
      /** Only the explicit all terminal retains all accepted rows. */
      const rows: R[] = []
      while (true) {
        /** Rows come from the same lazy reader exposed by stream. */
        const next = await read()
        if (next.done) return rows
        rows.push(next.value)
      }
    })
  /** The first terminal stays inside this query’s original planner, cursor and error owner. */
  readonly first: IQueryRead<R, TContext>['first'] = async (ctx) => {
    /** A present undefined value intentionally collapses only at this terminal. */
    const next = await this.#first(ctx)
    return next.done ? undefined : next.value
  }
  /** The maybe terminal stays inside this query’s original planner, cursor and error owner. */
  readonly maybe: IQueryRead<R, TContext>['maybe'] = async (ctx) => {
    /** The discriminant preserves presence independently of payload value. */
    const next = await this.#first(ctx)
    return next.done ? { some: false } : { some: true, value: next.value }
  }
  /** The firstOrThrow terminal stays inside this query’s original planner, cursor and error owner. */
  readonly firstOrThrow: IQueryRead<R, TContext>['firstOrThrow'] = async (ctx) => {
    /** Cleanup finishes before the empty-result error crosses the package boundary. */
    const next = await this.#first(ctx)
    if (next.done)
      throw new StorageContractError(
        StorageContractErrorCode.queryEmptyResult,
        {},
        StorageContractErrorText.queryEmptyResult
      )
    return next.value
  }
  /** The exists terminal stays inside this query’s original planner, cursor and error owner. */
  readonly exists: IQueryRead<R, TContext>['exists'] = async (ctx) => {
    const { native, plan } = this.#nativeReduction({ operation: QueryOperation.exists }, ctx)
    return native === undefined ? !(await this.#first(ctx, plan)).done : ((await native) as boolean)
  }
  /** The count terminal stays inside this query’s original planner, cursor and error owner. */
  readonly count: IQueryRead<R, TContext>['count'] = async (ctx) => {
    const { native, plan } = this.#nativeReduction({ operation: QueryOperation.count }, ctx)
    if (native !== undefined) return native as Promise<number>
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read) => {
        /** Cardinality retains no accepted row and never requests output-only planner nodes. */
        let count = 0
        while (!(await read()).done) count++
        return count
      },
      true,
      undefined,
      undefined,
      this.#prepareFallback(plan, ctx)
    )
  }
  /** The pluck terminal stays inside this query’s original planner, cursor and error owner. */
  readonly pluck: IQueryRead<R, TContext>['pluck'] = async (field, ctx) => {
    assertQueryField(field)
    /** Pluck uses the existing field-projection node, including native projection when declared. */
    const projection: IQueryNode = {
      previous: this.#node,
      step: { operation: QueryOperation.select, fields: [field] }
    }
    return consumeRecordQuery<R, R[typeof field][]>(
      this.#source,
      projection,
      this.#strict,
      ctx,
      async (read) => {
        /** Pluck explicitly returns only selected field values, without retaining full rows. */
        const values: R[typeof field][] = []
        while (true) {
          /** Missing values remain undefined, matching normal field projection. */
          const next = await read()
          if (next.done) return values
          values.push(
            (next.value == null
              ? undefined
              : Reflect.get(Object(next.value), field)) as R[typeof field]
          )
        }
      }
    )
  }
  /** The each terminal stays inside this query’s original planner, cursor and error owner. */
  readonly each: IQueryRead<R, TContext>['each'] = async (fn, ctx) => {
    if (typeof fn !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read, captured) => {
        /** The next original row is requested only after this callback completes. */
        let count = 0
        while (true) {
          /** The callback belongs to the terminal's already accepted transaction operation. */
          const next = await read()
          if (next.done) return count
          await fn(next.value, count++)
          assertQueryActive(captured)
        }
      }
    )
  }
  /** The chunk terminal stays inside this query’s original planner, cursor and error owner. */
  readonly chunk: IQueryRead<R, TContext>['chunk'] = async (size, fn, ctx) => {
    if (!Number.isSafeInteger(size) || size <= 0)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryChunk)
    if (typeof fn !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read, captured) => {
        /** One caller-declared bounded batch is live at a time. */
        let rows: R[] = []
        /** The terminal counts accepted rows, including a final partial batch. */
        let count = 0
        while (true) {
          /** Native exhaustion is observed through the same registered reader. */
          const next = await read()
          if (next.done) {
            if (rows.length > 0) {
              await fn(rows)
              assertQueryActive(captured)
            }
            return count
          }
          rows.push(next.value)
          count++
          if (rows.length === size) {
            await fn(rows)
            assertQueryActive(captured)
            rows = []
          }
        }
      }
    )
  }
  /** The min terminal stays inside this query’s original planner, cursor and error owner. */
  readonly min: IQueryStatistics<R, TContext>['min'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.min, field, ctx) as Promise<
      IMaybe<NonNullable<R[typeof field]>>
    >
  /** The max terminal stays inside this query’s original planner, cursor and error owner. */
  readonly max: IQueryStatistics<R, TContext>['max'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.max, field, ctx) as Promise<
      IMaybe<NonNullable<R[typeof field]>>
    >
  /** The sum terminal stays inside this query’s original planner, cursor and error owner. */
  readonly sum: IQueryStatistics<R, TContext>['sum'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.sum, field, ctx) as Promise<number>
  /** The avg terminal stays inside this query’s original planner, cursor and error owner. */
  readonly avg: IQueryStatistics<R, TContext>['avg'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.avg, field, ctx) as Promise<IMaybe<number>>
  /** The stream terminal stays inside this query’s original planner, cursor and error owner. */
  readonly stream: IQueryRead<R, TContext>['stream'] = (ctx) =>
    streamRecordQuery<R>(this.#source, this.#node, this.#strict, ctx)
  /** The explain terminal stays inside this query’s original planner, cursor and error owner. */
  readonly explain: IQueryRead<R, TContext>['explain'] = () =>
    planRecordQuery(this.#source, this.#node).explanation
}

export function recordQueryReads<R, TContext extends IOperationContext | undefined>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean
): IQueryRead<R, TContext> & IQueryStatistics<R, TContext> & IQueryPages<R, TContext> {
  return new RecordQueryReads<R, TContext>(source, node, strict)
}

/** A mapped stream borrows the original cursor and its sole canonical lifetime. */
class RecordQueryStream<R> {
  /** The source retains native timing, transaction and vector-operation authority. */
  readonly #source: IQuerySourceSnapshot
  /** The original native iterator remains the only cursor resource. */
  readonly #iterator: ReturnType<typeof openRecordQuery>['iterator']
  /** One compiled reader owns the same accepted mapping and traversal stages. */
  readonly #read: IQueryReader
  /** Traversal cleanup delegates to original source owners. */
  readonly #close: ICompiledQueryReader['close']
  /** Symbolic traversal cleanup delegates to those same owners' diagnostics. */
  readonly #report: ICompiledQueryReader['report']
  /** Only the first accepted pull can invoke the original asynchronous vector scorer. */
  #first = true

  /** Opens only the original source and compiles the existing client stages. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    ctx: IOperationContext | undefined
  ) {
    this.#source = source
    const opened = openRecordQuery(source, node, strict, ctx)
    this.#iterator = opened.iterator
    this.#read = opened.read
    this.#close = opened.close
    this.#report = opened.report
  }
  /** Keeps accepted mapping and failure-before-cleanup inside the original transaction operation. */
  readonly #accepted = async (
    advance: IQueryAdvance,
    fail: (error: unknown) => unknown,
    currentScope: object | undefined
  ): Promise<IteratorResult<R>> => {
    let release: (() => void) | undefined
    /** Preserve the actual error after original source cleanup if release also fails. */
    let primary: { readonly error: unknown } | undefined
    try {
      try {
        if (this.#first) {
          this.#first = false
          release = beginVectorQueryOperation(this.#source)
        }
        return (await this.#read(advance, currentScope)) as IteratorResult<R>
      } catch (cause) {
        return await failedRecordQuery(this.#iterator, fail, cause, this.#close)
      }
    } catch (error) {
      primary = { error }
      throw error
    } finally {
      releaseVectorQueryOperation(release, primary)
    }
  }

  /** Publishes the original derived transaction iterator or a root mapping over the same lifetime. */
  build(): IStorageIterator<R> {
    /** Registered sources retain full mapped-next and buffered-result scope ownership. */
    const derived = deriveTransactionIterator(this.#iterator, this.#accepted, this.#close)
    if (derived) return derived
    /** The mapped root retains the original backend's canonical resource key. */
    const asyncDisposeKey: typeof Symbol.asyncDispose = this.#source.asyncDisposeKey!
    /** Root mapping reuses the same canonical accepted-advance drain as transaction resources. */
    const lifetime = createStorageIteratorLifetime<R>({
      close: () => completeQueryCleanup(this.#close, () => this.#iterator.dispose()),
      report: () => completeQueryCleanup(this.#report, () => this.#iterator[asyncDisposeKey]())
    })
    return {
      next: () =>
        lifetime.advance(() =>
          runTransactionIteratorOperation(this.#iterator, async (advance, fail, currentScope) =>
            lifetime.isClosing()
              ? { done: true, value: undefined }
              : this.#accepted(advance, fail, currentScope)
          )
        ),
      return: lifetime.returned,
      dispose: lifetime.dispose,
      [asyncDisposeKey]: lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}

/** Streams the same client reader without adding a native cursor, queue or lifecycle owner. */
function streamRecordQuery<R>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined
): IStorageIterator<R> {
  return new RecordQueryStream<R>(source, node, strict, ctx).build()
}
