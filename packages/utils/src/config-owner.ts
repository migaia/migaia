/** Own immutable configuration snapshots, validation, asynchronous loading and scoped watchers. */
import { ConfigReason } from './internal/config-text.ts'
import { UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import { isPlainObject } from './object.ts'
import type { IObjectPath, IObjectPathValue, IObjectPathWriteValue } from './object-path.ts'
import { reportUnhandledError } from './host-report.ts'
import { raceWithAbort, withTimeout, type IAbortSignal } from './promise.ts'
import {
  CONFIG_DELETE,
  type IConfigCombineOptions,
  type IConfigPatch,
  type IConfigPatchOptions,
  type IConfigReadResult,
  type IConfigRecord,
  type IOwnConfigOptions,
  type IOwnedConfig
} from './internal/config-contract.ts'
import { combineConfig, ownConfig, patchConfig } from './internal/config-owned.ts'
import { readConfigPath } from './internal/config-path.ts'
import { readonlyConfig } from './internal/config-readonly.ts'
import { ownerError } from './internal/config-owner-error.ts'
import { UNCHANGED, ownValue, rawAt, rebuild, toSegments } from './internal/config-owner-path.ts'
import { collectDiff } from './internal/config-owner-diff.ts'
import { toPlain } from './internal/config-owner-json.ts'
import {
  ConfigSourceLoader,
  parseConfigText,
  readConfigEnvironment
} from './internal/config-owner-source.ts'
import { ConfigWatchers } from './internal/config-owner-watchers.ts'

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

/**
 * Stateful owner of one immutable config snapshot.
 *
 * Writes build a complete owned candidate, validate it, then commit; failures keep the old
 * snapshot. Writes chain through `this`; reads are readonly. State is private; the prototype is
 * frozen.
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
  readonly #watchers: ConfigWatchers
  /** Whether writes are permanently rejected with `CONFIG_READONLY`. */
  #locked = false
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
    this.#watchers = new ConfigWatchers(this.#report, this)
    /** Owned initial snapshot. */
    const owned = ownConfig(value, this.#ownOptions)
    this.#check(owned)
    this.#config = owned
    this.#initial = owned
  }

  /**
   * Parses JSON text; malformed text retains `CONFIG_PARSE_FAILED` and its original cause. The
   * constructor rejects non-record roots with `CONFIG_UNSUPPORTED`.
   */
  static from<T extends IConfigRecord = IConfigRecord>(
    text: string,
    options?: IConfigOwnerParseOptions<T>
  ): ConfigOwner<T> {
    return new ConfigOwner(parseConfigText(text, options) as T, options)
  }

  /**
   * Loads a value, Promise or signal-aware factory; strings are parsed as JSON. Factory failures
   * retain their cause under `CONFIG_SOURCE_FAILED`; abort and timeout use the standard errors.
   */
  static async fromAsync<T extends IConfigRecord = IConfigRecord>(
    source: IConfigAsyncSource<T>,
    options?: IConfigOwnerAsyncOptions<T>
  ): Promise<ConfigOwner<T>> {
    /** Detached source callback retains one explicit source owner for this asynchronous wait. */
    const load = new ConfigSourceLoader(source).load
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
   * Builds nested data from flat environment variables, applying optional key/coerce policies.
   * Conflicting leaf/prefix keys throw `CONFIG_CONFLICT` before owner publication.
   */
  static fromEnv<T extends IConfigRecord = IConfigRecord>(
    env: Readonly<Record<string, string | undefined>>,
    options?: IConfigOwnerEnvOptions<T>
  ): ConfigOwner<T> {
    return new ConfigOwner(readConfigEnvironment(env, options) as T, options)
  }

  /** Merges sources left to right into a new owner (later sources win, records merge deeply). */
  static merge<S extends readonly [IConfigSource, ...IConfigSource[]]>(
    ...sources: S
  ): ConfigOwner<IMergedConfig<S>> {
    if (sources.length === 0)
      throw ownerError(
        TypeError,
        UtilsErrorCode.invalidArgument,
        UtilsErrorText.invalidArgument('sources', ConfigReason.atLeastOneSource)
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

  /** Value at a typed path as a deep readonly view, or `undefined` when missing. */
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

  /** New owner for a record subtree, sharing options but not listeners or the validator. */
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
        UtilsErrorText.configUnsupported(segments.join('.'), ConfigReason.recordRequired)
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
    collectDiff(this.#config, ConfigOwner.is(other) ? other.#config : other, Object.freeze([]), out)
    return Object.freeze(out)
  }

  /** Whether `other` has the same data (deep, own keys). */
  equals(other: IConfigSource): boolean {
    return this.diff(other).length === 0
  }

  /**
   * Sets one path with copy-on-write; missing intermediate records are created. Throws
   * `CONFIG_PATH_INVALID` when an intermediate is not a record or array.
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
   * Merges source values through `combineConfig`; list form accepts explicit strategies. Returns
   * this same owner, typed with the merged shape.
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
   * Runs writes as one validated commit and watcher notification. Nested batches join the outer
   * batch; a throw or validation failure restores the previous snapshot.
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
   * Watches the root or one changed path; returns an idempotent unsubscribe. Listener failures go
   * to `report`, and writes during notification throw `REENTRANT_CALL`.
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
    return this.#watchers.add(rootForm ? undefined : toSegments(pathOrListener), listener)
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
    if (this.#watchers.notifying)
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
    this.#watchers.notify(previous, candidate)
    return this
  }
}

Object.freeze(ConfigOwner.prototype)
Object.freeze(ConfigOwner)
