import { createEventChannel } from '@migaia/event-subscriber'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  createBackendJournalNamespace,
  type IBackendJournalTransaction
} from '../journal/namespace-resource.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from '../journal/types.js'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'

/** Commit evidence stays in the same private physical data universe as original log namespaces. */
const markerNamespace = Symbol()
/** Ordinary marker I/O reuses one fixed canonical metadata head lock, without dynamic tx locks. */
const markerLockNamespace = 'storage.commit.markers'
/** A marker contains only commit evidence; tx identity is its original native owner-issued key. */
const markerValue = '1'

/** A private native scope carries the same draft and terminal effects as its business writes. */
export type IMemoryJournalTransaction = {
  run<R>(
    prefix: string | symbol,
    work: (view: IStorageJournalNamespaceView) => Promise<R>
  ): Promise<R>
  onCommit(effect: () => void): () => void
  onRollback(effect: () => void): () => void
}
/** Only the current attempt's reads and changes are retained, without cloning journal history. */
type IMemoryJournalDraft = {
  readonly base: Map<string, string> | undefined
  readonly reads: Map<string, string | undefined>
  readonly writes: Map<string, string | undefined>
  keys: Set<string> | undefined
}
/** Private strings use the original argument code and never coerce a caller's object. */
function assertText(value: unknown): asserts value is string {
  if (typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
}
/** Private journal rows share the physical memory namespace and its original transaction owner. */
/** Original memory ports retain canonical transaction, reservation and close ownership. */
type IMemoryJournalOptions = {
  readonly assertLive: () => void
  readonly report: (error: unknown) => void
  readonly closingSignal: INativeAbortSignal
  readonly reserve: (prefix: string, run: () => Promise<void>) => Promise<void>
  readonly transaction: <R>(
    prefix: string,
    work: (port: IMemoryJournalTransaction) => Promise<R>
  ) => Promise<R>
  readonly scope: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly info: ITransactionInfo
    readonly port: IMemoryJournalTransaction
  }
}
/** One native scope adds its existing synchronous execution admission to private journal work. */
type IMemoryJournalDraftPort = {
  run<R>(
    prefix: string | symbol,
    work: (view: IStorageJournalNamespaceView) => Promise<R>,
    execute: <V>(run: () => V) => Promise<Awaited<V>>
  ): Promise<R>
  onCommit(effect: () => void): () => void
  onRollback(effect: () => void): () => void
}
/** Private journal changes remain attached to one original admitted memory draft. */
type IMemoryJournalDraftOwner = {
  readonly port: IMemoryJournalDraftPort
  conflict(): string | symbol | undefined
  commit(): void
  complete(success: boolean): void
}
/** Physical private data supplies native ports without owning another transaction lifetime. */
type IMemoryJournalData = {
  draft(): IMemoryJournalDraftOwner
  open(prefix: string): Promise<IStorageJournalNamespace>
  writeMarker(scope: Omit<ITransactionScope, 'use'>, txId: string): Promise<void>
  hasMarker(txId: string): Promise<boolean>
  removeMarker(txId: string): Promise<void>
  clear(): void
}

/** One physical memory journal owns only its original private metadata maps. */
type IMemoryJournalContext = {
  /** Original options is captured before native construction begins. */
  readonly options: IMemoryJournalOptions

  /** Business clear and capacity never enumerate these original backend-private metadata rows. */
  namespaces: Map<string | symbol, Map<string, string>>
}
/** Create physical private metadata ports sharing the original memory transaction owner. */
export function createMemoryJournalData(options: IMemoryJournalOptions): IMemoryJournalData {
  /** Initialize native facts in original construction order before publishing any port. */
  const memoryState = { options } as IMemoryJournalContext

  /** Business clear and capacity never enumerate these original backend-private metadata rows. */
  memoryState.namespaces = new Map<string | symbol, Map<string, string>>()
  return createMemoryJournalMethods(memoryState)
}

/** Prepare sparse private writes beside the same native attempt's existing business draft. */

/** One original native memory draft owns only its touched private metadata and terminal channels. */
type IMemoryJournalDraftContext = {
  /** Original memoryState is captured before native construction begins. */
  readonly memoryState: IMemoryJournalContext

  /** Replacing the private physical map invalidates even an initially empty pre-drop attempt. */
  generation: IMemoryJournalContext['namespaces']

  /** Each touched private namespace retains its original committed map identity. */
  touched: Map<string | symbol, IMemoryJournalDraft>

  /** Original event delivery observes synchronous and late terminal-listener failures. */
  committed: ReturnType<typeof createEventChannel<void>>

  /** Rollback effects use the same terminal channel owner and report policy. */
  rolledBack: ReturnType<typeof createEventChannel<void>>

  /** A native attempt publishes exactly one actual terminal result. */
  settled: boolean

  /** The original scope supplies authorization on every extracted private method invocation. */
  port: IMemoryJournalDraftPort
}
/** Create one sparse metadata draft beside the existing native business attempt. */
function draft(memoryState: IMemoryJournalContext): IMemoryJournalDraftOwner {
  /** Initialize native facts in original construction order before publishing any port. */
  const draftState = { memoryState } as IMemoryJournalDraftContext

  /** Replacing the private physical map invalidates even an initially empty pre-drop attempt. */
  draftState.generation = draftState.memoryState.namespaces

  /** Each touched private namespace retains its original committed map identity. */
  draftState.touched = new Map<string | symbol, IMemoryJournalDraft>()

  /** Original event delivery observes synchronous and late terminal-listener failures. */
  draftState.committed = createEventChannel<void>({
    report: ({ error }) => draftState.memoryState.options.report(error)
  })

  /** Rollback effects use the same terminal channel owner and report policy. */
  draftState.rolledBack = createEventChannel<void>({
    report: ({ error }) => draftState.memoryState.options.report(error)
  })

  /** A native attempt publishes exactly one actual terminal result. */
  draftState.settled = false
  draftState.port = createMemoryJournalDraftPort(draftState)
  return createMemoryDraftMethods(draftState)
}

/** Capture a namespace on first access; untouched rows stay in the original physical Map. */
function state(
  draftState: IMemoryJournalDraftContext,
  prefix: string | symbol
): IMemoryJournalDraft {
  let entry = draftState.touched.get(prefix)
  if (entry === undefined) {
    entry = {
      base: draftState.memoryState.namespaces.get(prefix),
      reads: new Map(),
      writes: new Map(),
      keys: undefined
    }
    draftState.touched.set(prefix, entry)
  }
  return entry
}

/** First reads are repeatable, including absence, until this same draft overwrites the key. */
function read(
  draftState: IMemoryJournalDraftContext,
  entry: IMemoryJournalDraft,
  key: string
): string | undefined {
  if (entry.writes.has(key)) return entry.writes.get(key)
  if (!entry.reads.has(key)) entry.reads.set(key, entry.base?.get(key))
  return entry.reads.get(key)
}

/** The original scope supplies authorization on every extracted private method invocation. */
/** One authenticated private view borrows its original draft and execution admission. */
type IMemoryJournalViewContext = {
  readonly draftState: IMemoryJournalDraftContext
  readonly entry: IMemoryJournalDraft
  readonly execute: <V>(run: () => V) => Promise<Awaited<V>>
}

/** The original scope supplies authorization on every extracted private method invocation. */
function createMemoryJournalDraftPort(
  draftState: IMemoryJournalDraftContext
): IMemoryJournalDraftPort {
  return {
    run: <R>(
      prefix: string | symbol,
      work: (view: IStorageJournalNamespaceView) => Promise<R>,
      execute: IMemoryJournalViewContext['execute']
    ) => runMemoryJournalDraft(draftState, prefix, work, execute),
    onCommit: (effect) => draftState.committed.subscribe(() => effect()),
    onRollback: (effect) => draftState.rolledBack.subscribe(() => effect())
  }
}

/** Bind a private namespace view to this same native draft before invoking accepted work. */
async function runMemoryJournalDraft<R>(
  draftState: IMemoryJournalDraftContext,
  prefix: string | symbol,
  work: (view: IStorageJournalNamespaceView) => Promise<R>,
  execute: IMemoryJournalViewContext['execute']
): Promise<R> {
  /** No private data is copied; this view retains only the draft row it actually touches. */
  const viewState: IMemoryJournalViewContext = {
    draftState,
    entry: state(draftState, prefix),
    execute
  }
  return work(createMemoryJournalView(viewState))
}

/** Prefix membership is observed once, then overlaid with this original draft's sparse writes. */
function memoryJournalViewKeys(viewState: IMemoryJournalViewContext): Set<string> {
  viewState.entry.keys ??= new Set(viewState.entry.base?.keys())
  /** The visible key set belongs to this one read and never mutates the stored observation. */
  const result = new Set(viewState.entry.keys)
  for (const [key, value] of viewState.entry.writes) {
    if (value === undefined) result.delete(key)
    else result.add(key)
  }
  return result
}

/** Both legacy clear names stage deletion only inside this authenticated private namespace. */
function clearMemoryJournalView(viewState: IMemoryJournalViewContext): Promise<void> {
  return viewState.execute(() => {
    for (const key of memoryJournalViewKeys(viewState)) {
      read(viewState.draftState, viewState.entry, key)
      viewState.entry.writes.set(key, undefined)
    }
  })
}

/** Original execution admission still guards each private metadata read and staged mutation. */
function createMemoryJournalView(
  viewState: IMemoryJournalViewContext
): IStorageJournalNamespaceView {
  /** Both public clear aliases retain this same endpoint identity. */
  const clear = () => clearMemoryJournalView(viewState)
  return {
    get: (key) =>
      viewState.execute(() => {
        assertText(key)
        return read(viewState.draftState, viewState.entry, key) ?? null
      }),
    has: (key) =>
      viewState.execute(() => {
        assertText(key)
        return read(viewState.draftState, viewState.entry, key) !== undefined
      }),
    set: (key, value) =>
      viewState.execute(() => {
        assertText(key)
        assertText(value)
        read(viewState.draftState, viewState.entry, key)
        viewState.entry.writes.set(key, value)
      }),
    remove: (key) =>
      viewState.execute(() => {
        assertText(key)
        read(viewState.draftState, viewState.entry, key)
        viewState.entry.writes.set(key, undefined)
      }),
    keys: () => viewState.execute(() => [...memoryJournalViewKeys(viewState)]),
    clearValues: clear,
    clearAll: clear
  }
}
/** Publish private draft ports without adding a transaction or terminal owner. */
function createMemoryDraftMethods(
  draftState: IMemoryJournalDraftContext
): IMemoryJournalDraftOwner {
  return {
    port: draftState.port,
    conflict: () => memoryJournalDraftConflict(draftState),
    commit: () => memoryJournalDraftCommit(draftState),
    complete: (success: boolean) => memoryJournalDraftComplete(draftState, success)
  }
}

/** Fixed-prefix I/O and native terminal channels remain on the original memory draft. */
function project(
  memoryState: IMemoryJournalContext,
  prefix: string,
  port: IMemoryJournalTransaction
): IBackendJournalTransaction {
  return {
    run: (work) => port.run(prefix, work),
    onCommit: (effect) => port.onCommit(effect),
    onRollback: (effect) => port.onRollback(effect),
    onEnd: (effect) => {
      const offCommit = port.onCommit(effect)
      const offRollback = port.onRollback(effect)
      return () => {
        offCommit()
        offRollback()
      }
    }
  }
}

/** The shared original resource algorithm borrows only this fixed native namespace. */
async function open(
  memoryState: IMemoryJournalContext,
  prefix: string
): Promise<IStorageJournalNamespace> {
  memoryState.options.assertLive()
  assertText(prefix)
  if (prefix.length === 0) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const generation = memoryState.namespaces
  return createBackendJournalNamespace({
    ...memoryState.options,
    nativeAtomic: true,
    assertLive: () => {
      memoryState.options.assertLive()
      if (generation !== memoryState.namespaces)
        throw new StorageContractError(StorageContractErrorCode.disposed)
    },
    reserve: (hold) => memoryState.options.reserve(prefix, hold),
    authenticate: (scope) => {
      const current = memoryState.options.scope(scope)
      return { info: current.info, port: project(memoryState, prefix, current.port) }
    },
    transaction: (work) =>
      memoryState.options.transaction(prefix, (port) => work(project(memoryState, prefix, port)))
  })
}
/** Publish private metadata ports on their original memory state. */
function createMemoryJournalMethods(memoryState: IMemoryJournalContext): IMemoryJournalData {
  return {
    draft: () => draft(memoryState),
    open: (prefix: string) => open(memoryState, prefix),
    /** Marker and business data share this exact native attempt and its original rollback path. */
    writeMarker: (scope: Omit<ITransactionScope, 'use'>, txId: string) =>
      memoryJournalWriteMarker(memoryState, scope, txId),
    /** Recovery reads original private metadata without opening a second log resource owner. */
    hasMarker: (txId: string) => memoryJournalHasMarker(memoryState, txId),
    /** Terminal intent cleanup removes only its fixed-org evidence through the original owner. */
    removeMarker: (txId: string) => memoryJournalRemoveMarker(memoryState, txId),
    clear: () => memoryJournalClear(memoryState)
  }
}

/** Perform conflict on this owner's original private native draft state. */
function memoryJournalDraftConflict(
  draftState: IMemoryJournalDraftContext
): string | symbol | undefined {
  if (draftState.generation !== draftState.memoryState.namespaces)
    return draftState.touched.keys().next().value
  for (const [prefix, entry] of draftState.touched) {
    const current = draftState.memoryState.namespaces.get(prefix)
    if (current !== entry.base) return prefix
    for (const [key, value] of entry.reads) if (current?.get(key) !== value) return prefix
    if (
      entry.keys !== undefined &&
      ((current?.size ?? 0) !== entry.keys.size ||
        [...(current?.keys() ?? [])].some((key) => !entry.keys!.has(key)))
    )
      return prefix
  }
  return undefined
}
/** Perform commit on this owner's original private native draft state. */
function memoryJournalDraftCommit(draftState: IMemoryJournalDraftContext): void {
  for (const [prefix, entry] of draftState.touched) {
    if (entry.writes.size === 0) continue
    const current = entry.base ?? new Map<string, string>()
    for (const [key, value] of entry.writes) {
      if (value === undefined) current.delete(key)
      else current.set(key, value)
    }
    draftState.memoryState.namespaces.set(prefix, current)
  }
}
/** Perform complete on this owner's original private native draft state. */
function memoryJournalDraftComplete(
  draftState: IMemoryJournalDraftContext,
  success: boolean
): void {
  if (draftState.settled) return
  draftState.settled = true
  if (success) draftState.committed.publish(undefined)
  else draftState.rolledBack.publish(undefined)
  draftState.committed.clear()
  draftState.rolledBack.clear()
  draftState.touched.clear()
}
/** Perform writeMarker on this owner's original private native draft state. */
function memoryJournalWriteMarker(
  memoryState: IMemoryJournalContext,
  scope: Omit<ITransactionScope, 'use'>,
  txId: string
): Promise<void> {
  const current = memoryState.options.scope(scope)
  if (txId !== current.info.id)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return current.port.run(markerNamespace, (view) => view.set(txId, markerValue))
}
/** Perform hasMarker on this owner's original private native draft state. */
function memoryJournalHasMarker(
  memoryState: IMemoryJournalContext,
  txId: string
): Promise<boolean> {
  assertText(txId)
  return memoryState.options.transaction(markerLockNamespace, (port) =>
    port.run(markerNamespace, async (view) => {
      const value = await view.get(txId)
      if (value === null) return false
      if (value === markerValue) return true
      throw new StorageError(
        StorageHostErrorCode.journalRecordInvalid,
        {},
        StorageErrorText.journalRecordInvalid
      )
    })
  )
}
/** Perform removeMarker on this owner's original private native draft state. */
function memoryJournalRemoveMarker(
  memoryState: IMemoryJournalContext,
  txId: string
): Promise<void> {
  assertText(txId)
  return memoryState.options.transaction(markerLockNamespace, (port) =>
    port.run(markerNamespace, (view) => view.remove(txId))
  )
}
/** Perform clear on this owner's original private native draft state. */
function memoryJournalClear(memoryState: IMemoryJournalContext) {
  memoryState.namespaces = new Map()
}
