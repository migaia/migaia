/**
 * Snapshot error fields and aggregate/cleanup entries once; callers own traversal, budgets and
 * reporting.
 */
import { tryReadProperty } from './error-primitives.ts'
import {
  ErrorChainFieldSet,
  ErrorChainRequiredField,
  ErrorChainReadField
} from '../error-chain-constants.ts'
import type { IErrorChainStrategy } from '../error-chain-types.ts'
import type { IErrorSnapshot } from './error-chain-state.ts'

/** Snapshot fixed error fields once for both wire projection and graph traversal. */
export function snapshotError(
  input: object,
  pointer: string,
  report: (pointer: string, field: string, error: unknown) => void,
  summaryOnly: boolean,
  strategy: IErrorChainStrategy
): IErrorSnapshot {
  /** Re-read caller policy at the original point; custom iterables retain their per-node snapshot. */
  const fieldOrder = strategy.fields
  /** The fixed default whitelist is shared; caller-owned whitelists are never cached across getters. */
  const admitted = fieldOrder === undefined ? ErrorChainFieldSet : new Set<string>(fieldOrder)
  /** The null-prototype snapshot prevents source property names from changing record inheritance. */
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  const failed = new Set<string>()
  // Both getter orders have compile-time bounds: five summary fields or ten send fields.
  for (const key of summaryOnly ? ErrorChainRequiredField : ErrorChainReadField) {
    if (!summaryOnly && !(key === 'cleanupErrors' ? admitted.has('errors') : admitted.has(key)))
      continue
    /** Keep each field's failure attached to its original pointer. */
    const read = tryReadProperty(input as Record<string, unknown>, key)
    if (read.threw) {
      failed.add(key)
      report(pointer, key, read.error)
    } else fields[key] = read.value
  }
  if (!summaryOnly)
    for (const extension of strategy.extensions ?? []) {
      if (!admitted.has(extension.field)) continue
      if (extension.read) fields[extension.field] = extension.read(input)
      else {
        /**
         * Read once with the original receiver; keep a thrown getter value reachable through
         * reporting.
         */
        const read = tryReadProperty(input as Record<string, unknown>, extension.field)
        if (read.threw) {
          failed.add(extension.field)
          report(pointer, extension.field, read.error)
        } else fields[extension.field] = read.value
      }
    }
  return { fields, failed, truncated: failed.size > 0 }
}

/** Read array length and entries once while reporting trapped reads at their owner. */
export function appendChildren(
  input: unknown,
  pointer: string,
  field: string,
  output: unknown[],
  report: (pointer: string, field: string, error: unknown) => void,
  maxObjects: number
): boolean {
  /**
   * Arrays never supply named error fields; classification failures follow the caller report
   * policy.
   */
  let array = false
  try {
    array = Array.isArray(input)
  } catch (error) {
    report(pointer, field, error)
    return true
  }
  if (!array) return false
  /** Array metadata is read once before admitting any children. */
  const lengthRead = tryReadProperty(input as unknown[], 'length')
  if (lengthRead.threw) {
    report(pointer, 'length', lengthRead.error)
    return true
  }
  /** Hold the original array length before entry reads so traps cannot change traversal shape. */
  const length = lengthRead.value
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  let failed = false
  for (let index = 0; index < Math.min(length, maxObjects); index += 1) {
    /** An index trap reports its original thrown value and skips only that child. */
    const read = tryReadProperty(input as unknown[], index)
    if (read.threw) {
      failed = true
      report(pointer, String(index), read.error)
    } else output.push(read.value)
  }
  return failed || length > maxObjects
}

/** Append cleanup error entries after ordinary AggregateError children. */
export function appendCleanupChildren(
  input: unknown,
  pointer: string,
  output: unknown[],
  report: (pointer: string, field: string, error: unknown) => void,
  maxObjects: number
): boolean {
  /** Cleanup entries are snapshotted before reading their error properties. */
  const entries: unknown[] = []
  /** Remember failed reads so projection skips them and marks the output incomplete. */
  let failed = appendChildren(input, pointer, 'cleanupErrors', entries, report, maxObjects)
  for (let index = 0; index < entries.length; index += 1) {
    /** A cleanup record contributes only its error property, never its resource metadata. */
    const entry = entries[index]
    if ((typeof entry !== 'object' || entry === null) && typeof entry !== 'function') continue
    /** Cleanup entry reads use the same original-error reporting policy. */
    const read = tryReadProperty(entry as Record<string, unknown>, 'error')
    if (read.threw) {
      failed = true
      report(`${pointer}/cleanupErrors/${index}`, 'error', read.error)
    } else if (read.value !== undefined) output.push(read.value)
  }
  return failed
}
