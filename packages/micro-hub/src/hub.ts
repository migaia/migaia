import { createEventChannel, type IEventChannel } from '@migaia/event-subscriber'
import {
  LifecycleErrorPolicy,
  createSyncLifecycleScope,
  type ISyncLifecycleScope
} from '@migaia/lifecycle'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { assertName, type IContract } from './contract.js'
import type {
  IAppRuntime,
  IContractEntry,
  IDriverMembers,
  IHubRuntime,
  IMicroDriver,
  IMicroPlugin
} from './driver.js'
import { MicroHubErrorCode } from './error-code.js'
import { MicroHubErrorText } from './error-text.js'
import { createMicroHubError } from './errors.js'
import { APP_PLUGIN_PREFIX, MicroCapability, NameKind, capabilityExtensionKey } from './text.js'
import type { IContractView, IMicroApp, IMicroHub, IOwnOptions, IOwnedContract } from './types.js'

/** Options of {@link createMicroHub}. */
export type ICreateMicroHubOptions = {
  /** Capability plugins; order does not matter, dependencies are checked before installation. */
  readonly plugins: readonly IMicroPlugin[]
  /**
   * Receives errors that must not interrupt the current operation: listener and subscriber
   * failures, cleanup failures. Defaults to `globalThis.reportError`, then `console.error`.
   */
  readonly report?: (error: unknown) => void
}

/** Plugin-host execution budget; hub mutations are local and finish well inside it. */
const HOST_EXECUTION = Object.freeze({ mutationTimeoutMs: 10_000, pipelineDrainTimeoutMs: 10_000 })

/** The live hub of this realm; the package is a singleton, so this module state is the registry. */
let current: IMicroHub | undefined

/** Last-resort reporter used when no `report` option is given or the given one throws. */
function defaultReport(error: unknown): void {
  /** Host-provided global error reporter, absent in some test environments. */
  const reportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
  if (typeof reportError === 'function') reportError(error)
  else console.error(error)
}

/** True when a contract has members in the sections served by `kind`. */
function contractNeeds(contract: IContract, kind: MicroCapability): boolean {
  /** Number of own members in a frozen contract section. */
  const count = (section: object): number => Object.keys(section).length
  switch (kind) {
    case MicroCapability.state:
      return count(contract.state) + count(contract.computed) + count(contract.commands) > 0
    case MicroCapability.events:
      return count(contract.events) + count(contract.requests) > 0
    case MicroCapability.resource:
      return count(contract.resources) > 0
    case MicroCapability.persist:
      return false
  }
}

/**
 * Creates the singleton hub. Only the shell calls this; child apps call {@link getMicroHub}.
 *
 * Capability plugins are installed synchronously in the given order after their dependencies are
 * checked, so a missing dependency throws before anything is installed.
 *
 * @throws Error `HUB_ALREADY_CREATED` when a hub exists; `PLUGIN_MISSING` when a plugin's
 *   dependency is absent.
 */
export function createMicroHub(options: ICreateMicroHubOptions): IMicroHub {
  if (current) {
    throw createMicroHubError(
      MicroHubErrorCode.hubAlreadyCreated,
      MicroHubErrorText.hubAlreadyCreated
    )
  }
  /** Capability kinds present in this hub, checked against every plugin's `requires`. */
  const kinds = new Set(options.plugins.map((plugin) => plugin.kind))
  for (const plugin of options.plugins) {
    for (const required of plugin.requires) {
      if (!kinds.has(required)) {
        throw createMicroHubError(
          MicroHubErrorCode.pluginMissing,
          MicroHubErrorText.pluginRequires(plugin.kind, required)
        )
      }
    }
  }
  /** Caller's reporter, guarded so a throwing reporter never breaks the hub. */
  const userReport = options.report
  /** Reporter handed to drivers and scopes; never throws. */
  const report = (error: unknown): void => {
    if (!userReport) return defaultReport(error)
    try {
      userReport(error)
    } catch (reporterFailure) {
      defaultReport(reporterFailure)
      defaultReport(error)
    }
  }
  /** Plugin-host instance owning capability plugins and one plugin per connected app. */
  const host = defineHost({ host: { execution: HOST_EXECUTION } })
  /** Installed drivers by capability kind. */
  const drivers = new Map<MicroCapability, IMicroDriver>()
  /** Registered contracts by name. */
  const contracts = new Map<string, IContractEntry>()
  /** Ownership-change channels, created lazily per contract entry. */
  const ownerChannels = new WeakMap<IContractEntry, IEventChannel<void>>()
  /** Connected apps by name, in connection order. */
  const apps = new Map<string, IMicroApp>()
  /** Monotonic suffix that keeps plugin names unique while a previous app plugin is unloading. */
  let generation = 0
  /** Set once `dispose()` starts; all later calls reuse its Promise. */
  let disposal: Promise<void> | undefined

  /**
   * Hub services handed to capability drivers: failure reporting, lookup of another installed
   * driver, and subscription to ownership changes of a contract.
   */
  const hubRuntime: IHubRuntime = {
    report,
    driver: (kind) => drivers.get(kind),
    onOwnerChange: (entry, listener) => {
      /** Ownership channel of this contract entry; created by the first subscriber. */
      let channel = ownerChannels.get(entry)
      if (!channel) {
        channel = createEventChannel<void>({ report: ({ error }) => report(error) })
        ownerChannels.set(entry, channel)
      }
      return channel.subscribe(() => listener())
    }
  }

  /** Notifies ownership listeners of `entry`; listener failures are reported, not thrown. */
  const notifyOwnerChange = (entry: IContractEntry): void => {
    try {
      ownerChannels.get(entry)?.publish()
    } catch (error) {
      report(error)
    }
  }

  /** Installs capability plugins; their handles carry the drivers. */
  const handles = host.useSync(
    ...(options.plugins.map((plugin) => plugin.bind(hubRuntime)) as [])
  ) as readonly { readonly extensions: Readonly<Record<string, unknown>> }[]
  options.plugins.forEach((plugin, index) => {
    drivers.set(
      plugin.kind,
      handles[index].extensions[capabilityExtensionKey(plugin.kind)] as IMicroDriver
    )
  })

  /**
   * Returns the registry entry of a contract, registering it on first use.
   *
   * @throws Error `CONTRACT_VERSION_MISMATCH` when the name is registered with another version;
   *   `PLUGIN_MISSING` when the contract needs an absent capability.
   */
  const register = (contract: IContract): IContractEntry => {
    /** Entry already registered under this contract name, if any. */
    const existing = contracts.get(contract.name)
    if (existing) {
      if (existing.contract.version !== contract.version) {
        throw createMicroHubError(
          MicroHubErrorCode.contractVersionMismatch,
          MicroHubErrorText.contractVersionMismatch(
            contract.name,
            existing.contract.version,
            contract.version
          )
        )
      }
      return existing
    }
    for (const kind of Object.values(MicroCapability)) {
      if (!drivers.has(kind) && contractNeeds(contract, kind)) {
        throw createMicroHubError(
          MicroHubErrorCode.pluginMissing,
          MicroHubErrorText.pluginMissing(kind, contract.name)
        )
      }
    }
    /** New entry; drivers fill their slots lazily. */
    const entry: IContractEntry = { contract, owner: undefined, slots: new Map() }
    contracts.set(contract.name, entry)
    return entry
  }

  /** Builds the base view shape so every view has every section even without its capability. */
  const baseView = (contract: IContract, app: IAppRuntime): Record<string, unknown> => ({
    contract,
    state: {},
    computed: {},
    commands: {},
    events: {},
    requests: {},
    resources: {},
    revision: Object.freeze({
      get: () => {
        app.assertConnected()
        return 0
      },
      subscribe: () => {
        app.assertConnected()
        return () => undefined
      }
    }),
    select: () => {
      app.assertConnected()
      throw createMicroHubError(
        MicroHubErrorCode.pluginMissing,
        MicroHubErrorText.pluginMissing(MicroCapability.state, contract.name)
      )
    }
  })

  /** Merges driver members into `target` in capability order. */
  const merge = (
    target: Record<string, unknown>,
    build: (driver: IMicroDriver) => IDriverMembers | undefined
  ): void => {
    for (const driver of drivers.values()) {
      /** Members this driver contributes to the target, or `undefined` when it adds none. */
      const members = build(driver)
      if (members) Object.assign(target, members)
    }
  }

  /** Connects one app; see {@link IMicroHub.connect}. */
  const connect = (name: string): IMicroApp => {
    if (disposal) {
      throw createMicroHubError(MicroHubErrorCode.hubNotCreated, MicroHubErrorText.hubNotCreated)
    }
    assertName(NameKind.app, name)
    if (apps.has(name)) {
      throw createMicroHubError(
        MicroHubErrorCode.appAlreadyConnected,
        MicroHubErrorText.appAlreadyConnected(name)
      )
    }
    /** Owns every subscription and handler this app registers after connecting. */
    const scope: ISyncLifecycleScope = createSyncLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report
    })
    /** Plugin-host registration name; the generation suffix allows reconnecting during unload. */
    const pluginName = `${APP_PLUGIN_PREFIX}${name}#${++generation}`
    /** Becomes false when `disconnect()` starts; every member of this app checks it before acting. */
    let connected = true
    /** Views by contract entry, so repeated `use()` returns the same object. */
    const views = new Map<IContractEntry, IContractView<IContract>>()
    /** Promise of the first `disconnect()` call. */
    let disconnection: Promise<void> | undefined

    /** Throws `APP_DISCONNECTED` when this app handle is used after `disconnect()`. */
    const assertConnected = (): void => {
      if (!connected) {
        throw createMicroHubError(
          MicroHubErrorCode.appDisconnected,
          MicroHubErrorText.appDisconnected(name)
        )
      }
    }

    /** Ties `release` to `owner` scope; see {@link IAppRuntime.track}. */
    const trackIn = (owner: ISyncLifecycleScope, release: () => void): (() => void) => {
      /** Identity under which the release is owned by the scope. */
      const token = {}
      owner.own(token, { syncSafe: true, force: release })
      return () => {
        if (owner.release(token)) release()
      }
    }

    /**
     * App runtime handed to drivers: lets them check the connection and tie registrations to this
     * app's lifecycle scope.
     */
    const runtime: IAppRuntime = {
      name,
      get connected() {
        return connected
      },
      assertConnected,
      track: (release) => trackIn(scope, release)
    }

    host.useSync(
      definePlugin(pluginName, (core) => ({
        install: () => {
          core.onDispose(() => void scope.dispose())
          return {}
        }
      }))
    )

    /**
     * Returns the shared view of `contract`, registering the contract on first use. Repeated calls
     * return the same frozen view.
     *
     * @throws Error `APP_DISCONNECTED` after disconnect; `CONTRACT_VERSION_MISMATCH` or
     *   `PLUGIN_MISSING` from registration.
     */
    const use = <C extends IContract>(contract: C): IContractView<C> => {
      assertConnected()
      /** Registry entry of the requested contract. */
      const entry = register(contract)
      /** View built by an earlier `use()` of the same contract. */
      const cached = views.get(entry)
      if (cached) return cached as unknown as IContractView<C>
      /** View assembled from every driver's members. */
      const view = baseView(entry.contract, runtime)
      merge(view, (driver) => driver.view(entry, runtime))
      Object.freeze(view)
      views.set(entry, view as unknown as IContractView<IContract>)
      return view as unknown as IContractView<C>
    }

    /**
     * Claims ownership of `contract` and returns its view plus the owner-only members. Ownership
     * ends on `release()` or when the app disconnects; a failure while building the owner members
     * rolls the claim back before rethrowing.
     *
     * @throws Error `CONTRACT_OWNED` when another app owns the contract; `PLUGIN_MISSING` when
     *   persistence is requested without the persist plugin.
     */
    const own = <C extends IContract>(
      contract: C,
      ownOptions: IOwnOptions<C> = {}
    ): IOwnedContract<C> => {
      assertConnected()
      /** Registry entry of the contract being claimed. */
      const entry = register(contract)
      if (entry.owner) {
        throw createMicroHubError(
          MicroHubErrorCode.contractOwned,
          MicroHubErrorText.contractOwned(contract.name, entry.owner.name)
        )
      }
      if ((ownOptions.persist?.length ?? 0) > 0 && !drivers.has(MicroCapability.persist)) {
        throw createMicroHubError(
          MicroHubErrorCode.pluginMissing,
          MicroHubErrorText.pluginMissing(MicroCapability.persist, contract.name)
        )
      }
      /** Owns handlers, providers and persistence of this ownership; released by `release()`. */
      const ownership = createSyncLifecycleScope({
        errorPolicy: LifecycleErrorPolicy.report,
        report
      })
      /** True until this ownership is released; owner-only members check it. */
      let owning = true
      /**
       * Runtime for owner-only members. Besides the connection check it fails with `EMIT_DENIED`
       * after release, and ties registrations to the ownership scope instead of the app scope.
       */
      const ownerRuntime: IAppRuntime = {
        name,
        get connected() {
          return connected && owning
        },
        assertConnected: () => {
          assertConnected()
          if (!owning) {
            throw createMicroHubError(
              MicroHubErrorCode.emitDenied,
              MicroHubErrorText.emitDenied(contract.name, name)
            )
          }
        },
        track: (release) => trackIn(ownership, release)
      }
      /** Removes `release` from the app scope once ownership ended earlier than the app. */
      let untrackRelease: (() => void) | undefined
      /** Ends this ownership: releases owner members, then announces the change. Idempotent. */
      const release = (): void => {
        if (!owning) return
        owning = false
        ownership.dispose()
        if (entry.owner === ownerRuntime) entry.owner = undefined
        untrackRelease?.()
        notifyOwnerChange(entry)
      }
      entry.owner = ownerRuntime
      untrackRelease = runtime.track(release)
      try {
        /** Owned contract: building the shared view is part of the ownership transaction. */
        const owned: Record<string, unknown> = {
          ...use(contract),
          handle: () => {
            throw createMicroHubError(
              MicroHubErrorCode.pluginMissing,
              MicroHubErrorText.pluginMissing(MicroCapability.events, contract.name)
            )
          },
          provide: () => {
            throw createMicroHubError(
              MicroHubErrorCode.pluginMissing,
              MicroHubErrorText.pluginMissing(MicroCapability.resource, contract.name)
            )
          },
          persistence: undefined,
          release
        }
        merge(owned, (driver) =>
          driver.own?.(entry, ownerRuntime, ownOptions as IOwnOptions<IContract>)
        )
        notifyOwnerChange(entry)
        return Object.freeze(owned) as unknown as IOwnedContract<C>
      } catch (error) {
        release()
        throw error
      }
    }

    /**
     * Disconnects this app once: marks it disconnected, releases its registrations synchronously so
     * no callback reaches an unmounted app, then unloads its plugin. Later calls return the same
     * Promise.
     */
    const disconnect = (): Promise<void> => {
      if (disconnection) return disconnection
      connected = false
      apps.delete(name)
      // Release synchronously so no callback reaches an unmounted app while plugin-host unloads.
      scope.dispose()
      disconnection = host.unUse(pluginName).then(() => undefined)
      return disconnection
    }

    /** Frozen app handle returned to the caller. */
    const app: IMicroApp = Object.freeze({
      name,
      get connected() {
        return connected
      },
      use,
      own,
      disconnect
    })
    apps.set(name, app)
    return app
  }

  /** Frozen hub handle; also stored as the page-wide current hub for `getMicroHub()`. */
  const hub: IMicroHub = Object.freeze({
    connect,
    get apps() {
      return [...apps.keys()]
    },
    dispose: () => {
      if (disposal) return disposal
      /** Every app is disconnected first so owners release before capabilities go away. */
      const disconnections = [...apps.values()].map((app) => app.disconnect())
      if (current === hub) current = undefined
      disposal = Promise.allSettled(disconnections)
        .then((results) => {
          for (const result of results) if (result.status === 'rejected') report(result.reason)
          return host.dispose()
        })
        .then(async (result) => {
          // Plugin-host may finish logical disposal before an asynchronous cleanup settles.
          await result.physicalCompletion
        })
      return disposal
    }
  })
  current = hub
  return hub
}

/**
 * Returns the hub of this realm.
 *
 * @throws Error `HUB_NOT_CREATED` when the shell has not created it yet.
 */
export function getMicroHub(): IMicroHub {
  if (!current) {
    throw createMicroHubError(MicroHubErrorCode.hubNotCreated, MicroHubErrorText.hubNotCreated)
  }
  return current
}
