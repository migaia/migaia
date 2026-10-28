/** ConfigOwner source admission, loading, parsing and environment drafts; no snapshot publication. */
import { ConfigReason, environmentConflictReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { safeErrorReason } from '../error.ts'
import { isPlainObject } from '../object.ts'
import type { IAbortSignal } from '../promise.ts'
import type { IConfigRecord } from './config-contract.ts'
import type {
  IConfigAsyncSource,
  IConfigOwnerParseOptions,
  IConfigOwnerEnvOptions
} from '../config-owner.ts'
import { orderStringKeys } from './string-order.ts'
import { ownerError } from './config-owner-error.ts'
import { ownValue, rebuild, toSegments, type IEnvConstructionContext } from './config-owner-path.ts'

/** Default environment key policy preserves each caller-supplied segment verbatim. */
const environmentKeyIdentity = (segment: string): string => segment

/** Source throws and rejections share one coded boundary while retaining the original cause. */
function configSourceFailure(cause: unknown): Error {
  return ownerError(
    Error,
    UtilsErrorCode.configSourceFailed,
    UtilsErrorText.configSourceFailed,
    cause
  )
}

/** A source wait owns its borrowed source until its configured abort/deadline race settles. */
export class ConfigSourceLoader<T extends IConfigRecord> {
  /** Only this source is invoked or assimilated for the wait. */
  readonly #source: IConfigAsyncSource<T>
  /** Capture the source without invoking it or observing its then property. */
  constructor(source: IConfigAsyncSource<T>) {
    this.#source = source
  }
  /** Detached callback retains this source owner for timeout/abort primitives. */
  readonly load = (context: { readonly signal: IAbortSignal }): Promise<unknown> =>
    this.#load(context)

  /**
   * Resolve the source once; normalize only source failures, leaving parsing and cancellation
   * outside.
   */
  #load(context: { readonly signal: IAbortSignal }): Promise<unknown> {
    /** Invoke factory values without a receiver, matching the original free source invocation. */
    const source = this.#source
    /** Preserve the original thenable observation before source error normalization. */
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
}

/** Parse JSON only after input admission; option getter reads retain their original order. */
export function parseConfigText<T extends IConfigRecord>(
  text: string,
  options?: IConfigOwnerParseOptions<T>
): unknown {
  if (typeof text !== 'string')
    throw ownerError(
      TypeError,
      UtilsErrorCode.configParseFailed,
      UtilsErrorText.configParseFailed(ConfigReason.parseTextRequired)
    )
  /** Parsed root; validated by the constructor. */
  let parsed: unknown
  try {
    parsed = JSON.parse(text, options?.reviver)
  } catch (cause) {
    throw ownerError(
      TypeError,
      UtilsErrorCode.configParseFailed,
      UtilsErrorText.configParseFailed(safeErrorReason(cause, ConfigReason.invalidJson)),
      cause
    )
  }
  return parsed
}

/** Build one private environment draft in deterministic key order before owner validation. */
export function readConfigEnvironment<T extends IConfigRecord>(
  env: Readonly<Record<string, string | undefined>>,
  options?: IConfigOwnerEnvOptions<T>
): unknown {
  if (env === null || typeof env !== 'object')
    throw ownerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('env', ConfigReason.envRecordRequired)
    )
  /** Options with defaults. */
  const { prefix = '', separator = '__', key = environmentKeyIdentity, coerce } = options ?? {}
  if (typeof separator !== 'string' || separator.length === 0)
    throw ownerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument('separator', ConfigReason.nonEmptyStringRequired)
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
          UtilsErrorText.configConflict(
            path.slice(0, index).join('.'),
            environmentConflictReason(name)
          )
        )
      prefixNode = existing.value
    }
    root = rebuild(root, path, coerce ? coerce(raw, path) : raw, 'env', construction)
  }
  return root
}
