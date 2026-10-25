/**
 * The provider catalog's one descriptor-order compiler. Migrated from runtime-api/catalog; it
 * captures local receivers and held-forward identity without invoking getters or opening sources.
 */
import { RPC_PORTABLE_MAX_DEPTH } from '@migaia/rpc-contract/portable'
import {
  RPC_PROVIDER_METHOD_MAX_CHARS,
  RpcWireLimit,
  RPC_PROVIDER_RESERVED_NAMESPACE
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcProviderDeclarationLimit,
  RpcProviderMode,
  REMOTE_NAME_PATTERN,
  type IRpcProviderDeclaration
} from '@migaia/rpc-contract/protocol'

import { createRpcError } from '../host/error-owner.js'
import { normalizeRpcProviderDeclaration } from './declaration.js'

import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import type {
  IProviderCommitGate,
  IProviderPreflight,
  IProviderForwardEntry,
  IProviderMethodEntry,
  IRpcProvide,
  IRpcProviderMethod
} from './types.js'

/** Exact local callable identity alone grants access to its installing Feature's commit gate. */
const commitGates = new WeakMap<Function, IProviderCommitGate>()
/** Exact callback identity retains the original synchronous pre-admission guard. */
const providerPreflight = new WeakMap<Function, IProviderPreflight>()

/** Attach the one native availability or forward-route guard to its original callable. */
export function attachProviderPreflight<T extends Function>(
  provider: T,
  check: IProviderPreflight
): T {
  providerPreflight.set(provider, check)
  return provider
}

/** Whole-group and scalar admission borrow the same private original guard. */
export function readProviderPreflight(
  provider: Function | undefined
): IProviderPreflight | undefined {
  return provider ? providerPreflight.get(provider) : undefined
}

/** A captured forwarded callable keeps compact metadata, never a Session or Peer facade. */
const heldForwards = new WeakMap<Function, IProviderForwardEntry>()

/** Installers attach their existing admission gate to the actual captured local function. */
export function attachProviderCommitGate<T extends Function>(
  method: T,
  gate: IProviderCommitGate
): T {
  commitGates.set(method, gate)
  return method
}
/** Dispatch checks the original installation at its existing invocation point. */
export function readProviderCommitGate(method: Function): IProviderCommitGate | undefined {
  return commitGates.get(method)
}
/** Namespace capability construction retains this exact original held-forward identity. */
export function retainProviderForwardMethod<T extends Function>(
  method: T,
  entry: IProviderForwardEntry
): T {
  heldForwards.set(method, entry)
  return method
}

/** Preserve the existing redacted native configuration failure and original descriptor trap cause. */
function invalid(cause?: unknown): never {
  throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.provideInvalid, cause)
}
/** One cold compilation owns ancestor cycle detection and its sole method lookup index. */
type ICompilation = {
  active: Set<object>
  methods: Map<string, IProviderMethodEntry>
  segment: RegExp
}

/** Visit one captured group in descriptor order; bounded depth makes path copying O(input size). */
function visit(context: ICompilation, value: IRpcProvide, prefix: string, depth: number): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    depth > RPC_PORTABLE_MAX_DEPTH
  )
    invalid()
  if (context.active.has(value)) invalid()
  /** Reflection happens once before descending and never reads an application accessor. */
  let descriptors: PropertyDescriptorMap
  /** Plain or null-prototype groups are the established supported catalog domain. */
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch (cause) {
    invalid(cause)
  }
  if (prototype !== null && prototype !== Object.prototype) invalid()
  context.active.add(value)
  try {
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') invalid()
      /** Descriptor admission preserves the original rejection order before nested compilation. */
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
      /** Only an actual held binding may flatten a previously admitted remote method path. */
      const forward =
        typeof descriptor.value === 'function' ? heldForwards.get(descriptor.value) : undefined
      if (
        !context.segment.test(key) &&
        (!forward || !key.split('.').every((part) => context.segment.test(part)))
      )
        invalid()
      /** Ordinary own-data providers retain their original margin; held paths use the wire limit. */
      const name = prefix === '' ? key : `${prefix}.${key}`
      if (
        name.length > (forward ? RpcWireLimit.maxIdentifierChars : RPC_PROVIDER_METHOD_MAX_CHARS) ||
        name.startsWith(RPC_PROVIDER_RESERVED_NAMESPACE)
      )
        invalid()
      if (typeof descriptor.value !== 'function') {
        visit(context, descriptor.value as IRpcProvide, name, depth + 1)
        continue
      }
      if (
        context.methods.has(name) ||
        context.methods.size >= RpcProviderDeclarationLimit.methodsPerCatalog
      )
        invalid()
      context.methods.set(
        name,
        Object.freeze(
          forward
            ? { ...forward, name, commitGate: readProviderCommitGate(descriptor.value) }
            : {
                name,
                method: descriptor.value as IRpcProviderMethod,
                receiver: value
              }
        )
      )
    }
  } finally {
    context.active.delete(value)
  }
}

/** Existing advanced declarations select the same request/notify/stream mode on the sole index. */
function declaredMethods(
  methods: ReadonlyMap<string, IProviderMethodEntry>,
  advanced: IRpcProviderDeclaration
): ReadonlyMap<string, IProviderMethodEntry> {
  /** Contract normalization remains in its canonical owner, including original error classification. */
  const contract = normalizeRpcProviderDeclaration(advanced)
  /** Whitelisting is cold and indexed; no per-call scan or reconstructed provider table exists. */
  const declared = new Map<string, IProviderMethodEntry>()
  for (const [featureName, feature] of Object.entries(contract.features)) {
    for (const [methodName, declaration] of Object.entries(feature.methods)) {
      /** Original three-segment declarations also accept the managed flattened callable path. */
      const fullName = `${contract.plugin}.${featureName}.${methodName}`
      /** Capture the selected entry once; later source mutation cannot change its receiver. */
      const entry = methods.get(fullName) ?? methods.get(`${contract.plugin}.${methodName}`)
      if (!entry || declared.has(entry.name)) invalid()
      /** The declaration's finite three-mode domain requires no dynamic mode registry. */
      const mode =
        declaration.mode === RpcProviderMode.request
          ? ('request' as const)
          : declaration.mode === RpcProviderMode.oneWay
            ? ('notify' as const)
            : ('stream' as const)
      declared.set(
        entry.name,
        Object.freeze({ ...entry, declaration, supportedModes: Object.freeze([mode]) })
      )
    }
  }
  return declared
}

/** Compile once before native source opening and publish this exact lookup index to dispatch. */
export function compileProviderMethods(
  input: IRpcProvide = {},
  advanced?: IRpcProviderDeclaration
): ReadonlyMap<string, IProviderMethodEntry> {
  /** The one input traversal owns both whitelist identity and descriptor-order output. */
  const context: ICompilation = {
    active: new Set(),
    methods: new Map(),
    segment: new RegExp(REMOTE_NAME_PATTERN, 'u')
  }
  visit(context, input, '', 0)
  return advanced ? declaredMethods(context.methods, advanced) : context.methods
}
