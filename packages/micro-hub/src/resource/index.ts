import { createRuntime, type IReactiveSignal } from '@migaia/reactive'
import { Resource, ResourceStatus, type IResourceState } from '@migaia/resource'
import { isMarker } from '../contract.ts'
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
import { ContractMarker, MicroCapability } from '../text.ts'
import {
  MicroResourceStatus,
  type IMicroResourceFetcher,
  type IMicroResourceState,
  type IReadable
} from '../types.ts'

/** Per-contract slot: one signal per resource name holding the owner's current `Resource`. */
type IResourceSlot = ReadonlyMap<string, IReactiveSignal<Resource<unknown> | undefined>>

/** Snapshot shown while no owner has provided the resource. */
const IDLE: IMicroResourceState<never> = Object.freeze({
  status: MicroResourceStatus.idle,
  data: undefined,
  error: undefined
})

/** Creates the resource driver; it owns a runtime separate from state, sharing nothing with it. */
function createResourceDriver(hub: IHubRuntime): IMicroDriver {
  /** Runtime of every shared resource; graph errors go to the hub reporter. */
  const runtime = createRuntime({ onError: (error) => hub.report(error) })
  /** Snapshot cache so `get()` keeps its reference while the underlying state is unchanged. */
  const snapshots = new WeakMap<IResourceState<unknown>, IMicroResourceState<unknown>>()

  /** Maps a `@migaia/resource` state to the hub's stable snapshot shape. */
  const toSnapshot = (state: IResourceState<unknown>): IMicroResourceState<unknown> => {
    /** Snapshot already built for this exact state object. */
    let snapshot = snapshots.get(state)
    if (!snapshot) {
      snapshot = Object.freeze({
        status: state.status,
        data: state.status === ResourceStatus.success ? state.data : undefined,
        error:
          state.status === ResourceStatus.error || state.status === ResourceStatus.cancelled
            ? state.error
            : undefined
      })
      snapshots.set(state, snapshot)
    }
    return snapshot
  }

  /** Returns the contract slot, creating one signal per declared resource. */
  const slotOf = (entry: IContractEntry): IResourceSlot => {
    /** Slot built by an earlier access to this contract. */
    const existing = entry.slots.get(MicroCapability.resource) as IResourceSlot | undefined
    if (existing) return existing
    /** Current resource per name; `undefined` until the owner provides it. */
    const slot = new Map<string, IReactiveSignal<Resource<unknown> | undefined>>()
    for (const name of Object.keys(entry.contract.resources)) {
      slot.set(name, runtime.signal<Resource<unknown> | undefined>(undefined))
    }
    entry.slots.set(MicroCapability.resource, slot)
    return slot
  }

  /** Readable of a resource's state; subscribing observes the resource, which starts its fetch. */
  const stateReadable = (
    app: IAppRuntime,
    current: IReactiveSignal<Resource<unknown> | undefined>
  ): IReadable<IMicroResourceState<unknown>> => ({
    get: () => {
      app.assertConnected()
      /** Resource currently provided by the owner, if any. */
      const resource = current.peek()
      return resource ? toSnapshot(resource.peekState()) : IDLE
    },
    subscribe: (listener) => {
      app.assertConnected()
      /** False during the effect's first run, which only establishes dependencies. */
      let started = false
      /** Effect tracking the provider signal and the resource state. */
      const effect = runtime.effect(() => {
        void current.value?.state
        if (started) runtime.untracked(listener)
        started = true
      })
      return app.track(() => effect.dispose())
    }
  })

  return {
    kind: MicroCapability.resource,
    view: (entry: IContractEntry, app: IAppRuntime): IDriverMembers => {
      /** Resource slot of the contract; created on first access. */
      const slot = slotOf(entry)
      /** View per resource. */
      const resources: Record<string, unknown> = {}
      for (const [name, current] of slot) {
        resources[name] = Object.freeze({
          state: stateReadable(app, current),
          read: (): Promise<unknown> => {
            app.assertConnected()
            /** Resource currently provided by the owner, if any. */
            const resource = current.peek()
            if (!resource) {
              return Promise.reject(
                createMicroHubError(
                  MicroHubErrorCode.ownerAbsent,
                  MicroHubErrorText.ownerAbsent(entry.contract.name, name)
                )
              )
            }
            /** State at call time, deciding whether to return data, wait, or refetch. */
            const state = resource.peekState()
            if (state.status === ResourceStatus.success) return Promise.resolve(state.data)
            if (state.status === ResourceStatus.pending) return resource.promise
            return resource.refetch()
          },
          refetch: () => {
            app.assertConnected()
            // Failures land in the resource state; the reporter also receives them.
            void current
              .peek()
              ?.refetch()
              .catch((error: unknown) => hub.report(error))
          }
        })
      }
      return { resources: Object.freeze(resources) }
    },
    own: (entry: IContractEntry, owner: IAppRuntime): IDriverMembers => {
      /** Resource slot of the contract; created on first access. */
      const slot = slotOf(entry)
      return {
        provide: (name: string, fetcher: IMicroResourceFetcher<unknown>) => {
          owner.assertConnected()
          if (!isMarker(entry.contract.resources[name], ContractMarker.resource)) {
            throw createMicroHubTypeError(
              MicroHubErrorCode.invalidOption,
              MicroHubErrorText.unknownMember(entry.contract.name, name)
            )
          }
          /** Provider signal of the named resource; validated to exist just above. */
          const current = slot.get(name) as IReactiveSignal<Resource<unknown> | undefined>
          if (current.peek()) {
            throw createMicroHubError(
              MicroHubErrorCode.handlerDuplicated,
              MicroHubErrorText.handlerDuplicated(entry.contract.name, name)
            )
          }
          /** Shared resource; created lazily so nothing is fetched until someone reads it. */
          const resource = new Resource<unknown>((context) => fetcher(context.signal), runtime, {
            autoStart: false,
            debugName: `${entry.contract.name}.${name}`
          })
          current.value = resource
          return owner.track(() => {
            current.value = undefined
            resource.dispose()
          })
        }
      }
    }
  }
}

/**
 * Resource capability: contract `resources` are async values the owner fetches once for every app.
 * Concurrent reads share one request. Needs the optional peer `@migaia/resource`.
 */
export function resources(): IMicroPlugin {
  return defineMicroPlugin(MicroCapability.resource, [], createResourceDriver)
}
