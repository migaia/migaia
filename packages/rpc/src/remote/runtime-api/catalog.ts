import { RPC_PORTABLE_MAX_DEPTH } from '../../contract/normalize.js'
import { RpcWireLimit } from '../../contract/wire-constants.js'
import { RpcError, RpcCoreErrorCode } from '../../core/errors.js'
import type { IRpcContext } from '../../core/typing.js'
import { RemoteMethodName } from '../constants.js'
import {
  RemoteCatalogLimit,
  REMOTE_NAME_PATTERN,
  normalizeRemoteContract,
  RemoteMethodMode,
  type IRemoteContract,
  type IRemoteMethodContract
} from '../contract.js'
import { RuntimeApiErrorText, RuntimeApiMode } from './constants.js'

/** A callable receives the portable application payload and the original core provider context. */
export type IRuntimePeerMethod = (payload: any, context: IRpcContext) => unknown

/** Explicit own data members are the only methods admitted to the automatic directory. */
export type IRuntimePeerProvide = Readonly<{
  [name: string]: IRuntimePeerMethod | IRuntimePeerProvide
}>

/** Captured receiver/function identity makes runtime calls independent of later object mutation. */
export type IRuntimeMethodEntry = Readonly<{
  name: string
  method: IRuntimePeerMethod
  receiver: object
  /** Canonical reserved operations narrow their actual installed aliases at construction time. */
  supportedModes?: readonly RuntimeApiMode[]
  /** Only the original normalized advanced declaration authorizes logical retry. */
  declaration?: IRemoteMethodContract
  /** Only package-owned Host control routes retain authority outside an advanced business catalog. */
  reserved?: boolean
}>

/** Cold compilation metadata belongs to the same root object, never a second provider registry. */
const runtimePluginEntries = new WeakMap<IRuntimePeerProvide, readonly IRuntimeMethodEntry[]>()

/** The Plugin builder adds canonically compiled provide methods and its original Host controls. */
export function registerRuntimePluginMethods(
  provide: IRuntimePeerProvide,
  methods: readonly IRuntimeMethodEntry[]
): void {
  runtimePluginEntries.set(provide, Object.freeze([...methods]))
}

/** Reject malformed explicit configuration without disclosing the supplied member or value. */
function invalid(cause?: unknown): never {
  throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.provideInvalid, cause)
}

/**
 * Compile the explicit object once before opening a source. Own descriptors avoid getter execution;
 * the existing portable depth and remote catalog limits bound the same construction work.
 */
export function compileRuntimeMethods(
  input: IRuntimePeerProvide = {},
  advanced?: IRemoteContract
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
  for (const entry of runtimePluginEntries.get(input) ?? []) {
    if (methods.has(entry.name) || methods.size >= RemoteCatalogLimit.methodsPerCatalog) invalid()
    methods.set(entry.name, entry)
  }
  if (advanced) {
    /** Original v1 schema/mode/idempotency admission remains the sole advanced contract parser. */
    const contract = normalizeRemoteContract(advanced)
    /** The actual compiled callable table remains the only runtime route owner. */
    const declared = new Map<string, IRuntimeMethodEntry>()
    for (const [featureName, feature] of Object.entries(contract.features)) {
      for (const [methodName, declaration] of Object.entries(feature.methods)) {
        /** Advanced names remain three-segment; managed Plugin Feature names are locally flattened. */
        const fullName = `${contract.plugin}.${featureName}.${methodName}`
        /** Feature exposure has already established the exact flat callable receiver. */
        const entry = methods.get(fullName) ?? methods.get(`${contract.plugin}.${methodName}`)
        if (!entry || declared.has(entry.name)) invalid()
        /** Explicit legacy declarations narrow only the selected runtime operation. */
        const mode =
          declaration.mode === RemoteMethodMode.request
            ? RuntimeApiMode.request
            : declaration.mode === RemoteMethodMode.oneWay
              ? RuntimeApiMode.notify
              : RuntimeApiMode.stream
        declared.set(
          entry.name,
          Object.freeze({ ...entry, declaration, supportedModes: Object.freeze([mode]) })
        )
      }
    }
    /** Explicit Host controls keep their independent actual permission and scalar modes. */
    for (const entry of runtimePluginEntries.get(input) ?? [])
      if (entry.reserved) declared.set(entry.name, entry)
    return Object.freeze([...declared.values()])
  }
  return Object.freeze([...methods.values()])
}
