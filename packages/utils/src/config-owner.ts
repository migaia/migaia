/** Own immutable configuration snapshots, validation, asynchronous loading and scoped watchers. */
import { ERROR_SOURCE, UtilsErrorCode, type IUtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity, safeErrorReason } from './error.js'
import { isPlainObject } from './object.js'
import type { IObjectPath, IObjectPathValue, IObjectPathWriteValue } from './object-path.js'
import { reportUnhandledError } from './host-report.js'
import { raceWithAbort, withTimeout, type IAbortSignal } from './promise.js'
import { orderStringKeys } from './internal/string-order.js'
import {
  CONFIG_DELETE,
  combineConfig,
  ownConfig,
  parseConfigPath,
  patchConfig,
  readConfigPath,
  readonlyConfig,
  type IConfigCombineOptions,
  type IConfigPatch,
  type IConfigPatchOptions,
  type IConfigReadResult,
  type IConfigRecord,
  type IOwnConfigOptions,
  type IOwnedConfig
} from './config.js'

/** Deep readonly view type returned by `view()`, `get()` and watch listeners. */
export type IConfigView<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<K, IConfigView<V>>
    : T extends ReadonlySet<infer V>
      ? ReadonlySet<IConfigView<V>>
      : T extends Date | RegExp
        ? T
        : T extends object
          ? { readonly [K in keyof T]: IConfigView<T[K]> }
          : T

/** A path accepted by `ConfigOwner`: a typed dot/bracket string or a pre-split segment list. */
export type IConfigOwnerPath<T> = IObjectPath<T> | readonly string[]

/** Value type at a typed path; `unknown` for segment lists whose type cannot be inferred. */
export type IConfigOwnerPathValue<T, P> =
  P extends IObjectPath<T> ? IObjectPathValue<T, P> : unknown

/** Replacement value type at a typed path; literal leaves are widened. */
export type IConfigOwnerWriteValue<T, P> =
  P extends IObjectPath<T> ? IObjectPathWriteValue<T, P> : unknown

/**
 * Validates one candidate snapshot. Throwing or returning `false` rejects the change with
 * `CONFIG_VALIDATION_FAILED` and keeps the previous snapshot.
 */
export type IConfigValidator<T> = (value: IConfigView<T>) => boolean | void

/** Construction options shared by the constructor and the `from*` statics. */
export type IConfigOwnerOptions<T> = IOwnConfigOptions & {
  /** Runs on construction and on every commit (once per `batch`). */
  readonly validate?: IConfigValidator<T>
  /** Receives watch-listener failures. Defaults to the host's uncaught-error queue. */
  readonly report?: (error: unknown) => void
}

/** Options for `ConfigOwner.from()`. */
export type IConfigOwnerParseOptions<T> = IConfigOwnerOptions<T> & {
  /** Forwarded to `JSON.parse`. */
  readonly reviver?: (this: unknown, key: string, value: unknown) => unknown
}

/** Source accepted by `ConfigOwner.fromAsync()`: a value, a Promise, or a lazy factory. */
export type IConfigAsyncSource<T> =
  | string
  | T
  | PromiseLike<string | T>
  | ((context: { readonly signal: IAbortSignal }) => string | T | PromiseLike<string | T>)

/** Options for `ConfigOwner.fromAsync()`. */
export type IConfigOwnerAsyncOptions<T> = IConfigOwnerParseOptions<T> & {
  /** Abort the wait; rejects with `UtilsAbortError` (`ABORTED`). */
  readonly signal?: IAbortSignal
  /** Deadline in milliseconds; rejects with `UtilsTimeoutError` (`DEADLINE_EXCEEDED`). */
  readonly timeoutMs?: number
}

/** Options for `ConfigOwner.fromEnv()`. */
export type IConfigOwnerEnvOptions<T> = IConfigOwnerOptions<T> & {
  /** Only keys starting with this prefix are read; the prefix is removed. */
  readonly prefix?: string
  /** Nesting separator inside a key. Defaults to `'__'` (`APP__DB__PORT` → `db.port`). */
  readonly separator?: string
  /** Maps each key segment, for example to lower case. Defaults to identity. */
  readonly key?: (segment: string) => string
  /** Converts each raw string value. Defaults to identity. */
  readonly coerce?: (raw: string, path: readonly string[]) => unknown
}

/** One entry returned by `diff()`. */
export type IConfigDiffEntry = {
  readonly path: readonly string[]
  readonly kind: 'added' | 'removed' | 'changed'
}

/**
 * A config source accepted by `combine()` / `merge()` / `diff()`. Owners of any shape are accepted;
 * `any` is required because private fields make `ConfigOwner<T>` invariant in `T`.
 */
// oxlint-disable-next-line no-explicit-any
export type IConfigSource = ConfigOwner<any> | IConfigRecord

/** Plain value type of one source. */
type ISourceValue<S> = S extends ConfigOwner<infer V> ? V : S

/** Intersection of a union, used to type merged sources. */
type IUnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Merged value type of a source tuple. */
export type IMergedConfig<S extends readonly IConfigSource[]> = IUnionToIntersection<
  ISourceValue<S[number]>
> &
  IConfigRecord

/** One registered watch listener; `path` is absent for root listeners. */
type IConfigWatcher = {
  readonly path: readonly string[] | undefined
  readonly listener: (next: unknown, prev: unknown) => void
}

/** Marker returned by the path rebuild when a delete targets a missing path (no change). */
const UNCHANGED: unique symbol = Symbol('UNCHANGED')

/** Only records created for the current unpublished environment draft may be updated in place. */
type IEnvConstructionContext = {
  /** Borrowed coerce values remain outside this set and retain the original per-edge copy policy. */
  readonly owned: WeakSet<object>
}

/** Creates a coded native error without replacing its native type. */
function ownerError(
  Constructor: TypeErrorConstructor | ErrorConstructor,
  code: IUtilsErrorCode,
  message: string,
  cause?: unknown
): Error {
  return attachErrorIdentity(
    new Constructor(message, cause === undefined ? undefined : { cause }),
    { source: ERROR_SOURCE, code }
  )
}

/** Source throws and rejections share one coded boundary while retaining the original cause. */
function configSourceFailure(cause: unknown): Error {
  return ownerError(
    Error,
    UtilsErrorCode.configSourceFailed,
    UtilsErrorText.configSourceFailed,
    cause
  )
}

/** Resolve only the supplied source; parsing, owner construction and cancellation stay outside. */
function loadConfigSource<T extends IConfigRecord>(
  source: IConfigAsyncSource<T>,
  context: { readonly signal: IAbortSignal }
): Promise<unknown> {
  /** Preserve the original factory and thenable observation before source error normalization. */
  let produced: unknown
  try {
    produced = typeof source === 'function' ? source(context) : source
  } catch (cause) {
    return Promise.reject(configSourceFailure(cause))
  }
  return Promise.resolve(produced).then(
    (value) => value,
    (cause: unknown) => {
      throw configSourceFailure(cause)
    }
  )
}

/** Turns an owner path into validated segments through the canonical config path parser. */
function toSegments(path: unknown): readonly string[] {
  if (typeof path === 'string') return parseConfigPath(path)
  if (!Array.isArray(path) || path.length === 0)
    throw ownerError(
      TypeError,
      UtilsErrorCode.configPathInvalid,
      UtilsErrorText.configPathInvalid(String(path), 'non-empty string or segment list required')
    )
  for (const segment of path)
    if (typeof segment !== 'string' || segment.length === 0 || segment.includes('.'))
      throw ownerError(
        TypeError,
        UtilsErrorCode.configPathInvalid,
        UtilsErrorText.configPathInvalid(String(segment), 'invalid segment')
      )
  // Re-parse the joined form so dangerous keys and limits use the one canonical policy.
  parseConfigPath(path.join('.'))
  return Object.freeze([...path])
}

/** Reads one own data property without invoking accessors. */
function ownValue(
  node: unknown,
  key: string
): { readonly found: boolean; readonly value: unknown } {
  if (node === null || typeof node !== 'object') return { found: false, value: undefined }
  /** Descriptor read avoids running getters on owned graphs. */
  const descriptor = Object.getOwnPropertyDescriptor(node, key)
  return descriptor && 'value' in descriptor
    ? { found: true, value: descriptor.value }
    : { found: false, value: undefined }
}

/** Walks raw owned data along segments; never wraps or copies. */
function rawAt(root: unknown, segments: readonly string[]): { found: boolean; value: unknown } {
  /** Current node during the walk. */
  let node = root
  for (const segment of segments) {
    /** Own data value of the current segment. */
    const next = ownValue(node, segment)
    if (!next.found) return { found: false, value: undefined }
    node = next.value
  }
  return { found: true, value: node }
}

/** Array index segment check; config paths spell indexes as plain digit strings. */
function isIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment)
}

/** Shallow copy of a record that keeps its prototype and own data descriptors. */
function copyRecord(node: object): Record<string, unknown> {
  /** Copy with the same prototype (plain or null-prototype). */
  const copy = Object.create(Object.getPrototypeOf(node)) as Record<string, unknown>
  for (const key of Reflect.ownKeys(node)) {
    /** Source descriptor, copied as is so enumerability stays unchanged. */
    const descriptor = Object.getOwnPropertyDescriptor(node, key)
    if (descriptor) Object.defineProperty(copy, key, descriptor)
  }
  return copy
}

/**
 * Rebuilds one container along `segments` with copy-on-write. Missing intermediates become plain
 * records. A delete of a missing path returns `UNCHANGED`. Environment construction may reuse only
 * records already owned by its unpublished draft; ordinary writes retain copy-on-write.
 */
function rebuild(
  node: unknown,
  segments: readonly string[],
  value: unknown,
  at: string,
  construction?: IEnvConstructionContext
): unknown {
  if (segments.length === 0) return value
  // All callers use toSegments and parseConfigPath's fixed default maxPathLength of 4096
  // (config.ts). Suffix and diagnostic-prefix copies have that fixed bound, independent of env width.
  /** Current segment and its remaining path. */
  const [segment, ...rest] = segments
  /** Owned child at this segment, if any. */
  const child = ownValue(node, segment)
  if (node === undefined) {
    if (value === CONFIG_DELETE) return UNCHANGED
    /** Missing records belong only to this construction, never to a supplied coerce value. */
    const record = {
      [segment]: rebuild(undefined, rest, value, `${at}.${segment}`, construction)
    }
    construction?.owned.add(record)
    return record
  }
  if (Array.isArray(node)) {
    if (!isIndex(segment))
      throw ownerError(
        TypeError,
        UtilsErrorCode.configPathInvalid,
        UtilsErrorText.configPathInvalid(`${at}.${segment}`, 'array index required')
      )
    /** Numeric index into the copied array. */
    const index = Number(segment)
    if (value === CONFIG_DELETE && rest.length === 0) {
      if (index >= node.length) return UNCHANGED
      return [...node.slice(0, index), ...node.slice(index + 1)]
    }
    /** Rebuilt child; unchanged children keep the original array. */
    const next = rebuild(
      child.found ? child.value : undefined,
      rest,
      value,
      `${at}.${segment}`,
      construction
    )
    if (next === UNCHANGED) return UNCHANGED
    /** Copy-on-write array; the original stays untouched. */
    const copy = [...node]
    copy[index] = next
    return copy
  }
  if (!isPlainObject(node))
    throw ownerError(
      TypeError,
      UtilsErrorCode.configPathInvalid,
      UtilsErrorText.configPathInvalid(at, 'record or array required')
    )
  if (value === CONFIG_DELETE && rest.length === 0) {
    if (!child.found) return UNCHANGED
    /** Copy without the deleted key. */
    const copy = copyRecord(node)
    delete copy[segment]
    return copy
  }
  /** Rebuilt child. */
  const next = rebuild(
    child.found ? child.value : undefined,
    rest,
    value,
    `${at}.${segment}`,
    construction
  )
  if (next === UNCHANGED) return UNCHANGED
  /** Only an unexposed private draft avoids copying its growing record; borrowed records detach. */
  const copy = construction?.owned.has(node) ? node : copyRecord(node)
  Object.defineProperty(copy, segment, {
    configurable: true,
    enumerable: true,
    value: next,
    writable: true
  })
  construction?.owned.add(copy)
  return copy
}

/** Leaf equality used by `diff()` and path-scoped watchers. */
function sameLeaf(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
}

/** Collects differences between two plain graphs; containers are compared key by key. */
function collectDiff(
  left: unknown,
  right: unknown,
  path: readonly string[],
  out: IConfigDiffEntry[],
  depth: number
): void {
  if (sameLeaf(left, right)) return
  /** Both sides are comparable containers of the same kind. */
  const containers =
    depth < 256 &&
    ((Array.isArray(left) && Array.isArray(right)) || (isPlainObject(left) && isPlainObject(right)))
  if (!containers) {
    out.push(Object.freeze({ path, kind: 'changed' }))
    return
  }
  /** Union of own string keys, left keys first for stable order. */
  const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)])
  for (const key of keys) {
    /** Child path, frozen because entries are returned to callers. */
    const childPath = Object.freeze([...path, key])
    /** Own data values on each side. */
    const before = ownValue(left, key)
    const after = ownValue(right, key)
    if (!before.found) out.push(Object.freeze({ path: childPath, kind: 'added' }))
    else if (!after.found) out.push(Object.freeze({ path: childPath, kind: 'removed' }))
    else collectDiff(before.value, after.value, childPath, out, depth + 1)
  }
}

/**
 * Converts an owned graph into JSON data. Dates use `toISOString()`; values JSON cannot represent
 * (Map, Set, functions, bigint, symbols) throw `CONFIG_UNSUPPORTED`.
 */
function toPlain(value: unknown, path: string, depth: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined) return undefined
  if (value instanceof Date) return value.toISOString()
  if (depth > 256)
    throw ownerError(
      TypeError,
      UtilsErrorCode.configUnsupported,
      UtilsErrorText.configUnsupported(path, 'graph is too deep for JSON')
    )
  if (Array.isArray(value))
    return value.map((item, index) => {
      /** JSON writes `undefined` array items as `null`. */
      const plain = toPlain(item, `${path}.${index}`, depth + 1)
      return plain === undefined ? null : plain
    })
  if (isPlainObject(value)) {
    /** Plain output record. */
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      /** Converted child; `undefined` keys are omitted as `JSON.stringify` does. */
      const plain = toPlain(value[key], `${path}.${key}`, depth + 1)
      if (plain !== undefined) out[key] = plain
    }
    return out
  }
  throw ownerError(
    TypeError,
    UtilsErrorCode.configUnsupported,
    UtilsErrorText.configUnsupported(path, 'value is not JSON serializable')
  )
}

/**
 * Stateful owner of one immutable config snapshot.
 *
 * Every write builds a complete next snapshot through the existing `ownConfig` / `patchConfig` /
 * `combineConfig` primitives, validates it, and only then commits it, so a failed write leaves the
 * previous snapshot untouched. Writes return `this`, so calls chain. Reads return deep readonly
 * views. All state is private and the prototype is frozen.
 *
 * @example
 *   ;```ts
 *   const config = new ConfigOwner({ server: { port: 80 }, debug: false })
 *   config.set('server.port', 8080).patch({ debug: true })
 *   config.get('server.port') // 8080, typed as number
 *   ```
 */
export class ConfigOwner<T extends IConfigRecord = IConfigRecord> {
  /** Current committed owned snapshot. Never mutated in place; replaced on every commit. */
  #config: IOwnedConfig<T>
  /** Snapshot captured at construction, restored by `reset()`. */
  readonly #initial: IOwnedConfig<T>
  /** Ownership options reused when plain sources are owned for `combine()`. */
  readonly #ownOptions: IOwnConfigOptions
  /** Optional validator run before every commit. */
  readonly #validate: IConfigValidator<T> | undefined
  /** Receives watch-listener failures, which must never be swallowed. */
  readonly #report: (error: unknown) => void
  /** Registered watchers in registration order. */
  readonly #watchers = new Set<IConfigWatcher>()
  /** Whether writes are permanently rejected with `CONFIG_READONLY`. */
  #locked = false
  /** Whether listeners are running; writes during notification are reentrant and rejected. */
  #notifying = false
  /** Nesting depth of `batch()`; commits are deferred while it is positive. */
  #batchDepth = 0

  /**
   * Owns a copy of `value` (validated by `ownConfig`). Throws the `ownConfig` errors for invalid
   * roots and `CONFIG_VALIDATION_FAILED` when the validator rejects the initial value.
   */
  constructor(value: T, options?: IConfigOwnerOptions<T>) {
    /** Options read once so later caller edits have no effect. */
    const { validate, report, profile, limits } = options ?? {}
    if (validate !== undefined && typeof validate !== 'function')
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('validate', UtilsErrorText.functionExpectation)
      )
    if (report !== undefined && typeof report !== 'function')
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('report', UtilsErrorText.functionExpectation)
      )
    this.#ownOptions = Object.freeze({
      ...(profile === undefined ? {} : { profile }),
      ...(limits === undefined ? {} : { limits })
    })
    this.#validate = validate
    this.#report = report ?? reportUnhandledError
    /** Owned initial snapshot. */
    const owned = ownConfig(value, this.#ownOptions)
    this.#check(owned)
    this.#config = owned
    this.#initial = owned
  }

  /**
   * Parses JSON text into an owner. Non-string input or invalid JSON throws `CONFIG_PARSE_FAILED`
   * with the parser error on `cause`; a non-record root throws `CONFIG_UNSUPPORTED`.
   *
   * @example
   *   ;```ts
   *   const config = ConfigOwner.from<{ port: number }>('{"port":80}')
   *   ```
   */
  static from<T extends IConfigRecord = IConfigRecord>(
    text: string,
    options?: IConfigOwnerParseOptions<T>
  ): ConfigOwner<T> {
    if (typeof text !== 'string')
      throw ownerError(
        TypeError,
        UtilsErrorCode.configParseFailed,
        UtilsErrorText.configParseFailed('text must be a string')
      )
    /** Parsed root; validated by the constructor. */
    let parsed: unknown
    try {
      parsed = JSON.parse(text, options?.reviver)
    } catch (cause) {
      throw ownerError(
        TypeError,
        UtilsErrorCode.configParseFailed,
        UtilsErrorText.configParseFailed(safeErrorReason(cause, 'invalid JSON')),
        cause
      )
    }
    return new ConfigOwner(parsed as T, options)
  }

  /**
   * Builds an owner from an asynchronous source: a Promise, a value, or a factory that receives an
   * abort signal (pass it to `fetch`). Strings are parsed as JSON.
   *
   * Rejections and factory throws become `CONFIG_SOURCE_FAILED` (original on `cause`); `signal` and
   * `timeoutMs` reject with the standard abort/timeout errors. Pair with `createResource` to get a
   * reactive config resource.
   *
   * @example
   *   ;```ts
   *   const config = await ConfigOwner.fromAsync(
   *     ({ signal }) => fetch('/config.json', { signal }).then((r) => r.text()),
   *     { timeoutMs: 5000 }
   *   )
   *   ```
   */
  static async fromAsync<T extends IConfigRecord = IConfigRecord>(
    source: IConfigAsyncSource<T>,
    options?: IConfigOwnerAsyncOptions<T>
  ): Promise<ConfigOwner<T>> {
    /** The operation borrows explicit source input; its normalization belongs to the loader. */
    const load = (context: { readonly signal: IAbortSignal }): Promise<unknown> =>
      loadConfigSource(source, context)
    /** Loaded root, raced against the optional deadline and signal. */
    const loaded =
      options?.timeoutMs !== undefined
        ? await withTimeout(load, { timeoutMs: options.timeoutMs, signal: options.signal })
        : options?.signal !== undefined
          ? await raceWithAbort(load, { signal: options.signal })
          : await load({ signal: new AbortController().signal })
    return typeof loaded === 'string'
      ? ConfigOwner.from<T>(loaded, options)
      : new ConfigOwner(loaded as T, options)
  }

  /**
   * Builds a nested config from flat environment variables. Pass `process.env`,
   * `Deno.env.toObject()` or any record; values stay strings unless `coerce` converts them.
   * Conflicting keys (`APP__DB=1` and `APP__DB__PORT=2`) throw `CONFIG_CONFLICT`.
   *
   * @example
   *   ;```ts
   *   ConfigOwner.fromEnv(process.env, {
   *     prefix: 'APP__',
   *     key: (s) => s.toLowerCase(),
   *     coerce: Number
   *   })
   *   ```
   */
  static fromEnv<T extends IConfigRecord = IConfigRecord>(
    env: Readonly<Record<string, string | undefined>>,
    options?: IConfigOwnerEnvOptions<T>
  ): ConfigOwner<T> {
    if (env === null || typeof env !== 'object')
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('env', 'a record of strings')
      )
    /** Options with defaults. */
    const {
      prefix = '',
      separator = '__',
      key = (segment: string) => segment,
      coerce
    } = options ?? {}
    if (typeof separator !== 'string' || separator.length === 0)
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('separator', 'a non-empty string')
      )
    /** Nested root built from every matching key. */
    let root: unknown = {}
    /** Construction owns only this root and later path records, never callback-provided objects. */
    const construction: IEnvConstructionContext = { owned: new WeakSet([root as object]) }
    for (const name of orderStringKeys(Object.keys(env))) {
      /** Raw string value; non-strings are skipped like unset variables. */
      const raw = env[name]
      if (typeof raw !== 'string' || !name.startsWith(prefix)) continue
      /** Segments after the prefix, mapped by the caller's key policy. */
      const segments = name
        .slice(prefix.length)
        .split(separator)
        .map((segment) => key(segment))
      /** Validated segments; invalid names throw `CONFIG_PATH_INVALID`. */
      const path = toSegments(segments)
      /** One cursor visits each prefix once; no repeated slicing or retraversal. */
      let prefixNode = root
      for (let index = 1; index <= path.length; index += 1) {
        /** Descriptor probing preserves the original own-data conflict policy. */
        const existing = ownValue(prefixNode, path[index - 1]!)
        if (existing.found && (index === path.length || !isPlainObject(existing.value)))
          throw ownerError(
            TypeError,
            UtilsErrorCode.configConflict,
            UtilsErrorText.configConflict(path.slice(0, index).join('.'), `environment key ${name}`)
          )
        prefixNode = existing.value
      }
      root = rebuild(root, path, coerce ? coerce(raw, path) : raw, 'env', construction)
    }
    return new ConfigOwner(root as T, options)
  }

  /**
   * Merges sources left to right into a new owner (later sources win, records merge deeply).
   *
   * @example
   *   ;```ts
   *   const config = ConfigOwner.merge(defaults, fileConfig, envConfig)
   *   ```
   */
  static merge<S extends readonly [IConfigSource, ...IConfigSource[]]>(
    ...sources: S
  ): ConfigOwner<IMergedConfig<S>> {
    if (sources.length === 0)
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('sources', 'at least one source')
      )
    /** First source becomes the owner; the rest are combined into it. */
    const [first, ...rest] = sources
    /** New owner seeded with the first source. */
    const owner: ConfigOwner<IConfigRecord> =
      first instanceof ConfigOwner ? first.clone() : new ConfigOwner(first as IConfigRecord)
    return owner.combine(...rest) as unknown as ConfigOwner<IMergedConfig<S>>
  }

  /** Brand check: `true` only for real `ConfigOwner` instances. */
  static is(value: unknown): value is ConfigOwner {
    return value !== null && typeof value === 'object' && #config in value
  }

  /** Whether writes are rejected after `lock()`. */
  get locked(): boolean {
    return this.#locked
  }

  /**
   * Value at a typed path as a deep readonly view, or `undefined` when missing.
   *
   * @example
   *   ;```ts
   *   config.get('server.port') // number | undefined
   *   ```
   */
  get<const P extends IConfigOwnerPath<T>>(
    path: P
  ): IConfigView<IConfigOwnerPathValue<T, P>> | undefined {
    /** Discriminated read result. */
    const result = readConfigPath(this.#config, toSegments(path))
    return result.kind === 'value'
      ? (result.value as IConfigView<IConfigOwnerPathValue<T, P>>)
      : undefined
  }

  /** Value at a path, or `fallback` when the path is missing. */
  getOr<const P extends IConfigOwnerPath<T>, D>(
    path: P,
    fallback: D
  ): IConfigView<IConfigOwnerPathValue<T, P>> | D {
    /** Discriminated read result; an own `undefined` value is returned as is. */
    const result = readConfigPath(this.#config, toSegments(path))
    return result.kind === 'value'
      ? (result.value as IConfigView<IConfigOwnerPathValue<T, P>>)
      : fallback
  }

  /** Value at a path; throws `CONFIG_VALUE_MISSING` when missing. */
  require<const P extends IConfigOwnerPath<T>>(path: P): IConfigView<IConfigOwnerPathValue<T, P>> {
    /** Validated segments, also used for the error text. */
    const segments = toSegments(path)
    /** Discriminated read result. */
    const result = readConfigPath(this.#config, segments)
    if (result.kind !== 'value')
      throw ownerError(
        TypeError,
        UtilsErrorCode.configValueMissing,
        UtilsErrorText.configValueMissing(segments.join('.'))
      )
    return result.value as IConfigView<IConfigOwnerPathValue<T, P>>
  }

  /** Discriminated read that tells a missing path from an own `undefined` value. */
  read(path: IConfigOwnerPath<T>): IConfigReadResult {
    return readConfigPath(this.#config, toSegments(path))
  }

  /** Whether the path has an own value (which may be `undefined`). */
  has(path: IConfigOwnerPath<T>): boolean {
    return this.read(path).kind === 'value'
  }

  /** Deep readonly view of the current snapshot; writes through it throw `CONFIG_READONLY`. */
  view(): IConfigView<T> {
    return readonlyConfig(this.#config) as IConfigView<T>
  }

  /**
   * New owner for a record subtree, sharing options but not listeners or the validator.
   *
   * @example
   *   ;```ts
   *   const db = config.select('db')
   *   ```
   */
  select<const P extends IConfigOwnerPath<T>>(
    path: P
  ): ConfigOwner<IConfigOwnerPathValue<T, P> & IConfigRecord> {
    /** Validated segments. */
    const segments = toSegments(path)
    /** Raw subtree; copied by the new owner. */
    const subtree = rawAt(this.#config, segments)
    if (!subtree.found)
      throw ownerError(
        TypeError,
        UtilsErrorCode.configValueMissing,
        UtilsErrorText.configValueMissing(segments.join('.'))
      )
    if (!isPlainObject(subtree.value))
      throw ownerError(
        TypeError,
        UtilsErrorCode.configUnsupported,
        UtilsErrorText.configUnsupported(segments.join('.'), 'record required')
      )
    return new ConfigOwner(
      subtree.value as IConfigOwnerPathValue<T, P> & IConfigRecord,
      this.#ownOptions
    )
  }

  /** Paths that differ between this snapshot and `other` (`added` = only in `other`). */
  diff(other: IConfigSource): readonly IConfigDiffEntry[] {
    /** Collected entries in key order. */
    const out: IConfigDiffEntry[] = []
    collectDiff(
      this.#config,
      ConfigOwner.is(other) ? other.#config : other,
      Object.freeze([]),
      out,
      0
    )
    return Object.freeze(out)
  }

  /** Whether `other` has the same data (deep, own keys). */
  equals(other: IConfigSource): boolean {
    return this.diff(other).length === 0
  }

  /**
   * Sets one path with copy-on-write; missing intermediate records are created. Throws
   * `CONFIG_PATH_INVALID` when an intermediate is not a record or array.
   *
   * @example
   *   ;```ts
   *   config.set('server.port', 8080).set('server.host', 'localhost')
   *   ```
   */
  set<const P extends IConfigOwnerPath<T>>(path: P, value: IConfigOwnerWriteValue<T, P>): this {
    return this.#writePath(toSegments(path), value)
  }

  /** Deletes one path; deleting a missing path is a no-op. Array items are removed by index. */
  delete(path: IConfigOwnerPath<T>): this {
    return this.#writePath(toSegments(path), CONFIG_DELETE)
  }

  /** Applies a root-level overlay through `patchConfig` (`CONFIG_DELETE` removes a key). */
  patch(patch: IConfigPatch<T>, options?: IConfigPatchOptions): this {
    this.#assertWritable()
    return this.#apply(patchConfig(this.#config, patch, options))
  }

  /**
   * Merges sources into this owner through `combineConfig` (later sources win). Pass a source list
   * plus options to control merge strategies. Returns `this`, retyped with the merged shape.
   *
   * @example
   *   ;```ts
   *   config.combine({ cache: { ttl: 60 } }).get('cache.ttl')
   *   config.combine([override], { strategies: { array: 'concat' } })
   *   ```
   */
  combine<S extends readonly IConfigSource[]>(...sources: S): ConfigOwner<T & IMergedConfig<S>>
  combine<S extends readonly IConfigSource[]>(
    sources: S,
    options: IConfigCombineOptions
  ): ConfigOwner<T & IMergedConfig<S>>
  combine(...args: unknown[]): ConfigOwner<IConfigRecord> {
    this.#assertWritable()
    /** Array-root configs are invalid, so a leading array always means the list form. */
    const listForm = Array.isArray(args[0])
    /** Sources to merge after the current snapshot. */
    const sources = (listForm ? args[0] : args) as readonly IConfigSource[]
    /** Merge options; only the list form accepts them. */
    const options = listForm ? (args[1] as IConfigCombineOptions | undefined) : undefined
    if (sources.length === 0 && options === undefined)
      return this as unknown as ConfigOwner<IConfigRecord>
    /** Owned form of each source. */
    const owned = sources.map((source) =>
      ConfigOwner.is(source) ? source.#config : ownConfig(source as IConfigRecord, this.#ownOptions)
    )
    this.#apply(combineConfig([this.#config, ...owned], options) as IOwnedConfig<T>)
    return this as unknown as ConfigOwner<IConfigRecord>
  }

  /**
   * Runs several writes as one commit: the validator and watchers run once at the end. If `fn`
   * throws or validation fails, every write in the batch is rolled back. Nested batches join the
   * outer one.
   *
   * @example
   *   ;```ts
   *   config.batch((c) => c.set('a', 1).set('b', 2))
   *   ```
   */
  batch(fn: (owner: this) => void): this {
    if (typeof fn !== 'function')
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('fn', UtilsErrorText.functionExpectation)
      )
    this.#assertWritable()
    if (this.#batchDepth > 0) {
      fn(this)
      return this
    }
    /** Snapshot restored when the batch fails. */
    const before = this.#config
    this.#batchDepth += 1
    try {
      fn(this)
    } catch (error) {
      this.#config = before
      throw error
    } finally {
      this.#batchDepth -= 1
    }
    if (this.#config === before) return this
    /** Candidate produced by the batch. */
    const candidate = this.#config
    this.#config = before
    return this.#apply(candidate)
  }

  /** Restores the snapshot captured at construction (watchers fire when it differs). */
  reset(): this {
    this.#assertWritable()
    return this.#apply(this.#initial)
  }

  /** Rejects every later write with `CONFIG_READONLY`. Irreversible. */
  lock(): this {
    this.#locked = true
    return this
  }

  /**
   * Watches the whole snapshot, or only one path (fires only when that path's data changed).
   * Returns an idempotent unsubscribe. Listener throws go to `report`; writes from a listener throw
   * `REENTRANT_CALL`.
   *
   * @example
   *   ;```ts
   *   const stop = config.watch('server.port', (next, prev) => restart(next))
   *   ```
   */
  watch(listener: (next: IConfigView<T>, prev: IConfigView<T>) => void): () => void
  watch<const P extends IConfigOwnerPath<T>>(
    path: P,
    listener: (
      next: IConfigView<IConfigOwnerPathValue<T, P>> | undefined,
      prev: IConfigView<IConfigOwnerPathValue<T, P>> | undefined
    ) => void
  ): () => void
  watch(pathOrListener: unknown, maybeListener?: (next: never, prev: never) => void): () => void {
    /** Root form passes the listener first. */
    const rootForm = typeof pathOrListener === 'function'
    /** Listener for either form. */
    const listener = (rootForm ? pathOrListener : maybeListener) as
      | ((next: unknown, prev: unknown) => void)
      | undefined
    if (typeof listener !== 'function')
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('listener', UtilsErrorText.functionExpectation)
      )
    /** Registered entry; its identity is the unsubscribe key. */
    const watcher: IConfigWatcher = {
      path: rootForm ? undefined : toSegments(pathOrListener),
      listener
    }
    this.#watchers.add(watcher)
    return () => {
      this.#watchers.delete(watcher)
    }
  }

  /** New owner with the same snapshot and options; listeners and lock state are not copied. */
  clone(): ConfigOwner<T> {
    return new ConfigOwner(this.#config, {
      ...this.#ownOptions,
      ...(this.#validate ? { validate: this.#validate } : {}),
      report: this.#report
    })
  }

  /** JSON data of the current snapshot; non-JSON values throw `CONFIG_UNSUPPORTED`. */
  toJSON(): IConfigRecord {
    return toPlain(this.#config, 'config', 0) as IConfigRecord
  }

  /** JSON text of the current snapshot. */
  toString(space?: number | string): string {
    return JSON.stringify(this.toJSON(), null, space)
  }

  /** Rejects writes while locked or while watchers run. */
  #assertWritable(): void {
    if (this.#notifying)
      throw ownerError(Error, UtilsErrorCode.reentrantCall, UtilsErrorText.reentrantCall)
    if (this.#locked)
      throw ownerError(
        TypeError,
        UtilsErrorCode.configReadonly,
        UtilsErrorText.configReadonly('owner')
      )
  }

  /** Writes or deletes one path through a root-level `patchConfig` of the rebuilt root key. */
  #writePath(segments: readonly string[], value: unknown): this {
    this.#assertWritable()
    /** Root key and the remaining nested path. */
    const [head, ...rest] = segments
    if (rest.length === 0) {
      if (value === CONFIG_DELETE && !ownValue(this.#config, head).found) return this
      return this.#apply(patchConfig(this.#config, { [head]: value } as IConfigPatch<T>))
    }
    /** Rebuilt root child. */
    const child = ownValue(this.#config, head)
    /** New root child, or `UNCHANGED` for a delete of a missing path. */
    const next = rebuild(child.found ? child.value : undefined, rest, value, head)
    if (next === UNCHANGED) return this
    return this.#apply(patchConfig(this.#config, { [head]: next } as IConfigPatch<T>))
  }

  /** Validates one candidate; throws `CONFIG_VALIDATION_FAILED` with the cause on rejection. */
  #check(candidate: IOwnedConfig<T>): void {
    if (!this.#validate) return
    /** Validator outcome; only an explicit `false` rejects without a throw. */
    let accepted: boolean | void
    try {
      accepted = this.#validate(readonlyConfig(candidate) as IConfigView<T>)
    } catch (cause) {
      throw ownerError(
        TypeError,
        UtilsErrorCode.configValidationFailed,
        UtilsErrorText.configValidationFailed,
        cause
      )
    }
    if (accepted === false)
      throw ownerError(
        TypeError,
        UtilsErrorCode.configValidationFailed,
        UtilsErrorText.configValidationFailed
      )
  }

  /**
   * Commits one candidate. Inside a batch the candidate becomes the working snapshot; otherwise it
   * is validated, committed and announced.
   */
  #apply(candidate: IOwnedConfig<T>): this {
    if (candidate === this.#config) return this
    if (this.#batchDepth > 0) {
      this.#config = candidate
      return this
    }
    this.#check(candidate)
    /** Previous snapshot handed to watchers. */
    const previous = this.#config
    this.#config = candidate
    this.#notify(previous, candidate)
    return this
  }

  /** Runs watchers once per commit; failures are reported and never stop the other watchers. */
  #notify(previous: IOwnedConfig<T>, next: IOwnedConfig<T>): void {
    if (this.#watchers.size === 0) return
    this.#notifying = true
    try {
      // Snapshot so watchers added during notification wait for the next commit.
      for (const watcher of Array.from(this.#watchers)) {
        if (!this.#watchers.has(watcher)) continue
        try {
          if (watcher.path === undefined) {
            watcher.listener(readonlyConfig(next), readonlyConfig(previous))
            continue
          }
          /** Raw values on each side of the commit. */
          const before = rawAt(previous, watcher.path)
          const after = rawAt(next, watcher.path)
          /** Collected differences under the watched path. */
          const changes: IConfigDiffEntry[] = []
          if (before.found !== after.found) changes.push({ path: watcher.path, kind: 'changed' })
          else collectDiff(before.value, after.value, watcher.path, changes, 0)
          if (changes.length === 0) continue
          /** Readonly views of both values. */
          const read = (snapshot: IOwnedConfig<T>): unknown => {
            /** Discriminated read through the canonical readonly path reader. */
            const result = readConfigPath(snapshot, watcher.path!)
            return result.kind === 'value' ? result.value : undefined
          }
          watcher.listener(read(next), read(previous))
        } catch (error) {
          this.#report(error)
        }
      }
    } finally {
      this.#notifying = false
    }
  }
}

Object.freeze(ConfigOwner.prototype)
Object.freeze(ConfigOwner)
