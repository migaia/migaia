import {
  defineEntity,
  localStorage,
  cookies,
  indexedDb,
  memoryStorage,
  fromStandardSchema,
  runMigrations,
  selectCodec,
  jsonCodec,
  StorageError
} from '../src/index';
import { fromIdbRequest, idbTransactionCommit } from '../src/utils/idb-request';
import { snapshotOperationContext, withAbort } from '../src/core/operation';
import { createStorageOperationRuntime } from '../src/core/operation-reporter';
import { isKeyValueStore, isRecordStore } from '../src/types/storage';

declare global {
  interface Window {
    runLocalStorageQuotaScenario(): Promise<{
      wroteCount: number;
      quotaErrorCode: string | undefined;
      optionsCode: string | undefined;
    }>;
    runStorageFailureScenario(): Promise<{
      code: string | undefined;
      hasCause: boolean;
      invalidStorageCode: string | undefined;
      invalidLengthCode: string | undefined;
      constructorOptionReads: number;
      optionGetterCode: string | undefined;
      storageLengthReads: number;
      storageGetterCode: string | undefined;
      namespaceCodecReads: number;
      runtimeLengthReads: number;
      codecPhysicalClear: boolean;
      partialClearCode: string | undefined;
      partialClearOperation: string | undefined;
      partialClearKey: unknown;
      snapshotClearCode: string | undefined;
      snapshotClearOperation: string | undefined;
      reentrantAbortCode: string | undefined;
      reentrantAbortOperation: string | undefined;
      reentrantAbortKeyMatchesRemaining: boolean;
      incoherentClearCode: string | undefined;
      incoherentClearOperation: string | undefined;
      incoherentClearPreservedValues: boolean;
    }>;
    runCookieSecureScenario(): Promise<{
      insecureVisible: boolean;
      secureVisible: boolean;
    }>;
    runCookieSizeLimitScenario(): Promise<{ code: string | undefined }>;
    runCookieDuplicateScopeScenario(): Promise<{
      codes: Array<string | undefined>;
      duplicateVisible: boolean;
    }>;
    runCookieScopeGuardScenario(): Promise<{
      scopeCode: string | undefined;
      codecCode: string | undefined;
      documentCode: string | undefined;
      optionsCode: string | undefined;
      expiresCode: string | undefined;
      maxAgeCode: string | undefined;
      expiresReads: number;
      snapshotValue: string | null;
      constructorOptionReads: number;
      scopeReads: number;
      removeContextReads: number;
      documentReadCode: string | undefined;
      documentTypeDriftCode: string | undefined;
      documentWriteCode: string | undefined;
      partialClearCode: string | undefined;
      partialClearOperation: string | undefined;
      partialClearKey: unknown;
      snapshotClearCode: string | undefined;
      snapshotClearOperation: string | undefined;
      reentrantAbortCode: string | undefined;
      reentrantAbortOperation: string | undefined;
      reentrantAbortKeyMatchesRemaining: boolean;
      syncRemoveOverrideReads: number;
      writeContextReads: number;
      writeContextReturnedPromise: boolean;
      writeContextGetterCode: string | undefined;
      writeLifecycleMetadata: boolean;
      removeLifecycleMetadata: boolean;
    }>;
    runIndexedDbBlockedScenario(): Promise<{
      blockedErrorCode: string | undefined;
      secondOpenSucceededAfterClose: boolean;
      sameStoreRetrySucceeded: boolean;
      hostileCloseRetrySucceeded: boolean;
      transitionCloseCode: string | undefined;
      transitionCloseRetrySucceeded: boolean;
      schemaInspectionCodes: Array<string | undefined>;
      schemaInspectionRecovered: boolean;
      connectionSetterCodes: Array<string | undefined>;
      connectionSetterRecovered: boolean;
    }>;
    runIndexedDbSmokeScenario(): Promise<{ ok: boolean; value: unknown; metadata: unknown }>;
    runIndexedDbOptionsGuardScenario(): Promise<Array<string | undefined>>;
    runIndexedDbTransactionConflictScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runIndexedDbEscapedTransactionScopeScenario(): Promise<{
      getCode: string | undefined;
      putCode: string | undefined;
      deleteCode: string | undefined;
      outsideValue: unknown;
    }>;
    runIndexedDbPagedScanScenario(): Promise<{
      count: number;
      first: string | undefined;
      last: string | undefined;
      stoppedEarly: boolean;
      listenerSetupCode: string | undefined;
      cleanupPreserved: boolean;
      resultGetterCode: string | undefined;
      prematureCompletionCode: string | undefined;
      entryFailureCodes: Array<string | undefined>;
      requestSetterCode: string | undefined;
    }>;
    runIndexedDbDualTransactionScenario(): Promise<{
      committed: number;
      conflicts: number;
      value: unknown;
    }>;
    runIndexedDbLegacyRecordsMigrationScenario(): Promise<{
      value: unknown;
      checkpoint: unknown;
      legacyStorePresent: boolean;
      hostileCursorCode: string | undefined;
      hostileOpenCode: string | undefined;
      hostileUpgradeCode: string | undefined;
      openSetterCodes: Array<string | undefined>;
    }>;
    runIndexedDbFourWayTransactionScenario(): Promise<{ committed: number; conflicts: number }>;
    runIndexedDbFailureScenario(): Promise<{
      transactionCode: string | undefined;
      rolledBack: boolean;
      abortCode: string | undefined;
      abortMissing: boolean;
      invalidCallbackCodes: Array<string | undefined>;
      invalidScopeOptionsCode: string | undefined;
      invalidScopeWriteMissing: boolean;
      policyReads: number;
    }>;
    runIndexedDbClearAbortScenario(): Promise<{
      recordsCode: string | undefined;
      recordsValue: unknown;
      allCode: string | undefined;
      allValue: unknown;
      allRecord: unknown;
    }>;
    runIndexedDbDeleteAbortScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runIndexedDbPutAbortScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runIndexedDbEntityMigrationScenario(): Promise<{
      result: unknown;
      value: unknown;
      legacyValue: unknown;
      invalidBatchCode: string | undefined;
      invalidOptionsCodes: Array<string | undefined>;
      invalidBatchCallbackCodes: Array<string | undefined>;
      migrationOptionReads: number;
    }>;
    runIndexedDbConcurrentEntityMigrationScenario(): Promise<{
      results: Array<{ migrated: number; alreadyCurrent: number; conflicted: number }>;
      values: unknown[];
      legacyValues: unknown[];
    }>;
    runIndexedDbCrossRealmKeyScenario(): Promise<{
      dateValue: unknown;
      bytesValue: unknown;
      compoundValue: unknown;
    }>;
    runOperationLifecycleScenario(): Promise<{
      memoryTimeoutCode: string | undefined;
      indexedTimeoutCode: string | undefined;
      indexedDynamicSignalCode: string | undefined;
      disposedCode: string | undefined;
      memoryValue: unknown;
      invalidTimeoutCode: string | undefined;
      invalidContextCodes: Array<string | undefined>;
      invalidSignalCode: string | undefined;
      invalidSignalGetterCode: string | undefined;
      hostileReasonCode: string | undefined;
      hostileReasonHasCause: boolean;
      listenerSetupCode: string | undefined;
      cleanupPreservedResult: string | null;
      extensionListenerSetupCode: string | undefined;
      extensionCleanupPreserved: boolean;
      migrationListenerSetupCode: string | undefined;
      migrationCleanupPreserved: boolean;
      signalRaceCode: string | undefined;
      signalRaceCalls: number;
      contextSnapshotReads: number;
      signalSurfaceReads: number;
      repositoryContextReads: number;
      idbRequestRaceCode: string | undefined;
      idbRequestContextReads: number;
      idbRequestSetupCode: string | undefined;
      idbRequestCleanupPreserved: boolean;
      idbResultGetterCode: string | undefined;
      idbErrorGetterCode: string | undefined;
      idbRequestSetterCodes: Array<string | undefined>;
      idbTransactionSetterCodes: Array<string | undefined>;
      idbTransactionSetupCode: string | undefined;
      idbTransactionSetupRolledBack: boolean;
      idbDestructiveSetterCodes: Array<string | undefined>;
      idbDestructiveSetterRolledBack: boolean;
      syncOptionCodes: Array<string | undefined>;
    }>;
    runIndexedDbExtensionFailureScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runIndexedDbFutureVersionScenario(): Promise<{
      getCode: string | undefined;
      skippedCount: number;
      throwCode: string | undefined;
      invalidHandlerCode: string | undefined;
      rawValue: unknown;
    }>;
    runIndexedDbHangingExtensionAbortScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runIndexedDbHangingMigrationAbortScenario(): Promise<{
      code: string | undefined;
      rawValue: unknown;
      receivedSignal: boolean;
    }>;
    runIndexedDbPreAbortExtensionScenario(): Promise<{
      code: string | undefined;
      calls: number;
    }>;
    runIndexedDbPreAbortMigrationScenario(): Promise<{ code: string | undefined }>;
    runIndexedDbSchemaFailureScenario(): Promise<{
      code: string | undefined;
      value: unknown;
    }>;
    runEntityDefinitionGuardScenario(): Promise<{
      codes: Array<string | undefined>;
      storeCodes: Array<string | undefined>;
      codecCodes: Array<string | undefined>;
      schemaCodes: Array<string | undefined>;
      migrationCodes: Array<string | undefined>;
      versionCodes: Array<string | undefined>;
      migrationVersionCodes: Array<string | undefined>;
      prototypeMigrationCodes: Array<string | undefined>;
      nullVersionCodes: Array<string | undefined>;
      backendCodes: Array<string | undefined>;
      capabilityCodes: Array<string | undefined>;
      sparseVersionCodes: Array<string | undefined>;
      validateOnReadCodes: Array<string | undefined>;
      standardSchemaCodes: Array<string | undefined>;
      standardSchemaContractReads: number;
      standardSchemaResultReads: number;
      migrationHelperCodes: Array<string | undefined>;
      inheritedMigrationCalls: number;
      migrationRaceCode: string | undefined;
      codecSelectionCodes: Array<string | undefined>;
      hostileStorePredicates: boolean[];
      codecDescriptorReads: number;
      definitionOptionReads: number;
      definitionSchemaReads: number;
    }>;
    runEntityComparatorGuardScenario(): Promise<{
      codes: Array<string | undefined>;
      nullCode: string | undefined;
      invalidOptionsCodes: Array<string | undefined>;
      rangeCodes: Array<string | undefined>;
      invalidHandlerCodes: Array<string | undefined>;
      invalidPolicyCode: string | undefined;
      rangeSnapshotReads: number;
      listOptionReads: number;
    }>;
    runMemoryCompositeKeyOwnershipScenario(): Promise<{
      directStable: boolean;
      transactionStable: boolean;
      iterationStable: boolean;
      rangeStable: boolean;
    }>;
    runWorkerScenario(): Promise<{
      memory: string | null;
      indexedDb: string | null;
      localStorageCode: string | undefined;
      cookiesCode: string | undefined;
    }>;
  }
}

/** 真实浏览器下的 localStorage 配额：一直写到抛 QuotaExceededError 为止。 */
window.runLocalStorageQuotaScenario = async () => {
  const store = localStorage({ namespace: `quota-${Math.random().toString(36).slice(2)}` });
  const chunk = 'x'.repeat(1024 * 64); // 64KB/条，加速填满 ~5-10MB 配额
  let wroteCount = 0;
  let quotaErrorCode: string | undefined;
  try {
    for (let i = 0; i < 2000; i += 1) {
      await store.set(`k${i}`, chunk);
      wroteCount += 1;
    }
  } catch (error) {
    quotaErrorCode = (error as { code?: string }).code;
  }
  await store.clearValues();
  let optionsCode: string | undefined;
  try {
    localStorage(null as never);
  } catch (error) {
    optionsCode = (error as { code?: string }).code;
  }
  return { wroteCount, quotaErrorCode, optionsCode };
};

/** 真实浏览器页面内注入异常 Storage，验证公开入口仍归一化为 StorageError。 */
window.runStorageFailureScenario = async () => {
  let constructorOptionReads = 0;
  const getterStore = localStorage({
    get namespace() {
      constructorOptionReads += 1;
      return `getter-storage-${Math.random().toString(36).slice(2)}`;
    },
    get namespaceCodec() {
      constructorOptionReads += 1;
      return undefined;
    },
    get storage() {
      constructorOptionReads += 1;
      return window.localStorage;
    }
  });
  await getterStore.set('snapshot', 'value');
  await getterStore.clearValues();
  let optionGetterCode: string | undefined;
  try {
    localStorage({
      get namespace(): string {
        throw new Error('hostile browser namespace');
      }
    });
  } catch (error) {
    optionGetterCode = (error as { code?: string }).code;
  }
  let storageLengthReads = 0;
  const lengthObservedStorage = {
    get length() {
      storageLengthReads += 1;
      return window.localStorage.length;
    },
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
    key: (index: number) => window.localStorage.key(index),
    clear: () => window.localStorage.clear()
  };
  const lengthObservedStore = localStorage({
    namespace: `length-observed-${Math.random().toString(36).slice(2)}`,
    storage: lengthObservedStorage
  });
  await lengthObservedStore.dispose();
  let storageGetterCode: string | undefined;
  try {
    localStorage({
      storage: Object.defineProperty(lengthObservedStorage, 'getItem', {
        configurable: true,
        get: () => {
          throw new Error('hostile browser storage getter');
        }
      })
    });
  } catch (error) {
    storageGetterCode = (error as { code?: string }).code;
  }
  let namespaceCodecReads = 0;
  const codecStore = localStorage({
    namespace: `codec-observed-${Math.random().toString(36).slice(2)}`,
    get namespaceCodec() {
      return {
        get encode() {
          namespaceCodecReads += 1;
          return (namespace: string, key: string) => `${namespace}:${key}`;
        },
        get decode() {
          namespaceCodecReads += 1;
          return (namespace: string, physicalKey: string) =>
            physicalKey.startsWith(`${namespace}:`)
              ? physicalKey.slice(namespace.length + 1)
              : undefined;
        }
      };
    }
  });
  await codecStore.set('snapshot', 'value');
  await codecStore.clearValues();
  let runtimeLengthReads = 0;
  const boundedStorage = {
    get length() {
      runtimeLengthReads += 1;
      if (runtimeLengthReads > 2) throw new Error('browser runtime length read repeatedly');
      return window.localStorage.length;
    },
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => window.localStorage.removeItem(key),
    key: (index: number) => window.localStorage.key(index),
    clear: () => window.localStorage.clear()
  };
  const boundedStore = localStorage({
    namespace: `bounded-iteration-${Math.random().toString(36).slice(2)}`,
    storage: boundedStorage
  });
  await boundedStore.set('key', 'value');
  if (!(await boundedStore.keys()).includes('key')) throw new Error('bounded scan missed key');
  await boundedStore.remove('key');
  const physicalClearNamespace = `physical-clear-${Math.random().toString(36).slice(2)}`;
  const physicalClearStore = localStorage({
    namespace: physicalClearNamespace,
    namespaceCodec: {
      encode: (namespace: string, key: string) => `${namespace}:wire:${key.toLowerCase()}`,
      decode: (namespace: string, physicalKey: string) => {
        const prefix = `${namespace}:wire:`;
        return physicalKey.startsWith(prefix)
          ? physicalKey.slice(prefix.length).toUpperCase()
          : undefined;
      }
    }
  });
  await physicalClearStore.set('mixed', 'value');
  await physicalClearStore.clearValues();
  const codecPhysicalClear =
    window.localStorage.getItem(`${physicalClearNamespace}:wire:mixed`) === null;
  let partialRemovals = 0;
  const partialStorage = {
    get length() {
      return window.localStorage.length;
    },
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => {
      partialRemovals += 1;
      if (partialRemovals === 2) throw new Error('browser hostile second storage removal');
      window.localStorage.removeItem(key);
    },
    key: (index: number) =>
      Array.from({ length: window.localStorage.length }, (_, keyIndex) =>
        window.localStorage.key(keyIndex)
      )
        .filter((key): key is string => key !== null)
        .sort()[index] ?? null,
    clear: () => window.localStorage.clear()
  };
  const partialClearStore = localStorage({
    namespace: `partial-clear-${Math.random().toString(36).slice(2)}`,
    storage: partialStorage
  });
  await partialClearStore.set('first', 'one');
  await partialClearStore.set('second', 'two');
  partialRemovals = 0;
  let partialClearCode: string | undefined;
  let partialClearOperation: string | undefined;
  let partialClearKey: unknown;
  try {
    await partialClearStore.clearAll();
  } catch (error) {
    const typed = error as { code?: string; operation?: string; key?: unknown };
    partialClearCode = typed.code;
    partialClearOperation = typed.operation;
    partialClearKey = typed.key;
  }
  let snapshotLengthReads = 0;
  const snapshotFailureStore = localStorage({
    namespace: `snapshot-failure-${Math.random().toString(36).slice(2)}`,
    storage: {
      get length(): number {
        snapshotLengthReads += 1;
        if (snapshotLengthReads > 1) throw new Error('browser hostile clear snapshot');
        return window.localStorage.length;
      },
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
      removeItem: (key: string) => window.localStorage.removeItem(key),
      key: (index: number) => window.localStorage.key(index),
      clear: () => window.localStorage.clear()
    }
  });
  let snapshotClearCode: string | undefined;
  let snapshotClearOperation: string | undefined;
  try {
    await snapshotFailureStore.clearAll();
  } catch (error) {
    const typed = error as { code?: string; operation?: string };
    snapshotClearCode = typed.code;
    snapshotClearOperation = typed.operation;
  }
  const reentrantController = new AbortController();
  let reentrantArmed = false;
  const reentrantStorage = {
    get length() {
      return window.localStorage.length;
    },
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
    removeItem: (key: string) => {
      window.localStorage.removeItem(key);
      if (reentrantArmed) reentrantController.abort(new Error('browser reentrant clear abort'));
    },
    key: (index: number) =>
      Array.from({ length: window.localStorage.length }, (_, keyIndex) =>
        window.localStorage.key(keyIndex)
      )
        .filter((key): key is string => key !== null)
        .sort()[index] ?? null,
    clear: () => window.localStorage.clear()
  };
  const reentrantStore = localStorage({
    namespace: `reentrant-clear-${Math.random().toString(36).slice(2)}`,
    storage: reentrantStorage
  });
  await reentrantStore.set('first', 'one');
  await reentrantStore.set('second', 'two');
  reentrantArmed = true;
  let reentrantAbortCode: string | undefined;
  let reentrantAbortOperation: string | undefined;
  let reentrantAbortKey: unknown;
  try {
    await reentrantStore.clearAll({ signal: reentrantController.signal });
  } catch (error) {
    const typed = error as { code?: string; operation?: string; key?: unknown };
    reentrantAbortCode = typed.code;
    reentrantAbortOperation = typed.operation;
    reentrantAbortKey = typed.key;
  }
  const reentrantRemainingKeys = await reentrantStore.keys();
  const reentrantAbortKeyMatchesRemaining =
    reentrantRemainingKeys.length === 1 && reentrantRemainingKeys[0] === reentrantAbortKey;
  const incoherentNamespace = `incoherent-clear-${Math.random().toString(36).slice(2)}`;
  const incoherentStore = localStorage({
    namespace: incoherentNamespace,
    storage: {
      get length() {
        return window.localStorage.length;
      },
      getItem: (key: string) => window.localStorage.getItem(key),
      setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
      removeItem: (key: string) => window.localStorage.removeItem(key),
      key: () => window.localStorage.key(0),
      clear: () => window.localStorage.clear()
    }
  });
  await incoherentStore.set('first', 'one');
  await incoherentStore.set('second', 'two');
  let incoherentClearCode: string | undefined;
  let incoherentClearOperation: string | undefined;
  try {
    await incoherentStore.clearAll();
  } catch (error) {
    const typed = error as { code?: string; operation?: string };
    incoherentClearCode = typed.code;
    incoherentClearOperation = typed.operation;
  }
  const incoherentClearPreservedValues =
    (await incoherentStore.get('first')) === 'one' &&
    (await incoherentStore.get('second')) === 'two';
  const failure = new Error('browser storage security failure');
  const storage = {
    length: 0,
    getItem: () => {
      throw failure;
    },
    setItem: () => {},
    removeItem: () => {},
    key: () => null,
    clear: () => {}
  };
  let invalidStorageCode: string | undefined;
  try {
    localStorage({ namespace: 'invalid-storage', storage: {} as never });
  } catch (error) {
    invalidStorageCode = (error as { code?: string }).code;
  }
  let invalidLengthCode: string | undefined;
  try {
    localStorage({
      namespace: 'invalid-length',
      storage: {
        length: NaN,
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        key: () => null,
        clear: () => {}
      } as never
    });
  } catch (error) {
    invalidLengthCode = (error as { code?: string }).code;
  }
  try {
    localStorage({ namespace: `failure-${Math.random().toString(36).slice(2)}`, storage });
    return {
      code: undefined,
      hasCause: false,
      invalidStorageCode,
      invalidLengthCode,
      constructorOptionReads,
      optionGetterCode,
      storageLengthReads,
      storageGetterCode,
      namespaceCodecReads,
      runtimeLengthReads,
      codecPhysicalClear,
      partialClearCode,
      partialClearOperation,
      partialClearKey,
      snapshotClearCode,
      snapshotClearOperation,
      reentrantAbortCode,
      reentrantAbortOperation,
      reentrantAbortKeyMatchesRemaining,
      incoherentClearCode,
      incoherentClearOperation,
      incoherentClearPreservedValues
    };
  } catch (error) {
    const typed = error as { code?: string; cause?: unknown };
    return {
      code: typed.code,
      hasCause: typed.cause === failure,
      invalidStorageCode,
      invalidLengthCode,
      constructorOptionReads,
      optionGetterCode,
      storageLengthReads,
      storageGetterCode,
      namespaceCodecReads,
      runtimeLengthReads,
      codecPhysicalClear,
      partialClearCode,
      partialClearOperation,
      partialClearKey,
      snapshotClearCode,
      snapshotClearOperation,
      reentrantAbortCode,
      reentrantAbortOperation,
      reentrantAbortKeyMatchesRemaining,
      incoherentClearCode,
      incoherentClearOperation,
      incoherentClearPreservedValues
    };
  }
};

/**
 * Secure cookie 只能在 https 上下文里被写入/可见；e2e 跑在 http://127.0.0.1， 这正是"jsdom 不强制这个约束"必须用真实浏览器验证的场景（SDD
 * §12.4）。
 */
window.runCookieSecureScenario = async () => {
  const namespace = `secure-${Math.random().toString(36).slice(2)}`;
  const insecureStore = cookies({ namespace });
  await insecureStore.set('insecure-cookie', 'v1');
  const insecureVisible = (await insecureStore.get('insecure-cookie')) === 'v1';

  const secureStore = cookies({ namespace, scope: { path: '/', secure: true } });
  let secureVisible = false;
  try {
    await secureStore.set('secure-cookie', 'v2');
    secureVisible = (await secureStore.get('secure-cookie')) === 'v2';
  } catch (error) {
    if ((error as { code?: string }).code !== 'WRITE_FAILED') throw error;
  }

  await insecureStore.clearAll();
  await secureStore.clearAll();
  return { insecureVisible, secureVisible };
};

/** 真实浏览器对单条 cookie ~4KB 的硬限制；超过后浏览器直接不写入或截断。 */
window.runCookieSizeLimitScenario = async () => {
  const store = cookies({ namespace: `size-${Math.random().toString(36).slice(2)}` });
  try {
    await store.set('big', 'x'.repeat(5000));
    return { code: undefined };
  } catch (error) {
    return { code: (error as { code?: string }).code };
  } finally {
    await store.clearAll();
  }
};

/** Verify that two browser-native path scopes with one name are never collapsed to one value. */
window.runCookieDuplicateScopeScenario = async () => {
  const namespace = `duplicate-scope-${Math.random().toString(36).slice(2)}`;
  const physicalKey = `${namespace}:key`;
  const encodedKey = encodeURIComponent(physicalKey);
  document.cookie = `${encodedKey}=root; path=/`;
  document.cookie = `${encodedKey}=nested; path=/nested`;
  const duplicateVisible =
    document.cookie
      .split(';')
      .map((pair) => decodeURIComponent(pair.slice(0, pair.indexOf('=')).trim()))
      .filter((name) => name === physicalKey).length === 2;
  const store = cookies({
    namespace,
    scope: { path: '/nested' },
    namespaceCodec: {
      encode: (currentNamespace: string, key: string) => `${currentNamespace}:${key}`,
      decode: (currentNamespace: string, candidate: string) =>
        candidate.startsWith(`${currentNamespace}:`)
          ? candidate.slice(currentNamespace.length + 1)
          : undefined
    }
  });
  const operations = [
    () => store.get('key'),
    () => store.has('key'),
    () => store.remove('key'),
    () => store.keys(),
    () => store.clearValues(),
    () => store.clearAll(),
    () => store.set('key', 'new')
  ];
  const codes: Array<string | undefined> = [];
  try {
    for (const operation of operations) {
      try {
        await operation();
        codes.push(undefined);
      } catch (error) {
        codes.push((error as { code?: string }).code);
      }
    }
    return { codes, duplicateVisible };
  } finally {
    document.cookie = `${encodedKey}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/nested`;
    document.cookie = `${encodedKey}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

/** 真实浏览器验证 cookie scope 数组不会被当作合法 scope 配置。 */
window.runCookieScopeGuardScenario = async () => {
  let constructorOptionReads = 0;
  let scopeReads = 0;
  const constructorStore = cookies({
    get namespace() {
      constructorOptionReads += 1;
      return `constructor-${Math.random().toString(36).slice(2)}`;
    },
    get namespaceCodec() {
      constructorOptionReads += 1;
      return undefined;
    },
    get scope() {
      constructorOptionReads += 1;
      return {
        get path() {
          scopeReads += 1;
          return '/';
        },
        get domain() {
          scopeReads += 1;
          return undefined;
        },
        get sameSite() {
          scopeReads += 1;
          return 'lax' as const;
        },
        get secure() {
          scopeReads += 1;
          return false;
        },
        get partitioned() {
          scopeReads += 1;
          return false;
        }
      };
    },
    get document() {
      constructorOptionReads += 1;
      return document;
    }
  });
  await constructorStore.set('snapshot', 'value');
  let removeContextReads = 0;
  const removeController = new AbortController();
  await constructorStore.remove('snapshot', {
    get signal() {
      removeContextReads += 1;
      return removeController.signal;
    },
    get timeoutMs() {
      removeContextReads += 1;
      return undefined;
    }
  });
  let scopeCode: string | undefined;
  try {
    cookies({ namespace: `scope-${Math.random().toString(36).slice(2)}`, scope: [] as never });
  } catch (error) {
    scopeCode = (error as { code?: string }).code;
  }
  let codecCode: string | undefined;
  try {
    cookies({
      namespace: `codec-${Math.random().toString(36).slice(2)}`,
      namespaceCodec: [] as never
    });
  } catch (error) {
    codecCode = (error as { code?: string }).code;
  }
  let documentCode: string | undefined;
  try {
    cookies({
      namespace: `document-${Math.random().toString(36).slice(2)}`,
      document: [] as never
    });
  } catch (error) {
    documentCode = (error as { code?: string }).code;
  }
  let optionsCode: string | undefined;
  try {
    cookies(null as never);
  } catch (error) {
    optionsCode = (error as { code?: string }).code;
  }
  let expiresCode: string | undefined;
  try {
    await cookies({ namespace: `expires-${Math.random().toString(36).slice(2)}` }).set(
      'key',
      'value',
      { expires: 'date' as never }
    );
  } catch (error) {
    expiresCode = (error as { code?: string }).code;
  }
  try {
    await cookies({ namespace: `expires-number-${Math.random().toString(36).slice(2)}` }).set(
      'key',
      'value',
      { expires: { getTime: () => Infinity } as never }
    );
  } catch (error) {
    if ((error as { code?: string }).code !== 'INVALID_CONFIG') throw error;
  }
  let maxAgeCode: string | undefined;
  try {
    await cookies({ namespace: `max-age-${Math.random().toString(36).slice(2)}` }).set(
      'key',
      'value',
      { maxAge: Number.MAX_SAFE_INTEGER + 1 }
    );
  } catch (error) {
    maxAgeCode = (error as { code?: string }).code;
  }
  let expiresReads = 0;
  const snapshotStore = cookies({
    namespace: `expires-snapshot-${Math.random().toString(36).slice(2)}`
  });
  await snapshotStore.set('key', 'value', {
    expires: {
      getTime: () => {
        expiresReads += 1;
        if (expiresReads > 1) throw new Error('expires read twice');
        return Date.now() + 60_000;
      }
    } as never
  });
  let documentReadCode: string | undefined;
  let hostileDocumentReads = 0;
  const readFailureStore = cookies({
    namespace: 'document-read-failure',
    document: {
      get cookie() {
        hostileDocumentReads += 1;
        if (hostileDocumentReads > 1) throw new Error('browser cookie getter failure');
        return '';
      },
      set cookie(_value: string) {}
    }
  });
  try {
    await readFailureStore.get('key');
  } catch (error) {
    documentReadCode = (error as { code?: string }).code;
  }
  let documentTypeDriftCode: string | undefined;
  let driftingDocumentReads = 0;
  const typeDriftStore = cookies({
    namespace: 'document-type-drift',
    document: {
      get cookie(): string {
        driftingDocumentReads += 1;
        return (driftingDocumentReads === 1 ? '' : 42) as never;
      },
      set cookie(_value: string) {}
    }
  });
  try {
    await typeDriftStore.get('key');
  } catch (error) {
    documentTypeDriftCode = (error as { code?: string }).code;
  }
  let documentWriteCode: string | undefined;
  const writeFailureStore = cookies({
    namespace: 'document-write-failure',
    document: {
      get cookie() {
        return '';
      },
      set cookie(_value: string) {
        throw new Error('browser cookie setter failure');
      }
    }
  });
  try {
    await writeFailureStore.set('key', 'value');
  } catch (error) {
    documentWriteCode = (error as { code?: string }).code;
  }
  let cookieRemovalCount = 0;
  const partialCookieDocument = {
    get cookie(): string {
      return document.cookie;
    },
    set cookie(value: string) {
      if (value.toLowerCase().includes('expires=thu, 01 jan 1970')) {
        cookieRemovalCount += 1;
        if (cookieRemovalCount === 2) throw new Error('browser hostile second cookie removal');
      }
      document.cookie = value;
    }
  };
  const partialCookieStore = cookies({
    namespace: `partial-cookie-${Math.random().toString(36).slice(2)}`,
    document: partialCookieDocument
  });
  await partialCookieStore.set('first', 'one');
  await partialCookieStore.set('second', 'two');
  let partialClearCode: string | undefined;
  let partialClearOperation: string | undefined;
  let partialClearKey: unknown;
  try {
    await partialCookieStore.clearAll();
  } catch (error) {
    const typed = error as { code?: string; operation?: string; key?: unknown };
    partialClearCode = typed.code;
    partialClearOperation = typed.operation;
    partialClearKey = typed.key;
  }
  let snapshotCookieReads = 0;
  const snapshotFailureStore = cookies({
    namespace: `snapshot-cookie-${Math.random().toString(36).slice(2)}`,
    document: {
      get cookie(): string {
        snapshotCookieReads += 1;
        if (snapshotCookieReads > 1) throw new Error('browser hostile cookie clear snapshot');
        return '';
      },
      set cookie(_value: string) {}
    }
  });
  let snapshotClearCode: string | undefined;
  let snapshotClearOperation: string | undefined;
  try {
    await snapshotFailureStore.clearAll();
  } catch (error) {
    const typed = error as { code?: string; operation?: string };
    snapshotClearCode = typed.code;
    snapshotClearOperation = typed.operation;
  }
  const reentrantController = new AbortController();
  let reentrantArmed = false;
  const reentrantStore = cookies({
    namespace: `reentrant-cookie-${Math.random().toString(36).slice(2)}`,
    document: {
      get cookie(): string {
        return document.cookie;
      },
      set cookie(value: string) {
        document.cookie = value;
        if (reentrantArmed && value.toLowerCase().includes('expires=thu, 01 jan 1970'))
          reentrantController.abort(new Error('browser reentrant cookie abort'));
      }
    }
  });
  await reentrantStore.set('first', 'one');
  await reentrantStore.set('second', 'two');
  reentrantArmed = true;
  let reentrantAbortCode: string | undefined;
  let reentrantAbortOperation: string | undefined;
  let reentrantAbortKey: unknown;
  try {
    await reentrantStore.clearAll({ signal: reentrantController.signal });
  } catch (error) {
    const typed = error as { code?: string; operation?: string; key?: unknown };
    reentrantAbortCode = typed.code;
    reentrantAbortOperation = typed.operation;
    reentrantAbortKey = typed.key;
  }
  const reentrantRemainingKeys = await reentrantStore.keys();
  const reentrantAbortKeyMatchesRemaining =
    reentrantRemainingKeys.length === 1 && reentrantRemainingKeys[0] === reentrantAbortKey;
  let syncRemoveOverrideReads = 0;
  const syncRemoveStore = cookies({
    namespace: `sync-remove-${Math.random().toString(36).slice(2)}`,
    scope: { path: '/' }
  });
  await syncRemoveStore.set('key', 'value');
  (syncRemoveStore.sync!.remove as (key: string, context: unknown) => void)('key', {
    get path(): never {
      syncRemoveOverrideReads += 1;
      throw new Error('browser sync remove read runtime scope');
    }
  });
  if ((await syncRemoveStore.get('key')) !== null)
    throw new Error('sync remove did not use fixed scope');
  let writeContextReads = 0;
  const writeContextStore = cookies({
    namespace: `write-context-${Math.random().toString(36).slice(2)}`
  });
  await writeContextStore.set('key', 'value', {
    get signal() {
      writeContextReads += 1;
      return undefined;
    },
    get timeoutMs() {
      writeContextReads += 1;
      return undefined;
    },
    get expires() {
      writeContextReads += 1;
      return undefined;
    },
    get maxAge() {
      writeContextReads += 1;
      return undefined;
    }
  });
  let writeContextReturnedPromise = false;
  let writeContextGetterCode: string | undefined;
  try {
    const operation = writeContextStore.set('hostile', 'value', {
      get expires(): never {
        throw new Error('browser hostile expires getter');
      }
    });
    writeContextReturnedPromise = operation instanceof Promise;
    await operation;
  } catch (error) {
    writeContextGetterCode = (error as { code?: string }).code;
  }
  let writeLifecycleMetadata = false;
  try {
    await writeContextStore.set('lifecycle-hostile', 'value', {
      get signal(): never {
        throw new Error('browser hostile signal getter');
      }
    });
  } catch (error) {
    const storageError = error as {
      code?: string;
      backend?: string;
      operation?: string;
      key?: string;
      cause?: unknown;
    };
    writeLifecycleMetadata =
      storageError.code === 'INVALID_ARGUMENT' &&
      storageError.cause instanceof Error &&
      storageError.cause.message === 'browser hostile signal getter';
  }
  let removeLifecycleMetadata = false;
  try {
    await writeContextStore.remove('remove-hostile', {
      get timeoutMs(): never {
        throw new Error('browser hostile remove timeout getter');
      }
    });
  } catch (error) {
    const storageError = error as {
      code?: string;
      backend?: string;
      operation?: string;
      key?: string;
      cause?: unknown;
    };
    removeLifecycleMetadata =
      storageError.code === 'INVALID_ARGUMENT' &&
      storageError.cause instanceof Error &&
      storageError.cause.message === 'browser hostile remove timeout getter';
  }
  await writeContextStore.clearValues();
  return {
    scopeCode,
    codecCode,
    documentCode,
    optionsCode,
    expiresCode,
    maxAgeCode,
    expiresReads,
    snapshotValue: await snapshotStore.get('key'),
    constructorOptionReads,
    scopeReads,
    removeContextReads,
    documentReadCode,
    documentTypeDriftCode,
    documentWriteCode,
    partialClearCode,
    partialClearOperation,
    partialClearKey,
    snapshotClearCode,
    snapshotClearOperation,
    reentrantAbortCode,
    reentrantAbortOperation,
    reentrantAbortKeyMatchesRemaining,
    syncRemoveOverrideReads,
    writeContextReads,
    writeContextReturnedPromise,
    writeContextGetterCode,
    writeLifecycleMetadata,
    removeLifecycleMetadata
  };
};

/**
 * Onblocked 场景：连接 A 先打开并保持存活；随后用一个只声明了 kv store 的旧版 db（version 1）状态，让 storage-web 的自动版本升级路径尝试
 * open(dbName, 2) 时被 A 阻塞。A 关闭后，被阻塞的 open 请求应该继续完成。
 */
window.runIndexedDbBlockedScenario = async () => {
  const dbName = `blocked-${Math.random().toString(36).slice(2)}`;
  const factory = window.indexedDB;

  // 手工创建只有 kv store 的旧版数据库（模拟旧版本 schema）。
  const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  let blockedErrorCode: string | undefined;
  const store = indexedDb({ factory, dbName });
  const openAttempt = store.get('k').catch((error: { code?: string }) => {
    blockedErrorCode = error.code;
  });

  // 给被阻塞的 open 一点时间真正进入 blocked 状态，再关闭旧连接放行。
  await new Promise((resolve) => setTimeout(resolve, 200));
  legacyDb.close();
  await openAttempt;

  // 旧连接关闭后，失败的 open 请求本身仍以 BACKEND_UNAVAILABLE 结束；
  // 但实现会清空 connection cache，因此同一 store 实例的后续操作可以重新 open。
  let sameStoreRetrySucceeded = false;
  try {
    await store.set('k', 'same-store-retry');
    sameStoreRetrySucceeded = (await store.get('k')) === 'same-store-retry';
  } catch {
    sameStoreRetrySucceeded = false;
  }
  const retryStore = indexedDb({ factory, dbName });
  await retryStore.set('k', 'v');
  const secondOpenSucceededAfterClose = (await retryStore.get('k')) === 'v';

  const hostileDbName = `${dbName}-hostile-close`;
  const hostileStore = indexedDb({ factory, dbName: hostileDbName });
  await hostileStore.set('before', 'value');
  const currentDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(hostileDbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const hostileNextVersion = currentDatabase.version + 1;
  currentDatabase.close();
  const originalClose = IDBDatabase.prototype.close;
  let reportCloseAttempt!: (database: IDBDatabase) => void;
  const closeAttempted = new Promise<IDBDatabase>((resolve) => {
    reportCloseAttempt = resolve;
  });
  IDBDatabase.prototype.close = function (this: IDBDatabase): void {
    reportCloseAttempt(this);
    throw new Error('browser hostile versionchange close');
  };
  const hostileUpgrade = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(hostileDbName, hostileNextVersion);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let hostileCloseRetrySucceeded = false;
  try {
    const staleDatabase = await closeAttempted;
    IDBDatabase.prototype.close = originalClose;
    staleDatabase.close();
    const upgraded = await hostileUpgrade;
    upgraded.close();
    await hostileStore.set('after', 'reopened');
    hostileCloseRetrySucceeded = (await hostileStore.get('after')) === 'reopened';
  } finally {
    IDBDatabase.prototype.close = originalClose;
    await hostileStore.dispose();
    factory.deleteDatabase(hostileDbName);
  }

  const transitionDbName = `${dbName}-transition-close`;
  const transitionLegacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(transitionDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = transitionLegacy.transaction('kv', 'readwrite');
    transaction.objectStore('kv').put('legacy-value', 'legacy-key');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  transitionLegacy.close();
  const transitionStore = indexedDb({ factory, dbName: transitionDbName });
  let transitionCloseCode: string | undefined;
  let transitionCloseRetrySucceeded = false;
  IDBDatabase.prototype.close = () => {
    throw new Error('browser hostile transition close');
  };
  try {
    await transitionStore.get('legacy-key');
  } catch (error) {
    transitionCloseCode = (error as { code?: string }).code;
  } finally {
    IDBDatabase.prototype.close = originalClose;
  }
  try {
    transitionCloseRetrySucceeded = (await transitionStore.get('legacy-key')) === 'legacy-value';
  } finally {
    await transitionStore.dispose();
    factory.deleteDatabase(transitionDbName);
  }

  /** Attack one schema getter without modifying the browser's native IndexedDB prototype. */
  const runHostileSchemaInspection = async (
    property: 'objectStoreNames' | 'version'
  ): Promise<{ code: string | undefined; recovered: boolean }> => {
    const schemaDbName = `${dbName}-schema-${property}`;
    const emptyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(schemaDbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    emptyDatabase.close();
    let intercepted = false;
    const hostileFactory = {
      open: (name: string, version?: number) => {
        const nativeRequest =
          version === undefined ? factory.open(name) : factory.open(name, version);
        if (intercepted) return nativeRequest;
        intercepted = true;
        return {
          get result(): IDBDatabase {
            const database = nativeRequest.result;
            return new Proxy(database, {
              get: (target, key) => {
                if (key === property) throw new Error(`browser hostile database ${property}`);
                if (key === 'close') return () => target.close();
                return Reflect.get(target, key, target);
              }
            });
          },
          get transaction(): IDBTransaction | null {
            return nativeRequest.transaction;
          },
          get error(): DOMException | null {
            return nativeRequest.error;
          },
          set onupgradeneeded(handler: (() => void) | null) {
            nativeRequest.onupgradeneeded = () => handler?.();
          },
          set onblocked(handler: (() => void) | null) {
            nativeRequest.onblocked = () => handler?.();
          },
          set onerror(handler: (() => void) | null) {
            nativeRequest.onerror = () => handler?.();
          },
          set onsuccess(handler: (() => void) | null) {
            nativeRequest.onsuccess = () => handler?.();
          }
        } as unknown as IDBOpenDBRequest;
      }
    } as unknown as IDBFactory;
    const schemaStore = indexedDb({ factory: hostileFactory, dbName: schemaDbName });
    let code: string | undefined;
    try {
      await schemaStore.get('key');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    let recovered = false;
    try {
      await schemaStore.set('key', 'recovered');
      recovered = (await schemaStore.get('key')) === 'recovered';
    } finally {
      await schemaStore.dispose();
      factory.deleteDatabase(schemaDbName);
    }
    return { code, recovered };
  };
  const schemaObjectStores = await runHostileSchemaInspection('objectStoreNames');
  const schemaVersion = await runHostileSchemaInspection('version');
  const schemaInspectionCodes = [schemaObjectStores.code, schemaVersion.code];
  const schemaInspectionRecovered = schemaObjectStores.recovered && schemaVersion.recovered;

  /** Attack connection handler installation while preserving the native database internals. */
  const runHostileConnectionSetter = async (
    property: 'onversionchange' | 'onclose'
  ): Promise<{ code: string | undefined; recovered: boolean }> => {
    const connectionDbName = `${dbName}-connection-${property}`;
    const seedStore = indexedDb({ factory, dbName: connectionDbName });
    await seedStore.set('seed', 'value');
    await seedStore.dispose();
    let intercepted = false;
    const hostileFactory = {
      open: (name: string, version?: number) => {
        const nativeRequest =
          version === undefined ? factory.open(name) : factory.open(name, version);
        if (intercepted) return nativeRequest;
        intercepted = true;
        return {
          get result(): IDBDatabase {
            const database = nativeRequest.result;
            return new Proxy(database, {
              get: (target, key) => {
                if (key === 'close') return () => target.close();
                return Reflect.get(target, key, target);
              },
              set: (target, key, value) => {
                if (key === property) throw new Error(`browser hostile connection ${property}`);
                return Reflect.set(target, key, value, target);
              }
            });
          },
          get transaction(): IDBTransaction | null {
            return nativeRequest.transaction;
          },
          get error(): DOMException | null {
            return nativeRequest.error;
          },
          set onupgradeneeded(handler: (() => void) | null) {
            nativeRequest.onupgradeneeded = () => handler?.();
          },
          set onblocked(handler: (() => void) | null) {
            nativeRequest.onblocked = () => handler?.();
          },
          set onerror(handler: (() => void) | null) {
            nativeRequest.onerror = () => handler?.();
          },
          set onsuccess(handler: (() => void) | null) {
            nativeRequest.onsuccess = () => handler?.();
          }
        } as unknown as IDBOpenDBRequest;
      }
    } as unknown as IDBFactory;
    const connectionStore = indexedDb({ factory: hostileFactory, dbName: connectionDbName });
    let code: string | undefined;
    try {
      await connectionStore.get('seed');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    let recovered = false;
    try {
      recovered = (await connectionStore.get('seed')) === 'value';
    } finally {
      await connectionStore.dispose();
      factory.deleteDatabase(connectionDbName);
    }
    return { code, recovered };
  };
  const versionChangeSetter = await runHostileConnectionSetter('onversionchange');
  const closeSetter = await runHostileConnectionSetter('onclose');
  const connectionSetterCodes = [versionChangeSetter.code, closeSetter.code];
  const connectionSetterRecovered = versionChangeSetter.recovered && closeSetter.recovered;

  await store.dispose();
  await retryStore.dispose();
  factory.deleteDatabase(dbName);

  return {
    blockedErrorCode,
    secondOpenSucceededAfterClose,
    sameStoreRetrySucceeded,
    hostileCloseRetrySucceeded,
    transitionCloseCode,
    transitionCloseRetrySucceeded,
    schemaInspectionCodes,
    schemaInspectionRecovered,
    connectionSetterCodes,
    connectionSetterRecovered
  };
};

window.runIndexedDbTransactionConflictScenario = async () => {
  const dbName = `conflict-${Math.random().toString(36).slice(2)}`;
  const first = indexedDb({ dbName });
  const second = indexedDb({ dbName });
  await first.putRecord({ value: 0 }, 'revision-key');
  let code: string | undefined;
  try {
    await first.transaction(async (tx) => {
      await tx.get('revision-key');
      await second.putRecord({ value: 2 }, 'revision-key', { conflictPolicy: 'replace' });
      await tx.put({ value: 1 }, 'revision-key');
    });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await second.getRecord('revision-key');
  await first.dispose();
  await second.dispose();
  return { code, value };
};

/** 真实浏览器验证 transaction scope 在 callback 结束后不会静默读写。 */
window.runIndexedDbEscapedTransactionScopeScenario = async () => {
  const dbName = `escaped-scope-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  let escaped:
    | {
        get(key: string): Promise<unknown>;
        put(value: unknown, key: string): Promise<unknown>;
        delete(key: string): Promise<void>;
      }
    | undefined;
  await store.transaction(async (tx) => {
    escaped = tx;
    await tx.put({ inside: true }, 'inside');
  });

  const codeOf = async (run: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await run();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  };
  const getCode = await codeOf(() => escaped!.get('inside'));
  const putCode = await codeOf(() => escaped!.put({ outside: true }, 'outside'));
  const deleteCode = await codeOf(() => escaped!.delete('inside'));
  const outsideValue = await store.getRecord('outside');
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { getCode, putCode, deleteCode, outsideValue };
};

/** 真实浏览器验证 destructive clear 在取消后不提交部分清理。 */
window.runIndexedDbClearAbortScenario = async () => {
  const dbName = `clear-abort-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  await store.set('all-value', 'keep');
  await store.putRecord({ keep: true }, 'all-record');

  const recordsController = new AbortController();
  recordsController.abort('cancel records clear');
  let recordsCode: string | undefined;
  try {
    await store.clearRecords({ signal: recordsController.signal });
  } catch (error) {
    recordsCode = (error as { code?: string }).code;
  }
  const recordsValue = await store.getRecord('all-record');

  const allController = new AbortController();
  allController.abort('cancel all clear');
  let allCode: string | undefined;
  try {
    await store.clearAll({ signal: allController.signal });
  } catch (error) {
    allCode = (error as { code?: string }).code;
  }
  const allValue = await store.get('all-value');
  const allRecord = await store.getRecord('all-record');
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { recordsCode, recordsValue, allCode, allValue, allRecord };
};

/** 真实浏览器验证 deleteRecord 在 revision request 期间取消不会落盘删除。 */
window.runIndexedDbDeleteAbortScenario = async () => {
  const dbName = `delete-abort-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  await store.putRecord({ keep: true }, 'delete-me');
  const controller = new AbortController();
  const pending = store.deleteRecord('delete-me', { signal: controller.signal });
  await Promise.resolve();
  controller.abort('cancel delete');
  let code: string | undefined;
  try {
    await pending;
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await store.getRecord('delete-me');
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, value };
};

/** 真实浏览器验证 putRecord 的 request 失败/取消不会提交部分写入。 */
window.runIndexedDbPutAbortScenario = async () => {
  const dbName = `put-abort-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  await store.putRecord({ warm: true }, 'warm');
  const controller = new AbortController();
  const pending = store.putRecord({ keep: true }, 'put-me', {
    signal: controller.signal
  });
  await Promise.resolve();
  controller.abort('cancel put');
  let code: string | undefined;
  try {
    await pending;
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await store.getRecord('put-me');
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, value };
};

/** 真实浏览器验证 entity migrate 的分批 transaction 与 legacy 清理语义。 */
window.runIndexedDbEntityMigrationScenario = async () => {
  const dbName = `entity-migrate-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const entity = defineEntity<{ id: string; displayName: string }>({
    name: 'browser-migrate',
    key: 'id',
    version: 2,
    migrations: {
      2: async (value: unknown) => {
        const input = value as { id: string; name: string };
        return { id: input.id, displayName: input.name };
      }
    }
  });
  await store.putRecord({ __v: 1, data: { id: 'a', name: 'Ada' } }, ['browser-migrate', 'a']);
  const result = await entity.connect(store).migrate({ batchSize: 1 });
  const value = await entity.connect(store).get('a');
  const legacyValue = await store.getRecord(['browser-migrate', 'a']);
  let invalidBatchCode: string | undefined;
  try {
    await entity.connect(store).migrate({ batchSize: null as never });
  } catch (error) {
    invalidBatchCode = (error as { code?: string }).code;
  }
  const invalidOptionsCodes: Array<string | undefined> = [];
  for (const options of [null, [], 'options', 1]) {
    try {
      await entity.connect(store).migrate(options as never);
    } catch (error) {
      invalidOptionsCodes.push((error as { code?: string }).code);
    }
  }
  try {
    await entity.connect(store).migrate({ batchSize: Number.MAX_SAFE_INTEGER + 1 });
  } catch (error) {
    invalidOptionsCodes.push((error as { code?: string }).code);
  }
  const invalidBatchCallbackCodes: Array<string | undefined> = [];
  for (const callback of [null, undefined, {}, 'run']) {
    try {
      await entity.connect(store).batch(callback as never);
    } catch (error) {
      invalidBatchCallbackCodes.push((error as { code?: string }).code);
    }
  }
  let migrationOptionReads = 0;
  await entity.connect(store).migrate({
    get batchSize() {
      migrationOptionReads += 1;
      if (migrationOptionReads > 1) throw new Error('batchSize read twice');
      return 1;
    }
  });
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return {
    result,
    value,
    legacyValue,
    invalidBatchCode,
    invalidOptionsCodes,
    invalidBatchCallbackCodes,
    migrationOptionReads
  };
};

/** 真实浏览器验证两个连接并发执行 entity migrate 后不会留下重复 legacy 数据。 */
window.runIndexedDbConcurrentEntityMigrationScenario = async () => {
  const dbName = `entity-migrate-concurrent-${Math.random().toString(36).slice(2)}`;
  const seed = indexedDb({ dbName });
  await seed.putRecord({ __v: 1, data: { id: 'a', name: 'Ada' } }, [
    'browser-concurrent-migrate',
    'a'
  ]);
  await seed.putRecord({ __v: 1, data: { id: 'b', name: 'Bob' } }, [
    'browser-concurrent-migrate',
    'b'
  ]);
  const first = indexedDb({ dbName });
  const second = indexedDb({ dbName });
  const createEntity = () =>
    defineEntity<{ id: string; displayName: string }>({
      name: 'browser-concurrent-migrate',
      key: 'id',
      version: 2,
      migrations: {
        2: async (value: unknown) => {
          const input = value as { id: string; name: string };
          return { id: input.id, displayName: input.name };
        }
      }
    });
  const [firstResult, secondResult] = await Promise.all([
    createEntity().connect(first).migrate({ batchSize: 1 }),
    createEntity().connect(second).migrate({ batchSize: 1 })
  ]);
  const values = await Promise.all([
    createEntity().connect(first).get('a'),
    createEntity().connect(first).get('b')
  ]);
  const legacyValues = await Promise.all([
    first.getRecord(['browser-concurrent-migrate', 'a']),
    first.getRecord(['browser-concurrent-migrate', 'b'])
  ]);
  await seed.dispose();
  await first.dispose();
  await second.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { results: [firstResult, secondResult], values, legacyValues };
};

/** 真实浏览器验证 iframe realm 的 Date/ArrayBuffer/复合 key 可被 IndexedDB 正确编码和读取。 */
window.runIndexedDbCrossRealmKeyScenario = async () => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow!;
  const realm = frameWindow as unknown as {
    Date: typeof Date;
    ArrayBuffer: typeof ArrayBuffer;
    Uint8Array: typeof Uint8Array;
  };
  const dbName = `cross-realm-key-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const dateKey = new realm.Date('2025-01-02T03:04:05.000Z');
  const bytesKey = new realm.ArrayBuffer(3);
  new realm.Uint8Array(bytesKey).set([7, 8, 9]);
  const compoundKey = [dateKey, bytesKey] as const;
  await store.putRecord({ kind: 'date' }, dateKey);
  await store.putRecord({ kind: 'bytes' }, bytesKey);
  await store.putRecord({ kind: 'compound' }, compoundKey);
  const dateValue = await store.getRecord(dateKey);
  const bytesValue = await store.getRecord(bytesKey);
  const compoundValue = await store.getRecord(compoundKey);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  frame.remove();
  return { dateValue, bytesValue, compoundValue };
};

/** 真实浏览器验证 Memory 对复合 record key 的输入与输出所有权隔离。 */
window.runMemoryCompositeKeyOwnershipScenario = async () => {
  const store = memoryStorage<{ source: string }>();
  const directKey: Array<string | number> = ['direct', 1];
  const transactionKey: Array<string | number> = ['transaction', 1];
  await store.putRecord({ source: 'direct' }, directKey);
  directKey[1] = 9;
  await store.transaction(async (transaction) => {
    await transaction.put({ source: 'transaction' }, transactionKey);
    transactionKey[1] = 9;
  });

  const firstKeys: Array<unknown> = [];
  for await (const [key] of store.iterateRecords()) firstKeys.push(key);
  (firstKeys[0] as Array<unknown>)[1] = 7;
  const secondKeys: Array<unknown> = [];
  for await (const [key] of store.iterateRecords()) secondKeys.push(key);

  const directStable =
    (await store.getRecord(['direct', 1]))?.source === 'direct' &&
    (await store.getRecord(['direct', 9])) === undefined;
  const transactionStable =
    (await store.getRecord(['transaction', 1]))?.source === 'transaction' &&
    (await store.getRecord(['transaction', 9])) === undefined;
  const iterationStable =
    JSON.stringify(firstKeys) !== JSON.stringify(secondKeys) &&
    JSON.stringify(secondKeys) ===
      JSON.stringify([
        ['direct', 1],
        ['transaction', 1]
      ]);
  await store.dispose();

  const rangeStore = memoryStorage<{ value: number }>();
  await rangeStore.putRecord({ value: 1 }, ['range', 1]);
  await rangeStore.putRecord({ value: 2 }, ['range', 2]);
  await rangeStore.putRecord({ value: 3 }, ['range', 3]);
  const upper: Array<string | number> = ['range', 3];
  const iterator = rangeStore.iterateRecords({ upper });
  const first = await iterator.next();
  upper[1] = 1;
  const remaining: Array<number> = [];
  for await (const [, value] of iterator) remaining.push(value.value);
  const rangeStable = first.value?.[1].value === 1 && JSON.stringify(remaining) === '[2,3]';
  await rangeStore.dispose();
  return { directStable, transactionStable, iterationStable, rangeStable };
};

/** 真实浏览器验证 timeoutMs=0 与 dispose 的统一 operation lifecycle。 */
window.runOperationLifecycleScenario = async () => {
  const operationRuntime = createStorageOperationRuntime();
  const memory = (await import('../src/index')).memoryStorage();
  let contextSnapshotReads = 0;
  const contextController = new AbortController();
  await memory.set('context-snapshot', 'value', {
    get signal() {
      contextSnapshotReads += 1;
      return contextController.signal;
    },
    get timeoutMs() {
      contextSnapshotReads += 1;
      return undefined;
    },
    get pageSize() {
      contextSnapshotReads += 1;
      return 64;
    },
    get conflictPolicy() {
      contextSnapshotReads += 1;
      return 'replace' as const;
    }
  });
  let repositoryContextReads = 0;
  const lifecycleEntity = defineEntity<{ id: string }>({
    name: 'operation-lifecycle',
    key: 'id'
  });
  let signalSurfaceReads = 0;
  const stableSignal = {
    get aborted() {
      return false;
    },
    get addEventListener() {
      signalSurfaceReads += 1;
      if (signalSurfaceReads > 2) throw new Error('browser signal surface method read twice');
      return () => {};
    },
    get removeEventListener() {
      signalSurfaceReads += 1;
      if (signalSurfaceReads > 2) throw new Error('browser signal surface method read twice');
      return () => {};
    }
  } as never;
  const stableSnapshot = snapshotOperationContext({ signal: stableSignal });
  await withAbort(stableSnapshot, async () => undefined);
  await lifecycleEntity.connect(memory).put({ id: 'snapshot' }, {
    get signal() {
      repositoryContextReads += 1;
      return contextController.signal;
    },
    get timeoutMs() {
      repositoryContextReads += 1;
      return undefined;
    },
    get pageSize() {
      repositoryContextReads += 1;
      return 64;
    },
    get conflictPolicy() {
      repositoryContextReads += 1;
      return 'replace' as const;
    }
  } as never);
  let memoryTimeoutCode: string | undefined;
  try {
    await memory.set('timeout', 'no-write', { timeoutMs: 0 });
  } catch (error) {
    memoryTimeoutCode = (error as { code?: string }).code;
  }
  let invalidTimeoutCode: string | undefined;
  try {
    await memory.set('invalid-timeout', 'value', { timeoutMs: Number.MAX_SAFE_INTEGER + 1 });
  } catch (error) {
    invalidTimeoutCode = (error as { code?: string }).code;
  }
  const invalidContextCodes: Array<string | undefined> = [];
  for (const context of [null, [], 'context', 1]) {
    try {
      await memory.set('invalid-context', 'value', context as never);
    } catch (error) {
      invalidContextCodes.push((error as { code?: string }).code);
    }
  }
  let invalidSignalCode: string | undefined;
  try {
    await memory.set('invalid-signal', 'value', { signal: { aborted: false } as never });
  } catch (error) {
    invalidSignalCode = (error as { code?: string }).code;
  }
  let invalidSignalGetterCode: string | undefined;
  try {
    await memory.get('invalid-signal-getter', {
      signal: {
        get aborted(): never {
          throw new Error('browser hostile aborted getter');
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      } as never
    });
  } catch (error) {
    invalidSignalGetterCode = (error as { code?: string }).code;
  }
  let hostileReasonCode: string | undefined;
  let hostileReasonHasCause = false;
  try {
    await memory.get('hostile-reason', {
      signal: {
        aborted: true,
        get reason(): never {
          throw new Error('browser hostile reason getter');
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      } as never,
      timeoutMs: 1000
    });
  } catch (error) {
    hostileReasonCode = (error as { code?: string }).code;
    hostileReasonHasCause = (error as { cause?: unknown }).cause instanceof Error;
  }
  let listenerSetupCode: string | undefined;
  try {
    await memory.get('listener-setup', {
      signal: {
        aborted: false,
        addEventListener: () => {
          throw new Error('browser hostile listener setup');
        },
        removeEventListener: () => {}
      } as never,
      timeoutMs: 1000
    });
  } catch (error) {
    listenerSetupCode = (error as { code?: string }).code;
  }
  const cleanupPreservedResult = await memory.get('missing-cleanup', {
    signal: {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('browser hostile listener cleanup');
      }
    } as never,
    timeoutMs: 1000
  });
  let extensionListenerSetupCode: string | undefined;
  try {
    await lifecycleEntity.connect(memory).put(
      { id: 'extension-listener-setup' },
      {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('browser extension listener setup');
          },
          removeEventListener: () => {}
        } as never
      }
    );
  } catch (error) {
    extensionListenerSetupCode = (error as { code?: string }).code;
  }
  await lifecycleEntity.connect(memory).put(
    { id: 'extension-listener-cleanup' },
    {
      signal: {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {
          throw new Error('browser extension listener cleanup');
        }
      } as never
    }
  );
  const extensionCleanupPreserved =
    (await lifecycleEntity.connect(memory).get('extension-listener-cleanup'))?.id ===
    'extension-listener-cleanup';
  let migrationListenerSetupCode: string | undefined;
  try {
    await runMigrations({}, 0, 1, { 1: async () => ({ migrated: true }) }, {
      aborted: false,
      addEventListener: () => {
        throw new Error('browser migration listener setup');
      },
      removeEventListener: () => {}
    } as never);
  } catch (error) {
    migrationListenerSetupCode = (error as { code?: string }).code;
  }
  const migrationCleanupPreserved =
    (await runMigrations({}, 0, 1, { 1: async () => ({ migrated: true }) }, {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('browser migration listener cleanup');
      }
    } as never)) !== undefined;
  let raceAborted = false;
  let signalRaceCalls = 0;
  let signalRaceCode: string | undefined;
  try {
    await memory.transaction(
      async () => {
        signalRaceCalls += 1;
      },
      {
        timeoutMs: 1000,
        signal: {
          get aborted() {
            return raceAborted;
          },
          reason: 'race abort',
          addEventListener: () => {
            raceAborted = true;
          },
          removeEventListener: () => {}
        } as never
      }
    );
  } catch (error) {
    signalRaceCode = (error as { code?: string }).code;
  }
  const syncOptionCodes: Array<string | undefined> = [];
  const syncStores = [
    memory,
    localStorage({ namespace: `sync-options-${Math.random().toString(36).slice(2)}` }),
    cookies({ namespace: `sync-options-${Math.random().toString(36).slice(2)}` })
  ];
  for (const store of syncStores)
    for (const options of [{ conflictPolicy: 'invalid' }, { timeoutMs: 1 }]) {
      try {
        store.sync.set('sync-invalid', 'value', options as never);
      } catch (error) {
        syncOptionCodes.push((error as { code?: string }).code);
      }
    }
  const memoryValue = await memory.get('timeout');
  const dbName = `operation-lifecycle-${Math.random().toString(36).slice(2)}`;
  const database = indexedDb({ dbName });
  await database.putRecord({ keep: true }, 'keep');
  let indexedTimeoutCode: string | undefined;
  try {
    await database.iterateRecords(undefined, { timeoutMs: 0 }).next();
  } catch (error) {
    indexedTimeoutCode = (error as { code?: string }).code;
  }
  let indexedDynamicSignalCode: string | undefined;
  let indexedSignalReads = 0;
  try {
    await database.get('dynamic-signal', {
      signal: {
        get aborted() {
          indexedSignalReads += 1;
          if (indexedSignalReads > 1) throw new Error('browser dynamic aborted getter');
          return false;
        },
        addEventListener: () => {},
        removeEventListener: () => {}
      } as never
    });
  } catch (error) {
    indexedDynamicSignalCode = (error as { code?: string }).code;
  }
  await database.dispose();
  let disposedCode: string | undefined;
  try {
    await database.getRecord('keep');
  } catch (error) {
    disposedCode = (error as { code?: string }).code;
  }
  const requestDbName = `idb-request-race-${Math.random().toString(36).slice(2)}`;
  const requestDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(requestDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let requestAborted = false;
  let idbRequestContextReads = 0;
  let idbRequestRaceCode: string | undefined;
  try {
    await fromIdbRequest(
      requestDatabase.transaction('kv').objectStore('kv').get('missing'),
      {
        get signal() {
          idbRequestContextReads += 1;
          return {
            get aborted() {
              return requestAborted;
            },
            reason: 'browser request race',
            addEventListener: () => {
              requestAborted = true;
            },
            removeEventListener: () => {}
          } as never;
        }
      },
      operationRuntime
    );
  } catch (error) {
    idbRequestRaceCode = (error as { code?: string }).code;
  }
  let idbRequestSetupCode: string | undefined;
  try {
    await fromIdbRequest(
      requestDatabase.transaction('kv').objectStore('kv').get('missing'),
      {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('browser request listener setup');
          },
          removeEventListener: () => {}
        } as never
      },
      operationRuntime
    );
  } catch (error) {
    idbRequestSetupCode = (error as { code?: string }).code;
  }
  const idbRequestCleanupPreserved =
    (await fromIdbRequest(
      requestDatabase.transaction('kv').objectStore('kv').get('missing'),
      {
        signal: {
          aborted: false,
          addEventListener: () => {},
          removeEventListener: () => {
            throw new Error('browser request listener cleanup');
          }
        } as never
      },
      operationRuntime
    )) === undefined;
  let idbResultGetterCode: string | undefined;
  try {
    await fromIdbRequest(
      {
        get result(): never {
          throw new Error('browser hostile request result getter');
        },
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      } as unknown as IDBRequest<unknown>,
      undefined,
      operationRuntime
    );
  } catch (error) {
    idbResultGetterCode = (error as { code?: string }).code;
  }
  let idbErrorGetterCode: string | undefined;
  try {
    await fromIdbRequest(
      {
        get error(): never {
          throw new Error('browser hostile request error getter');
        },
        set onsuccess(_handler: unknown) {},
        set onerror(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        }
      } as unknown as IDBRequest<unknown>,
      undefined,
      operationRuntime
    );
  } catch (error) {
    idbErrorGetterCode = (error as { code?: string }).code;
  }
  const idbRequestSetterCodes: Array<string | undefined> = [];
  for (const property of ['onsuccess', 'onerror'] as const) {
    try {
      await fromIdbRequest(
        {
          set onsuccess(_handler: unknown) {
            if (property === 'onsuccess')
              throw new Error('browser hostile request onsuccess setter');
          },
          set onerror(_handler: unknown) {
            if (property === 'onerror') throw new Error('browser hostile request onerror setter');
          }
        } as unknown as IDBRequest<unknown>,
        undefined,
        operationRuntime
      );
      idbRequestSetterCodes.push(undefined);
    } catch (error) {
      idbRequestSetterCodes.push((error as { code?: string }).code);
    }
  }
  const idbTransactionSetterCodes: Array<string | undefined> = [];
  for (const property of ['oncomplete', 'onerror', 'onabort'] as const) {
    try {
      await idbTransactionCommit(
        {
          abort: () => {},
          set oncomplete(_handler: unknown) {
            if (property === 'oncomplete')
              throw new Error('browser hostile transaction oncomplete setter');
          },
          set onerror(_handler: unknown) {
            if (property === 'onerror')
              throw new Error('browser hostile transaction onerror setter');
          },
          set onabort(_handler: unknown) {
            if (property === 'onabort')
              throw new Error('browser hostile transaction onabort setter');
          }
        } as unknown as IDBTransaction,
        undefined,
        operationRuntime
      );
      idbTransactionSetterCodes.push(undefined);
    } catch (error) {
      idbTransactionSetterCodes.push((error as { code?: string }).code);
    }
  }
  const setupTransaction = requestDatabase.transaction('kv', 'readwrite');
  setupTransaction.objectStore('kv').put('must-rollback', 'setup-failure');
  let idbTransactionSetupCode: string | undefined;
  try {
    await idbTransactionCommit(
      setupTransaction,
      {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('browser hostile transaction listener setup');
          },
          removeEventListener: () => {}
        } as never
      },
      operationRuntime
    );
  } catch (error) {
    idbTransactionSetupCode = (error as { code?: string }).code;
  }
  const idbTransactionSetupRolledBack =
    (await fromIdbRequest(
      requestDatabase.transaction('kv').objectStore('kv').get('setup-failure'),
      undefined,
      operationRuntime
    )) === undefined;
  const destructiveDbName = `idb-destructive-setter-${Math.random().toString(36).slice(2)}`;
  const destructiveStore = indexedDb({ dbName: destructiveDbName });
  const idbDestructiveSetterCodes: Array<string | undefined> = [];
  let idbDestructiveSetterRolledBack = true;
  for (const operation of ['clearAll', 'deleteRecord', 'clearRecords'] as const) {
    const valueKey = `keep-value-${operation}`;
    const recordKey = `keep-record-${operation}`;
    await destructiveStore.set(valueKey, 'value');
    await destructiveStore.putRecord({ keep: true }, recordKey);
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = (() =>
      ({
        set onsuccess(_handler: unknown) {
          throw new Error(`browser hostile ${operation} revision handler setter`);
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalGet;
    try {
      const pending =
        operation === 'clearAll'
          ? destructiveStore.clearAll()
          : operation === 'deleteRecord'
            ? destructiveStore.deleteRecord(recordKey)
            : destructiveStore.clearRecords();
      await pending;
      idbDestructiveSetterCodes.push(undefined);
    } catch (error) {
      idbDestructiveSetterCodes.push((error as { code?: string }).code);
    } finally {
      IDBObjectStore.prototype.get = originalGet;
    }
    idbDestructiveSetterRolledBack &&=
      (await destructiveStore.get(valueKey)) === 'value' &&
      (await destructiveStore.getRecord(recordKey)) !== undefined;
  }
  await destructiveStore.dispose();
  window.indexedDB.deleteDatabase(destructiveDbName);
  requestDatabase.close();
  window.indexedDB.deleteDatabase(requestDbName);
  await memory.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return {
    memoryTimeoutCode,
    indexedTimeoutCode,
    indexedDynamicSignalCode,
    disposedCode,
    memoryValue,
    invalidTimeoutCode,
    invalidContextCodes,
    invalidSignalCode,
    invalidSignalGetterCode,
    hostileReasonCode,
    hostileReasonHasCause,
    listenerSetupCode,
    cleanupPreservedResult,
    extensionListenerSetupCode,
    extensionCleanupPreserved,
    migrationListenerSetupCode,
    migrationCleanupPreserved,
    signalRaceCode,
    signalRaceCalls,
    contextSnapshotReads,
    signalSurfaceReads,
    repositoryContextReads,
    idbRequestRaceCode,
    idbRequestContextReads,
    idbRequestSetupCode,
    idbRequestCleanupPreserved,
    idbResultGetterCode,
    idbErrorGetterCode,
    idbRequestSetterCodes,
    idbTransactionSetterCodes,
    idbTransactionSetupCode,
    idbTransactionSetupRolledBack,
    idbDestructiveSetterCodes,
    idbDestructiveSetterRolledBack,
    syncOptionCodes
  };
};

/** 真实浏览器验证 entity codec 异常不会提交半条 IndexedDB record。 */
window.runIndexedDbExtensionFailureScenario = async () => {
  const dbName = `extension-failure-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const entity = defineEntity<{ id: string; value: string }>({
    name: 'browser-extension-failure',
    key: 'id',
    codec: {
      name: 'throwing-browser-codec',
      output: 'structured',
      encode: async () => {
        throw new Error('codec encode failed');
      },
      decode: async (value: unknown) => value
    }
  });
  const repo = entity.connect(store);
  let code: string | undefined;
  try {
    await repo.put({ id: 'broken', value: 'value' });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await store.getRecord(['browser-extension-failure', 'broken']);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, value };
};

/** 真实浏览器验证旧 entity 客户端不会读取或覆盖未来版本 envelope。 */
window.runIndexedDbFutureVersionScenario = async () => {
  const dbName = `future-version-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  await store.putRecord({ __v: 2, data: { id: 'future', name: 'New' } }, [
    'browser-future-version',
    'future'
  ]);
  const repo = defineEntity<{ id: string; name: string }>({
    name: 'browser-future-version',
    key: 'id',
    version: 1
  }).connect(store);
  let getCode: string | undefined;
  try {
    await repo.get('future');
  } catch (error) {
    getCode = (error as { code?: string }).code;
  }
  const skippedCount = (await repo.list({ onInvalid: 'skip' })).length;
  let throwCode: string | undefined;
  try {
    await repo.list({ onInvalid: 'throw' });
  } catch (error) {
    throwCode = (error as { code?: string }).code;
  }
  let invalidHandlerCode: string | undefined;
  try {
    await repo.list({ onInvalid: () => 'invalid' as never });
  } catch (error) {
    invalidHandlerCode = (error as { code?: string }).code;
  }
  const rawValue = await store.getRecord(['browser-future-version', 'future']);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { getCode, skippedCount, throwCode, invalidHandlerCode, rawValue };
};

/** 真实浏览器验证 custom codec 永不 settle 时外部 abort 仍能结束等待。 */
window.runIndexedDbHangingExtensionAbortScenario = async () => {
  const dbName = `hanging-extension-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const entity = defineEntity<{ id: string; name: string }>({
    name: 'browser-hanging-extension',
    key: 'id',
    codec: {
      name: 'hanging-browser-codec',
      output: 'structured',
      encode: () => new Promise<unknown>(() => {}),
      decode: async (value: unknown) => value
    }
  });
  const controller = new AbortController();
  const pending = entity
    .connect(store)
    .put({ id: 'hanging', name: 'Ada' }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort('cancel hanging codec');
  let code: string | undefined;
  try {
    await pending;
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await store.getRecord(['browser-hanging-extension', 'hanging']);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, value };
};

/** 真实浏览器验证 hanging migration 在 abort 后结束等待且不改写 legacy envelope。 */
window.runIndexedDbHangingMigrationAbortScenario = async () => {
  const dbName = `hanging-migration-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  await store.putRecord({ __v: 1, data: { id: 'hanging', name: 'Ada' } }, [
    'browser-hanging-migration',
    'hanging'
  ]);
  const entity = defineEntity<{ id: string; displayName: string }>({
    name: 'browser-hanging-migration',
    key: 'id',
    version: 2,
    migrations: {
      2: async (_value: unknown, context) => {
        receivedSignal = context.signal === controller.signal;
        return new Promise<unknown>(() => {});
      }
    }
  });
  const controller = new AbortController();
  let receivedSignal = false;
  const pending = entity.connect(store).get('hanging', { signal: controller.signal });
  for (let attempt = 0; attempt < 100 && !receivedSignal; attempt += 1)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  if (!receivedSignal) throw new Error('migration callback did not start');
  controller.abort('cancel hanging migration');
  let code: string | undefined;
  try {
    await pending;
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const rawValue = await store.getRecord(['browser-hanging-migration', 'hanging']);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, rawValue, receivedSignal };
};

/** 真实浏览器验证 pre-abort 不会调用 custom codec。 */
window.runIndexedDbPreAbortExtensionScenario = async () => {
  const dbName = `pre-abort-extension-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  let calls = 0;
  const entity = defineEntity<{ id: string; name: string }>({
    name: 'browser-pre-abort-extension',
    key: 'id',
    codec: {
      name: 'browser-pre-abort-codec',
      output: 'structured',
      encode: async (value: unknown) => {
        calls += 1;
        return value;
      },
      decode: async (value: unknown) => value
    }
  });
  const controller = new AbortController();
  controller.abort('already cancelled');
  let code: string | undefined;
  try {
    await entity.connect(store).put({ id: 'u1', name: 'Ada' }, { signal: controller.signal });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, calls };
};

/** 真实浏览器验证 pre-abort migration 即使无需步骤也不会成功返回。 */
window.runIndexedDbPreAbortMigrationScenario = async () => {
  const dbName = `pre-abort-migration-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const entity = defineEntity<{ id: string; name: string }>({
    name: 'browser-pre-abort-migration',
    key: 'id',
    version: 1
  });
  const controller = new AbortController();
  controller.abort('already cancelled');
  let code: string | undefined;
  try {
    await entity.connect(store).get('missing', { signal: controller.signal });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code };
};

/** 真实浏览器验证 schema validation failure 不会留下 raw entity record。 */
window.runIndexedDbSchemaFailureScenario = async () => {
  const dbName = `schema-failure-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  const entity = defineEntity<{ id: string; name: string }>({
    name: 'browser-schema-failure',
    key: 'id',
    schema: {
      name: 'browser-schema',
      validate: async () => {
        throw new Error('schema validation failed');
      }
    }
  });
  let code: string | undefined;
  try {
    await entity.connect(store).put({ id: 'invalid', name: 'Ada' });
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  const value = await store.getRecord(['browser-schema-failure', 'invalid']);
  await store.dispose();
  window.indexedDB.deleteDatabase(dbName);
  return { code, value };
};

/** 真实浏览器中用小页扫描较大结果集，验证分页不会丢项、乱序或在提前停止后继续消费。 */
window.runIndexedDbPagedScanScenario = async () => {
  const dbName = `paged-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  for (let index = 0; index < 257; index += 1)
    await store.putRecord({ index }, `record-${String(index).padStart(3, '0')}`);

  const keys: string[] = [];
  for await (const [key] of store.iterateRecords(undefined, { pageSize: 7 })) {
    keys.push(String(key));
  }
  let stoppedEarly = true;
  let consumedAfterStop = 0;
  for await (const [key] of store.iterateRecords(undefined, { pageSize: 3 })) {
    consumedAfterStop += 1;
    if (String(key) === 'record-004') break;
  }
  stoppedEarly = consumedAfterStop === 5;
  let listenerSetupCode: string | undefined;
  try {
    await store
      .iterateRecords(undefined, {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('browser cursor listener setup');
          },
          removeEventListener: () => {}
        } as never
      })
      .next();
  } catch (error) {
    listenerSetupCode = (error as { code?: string }).code;
  }
  const cleanupResult = await store
    .iterateRecords(undefined, {
      signal: {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {
          throw new Error('browser cursor listener cleanup');
        }
      } as never
    })
    .next();
  const cleanupPreserved = cleanupResult.value !== undefined;
  let resultGetterCode: string | undefined;
  const originalOpenCursor = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = (() =>
    ({
      get result(): never {
        throw new Error('browser hostile cursor result getter');
      },
      set onsuccess(handler: (() => void) | null) {
        queueMicrotask(() => handler?.());
      },
      set onerror(_handler: unknown) {}
    }) as unknown as IDBRequest) as typeof originalOpenCursor;
  try {
    await store.iterateRecords().next();
  } catch (error) {
    resultGetterCode = (error as { code?: string }).code;
  } finally {
    IDBObjectStore.prototype.openCursor = originalOpenCursor;
  }
  /** Exercise host failures from each cursor entry surface after request.result succeeds. */
  const readEntryFailureCode = async (
    attack: 'key' | 'value' | 'continue'
  ): Promise<string | undefined> => {
    const cursor = {
      get key(): IDBValidKey {
        if (attack === 'key') throw new Error('browser hostile cursor key');
        return 'entry-key';
      },
      get value(): unknown {
        if (attack === 'value') throw new Error('browser hostile cursor value');
        return { value: true };
      },
      continue: () => {
        if (attack === 'continue') throw new Error('browser hostile cursor continue');
      }
    } as unknown as IDBCursorWithValue;
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        result: cursor,
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    try {
      await store.iterateRecords().next();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  };
  /** Keeps prototype mutation attacks serialized so each owns its restoration window. */
  const entryFailureCodes: Array<string | undefined> = [];
  for (const attack of ['key', 'value', 'continue'] as const)
    entryFailureCodes.push(await readEntryFailureCode(attack));
  let requestSetterCode: string | undefined;
  IDBObjectStore.prototype.openCursor = (() =>
    ({
      set onsuccess(_handler: unknown) {
        throw new Error('browser hostile runtime cursor onsuccess setter');
      },
      set onerror(_handler: unknown) {}
    }) as unknown as IDBRequest) as typeof originalOpenCursor;
  try {
    await store.iterateRecords().next();
  } catch (error) {
    requestSetterCode = (error as { code?: string }).code;
  } finally {
    IDBObjectStore.prototype.openCursor = originalOpenCursor;
  }
  let prematureCompletionCode: string | undefined;
  IDBObjectStore.prototype.openCursor = (() =>
    ({
      set onsuccess(_handler: unknown) {},
      set onerror(_handler: unknown) {}
    }) as unknown as IDBRequest) as typeof originalOpenCursor;
  try {
    await store.iterateRecords().next();
  } catch (error) {
    prematureCompletionCode = (error as { code?: string }).code;
  } finally {
    IDBObjectStore.prototype.openCursor = originalOpenCursor;
  }
  await store.dispose();
  return {
    count: keys.length,
    first: keys[0],
    last: keys[keys.length - 1],
    stoppedEarly,
    listenerSetupCode,
    cleanupPreserved,
    resultGetterCode,
    prematureCompletionCode,
    entryFailureCodes,
    requestSetterCode
  };
};

/** 三个连接同时参与同一 revision 的竞争，验证 optimistic transaction 只允许一个提交。 */
window.runIndexedDbDualTransactionScenario = async () => {
  const dbName = `dual-conflict-${Math.random().toString(36).slice(2)}`;
  const seed = indexedDb({ dbName });
  const first = indexedDb({ dbName });
  const second = indexedDb({ dbName });
  await seed.putRecord({ value: 0 }, 'dual-key');
  let releaseFirst: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  const firstPause = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondPause = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const run = async (store: typeof first, value: number, pause: Promise<void>) => {
    try {
      await store.transaction(async (tx) => {
        await tx.get('dual-key');
        await pause;
        await tx.put({ value }, 'dual-key');
      });
      return 'committed' as const;
    } catch (error) {
      if ((error as { code?: string }).code !== 'TRANSACTION_CONFLICT') throw error;
      return 'conflict' as const;
    }
  };
  const firstRun = run(first, 1, firstPause);
  const secondRun = run(second, 2, secondPause);
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
  releaseFirst!();
  const firstResult = await firstRun;
  releaseSecond!();
  const secondResult = await secondRun;
  const value = await seed.getRecord('dual-key');
  await seed.dispose();
  await first.dispose();
  await second.dispose();
  return {
    committed: [firstResult, secondResult].filter((result) => result === 'committed').length,
    conflicts: [firstResult, secondResult].filter((result) => result === 'conflict').length,
    value
  };
};

window.runIndexedDbLegacyRecordsMigrationScenario = async () => {
  const dbName = `legacy-records-${Math.random().toString(36).slice(2)}`;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put({ migrated: true }, 'legacy');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const store = indexedDb({ dbName, cleanupLegacyRecords: true });
  const value = await store.getRecord('legacy');
  const checkpoint = await store.metadata!.get('migration:records-v1-to-v2');
  await store.dispose();
  const migratedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const legacyStorePresent = migratedDatabase.objectStoreNames.contains('documents');
  migratedDatabase.close();

  const hostileDbName = `${dbName}-hostile-cursor`;
  const hostileDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(hostileDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = hostileDatabase.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put({ migrated: false }, 'hostile');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  hostileDatabase.close();
  const originalOpenCursor = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = (() =>
    ({
      get result(): never {
        throw new Error('hostile legacy cursor result getter');
      },
      set onsuccess(handler: (() => void) | null) {
        queueMicrotask(() => handler?.());
      },
      set onerror(_handler: unknown) {}
    }) as unknown as IDBRequest) as typeof originalOpenCursor;
  const hostileStore = indexedDb({ dbName: hostileDbName });
  let hostileCursorCode: string | undefined;
  try {
    await hostileStore.getRecord('hostile');
  } catch (error) {
    hostileCursorCode = error instanceof StorageError ? error.code : undefined;
  } finally {
    IDBObjectStore.prototype.openCursor = originalOpenCursor;
    await hostileStore.dispose();
  }

  /** Build an open request whose selected browser event exposes a throwing result getter. */
  const createHostileFactory = (event: 'success' | 'upgrade'): IDBFactory =>
    ({
      open: () =>
        ({
          get result(): never {
            throw new Error(`browser hostile ${event} result getter`);
          },
          get transaction(): null {
            return null;
          },
          set onupgradeneeded(handler: (() => void) | null) {
            if (event === 'upgrade') queueMicrotask(() => handler?.());
          },
          set onblocked(_handler: unknown) {},
          set onerror(_handler: unknown) {},
          set onsuccess(handler: (() => void) | null) {
            if (event === 'success') queueMicrotask(() => handler?.());
          }
        }) as unknown as IDBOpenDBRequest
    }) as unknown as IDBFactory;
  /** Run one hostile open lifecycle and return its normalized storage error code. */
  const readHostileOpenCode = async (event: 'success' | 'upgrade'): Promise<string | undefined> => {
    const hostileOpenStore = indexedDb({
      factory: createHostileFactory(event),
      dbName: `hostile-${event}`
    });
    try {
      await hostileOpenStore.get('key');
      return undefined;
    } catch (error) {
      return error instanceof StorageError ? error.code : undefined;
    } finally {
      await hostileOpenStore.dispose();
    }
  };
  const hostileOpenCode = await readHostileOpenCode('success');
  const hostileUpgradeCode = await readHostileOpenCode('upgrade');
  const openSetterCodes: Array<string | undefined> = [];
  for (const property of ['onupgradeneeded', 'onblocked', 'onsuccess', 'onerror'] as const) {
    const hostileSetterStore = indexedDb({
      factory: {
        open: () =>
          ({
            transaction: { abort: () => {} } as IDBTransaction,
            set onupgradeneeded(_handler: unknown) {
              if (property === 'onupgradeneeded')
                throw new Error('browser hostile open upgrade setter');
            },
            set onblocked(_handler: unknown) {
              if (property === 'onblocked') throw new Error('browser hostile open blocked setter');
            },
            set onsuccess(_handler: unknown) {
              if (property === 'onsuccess') throw new Error('browser hostile open success setter');
            },
            set onerror(_handler: unknown) {
              if (property === 'onerror') throw new Error('browser hostile open error setter');
            }
          }) as unknown as IDBOpenDBRequest
      } as unknown as IDBFactory,
      dbName: `hostile-open-${property}`
    });
    try {
      await hostileSetterStore.get('key');
      openSetterCodes.push(undefined);
    } catch (error) {
      openSetterCodes.push(error instanceof StorageError ? error.code : undefined);
    } finally {
      await hostileSetterStore.dispose();
    }
  }
  return {
    value,
    checkpoint,
    legacyStorePresent,
    hostileCursorCode,
    hostileOpenCode,
    hostileUpgradeCode,
    openSetterCodes
  };
};

window.runIndexedDbFourWayTransactionScenario = async () => {
  const dbName = `four-way-${Math.random().toString(36).slice(2)}`;
  const seed = indexedDb({ dbName });
  const stores = [1, 2, 3, 4].map(() => indexedDb({ dbName }));
  await seed.putRecord({ value: 0 }, 'four-way-key');
  const releases: Array<() => void> = [];
  const runs = stores.map((store, index) => {
    const pause = new Promise<void>((resolve) => {
      releases[index] = resolve;
    });
    return (async () => {
      try {
        await store.transaction(async (tx) => {
          await tx.get('four-way-key');
          await pause;
          await tx.put({ value: index + 1 }, 'four-way-key');
        });
        return 'committed' as const;
      } catch (error) {
        if ((error as { code?: string }).code !== 'TRANSACTION_CONFLICT') throw error;
        return 'conflict' as const;
      }
    })();
  });
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
  for (const release of releases) release();
  const results = await Promise.all(runs);
  await seed.dispose();
  for (const store of stores) await store.dispose();
  return {
    committed: results.filter((result) => result === 'committed').length,
    conflicts: results.filter((result) => result === 'conflict').length
  };
};

window.runIndexedDbFailureScenario = async () => {
  const dbName = `failure-${Math.random().toString(36).slice(2)}`;
  const store = indexedDb({ dbName });
  let transactionCode: string | undefined;
  try {
    await store.transaction(async (tx) => {
      await tx.put({ value: 'must-rollback' }, 'rollback-key');
      throw new Error('browser callback failure');
    });
  } catch (error) {
    transactionCode = (error as { code?: string }).code;
  }
  const rolledBack = (await store.getRecord('rollback-key')) === undefined;
  const controller = new AbortController();
  controller.abort('before write');
  let abortCode: string | undefined;
  try {
    await store.putRecord({ value: 'must-not-write' }, 'abort-key', { signal: controller.signal });
  } catch (error) {
    abortCode = (error as { code?: string }).code;
  }
  const abortMissing = (await store.getRecord('abort-key')) === undefined;
  const invalidCallbackCodes: Array<string | undefined> = [];
  for (const run of [null, [], {}, 'run', 1]) {
    try {
      await store.transaction(run as never);
    } catch (error) {
      invalidCallbackCodes.push((error as { code?: string }).code);
    }
  }
  let invalidScopeOptionsCode: string | undefined;
  try {
    await store.transaction((tx) =>
      tx.put({ value: 'must-not-write' }, 'invalid-scope-options', {
        conflictPolicy: 'invalid'
      } as never)
    );
  } catch (error) {
    invalidScopeOptionsCode = (error as { code?: string }).code;
  }
  const invalidScopeWriteMissing = (await store.getRecord('invalid-scope-options')) === undefined;
  let policyReads = 0;
  await store.transaction((tx) =>
    tx.put({ value: 'snapshot' }, 'policy-snapshot', {
      get conflictPolicy() {
        policyReads += 1;
        if (policyReads > 1) throw new Error('policy read twice');
        return 'replace' as const;
      }
    })
  );
  await store.dispose();
  return {
    transactionCode,
    rolledBack,
    abortCode,
    abortMissing,
    invalidCallbackCodes,
    invalidScopeOptionsCode,
    invalidScopeWriteMissing,
    policyReads
  };
};

window.runIndexedDbSmokeScenario = async () => {
  const store = indexedDb({ dbName: `smoke-${Math.random().toString(36).slice(2)}` });
  await store.putRecord({ a: 1 }, 'k');
  await store.metadata!.set('smoke', { ready: true });
  const value = await store.getRecord('k');
  const metadata = await store.metadata!.get('smoke');
  await store.dispose();
  return { ok: true, value, metadata };
};

/** 真实浏览器验证 IndexedDB factory options 的容器边界。 */
window.runIndexedDbOptionsGuardScenario = async () => {
  const codes: Array<string | undefined> = [];
  for (const options of [null, [], 'options', 1]) {
    try {
      indexedDb(options as never);
    } catch (error) {
      codes.push((error as { code?: string }).code);
    }
  }
  try {
    indexedDb({ cleanupLegacyRecords: 'yes' as never });
  } catch (error) {
    codes.push((error as { code?: string }).code);
  }
  try {
    indexedDb({
      get dbName(): string {
        throw new Error('hostile browser dbName');
      }
    });
  } catch (error) {
    codes.push((error as { code?: string }).code);
  }
  const store = indexedDb({ dbName: `invalid-string-key-${crypto.randomUUID()}` });
  const invalidKey = 42 as unknown as string;
  for (const operation of [
    () => store.get(invalidKey),
    () => store.set(invalidKey, 'value'),
    () => store.getBytes(invalidKey),
    () => store.metadata!.set(invalidKey, 'value')
  ]) {
    try {
      await operation();
    } catch (error) {
      codes.push((error as { code?: string }).code);
    }
  }
  await store.dispose();
  return codes;
};

/** 真实浏览器验证 JS 边界传入非法 entity definition 时仍返回统一错误码。 */
window.runEntityDefinitionGuardScenario = async () => {
  let definitionOptionReads = 0;
  let definitionSchemaReads = 0;
  const getterDefinition = defineEntity<{ id: string }>({
    get name() {
      definitionOptionReads += 1;
      return 'browser-getter-definition';
    },
    get key() {
      definitionOptionReads += 1;
      return 'id' as const;
    },
    get schema() {
      definitionOptionReads += 1;
      return {
        get name() {
          definitionSchemaReads += 1;
          return 'browser-getter-schema';
        },
        get validate() {
          definitionSchemaReads += 1;
          return async (value: unknown) => value as { id: string };
        },
        get encode() {
          definitionSchemaReads += 1;
          return undefined;
        },
        get decode() {
          definitionSchemaReads += 1;
          return undefined;
        },
        get normalize() {
          definitionSchemaReads += 1;
          return undefined;
        }
      };
    },
    get codec() {
      definitionOptionReads += 1;
      return undefined;
    },
    get version() {
      definitionOptionReads += 1;
      return 1;
    },
    get migrations() {
      definitionOptionReads += 1;
      return undefined;
    },
    get validateOnRead() {
      definitionOptionReads += 1;
      return true;
    },
    get onDiagnostic() {
      definitionOptionReads += 1;
      return undefined;
    },
    get defaultOrderBy() {
      definitionOptionReads += 1;
      return undefined;
    }
  });
  await getterDefinition.connect(memoryStorage()).put({ id: 'stable' });
  const hostileStore = {
    get backend(): 'memory' {
      throw new Error('hostile browser backend');
    }
  };
  const hostileStorePredicates = [
    isKeyValueStore(hostileStore),
    isRecordStore(hostileStore as never)
  ];
  const codes: Array<string | undefined> = [];
  for (const value of [null, undefined, [], 'entity', 42, true]) {
    try {
      defineEntity(value as never);
    } catch (error) {
      codes.push((error as { code?: string }).code);
    }
  }
  const entity = defineEntity<{ id: string }>({ name: 'browser-store-guard', key: 'id' });
  const storeCodes: Array<string | undefined> = [];
  for (const store of [null, undefined, [], {}, { backend: 'memory' }]) {
    try {
      entity.connect(store as never);
    } catch (error) {
      storeCodes.push((error as { code?: string }).code);
    }
  }
  entity.connect(memoryStorage());
  const codecCodes: Array<string | undefined> = [];
  for (const codec of [null, [], {}, { name: 'codec' }, { name: 'codec', output: 'unknown' }]) {
    try {
      defineEntity({ name: 'browser-codec-guard', key: 'id', codec } as never);
    } catch (error) {
      codecCodes.push((error as { code?: string }).code);
    }
  }
  const schemaCodes: Array<string | undefined> = [];
  for (const schema of [null, [], {}, { name: 'schema' }, { name: 'schema', validate: true }]) {
    try {
      defineEntity({ name: 'browser-schema-guard', key: 'id', schema } as never);
    } catch (error) {
      schemaCodes.push((error as { code?: string }).code);
    }
  }
  const migrationCodes: Array<string | undefined> = [];
  for (const migrations of [null, [], 'migrations', 42]) {
    try {
      defineEntity({ name: 'browser-migration-guard', key: 'id', version: 1, migrations } as never);
    } catch (error) {
      migrationCodes.push((error as { code?: string }).code);
    }
  }
  const versionCodes: Array<string | undefined> = [];
  try {
    defineEntity({
      name: 'browser-unsafe-version',
      key: 'id',
      version: Number.MAX_SAFE_INTEGER + 1
    } as never);
  } catch (error) {
    versionCodes.push((error as { code?: string }).code);
  }
  const migrationVersionCodes: Array<string | undefined> = [];
  try {
    defineEntity({
      name: 'browser-unsafe-migration-version',
      key: 'id',
      version: Number.MAX_SAFE_INTEGER,
      migrations: { '9007199254740993': async (value: unknown) => value }
    } as never);
  } catch (error) {
    migrationVersionCodes.push((error as { code?: string }).code);
  }
  const prototypeMigrationCodes: Array<string | undefined> = [];
  try {
    const migrations = Object.create({ 2: async (value: unknown) => value });
    defineEntity({
      name: 'browser-prototype-migration',
      key: 'id',
      version: 2,
      migrations
    } as never);
  } catch (error) {
    prototypeMigrationCodes.push((error as { code?: string }).code);
  }
  const nullVersionCodes: Array<string | undefined> = [];
  try {
    defineEntity({ name: 'browser-null-version', key: 'id', version: null } as never);
  } catch (error) {
    nullVersionCodes.push((error as { code?: string }).code);
  }
  const backendCodes: Array<string | undefined> = [];
  try {
    const alienStore = {
      backend: 'alien',
      capabilities: {},
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      dispose: async () => undefined
    };
    defineEntity<{ id: string }>({ name: 'browser-alien-store', key: 'id' }).connect(
      alienStore as never
    );
  } catch (error) {
    backendCodes.push((error as { code?: string }).code);
  }
  const capabilityCodes: Array<string | undefined> = [];
  for (const capabilities of [
    { syncRead: 'yes' },
    [],
    {
      syncRead: true,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      opaqueEntries: false,
      maxValueBytes: 1.5
    }
  ]) {
    try {
      const malformedStore = {
        backend: 'memory',
        capabilities,
        get: async () => null,
        set: async () => undefined,
        remove: async () => undefined,
        has: async () => false,
        keys: async () => [],
        clearValues: async () => undefined,
        clearAll: async () => undefined,
        dispose: async () => undefined
      };
      defineEntity<{ id: string }>({ name: 'browser-capability-guard', key: 'id' }).connect(
        malformedStore as never
      );
    } catch (error) {
      capabilityCodes.push((error as { code?: string }).code);
    }
  }
  const sparseVersionCodes: Array<string | undefined> = [];
  try {
    defineEntity({
      name: 'browser-sparse-huge-version',
      key: 'id',
      version: Number.MAX_SAFE_INTEGER,
      migrations: { 2: async (value: unknown) => value }
    } as never);
  } catch (error) {
    sparseVersionCodes.push((error as { code?: string }).code);
  }
  const validateOnReadCodes: Array<string | undefined> = [];
  for (const validateOnRead of [null, 'yes', 1, []]) {
    try {
      defineEntity({ name: 'browser-validate-on-read', key: 'id', validateOnRead } as never);
    } catch (error) {
      validateOnReadCodes.push((error as { code?: string }).code);
    }
  }
  const standardSchemaCodes: Array<string | undefined> = [];
  for (const schema of [null, [], {}, { '~standard': null }, { '~standard': {} }]) {
    try {
      fromStandardSchema(schema as never);
    } catch (error) {
      standardSchemaCodes.push((error as { code?: string }).code);
    }
  }
  let standardSchemaContractReads = 0;
  let standardSchemaResultReads = 0;
  const getterSchema = fromStandardSchema<number>({
    get '~standard'() {
      standardSchemaContractReads += 1;
      return {
        get version() {
          standardSchemaContractReads += 1;
          return 1 as const;
        },
        get vendor() {
          standardSchemaContractReads += 1;
          return 'browser-getter-schema';
        },
        get validate() {
          standardSchemaContractReads += 1;
          return async () => ({
            get issues() {
              standardSchemaResultReads += 1;
              return undefined;
            },
            get value() {
              standardSchemaResultReads += 1;
              return 42;
            }
          });
        }
      };
    }
  });
  await getterSchema.validate('input');
  const migrationHelperCodes: Array<string | undefined> = [];
  for (const [fromVersion, toVersion] of [
    [Number.NaN, 1],
    [0, Number.POSITIVE_INFINITY],
    [0, Number.MAX_SAFE_INTEGER + 1]
  ]) {
    try {
      await runMigrations({}, fromVersion, toVersion, undefined);
    } catch (error) {
      migrationHelperCodes.push((error as { code?: string }).code);
    }
  }
  let inheritedMigrationCalls = 0;
  const inheritedMigrations = Object.create({
    1: async () => {
      inheritedMigrationCalls += 1;
      return {};
    }
  });
  await runMigrations({}, 0, 1, inheritedMigrations);
  let raceAborted = false;
  let migrationRaceCode: string | undefined;
  try {
    await runMigrations({}, 0, 1, { 1: async () => new Promise<unknown>(() => {}) }, {
      get aborted() {
        return raceAborted;
      },
      reason: 'race abort',
      addEventListener: () => {
        raceAborted = true;
      },
      removeEventListener: () => {}
    } as never);
  } catch (error) {
    migrationRaceCode = (error as { code?: string }).code;
  }
  const codecSelectionCodes: Array<string | undefined> = [];
  for (const [codec, capabilities, diagnostic] of [
    [null, {}, undefined],
    [jsonCodec, {}, undefined],
    [
      jsonCodec,
      {
        syncRead: true,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        maxValueBytes: 1024,
        opaqueEntries: false
      },
      'invalid'
    ]
  ] as const) {
    try {
      selectCodec(codec as never, capabilities as never, diagnostic as never);
    } catch (error) {
      codecSelectionCodes.push((error as { code?: string }).code);
    }
  }
  let codecDescriptorReads = 0;
  const selectedGetterCodec = selectCodec(
    {
      get name() {
        codecDescriptorReads += 1;
        return 'browser-getter-codec';
      },
      get output() {
        codecDescriptorReads += 1;
        return 'text' as const;
      },
      get encode() {
        codecDescriptorReads += 1;
        return async (value: unknown) => JSON.stringify(value);
      },
      get decode() {
        codecDescriptorReads += 1;
        return async (value: string) => JSON.parse(value) as unknown;
      }
    },
    {
      syncRead: true,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      maxValueBytes: 1024,
      opaqueEntries: false
    }
  );
  await selectedGetterCodec.encode({ stable: true });
  return {
    codes,
    storeCodes,
    codecCodes,
    schemaCodes,
    migrationCodes,
    versionCodes,
    migrationVersionCodes,
    prototypeMigrationCodes,
    nullVersionCodes,
    backendCodes,
    capabilityCodes,
    sparseVersionCodes,
    validateOnReadCodes,
    standardSchemaCodes,
    standardSchemaContractReads,
    standardSchemaResultReads,
    migrationHelperCodes,
    inheritedMigrationCalls,
    migrationRaceCode,
    codecSelectionCodes,
    hostileStorePredicates,
    codecDescriptorReads,
    definitionOptionReads,
    definitionSchemaReads
  };
};

/** 真实浏览器验证 orderBy comparator 的返回类型不会被 Array.sort 静默转换。 */
window.runEntityComparatorGuardScenario = async () => {
  const entity = defineEntity<{ id: string }>({ name: 'browser-comparator-guard', key: 'id' });
  const repo = entity.connect(memoryStorage());
  await repo.put({ id: 'a' });
  await repo.put({ id: 'b' });
  const codes: Array<string | undefined> = [];
  for (const comparator of [() => 'invalid' as never, () => Number.NaN]) {
    try {
      await repo.list({ orderBy: comparator });
    } catch (error) {
      codes.push((error as { code?: string }).code);
    }
  }
  let nullCode: string | undefined;
  try {
    await repo.list({ orderBy: null as never });
  } catch (error) {
    nullCode = (error as { code?: string }).code;
  }
  const invalidOptionsCodes: Array<string | undefined> = [];
  for (const options of [null, [], 'options', 1]) {
    try {
      await repo.list(options as never);
    } catch (error) {
      invalidOptionsCodes.push((error as { code?: string }).code);
    }
  }
  try {
    await repo.list({ limit: Number.MAX_SAFE_INTEGER + 1 });
  } catch (error) {
    invalidOptionsCodes.push((error as { code?: string }).code);
  }
  const rangeCodes: Array<string | undefined> = [];
  for (const range of [null, [], 'range', 1]) {
    try {
      await repo.list({ range: range as never });
    } catch (error) {
      rangeCodes.push((error as { code?: string }).code);
    }
  }
  for (const range of [{ lowerOpen: 'yes' }, { upperOpen: 1 }]) {
    try {
      await repo.list({ range: range as never });
    } catch (error) {
      rangeCodes.push((error as { code?: string }).code);
    }
  }
  const invalidHandlerCodes: Array<string | undefined> = [];
  for (const onInvalid of [null, [], 'invalid', 1]) {
    try {
      await repo.list({ onInvalid: onInvalid as never });
    } catch (error) {
      invalidHandlerCodes.push((error as { code?: string }).code);
    }
  }
  let invalidPolicyCode: string | undefined;
  try {
    await memoryStorage().set('policy', 'value', { conflictPolicy: 'invalid' as never });
  } catch (error) {
    invalidPolicyCode = (error as { code?: string }).code;
  }
  let rangeSnapshotReads = 0;
  await repo.list({
    range: {
      get lower() {
        rangeSnapshotReads += 1;
        if (rangeSnapshotReads > 1) throw new Error('range read twice');
        return 'a';
      },
      upper: 'z'
    }
  });
  let listOptionReads = 0;
  await repo.list({
    get range() {
      listOptionReads += 1;
      return { lower: 'a', upper: 'z' };
    },
    get limit() {
      listOptionReads += 1;
      return 2;
    },
    get orderBy() {
      listOptionReads += 1;
      return undefined;
    },
    get onInvalid() {
      listOptionReads += 1;
      return 'throw' as const;
    }
  });
  return {
    codes,
    nullCode,
    invalidOptionsCodes,
    rangeCodes,
    invalidHandlerCodes,
    invalidPolicyCode,
    rangeSnapshotReads,
    listOptionReads
  };
};

/** Run the storage capability matrix inside a real module Worker. */
window.runWorkerScenario = (): Promise<{
  readonly memory: string | null;
  readonly indexedDb: string | null;
  readonly localStorageCode: string | undefined;
  readonly cookiesCode: string | undefined;
}> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('worker scenario timed out'));
    }, 10_000);
    worker.onmessage = (event: MessageEvent) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(event.error ?? new Error(event.message));
    };
    worker.postMessage(undefined);
  });
