import { RPC_PORTABLE_MAX_DEPTH } from '../../contract/normalize.js'
import { RpcWireLimit } from '../../contract/wire-constants.js'
import { RpcError, RpcCoreErrorCode } from '../../core/errors.js'
import type { IRpcContext } from '../../core/typing.js'
import { RemoteMethodName } from '../constants.js'
import { RemoteCatalogLimit, REMOTE_NAME_PATTERN } from '../contract.js'
import { RuntimeApiErrorText } from './constants.js'

/** A callable receives the portable application payload and the original core provider context. */
export type IRuntimePeerMethod = (payload: unknown, context: IRpcContext) => unknown

/** Explicit own data members are the only methods admitted to the automatic directory. */
export type IRuntimePeerProvide = Readonly<{
  [name: string]: IRuntimePeerMethod | IRuntimePeerProvide
}>

/** Captured receiver/function identity makes runtime calls independent of later object mutation. */
export type IRuntimeMethodEntry = Readonly<{
  name: string
  method: IRuntimePeerMethod
  receiver: object
}>

/** Reject malformed explicit configuration without disclosing the supplied member or value. */
function invalid(cause?: unknown): never {
  throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.provideInvalid, cause)
}

/**
 * Compile the explicit object once before opening a source. Own descriptors avoid getter execution;
 * the existing portable depth and remote catalog limits bound the same construction work.
 */
export function compileRuntimeMethods(
  input: IRuntimePeerProvide = {}
): readonly IRuntimeMethodEntry[] {
  /** Only active ancestors identify a cycle; independent groups may reuse the same handler. */
  const active = new Set<object>()
  /** Logical paths are the sole whitelist; neither control methods nor internal aliases enter it. */
  const methods = new Map<string, IRuntimeMethodEntry>()
  /** The existing segment grammar excludes ambiguous dots and mutable prototype names as paths. */
  const segment = new RegExp(REMOTE_NAME_PATTERN, 'u')

  /** Snapshot each group before descending, preserving a thrown descriptor trap as the cause. */
  function visit(value: IRuntimePeerProvide, prefix: string, depth: number): void {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      depth > RPC_PORTABLE_MAX_DEPTH
    )
      invalid()
    if (active.has(value)) invalid()
    /** Prototype and descriptors are configuration data; no application getter is read. */
    let descriptors: PropertyDescriptorMap
    /** A rejected prototype is a configuration failure; a failed trap retains its own cause. */
    let prototype: object | null
    try {
      prototype = Object.getPrototypeOf(value)
      descriptors = Object.getOwnPropertyDescriptors(value)
    } catch (cause) {
      invalid(cause)
    }
    if (prototype !== null && prototype !== Object.prototype) invalid()
    active.add(value)
    try {
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || !segment.test(key)) invalid()
        /** An accessor is rejected from its descriptor without evaluating its value. */
        const descriptor = descriptors[key]!
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
        /** Internal stream aliases share the original wire identifier budget with logical names. */
        const name = prefix === '' ? key : `${prefix}.${key}`
        if (
          name.length + RemoteMethodName.runtimeStreamPrefix.length >
            RpcWireLimit.maxIdentifierChars ||
          name.startsWith(RemoteMethodName.runtimeNamespace)
        )
          invalid()
        if (typeof descriptor.value !== 'function') {
          visit(descriptor.value as IRuntimePeerProvide, name, depth + 1)
          continue
        }
        if (methods.has(name) || methods.size >= RemoteCatalogLimit.methodsPerCatalog) invalid()
        methods.set(
          name,
          Object.freeze({ name, method: descriptor.value as IRuntimePeerMethod, receiver: value })
        )
      }
    } finally {
      active.delete(value)
    }
  }

  visit(input, '', 0)
  return Object.freeze([...methods.values()])
}
