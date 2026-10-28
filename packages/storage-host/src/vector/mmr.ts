import { snapshotStorageVector } from '../authoring/vector.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IVectorReranker
} from '@migaia/storage-contract'
import { cosineStorageVectors } from '../backends/vector-core.ts'
import { throwIfAborted } from '../core/operation.ts'
import { StorageErrorText } from '../error-text.ts'

/** The query owns truncation; topN bounds only MMR's greedy prefix and never changes score length. */
export type IStorageMmrOptions = {
  readonly lambda: number
  readonly topN?: number
}

/** Pure input rejection uses the existing contract argument code without allocating native work. */
function invalidMmr(cause?: unknown): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    cause === undefined ? {} : { cause },
    StorageErrorText.vectorMmr
  )
}

/**
 * Build a deterministic MMR scorer. Engine scores provide relevance; the original scaled cosine
 * owner supplies diversity. O(n) state keeps one maximum similarity per candidate rather than a
 * pairwise matrix. Equal objectives retain engine order, including the first candidate.
 */
export function mmr(options: IStorageMmrOptions): IVectorReranker<unknown, true> {
  /** Factory options are captured once before the scorer is attached to a query. */
  let lambda: number
  /** An optional bound limits expensive diversity selection, not the scorer's output contract. */
  let topN: number | undefined
  try {
    ;({ lambda, topN } = options)
    if (
      typeof lambda !== 'number' ||
      !Number.isFinite(lambda) ||
      lambda < 0 ||
      lambda > 1 ||
      (topN !== undefined && (!Number.isSafeInteger(topN) || topN < 1))
    )
      invalidMmr()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    invalidMmr(cause)
  }
  return ({ hits }, ctx) => {
    throwIfAborted(ctx.signal)
    /** Relevance is captured once even for a directly supplied scorer input with accessors. */
    const relevance = hits.map((hit) => {
      const score = hit.score
      if (!Number.isFinite(score)) invalidMmr()
      return score
    })
    /** The first detached vector establishes the dimension for every subsequent candidate. */
    let dimensions: number | undefined
    /** Shared query snapshots already detached the wrappers; vector admission remains canonical. */
    const vectors = hits.map((hit) => {
      const vector = snapshotStorageVector(
        hit.vector,
        dimensions === undefined ? undefined : { dimensions }
      )
      dimensions = vector.length
      return vector
    })
    /** Selection flags, maximum diversity and rank output all use the original engine positions. */
    const selected = new Uint8Array(hits.length)
    /** No selected direction contributes diversity until the first greedy choice. */
    const similarity = hits.map(() => -Infinity)
    /** Positive descending integers encode order without altering engine scores. */
    const scores = hits.map(() => 0)
    /** A bounded greedy prefix avoids unnecessary quadratic work for an explicitly small topN. */
    const bound = Math.min(topN ?? hits.length, hits.length)
    for (let turn = 0; turn < bound; turn++) {
      throwIfAborted(ctx.signal)
      /** The earliest engine candidate wins all equal-objective comparisons. */
      let best = -1
      /** An unchosen candidate's finite objective is compared only within this greedy turn. */
      let objective = -Infinity
      for (let index = 0; index < hits.length; index++) {
        if (selected[index]) continue
        /** No relevance or diversity normalization changes the engine's own score semantics. */
        const value =
          lambda * relevance[index]! -
          (turn === 0 || lambda === 1 ? 0 : (1 - lambda) * similarity[index]!)
        if (best === -1 || value > objective) {
          best = index
          objective = value
        }
      }
      selected[best] = 1
      scores[best] = hits.length - turn
      if (lambda !== 1 && turn + 1 < bound)
        for (let index = 0; index < hits.length; index++) {
          if (!selected[index])
            similarity[index] = Math.max(
              similarity[index]!,
              cosineStorageVectors(vectors[index]!, vectors[best]!, true)
            )
        }
    }
    /** Unselected tail candidates retain engine order and still receive one finite score each. */
    let tail = hits.length - bound
    for (let index = 0; index < hits.length; index++) if (!selected[index]) scores[index] = tail--
    throwIfAborted(ctx.signal)
    return scores
  }
}
