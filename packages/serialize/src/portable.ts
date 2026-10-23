import { isUint8Array } from '@migaia/utils/bytes'
import { bytesToBase64url, isCanonicalBase64url } from './base64.js'
import { createSerializeTypeError, SerializeErrorCode } from './errors.js'
import { CodecErrorText } from './codec-text.js'
import type { ICodecValue } from './codec.js'

/** Factory tools keep binary detection and canonical base64url in the codec owner. */
type IPortableWalkerContext = Readonly<{
  /** Rejects through the strategy's violation policy while preserving the supplied cause. */
  reject: (reason: string, cause?: unknown) => never
  /** Checks only the current invocation's ancestor path, not previously completed sibling values. */
  isAncestor: (value: object) => boolean
  /** Canonical byte-brand check available to the caller's binary admission. */
  isUint8Array: typeof isUint8Array
  /** Produces an unpadded base64url spelling for a strategy choosing inline bytes. */
  bytesToBase64url: typeof bytesToBase64url
  /** Tests the full canonical unpadded spelling, including unused tail bits. */
  isCanonicalBase64url: typeof isCanonicalBase64url
  /** Invocation-owned rejection guard, absent when native binary needs no extra admission. */
  beforeNativeBinary?: () => never
}>

/**
 * Binary outcomes are unboxed: inline text or borrowed native storage, with no descriptor
 * allocation.
 */
export type IPortableBinaryResult = string | Uint8Array | ArrayBuffer

/** Returning a primitive directly avoids a transient scalar admission object on hot paths. */
type IPortablePrimitive = null | string | boolean | number

/** A deferred violation lets projection finish before legacy validation chooses its failure. */
type IPortableScalar = Readonly<{ value: unknown; violation?: string }>

/** Record admission supplies captured or lazy entries; an omitted output means validation only. */
type IPortableRecord = Readonly<{
  entries: Iterable<readonly [string, unknown]>
  output?: Record<string, unknown>
  tag?: string
  hasBinary?: boolean
  validate?: (output: Record<string, unknown>) => string | undefined
}>

/** Explicit lexical ownership lets a caller retain a visitor without observing another array frame. */
type IPortableOwnedVisit = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  guard: (() => never) | undefined,
  bounds: boolean
) => unknown

/**
 * Policy owned by the caller, resolved once at factory creation. Hooks never recurse themselves.
 * Scalar/array/record validation may return a deferred violation to preserve projection failure
 * priority; immediate violations call context.reject. The violation hook throws the caller's own
 * coded native error and retains the supplied original failure on cause.
 */
export type IPortableWalkerStrategy = Readonly<{
  /** Maximum root-zero traversal depth; defaults to Infinity, otherwise a nonnegative safe integer. */
  maxDepth?: number
  /**
   * Projects primitives or returns a value with a deferred violation; called before container
   * admission.
   */
  scalar: (value: unknown, context: IPortableWalkerContext) => IPortableScalar | IPortablePrimitive
  /**
   * Supplies record entries and optional output/tag policy; undefined selects the array hook. An
   * omitted record output validates in place, while a supplied output receives projected fields.
   */
  record: (value: object, context: IPortableWalkerContext) => IPortableRecord | undefined
  /** Optional per-field admission before visiting a record child; defaults to accepting every key. */
  key?: (key: string, context: IPortableWalkerContext) => void
  /** Output field writer; defaults to defining a writable own enumerable data property. */
  write?: (output: Record<string, unknown>, key: string, child: unknown) => void
  /**
   * Optional final projection, default identity; the boolean proves native rather than inline
   * binary descendants.
   */
  finish?: (value: unknown, hasNativeBinary: boolean) => unknown
  /** Required error owner; must throw the caller's failure and retain an explicitly supplied cause. */
  violation: (reason: string, cause?: unknown) => never
}> &
  (
    | Readonly<{
        /**
         * Optional array projector, default map; use visit for children instead of recursing in the
         * strategy.
         */
        array?: (
          value: unknown[],
          visit: (child: unknown) => unknown,
          context: IPortableWalkerContext
        ) => unknown[] | Readonly<{ value: unknown[]; length?: number; violation?: string }>
        /** Mutually exclusive with the ordinary array hook. */
        arrayValue?: never
      }>
    | Readonly<{
        /** Mutually exclusive with the raw arrayValue hook. */
        array?: never
        /**
         * Raw array projection with explicit visitor ownership; it replaces the ordinary array
         * hook.
         */
        arrayValue: (
          value: unknown[],
          visit: IPortableOwnedVisit,
          childDepth: number,
          ancestors: Set<object>,
          guard: (() => never) | undefined,
          bounds: boolean,
          context: IPortableWalkerContext
        ) => unknown
      }>
  ) &
  (
    | Readonly<{
        /**
         * Returns inline base64url text for binary input, or undefined to continue container
         * admission.
         */
        binary: (value: object, context: IPortableWalkerContext) => string | undefined
        /** Native storage cannot be returned without its intrinsic length reader. */
        nativeByteLength?: never
      }>
    | Readonly<{
        /**
         * Returns inline text or borrowed native storage, retaining native identity; undefined
         * selects containers.
         */
        binary: (
          value: object,
          context: IPortableWalkerContext
        ) => IPortableBinaryResult | undefined
        /** Read the admitted native object's length through its owner's intrinsic slot accessor. */
        nativeByteLength: (value: Uint8Array | ArrayBuffer) => number
      }>
  )

/**
 * Callable projection returning a frozen metadata record: value, conservative byteUpperBound, and
 * hasBinary for inline or native bytes. Optional active ancestors are caller-owned, initialDepth
 * defaults to zero, and a per-call native guard is exposed to strategy admission. The value method
 * uses the same traversal without allocating metadata; payload freezing belongs to the strategy.
 */
type IPortableWalker = {
  (
    value: unknown,
    active?: Set<object>,
    initialDepth?: number,
    beforeNativeBinary?: () => never
  ): Readonly<{ value: unknown; byteUpperBound: number; hasBinary: boolean }>
  value: (
    value: unknown,
    active?: Set<object>,
    initialDepth?: number,
    beforeNativeBinary?: () => never
  ) => unknown
}

/** Stable portable bytes fields belong to this codec owner, including legacy tag validation. */
const PortableBytesField = {
  marker: '$rpc',
  data: 'base64url',
  kind: 'bytes'
} as const

/** Stable generic failure reasons supplied to consumer-owned error construction. */
const PortableViolation = {
  depth: 'depth',
  cycle: 'cycle',
  ancestor: 'ancestor',
  access: 'access',
  scalar: 'scalar',
  prototype: 'prototype',
  binary: 'binary',
  tag: 'tag',
  sparse: 'sparse'
} as const

/** Conservative JSON UTF-8 size uses at most six ASCII escape bytes per UTF-16 code unit. */
function portableScalarBound(value: unknown): number {
  if (typeof value === 'string') return value.length * 6 + 2
  if (typeof value === 'number') return 32
  if (typeof value === 'boolean') return 5
  if (value === null) return 4
  return 0
}

/** Default array projection preserves map/species/getter/hole semantics of existing consumers. */
const mapPortableArray = (
  value: unknown[],
  visit: (child: unknown) => unknown
): Readonly<{ value: unknown[]; length?: number; violation?: string }> => {
  /** Fresh map output owns its length; capture once instead of observing caller input again. */
  const output = value.map(visit)
  return { value: output, length: output.length }
}
/** Identity finish leaves existing codec copies mutable and decoded assertion inputs unchanged. */
const finishPortableValue = (value: unknown): unknown => value
/** Strategies without reserved fields need no key policy. */
const admitPortableKey = (): void => {}

/** Define safe own fields for the legacy ordinary-object output, including **proto**. */
function writePortableOwnField(output: Record<string, unknown>, key: string, child: unknown): void {
  Object.defineProperty(output, key, {
    value: child,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

/**
 * Create one specialized synchronous walker. Policy callbacks and context are bound once. Node
 * accounting stays in primitive invocation slots instead of allocating a result/context per node.
 * Nested calls save/restore the slots in finally; no caller graph survives a completed invocation.
 * Returns both a metadata-producing callable and its value-only method. The strategy owns shape,
 * prototype, binary, and error policies; this factory does not impose a single portable profile.
 */
export function createPortableWalker(strategy: IPortableWalkerStrategy): IPortableWalker {
  /** Capture strategy choices once; recursive dispatch never reads a consumer profile. */
  const {
    maxDepth = Infinity,
    scalar,
    binary,
    nativeByteLength,
    record,
    array = mapPortableArray,
    arrayValue,
    key = admitPortableKey,
    write = writePortableOwnField,
    finish = finishPortableValue,
    violation
  } = strategy
  if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 0))
    violation(PortableViolation.depth)
  /** Metadata callers collect bytes; value-only callers never observe unused output lengths. */
  let collectBounds = true
  /** Retained policy visitors can run after return without keeping invocation state alive. */
  let invocationDepth = 0
  /** Current synchronous ancestor owner; absent for root scalars and atomic binary values. */
  let active: Set<object> | undefined
  /** Optional guard is supplied by the current caller, rather than captured into another walker. */
  let beforeNativeBinary: (() => never) | undefined
  /** Exact strategy-raised error recognizes classified failures during ancestor unwinding. */
  let raised: unknown
  /** Separates an actual thrown undefined from the empty error slot. */
  let didRaise = false
  /** Raw cause propagation remains eligible for the original enclosing container boundary. */
  let rawFailure = false
  /** Last completed node's JSON/native byte bound, consumed immediately by its parent. */
  let nodeBytes = 0
  /** Last completed node's inline or native binary presence. */
  let nodeBinary = false
  /** Last completed node's native-only evidence for the caller's protocol marker. */
  let nodeNative = false
  /** First deferred validation failure, without constructing an error before projection completes. */
  let nodeInvalid: string | undefined
  /** Current array callback depth; nested arrays restore the previous visitor frame. */
  let visitDepth = 0
  /** Current array accumulator avoids per-array visitor closures and metadata wrappers. */
  let arrayBytes = 0
  /** Current array's generic binary evidence. */
  let arrayBinary = false
  /** Current array's native-only descendant evidence. */
  let arrayNative = false
  /** Current array's deferred validation priority. */
  let arrayInvalid: string | undefined
  /** Visited elements distinguish sparse holes from JSON null values. */
  let arrayVisited = 0

  /** Route a failure through its owning policy, retaining the exact error and original cause. */
  const reject = (reason: string, cause?: unknown): never => {
    try {
      return violation(reason, cause)
    } catch (error) {
      raised = error
      didRaise = true
      rawFailure = error === cause
      throw error
    }
  }
  /** One context exposes only the current synchronous invocation, including reentrant callers. */
  const context: IPortableWalkerContext = {
    reject,
    isAncestor: (value) => active?.has(value) === true,
    isUint8Array,
    bytesToBase64url,
    isCanonicalBase64url,
    get beforeNativeBinary() {
      return beforeNativeBinary
    }
  }
  /** Build the unchanged inline tag, without wrapping node accounting into another object. */
  const tagged = (base64url: string): unknown => {
    nodeBytes = 31 + base64url.length
    nodeBinary = true
    nodeNative = false
    nodeInvalid = undefined
    return finish(
      {
        [PortableBytesField.marker]: PortableBytesField.kind,
        [PortableBytesField.data]: base64url
      },
      false
    )
  }
  /** Shared array visitor uses the same node owner and immediately consumes its fused metadata. */
  const visit = (child: unknown): unknown => {
    const result = walk(child, visitDepth)
    arrayBytes += nodeBytes
    arrayBinary ||= nodeBinary
    arrayNative ||= nodeNative
    arrayInvalid ??= nodeInvalid
    arrayVisited++
    return result
  }
  /** Lexically bound policy visitors reuse the same walk while restoring any reentrant owner. */
  const ownedVisit: IPortableOwnedVisit = (child, depth, ancestors, guard, bounds) => {
    if (invocationDepth === 0) return execute(child, ancestors, depth, guard, identity)
    const previousActive = active
    const previousGuard = beforeNativeBinary
    const previousBounds = collectBounds
    active = ancestors
    beforeNativeBinary = guard
    collectBounds = bounds
    try {
      const result = walk(child, depth)
      arrayBytes += nodeBytes
      arrayBinary ||= nodeBinary
      arrayNative ||= nodeNative
      arrayInvalid ??= nodeInvalid
      arrayVisited++
      return result
    } finally {
      active = previousActive
      beforeNativeBinary = previousGuard
      collectBounds = previousBounds
    }
  }
  /** The sole recursive implementation returns values directly and fuses accounting in the slots. */
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > maxDepth) reject(PortableViolation.depth)
    if (value === null || typeof value !== 'object') {
      const admitted = scalar(value, context)
      if (admitted !== null && typeof admitted === 'object') {
        nodeBytes = collectBounds ? portableScalarBound(admitted.value) : 0
        nodeInvalid = admitted.violation
        nodeBinary = false
        nodeNative = false
        return admitted.value
      }
      nodeBytes = collectBounds ? portableScalarBound(admitted) : 0
      nodeInvalid = undefined
      nodeBinary = false
      nodeNative = false
      return admitted
    }
    const bytes = binary(value, context)
    if (typeof bytes === 'string') return tagged(bytes)
    if (bytes !== undefined) {
      nodeBytes = collectBounds ? nativeByteLength!(bytes) : 0
      nodeBinary = true
      nodeNative = true
      nodeInvalid = undefined
      return bytes
    }
    /** Binary admission precedes cycle checks; a supplied Set keeps its exact existing ownership. */
    const ancestors = (active ??= new Set<object>())
    /** Caller-owned Set failures keep a distinct policy boundary from container access traps. */
    let cyclic: boolean
    try {
      cyclic = ancestors.has(value)
      if (!cyclic) ancestors.add(value)
    } catch (cause) {
      return reject(PortableViolation.ancestor, cause)
    }
    if (cyclic) reject(PortableViolation.cycle)
    try {
      const admitted = record(value, context)
      if (admitted?.tag !== undefined) return tagged(admitted.tag)
      if (admitted === undefined) {
        /** Save only primitive visitor state; no array-frame object or request closure is allocated. */
        const previousDepth = visitDepth
        const previousBytes = arrayBytes
        const previousBinary = arrayBinary
        const previousNative = arrayNative
        const previousInvalid = arrayInvalid
        const previousVisited = arrayVisited
        visitDepth = depth + 1
        arrayBytes = 2
        arrayBinary = false
        arrayNative = false
        arrayInvalid = undefined
        arrayVisited = 0
        try {
          const admittedArray = arrayValue
            ? arrayValue(
                value as unknown[],
                ownedVisit,
                depth + 1,
                ancestors,
                beforeNativeBinary,
                collectBounds,
                context
              )
            : array(value as unknown[], visit, context)
          const raw = arrayValue !== undefined || Array.isArray(admittedArray)
          /** Annotated admission remains the default; raw policy outputs are never probed. */
          const annotation = admittedArray as Readonly<{
            value: unknown[]
            length?: number
            violation?: string
          }>
          const output = raw ? admittedArray : annotation.value
          if (collectBounds) {
            const length = raw
              ? (output as unknown[]).length
              : (annotation.length ?? (output as unknown[]).length)
            nodeBytes =
              arrayBytes + Math.max(0, length - 1) + Math.max(0, length - arrayVisited) * 4
          } else nodeBytes = 0
          nodeBinary = arrayBinary
          nodeNative = arrayNative
          nodeInvalid = arrayInvalid ?? (raw ? undefined : annotation.violation)
          return finish(output, nodeNative)
        } finally {
          visitDepth = previousDepth
          arrayBytes = previousBytes
          arrayBinary = previousBinary
          arrayNative = previousNative
          arrayInvalid = previousInvalid
          arrayVisited = previousVisited
        }
      }
      const output = admitted.output ?? (value as Record<string, unknown>)
      /** Parent-local accounting stays on the ordinary call stack across child calls. */
      let bytes = 2
      let binary = admitted.hasBinary === true
      let native = false
      let pending: string | undefined
      let count = 0
      for (const [name, child] of admitted.entries) {
        key(name, context)
        const normalized = walk(child, depth + 1)
        if (admitted.output !== undefined) write(output, name, normalized)
        if (collectBounds) bytes += portableScalarBound(name) + 1 + nodeBytes + (count++ ? 1 : 0)
        binary ||= nodeBinary
        native ||= nodeNative
        pending ??= nodeInvalid
      }
      nodeBytes = bytes
      nodeBinary = binary
      nodeNative = native
      nodeInvalid = admitted.validate?.(output) ?? pending
      return finish(output, native)
    } catch (cause) {
      if (didRaise && cause === raised && !rawFailure) throw cause
      return reject(PortableViolation.access, cause)
    } finally {
      try {
        ancestors.delete(value)
      } catch (cause) {
        reject(PortableViolation.ancestor, cause)
      }
    }
  }
  /** Metadata selection allocates only the caller-visible result, after the fused walk finishes. */
  const metadata = (value: unknown): unknown =>
    Object.freeze({ value, byteUpperBound: nodeBytes, hasBinary: nodeBinary })
  /** Value-only consumers skip the unused result box while still using the exact same traversal. */
  const identity = (value: unknown): unknown => value
  /**
   * Run one synchronous invocation; save/restore protects getter-driven reentry without side
   * tables.
   */
  const execute = (
    value: unknown,
    ancestors: Set<object> | undefined,
    depth: number,
    guard: (() => never) | undefined,
    select: (value: unknown) => unknown
  ): unknown => {
    const previousBounds = collectBounds
    const previousActive = active
    const previousGuard = beforeNativeBinary
    const previousRaised = raised
    const previousDidRaise = didRaise
    const previousRaw = rawFailure
    const previousBytes = nodeBytes
    const previousBinary = nodeBinary
    const previousNative = nodeNative
    const previousInvalid = nodeInvalid
    collectBounds = select === metadata
    active = ancestors
    beforeNativeBinary = guard
    raised = undefined
    didRaise = false
    rawFailure = false
    invocationDepth++
    try {
      const output = walk(value, depth)
      if (nodeInvalid !== undefined) reject(nodeInvalid)
      return select(output)
    } catch (cause) {
      if (didRaise && cause === raised) throw cause
      return reject(PortableViolation.access, cause)
    } finally {
      invocationDepth--
      collectBounds = previousBounds
      active = previousActive
      beforeNativeBinary = previousGuard
      raised = previousRaised
      didRaise = previousDidRaise
      rawFailure = previousRaw
      nodeBytes = previousBytes
      nodeBinary = previousBinary
      nodeNative = previousNative
      nodeInvalid = previousInvalid
    }
  }
  /** Both result shapes are module-level functions over one specialized recursive implementation. */
  const result = ((value: unknown, ancestors?: Set<object>, depth = 0, guard?: () => never) =>
    execute(value, ancestors, depth, guard, metadata)) as IPortableWalker
  result.value = (value, ancestors, depth = 0, guard) => {
    if (invocationDepth !== 0 || (value !== null && typeof value === 'object'))
      return execute(value, ancestors, depth, guard, identity)
    // An outer scalar cannot have a previous frame; keep the same walk without saving empty slots.
    collectBounds = false
    active = ancestors
    beforeNativeBinary = guard
    invocationDepth = 1
    try {
      const output = walk(value, depth)
      if (nodeInvalid !== undefined) reject(nodeInvalid)
      return output
    } catch (cause) {
      if (didRaise && cause === raised) throw cause
      return reject(PortableViolation.access, cause)
    } finally {
      invocationDepth = 0
      collectBounds = true
      active = undefined
      beforeNativeBinary = undefined
      raised = undefined
      didRaise = false
      rawFailure = false
      nodeInvalid = undefined
    }
  }
  return result
}

/** Legacy record keys read lazily so nested getters retain sorted or decoded traversal order. */
function* portableEntries(
  value: Record<string, unknown>,
  keys: readonly string[]
): Iterable<readonly [string, unknown]> {
  for (const key of keys) yield [key, value[key]]
}

/** Existing portable assertion recognizes only null/string/boolean/finite-number scalars. */
function portableScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

/** Preserve legacy public identity; raw projection/accessor failures stay with format wrappers. */
function raisePortableViolation(reason: string, cause?: unknown): never {
  if (reason === PortableViolation.access || reason === PortableViolation.ancestor) throw cause
  throw createSerializeTypeError(
    SerializeErrorCode.invalidOption,
    CodecErrorText.portableValueInvalid,
    cause === undefined ? undefined : { cause }
  )
}

/** Legacy bytes spelling intentionally validates only the alphabet, preserving decoded results. */
function invalidPortableTag(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  return keys.includes(PortableBytesField.marker) &&
    (keys.length !== 2 ||
      value[PortableBytesField.marker] !== PortableBytesField.kind ||
      typeof value[PortableBytesField.data] !== 'string' ||
      !/^[A-Za-z0-9_-]*$/u.test(value[PortableBytesField.data] as string))
    ? PortableViolation.tag
    : undefined
}

/** The legacy projection strategy remains private and contains no recursive traversal. */
const projectionStrategy: IPortableWalkerStrategy = {
  scalar: (value) => ({ value }),
  binary: (value, context) => {
    /** Existing conversion reads the public tag before its intrinsic Uint8Array brand probe. */
    const tag = ArrayBuffer.isView(value)
      ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
      : undefined
    if (context.isUint8Array(value) || tag === 'Uint8Array')
      return context.bytesToBase64url(
        context.isUint8Array(value) ? value : new Uint8Array(value as never)
      )
    if (
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set ||
      ArrayBuffer.isView(value)
    )
      context.reject(PortableViolation.binary)
    return undefined
  },
  record: (value) => {
    if (!Object.hasOwn(value, PortableBytesField.marker) && Array.isArray(value)) return undefined
    /** Sorted keys are captured once and also identify an enumerable wire tag. */
    const keys = Object.keys(value).sort()
    return {
      entries: portableEntries(value as Record<string, unknown>, keys),
      output: {},
      hasBinary: keys.includes(PortableBytesField.marker)
    }
  },
  violation: raisePortableViolation
}

/** Decoded assertion strategy retains original inputs and historical getter/enumeration semantics. */
const assertionStrategy: IPortableWalkerStrategy = {
  scalar: (value, context) => {
    if (!portableScalar(value)) context.reject(PortableViolation.scalar)
    return { value }
  },
  binary: (value, context) => {
    // Legacy validation rejects an ancestor before performing any binary/property probes.
    if (context.isAncestor(value)) context.reject(PortableViolation.cycle)
    const tag = ArrayBuffer.isView(value)
      ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
      : undefined
    if (
      context.isUint8Array(value) ||
      tag === 'Uint8Array' ||
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set
    )
      context.reject(PortableViolation.binary)
    return undefined
  },
  record: (value, context) => {
    if (Array.isArray(value)) return undefined
    /** Only prototype traps were historically wrapped by the standalone assertion API. */
    let prototype: object | null
    try {
      prototype = Object.getPrototypeOf(value)
    } catch (cause) {
      return context.reject(PortableViolation.prototype, cause)
    }
    if (prototype !== Object.prototype && prototype !== null)
      context.reject(PortableViolation.prototype)
    /** The captured key list is reused when validating a bytes tag, without another ownKeys trap. */
    const keys = Object.keys(value)
    const invalid = invalidPortableTag(value as Record<string, unknown>, keys)
    if (invalid !== undefined) context.reject(invalid)
    return {
      entries: keys.includes(PortableBytesField.marker)
        ? []
        : portableEntries(value as Record<string, unknown>, keys)
    }
  },
  array: (value, visit) => {
    /** Iterator visit count avoids any new caller length reads after legacy assertion. */
    let length = 0
    for (const child of value) {
      visit(child)
      length++
    }
    return { value, length }
  },
  violation: raisePortableViolation
}

/** Fused default policy retains legacy format behavior without exposing a consumer preset. */
const codecStrategy: IPortableWalkerStrategy = {
  ...projectionStrategy,
  scalar: (value) => ({
    value,
    violation: portableScalar(value) ? undefined : PortableViolation.scalar
  }),
  record: (value) => {
    if (!Object.hasOwn(value, PortableBytesField.marker) && Array.isArray(value)) return undefined
    /** Codec formats preserve enumeration order; public portable snapshots retain their sorting. */
    const keys = Object.keys(value)
    return {
      entries: portableEntries(value as Record<string, unknown>, keys),
      output: {},
      validate: (output) => invalidPortableTag(output, keys),
      hasBinary: keys.includes(PortableBytesField.marker)
    }
  },
  array: (value, visit) => {
    const output = value.map(visit)
    /** Read only the newly projected array's own length. */
    const length = output.length
    for (let index = 0; index < length; index++)
      if (!Object.hasOwn(output, index))
        return { value: output, length, violation: PortableViolation.sparse }
    return { value: output, length }
  }
}

/** Module-level default instances capture policy once; callers allocate only invocation state. */
const projectPortable = /* @__PURE__ */ createPortableWalker(projectionStrategy)
/** Standalone assertion remains a thin identity-preserving default instance. */
const validatePortable = /* @__PURE__ */ createPortableWalker(assertionStrategy)
/** Format codecs share the single fused default instance. */
const normalizeCodecPortable = /* @__PURE__ */ createPortableWalker(codecStrategy)

/**
 * Validates the decoded portable profile in place without cloning or freezing. Finite primitives,
 * arrays, ordinary/null-prototype records, and legacy bytes tags are accepted; unsupported values
 * or cycles throw INVALID_OPTION. Getters are observed, and access failures may pass through for an
 * enclosing codec to normalize. Optional active supplies an existing ancestor set, initially
 * empty.
 */
export function assertPortableValue(value: unknown, active = new Set<object>()): void {
  validatePortable.value(value, active)
}

/**
 * Validates using assertPortableValue and returns the exact original value as ICodecValue; byte
 * tags remain records.
 */
export function asCodecValue(value: unknown): ICodecValue {
  assertPortableValue(value)
  return value as ICodecValue
}

/**
 * Builds the legacy mutable projection: record keys are visited in sorted order and Uint8Array
 * becomes a bytes-tag record. Getters run, repeated sibling references are copied separately, and
 * cycles or unsupported binary containers reject. This intermediate projection may still contain
 * values outside ICodecValue; use asCodecValue or a format codec for final portable validation.
 */
export function toPortableValue(value: unknown, active = new Set<object>()): unknown {
  return projectPortable.value(value, active)
}

/** Fused format projection preserves property enumeration order without comparison sorting. */
export function toCodecPortableValue(value: unknown): ICodecValue {
  return normalizeCodecPortable.value(value) as ICodecValue
}

/** Collection tag fields extend the same reserved record namespace as portable bytes. */
const PortableCollectionField = {
  map: 'map',
  set: 'set',
  entries: 'entries',
  values: 'values'
} as const

/** Captured slot accessors admit genuine cross-realm collections even after prototype changes. */
const intrinsicMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
/** Captured Set slot accessor bypasses caller-controlled prototypes and tags. */
const intrinsicSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!
/** Captured iterators avoid caller replacements of Symbol.iterator or collection methods. */
const intrinsicMapEntries = Map.prototype.entries
/** Captured Set iteration retains insertion order without consulting user properties. */
const intrinsicSetValues = Set.prototype.values

/** Brand mismatch is expected during slot admission, so native TypeError means a different kind. */
function collectionKind(value: object): 'map' | 'set' | undefined {
  try {
    Reflect.apply(intrinsicMapSize, value, [])
    return PortableCollectionField.map
  } catch {
    // A non-Map has no Map internal slot; probe the other supported collection.
  }
  try {
    Reflect.apply(intrinsicSetSize, value, [])
    return PortableCollectionField.set
  } catch {
    return undefined
  }
}

/** Reject malformed reserved records after recursively validating every admitted child. */
function invalidCollectionTag(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  if (!keys.includes(PortableBytesField.marker)) return undefined
  if (value[PortableBytesField.marker] === PortableBytesField.kind)
    return invalidPortableTag(value, keys)
  if (keys.length !== 2) return PortableViolation.tag
  if (value[PortableBytesField.marker] === PortableCollectionField.map) {
    const entries = value[PortableCollectionField.entries]
    if (
      !Array.isArray(entries) ||
      !entries.every((entry) => Array.isArray(entry) && entry.length === 2)
    )
      return PortableViolation.tag
    return undefined
  }
  if (
    value[PortableBytesField.marker] === PortableCollectionField.set &&
    Array.isArray(value[PortableCollectionField.values])
  )
    return undefined
  return PortableViolation.tag
}

/** Collection admission shares scalar, array, own-field, and bytes rules with the format profile. */
const collectionsStrategy: IPortableWalkerStrategy = {
  ...codecStrategy,
  binary: (value, context) =>
    collectionKind(value) === undefined ? codecStrategy.binary(value, context) : undefined,
  record: (value, context) => {
    const kind = collectionKind(value)
    if (kind !== undefined) {
      const field =
        kind === PortableCollectionField.map
          ? PortableCollectionField.entries
          : PortableCollectionField.values
      const children =
        kind === PortableCollectionField.map
          ? Array.from(Reflect.apply(intrinsicMapEntries, value, []))
          : Array.from(Reflect.apply(intrinsicSetValues, value, []))
      return {
        entries: [
          [PortableBytesField.marker, kind],
          [field, children]
        ],
        output: {}
      }
    }
    const admitted = codecStrategy.record(value, context)
    if (admitted === undefined) return undefined
    return {
      ...admitted,
      validate: (output) => invalidCollectionTag(output, Object.keys(output))
    }
  }
}

/** Encoding leaves reserved records intact for the single native JSON stringify operation. */
const projectCollections = /* @__PURE__ */ createPortableWalker(collectionsStrategy)
/** Decoding restores collections only after their recursively projected records pass admission. */
const restoreCollections = /* @__PURE__ */ createPortableWalker({
  ...collectionsStrategy,
  finish: (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    const invalid = invalidCollectionTag(record, Object.keys(record))
    if (invalid !== undefined) raisePortableViolation(invalid)
    if (record[PortableBytesField.marker] === PortableCollectionField.map)
      return new Map(record[PortableCollectionField.entries] as [unknown, unknown][])
    if (record[PortableBytesField.marker] === PortableCollectionField.set)
      return new Set(record[PortableCollectionField.values] as unknown[])
    return value
  }
})

/** Package-internal collection projection reuses the portable walker and reserved-field owner. */
export function toCollectionsPortableValue(value: unknown): ICodecValue {
  return projectCollections.value(value) as ICodecValue
}

/** Package-internal restoration retains bytes records while restoring nested Map and Set values. */
export function fromCollectionsPortableValue(value: unknown): unknown {
  return restoreCollections.value(value)
}
