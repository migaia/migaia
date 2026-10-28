import { createRuntime, type IRuntime } from '@migaia/reactive'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  atomDefFactory,
  createAtomStore,
  derivedDef,
  familyDef,
  type IAtomDefinition,
  type IAtomGet,
  type IAtomStore,
  type IWritableAtomDefinition
} from '@migaia/store-keyed'
import { isMarker, type IStatePatch } from '../contract.ts'
import {
  defineMicroPlugin,
  type IAppRuntime,
  type IContractEntry,
  type IDriverMembers,
  type IHubRuntime,
  type IMicroDriver,
  type IMicroPlugin
} from '../driver.ts'
import { MicroHubErrorCode } from '../error-code.ts'
import { MicroHubErrorText } from '../error-text.ts'
import { createMicroHubError, createMicroHubTypeError } from '../errors.ts'
import { ContractMarker, ContractSection, MicroCapability } from '../text.ts'
import type { ICommitResult, IKeyedReadable, IReadable } from '../types.ts'

/** One plain state field: a single atom holding the committed (top-level frozen) value. */
type IPlainField = {
  readonly keyed: false
  readonly def: IWritableAtomDefinition<unknown>
}

/** One keyed field: one atom per id plus an atom holding the frozen id list. */
type IKeyedField = {
  readonly keyed: true
  readonly at: (id: string) => IWritableAtomDefinition<unknown>
  readonly ids: IWritableAtomDefinition<readonly string[]>
  /**
   * Membership is indexed by the frozen ids snapshot, so preview and failed patches cannot
   * desynchronize it.
   */
  readonly memberships: WeakMap<readonly string[], ReadonlySet<string>>
}

/** Per-contract state slot owned by the state driver. */
type IStateSlot = {
  readonly fields: ReadonlyMap<string, IPlainField | IKeyedField>
  readonly revision: IWritableAtomDefinition<number>
  readonly computedDefs: ReadonlyMap<string, IAtomDefinition<unknown>>
  /** Commands share one untracked accessor object; tracked derivations keep fresh result identities. */
  readonly commandValues: Record<string, unknown>
}

/** Members the state driver exposes to the persist driver. */
export type IStateDriver = IMicroDriver & {
  readonly runtime: IRuntime
  readonly store: IAtomStore
  /** Plain field atom of a contract, registering the contract's slot when needed. */
  plainField(entry: IContractEntry, field: string): IWritableAtomDefinition<unknown> | undefined
  /**
   * Commits a patch without a permission check, bumping the revision like a command. Used by
   * persistence to restore hydrated fields.
   */
  write(entry: IContractEntry, patch: IStatePatch<any>): number
}

/** Empty frozen id list shared by every keyed field's initial value. */
const NO_IDS: readonly string[] = Object.freeze([])

/** Freezes the top level of objects and arrays so another app cannot mutate committed state. */
const freezeTop = <T>(value: T): T =>
  typeof value === 'object' && value !== null ? Object.freeze(value) : value

/**
 * Builds the state values object commands, computed values and selectors receive. Properties are
 * getters, so a computed value only depends on the fields it actually reads.
 */
function stateValues(slot: Pick<IStateSlot, 'fields'>, read: IAtomGet): Record<string, unknown> {
  /** Lazily evaluated values keyed by field name. */
  const values: Record<string, unknown> = {}
  for (const [name, field] of slot.fields) {
    Object.defineProperty(values, name, {
      enumerable: true,
      get: field.keyed
        ? () => ({
            get: (id: string) => read(field.at(id)),
            get ids() {
              return read(field.ids)
            }
          })
        : () => read(field.def)
    })
  }
  return Object.freeze(values)
}

/** Creates the state driver; one atom store and runtime serve every contract of the hub. */
function createStateDriver(hub: IHubRuntime): IStateDriver {
  /** Runtime owned by the hub; graph errors are reported through the hub reporter. */
  const runtime = createRuntime({ onError: (error) => hub.report(error) })
  /** Atom store holding every contract's state. */
  const store = createAtomStore(runtime)
  /** Untracked reader used by commands. */
  const peek: IAtomGet = (def) => store.peek(def)

  /** Returns the contract's slot, creating atoms for every field on first access. */
  const slotOf = (entry: IContractEntry): IStateSlot => {
    /** Slot built by an earlier access to this contract. */
    const existing = entry.slots.get(MicroCapability.state) as IStateSlot | undefined
    if (existing) return existing
    const { contract } = entry
    /** Field atoms by name. */
    const fields = new Map<string, IPlainField | IKeyedField>()
    for (const [name, initial] of Object.entries(contract.state)) {
      /** Debug label of the field atom: `<contract>.<field>`. */
      const label = `${contract.name}.${name}`
      if (isMarker(initial, ContractMarker.keyed)) {
        fields.set(name, {
          keyed: true,
          at: familyDef<string, unknown>(() => undefined, {
            maxSize: Number.MAX_SAFE_INTEGER,
            debugLabel: label
          }),
          ids: atomDefFactory(() => NO_IDS, `${label}.ids`),
          memberships: new WeakMap<readonly string[], ReadonlySet<string>>()
        })
      } else {
        fields.set(name, {
          keyed: false,
          def: atomDefFactory(() => freezeTop(structuredClone(initial)), label)
        })
      }
    }
    /** Slot without computed values, used to build their readers. */
    const partial = { fields, revision: atomDefFactory(() => 0, `${contract.name}.revision`) }
    /** Computed atoms by name; each reads only the fields its function touches. */
    const computedDefs = new Map<string, IAtomDefinition<unknown>>()
    for (const [name, fn] of Object.entries(contract.computed)) {
      computedDefs.set(
        name,
        derivedDef(
          (get) => (fn as (state: unknown) => unknown)(stateValues(partial, get)),
          `${contract.name}.${name}`
        )
      )
    }
    /** Completed slot. */
    const slot: IStateSlot = {
      ...partial,
      computedDefs,
      commandValues: stateValues(partial, peek)
    }
    entry.slots.set(MicroCapability.state, slot)
    return slot
  }

  /**
   * Readable over one atom. `subscribe` registers with the app, so disconnect removes it; the
   * caller's unsubscribe is idempotent.
   */
  const readable = <T>(app: IAppRuntime, def: IAtomDefinition<T>): IReadable<T> => ({
    get: () => {
      app.assertConnected()
      return store.peek(def)
    },
    subscribe: (listener) => {
      app.assertConnected()
      return app.track(store.sub(def, listener))
    }
  })

  /**
   * Readable over a derived value with a stable `get()` even while unsubscribed: the value is
   * memoized per contract revision, and an equal result keeps the previous reference.
   */
  const memoReadable = <T>(
    app: IAppRuntime,
    slot: IStateSlot,
    def: IAtomDefinition<T>,
    equals: (previous: T, next: T) => boolean,
    releaseWhenIdle: boolean
  ): IReadable<T> => {
    /** Revision at which `value` was computed; -1 before the first read. */
    let at = -1
    /** Last computed value. */
    let value: T
    /** Live subscriptions; the derived instance is released when it drops to zero. */
    let subscribers = 0
    /** Keeps one snapshot across subscription changes and derived-node release. */
    const get = (): T => {
      app.assertConnected()
      /** Revision shared by imperative reads and subscription callbacks. */
      const revision = store.peek(slot.revision)
      if (revision !== at) {
        /** Read the committed computed cache rather than a separate speculative snapshot. */
        const next = runtime.untracked(() => store.get(def))
        if (at === -1 || !equals(value, next)) value = next
        at = revision
      }
      return value
    }
    return {
      get,
      subscribe: (listener) => {
        app.assertConnected()
        /** Store subscription created for this listener. */
        const stop = store.sub(def, () => {
          get()
          listener()
        })
        subscribers++
        return app.track(() => {
          stop()
          subscribers--
          if (releaseWhenIdle && subscribers === 0) store.release(def)
        })
      }
    }
  }

  /** Readable view of a keyed field. */
  const keyedReadable = (app: IAppRuntime, field: IKeyedField): IKeyedReadable<unknown> => ({
    at: (id) => {
      app.assertConnected()
      return readable(app, field.at(id))
    },
    ids: readable(app, field.ids)
  })

  /**
   * Applies a command patch inside one batch. Unknown fields throw before anything is written;
   * keyed patches add, replace or (with `undefined`) delete ids.
   */
  const commit = (entry: IContractEntry, slot: IStateSlot, patch: IStatePatch<any>): number => {
    /** Freezes a prepared value while retaining native failures on the package error cause. */
    const prepareValue = (name: string, value: unknown): unknown => {
      try {
        return freezeTop(value)
      } catch (error) {
        throw createMicroHubTypeError(
          MicroHubErrorCode.invalidOption,
          MicroHubErrorText.invalidSection(entry.contract.name, ContractSection.state, name),
          { cause: error }
        )
      }
    }
    /** Validated patch entries, collected first so a bad field writes nothing. */
    const writes: [IWritableAtomDefinition<any>, unknown][] = []
    for (const [name, value] of Object.entries(patch ?? {})) {
      /** Field definition named by the patch key; unknown keys fail before anything is written. */
      const field = slot.fields.get(name)
      if (!field) {
        throw createMicroHubTypeError(
          MicroHubErrorCode.invalidOption,
          MicroHubErrorText.unknownMember(entry.contract.name, name)
        )
      }
      if (field.keyed && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        throw createMicroHubTypeError(
          MicroHubErrorCode.invalidOption,
          MicroHubErrorText.invalidSection(entry.contract.name, ContractSection.state, name)
        )
      }
      if (!field.keyed) {
        writes.push([field.def, prepareValue(name, value)])
        continue
      }
      /** Current id list; replaced by a new frozen array only when membership changes. */
      const ids = store.peek(field.ids)
      /** The index belongs to this exact snapshot even if patch getters reenter commands. */
      const indexed = field.memberships.get(ids)
      /** Existing-value updates reuse this Set while membership keeps the same ids reference. */
      const members = indexed ?? new Set(ids)
      if (!indexed) field.memberships.set(ids, members)
      /** Removed ids are filtered once, preserving the remaining relative order. */
      let removed: Set<string> | undefined
      /** New ids retain patch enumeration order after all previously present ids. */
      let added: string[] | undefined
      for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
        /** Whether the id is already a member, deciding between delete, replace and append. */
        const present = members.has(id)
        if (item === undefined) {
          if (!present) continue
          writes.push([field.at(id), undefined])
          if (!removed) removed = new Set()
          removed.add(id)
        } else {
          writes.push([field.at(id), prepareValue(name, item)])
          if (!present) (added ??= []).push(id)
        }
      }
      if (removed || added) {
        /** The prepared id list is not published if a later patch field fails validation. */
        const nextIds = removed ? ids.filter((id) => !removed.has(id)) : [...ids]
        if (added) for (const id of added) nextIds.push(id)
        writes.push([field.ids, Object.freeze(nextIds)])
      }
    }
    /** Revision after this commit; preparation above can fail without changing any atom. */
    const revision = store.peek(slot.revision) + 1
    writes.push([slot.revision, revision])
    // This driver creates only source definitions; the general family type also admits derived writes.
    store.setMany(writes as Parameters<IAtomStore['setMany']>[0])
    return revision
  }

  /** Command members of a view; each call checks the caller's write permission. */
  const commandsOf = (
    entry: IContractEntry,
    slot: IStateSlot,
    app: IAppRuntime
  ): Record<string, (...args: unknown[]) => ICommitResult> => {
    /** Command functions keyed by command name. */
    const commands: Record<string, (...args: unknown[]) => ICommitResult> = {}
    const { contract } = entry
    for (const [name, fn] of Object.entries(contract.commands)) {
      Object.assign(commands, {
        [name]: (...args: unknown[]) => {
          app.assertConnected()
          if (entry.owner?.name !== app.name && !contract.writers.includes(app.name)) {
            throw createMicroHubError(
              MicroHubErrorCode.writeDenied,
              MicroHubErrorText.writeDenied(contract.name, app.name)
            )
          }
          /** Patch computed from current committed state. */
          const patch = (fn as (state: unknown, ...rest: unknown[]) => unknown)(
            slot.commandValues,
            ...args
          )
          /** Capture then once and observe rejected async results before rejecting this command. */
          const inspection = inspectThenable(patch)
          if ('error' in inspection) {
            throw createMicroHubTypeError(
              MicroHubErrorCode.commandAsync,
              MicroHubErrorText.commandAsync(contract.name, name),
              { cause: inspection.error }
            )
          }
          if (inspection.then !== undefined) {
            observeThenableRejection(patch, inspection, (error) => hub.report(error))
            throw createMicroHubTypeError(
              MicroHubErrorCode.commandAsync,
              MicroHubErrorText.commandAsync(contract.name, name)
            )
          }
          return Object.freeze({ revision: commit(entry, slot, patch as IStatePatch<any>) })
        }
      })
    }
    return Object.freeze(commands)
  }

  return {
    kind: MicroCapability.state,
    runtime,
    store,
    plainField: (entry, field) => {
      /** Field definition of the requested name, if the contract declares it. */
      const found = slotOf(entry).fields.get(field)
      return found && !found.keyed ? found.def : undefined
    },
    write: (entry, patch) => commit(entry, slotOf(entry), patch),
    view: (entry: IContractEntry, app: IAppRuntime): IDriverMembers => {
      /** State slot of the contract; created on first access. */
      const slot = slotOf(entry)
      /** Readable per state field. */
      const state: Record<string, unknown> = {}
      for (const [name, field] of slot.fields) {
        state[name] = field.keyed ? keyedReadable(app, field) : readable(app, field.def)
      }
      /** Readable per computed value, memoized per revision. */
      const computed: Record<string, unknown> = {}
      for (const [name, def] of slot.computedDefs) {
        computed[name] = memoReadable(app, slot, def, Object.is, false)
      }
      return {
        state: Object.freeze(state),
        computed: Object.freeze(computed),
        commands: commandsOf(entry, slot, app),
        revision: readable(app, slot.revision),
        select: <R>(
          selector: (state: unknown) => R,
          equals: (a: R, b: R) => boolean = Object.is
        ) => {
          app.assertConnected()
          return memoReadable(
            app,
            slot,
            derivedDef((get) => selector(stateValues(slot, get)), entry.contract.name, equals),
            equals,
            true
          )
        }
      }
    },
    dispose: () => store.dispose()
  }
}

/**
 * State capability: contract `state`, `computed`, `commands`, `select` and `keyed()` fields. One
 * atom per field and per keyed id, so a change notifies only the subscribers of what changed.
 */
export function state(): IMicroPlugin {
  return defineMicroPlugin(MicroCapability.state, [], createStateDriver)
}

/** Reads the state driver of a hub runtime; used by capabilities that build on state. */
export const stateDriverOf = (hub: IHubRuntime): IStateDriver =>
  hub.driver(MicroCapability.state) as IStateDriver
