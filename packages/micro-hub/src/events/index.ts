import {
  EventDelivery,
  EventDispatchPolicy,
  createEventChannel,
  invokeTask,
  type ICanonicalEventChannel,
  type IEventChannel
} from '@migaia/event-subscriber'
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
import type { IRequestOptions } from '../types.ts'

/** Options of the {@link events} capability. */
export type IEventsOptions = {
  /**
   * Maximum listener calls one top-level `emit` may cause, nested emits included. Stops two apps
   * that emit in reaction to each other from looping forever. Default 10 000.
   */
  readonly publishBudget?: number
}

/** A request waiting for its result; rejected with `OWNER_GONE` when the owner leaves. */
type IInFlight = { readonly reject: (error: Error) => void; readonly member: string }

/** Per-contract slot owned by the events driver. */
type IEventsSlot = {
  /** One queued channel per declared event. */
  readonly channels: ReadonlyMap<string, IEventChannel<unknown>>
  /** Task channel; the owner subscribes one handler per request with `taskId` = request name. */
  readonly requests: ICanonicalEventChannel<unknown, unknown>
  /** Request names that currently have a handler. */
  readonly handled: Set<string>
  /** Announces a newly registered handler name to callers waiting for the owner. */
  readonly registered: IEventChannel<string>
  /** Requests in flight against the current owner. */
  readonly inFlight: Set<IInFlight>
}

/** Default value of {@link IEventsOptions.publishBudget}. */
const DEFAULT_PUBLISH_BUDGET = 10_000

/** Creates the events driver. */
function createEventsDriver(hub: IHubRuntime, options: IEventsOptions): IMicroDriver {
  /** Budget shared by every event channel of this hub. */
  const publishBudget = options.publishBudget ?? DEFAULT_PUBLISH_BUDGET
  /** Listener failures go to the hub reporter; they never reach the emitter. */
  const report = ({ error }: { readonly error: unknown }): void => hub.report(error)

  /** Returns the contract slot, creating channels on first access. */
  const slotOf = (entry: IContractEntry): IEventsSlot => {
    /** Slot built by an earlier access to this contract. */
    const existing = entry.slots.get(MicroCapability.events) as IEventsSlot | undefined
    if (existing) return existing
    /** Event channels by event name. */
    const channels = new Map<string, IEventChannel<unknown>>()
    for (const name of Object.keys(entry.contract.events)) {
      channels.set(
        name,
        createEventChannel<unknown>({
          dispatchPolicy: EventDispatchPolicy.queued,
          publishBudget,
          report
        })
      )
    }
    /** New slot; registered on the entry before it is returned. */
    const slot: IEventsSlot = {
      channels,
      requests: createEventChannel<unknown, unknown>({ report }),
      handled: new Set(),
      registered: createEventChannel<string>({ report }),
      inFlight: new Set()
    }
    entry.slots.set(MicroCapability.events, slot)
    return slot
  }

  /** Throws `INVALID_OPTION` when `member` is not a request of the contract. */
  const assertRequest = (entry: IContractEntry, member: string): void => {
    if (!isMarker(entry.contract.requests[member], ContractMarker.request)) {
      throw createMicroHubTypeError(
        MicroHubErrorCode.invalidOption,
        MicroHubErrorText.unknownMember(entry.contract.name, member)
      )
    }
  }

  /**
   * Calls the owner's handler. The promise is tracked so an owner leaving mid-call rejects it with
   * `OWNER_GONE` instead of leaving the caller waiting on a handler nobody owns.
   */
  const dispatch = (slot: IEventsSlot, member: string, input: unknown): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      /** In-flight record removed by whichever settles first: the handler or the owner leaving. */
      const record: IInFlight = { reject, member }
      slot.inFlight.add(record)
      /** Handler settlement; task selection can throw synchronously if the handler just left. */
      let settlement: Promise<unknown>
      try {
        settlement = invokeTask(slot.requests, member, input)
      } catch (error) {
        slot.inFlight.delete(record)
        reject(error)
        return
      }
      settlement.then(
        (value) => {
          if (slot.inFlight.delete(record)) resolve(value)
        },
        (error: unknown) => {
          if (slot.inFlight.delete(record)) reject(error)
        }
      )
    })

  /** Waits until a handler for `member` is registered, the deadline passes, or `app` leaves. */
  const waitForHandler = (
    slot: IEventsSlot,
    entry: IContractEntry,
    app: IAppRuntime,
    member: string,
    ms: number
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      /** Set by the first outcome; later outcomes are ignored. */
      let settled = false
      /** Settles once and releases the timer, the subscription and the app tracking. */
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stopRegistered()
        untrack()
        if (error) reject(error)
        else resolve()
      }
      /** Deadline for the owner's handler to appear. */
      const timer = setTimeout(
        () =>
          settle(
            createMicroHubError(
              MicroHubErrorCode.ownerTimeout,
              MicroHubErrorText.ownerTimeout(entry.contract.name, member, ms)
            )
          ),
        ms
      )
      /** Resolves when the awaited handler is registered. */
      const stopRegistered = slot.registered.subscribe((event) => {
        if (event.value === member) settle()
      })
      /** Rejects when the waiting app disconnects; a no-op once settled. */
      const untrack = app.track(() =>
        settle(
          createMicroHubError(
            MicroHubErrorCode.appDisconnected,
            MicroHubErrorText.appDisconnected(app.name)
          )
        )
      )
    })

  return {
    kind: MicroCapability.events,
    view: (entry: IContractEntry, app: IAppRuntime): IDriverMembers => {
      /** Events slot of the contract; created on first access. */
      const slot = slotOf(entry)
      /** `on` members per event. */
      const events: Record<string, unknown> = {}
      for (const [name, channel] of slot.channels) {
        events[name] = Object.freeze({
          on: (listener: (payload: unknown) => void) => {
            app.assertConnected()
            return app.track(channel.subscribe(listener, { delivery: EventDelivery.value }))
          }
        })
      }
      /** Request callers per request. */
      const requests: Record<string, unknown> = {}
      for (const name of Object.keys(entry.contract.requests)) {
        requests[name] = async (input: unknown, options: IRequestOptions = {}) => {
          app.assertConnected()
          if (!slot.handled.has(name)) {
            if (options.waitForOwner === undefined) {
              throw createMicroHubError(
                MicroHubErrorCode.ownerAbsent,
                MicroHubErrorText.ownerAbsent(entry.contract.name, name)
              )
            }
            await waitForHandler(slot, entry, app, name, options.waitForOwner)
            // Registration resumes us in a microtask; either app may leave before that runs.
            app.assertConnected()
            if (!slot.handled.has(name)) {
              throw createMicroHubError(
                MicroHubErrorCode.ownerAbsent,
                MicroHubErrorText.ownerAbsent(entry.contract.name, name)
              )
            }
          }
          return dispatch(slot, name, input)
        }
      }
      return { events: Object.freeze(events), requests: Object.freeze(requests) }
    },
    own: (entry: IContractEntry, owner: IAppRuntime): IDriverMembers => {
      /** Events slot of the contract; created on first access. */
      const slot = slotOf(entry)
      // Registered first, so it runs last: handlers are gone before callers learn the owner left.
      owner.track(() => {
        for (const record of slot.inFlight) {
          record.reject(
            createMicroHubError(
              MicroHubErrorCode.ownerGone,
              MicroHubErrorText.ownerGone(entry.contract.name, record.member)
            )
          )
        }
        slot.inFlight.clear()
      })
      /** `on` + `emit` members per event. */
      const events: Record<string, unknown> = {}
      for (const [name, channel] of slot.channels) {
        events[name] = Object.freeze({
          on: (listener: (payload: unknown) => void) => {
            owner.assertConnected()
            return owner.track(channel.subscribe(listener, { delivery: EventDelivery.value }))
          },
          emit: (payload: unknown) => {
            owner.assertConnected()
            if (entry.owner !== owner) {
              throw createMicroHubError(
                MicroHubErrorCode.emitDenied,
                MicroHubErrorText.emitDenied(entry.contract.name, owner.name)
              )
            }
            try {
              channel.publish(payload)
            } catch (error) {
              // Listener failures and budget exhaustion belong to listeners, not to the emitter.
              hub.report(error)
            }
          }
        })
      }
      return {
        events: Object.freeze(events),
        handle: (member: string, handler: (input: unknown) => unknown) => {
          owner.assertConnected()
          assertRequest(entry, member)
          if (slot.handled.has(member)) {
            throw createMicroHubError(
              MicroHubErrorCode.handlerDuplicated,
              MicroHubErrorText.handlerDuplicated(entry.contract.name, member)
            )
          }
          /** Task subscription answering this request. */
          const stop = slot.requests.subscribe(handler, {
            delivery: EventDelivery.value,
            taskId: member
          })
          slot.handled.add(member)
          /** Unregisters the handler; runs at most once. */
          const unregister = owner.track(() => {
            stop()
            slot.handled.delete(member)
          })
          try {
            slot.registered.publish(member)
          } catch (error) {
            hub.report(error)
          }
          return unregister
        }
      }
    }
  }
}

/**
 * Events capability: contract `events` (owner emits, every app listens) and `requests` (owner
 * answers with one handler, every app calls).
 */
export function events(options: IEventsOptions = {}): IMicroPlugin {
  return defineMicroPlugin(MicroCapability.events, [], (hub) => createEventsDriver(hub, options))
}
