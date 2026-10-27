// Query step snapshots and shared watch/read surfaces for query branches (see ./query.ts).
import {
  QueryOperator,
  QueryOperation,
  type IQueryRead,
  type IQueryStatistics,
  type IQueryWatch,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageChange,
  type IStorageIterator
} from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object-path'
import {
  invalidQueryCondition,
  snapshotStorageWhere,
  snapshotQueryField
} from './query-condition.js'
import { prepareQueryExecution, querySourceInput } from './query-execution.js'
import { planRecordQuery, queryExecutionFailure } from './query-plan.js'
import type { IQuerySourceSnapshot, IQueryNode } from './query-plan.js'
import { recordQueryReads } from './query-record-reads.js'

/** Captures an immutable string projection before creating another chain node. */
export function snapshotQueryFields(fields: readonly unknown[]): readonly string[] {
  if (fields.length === 0 || fields.some((field) => typeof field !== 'string'))
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  return fields as string[]
}

/** Native subscriptions accept only the complete original pushed plan and return the same resource. */
export function queryWatch(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined
): Partial<IQueryWatch> {
  if (source.watch === undefined) return {}
  return {
    watch(ctx?: IOperationContext): IStorageIterator<IStorageChange> {
      /** No client filtering, remapping or resubscription platform is introduced for native feeds. */
      const plan = planRecordQuery(source, node)
      /** Strict native admission rejects opaque callbacks and client traversal before subscribing. */
      const captured = prepareQueryExecution(source, plan, true, ctx)
      try {
        return source.receiver.watch!(querySourceInput(source, plan, captured))
      } catch (cause) {
        throw queryExecutionFailure(cause)
      }
    }
  }
}

/** Vector rows never gain numeric record statistics through a runtime spread or projection. */
export function familyQueryReads<R, TContext extends IOperationContext | undefined>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean
): IQueryRead<R, TContext> | (IQueryRead<R, TContext> & IQueryStatistics<R, TContext>) {
  /** The original terminal factory remains the sole terminal execution implementation. */
  const reads = recordQueryReads<R, TContext>(source, node, strict)
  if (source.vector === undefined) return reads
  /** Only the family-inapplicable methods are omitted; every remaining function is the original. */
  const { min: _min, max: _max, sum: _sum, avg: _avg, page: _page, ...vectorReads } = reads
  return vectorReads
}

/** Captures one condition node for all three families without copying chain history. */
export function snapshotQueryWhere(args: readonly unknown[]): IQueryNode['step'] {
  /** Only the added node is captured; previously built condition snapshots are never revisited. */
  let step: IQueryNode['step']
  if (args.length === 1 && typeof args[0] === 'function')
    step = {
      operation: QueryOperation.predicate,
      predicate: args[0] as (row: unknown) => boolean
    }
  else if (args.length === 1)
    step = { operation: QueryOperation.where, condition: snapshotStorageWhere(args[0]) }
  else if (
    args.length === 3 &&
    (typeof args[0] === 'string' || Array.isArray(args[0])) &&
    typeof args[1] === 'string' &&
    Object.hasOwn(QueryOperator, args[1])
  ) {
    try {
      /** Typed paths use the same canonical path validator as object conditions. */
      const path = parseObjectPath(args[0]).map(String)
      step = {
        operation: QueryOperation.where,
        condition: snapshotQueryField(path, args[1] as QueryOperator, args[2])
      }
    } catch (cause) {
      throw invalidQueryCondition(cause)
    }
  } else throw invalidQueryCondition()
  return step
}
