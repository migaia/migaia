// Vector rerank reader stages for the query SDK (see ./query.ts).
import {
  type IVectorHit,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  type IVectorReranker,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IOperationContext
} from '@migaia/storage-contract'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { snapshotStorageVector, snapshotStorageVectorIds } from './vector.js'
import { encodeOrderedStorageKey, orderStorageKeysByBytes } from './key.js'
import { invalidQueryCondition } from './query-condition.js'
import { assertQueryActive } from './query-reader.js'
import type { IQueryReader, IQueryAdvance } from './query-reader.js'

/** Origin capture reuses the vector component/ID owners and never resolves samples or opens I/O. */
export function snapshotVectorQueryOrigin(
  origin: IVectorQueryOrigin | undefined
): IVectorQueryOrigin | undefined {
  if (origin === undefined) return undefined
  if (origin === null || typeof origin !== 'object')
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
  /** The discriminator and origin fields are retained before scorer execution can await. */
  const kind = origin.kind
  if (kind === VectorQueryOriginKind.near)
    return { kind, vector: snapshotStorageVector(origin.vector) }
  if (kind === VectorQueryOriginKind.similarTo) {
    /** The immutable sample ID is retained without native vector lookup. */
    const id = origin.id
    if (typeof id === 'string') return { kind, id }
  }
  if (kind === VectorQueryOriginKind.recommend) {
    /** Sample identities retain the canonical ID owner and original input order. */
    const positive = snapshotStorageVectorIds(origin.positive)
    /** Negative samples are captured independently without resolving native vectors. */
    const negative = snapshotStorageVectorIds(origin.negative)
    if (positive.length > 0) return { kind, positive, negative }
  }
  throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
}

/** One bounded scorer runs within the original accepted reader and shares its cleanup/failure path. */
/** Explicit vector reader state shares the original accepted pull and native cursor. */
type IVectorRerankReaderContext = {
  readonly upstream: IQueryReader
  readonly ctx: IOperationContext | undefined
  readonly origin: IVectorQueryOrigin
  readonly scorer: IVectorReranker<unknown, boolean>
  readonly topN: number
  prepared: Promise<readonly Awaited<ReturnType<IQueryReader>>[]> | undefined
  emitted: number
}

export function compileVectorRerankReader(
  upstream: IQueryReader,
  ctx: IOperationContext | undefined,
  origin: IVectorQueryOrigin,
  scorer: IVectorReranker<unknown, boolean>,
  topN: number
): IQueryReader {
  /** Only this node owns preparation and emission state. */
  const context: IVectorRerankReaderContext = {
    upstream,
    ctx,
    origin,
    scorer,
    topN,
    prepared: undefined,
    emitted: 0
  }
  return (advance, currentScope) => readVectorRerankReader(context, advance, currentScope)
}

/** Prepares this bounded vector stage once without a second resource lifetime. */
async function prepareVectorRerankReader(
  context: IVectorRerankReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<readonly Awaited<ReturnType<IQueryReader>>[]> {
  /** Native topK and existing payload predicates have already bounded this candidate list. */
  const entries: Awaited<ReturnType<IQueryReader>>[] = []
  while (true) {
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) break
    entries.push(next)
  }
  /** The scorer borrows the original readonly engine hits; this array only projects their values. */
  const hits = entries.map((entry) => entry.value as IVectorHit<unknown, boolean>)
  /** An omitted caller signal needs no timer, listener, controller registration or new budget. */
  const signal = (context.ctx?.signal ?? new AbortController().signal) as INativeAbortSignal
  /** User output stays unknown until the one finite-score admission pass. */
  let result: unknown
  try {
    assertQueryActive(context.ctx)
    result = await context.scorer({ origin: context.origin, hits }, { signal })
    assertQueryActive(context.ctx)
  } catch (cause) {
    assertQueryActive(context.ctx)
    throw new StorageContractError(
      StorageContractErrorCode.rerankFailed,
      { cause },
      StorageContractErrorText.queryRerankFailed
    )
  }
  try {
    if (!Array.isArray(result) || result.length !== hits.length)
      throw new StorageContractError(
        StorageContractErrorCode.rerankResultInvalid,
        {},
        StorageContractErrorText.queryRerankResult
      )
    /** The existing canonical numeric key codec and radix own descending scores and stable ties. */
    const scored = entries.map((entry, position) => {
      /** Each present engine position must supply one finite score. */
      const score = Object.hasOwn(result, position) ? result[position] : undefined
      if (typeof score !== 'number' || !Number.isFinite(score))
        throw new StorageContractError(
          StorageContractErrorCode.rerankResultInvalid,
          {},
          StorageContractErrorText.queryRerankResult
        )
      return {
        bytes: encodeOrderedStorageKey([-score, position], undefined),
        row: { ...entry, value: { ...hits[position]!, rerankScore: score } }
      }
    })
    return orderStorageKeysByBytes(scored, (entry) => entry.bytes)
      .slice(0, context.topN)
      .map((entry) => entry.row)
  } catch (cause) {
    if (
      cause instanceof StorageContractError &&
      cause.code === StorageContractErrorCode.rerankResultInvalid
    )
      throw cause
    throw new StorageContractError(
      StorageContractErrorCode.rerankResultInvalid,
      { cause },
      StorageContractErrorText.queryRerankResult
    )
  }
}

/** Concurrent reads share preparation while preserving original emission order. */
async function readVectorRerankReader(
  context: IVectorRerankReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<Awaited<ReturnType<IQueryReader>>> {
  /** All pulls share one preparation and reserve their own output position. */
  const ranked = await (context.prepared ??= prepareVectorRerankReader(
    context,
    advance,
    currentScope
  ))
  assertQueryActive(context.ctx)
  return context.emitted === ranked.length
    ? { done: true, value: undefined }
    : ranked[context.emitted++]!
}
