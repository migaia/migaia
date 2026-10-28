/** Own identity admission and comparisons; no constructors, callbacks or traversal state. */
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { attachErrorIdentity, tryReadProperty, type IErrorIdentity } from './error-primitives.ts'
import type { IIdentifyErrorIdentity, IErrorIdentityMatch } from '../identify-error.ts'

/** Creates the coded native `TypeError` used for every rejected identity or argument. */
export function identityError(field: string): TypeError {
  return attachErrorIdentity(new TypeError(UtilsErrorText.identityInvalid(field)), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/** Checks a plain record without invoking accessors or proxies beyond a prototype read. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  /** Plain records are created by literals or `Object.create(null)`. */
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Validates and freezes one identity. The result is a fresh object, so later caller mutation of the
 * input cannot change an existing error.
 */
export function admitIdentity<S extends string, C extends string>(
  identity: IIdentifyErrorIdentity<S, C>
): IIdentifyErrorIdentity<S, C> {
  if (identity === null || typeof identity !== 'object') throw identityError('identity')
  /** Snapshot of each field, read once so getters cannot change between validation and use. */
  const { source, code, phase, detail } = identity
  if (typeof source !== 'string' || source.length === 0) throw identityError('source')
  if (typeof code !== 'string' || code.length === 0) throw identityError('code')
  if (phase !== undefined && typeof phase !== 'string') throw identityError('phase')
  if (detail !== undefined && !isPlainRecord(detail)) throw identityError('detail')
  return Object.freeze({
    source,
    code,
    ...(phase === undefined ? {} : { phase }),
    ...(detail === undefined ? {} : { detail: Object.freeze({ ...detail }) })
  }) as IIdentifyErrorIdentity<S, C>
}

/** Reads one optional string property without letting hostile getters escape. */
export function readString(value: object, key: string): string | undefined {
  /** Guarded read; a throwing getter counts as absent identity. */
  const read = tryReadProperty(value as Record<string, unknown>, key)
  return !read.threw && typeof read.value === 'string' ? read.value : undefined
}

/** Tests one identity against a partial match; omitted match fields always pass. */
export function matchesIdentity(
  identity: IErrorIdentity | undefined,
  match: IErrorIdentityMatch
): boolean {
  if (!identity) return false
  return (
    (match.source === undefined || match.source === identity.source) &&
    (match.code === undefined || match.code === identity.code) &&
    (match.phase === undefined || match.phase === identity.phase)
  )
}

/** Shallow own-key equality for identity details; both absent counts as equal. */
export function sameDetail(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  /** Own keys of the left detail, compared in both directions by count and value. */
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]))
  )
}
