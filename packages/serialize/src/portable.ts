import { isUint8Array } from '@migaia/utils/bytes'
import { bytesToBase64url, isCanonicalBase64url } from './base64.js'
import { createSerializeTypeError, SerializeErrorCode } from './errors.js'
import { CodecErrorText } from './codec-text.js'
import type { ICodecValue } from './codec.js'

/** Factory tools keep binary detection and canonical base64url in the codec owner. */
type IPortableWalkerContext = Readonly<{
  reject: (reason: string, cause?: unknown) => never
  isAncestor: (value: object) => boolean
  isUint8Array: typeof isUint8Array
  bytesToBase64url: typeof bytesToBase64url
  isCanonicalBase64url: typeof isCanonicalBase64url
}>

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

/**
 * Policy owned by the caller, resolved once at factory creation. Hooks never recurse themselves.
 * Scalar/array/record validation may return a deferred violation to preserve projection failure
 * priority; immediate violations call context.reject. The violation hook throws the caller's own
 * coded native error and retains the supplied original failure on cause.
 */
export type IPortableWalkerStrategy = Readonly<{
  maxDepth?: number
  scalar: (value: unknown, context: IPortableWalkerContext) => IPortableScalar
  binary: (value: object, context: IPortableWalkerContext) => string | undefined
  record: (value: object, context: IPortableWalkerContext) => IPortableRecord | undefined
  array?: (
    value: unknown[],
    visit: (child: unknown) => unknown,
    context: IPortableWalkerContext
  ) => Readonly<{ value: unknown[]; length?: number; violation?: string }>
  key?: (key: string, context: IPortableWalkerContext) => void
  finish?: (value: unknown) => unknown
  violation: (reason: string, cause?: unknown) => never
}>

/** Invocation-local value, physical bound and binary evidence; no metadata survives the call. */
type IPortableNode = Readonly<{
  value: unknown
  byteUpperBound: number
  hasBinary: boolean
  violation?: string
}>

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

/**
 * Create one specialized portable walker. Strategy callbacks and depth are captured once; callers
 * create this function at module/owner scope. One traversal returns value, JSON UTF-8 byte upper
 * bound and binary presence. No native-binary negotiation, side tables or consumer profiles exist.
 */
export function createPortableWalker(
  strategy: IPortableWalkerStrategy
): (
  value: unknown,
  active?: Set<object>
) => Readonly<{ value: unknown; byteUpperBound: number; hasBinary: boolean }> {
  /** Resolve the complete strategy before any request; recursion never reads the strategy object. */
  const {
    maxDepth = Infinity,
    scalar,
    binary,
    record,
    array = mapPortableArray,
    key = admitPortableKey,
    finish = finishPortableValue,
    violation
  } = strategy
  if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 0))
    violation(PortableViolation.depth)
  /** Atomic bytes tags use one canonical construction and count their complete metadata. */
  const tagged = (base64url: string): IPortableNode => ({
    value: finish({
      [PortableBytesField.marker]: PortableBytesField.kind,
      [PortableBytesField.data]: base64url
    }),
    byteUpperBound: 31 + base64url.length,
    hasBinary: true
  })
  /** The only recursive graph owner performs snapshotting and accounting in the same pass. */
  const walk = (
    value: unknown,
    depth: number,
    active: Set<object>,
    context: IPortableWalkerContext,
    classified: (error: unknown) => boolean
  ): IPortableNode => {
    if (depth > maxDepth) context.reject(PortableViolation.depth)
    if (value === null || typeof value !== 'object') {
      const admitted = scalar(value, context)
      return {
        ...admitted,
        byteUpperBound: portableScalarBound(admitted.value),
        hasBinary: false
      }
    }
    /** A byte view is atomic: no backing graph scan or global binary marker is needed. */
    const bytes = binary(value, context)
    if (bytes !== undefined) return tagged(bytes)
    if (active.has(value)) context.reject(PortableViolation.cycle)
    active.add(value)
    try {
      /** Strategy decides array versus record projection before any child is visited. */
      const admitted = record(value, context)
      if (admitted?.tag !== undefined) return tagged(admitted.tag)
      /** Container punctuation precedes the fused contributions of its children. */
      let byteUpperBound = 2
      /** Binary proof belongs to this output node and its descendants only. */
      let hasBinary = false
      /** Keep the first legacy validation failure without stopping the projection pass. */
      let pending: string | undefined
      if (admitted === undefined) {
        /** Visited count lets the wire strategy retain sparse holes and charge them as null. */
        let visited = 0
        const output = array(
          value as unknown[],
          (child) => {
            const node = walk(child, depth + 1, active, context, classified)
            byteUpperBound += node.byteUpperBound
            hasBinary ||= node.hasBinary
            pending ??= node.violation
            visited++
            return node.value
          },
          context
        )
        /** Length metadata avoids reading the caller array after validation-only traversal. */
        const length = output.length ?? output.value.length
        byteUpperBound += Math.max(0, length - 1) + Math.max(0, length - visited) * 4
        return {
          value: finish(output.value),
          byteUpperBound,
          hasBinary,
          violation: pending ?? output.violation
        }
      }
      /** Validation-only records keep the caller object; copies get own data properties. */
      const output = admitted.output ?? (value as Record<string, unknown>)
      /** Count commas as entries are consumed without a second object-key traversal. */
      let count = 0
      for (const [name, child] of admitted.entries) {
        key(name, context)
        const node = walk(child, depth + 1, active, context, classified)
        if (admitted.output !== undefined)
          Object.defineProperty(output, name, {
            value: node.value,
            enumerable: true,
            configurable: true,
            writable: true
          })
        byteUpperBound += portableScalarBound(name) + 1 + node.byteUpperBound + (count++ ? 1 : 0)
        hasBinary ||= node.hasBinary
        pending ??= node.violation
      }
      /** Parent tag shape is checked before child validation, matching decoded assertion order. */
      const invalid = admitted.validate?.(output)
      return {
        value: finish(output),
        byteUpperBound,
        hasBinary: hasBinary || admitted.hasBinary === true,
        violation: invalid ?? pending
      }
    } catch (cause) {
      // Classified failures cross parents unchanged; a raw failure enters its container boundary.
      if (classified(cause)) throw cause
      return context.reject(PortableViolation.access, cause)
    } finally {
      active.delete(value)
    }
  }
  /** Each call shares this factory-owned traversal and creates only invocation state. */
  return (value, active = new Set<object>()) => {
    /** Identifies the exact error already raised by this strategy during this invocation. */
    let raised: unknown
    /** Distinguish a strategy that throws undefined from an application trap with that value. */
    let didRaise = false
    /** A strategy may deliberately pass through the original failure at a leaf boundary. */
    let rawFailure = false
    /** Route one violation through the caller owner, retaining its error identity across unwinding. */
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
    /** Helpers and failure routing are local to this walk; canonical byte algorithms remain shared. */
    const context: IPortableWalkerContext = {
      reject,
      isAncestor: (candidate) => active.has(candidate),
      isUint8Array,
      bytesToBase64url,
      isCanonicalBase64url
    }
    /** Raw pass-through failures remain eligible for the enclosing container's error policy. */
    const classified = (error: unknown): boolean => didRaise && error === raised && !rawFailure
    try {
      const result = walk(value, 0, active, context, classified)
      if (result.violation !== undefined) reject(result.violation)
      return Object.freeze({
        value: result.value,
        byteUpperBound: result.byteUpperBound,
        hasBinary: result.hasBinary
      })
    } catch (cause) {
      if (didRaise && cause === raised) throw cause
      return reject(PortableViolation.access, cause)
    }
  }
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
  if (reason === PortableViolation.access) throw cause
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

/** Default fused codec strategy finishes projection before raising its first validation failure. */
/** Capture the shared record hook once, without a strategy-object lookup in each node. */
const projectPortableRecord = projectionStrategy.record

/** Fused default policy retains legacy format behavior without exposing a consumer preset. */
const codecStrategy: IPortableWalkerStrategy = {
  ...projectionStrategy,
  scalar: (value) => ({
    value,
    violation: portableScalar(value) ? undefined : PortableViolation.scalar
  }),
  record: (value, context) => {
    const admitted = projectPortableRecord(value, context)
    if (!admitted) return undefined
    return {
      ...admitted,
      validate: (output) => invalidPortableTag(output, Object.keys(output)),
      hasBinary: admitted.hasBinary
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
const projectPortable = createPortableWalker(projectionStrategy)
/** Standalone assertion remains a thin identity-preserving default instance. */
const validatePortable = createPortableWalker(assertionStrategy)
/** Format codecs share the single fused default instance. */
const normalizeCodecPortable = createPortableWalker(codecStrategy)

/** Assert the legacy decoded portable profile without replacing or freezing caller data. */
export function assertPortableValue(value: unknown, active = new Set<object>()): void {
  validatePortable(value, active)
}

/** Validate and narrow a decoded format value while preserving its original identity. */
export function asCodecValue(value: unknown): ICodecValue {
  assertPortableValue(value)
  return value as ICodecValue
}

/** Preserve the legacy intermediate projection with a thin default walker instance. */
export function toPortableValue(value: unknown, active = new Set<object>()): unknown {
  return projectPortable(value, active).value
}

/** Fused default used only by this package's format codecs; its output remains byte-for-byte stable. */
export function toCodecPortableValue(value: unknown): ICodecValue {
  return normalizeCodecPortable(value).value as ICodecValue
}
