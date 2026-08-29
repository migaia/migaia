import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

/** Property keys accepted by tuple paths. */
export type IObjectPathSegment = string | number | symbol
export type IObjectPathTuple = readonly IObjectPathSegment[]

type IStringKey<T> = Extract<keyof T, string>
type IArrayValue<T> = T extends readonly (infer V)[] ? V : never
type IPathDepth = readonly [1, 1, 1, 1, 1, 1, 1, 1]
type IShift<T extends readonly unknown[]> = T extends readonly [unknown, ...infer R] ? R : []
type IJoinPath<K extends string, P extends string> = P extends `[${string}]`
  ? `${K}.${P}`
  : `${K}.${P}`
type IPrefixTuple<K extends PropertyKey, P> = P extends IObjectPathTuple
  ? readonly [K, ...P]
  : never

/** Typed dot/bracket paths, capped at eight levels to bound compiler work. */
export type IObjectPath<T, D extends readonly unknown[] = IPathDepth> = D extends readonly []
  ? never
  : T extends readonly unknown[]
    ? `[${number}]` | `[${number}].${IObjectPath<IArrayValue<T>, IShift<D>>}`
    : T extends object
      ? {
          [K in IStringKey<T>]:
            | K
            | (IObjectPath<T[K], IShift<D>> extends infer P extends string
                ? IJoinPath<K, P>
                : never)
        }[IStringKey<T>]
      : never

/** Typed readonly tuple paths, including number indexes and symbol object keys. */
export type IObjectPathTupleFor<
  T,
  D extends readonly unknown[] = IPathDepth
> = D extends readonly []
  ? never
  : T extends readonly (infer V)[]
    ? readonly [number] | IPrefixTuple<number, IObjectPathTupleFor<NonNullable<V>, IShift<D>>>
    : T extends object
      ? {
          [K in keyof T]:
            | readonly [K]
            | IPrefixTuple<K, IObjectPathTupleFor<NonNullable<T[K]>, IShift<D>>>
        }[keyof T]
      : never

/** All statically valid string and tuple paths for one root type. */
export type IObjectPathInput<T> = IObjectPath<T> | IObjectPathTupleFor<T>

type IStringSegmentValue<T, S extends string> = S extends `[${number}]`
  ? T extends readonly (infer V)[]
    ? V
    : never
  : S extends keyof T
    ? T[S]
    : never
type IStringPathValue<T, P extends string> = P extends `${infer H}.${infer R}`
  ? IStringPathValue<NonNullable<IStringSegmentValue<T, H>>, R>
  : IStringSegmentValue<T, P>
type ITuplePathValue<T, P extends IObjectPathTuple> = P extends readonly [
  infer H extends IObjectPathSegment,
  ...infer R extends IObjectPathTuple
]
  ? ITuplePathValue<NonNullable<H extends keyof T ? T[H] : never>, R>
  : T

/** Resolves a string or tuple path to its value type. */
export type IObjectPathValue<T, P extends IObjectPath<T> | IObjectPathTuple> = P extends string
  ? IStringPathValue<T, P>
  : P extends IObjectPathTuple
    ? ITuplePathValue<T, P>
    : never

/** Widens literal leaves for immutable writes while preserving the path's structural type. */
type IObjectPathWritableLeaf<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends bigint
        ? bigint
        : T

/** Resolves the accepted replacement type for a string or tuple path. */
export type IObjectPathWriteValue<
  T,
  P extends IObjectPath<T> | IObjectPathTuple
> = IObjectPathWritableLeaf<IObjectPathValue<T, P>>

export type IPathValueProbe<T, P extends IObjectPathInput<T>> = {
  readonly kind: 'value'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly value: IObjectPathValue<T, P>
}
export type IPathMissingProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'missing'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
export type IPathBlockedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'blocked'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
export type IPathFailedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'failed'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
  readonly error: unknown
}
export type IPathProbe<T, P extends IObjectPathInput<T>> =
  | IPathValueProbe<T, P>
  | IPathMissingProbe<P>
  | IPathBlockedProbe<P>
  | IPathFailedProbe<P>

type IStringGetEvent<T> = {
  [P in IObjectPath<T>]: IPathGetEvent<T, P>
}[IObjectPath<T>]
type IStringSetEvent<T> = {
  [P in IObjectPath<T>]: IPathSetEvent<T, P>
}[IObjectPath<T>]
type ITupleGetEvent<T> = IPathGetEvent<T, IObjectPathTupleFor<T>>
type ITupleSetEvent<T> = IPathSetEvent<T, IObjectPathTupleFor<T>>

/** Correlated read hook; replacement remains the exact narrowed path value type. */
export type IPathGetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathValue<T, P>
  replace(value: IObjectPathValue<T, P>): void
}

/** Correlated write hook; literal primitive leaves accept their widened write type. */
export type IPathSetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathWriteValue<T, P>
  replace(value: IObjectPathWriteValue<T, P>): void
}

export type IPathAccessorOptions<T> = {
  readonly ifMissing?: (probe: IPathMissingProbe) => void
  readonly ifBlocked?: (probe: IPathBlockedProbe) => void
  readonly ifFailed?: (probe: IPathFailedProbe) => void
  readonly onGet?: (event: IStringGetEvent<T> | ITupleGetEvent<T>) => void
  readonly onSet?: (event: IStringSetEvent<T> | ITupleSetEvent<T>) => void
}

export type IPathAccessor<T> = {
  readonly value: T
  get<P extends IObjectPathInput<T>>(path: P): IObjectPathValue<T, P> | undefined
  set<P extends IObjectPathInput<T>>(path: P, value: IObjectPathWriteValue<T, P>): T
  probeValue<P extends IObjectPathInput<T>>(path: P): IPathProbe<T, P>
  parsePath(path: string | IObjectPathTuple): IObjectPathTuple
}

/** Keys rejected to prevent prototype mutation when constructing missing branches. */
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor'])
/** Runtime limits keep untrusted paths linear and bounded. */
const maxPathLength = 4096
const maxSegmentLength = 512
const maxSegments = 256

/** Creates a package-coded invalid-path error without changing its native type. */
function invalidPath(path: string, reason: string): TypeError {
  const error = new TypeError(UtilsErrorText.objectPathInvalid(path, reason))
  attachErrorIdentity(error, { source: '@migaia/utils', code: UtilsErrorCode.objectPathInvalid })
  return error
}

/** Parses strict `a.b.[0].c` syntax or snapshots a tuple path. */
export function parseObjectPath(path: string | IObjectPathTuple): IObjectPathTuple {
  if (typeof path !== 'string') {
    if (path.length === 0 || path.length > maxSegments)
      throw invalidPath('path', 'invalid segment count')
    for (const segment of path) {
      if (
        (typeof segment !== 'string' &&
          typeof segment !== 'number' &&
          typeof segment !== 'symbol') ||
        (typeof segment === 'string' &&
          (segment.length === 0 ||
            segment.length > maxSegmentLength ||
            dangerousKeys.has(segment))) ||
        (typeof segment === 'number' && (!Number.isSafeInteger(segment) || segment < 0))
      )
        throw invalidPath(String(segment), 'invalid segment')
    }
    return Object.freeze([...path])
  }
  if (path.length === 0 || path.length > maxPathLength)
    throw invalidPath(path, 'invalid path length')
  const segments = path.split('.').map((part) => {
    const index = /^\[(\d+)\]$/.exec(part)
    if (index) {
      const value = Number(index[1])
      if (!Number.isSafeInteger(value)) throw invalidPath(part, 'array index is not safe')
      return value
    }
    if (
      part.length === 0 ||
      part.length > maxSegmentLength ||
      /[[\]]/.test(part) ||
      dangerousKeys.has(part)
    )
      throw invalidPath(part, 'invalid segment')
    return part
  })
  if (segments.length > maxSegments) throw invalidPath(path, 'invalid segment count')
  return Object.freeze(segments)
}

/** Traverses each segment once and preserves missing, blocked, and thrown-getter diagnostics. */
function probeParsedObjectPath<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P,
  segments: IObjectPathTuple
): IPathProbe<T, P> {
  let parent: unknown = object
  for (let index = 0; index < segments.length; index++) {
    const key = segments[index]
    const base = {
      originKey: path,
      segments,
      failedAt: index,
      failedKey: key,
      resolvedPath: segments.slice(0, index),
      parent
    } as const
    if (parent === null || (typeof parent !== 'object' && typeof parent !== 'function'))
      return { kind: 'blocked', ...base }
    let exists: boolean
    try {
      exists = Reflect.has(parent, key)
    } catch (error) {
      return { kind: 'failed', ...base, error }
    }
    if (!exists) return { kind: 'missing', ...base }
    try {
      parent = Reflect.get(parent, key, parent)
    } catch (error) {
      return { kind: 'failed', ...base, error }
    }
  }
  return { kind: 'value', originKey: path, segments, value: parent as IObjectPathValue<T, P> }
}

/** Parses and probes one path in a single operation. */
export function probeObjectPath<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P
): IPathProbe<T, P> {
  return probeParsedObjectPath(object, path, parseObjectPath(path))
}

/** Probes an already parsed tuple without reparsing it during delivery. */
export function probeObjectPathSegments<T, P extends IObjectPathInput<T>>(
  object: T,
  segments: P
): IPathProbe<T, P> {
  return probeParsedObjectPath(object, segments, segments as IObjectPathTuple)
}

/** Reads one path; missing/blocked paths yield undefined while getter failures remain observable. */
export function get<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P
): IObjectPathValue<T, P> | undefined {
  const probe = probeObjectPath(object, path)
  if (probe.kind === 'failed') throw probe.error
  return probe.kind === 'value' ? probe.value : undefined
}

/** Clones a traversed container while preserving its prototype and own descriptors. */
function cloneContainer(value: object, replacedKey: IObjectPathSegment): object {
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null)
    throw invalidPath(String(replacedKey), 'path container is not a plain object or array')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  Reflect.deleteProperty(descriptors, replacedKey)
  return Object.defineProperties(Object.create(Object.getPrototypeOf(value)), descriptors)
}

/** Performs an immutable path update with structural sharing and missing-container creation. */
export function set<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P,
  nextValue: IObjectPathWriteValue<T, P>
): T {
  const segments = parseObjectPath(path)
  const update = (current: unknown, index: number): unknown => {
    if (index === segments.length) return nextValue
    const key = segments[index]
    if (
      current !== undefined &&
      (current === null || (typeof current !== 'object' && typeof current !== 'function'))
    )
      throw invalidPath(String(key), 'path is blocked by a non-object value')
    const source = current === undefined ? (typeof key === 'number' ? [] : {}) : current
    const exists = Reflect.has(source as object, key)
    const child = exists ? Reflect.get(source as object, key, source) : undefined
    const updated = update(child, index + 1)
    if (exists && Object.is(child, updated)) return source
    const target = cloneContainer(source as object, key)
    const descriptor = Object.getOwnPropertyDescriptor(source as object, key)
    Object.defineProperty(
      target,
      key,
      descriptor && 'value' in descriptor
        ? { ...descriptor, value: updated }
        : { value: updated, enumerable: true, configurable: true, writable: true }
    )
    return target
  }
  return update(object, 0) as T
}

/** Creates a reusable accessor whose immutable root advances after each successful set. */
export function createPathAccessor<T>(
  object: T,
  options: IPathAccessorOptions<T> = {}
): IPathAccessor<T> {
  let current = object
  const { ifMissing, ifBlocked, ifFailed, onGet, onSet } = options
  const notifyFailure = (probe: IPathProbe<T, IObjectPathInput<T>>): void => {
    if (probe.kind === 'missing') ifMissing?.(probe)
    else if (probe.kind === 'blocked') ifBlocked?.(probe)
    else if (probe.kind === 'failed') ifFailed?.(probe)
  }
  const transformGet = <P extends IObjectPathInput<T>>(
    value: IObjectPathValue<T, P>,
    probe: IPathValueProbe<T, P>,
    hook: IPathAccessorOptions<T>['onGet']
  ): IObjectPathValue<T, P> => {
    let transformed = value
    const event: IPathGetEvent<T, P> = {
      originKey: probe.originKey,
      segments: probe.segments,
      probe,
      value,
      replace: (replacement) => {
        transformed = replacement
      }
    }
    hook?.(event as IStringGetEvent<T> | ITupleGetEvent<T>)
    return transformed
  }
  const transformSet = <P extends IObjectPathInput<T>>(
    value: IObjectPathWriteValue<T, P>,
    probe: IPathValueProbe<T, P>,
    hook: IPathAccessorOptions<T>['onSet']
  ): IObjectPathWriteValue<T, P> => {
    let transformed = value
    const event: IPathSetEvent<T, P> = {
      originKey: probe.originKey,
      segments: probe.segments,
      probe,
      value,
      replace: (replacement) => {
        transformed = replacement
      }
    }
    hook?.(event as IStringSetEvent<T> | ITupleSetEvent<T>)
    return transformed
  }
  return {
    get value() {
      return current
    },
    get: (path) => {
      const probe = probeObjectPath(current, path)
      if (probe.kind !== 'value') {
        notifyFailure(probe)
        if (probe.kind === 'failed') throw probe.error
        return undefined
      }
      return transformGet(probe.value, probe, onGet)
    },
    set: (path, value) => {
      const before = probeObjectPath(current, path)
      if (before.kind !== 'value') notifyFailure(before)
      if (before.kind === 'failed') throw before.error
      if (before.kind === 'blocked') return set(current, path, value)
      const synthetic: IPathValueProbe<T, typeof path> = {
        kind: 'value',
        originKey: path,
        segments: before.segments,
        value: value as IObjectPathValue<T, typeof path>
      }
      current = set(current, path, transformSet(value, synthetic, onSet))
      return current
    },
    probeValue: (path) => probeObjectPath(current, path),
    parsePath: (path) => parseObjectPath(path)
  }
}
