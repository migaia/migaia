/**
 * Restore validated wire nodes to native errors and boundary extensions, preserving remote stacks
 * and descriptors.
 */
import { attachErrorIdentity } from './error-primitives.ts'
import { ErrorChainNativeName } from '../error-chain-constants.ts'
import type {
  IErrorChainData,
  IErrorChainStrategy,
  ISerializedErrorChain
} from '../error-chain-types.ts'

/** Restore the native type and property descriptors without changing the remote stack. */
export function restore(value: ISerializedErrorChain, strategy: IErrorChainStrategy): Error {
  /** Collect cause, aggregate entries, and cleanup failures in their observable order. */
  const children = value.errors?.map((child) => restore(child, strategy)) ?? []
  /** The default constructor policy retains all supported native classes. */
  const error = strategy.createError?.(value, children) ?? createNativeError(value, children)
  if (error.name !== value.name)
    Object.defineProperty(error, 'name', { value: value.name, configurable: true })
  Object.defineProperty(error, 'stack', {
    value: value.stack,
    configurable: true,
    writable: true
  })
  if (strategy.attachIdentity) strategy.attachIdentity(error, value)
  else attachErrorIdentity(error, { source: value.source, code: value.code })
  if (value.cause)
    Object.defineProperty(error, 'cause', {
      value: restore(value.cause, strategy),
      configurable: true,
      writable: true
    })
  if (value.errors && value.name !== ErrorChainNativeName.aggregate)
    Object.defineProperty(error, 'errors', {
      value: Object.freeze(children),
      configurable: true
    })
  if (value.data !== undefined)
    Object.defineProperty(error, 'data', { value: value.data, enumerable: true })
  for (const extension of strategy.extensions ?? []) {
    if (!Object.hasOwn(value, extension.field)) continue
    /** Restored extension metadata remains boundary-owned and never grants generic authority. */
    const extensionValue = (value as unknown as Record<string, unknown>)[extension.field]
    if (extensionValue === undefined) continue
    Object.defineProperty(error, extension.field, { value: extensionValue, enumerable: true })
    extension.restore?.(error, extensionValue as IErrorChainData)
  }
  if (value.truncated === true) Object.defineProperty(error, 'truncated', { value: true })
  return error
}

/** Restore supported built-in classes without interpreting received constructor names as code. */
function createNativeError(value: ISerializedErrorChain, children: readonly Error[]): Error {
  /** Use the host native abort class when available without introducing a platform dependency. */
  const DomException = (
    globalThis as unknown as {
      DOMException?: new (message?: string, name?: string) => Error
    }
  ).DOMException
  return value.name === ErrorChainNativeName.aggregate
    ? new AggregateError(children, value.message)
    : value.name === ErrorChainNativeName.abort && typeof DomException === 'function'
      ? new DomException(value.message, ErrorChainNativeName.abort)
      : value.name === ErrorChainNativeName.type
        ? new TypeError(value.message)
        : value.name === ErrorChainNativeName.range
          ? new RangeError(value.message)
          : value.name === ErrorChainNativeName.syntax
            ? new SyntaxError(value.message)
            : value.name === ErrorChainNativeName.reference
              ? new ReferenceError(value.message)
              : value.name === ErrorChainNativeName.uri
                ? new URIError(value.message)
                : value.name === ErrorChainNativeName.eval
                  ? new EvalError(value.message)
                  : new Error(value.message)
}
