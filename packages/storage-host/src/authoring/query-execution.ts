// Query execution: opening, consuming and mutating record queries (see ./query.ts).
import {
  QueryOperation,
  type IVectorHit,
  RdfQueryMethod,
  type IRecordQuerySource,
  type IRecordQueryInput,
  type IQueryDelete,
  type IRecordQueryMutation,
  type IRdfQueryMutation,
  type IQueryMutationPort,
  type IQueryReduction,
  type IQueryNativeStep,
  type IVectorQueryInput,
  type IRdfQueryTraversal,
  type IRdfQueryInput,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageKey,
  type IStorageIterator,
  assertConcurrencyPolicy,
  type IWriteConcurrencyOptions,
  type IQuad
} from '@migaia/storage-contract'
import { immutableSnapshot } from '@migaia/utils/object'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { snapshotOperationContext } from './context.ts'
import { runTransactionIteratorOperation } from './transaction.ts'
import { storageKeyBytesIdentity } from './key.ts'
import { snapshotStorageRdfQuad, encodeRdfQuadSnapshot } from './rdf.ts'
import { invalidQueryCondition } from './query-condition.ts'
import { queryExecutionFailure, planRecordQuery } from './query-plan.ts'
import type {
  IQuerySourceSnapshot,
  IRecordExecutionPlan,
  IQueryNode,
  IQuerySourcePort
} from './query-plan.ts'
import {
  assertQueryActive,
  compileRecordQueryReader,
  completeQueryCleanup
} from './query-reader.ts'
import type { IQueryReader, ICompiledQueryReader } from './query-reader.ts'

/** Checks the captured intent before any native source is invoked. */
function assertQueryExecution(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  strict: boolean,
  ctx: IOperationContext | undefined
): void {
  source.keyset?.assertMatches(source, plan, ctx)
  /** Ranking and traversal cannot be emulated by the ordinary row reader. */
  const requiredNative = plan.client.some(
    (step) => step.operation === QueryOperation.topK || step.operation === QueryOperation.minScore
  )
  if ((strict && plan.client.length > 0) || requiredNative)
    throw new StorageContractError(
      StorageContractErrorCode.queryNotPushable,
      {},
      StorageContractErrorText.queryNotPushable(plan.explanation.client.map((step) => step.reason!))
    )
  assertQueryActive(ctx)
}

/** Captures caller intent once before reads can await native I/O or callback work. */
export function prepareQueryExecution(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  strict: boolean,
  ctx: IOperationContext | undefined
): IOperationContext | undefined {
  /** Scalar context choices remain stable while the original signal continues to carry cancellation. */
  const captured = snapshotOperationContext(ctx)
  assertQueryExecution(source, plan, strict, captured)
  return captured
}

/** A write reuses this plan and captured context inside the original transaction callback. */
export type IPreparedQueryExecution = {
  readonly plan: IRecordExecutionPlan
  readonly ctx: IOperationContext | undefined
}

/** Plans once and opens only the original native prefix; terminal adapters share this execution. */
function nativeQuerySteps(
  source: IQuerySourceSnapshot,
  steps: readonly IQueryNode['step'][]
): readonly (IQueryNativeStep | IRdfQueryTraversal)[] {
  return steps.map((step) => {
    if (step.operation === QueryOperation.follow || step.operation === QueryOperation.inverse) {
      /** Native authors receive traversal data only, never the private client reader compiler. */
      const { compile: _compile, ...traversal } = step
      return traversal
    }
    if (step.operation === QueryOperation.after) return step.native(source)
    return { ...step } as IQueryNativeStep | IRdfQueryTraversal
  })
}

/** A terminal's already compiled native plan is consumed by the original resource runner. */
type INativeQueryReduction = {
  readonly request: IQueryReduction
  readonly plan: IRecordExecutionPlan
}

/** One native input compiler serves original read, mutation and subscription callbacks. */
export function querySourceInput(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  captured: IOperationContext | undefined
): IVectorQueryInput | IRdfQueryInput | IRecordQueryInput {
  /** Conditions retain the original safe-prefix AST without resnapshotting or another parser. */
  const conditions = plan.pushed.flatMap((step) =>
    step.operation === QueryOperation.where ? [step.condition] : []
  )
  /** Output projection remains part of the same native plan. */
  const fields = plan.pushed.find((step) => step.operation === QueryOperation.select)?.fields
  /** Each family calls its original native engine inside this same accepted source operation. */
  let input: IVectorQueryInput | IRdfQueryInput | Parameters<IRecordQuerySource['execute']>[0]
  if (source.vector !== undefined) {
    /** The last immutable refinement supplies the one final engine ranking bound/threshold. */
    const bounds = plan.pushed.filter((step) => step.operation === QueryOperation.topK)
    /** Score threshold is also a final query option rather than a second client filter. */
    const scores = plan.pushed.filter((step) => step.operation === QueryOperation.minScore)
    input = {
      conditions,
      topK: bounds.at(-1)!.count,
      minScore: scores.at(-1)?.score,
      withVector: source.vector.withVector,
      ...(source.vector.native === undefined ? {} : { native: source.vector.native.native }),
      ctx: captured
    }
  } else if (source.rdf !== undefined) {
    input = {
      pattern: source.rdf.pattern,
      steps: nativeQuerySteps(source, plan.pushed),
      ctx: captured
    }
  } else
    input = {
      conditions,
      fields,
      ctx: captured,
      ...(plan.sourcePlan?.selection === undefined ? {} : { selection: plan.sourcePlan.selection }),
      ...(source.nativeSteps
        ? { steps: nativeQuerySteps(source, plan.pushed) as readonly IQueryNativeStep[] }
        : {})
    }
  return input
}

/** A new client stage borrows only the provider's existing accepted-work lease. */
export function beginVectorQueryOperation(source: IQuerySourceSnapshot): (() => void) | undefined {
  if (!source.vector?.reranked || source.vector.beginOperation === undefined) return undefined
  try {
    const release = source.vector.beginOperation()
    if (typeof release !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return release
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}

/** Original lease cleanup preserves an earlier query failure through the existing error owner. */
export function releaseVectorQueryOperation(
  release: (() => void) | undefined,
  primary?: { readonly error: unknown }
): void {
  try {
    release?.()
  } catch (cause) {
    const cleanup = queryExecutionFailure(cause)
    throw primary === undefined
      ? cleanup
      : queryExecutionFailure(attachSecondaryErrors(primary.error, [cleanup]))
  }
}

/** Plans once and opens only the original native prefix; terminal adapters share this execution. */
export function openRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined,
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number,
  reduction?: INativeQueryReduction,
  prepared?: IPreparedQueryExecution,
  retainKeys = false,
  holdOperation = false
): {
  readonly release?: () => void
  readonly iterator: IStorageIterator<readonly [IStorageKey, unknown]>
  readonly read: IQueryReader
  readonly close: ICompiledQueryReader['close']
  readonly report: ICompiledQueryReader['report']
  readonly ctx: IOperationContext | undefined
  readonly signature: readonly IQueryNode['step'][]
  readonly mapper: ((row: unknown) => unknown) | undefined
} {
  /** Strictness and missing comparator bounds reject before a source can open. */
  const plan =
    prepared?.plan ?? reduction?.plan ?? planRecordQuery(source, node, countOnly, pageSize)
  /** An original write owner can reuse pre-I/O admission without another context snapshot. */
  const captured =
    prepared === undefined ? prepareQueryExecution(source, plan, strict, ctx) : prepared.ctx
  /** Node compilation creates no source I/O and retains no materialized row array. */
  const mapper =
    pageSize === undefined
      ? undefined
      : plan.client.find((step) => step.operation === QueryOperation.mapper)?.mapper
  /** Output mapping runs only for actual page items after the bounded original read. */
  const client =
    pageSize === undefined
      ? plan.client
      : plan.client.filter((step) => step.operation !== QueryOperation.mapper)
  /** Opaque comparison uses the original callback and a detached cursor anchor. */
  const comparator = plan.signature.find(
    (step) => step.operation === QueryOperation.comparator
  )?.compare
  const { read, close, report } = compileRecordQueryReader(
    reduction === undefined ? client : [],
    captured,
    reduction === undefined ? source.tieBreakByKey : undefined,
    source.vector !== undefined,
    pageSize !== undefined || retainKeys,
    comparator,
    source
  )
  /** Only the new reranked terminal borrows the existing provider lease after pure admission. */
  const release = holdOperation ? beginVectorQueryOperation(source) : undefined
  try {
    /** The same native compiler is shared with direct native subscriptions. */
    const input = querySourceInput(source, plan, captured)
    return {
      release,
      iterator:
        reduction === undefined
          ? source.receiver.execute(input)
          : source.receiver.reduce!({ ...input, reduction: reduction.request }),
      read,
      close,
      report,
      ctx: captured,
      signature: plan.signature,
      mapper
    }
  } catch (cause) {
    const primary = queryExecutionFailure(cause)
    releaseVectorQueryOperation(release, { error: primary })
    throw primary
  }
}

/** Records the original primary before awaiting original cursor cleanup on every read failure. */
export async function failedRecordQuery(
  iterator: IStorageIterator<unknown>,
  fail: (error: unknown) => unknown,
  cause: unknown,
  close?: () => Promise<void>
): Promise<never> {
  /** Cleanup cannot replace an earlier predicate, mapper, comparator or native failure. */
  let primary = queryExecutionFailure(fail(queryExecutionFailure(cause)))
  try {
    await completeQueryCleanup(close, () => iterator.dispose())
  } catch (cleanup) {
    primary = queryExecutionFailure(
      attachSecondaryErrors(primary, [queryExecutionFailure(cleanup)])
    )
  }
  throw primary
}

/** Every read terminal remains accepted through its callbacks and original cursor cleanup. */
export async function consumeRecordQuery<R, TResult>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined,
  consume: (
    read: () => Promise<
      IteratorResult<R> & { readonly key?: IStorageKey; readonly keyBytes?: Uint8Array }
    >,
    ctx: IOperationContext | undefined,
    page:
      | {
          readonly signature: readonly IQueryNode['step'][]
          readonly mapper: ((row: unknown) => unknown) | undefined
        }
      | undefined
  ) => Promise<TResult>,
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number,
  reduction?: INativeQueryReduction,
  prepared?: IPreparedQueryExecution,
  retainKeys = false
): Promise<TResult> {
  /** Opening synchronously admits the complete terminal to the original transaction owner. */
  const {
    iterator,
    read,
    close,
    ctx: captured,
    signature,
    mapper,
    release
  } = openRecordQuery(
    source,
    node,
    strict,
    ctx,
    countOnly,
    pageSize,
    reduction,
    prepared,
    retainKeys,
    true
  )
  /** A boxed failure also distinguishes a deliberately thrown undefined from success. */
  let primary: { readonly error: unknown } | undefined
  try {
    /** Omitted/new-unused lease hooks preserve the original direct Promise adoption path. */
    const pending = runTransactionIteratorOperation(
      iterator,
      async (advance, fail, currentScope) => {
        /**
         * The terminal's scalar, bounded chunk or explicit all result stays inside the same
         * operation.
         */
        let result: TResult
        try {
          result = await consume(
            async () =>
              (await read(advance, currentScope)) as IteratorResult<R> & {
                readonly key?: IStorageKey
                readonly keyBytes?: Uint8Array
              },
            captured,
            pageSize === undefined ? undefined : { signature, mapper }
          )
        } catch (cause) {
          return failedRecordQuery(iterator, fail, cause, close)
        }
        try {
          await completeQueryCleanup(close, () => iterator.dispose())
        } catch (cause) {
          throw queryExecutionFailure(fail(queryExecutionFailure(cause)))
        }
        return result
      }
    )
    return release === undefined ? pending : await pending
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    releaseVectorQueryOperation(release, primary)
  }
}

/** Captures write-only policy once while the existing context owner retains all other admission. */
export function queryWriteContext(
  ctx: (IOperationContext & IWriteConcurrencyOptions) | undefined
): Pick<IQueryDelete, 'ctx' | 'concurrency'> {
  /** Context scalar fields are captured before the write owner can await. */
  const captured = snapshotOperationContext(ctx)
  if (ctx === undefined) return { ctx: captured }
  /** Concurrency is a typed author definition and does not belong to the scalar context snapshot. */
  const concurrency = ctx.concurrency
  if (concurrency !== undefined) assertConcurrencyPolicy(concurrency)
  return { ctx: captured, ...(concurrency === undefined ? {} : { concurrency }) }
}

/** A patch is detached at the terminal before its original backend transaction can start. */
export function snapshotQueryPatch(patch: unknown): Readonly<Partial<Record<string, unknown>>> {
  try {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** The original snapshot owner detaches data; the actual backend codec retains value admission. */
    const captured = immutableSnapshot(patch)
    return captured as Record<string, unknown>
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}

/**
 * Selects and accepts actual rows inside the original backend write callback. This terminal reuses
 * the one planner, reader, resource cleanup and transaction operation; it owns no retry or lock.
 */
export async function mutateRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  request: IRecordQueryMutation | IRdfQueryMutation
): Promise<number> {
  /** Missing write authority rejects before source execution or any native transaction starts. */
  if (source.mutate === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** One execution plan is admitted before the original write pipeline can perform I/O. */
  const plan = planRecordQuery(source, node)
  /** This original snapshot is retained for every scoped cursor, including nested RDF traversal. */
  const ctx = request.ctx
  assertQueryExecution(source, plan, strict, ctx)
  /** Replacement identity uses the original admitted RDF encoder, never source-key spellings. */
  const replaced =
    request.operation === RdfQueryMethod.replace
      ? storageKeyBytesIdentity(encodeRdfQuadSnapshot(request.oldQuad))
      : undefined
  try {
    return await source.receiver.mutate!(
      request,
      async (port: IQueryMutationPort<IRecordQueryInput, unknown>) => {
        /** A native owner supplies exactly these two functions once per actual write attempt. */
        const { execute, accept } = port
        if (typeof execute !== 'function' || typeof accept !== 'function')
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        /** The captured source facts stay fixed while I/O borrows the actual transaction receiver. */
        const scoped = { ...source, execute, receiver: port as unknown as IQuerySourcePort }
        /** One hash set retains only selected identities; rows are streamed and never materialized. */
        const seen = new Set<string>()
        return consumeRecordQuery<unknown, number>(
          scoped,
          node,
          strict,
          ctx,
          async (read, captured) => {
            /** Count increments only after the original draft explicitly accepts that unique row. */
            let count = 0
            while (true) {
              /**
               * Selection and callback failures retain the original cursor cleanup and primary
               * error.
               */
              const next = await read()
              if (next.done) return count
              /** RDF portable identity is the ground quad; vector identity is its original hit id. */
              const value =
                source.rdf === undefined
                  ? next.value
                  : snapshotStorageRdfQuad(next.value as IQuad, undefined)
              /** Key bytes have already been snapshotted and encoded by the same reader. */
              const identity =
                source.rdf !== undefined
                  ? storageKeyBytesIdentity(encodeRdfQuadSnapshot(value as IQuad))
                  : source.vector !== undefined
                    ? (value as IVectorHit<unknown>).id
                    : storageKeyBytesIdentity(next.keyBytes!)
              if ((replaced !== undefined && identity !== replaced) || seen.has(identity)) continue
              seen.add(identity)
              /** The actual backend draft decides accepted no-ops and concurrent disappearance. */
              const accepted = await port.accept(next.key!, value)
              if (typeof accepted !== 'boolean')
                throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
              if (accepted) count++
              assertQueryActive(captured)
            }
          },
          false,
          undefined,
          undefined,
          { plan, ctx },
          true
        )
      }
    )
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}

/** Terminal field names are captured before a source is opened, without inspecting row shapes. */
export function assertQueryField(field: unknown): asserts field is string {
  if (typeof field !== 'string')
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
}
