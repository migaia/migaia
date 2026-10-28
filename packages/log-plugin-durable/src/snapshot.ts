import { DurableErrorField } from './errors.ts'
import { createDurableTypeError, LogDurableErrorCode, ERROR_SOURCE } from './errors.ts'
import { DurableText } from './error-text.ts'
import type { ILogPayload, ILogRecordInput } from './types.ts'

/** Rejects invalid payloads without evaluating getters, toJSON, or class methods. */
function invalid(): never {
  throw createDurableTypeError(LogDurableErrorCode.logPayloadInvalid, DurableText.payloadInvalid)
}
/** Copies one JSON tree iteratively, tracking the current path rather than shared object identities. */
function copyPayload(input: unknown): ILogPayload {
  /** Mutable root slot allows the same iterative visitor to handle primitives and containers. */
  const root: { value?: ILogPayload } = {}
  /** Current ancestors identify cycles while allowing repeated references on different branches. */
  const ancestors = new Set<object>()
  /** Work stack stores explicit leave steps so deeply nested JSON never recurses. */
  const stack: ({ value: unknown; assign: (value: ILogPayload) => void } | { leave: object })[] = [
    {
      value: input,
      assign: (value) => {
        root.value = value
      }
    }
  ]
  while (stack.length) {
    const item = stack.pop()!
    if ('leave' in item) {
      ancestors.delete(item.leave)
      continue
    }
    const value = item.value
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      item.assign(value)
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid()
      item.assign(value)
      continue
    }
    if (typeof value !== 'object') invalid()
    if (ancestors.has(value)) invalid()
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (!array && prototype !== Object.prototype && prototype !== null) invalid()
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors]
      if (descriptor.enumerable && (typeof key === 'symbol' || !('value' in descriptor))) invalid()
    }
    const output: ILogPayload[] | Record<string, ILogPayload> = array ? [] : {}
    item.assign(output)
    ancestors.add(value)
    stack.push({ leave: value })
    if (array) {
      for (let index = value.length - 1; index >= 0; index--) {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !('value' in descriptor)) invalid()
        stack.push({
          value: descriptor.value,
          assign: (copy) => {
            ;(output as ILogPayload[])[index] = copy
          }
        })
      }
    } else {
      const keys = Object.keys(descriptors)
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]
        const descriptor = descriptors[key]
        if (!descriptor.enumerable) continue
        stack.push({
          value: descriptor.value,
          assign: (copy) => {
            Object.defineProperty(output, key, {
              value: copy,
              enumerable: true,
              writable: true,
              configurable: true
            })
          }
        })
      }
    }
  }
  return root.value!
}
/** Validates nonempty identity strings without coercion. */
export function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0)
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
}
/** Captures a complete batch before any task enters a queue or invokes a transaction port. */
function copyRecords(
  records: readonly ILogRecordInput[]
): readonly { readonly kind: string; readonly payload: ILogPayload }[] {
  if (!Array.isArray(records))
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
  return records.map((record) => {
    if (!record || typeof record !== 'object')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    const kind = Object.getOwnPropertyDescriptor(record, 'kind')
    const payload = Object.getOwnPropertyDescriptor(record, 'payload')
    if (!kind || !('value' in kind) || !payload || !('value' in payload)) invalid()
    requireText(kind.value)
    return { kind: kind.value, payload: snapshotPayload(payload.value) }
  })
}

/** Contains reflection failures at the sole payload admission boundary while preserving their cause. */
export function snapshotPayload(input: unknown): ILogPayload {
  try {
    return copyPayload(input)
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw error
    throw createDurableTypeError(
      LogDurableErrorCode.logPayloadInvalid,
      DurableText.payloadInvalid,
      {
        cause: error
      }
    )
  }
}

/** Captures record descriptors at the same admission boundary as payload reflection. */
export function snapshotLogRecords(
  records: readonly ILogRecordInput[]
): readonly { readonly kind: string; readonly payload: ILogPayload }[] {
  try {
    return copyRecords(records)
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw error
    throw createDurableTypeError(
      LogDurableErrorCode.logPayloadInvalid,
      DurableText.payloadInvalid,
      {
        cause: error
      }
    )
  }
}
