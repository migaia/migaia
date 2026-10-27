import {
  StorageContractError,
  StorageContractErrorCode,
  isSecondaryIndexRecordStore,
  records,
  type IOperationContext,
  type IStorageIterator,
  type IStorageBase,
  type IStorageChange,
  type IWriteOptions,
  type IKeyValueStore,
  type IRecordStore,
  type ISecondaryIndexRecordStore,
  type ITransactionInfo
} from '@migaia/storage-contract'
import { snapshotRecordStore, snapshotKeyValueStoreDetailed } from '../authoring/store.js'
import { assertTransactionOwner } from '../authoring/transaction.js'
import { hasStorageCapability, useStorageCapability } from '../authoring/capability.js'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import type { IStorageEnvelopeStages } from '../types.js'

import type { IBackendChangeController, IBackendLifecycleController } from './change-types.js'

/** Prepared text mutation checked and committed by the backend's original physical owner. */
export type IBackendValueCommit = (
  input: Readonly<{
    prefix: string
    expected: readonly (readonly [string, string])[]
    key: string
    value: string
  }>,
  ctx?: IWriteOptions
) => Promise<void>

/** Each original host supplies observation and optional selected query methods on its own binding. */
type IBackendEntityBinding = {
  readonly envelope: (
    operation: Readonly<{ operation: string; targetVersion: number }>
  ) => IStorageEnvelopeStages
  readonly queryMethods?: () => object | undefined
}

/** Original exact-store row shares optional controller, entity observation and native endpoints. */
type IBackendRegistration = {
  /** Authenticated borrowed aliases resolve private capabilities through this original owner. */
  capabilityOwner?: object
  controller?: IBackendLifecycleController
  valueCommit?: IBackendValueCommit
  envelopes?: IBackendEntityBinding[]
  entity?: IBackendEntityAccess
}

/** Entity methods retain business access while omitting every resource ownership member. */
export type IEntityKeyValueMethods = Omit<IKeyValueStore, 'dispose' | typeof Symbol.asyncDispose>
/** Record methods preserve their original native transaction owner and metadata. */
export type IEntityRecordMethods = Omit<IRecordStore, 'dispose' | typeof Symbol.asyncDispose>
/** Secondary methods retain canonical admission while the native target stays private. */
export type IEntitySecondaryMethods = Omit<
  ISecondaryIndexRecordStore,
  'dispose' | typeof Symbol.asyncDispose
>
/** The original exact-store row grants only already-authenticated business facts to entity. */
export type IBackendEntityAccess = {
  readonly store: IEntityKeyValueMethods
  recordStore(): IEntityRecordMethods | undefined
  secondaryStore(): IEntitySecondaryMethods | undefined
  assertScope(scope: object): ITransactionInfo
  assertCurrent(): void
  /** Borrow only the original native record-query watcher; it grants no store or resource authority. */
  readonly watchRecords?: (ctx?: IOperationContext) => IStorageIterator<IStorageChange>
  readonly valueCommit?: IBackendValueCommit
}

/**
 * Capture a genuine native query method through the original token Map, without mutating or
 * unwrapping it.
 */
export function snapshotBackendEntityRecordWatcher(
  native: IStorageBase
): IBackendEntityAccess['watchRecords'] {
  if (native.capabilities.changeFeed !== true || !hasStorageCapability(native, records)) return
  /** Query construction is pure; every invocation below still returns its original fresh iterator. */
  const query = useStorageCapability(native, records).query() as {
    readonly watch?: (ctx?: IOperationContext) => IStorageIterator<IStorageChange>
  }
  if (typeof query.watch !== 'function') return
  return (ctx) => query.watch!(ctx)
}

/** Bind only an original host-authenticated alias, keeping its native owner private in a closure. */
export function registerBackendEntityAccess(
  view: object,
  native: IStorageBase,
  assertCurrent: () => void
): () => void {
  /** The same canonical KV admission validates this native target before ownership is hidden. */
  const keyValue = snapshotKeyValueStoreDetailed(native)
  if (!keyValue.valid) return () => undefined
  /** Atomic text writes remain the original native endpoint, without exposing its registration. */
  const valueCommit = controllerRegistry.get(native)?.valueCommit
  /** A borrowed alias captures only this finite callback, retaining its exact original native owner. */
  const watchRecords = snapshotBackendEntityRecordWatcher(native)
  /** The host's borrowed view forwards exactly these admitted native methods without close access. */
  const access: IBackendEntityAccess = {
    store: view as IEntityKeyValueMethods,
    recordStore: () =>
      snapshotRecordStore(native) === undefined ? undefined : (view as IEntityRecordMethods),
    secondaryStore: () =>
      isSecondaryIndexRecordStore(native) ? (view as IEntitySecondaryMethods) : undefined,
    assertCurrent,
    ...(watchRecords === undefined
      ? {}
      : {
          watchRecords: (ctx?: IOperationContext) => {
            assertCurrent()
            return watchRecords(ctx)
          }
        }),
    ...(valueCommit === undefined
      ? {}
      : {
          valueCommit: (...args: Parameters<IBackendValueCommit>) => {
            assertCurrent()
            return valueCommit(...args)
          }
        }),
    assertScope: (scope: object) => {
      assertCurrent()
      return assertTransactionOwner(native, scope)
    }
  }
  /** This is the same original registry row as controller, envelope and query projection. */
  const row = controllerRegistry.get(view) ?? {}
  if (row.entity !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  row.entity = access
  row.capabilityOwner = resolveBackendCapabilityOwner(native)
  controllerRegistry.set(view, row)
  return () => {
    if (controllerRegistry.get(view) !== row || row.entity !== access) return
    delete row.entity
    delete row.capabilityOwner
    if (
      row.controller === undefined &&
      row.envelopes === undefined &&
      row.valueCommit === undefined
    )
      controllerRegistry.delete(view)
  }
}

/** Read resource-free facts for the exact certified alias; never unwrap or return a native handle. */
export function getBackendEntityAccess(view: object): IBackendEntityAccess | undefined {
  const access = controllerRegistry.get(view)?.entity
  access?.assertCurrent()
  return access
}

/** One private exact-store registry; observation also supports admitted stores without a controller. */
const controllerRegistry = new WeakMap<object, IBackendRegistration>()

/** Resolve private capability identity once; borrowed aliases retain their original lifecycle gate. */
export function resolveBackendCapabilityOwner(store: object): object {
  /** Host context remains on the alias; only backend-owned capability tables use native identity. */
  const row = controllerRegistry.get(store)
  row?.entity?.assertCurrent()
  return row?.capabilityOwner ?? store
}

/** Register one exact store instance and reject accidental duplicate ownership. */
export const registerBackendChangeController = (
  store: Pick<IStorageBase, 'backend'>,
  controller: IBackendLifecycleController
): (() => void) => {
  if (controllerRegistry.get(store)?.controller !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: store.backend
    })
  /** Admission may already have bound envelope observation to this original row. */
  const row = controllerRegistry.get(store) ?? {}
  row.controller = controller
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row || row.controller !== controller) return
    delete row.controller
    if (row.envelopes === undefined && row.valueCommit === undefined && row.entity === undefined)
      controllerRegistry.delete(store)
  }
}

/** Look up the package-private controller bound to one exact store instance. */
export const getBackendChangeController = (
  store: unknown
): IBackendChangeController | undefined => {
  if (typeof store !== 'object' || store === null) return undefined
  /** Physical lifecycle-only backends have no notification subscription owner. */
  const controller = controllerRegistry.get(resolveBackendCapabilityOwner(store))?.controller
  return controller !== undefined && 'subscribe' in controller
    ? (controller as IBackendChangeController)
    : undefined
}

/** Bind original host observation at resource admission without changing or patching the store. */
export const registerBackendEnvelopeStages = (
  store: object,
  factory: IBackendEntityBinding['envelope'],
  queryMethods?: IBackendEntityBinding['queryMethods']
): (() => void) => {
  /** A shared raw object may belong to more than one host; each original scope retains its binding. */
  const row = controllerRegistry.get(store) ?? {}
  const binding: IBackendEntityBinding = { envelope: factory, queryMethods }
  ;(row.envelopes ??= []).push(binding)
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row) return
    /** Remove only this registration; other live hosts still observe the shared original store. */
    const index = row.envelopes?.indexOf(binding) ?? -1
    if (index < 0) return
    row.envelopes!.splice(index, 1)
    if (row.envelopes!.length === 0) delete row.envelopes
    if (
      row.controller === undefined &&
      row.envelopes === undefined &&
      row.valueCommit === undefined &&
      row.entity === undefined
    )
      controllerRegistry.delete(store)
  }
}

/** Entity borrows original host observers without gaining construction authority or store wrappers. */
export const getBackendEnvelopeStages = (
  store: object,
  operation: Readonly<{ operation: string; targetVersion: number }>
): IStorageEnvelopeStages | undefined => {
  /** The ordinary single-host path returns its original bound observer directly. */
  const factories = controllerRegistry.get(store)?.envelopes
  if (factories === undefined) return undefined
  if (factories.length === 1) return factories[0]!.envelope(operation)
  /** Shared raw identity cannot identify a caller host, so all original active bindings observe it. */
  const stages = factories.map((binding) => binding.envelope(operation))
  return {
    beforeEnvelopeCheck: () => {
      for (const stage of stages) stage.beforeEnvelopeCheck()
    },
    afterEnvelopeCheck: (version) => {
      for (const stage of stages) stage.afterEnvelopeCheck(version)
    },
    onVersionRejected: (version, code) => {
      for (const stage of stages) stage.onVersionRejected(version, code)
    },
    afterMigrate: (version, mode, count, elapsed) => {
      for (const stage of stages) stage.afterMigrate(version, mode, count, elapsed)
    },
    observe: {
      beforeStep: (context) => {
        for (const stage of stages) stage.observe.beforeStep?.(context)
      },
      afterStep: (context) => {
        for (const stage of stages) stage.observe.afterStep?.(context)
      },
      report: (cause) => {
        for (const stage of stages) stage.observe.report?.(cause)
      }
    }
  }
}

/** Install one original native compare-and-write terminal on the exact admitted store row. */
export const registerBackendValueCommit = (
  store: IStorageBase,
  commit: IBackendValueCommit
): (() => void) => {
  if (typeof commit !== 'function' || controllerRegistry.get(store)?.valueCommit !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  /** This uses the same original row as resource observation and change publication. */
  const row = controllerRegistry.get(store) ?? {}
  row.valueCommit = commit
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row || row.valueCommit !== commit) return
    delete row.valueCommit
    if (row.controller === undefined && row.envelopes === undefined && row.entity === undefined)
      controllerRegistry.delete(store)
  }
}

/** Entity borrows the captured native endpoint without exposing its registration authority. */
export const getBackendValueCommit = (store: object): IBackendValueCommit | undefined => {
  const row = controllerRegistry.get(store)
  return row?.valueCommit ?? row?.entity?.valueCommit
}

/** Read selected methods from the original storage cell without duplicating its Feature table. */
export const getBackendEntityQueryMethods = (store: object): object | undefined => {
  /** Shared raw stores have no implicit host router; distinct control-plane bindings are ambiguous. */
  let methods: object | undefined
  let selectedBinding = false
  for (const binding of controllerRegistry.get(store)?.envelopes ?? []) {
    const selected = binding.queryMethods?.()
    if (selectedBinding && methods !== selected)
      throw new StorageError(StorageHostErrorCode.invalidConfig)
    methods = selected
    selectedBinding = true
  }
  return methods
}

export type * from './change-types.js'
