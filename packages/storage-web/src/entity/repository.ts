import { isRecordStore } from '../types/storage';
import { StorageError, StorageErrorCode } from '../types/errors';
import { runMigrations } from '../schema/migrate';
import { selectCodec } from '../serialize/registry';
import { jsonCodec } from '../serialize/json';
import { structuredCodec } from '../serialize/structured';
import {
  composeFlatKey,
  composeRepositoryKey,
  composeStructuredKey,
  decodeRepositoryKey,
  flatKeyPrefix,
  repositoryEntityRange
} from './key';
import {
  assertStorageKey,
  compareStorageKeys,
  decodeFlatStorageKey,
  encodeFlatStorageKey,
  snapshotKeyRange
} from '../core/key-domain';
import { isStorageKeyInRange } from '../core/query';
import { invokeExtension, normalizeError } from '../core/errors';
import { snapshotOperationContext } from '../core/operation';
import type { IOperationContext, IStorageKey } from '../types/context';
import type { IRecordStore, IKeyValueStore } from '../types/storage';
import type { ISchemaAdapter } from '../schema/types';
import type { IMigration } from '../schema/migrate';
import type { ICodec } from '../serialize/types';
import type { ISelectedCodec } from '../serialize/registry';
import type {
  IEntityTransactionScope,
  IInvalidRecordHandler,
  IListOptions,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IMigrateOptions,
  IRepository
} from './types';

type IEnvelope = { readonly __v: number; readonly data: unknown };
type IStageFailure = Error & {
  readonly stage: 'decode' | 'migrate' | 'validate';
  readonly cause: unknown;
};

type IWriteTarget = { readonly documentKey?: IStorageKey; readonly flatKey?: string };

/* c8 ignore start -- defensive stage wrapping is exercised through the public error assertions. */
const stageFailure = (stage: IStageFailure['stage'], cause: unknown): IStageFailure => {
  /* c8 ignore next -- all current extension boundaries normalize to StorageError; retain a defensive path for future callers. */
  if (cause instanceof StorageError) {
    const staged = new StorageError(
      cause.code,
      {
        backend: cause.backend,
        key: cause.key,
        existingChannel: cause.existingChannel,
        attemptedChannel: cause.attemptedChannel,
        operation: cause.operation,
        extensionStage: cause.extensionStage,
        cause: cause.cause ?? cause
      },
      cause.message,
      stage
    ) as unknown as IStageFailure;
    return staged;
  }
  const error = new Error(String(cause)) as IStageFailure;
  Object.defineProperties(error, {
    stage: { value: stage, enumerable: true },
    cause: { value: cause, enumerable: true }
  });
  return error;
};
/* c8 ignore stop */

const validateLimit = (limit: number | undefined, backend: IKeyValueStore['backend']): void => {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new RangeError('list limit must be a non-negative safe integer')
    });
};

const validateOrderBy = (orderBy: unknown, backend: IKeyValueStore['backend']): void => {
  if (orderBy !== undefined && typeof orderBy !== 'function')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('list orderBy must be a function')
    });
};

const validateListOptions = (options: unknown, backend: IKeyValueStore['backend']): void => {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError('list options must be an object')
    });
};

const BACKEND_KINDS = new Set(['local', 'session', 'cookie', 'indexeddb', 'memory']);

/** Reject foreign objects before capability selection can dereference an incomplete store. */
const assertKeyValueStore: (store: unknown) => asserts store is IKeyValueStore = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) {
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('entity store must be an object')
    });
  }
  const candidate = store as Record<string, unknown>;
  const capabilities = candidate.capabilities as Record<string, unknown>;
  const capabilityFlags = [
    'syncRead',
    'binary',
    'records',
    'transactions',
    'iteration',
    'opaqueEntries'
  ];
  if (
    typeof candidate.backend !== 'string' ||
    !BACKEND_KINDS.has(candidate.backend) ||
    typeof candidate.capabilities !== 'object' ||
    candidate.capabilities === null ||
    Array.isArray(candidate.capabilities) ||
    !capabilityFlags.every((flag) => typeof capabilities[flag] === 'boolean') ||
    (capabilities.maxValueBytes !== undefined &&
      (typeof capabilities.maxValueBytes !== 'number' ||
        !Number.isSafeInteger(capabilities.maxValueBytes) ||
        capabilities.maxValueBytes < 0)) ||
    !['get', 'set', 'remove', 'has', 'keys', 'clearValues', 'clearAll', 'dispose'].every(
      (method) => typeof candidate[method] === 'function'
    )
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('entity store does not implement the key-value store contract')
    });
};

export type IRepositoryConfig<TDomain, TStored> = {
  readonly name: string;
  readonly key: Extract<keyof TDomain, string>;
  readonly version: number;
  readonly schema: ISchemaAdapter<TDomain, TStored>;
  /** 未提供时按后端类型选默认值，见 createRepository。 */
  readonly codec: ICodec<unknown, unknown> | undefined;
  readonly migrations: Record<number, IMigration> | undefined;
  readonly validateOnRead: boolean;
  readonly onDiagnostic: (message: string) => void;
  readonly defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined;
};

const idOf = <TDomain>(
  entityName: string,
  keyProp: string,
  value: TDomain,
  backend: IKeyValueStore['backend']
): IStorageKey => {
  const id = (value as Record<string, unknown>)[keyProp];
  if (id === undefined || id === null)
    throw new StorageError(StorageErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(`entity "${entityName}": missing storage key "${keyProp}"`)
    });
  assertStorageKey(id, backend, `entity "${entityName}" key "${keyProp}"`);
  return id;
};

export const createRepository = <TDomain, TStored>(
  config: IRepositoryConfig<TDomain, TStored>,
  store: IKeyValueStore
): IRepository<TDomain> => {
  assertKeyValueStore(store);
  const {
    name,
    key: keyProp,
    version,
    schema,
    migrations,
    validateOnRead,
    onDiagnostic,
    defaultOrderBy
  } = config;
  const records = isRecordStore(store);
  const recordStore = records ? (store as IRecordStore<unknown>) : undefined;
  const emitDiagnostic = (message: string): void => {
    try {
      onDiagnostic(message);
    } catch {
      // Diagnostics are observational and cannot alter storage semantics.
    }
  };

  /**
   * Select one codec for every repository path. Structured backends use the identity-like
   * structured codec by default, while text-only backends use JSON; an explicit codec is always
   * routed through capability validation.
   */
  const selectedCodec: ISelectedCodec = selectCodec(
    config.codec ?? (records ? structuredCodec : jsonCodec),
    store.capabilities,
    emitDiagnostic
  );
  const migrationFingerprint = [
    name,
    String(version),
    keyProp,
    schema.name,
    config.codec?.name ?? (records ? structuredCodec.name : jsonCodec.name),
    Object.keys(migrations ?? {})
      .map(Number)
      .sort((left, right) => left - right)
      .join(',')
  ].join('|');

  const writeEnvelopeAt = async (
    target: IWriteTarget,
    envelope: IEnvelope,
    ctx?: IOperationContext
  ): Promise<void> => {
    const raw = await encodeEnvelope(envelope, ctx);
    if (recordStore && target.documentKey !== undefined) {
      await recordStore.putRecord(raw, target.documentKey, ctx);
      return;
    }
    if (target.flatKey !== undefined) {
      await store.set(target.flatKey, raw as string, ctx);
    }
  };

  /** Encode every repository write through one extension error boundary. */
  const encodeEnvelope = async (envelope: IEnvelope, ctx?: IOperationContext): Promise<unknown> =>
    invokeExtension(
      () => selectedCodec.encode(envelope, ctx),
      store.backend,
      'entity.codec.encode',
      'codec',
      ctx?.signal
    );

  const materialize = async (
    envelope: IEnvelope | undefined,
    ctx?: IOperationContext
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined;
    if (envelope.__v > version)
      throw new StorageError(StorageErrorCode.versionUnsupported, {
        backend: store.backend,
        cause: new RangeError(`entity "${name}" requires version ${envelope.__v}`)
      });
    let stored = envelope.data;
    if (envelope.__v < version) {
      try {
        stored = await runMigrations(stored, envelope.__v, version, migrations, ctx?.signal);
      } catch (cause) {
        throw stageFailure('migrate', cause);
      }
    }
    let decoded: TDomain;
    try {
      decoded = schema.decode
        ? await invokeExtension(
            () => schema.decode!(stored as TStored, ctx),
            store.backend,
            'entity.schema.decode',
            'schema',
            ctx?.signal
          )
        : (stored as TDomain);
    } catch (cause) {
      throw stageFailure('decode', cause);
    }
    if (!validateOnRead) return decoded;
    try {
      return await invokeExtension(
        () => schema.validate(decoded, ctx),
        store.backend,
        'entity.schema.validate',
        'schema',
        ctx?.signal
      );
    } catch (cause) {
      throw stageFailure('validate', cause);
    }
  };

  const toEnvelope = async (
    value: TDomain,
    ctx?: IOperationContext
  ): Promise<{ readonly domain: TDomain; readonly envelope: IEnvelope }> => {
    const domain = await invokeExtension(
      () => schema.validate(value, ctx),
      store.backend,
      'entity.schema.validate',
      'schema',
      ctx?.signal
    );
    const normalized = schema.normalize
      ? await invokeExtension(
          () => schema.normalize!(domain, ctx),
          store.backend,
          'entity.schema.normalize',
          'schema',
          ctx?.signal
        )
      : domain;
    const stored = schema.encode
      ? await invokeExtension(
          () => schema.encode!(normalized, ctx),
          store.backend,
          'entity.schema.encode',
          'schema',
          ctx?.signal
        )
      : (normalized as unknown as TStored);
    return { domain: normalized, envelope: { __v: version, data: stored } };
  };

  const decodeEnvelope = async (raw: unknown, ctx?: IOperationContext): Promise<IEnvelope> => {
    const decoded: unknown = await invokeExtension(
      () => selectedCodec.decode(raw, ctx),
      store.backend,
      'entity.codec.decode',
      'codec',
      ctx?.signal
    );
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !Number.isSafeInteger((decoded as { __v?: unknown }).__v) ||
      (decoded as { __v: number }).__v < 0 ||
      !Object.hasOwn(decoded, 'data')
    )
      throw new StorageError(StorageErrorCode.deserializeFailed, {
        backend: store.backend,
        cause: new TypeError('invalid entity envelope')
      });
    return decoded as IEnvelope;
  };

  /** Apply the invalid-record policy once so handler failures have one stable error boundary. */
  const invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListOptions<TDomain> | undefined
  ): IInvalidRecordAction => invokeInvalidHandler(option?.onInvalid, issue);

  const validateInvalidHandler = (handler: unknown): void => {
    if (
      handler !== undefined &&
      handler !== 'skip' &&
      handler !== 'throw' &&
      typeof handler !== 'function'
    )
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        cause: new TypeError('onInvalid must be skip, throw, or a handler')
      });
  };

  /** Snapshot list options once so getters cannot change values after validation. */
  const normalizeListOptions = (
    options: IListOptions<TDomain> | undefined
  ): IListOptions<TDomain> | undefined => {
    validateListOptions(options, store.backend);
    if (options === undefined) return undefined;
    let range: IListOptions<TDomain>['range'];
    let limit: IListOptions<TDomain>['limit'];
    let orderBy: IListOptions<TDomain>['orderBy'];
    let onInvalid: IListOptions<TDomain>['onInvalid'];
    try {
      range = options.range;
      limit = options.limit;
      orderBy = options.orderBy;
      onInvalid = options.onInvalid;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        cause
      });
    }
    const rangeSnapshot = snapshotKeyRange(range, store.backend);
    validateLimit(limit, store.backend);
    validateOrderBy(orderBy, store.backend);
    validateInvalidHandler(onInvalid);
    return { range: rangeSnapshot, limit, orderBy, onInvalid };
  };

  /** Snapshot migration options once before checkpoint or record work begins. */
  const normalizeMigrateOptions = (
    options: IMigrateOptions<TDomain>
  ): { readonly batchSize: number; readonly onInvalid: IMigrateOptions<TDomain>['onInvalid'] } => {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        cause: new TypeError('migrate options must be an object')
      });
    let batchSize: IMigrateOptions<TDomain>['batchSize'];
    let onInvalid: IMigrateOptions<TDomain>['onInvalid'];
    try {
      batchSize = options.batchSize;
      onInvalid = options.onInvalid;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        cause
      });
    }
    const normalizedBatchSize = batchSize === undefined ? 100 : batchSize;
    if (!Number.isSafeInteger(normalizedBatchSize) || normalizedBatchSize < 1)
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        cause: new RangeError('migrate batchSize must be a positive safe integer')
      });
    validateInvalidHandler(onInvalid);
    return { batchSize: normalizedBatchSize, onInvalid };
  };

  const invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => {
    if (handler === undefined || handler === 'skip' || handler === 'throw')
      return handler ?? 'skip';
    if (typeof handler !== 'function')
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend: store.backend,
        key: issue.key,
        cause: new TypeError('onInvalid must be skip, throw, or a handler')
      });
    try {
      const action = handler(issue);
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageErrorCode.invalidArgument, {
          backend: store.backend,
          key: issue.key,
          cause: new TypeError('onInvalid handler must return skip or throw')
        });
      return action;
    } catch (cause) {
      if (cause instanceof StorageError && cause.code === StorageErrorCode.invalidArgument)
        throw cause;
      throw new StorageError(StorageErrorCode.validationFailed, {
        backend: store.backend,
        key: issue.key,
        cause
      });
    }
  };

  const throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => {
    /* c8 ignore start -- all current decode/migrate/validate stages normalize to StorageError. */
    if (issue.cause instanceof StorageError) throw issue.cause;
    const code =
      issue.stage === 'migrate'
        ? StorageErrorCode.migrationFailed
        : issue.stage === 'decode'
          ? StorageErrorCode.deserializeFailed
          : StorageErrorCode.validationFailed;
    throw new StorageError(code, {
      backend: store.backend,
      key: issue.key,
      cause: issue.cause
    });
    /* c8 ignore stop */
  };

  const materializeForRead = async (
    id: IStorageKey,
    envelope: IEnvelope | undefined,
    ctx?: IOperationContext
  ): Promise<TDomain | undefined> => {
    try {
      return await materialize(envelope, ctx);
    } catch (cause) {
      /* c8 ignore start -- materialize's extension boundaries already return StorageError. */
      if (cause instanceof StorageError) throw cause;
      const stage = (cause as Partial<IStageFailure>).stage ?? 'validate';
      const code =
        stage === 'migrate'
          ? StorageErrorCode.migrationFailed
          : stage === 'decode'
            ? StorageErrorCode.deserializeFailed
            : StorageErrorCode.validationFailed;
      throw new StorageError(code, { backend: store.backend, key: id, cause });
    }
  };

  const readEnvelope = async (
    id: IStorageKey,
    ctx?: IOperationContext
  ): Promise<IEnvelope | undefined> => {
    if (recordStore) {
      let raw = await recordStore.getRecord(composeRepositoryKey(name, id), ctx);
      if (raw === undefined) raw = await recordStore.getRecord(composeStructuredKey(name, id), ctx);
      if (raw === undefined) return undefined;
      return decodeEnvelope(raw, ctx);
    }
    const raw = await store.get(composeFlatKey(name, id), ctx);
    if (raw === null) return undefined;
    return decodeEnvelope(raw, ctx);
  };

  const sortRecords = (
    records: TDomain[],
    comparator: (left: TDomain, right: TDomain) => number
  ): void => {
    try {
      records.sort((left, right) => {
        const result = comparator(left, right);
        if (typeof result !== 'number' || Number.isNaN(result))
          throw new TypeError('entity orderBy comparator must return a number');
        return result;
      });
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: store.backend,
        cause,
        operation: 'entity.orderBy',
        extensionStage: 'comparator'
      });
      /* c8 ignore stop */
    }
  };

  const streamImpl = async function* (
    options: IListOptions<TDomain> | undefined,
    ctx?: IOperationContext,
    applyOrdering = true
  ) {
    const comparator = applyOrdering ? (options?.orderBy ?? defaultOrderBy) : undefined;
    if (comparator) {
      const buffered: TDomain[] = [];
      const scanOptions = { ...options, orderBy: undefined, limit: undefined };
      for await (const record of streamImpl(scanOptions, ctx, false)) buffered.push(record);
      sortRecords(buffered, comparator);
      const limited = options?.limit === undefined ? buffered : buffered.slice(0, options.limit);
      for (const record of limited) yield record;
      return;
    }
    if (recordStore) {
      const ranges: Array<ReturnType<typeof repositoryEntityRange> | undefined> = [
        repositoryEntityRange(name),
        undefined
      ];
      let count = 0;
      const seenIds = new Set<string>();
      for (const range of ranges) {
        for await (const [physicalKey, raw] of recordStore.iterateRecords(range, ctx)) {
          const v2RecordId = decodeRepositoryKey(name, physicalKey);
          const recordId =
            v2RecordId ??
            (Array.isArray(physicalKey) && physicalKey.length === 2 && physicalKey[0] === name
              ? (physicalKey[1] as IStorageKey)
              : undefined);
          if (recordId === undefined) continue;
          if (!isStorageKeyInRange(recordId, options?.range)) continue;
          const identity = encodeFlatStorageKey(recordId);
          if (v2RecordId !== undefined) seenIds.add(identity);
          if (range === undefined) {
            if (!Array.isArray(physicalKey) || physicalKey.length !== 2 || physicalKey[0] !== name)
              continue;
            if (seenIds.has(identity)) continue;
          }
          let value: TDomain | undefined;
          try {
            let envelope: IEnvelope;
            try {
              envelope = await decodeEnvelope(raw, ctx);
            } catch (cause) {
              throw stageFailure('decode', cause);
            }
            value = await materialize(envelope, ctx);
          } catch (cause) {
            const issue: IInvalidRecordIssue<TDomain> = {
              key: recordId,
              raw,
              stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
              cause
            };
            const action = invalidAction(issue, options);
            if (action === 'throw') throwInvalid(issue);
            emitDiagnostic(
              `[storage-web] entity "${name}" skipped invalid record ${String(recordId)}`
            );
            continue;
          }
          if (value !== undefined) {
            yield value;
            count += 1;
            if (options?.limit !== undefined && count >= options.limit) return;
          }
        }
      }
      return;
    }
    emitDiagnostic(
      `[storage-web] entity "${name}".list/stream on a value-only backend performs a full key scan`
    );
    const prefix = flatKeyPrefix(name);
    const keys = (await store.keys(ctx))
      .filter((rawKey) => rawKey.startsWith(prefix))
      .map((rawKey) => ({ rawKey, id: decodeFlatStorageKey(rawKey.slice(prefix.length)) }))
      .filter((entry): entry is { rawKey: string; id: IStorageKey } => entry.id !== undefined)
      .sort((left, right) => compareStorageKeys(left.id, right.id));
    let count = 0;
    for (const { rawKey, id } of keys) {
      if (!isStorageKeyInRange(id, options?.range)) continue;
      const raw = await store.get(rawKey, ctx);
      if (raw === null) continue;
      let value: TDomain | undefined;
      try {
        let envelope: IEnvelope;
        try {
          envelope = await decodeEnvelope(raw, ctx);
        } catch (cause) {
          throw stageFailure('decode', cause);
        }
        value = await materialize(envelope, ctx);
      } catch (cause) {
        const issue: IInvalidRecordIssue<TDomain> = {
          key: id,
          raw,
          stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
          cause
        };
        const action = invalidAction(issue, options);
        if (action === 'throw') throwInvalid(issue);
        emitDiagnostic(`[storage-web] entity "${name}" skipped invalid record ${rawKey}`);
        continue;
      }
      if (value !== undefined) {
        yield value;
        count += 1;
        if (options?.limit !== undefined && count >= options.limit) return;
      }
    }
  };

  const persistValue = async (value: TDomain, ctx?: IOperationContext): Promise<void> => {
    const prepared = await toEnvelope(value, ctx);
    const id = idOf(name, keyProp, prepared.domain, store.backend);
    const target: IWriteTarget = recordStore
      ? { documentKey: composeRepositoryKey(name, id) }
      : { flatKey: composeFlatKey(name, id) };
    await writeEnvelopeAt(target, prepared.envelope, ctx);
  };

  return {
    get: async (id, ctx) => {
      const context = snapshotOperationContext(ctx);
      assertStorageKey(id, store.backend, `entity "${name}" id`);
      return materializeForRead(id, await readEnvelope(id, context), context);
    },

    put: async (value, ctx) => {
      const context = snapshotOperationContext(ctx);
      const prepared = await toEnvelope(value, context);
      const id = idOf(name, keyProp, prepared.domain, store.backend);
      if (recordStore) {
        const raw = await encodeEnvelope(prepared.envelope, context);
        await recordStore.transaction(async (tx) => {
          await tx.put(raw, composeRepositoryKey(name, id));
          await tx.delete(composeStructuredKey(name, id));
        }, context);
        return id;
      }
      const target: IWriteTarget = { flatKey: composeFlatKey(name, id) };
      await writeEnvelopeAt(target, prepared.envelope, context);
      return id;
    },

    remove: async (id, ctx) => {
      const context = snapshotOperationContext(ctx);
      assertStorageKey(id, store.backend, `entity "${name}" id`);
      if (recordStore) {
        await recordStore.transaction(async (tx) => {
          await tx.delete(composeRepositoryKey(name, id));
          await tx.delete(composeStructuredKey(name, id));
        }, context);
        return;
      }
      await store.remove(composeFlatKey(name, id), context);
    },

    list: async (options, ctx) => {
      const context = snapshotOperationContext(ctx);
      const normalized = normalizeListOptions(options);
      const results: TDomain[] = [];
      const comparator = normalized?.orderBy ?? defaultOrderBy;
      const streamOptions = comparator ? { ...normalized, limit: undefined } : normalized;
      for await (const record of streamImpl(streamOptions, context)) results.push(record);
      if (normalized?.limit !== undefined) return results.slice(0, normalized.limit);
      return results;
    },

    stream: (options, ctx) => {
      return streamImpl(normalizeListOptions(options), snapshotOperationContext(ctx));
    },

    migrate: async (options: IMigrateOptions<TDomain> = {}, ctx) => {
      const context = snapshotOperationContext(ctx);
      const { batchSize, onInvalid } = normalizeMigrateOptions(options);
      const migrationMetadata = recordStore?.metadata;
      const checkpointKey = `repository:${name}:migration`;
      type IMigrationCheckpoint = {
        readonly status: 'running' | 'complete';
        readonly phase?: 'v2' | 'legacy';
        readonly version: number;
        readonly schemaFingerprint: string;
        readonly lastPhysicalKey?: IStorageKey;
        readonly scanned: number;
        readonly eligible: number;
        readonly migrated: number;
        readonly skipped: number;
        readonly alreadyCurrent: number;
        readonly conflicted: number;
      };
      const writeCheckpoint = async (value: unknown): Promise<void> => {
        if (migrationMetadata) await migrationMetadata.set(checkpointKey, value, context);
      };
      const checkpoint = (await migrationMetadata?.get(checkpointKey, context)) as
        | IMigrationCheckpoint
        | undefined;
      const checkpointMatches =
        checkpoint?.status === 'running' &&
        checkpoint.version === version &&
        checkpoint.schemaFingerprint === migrationFingerprint;
      let scanned = checkpointMatches ? checkpoint.scanned : 0;
      let migrated = checkpointMatches ? checkpoint.migrated : 0;
      let eligible = checkpointMatches ? checkpoint.eligible : 0;
      let alreadyCurrent = checkpointMatches ? checkpoint.alreadyCurrent : 0;
      let skipped = checkpointMatches ? checkpoint.skipped : 0;
      let conflicted = checkpointMatches ? checkpoint.conflicted : 0;
      let lastPhysicalKey = checkpointMatches ? checkpoint.lastPhysicalKey : undefined;
      let phase: 'v2' | 'legacy' = checkpointMatches ? (checkpoint.phase ?? 'legacy') : 'v2';
      const batch: Array<{
        readonly physicalKey: IStorageKey;
        readonly raw: unknown;
        readonly id: IStorageKey;
        readonly legacy: boolean;
        readonly value: TDomain;
      }> = [];
      const persistBatch = async (): Promise<void> => {
        if (batch.length === 0) return;
        if (!recordStore) {
          for (const entry of batch) await persistValue(entry.value, context);
          migrated += batch.length;
        } else {
          try {
            const migratedInBatch = await recordStore.transaction(async (tx) => {
              let count = 0;
              for (const entry of batch) {
                const currentRaw = await tx.get(entry.physicalKey);
                if (currentRaw === undefined) continue;
                if (entry.legacy) {
                  const existingTarget = await tx.get(composeRepositoryKey(name, entry.id));
                  if (existingTarget !== undefined) {
                    await tx.delete(entry.physicalKey);
                    continue;
                  }
                  const currentEnvelope = await decodeEnvelope(currentRaw, context);
                  const currentValue = await materialize(currentEnvelope, context);
                  if (currentValue === undefined) continue;
                  const prepared = await toEnvelope(currentValue, context);
                  const raw = await encodeEnvelope(prepared.envelope, context);
                  await tx.put(raw, composeRepositoryKey(name, entry.id));
                  await tx.delete(entry.physicalKey);
                  count += 1;
                  continue;
                }
                const prepared = await toEnvelope(entry.value, context);
                const raw = await encodeEnvelope(prepared.envelope, context);
                await tx.put(raw, composeRepositoryKey(name, entry.id));
                count += 1;
              }
              return count;
            }, context);
            migrated += migratedInBatch;
          } catch (cause) {
            if (
              cause instanceof StorageError &&
              cause.code === StorageErrorCode.transactionConflict
            ) {
              for (const entry of batch) {
                try {
                  const retryOutcome = await recordStore.transaction(async (tx) => {
                    const targetRaw = await tx.get(composeRepositoryKey(name, entry.id));
                    if (targetRaw !== undefined) {
                      const targetEnvelope = await decodeEnvelope(targetRaw, context);
                      if (targetEnvelope.__v >= version) {
                        if (entry.legacy) await tx.delete(entry.physicalKey);
                        return 'alreadyCurrent' as const;
                      }
                    }
                    const currentRaw = await tx.get(entry.physicalKey);
                    if (currentRaw === undefined) return 'missing' as const;
                    const currentEnvelope = await decodeEnvelope(currentRaw, context);
                    const currentValue = await materialize(currentEnvelope, context);
                    if (currentValue === undefined) return 'missing' as const;
                    if (currentEnvelope.__v >= version) return 'alreadyCurrent' as const;
                    const prepared = await toEnvelope(currentValue, context);
                    const nextRaw = await encodeEnvelope(prepared.envelope, context);
                    await tx.put(nextRaw, composeRepositoryKey(name, entry.id));
                    if (entry.legacy) await tx.delete(entry.physicalKey);
                    return 'migrated' as const;
                  }, context);
                  if (retryOutcome === 'migrated') migrated += 1;
                  if (retryOutcome === 'alreadyCurrent') alreadyCurrent += 1;
                } catch (retryCause) {
                  if (
                    retryCause instanceof StorageError &&
                    retryCause.code === StorageErrorCode.transactionConflict
                  ) {
                    conflicted += 1;
                    continue;
                  }
                  throw normalizeError(
                    retryCause,
                    store.backend,
                    StorageErrorCode.transactionFailed,
                    'entity.migrate'
                  );
                }
              }
            } else {
              throw normalizeError(
                cause,
                store.backend,
                StorageErrorCode.transactionFailed,
                'entity.migrate'
              );
            }
          }
        }
        await writeCheckpoint({
          status: 'running',
          phase,
          version,
          schemaFingerprint: migrationFingerprint,
          lastPhysicalKey,
          scanned,
          eligible,
          migrated,
          skipped,
          alreadyCurrent,
          conflicted
        });
        batch.length = 0;
      };
      if (recordStore) {
        const phases: Array<'v2' | 'legacy'> = phase === 'v2' ? ['v2', 'legacy'] : ['legacy'];
        for (const scanPhase of phases) {
          phase = scanPhase;
          if (scanPhase !== (checkpointMatches ? (checkpoint.phase ?? 'legacy') : 'v2'))
            lastPhysicalKey = undefined;
          const entityRange = repositoryEntityRange(name);
          const migrationRange =
            scanPhase === 'v2'
              ? lastPhysicalKey
                ? { ...entityRange, lower: lastPhysicalKey, lowerOpen: true }
                : entityRange
              : lastPhysicalKey
                ? { lower: lastPhysicalKey, lowerOpen: true }
                : undefined;
          for await (const [physicalKey, raw] of recordStore.iterateRecords(
            migrationRange,
            context
          )) {
            lastPhysicalKey = physicalKey;
            const v2RecordId = decodeRepositoryKey(name, physicalKey);
            const legacy =
              v2RecordId === undefined &&
              Array.isArray(physicalKey) &&
              physicalKey.length === 2 &&
              physicalKey[0] === name;
            const recordId = v2RecordId ?? (legacy ? (physicalKey[1] as IStorageKey) : undefined);
            if (scanPhase === 'v2' && v2RecordId === undefined) continue;
            if (scanPhase === 'legacy' && !legacy) continue;
            if (recordId === undefined) continue;
            scanned += 1;
            let envelope: IEnvelope;
            try {
              envelope = await decodeEnvelope(raw, context);
              const value = await materialize(envelope, context);
              if (value === undefined) continue;
              if (envelope.__v >= version) {
                alreadyCurrent += 1;
                continue;
              }
              eligible += 1;
              batch.push({ physicalKey, raw, id: recordId, legacy, value });
            } catch (cause) {
              const issue: IInvalidRecordIssue<TDomain> = {
                key: recordId,
                raw,
                stage: (cause as Partial<IStageFailure>).stage ?? 'decode',
                cause
              };
              const action = invokeInvalidHandler(onInvalid, issue);
              if (action === 'throw') throwInvalid(issue);
              skipped += 1;
            }
            if (batch.length >= batchSize) await persistBatch();
          }
          if (scanPhase === 'v2' && phases.length > 1) {
            phase = 'legacy';
            lastPhysicalKey = undefined;
            await writeCheckpoint({
              status: 'running',
              phase,
              version,
              schemaFingerprint: migrationFingerprint,
              scanned,
              eligible,
              migrated,
              skipped,
              alreadyCurrent,
              conflicted
            });
          }
        }
      } else {
        for await (const value of streamImpl({ onInvalid }, context)) {
          eligible += 1;
          batch.push({
            physicalKey: String(scanned),
            raw: undefined,
            id: idOf(name, keyProp, value, store.backend),
            legacy: false,
            value
          });
          scanned += 1;
          if (batch.length >= batchSize) await persistBatch();
        }
      }
      await persistBatch();
      await writeCheckpoint({
        status: 'complete',
        phase,
        version,
        schemaFingerprint: migrationFingerprint,
        lastPhysicalKey,
        scanned,
        eligible,
        migrated,
        skipped,
        alreadyCurrent,
        conflicted
      });
      return { scanned, eligible, migrated, skipped, alreadyCurrent, conflicted };
    },

    batch: async (run, ctx) => {
      const context = snapshotOperationContext(ctx);
      if (typeof run !== 'function')
        throw new StorageError(StorageErrorCode.invalidArgument, {
          backend: store.backend,
          cause: new TypeError('batch callback must be a function')
        });
      if (!recordStore)
        throw new StorageError(StorageErrorCode.unsupported, { backend: store.backend });
      return recordStore.transaction(async (tx) => {
        const scope: IEntityTransactionScope<TDomain> = {
          get: async (id) => {
            let raw = await tx.get(composeRepositoryKey(name, id));
            if (raw === undefined) raw = await tx.get(composeStructuredKey(name, id));
            if (raw === undefined) return undefined;
            return materializeForRead(id, await decodeEnvelope(raw, context), context);
          },
          put: async (value) => {
            const prepared = await toEnvelope(value, context);
            const id = idOf(name, keyProp, prepared.domain, store.backend);
            const raw = await encodeEnvelope(prepared.envelope, context);
            await tx.put(raw, composeRepositoryKey(name, id));
            await tx.delete(composeStructuredKey(name, id));
            return id;
          },
          remove: async (id) => {
            await tx.delete(composeRepositoryKey(name, id));
            await tx.delete(composeStructuredKey(name, id));
          }
        };
        return run(scope);
      }, context);
    }
  };
};
