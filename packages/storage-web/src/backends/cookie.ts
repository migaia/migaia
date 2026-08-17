import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract';
import { toPromise } from '../utils/async.js';
import {
  snapshotOperationContext,
  snapshotSyncWriteOptions,
  throwIfAborted,
  withAbort
} from '../core/operation.js';
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  snapshotNamespaceCodec,
  stripNamespace
} from '../utils/key.js';
import type { INamespaceCodec } from '../utils/key.js';
import {
  parseCookieEntries,
  serializeCookieAssignment,
  serializeCookieRemoval
} from '../utils/cookie-string.js';
import { StorageError, StorageErrorCode } from '../types/errors.js';
import { normalizeStorageException } from '../utils/quota.js';
import { StorageBackend, StorageOperation } from '../constants.js';
import type {
  ICookieRemoveContext,
  ICookieScope,
  ICookieStore,
  ICookieWriteContext,
  ISyncCookieStore
} from '../types/cookie.js';
import type { IStorageCapabilities } from '../types/capabilities.js';
import type { IOperationContext } from '../types/context.js';
import type { ISyncCapableStore } from '../types/storage.js';

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  maxValueBytes: 4096,
  // HttpOnly cookie 对 JS 不可见：has() 返回 false 不代表不存在，remove() 也不保证生效。
  opaqueEntries: true
});

export type ICookieDocument = { cookie: string };

export type ICookiesOptions = {
  /** 命名空间前缀，避免多实例/多应用互相踩踏。默认为 'default'。 */
  readonly namespace?: string;
  /** 高级物理键编码扩展点；改变 codec 即改变 cookie 持久化格式。 */
  readonly namespaceCodec?: INamespaceCodec;
  /** 固定 cookie scope；写入与删除始终使用同一 scope。 */
  readonly scope?: ICookieScope;
  /** 注入点：测试环境用。默认为 globalThis.document。 */
  readonly document?: ICookieDocument;
};

type ICookieWriteContextSnapshot = ICookieWriteContext & {
  readonly pageSize?: number;
  readonly conflictPolicy?: 'conflict' | 'replace';
  readonly lifecycle: ReturnType<typeof snapshotOperationContext>;
};

/**
 * Run a Cookie async operation under the shared operation signal; invalid context 穿透为 contract
 * INVALID_ARGUMENT。
 */
const withCookieAbort = async <T>(
  context: IOperationContext | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> => {
  const lifecycle = snapshotOperationContext(context);
  return await withAbort(lifecycle, async (signal) => run(signal));
};

/** Snapshot lifecycle and cookie-specific write fields before cancellation or serialization. */
const snapshotCookieWriteContext = (
  context: ICookieWriteContext | undefined,
  key: string
): ICookieWriteContextSnapshot | undefined => {
  const lifecycle = snapshotOperationContext(context);
  if (context === undefined) return undefined;
  let expires: unknown;
  let maxAge: unknown;
  try {
    expires = context.expires;
    maxAge = context.maxAge;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      key,
      operation: StorageOperation.cookieSet,
      cause
    });
  }
  return {
    ...lifecycle,
    expires: expires as Date | undefined,
    maxAge: maxAge as number | undefined,
    lifecycle
  };
};

/** Snapshot and validate fixed cookie scope so later writes cannot observe getter changes. */
function snapshotCookieScope(scope: unknown): ICookieScope {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope must be an object')
    });
  }
  const candidate = scope as Record<string, unknown>;
  let path: unknown;
  let domain: unknown;
  let sameSite: unknown;
  let secure: unknown;
  let partitioned: unknown;
  try {
    path = candidate.path;
    domain = candidate.domain;
    sameSite = candidate.sameSite;
    secure = candidate.secure;
    partitioned = candidate.partitioned;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    });
  }
  if (
    (path !== undefined &&
      (typeof path !== 'string' || !path.startsWith('/') || path.includes(';'))) ||
    (domain !== undefined && (typeof domain !== 'string' || !domain || /[;\s]/.test(domain))) ||
    (sameSite !== undefined && !['strict', 'lax', 'none'].includes(sameSite as string)) ||
    (secure !== undefined && typeof secure !== 'boolean') ||
    (partitioned !== undefined && typeof partitioned !== 'boolean')
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie scope contains an invalid attribute')
    });
  if (sameSite === 'none' && !secure)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('SameSite=None requires Secure')
    });
  if (partitioned && !secure)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('Partitioned requires Secure')
    });
  return {
    path: path as string | undefined,
    domain: domain as string | undefined,
    sameSite: sameSite as ICookieScope['sameSite'],
    secure: secure as boolean | undefined,
    partitioned: partitioned as boolean | undefined
  };
}

/** Document.cookie 后端。不处理服务端 cookie；SSR 场景由调用方在服务端 自行解析 `req.headers.cookie` 并注入 memoryStorage。 */
export const cookies = (options: ICookiesOptions = {}): ISyncCapableStore<ICookieStore> => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie options must be an object')
    });
  let configuredNamespace: unknown;
  let configuredNamespaceCodec: unknown;
  let configuredScope: unknown;
  let configuredDocument: unknown;
  try {
    configuredNamespace = options.namespace;
    configuredNamespaceCodec = options.namespaceCodec;
    configuredScope = options.scope;
    configuredDocument = options.document;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    });
  }
  const namespace = configuredNamespace === undefined ? 'default' : configuredNamespace;
  const namespaceCodecCandidate =
    configuredNamespaceCodec === undefined
      ? lengthPrefixedNamespaceCodec
      : configuredNamespaceCodec;
  if (typeof namespace !== 'string' || namespace.length === 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('namespace must be non-empty and namespaceCodec must be callable')
    });
  const scope = snapshotCookieScope(
    configuredScope === undefined ? { path: '/' } : configuredScope
  );
  const documentCandidate =
    configuredDocument === undefined
      ? (globalThis as { document?: ICookieDocument }).document
      : configuredDocument;
  if (documentCandidate === undefined)
    throw new StorageError(StorageErrorCode.unavailable, { backend: StorageBackend.cookie });
  if (
    typeof documentCandidate !== 'object' ||
    documentCandidate === null ||
    Array.isArray(documentCandidate)
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    });
  let initialCookie: unknown;
  try {
    initialCookie = (documentCandidate as ICookieDocument).cookie;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause
    });
  }
  if (typeof initialCookie !== 'string')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.cookie,
      cause: new TypeError('cookie document must expose a string cookie property')
    });
  const namespaceCodec = snapshotNamespaceCodec(namespaceCodecCandidate, StorageBackend.cookie);
  const doc = documentCandidate as ICookieDocument;

  /** Read the live cookie jar while preserving host failures in the storage error protocol. */
  const readCookie = (operation: string, key?: string): string => {
    try {
      const value: unknown = doc.cookie;
      if (typeof value !== 'string')
        throw new TypeError('cookie document must continue exposing a string cookie property');
      return value;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.unavailable, {
        backend: StorageBackend.cookie,
        key,
        operation,
        cause
      });
    }
  };

  /** Write the live cookie jar while preserving host failures in the storage error protocol. */
  const writeCookie = (value: string, operation: string, key?: string): void => {
    try {
      doc.cookie = value;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.writeFailed, {
        backend: StorageBackend.cookie,
        key,
        operation,
        cause
      });
    }
  };

  let disposed = false;
  const assertLive = (): void => {
    if (disposed)
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: StorageBackend.cookie
      });
  };

  const namespacedEntries = (
    operation = 'cookie.keys'
  ): Array<{
    readonly physicalKey: string;
    readonly logicalKey: string;
  }> => {
    const collected: Array<{ readonly physicalKey: string; readonly logicalKey: string }> = [];
    /** Repeated visible names prove that document.cookie cannot identify their scopes. */
    const seenPhysicalKeys = new Set<string>();
    for (const [rawKey] of parseCookieEntries(readCookie(operation))) {
      const stripped = stripNamespace(namespace, rawKey, namespaceCodec, StorageBackend.cookie);
      if (stripped === undefined) continue;
      if (seenPhysicalKeys.has(rawKey))
        throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
          backend: StorageBackend.cookie,
          key: stripped,
          operation,
          cause: new Error('multiple visible cookies share one physical name')
        });
      seenPhysicalKeys.add(rawKey);
      collected.push({ physicalKey: rawKey, logicalKey: stripped });
    }
    return collected;
  };

  /** Read one physical cookie only when its visible scope is unambiguous. */
  const readVisibleCookie = (
    physicalKey: string,
    operation: string,
    logicalKey: string
  ): string | undefined => {
    let visible: string | undefined;
    let matches = 0;
    for (const [name, value] of parseCookieEntries(readCookie(operation, logicalKey))) {
      if (name !== physicalKey) continue;
      matches += 1;
      visible = value;
    }
    if (matches > 1)
      throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
        backend: StorageBackend.cookie,
        key: logicalKey,
        operation,
        cause: new Error('multiple visible cookies share one physical name')
      });
    return visible;
  };

  /** Delete a stable cookie-name snapshot while exposing the exact partial-failure boundary. */
  const clearNamespacedEntries = (operation: string, signal?: AbortSignal): void => {
    const entries = namespacedEntries(operation);
    try {
      throwIfAborted(signal);
    } catch (error) {
      throw normalizeStorageException(error, StorageBackend.cookie, undefined, operation);
    }
    for (const entry of entries) {
      try {
        throwIfAborted(signal);
      } catch (error) {
        throw normalizeStorageException(error, StorageBackend.cookie, entry.logicalKey, operation);
      }
      writeCookie(serializeCookieRemoval(entry.physicalKey, scope), operation, entry.logicalKey);
    }
  };

  const sync: ISyncCookieStore = {
    get: (key) => {
      assertLive();
      return (
        readVisibleCookie(
          namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie),
          'cookie.get',
          key
        ) ?? null
      );
    },
    set: (key, value, ctx) => {
      assertLive();
      const context = snapshotCookieWriteContext(ctx, key);
      snapshotSyncWriteOptions(context);
      if (typeof value !== 'string')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new TypeError('cookie value must be a string')
        });
      const physicalKey = namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie);
      /** Snapshot mutable/getter-backed context fields before validation and serialization. */
      const maxAge = context?.maxAge;
      const expires = context?.expires;
      if (maxAge !== undefined && !Number.isSafeInteger(maxAge))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie maxAge must be a safe integer')
        });
      if (expires !== undefined && (typeof expires !== 'object' || expires === null))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie expires must be a valid Date')
        });
      /** Read a Date-like value once so validation and serialization cannot observe different times. */
      let expiresTime: number | undefined;
      try {
        expiresTime =
          expires === undefined
            ? undefined
            : ((expires as { getTime(): unknown }).getTime() as number);
      } catch (cause) {
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause
        });
      }
      if (expiresTime !== undefined && !Number.isFinite(expiresTime))
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.cookie,
          key,
          cause: new RangeError('cookie expires must be a valid Date')
        });
      const expiresNow =
        (maxAge !== undefined && maxAge <= 0) ||
        (expiresTime !== undefined && expiresTime <= Date.now());
      writeCookie(
        expiresNow
          ? serializeCookieRemoval(physicalKey, scope)
          : serializeCookieAssignment(physicalKey, value, {
              ...scope,
              expires: expiresTime === undefined ? undefined : new Date(expiresTime),
              maxAge
            }),
        StorageOperation.cookieSet,
        key
      );
      const visible = readVisibleCookie(physicalKey, StorageOperation.cookieSet, key);
      if (expiresNow && visible === undefined) return;
      if (!expiresNow && visible === value) return;
      if (visible !== undefined)
        throw new StorageError(StorageErrorCode.cookieScopeAmbiguous, {
          backend: StorageBackend.cookie,
          key,
          operation: StorageOperation.cookieSet,
          cause: new Error('same cookie name remains visible from an unknown scope')
        });
      throw new StorageError(StorageErrorCode.writeFailed, {
        backend: StorageBackend.cookie,
        key,
        operation: StorageOperation.cookieSet,
        cause: new Error('cookie write was not visible in the active scope')
      });
    },
    remove: (key) => {
      assertLive();
      const physicalKey = namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie);
      readVisibleCookie(physicalKey, StorageOperation.cookieRemove, key);
      writeCookie(serializeCookieRemoval(physicalKey, scope), StorageOperation.cookieRemove, key);
    },
    has: (key) => {
      assertLive();
      return (
        readVisibleCookie(
          namespacedKey(namespace, key, namespaceCodec, StorageBackend.cookie),
          'cookie.has',
          key
        ) !== undefined
      );
    },
    keys: () => {
      assertLive();
      return namespacedEntries().map((entry) => entry.logicalKey);
    },
    clearValues: () => {
      assertLive();
      clearNamespacedEntries('cookie.clearValues');
    }
  };

  return {
    backend: StorageBackend.cookie,
    capabilities: CAPABILITIES,
    sync,
    get: (key, ctx) => withCookieAbort(ctx, async () => sync.get(key)),
    set: async (key, value, ctx?: ICookieWriteContext) => {
      const context = snapshotCookieWriteContext(ctx, key);
      await withAbort(context?.lifecycle, async () =>
        sync.set(key, value, {
          expires: context?.expires,
          maxAge: context?.maxAge
        })
      );
    },
    remove: (key, ctx?: ICookieRemoveContext) => withCookieAbort(ctx, async () => sync.remove(key)),
    has: (key, ctx) => withCookieAbort(ctx, async () => sync.has(key)),
    keys: (ctx) => withCookieAbort(ctx, async () => sync.keys()),
    clearValues: (ctx) =>
      withCookieAbort(ctx, async (signal) => {
        assertLive();
        clearNamespacedEntries('cookie.clearValues', signal);
      }),
    clearAll: (ctx) =>
      withCookieAbort(ctx, async (signal) => {
        assertLive();
        clearNamespacedEntries('cookie.clearAll', signal);
      }),
    dispose: () =>
      toPromise(() => {
        disposed = true;
      })
  };
};
