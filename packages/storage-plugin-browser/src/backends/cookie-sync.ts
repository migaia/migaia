// Cookie write preparation and the synchronous cookie view for the cookie backend (see ./cookie.ts).
import { snapshotSyncWriteOptions } from '@migaia/storage-host/sdk'
import type { ITextPrepared } from './text-redo.ts'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { namespacedKey, namespacedStorageKey } from '../utils/key.ts'
import { serializeCookieAssignment, serializeCookieRemoval } from '../utils/cookie-string.ts'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { StorageBackend, StorageOperation } from '../constants.ts'
import type { ICookieWriteContext } from '../types/cookie.ts'
import type { IStorageKey } from '../types/context.ts'
import {
  readVisibleCookie,
  writeCookie,
  publishChange,
  assertLive,
  namespacedEntries,
  clearNamespacedEntries
} from './cookie.ts'
import type { ICookieContext } from './cookie.ts'

/** Prepare one visible-cookie assignment before WAL; ordinary sync writes use the same validation. */
export function prepareCookie(
  cookieContext: ICookieContext,
  key: IStorageKey,
  value: string | null,
  ctx?: ICookieWriteContext,
  behavior?: {
    readonly notify?: boolean
    readonly durable?: true
    readonly remove?: true
    readonly encode?: () => string
  }
): ITextPrepared {
  const notify = behavior?.notify !== false
  const durable = behavior?.durable === true
  if (value === null && behavior?.remove) {
    const physicalKey = namespacedStorageKey(
      cookieContext.namespace,
      key,
      cookieContext.namespaceCodec,
      StorageBackend.cookie
    )
    const visible = readVisibleCookie(
      cookieContext,
      physicalKey,
      StorageOperation.cookieRemove,
      key
    )
    const assignment = serializeCookieRemoval(physicalKey, cookieContext.scope)
    return {
      value: null,
      image: undefined,
      apply: () => {
        writeCookie(cookieContext, assignment, StorageOperation.cookieRemove, key)
        if (notify && visible !== undefined)
          publishChange(cookieContext, { channel: 'value', kind: 'remove', keys: [key] })
      }
    }
  }
  assertLive(cookieContext)
  const context = ctx
  snapshotSyncWriteOptions(context)
  if (typeof value !== 'string')
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      cause: new TypeError(StorageErrorText.cookieValueInvalid)
    })
  const physicalKey =
    behavior?.encode?.() ??
    namespacedStorageKey(
      cookieContext.namespace,
      key,
      cookieContext.namespaceCodec,
      StorageBackend.cookie
    )
  /** Snapshot mutable/getter-backed context fields before validation and serialization. */
  const maxAge = context?.maxAge
  const expires = context?.expires
  if (maxAge !== undefined && !Number.isSafeInteger(maxAge))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      cause: new RangeError(StorageErrorText.cookieMaxAgeInvalid)
    })
  if (expires !== undefined && (typeof expires !== 'object' || expires === null))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      cause: new RangeError(StorageErrorText.cookieExpiresInvalid)
    })
  /** Read a Date-like value once so validation and serialization cannot observe different times. */
  let expiresTime: number | undefined
  try {
    expiresTime =
      expires === undefined ? undefined : ((expires as { getTime(): unknown }).getTime() as number)
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      cause
    })
  }
  if (expiresTime !== undefined && !Number.isFinite(expiresTime))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      cause: new RangeError(StorageErrorText.cookieExpiresInvalid)
    })
  const expiresNow =
    maxAge !== undefined ? maxAge <= 0 : expiresTime !== undefined && expiresTime <= Date.now()
  /** Relative expiry becomes one absolute native date so replay never renews a failed write. */
  const deadline =
    !durable || maxAge === undefined ? expiresTime : expiresNow ? 0 : Date.now() + maxAge * 1000
  if (durable && deadline !== undefined && !Number.isFinite(new Date(deadline).getTime()))
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: StorageBackend.cookie,
      key
    })
  const visibleBefore = readVisibleCookie(
    cookieContext,
    physicalKey,
    StorageOperation.cookieSet,
    key
  )
  const assignment = expiresNow
    ? serializeCookieRemoval(physicalKey, cookieContext.scope)
    : serializeCookieAssignment(physicalKey, value, {
        ...cookieContext.scope,
        expires: deadline === undefined ? undefined : new Date(deadline),
        maxAge: durable ? undefined : maxAge
      })
  return {
    value: expiresNow ? null : value,
    image: { value, ...(deadline === undefined ? {} : { expiresAt: deadline }) },
    apply: () => {
      writeCookie(cookieContext, assignment, StorageOperation.cookieSet, key)
      const visible = readVisibleCookie(cookieContext, physicalKey, StorageOperation.cookieSet, key)
      if (expiresNow && visible === undefined) {
        if (notify && visibleBefore !== undefined)
          publishChange(cookieContext, { channel: 'value', kind: 'remove', keys: [key] })
        return
      }
      if (!expiresNow && visible === value) {
        if (notify) publishChange(cookieContext, { channel: 'value', kind: 'put', keys: [key] })
        return
      }
      if (visible !== undefined)
        throw new StorageError(StorageBrowserErrorCode.cookieScopeAmbiguous, {
          backend: StorageBackend.cookie,
          key,
          operation: StorageOperation.cookieSet,
          cause: new Error(StorageErrorText.cookieRedoScopeMismatch)
        })
      throw new StorageError(StorageBrowserErrorCode.writeFailed, {
        backend: StorageBackend.cookie,
        key,
        operation: StorageOperation.cookieSet,
        cause: new Error(StorageErrorText.cookieRedoWriteInvisible)
      })
    }
  }
}

/**
 * Store shape the CookieSync class implements; named because implements cannot take an
 * intersection.
 */
type ICookieSyncShape = ICookieContext['sync']

/** Synchronous cookie view of one namespace. */
class CookieSync implements ICookieSyncShape {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #cookieContext: ICookieContext

  get: ICookieSyncShape['get'] = (key) => {
    assertLive(this.#cookieContext)
    return (
      readVisibleCookie(
        this.#cookieContext,
        namespacedKey(
          this.#cookieContext.namespace,
          key,
          this.#cookieContext.namespaceCodec,
          StorageBackend.cookie
        ),
        'cookie.get',
        key
      ) ?? null
    )
  }

  set: ICookieSyncShape['set'] = (key, value, ctx) => {
    prepareCookie(this.#cookieContext, key, value, ctx, {
      encode: () =>
        namespacedKey(
          this.#cookieContext.namespace,
          key,
          this.#cookieContext.namespaceCodec,
          StorageBackend.cookie
        )
    }).apply()
  }

  remove: ICookieSyncShape['remove'] = (key) => {
    assertLive(this.#cookieContext)
    const physicalKey = namespacedKey(
      this.#cookieContext.namespace,
      key,
      this.#cookieContext.namespaceCodec,
      StorageBackend.cookie
    )
    const visible = readVisibleCookie(
      this.#cookieContext,
      physicalKey,
      StorageOperation.cookieRemove,
      key
    )
    writeCookie(
      this.#cookieContext,
      serializeCookieRemoval(physicalKey, this.#cookieContext.scope),
      StorageOperation.cookieRemove,
      key
    )
    if (visible !== undefined)
      publishChange(this.#cookieContext, { channel: 'value', kind: 'remove', keys: [key] })
  }

  has: ICookieSyncShape['has'] = (key) => {
    assertLive(this.#cookieContext)
    return (
      readVisibleCookie(
        this.#cookieContext,
        namespacedKey(
          this.#cookieContext.namespace,
          key,
          this.#cookieContext.namespaceCodec,
          StorageBackend.cookie
        ),
        'cookie.has',
        key
      ) !== undefined
    )
  }

  keys: ICookieSyncShape['keys'] = () => {
    assertLive(this.#cookieContext)
    return namespacedEntries(this.#cookieContext).flatMap((entry) =>
      typeof entry.logicalKey === 'string' ? [entry.logicalKey] : []
    )
  }

  clearValues: ICookieSyncShape['clearValues'] = () => {
    assertLive(this.#cookieContext)
    clearNamespacedEntries(this.#cookieContext, 'cookie.clearValues')
  }

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(cookieContext: ICookieContext) {
    this.#cookieContext = cookieContext
  }
}

/** Build synchronous cookie methods against the admitted native jar and fixed scope. */
export function createCookieSync(cookieContext: ICookieContext): ICookieContext['sync'] {
  return new CookieSync(cookieContext)
}
