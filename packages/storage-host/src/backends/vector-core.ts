import {
  snapshotStorageVector,
  StorageContractError,
  StorageContractErrorCode,
  encodeOrderedStorageKey,
  type IStorageVectorConfiguration,
  type IStorageVectorPoint
} from '@migaia/storage-contract'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { StorageErrorText } from '../error-text.js'

/** Reject invalid synthesis input without creating an operation, collection or native resource. */
function invalidRecommendation(): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    {},
    StorageErrorText.vectorRecommendation
  )
}

/**
 * Synthesize the standard positive mean minus negative mean in input order. Each sample uses the
 * contract's sole component admission; only one detached sample and O(d) sums are retained. A
 * cosine collection validates the resulting direction through its original query admission.
 */
export function recommendStorageVector(
  positive: readonly [readonly number[], ...(readonly number[])[]],
  negative?: readonly (readonly number[])[]
): readonly number[] {
  try {
    if (!Array.isArray(positive) || (negative !== undefined && !Array.isArray(negative)))
      invalidRecommendation()
    /** Borrowed sample array bounds are read once before any component getter is evaluated. */
    const positiveCount = positive.length
    /** An omitted negative set contributes zero without creating a native operation. */
    const negativeCount = negative === undefined ? 0 : negative.length
    if (
      !Number.isSafeInteger(positiveCount) ||
      positiveCount < 1 ||
      !Number.isSafeInteger(negativeCount) ||
      negativeCount < 0 ||
      !Object.hasOwn(positive, 0)
    )
      invalidRecommendation()
    /** The first original sample supplies dimensions and is never read again from its container. */
    const first = snapshotStorageVector(positive[0])
    /** Component-wise division avoids overflowing an otherwise representable finite mean. */
    const result = first.map((value) => value / positiveCount)
    /** The existing component owner rejects sparse, non-finite or mismatched later samples. */
    const accumulate = (
      samples: readonly (readonly number[])[],
      count: number,
      start: number,
      target: number[]
    ): void => {
      for (let index = start; index < count; index++) {
        if (!Object.hasOwn(samples, index)) invalidRecommendation()
        /** Only this detached sample is retained while its components contribute in input order. */
        const vector = snapshotStorageVector(samples[index]!, { dimensions: first.length })
        for (let component = 0; component < vector.length; component++)
          target[component] = target[component]! + vector[component]! / count
      }
    }
    accumulate(positive, positiveCount, 1, result)
    if (negative !== undefined && negativeCount > 0) {
      /** Negative samples form their own mean before one subtraction per component. */
      const negativeMean = first.map(() => 0)
      accumulate(negative, negativeCount, 0, negativeMean)
      for (let component = 0; component < result.length; component++)
        result[component] = result[component]! - negativeMean[component]!
    }
    return snapshotStorageVector(result)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageErrorText.vectorRecommendation
    )
  }
}

/** A private score row borrows immutable stored point data until the bounded output is detached. */
export type IMemoryVectorHit<TPayload> = {
  readonly point: IStorageVectorPoint<TPayload>
  readonly score: number
}
/** Non-finite reference scores and undefined cosine directions never enter the rank radix. */
function invalidVectorScore(): never {
  throw new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    {},
    StorageErrorText.memoryVectorScore
  )
}
/** Original scaled cosine arithmetic serves native Memory ranking and the pure MMR scorer. */
export function cosineStorageVectors(
  left: readonly number[],
  right: readonly number[],
  zeroSimilarity = false
): number {
  /** Scaling avoids overflowing cosine's norms for otherwise valid finite directions. */
  let leftScale = 0
  /** Both vectors keep independent magnitude scales. */
  let rightScale = 0
  for (let index = 0; index < left.length; index++) {
    leftScale = Math.max(leftScale, Math.abs(left[index]!))
    rightScale = Math.max(rightScale, Math.abs(right[index]!))
  }
  if (leftScale === 0 || rightScale === 0) {
    /** MMR treats an undefined zero direction as neutral; native cosine ranking still rejects it. */
    if (zeroSimilarity) return 0
    invalidVectorScore()
  }
  /** Scaled dot and square sums are bounded by the actual component count. */
  let dot = 0
  /** Independent squared lengths retain the exact reference direction. */
  let leftNorm = 0
  /** The second squared length uses the same scaled component turn. */
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    /** Each admitted component participates once in this scoring pass. */
    const a = left[index]! / leftScale
    /** The candidate component is scaled only by its own vector magnitude. */
    const b = right[index]! / rightScale
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  /** The clamp absorbs floating point roundoff without changing a finite cosine direction. */
  const score = Math.max(-1, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))))
  if (!Number.isFinite(score)) invalidVectorScore()
  return score
}

/** Memory-only exact scoring never becomes a server retrieval fallback or public authoring API. */
function scoreMemoryVector(
  left: readonly number[],
  right: readonly number[],
  metric: IStorageVectorConfiguration['metric']
): number {
  /** Only the final finite score enters the ordered index. */
  let score = 0
  if (metric === 'cosine') score = cosineStorageVectors(left, right)
  else if (metric === 'dot') {
    for (let index = 0; index < left.length; index++) score += left[index]! * right[index]!
  } else {
    /** The native two-argument hypot avoids a spread argument limit and square overflow. */
    let distance = 0
    for (let index = 0; index < left.length; index++)
      distance = Math.hypot(distance, left[index]! - right[index]!)
    score = -distance
  }
  if (!Number.isFinite(score)) invalidVectorScore()
  return score
}

/**
 * Rank only native live candidates with the existing compressed radix. A score/id key gives
 * descending score and exact UTF-16 ID ties, retaining at most k hits without comparison sorting.
 */
export function rankMemoryVectors<TPayload>(
  points: Iterable<IStorageVectorPoint<TPayload>>,
  query: readonly number[],
  metric: IStorageVectorConfiguration['metric'],
  k: number,
  minScore: number | undefined,
  accept: (point: IStorageVectorPoint<TPayload>) => boolean
): readonly IMemoryVectorHit<TPayload>[] {
  if (k === 0) return []
  /** The original radix owns all rank-key paths and constant-time neighboring leaves. */
  const ranked = createOrderedRecordIndex<IMemoryVectorHit<TPayload>>()
  for (const point of points) {
    if (!accept(point)) continue
    /** Org/TTL/declarative filters have already excluded candidates before scoring. */
    const score = scoreMemoryVector(query, point.vector, metric)
    if (minScore !== undefined && score < minScore) continue
    ranked.set(encodeOrderedStorageKey([-score, point.id], STORAGE_MEMORY_BACKEND), {
      point,
      score
    })
    if (ranked.size > k) ranked.delete(ranked.last!.key)
  }
  return [...ranked.range()].map((leaf) => leaf.value)
}
