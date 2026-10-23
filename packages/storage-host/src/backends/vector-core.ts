import {
  snapshotStorageVector,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
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
