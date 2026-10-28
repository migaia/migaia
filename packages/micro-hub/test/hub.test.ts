import { EventSubscriberErrorCode } from '@migaia/event-subscriber'
import { PluginHostErrorCode, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { events } from '../src/events/index.ts'
import {
  MicroCapability,
  MicroHubErrorCode,
  createMicroHub,
  defineContract,
  event,
  getMicroHub,
  request,
  resource,
  type IMicroHub,
  type IMicroPlugin
} from '../src/index.ts'
import { state } from '../src/state/index.ts'
import type { IAppRuntime, IDriverMembers } from '../src/driver.ts'

/** Hub created by the current case; teardown prevents singleton state leaking between cases. */
let hub: IMicroHub | undefined

afterEach(async () => {
  await hub?.dispose()
  hub = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Creates a typed state contract shared by lifecycle cases. */
function counter(name = 'counter') {
  return defineContract(name, {
    version: 1,
    state: { count: 0 },
    commands: { add: (current, amount: number) => ({ count: current.count + amount }) }
  })
}

/** A capability fixture exercising the same plugin boundary accepted by createMicroHub. */
function capability(options: {
  view?: () => IDriverMembers
  own?: (owner: IAppRuntime) => IDriverMembers
  dispose?: () => void | Promise<void>
}): IMicroPlugin {
  return {
    kind: MicroCapability.state,
    requires: [],
    bind: () =>
      definePlugin(
        'fixture-state',
        (core) => ({
          install: () => {
            if (options.dispose) core.onDispose(options.dispose)
            return {
              stateDriver: {
                kind: MicroCapability.state,
                view: () => options.view?.() ?? {},
                own: (_entry: unknown, owner: IAppRuntime) => options.own?.(owner) ?? {}
              }
            }
          }
        }),
        {}
      )
  }
}

/** Listener failures cross the event boundary as aggregates retaining the exact original error. */
function expectPublishFailure(error: unknown, original: Error): void {
  expect(error).toBeInstanceOf(AggregateError)
  expect(error).toMatchObject({ code: EventSubscriberErrorCode.publishFailed })
  /** Runtime assertion above establishes the public aggregate shape before inspecting its chain. */
  const aggregate = error as AggregateError
  expect(aggregate.cause).toBe(original)
  expect(aggregate.errors).toContain(original)
}

describe('hub singleton and capability installation', () => {
  it('requires creation, rejects a second hub, and permits creation after disposal', async () => {
    expect(() => getMicroHub()).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.hubNotCreated })
    )
    hub = createMicroHub({ plugins: [] })
    expect(getMicroHub()).toBe(hub)
    expect(() => createMicroHub({ plugins: [] })).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.hubAlreadyCreated })
    )
    await hub.dispose()
    expect(() => getMicroHub()).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.hubNotCreated })
    )
    hub = createMicroHub({ plugins: [] })
    expect(getMicroHub()).toBe(hub)
  })

  it('checks capability dependencies before binding any plugin', () => {
    /** Binding must remain untouched when a prerequisite is absent. */
    const bind = vi.fn()
    expect(() =>
      createMicroHub({
        plugins: [{ kind: MicroCapability.persist, requires: [MicroCapability.state], bind }]
      })
    ).toThrow(expect.objectContaining({ code: MicroHubErrorCode.pluginMissing }))
    expect(bind).not.toHaveBeenCalled()
    hub = createMicroHub({ plugins: [] })
  })

  it('leaves the singleton available for retry when capability installation fails', () => {
    /** Exact install failure must survive plugin-host rollback. */
    const failure = new Error('installation failed')
    /** Plugin-host adds its install boundary while retaining the original failure as cause. */
    let installFailure: Error | undefined
    try {
      createMicroHub({
        plugins: [
          {
            kind: MicroCapability.state,
            requires: [],
            bind: () =>
              definePlugin(
                'failed-state',
                () => ({
                  install: () => {
                    throw failure
                  }
                }),
                {}
              )
          }
        ]
      })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      installFailure = error
    }
    expect(installFailure).toMatchObject({ code: PluginHostErrorCode.pluginInstallFailed })
    expect(installFailure?.cause).toBe(failure)
    hub = createMicroHub({ plugins: [] })
  })

  it.each([
    defineContract('needs-state', { version: 1, state: { value: 1 } }),
    defineContract('needs-computed', { version: 1, computed: { value: () => 1 } }),
    defineContract('needs-command', { version: 1, commands: { update: () => ({}) } }),
    defineContract('needs-event', { version: 1, events: { changed: event() } }),
    defineContract('needs-request', { version: 1, requests: { value: request() } }),
    defineContract('needs-resource', { version: 1, resources: { value: resource() } })
  ])('rejects absent capabilities needed by $name', (contract) => {
    hub = createMicroHub({ plugins: [] })
    expect(() => hub!.connect('consumer').use(contract)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.pluginMissing })
    )
  })

  it('provides empty sections and an inert revision without optional capabilities', () => {
    hub = createMicroHub({ plugins: [] })
    /** An empty contract needs no capability. */
    const contract = defineContract('empty', { version: 1 })
    /** Base view keeps the framework-neutral shape even without state. */
    const owned = hub.connect('shell').own(contract)
    expect(owned).toMatchObject({
      state: {},
      computed: {},
      commands: {},
      events: {},
      requests: {},
      resources: {}
    })
    expect(owned.revision.get()).toBe(0)
    expect(owned.revision.subscribe(vi.fn())()).toBeUndefined()
    expect(() => owned.select(() => 1)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.pluginMissing })
    )
    expect(() => owned.handle('missing' as never, (() => undefined) as never)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.pluginMissing })
    )
    expect(() => owned.provide('missing' as never, (async () => undefined) as never)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.pluginMissing })
    )
  })

  it('rejects empty-view revision reads, subscriptions and selections after disconnect', async () => {
    hub = createMicroHub({ plugins: [] })
    /** Empty contracts use the core revision fallback. */
    const contract = defineContract('empty-disconnect', { version: 1 })
    /** App owning the fallback view. */
    const app = hub.connect('consumer')
    /** Every callable view member follows the disconnected-app contract. */
    const view = app.use(contract)
    await app.disconnect()
    expect(() => view.revision.get()).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
    )
    expect(() => view.revision.subscribe(vi.fn())).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
    )
    expect(() => view.select(() => 1)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
    )
  })
})

describe('hub error reporting', () => {
  it('uses the host global reporter for listener failures by default', () => {
    /** Default reporting preserves the original listener failure. */
    const failure = new Error('listener failed')
    /** Host-provided global reporter receives the original failure. */
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    hub = createMicroHub({ plugins: [events()] })
    /** Event-only contract for the reporting path. */
    const contract = defineContract('global-report', { version: 1, events: { changed: event() } })
    /** Owner can both subscribe and emit. */
    const owned = hub.connect('shell').own(contract)
    owned.events.changed.on(() => {
      throw failure
    })
    expect(() => owned.events.changed.emit(undefined)).not.toThrow()
    expect(reportError).toHaveBeenCalledTimes(1)
    expectPublishFailure(reportError.mock.calls[0]?.[0], failure)
  })

  it('falls back to console.error when the host has no reportError', () => {
    /** Listener failure reaching the last-resort reporting path. */
    const failure = new Error('console listener failed')
    /** Captures reporting without printing expected test failures. */
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('reportError', undefined)
    hub = createMicroHub({ plugins: [events()] })
    /** Event contract needs no state capability. */
    const contract = defineContract('console-report', { version: 1, events: { changed: event() } })
    /** Event owner drives the public error path. */
    const owned = hub.connect('shell').own(contract)
    owned.events.changed.on(() => {
      throw failure
    })
    owned.events.changed.emit(undefined)
    expect(reportError).toHaveBeenCalledTimes(1)
    expectPublishFailure(reportError.mock.calls[0]?.[0], failure)
  })

  it('reports a throwing custom reporter and the original error through the host', () => {
    /** Original error must remain observable even when the custom reporter fails. */
    const failure = new Error('original listener failed')
    /** Error caused by the application reporter itself. */
    const reporterFailure = new Error('reporter failed')
    /** Final host error boundary observes both failures in order. */
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    hub = createMicroHub({
      plugins: [events()],
      report: () => {
        throw reporterFailure
      }
    })
    /** Event contract drives the reporter boundary through its public API. */
    const contract = defineContract('throwing-report', { version: 1, events: { changed: event() } })
    /** Owner whose listener fails. */
    const owned = hub.connect('shell').own(contract)
    owned.events.changed.on(() => {
      throw failure
    })
    expect(() => owned.events.changed.emit(undefined)).not.toThrow()
    expect(reportError).toHaveBeenCalledTimes(2)
    expect(reportError.mock.calls[0]?.[0]).toBe(reporterFailure)
    expectPublishFailure(reportError.mock.calls[1]?.[0], failure)
  })
})

describe('app and contract lifecycle', () => {
  it('tracks connected app order and rejects duplicate and invalid names', () => {
    hub = createMicroHub({ plugins: [] })
    hub.connect('shell')
    hub.connect('child')
    expect(hub.apps).toEqual(['shell', 'child'])
    expect(() => hub!.connect('shell')).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appAlreadyConnected })
    )
    expect(() => hub!.connect('')).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.invalidOption })
    )
    expect(() => hub!.connect('child.view')).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.invalidOption })
    )
  })

  it('caches views by canonical contract and rejects incompatible major versions', () => {
    hub = createMicroHub({ plugins: [state()] })
    /** Consumer reuses the first definition registered under the same name and version. */
    const app = hub.connect('consumer')
    /** Canonical definition stored in the hub. */
    const first = counter()
    /** Another same-version definition resolves to the canonical view. */
    const sameVersion = counter()
    /** Cached view for this app. */
    const view = app.use(first)
    expect(app.use(first)).toBe(view)
    expect(app.use(sameVersion)).toBe(view)
    expect(view.contract).toBe(first)
    expect(() => app.use(defineContract('counter', { version: 2 }))).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.contractVersionMismatch })
    )
  })

  it('allows ownership handover and preserves the shared state', () => {
    hub = createMicroHub({ plugins: [state()] })
    /** Contract state outlives each ownership generation. */
    const contract = counter()
    /** First owner of the contract. */
    const first = hub.connect('first')
    /** Next owner can connect before handover. */
    const second = hub.connect('second')
    /** Ownership claimed by the first app. */
    const owned = first.own(contract)
    owned.commands.add(2)
    expect(() => second.own(contract)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.contractOwned })
    )
    owned.release()
    owned.release()
    expect(() => owned.commands.add(1)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.writeDenied })
    )
    /** Successor reads the same committed state. */
    const successor = second.own(contract)
    expect(successor.state.count.get()).toBe(2)
    successor.commands.add(3)
    expect(first.use(contract).state.count.get()).toBe(5)
  })

  it('rejects unavailable persistence before claiming ownership', () => {
    hub = createMicroHub({ plugins: [state()] })
    /** App retries ownership after correcting the missing capability request. */
    const app = hub.connect('shell')
    /** State-only contract used for persistence admission. */
    const contract = counter()
    expect(() => app.own(contract, { persist: ['count'] })).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.pluginMissing })
    )
    expect(app.own(contract).state.count.get()).toBe(0)
  })

  it('rolls back ownership when building the base view fails', () => {
    /** The first view fails before any owner members can be created. */
    const failure = new Error('view failed')
    /** A recovered capability must allow a second ownership attempt. */
    const view = vi
      .fn()
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockReturnValue({})
    hub = createMicroHub({ plugins: [capability({ view })] })
    /** Empty contract lets the capability fixture focus on hub lifecycle. */
    const contract = defineContract('rollback-view', { version: 1 })
    /** Connected app remains reusable after rollback. */
    const app = hub.connect('shell')
    expect(() => app.own(contract)).toThrow(failure)
    expect(() => app.own(contract)).not.toThrow()
  })

  it('rolls back partial owner resources when a capability owner hook fails', () => {
    /** Partial owner installation must release its resource once. */
    const release = vi.fn()
    /** Exact hook failure remains primary. */
    const failure = new Error('owner failed')
    /** A later call succeeds after the first partially admitted ownership fails. */
    const own = vi
      .fn()
      .mockImplementationOnce((owner: IAppRuntime) => {
        owner.track(release)
        throw failure
      })
      .mockReturnValue({})
    hub = createMicroHub({ plugins: [capability({ own })] })
    /** Contract shared across ownership retry. */
    const contract = defineContract('rollback-owner', { version: 1 })
    /** App survives the failed claim. */
    const app = hub.connect('shell')
    expect(() => app.own(contract)).toThrow(failure)
    expect(release).toHaveBeenCalledTimes(1)
    expect(() => app.own(contract)).not.toThrow()
  })

  it('keeps repeated tracking of one release function independently idempotent', () => {
    /** The same callback can belong to two independently removable registrations. */
    const release = vi.fn()
    /** Plugin-owned handles expose repeated track calls through the existing capability seam. */
    const stops: (() => void)[] = []
    hub = createMicroHub({
      plugins: [
        capability({
          own: (owner) => {
            stops.push(owner.track(release), owner.track(release))
            return {}
          }
        })
      ]
    })
    /** Owner teardown must retain whichever registration has not been stopped. */
    const owned = hub
      .connect('tracked-owner')
      .own(defineContract('tracked-release', { version: 1 }))
    stops[1]!()
    stops[1]!()
    expect(release).toHaveBeenCalledTimes(1)
    owned.release()
    expect(release).toHaveBeenCalledTimes(2)
    stops[0]!()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('disconnects synchronously, returns one promise, and permits immediate remount', async () => {
    hub = createMicroHub({ plugins: [state(), events()] })
    /** Contract used to verify old subscriptions cannot survive remount. */
    const contract = counter()
    /** App generation being unmounted. */
    const original = hub.connect('child')
    /** Ownership and subscriptions belong to the original generation. */
    const owned = original.own(contract)
    /** Listener would expose a ghost callback after remount. */
    const listener = vi.fn()
    owned.state.count.subscribe(listener)
    /** First disconnect promise must be reused until and after settlement. */
    const closing = original.disconnect()
    expect(original.connected).toBe(false)
    expect(hub.apps).toEqual([])
    expect(original.disconnect()).toBe(closing)
    expect(() => original.use(contract)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
    )
    expect(() => owned.commands.add(1)).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
    )
    /** New app generation can claim the released contract before old plugin removal finishes. */
    const remounted = hub.connect('child')
    remounted.own(contract).commands.add(1)
    await closing
    expect(original.disconnect()).toBe(closing)
    expect(listener).not.toHaveBeenCalled()
    expect(hub.apps).toEqual(['child'])
  })

  it('disposes every app, rejects further connections, and reuses its disposal promise', async () => {
    hub = createMicroHub({ plugins: [state()] })
    /** First connected app. */
    const first = hub.connect('first')
    /** Second connected app. */
    const second = hub.connect('second')
    /** The hub publishes one disposal promise. */
    const closing = hub.dispose()
    expect(hub.dispose()).toBe(closing)
    expect(first.connected).toBe(false)
    expect(second.connected).toBe(false)
    expect(hub.apps).toEqual([])
    expect(() => hub!.connect('late')).toThrow(
      expect.objectContaining({ code: MicroHubErrorCode.hubNotCreated })
    )
    await closing
    expect(hub.dispose()).toBe(closing)
  })

  it('waits for physical cleanup after plugin-host reaches its logical disposal timeout', async () => {
    vi.useFakeTimers()
    /** A capability still owns physical work after the default cleanup wait expires. */
    const gate = deferred<void>()
    /** Public core cleanup callback exposes when the bounded disposal step actually starts. */
    const cleanup = vi.fn(() => gate.promise)
    /** Observes hub completion without awaiting the still-blocked physical cleanup. */
    let completed = false
    try {
      hub = createMicroHub({ plugins: [capability({ dispose: cleanup })] })
      /** Hub disposal must retain the actual capability cleanup, including after logical timeout. */
      const closing = hub.dispose()
      void closing.then(() => {
        completed = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(cleanup).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      // plugin-host's actual DEFAULT_DISPOSE_STEP_TIMEOUT_MS is 5_000.
      await vi.advanceTimersByTimeAsync(5_001)
      expect(vi.getTimerCount()).toBe(0)
      expect(completed).toBe(false)
      gate.resolve()
      await closing
      expect(completed).toBe(true)
    } finally {
      gate.resolve()
      await hub?.dispose()
      vi.useRealTimers()
    }
  })
})
