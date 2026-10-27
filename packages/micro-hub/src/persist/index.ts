import type { IKeyValueStore } from '@migaia/storage-contract'
import { persistUnit } from '@migaia/store-persist'
import type { IContract } from '../contract.js'
import {
  defineMicroPlugin,
  type IAppRuntime,
  type IContractEntry,
  type IDriverMembers,
  type IHubRuntime,
  type IMicroDriver,
  type IMicroPlugin
} from '../driver.js'
import { MicroHubErrorCode } from '../error-code.js'
import { MicroHubErrorText } from '../error-text.js'
import { createMicroHubTypeError } from '../errors.js'
import { stateDriverOf } from '../state/index.js'
import { MicroCapability } from '../text.js'
import type { IOwnOptions } from '../types.js'

/** Options of the {@link persist} capability. */
export type IPersistOptions = {
  /**
   * Any `IKeyValueStore` the persisted fields are written to. Usually a backend factory result from
   * `@migaia/storage-plugin-browser` such as `localStorageHost({ namespace: 'shop' })` or `indexedDbHost({
   * dbName: 'shop' })`; despite the `Host` suffix those factories only return a store, no storage
   * host is created. The hub borrows the store and never disposes it.
   */
  readonly store: Pick<IKeyValueStore, 'capabilities' | 'get' | 'set' | 'remove' | 'keys'>
  /** Quiet period before a write; default 0 writes after each commit. */
  readonly debounceMs?: number
  /** Prefix prepended to every storage key; default `micro-hub:`. */
  readonly keyPrefix?: string
}

/** Default value of {@link IPersistOptions.keyPrefix}. */
const DEFAULT_KEY_PREFIX = 'micro-hub:'

/** Creates the persist driver; it only adds owner members. */
function createPersistDriver(hub: IHubRuntime, options: IPersistOptions): IMicroDriver {
  /** Outgoing attachment writes by actual archive key; each barrier includes its predecessor. */
  const pendingDisposals = new Map<string, Promise<void>>()
  return {
    kind: MicroCapability.persist,
    view: () => ({}),
    own: (
      entry: IContractEntry,
      owner: IAppRuntime,
      ownOptions: IOwnOptions<IContract>
    ): IDriverMembers => {
      /** Fields the owner asked to persist. */
      const fields = (ownOptions.persist ?? []) as readonly string[]
      if (fields.length === 0) return {}
      /** State driver; persistence reads and writes plain fields through it. */
      const state = stateDriverOf(hub)
      /** Field atoms in the order given, validated before anything is read from storage. */
      const defs = fields.map((field) => {
        /** Atom of the named plain field; keyed or unknown fields are rejected. */
        const def = state.plainField(entry, field)
        if (!def) {
          throw createMicroHubTypeError(
            MicroHubErrorCode.invalidOption,
            MicroHubErrorText.unknownMember(entry.contract.name, field)
          )
        }
        return [field, def] as const
      })
      /** Fields initialized by an earlier ownership keep their authoritative in-memory values. */
      const retained =
        (entry.slots.get(MicroCapability.persist) as Set<string> | undefined) ?? new Set<string>()
      entry.slots.set(MicroCapability.persist, retained)
      /** Stable initial references identify writes made even if ownership ends during hydration. */
      const initial = new Map(defs.map(([field, def]) => [field, state.store.peek(def)]))
      /** Shared archive identity, also used when ownership changes the contract's attachment. */
      const key = `${options.keyPrefix ?? DEFAULT_KEY_PREFIX}${ownOptions.persistKey ?? entry.contract.name}`
      /** Capture only earlier attachments, so this handle never waits on its own disposal. */
      const predecessor = pendingDisposals.get(key)
      /** Keeps the canonical persistUnit write chain behind all older mutations of this archive. */
      const afterPredecessor = <T>(operation: () => Promise<T>): Promise<T> =>
        predecessor === undefined ? operation() : predecessor.then(operation)
      /** Borrowed store with an ownership handoff barrier; persistUnit still owns all scheduling. */
      const storage: IPersistOptions['store'] = {
        capabilities: options.store.capabilities,
        get: (storageKey, context) =>
          afterPredecessor(() => options.store.get(storageKey, context)),
        set: (storageKey, value, context) =>
          afterPredecessor(() => options.store.set(storageKey, value, context)),
        remove: (storageKey, context) =>
          afterPredecessor(() => options.store.remove(storageKey, context)),
        keys: (context) => options.store.keys(context)
      }
      /** Persistence of the selected fields; store-persist handles hydrate races and debounce. */
      const handle = persistUnit(
        {
          snapshot: () => {
            /** Current values of the persisted fields. */
            const values: Record<string, unknown> = {}
            for (const [field, def] of defs) values[field] = state.store.peek(def)
            return values
          },
          restore: (persisted) => {
            /** Persisted values limited to known fields. */
            const patch: Record<string, unknown> = {}
            for (const [field] of defs) {
              if (!retained.has(field) && Object.hasOwn(persisted, field)) {
                patch[field] = persisted[field]
              }
            }
            if (Object.keys(patch).length > 0) state.write(entry, patch)
          },
          subscribe: (onChange) => {
            /** One store subscription per persisted field. */
            const stops = defs.map(([, def]) => state.store.sub(def, onChange))
            return () => {
              for (const stop of stops) stop()
            }
          }
        },
        {
          key,
          runtime: state.runtime,
          storage,
          version: entry.contract.version,
          // A new major version means a new shape: start from the contract's initial values
          // instead of failing hydration and closing writes.
          migrations: { reset: () => ({}) },
          debounceMs: options.debounceMs ?? 0
        }
      )
      // Hydration owns its own failure channel, independently of later disposal.
      void handle.ready.catch((error: unknown) => hub.report(error))
      owner.track(() => {
        for (const [field, def] of defs) {
          if (handle.hydrated.peek() || !Object.is(initial.get(field), state.store.peek(def))) {
            retained.add(field)
          }
        }
        /** Disposal stops synchronously; failures remain observable while handoff can still proceed. */
        const completion = handle.disposeAsync().then(
          () => {
            if (handle.writeError.value !== undefined) hub.report(handle.writeError.value)
          },
          (error: unknown) => hub.report(error)
        )
        /** An attachment released before hydration must not drop an older unfinished write. */
        const tail = predecessor === undefined ? completion : predecessor.then(() => completion)
        pendingDisposals.set(key, tail)
        void tail.then(() => {
          if (pendingDisposals.get(key) === tail) pendingDisposals.delete(key)
        })
      })
      return { persistence: handle }
    },
    /** Keeps hub disposal pending until all outgoing archive mutations have actually settled. */
    dispose: async () => {
      await Promise.all(pendingDisposals.values())
    }
  }
}

/**
 * Persist capability: `own(contract, { persist: [...] })` writes the selected plain fields to the
 * store and restores them when the owner starts. Requires the state capability.
 */
export function persist(options: IPersistOptions): IMicroPlugin {
  return defineMicroPlugin(MicroCapability.persist, [MicroCapability.state], (hub) =>
    createPersistDriver(hub, options)
  )
}
