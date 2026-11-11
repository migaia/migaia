import { snapshotOptionProperties } from '@migaia/utils/object'
import { createEventChannel, type IEventChannel } from '@migaia/event-subscriber'
import {
  LifecycleErrorPolicy,
  createSyncLifecycleScope,
  type ISyncLifecycleScope
} from '@migaia/lifecycle'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { assertName, type IContract } from './contract.ts'
import type {
  IAppRuntime,
  IContractEntry,
  IDriverMembers,
  IHubRuntime,
  IMicroDriver,
  IMicroPlugin
} from './driver.ts'
import { MicroHubErrorCode } from './error-code.ts'
import { MicroHubErrorText } from './error-text.ts'
import { createMicroHubError, createMicroHubTypeError } from './errors.ts'
import { APP_PLUGIN_PREFIX, MicroCapability, NameKind, capabilityExtensionKey } from './text.ts'
import type { IContractView, IMicroApp, IMicroHub, IOwnOptions, IOwnedContract } from './types.ts'

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

/**
 * Snapshots the shell's options and plugin list once, so a throwing getter or revoked Proxy becomes
 * `INVALID_OPTION` with the original error as `cause` instead of an uncoded native error.
 */
function readHubOptions(options: ICreateMicroHubOptions): ICreateMicroHubOptions {
  /** Plain copy; every later read uses it, never the caller's object. */
  let input: ICreateMicroHubOptions
  /** True when `plugins` is an array; a revoked Proxy throws inside the guarded read. */
  let isList = false
  try {
    input = snapshotOptionProperties(options)
    isList = Array.isArray(input.plugins)
  } catch (error) {
    throw createMicroHubTypeError(
      MicroHubErrorCode.invalidOption,
      MicroHubErrorText.unreadableHubOptions,
      { cause: error }
    )
  }
  if (!isList)
    throw createMicroHubTypeError(MicroHubErrorCode.invalidOption, MicroHubErrorText.pluginsInvalid)
  return { plugins: [...input.plugins], report: input.report }
}

/** Last-resort reporter used when no `report` option is given or the given one throws. */
function defaultReport(error: unknown): void {
  /** Host-provided global error reporter, absent in some test environments. */
  const reportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
  if (typeof reportError === 'function') reportError(error)
  else console.error(error)
}

/** Number of own members in a frozen contract section. */
function count(section: object): number {
  return Object.keys(section).length
}

/** True when a contract has members in the sections served by `kind`. */
function contractNeeds(contract: IContract, kind: MicroCapability): boolean {
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
  options = readHubOptions(options)
  assertPluginDependencies(options.plugins)
  /** Hub state and behavior; the returned handle only forwards to it. */
  const core = new MicroHubCore(options)
  /** Frozen hub handle; also stored as the page-wide current hub for `getMicroHub()`. */
  const hub = createHubHandle(core)
  core.handle = hub
  current = hub
  return hub
}

/** Rejects a plugin whose required capability is absent, before anything is installed. */
function assertPluginDependencies(plugins: readonly IMicroPlugin[]): void {
  /** Capability kinds present in this hub, checked against every plugin's `requires`. */
  const kinds = new Set(plugins.map((plugin) => plugin.kind))
  for (const plugin of plugins) {
    for (const required of plugin.requires) {
      if (!kinds.has(required)) {
        throw createMicroHubError(
          MicroHubErrorCode.pluginMissing,
          MicroHubErrorText.pluginRequires(plugin.kind, required)
        )
      }
    }
  }
}

/** Builds the frozen public hub object over one core; `apps` stays a live getter. */
function createHubHandle(core: MicroHubCore): IMicroHub {
  return Object.freeze({
    connect: (name: string) => core.connect(name),
    get apps() {
      return [...core.apps.keys()]
    },
    dispose: () => core.dispose()
  })
}

/** Builds the frozen public app object over one session; `connected` stays a live getter. */
function createAppHandle(session: MicroAppSession): IMicroApp {
  return Object.freeze({
    name: session.name,
    get connected() {
      return session.connected
    },
    use: <C extends IContract>(contract: C) => session.use(contract),
    own: <C extends IContract>(contract: C, ownOptions?: IOwnOptions<C>) =>
      session.own(contract, ownOptions),
    disconnect: () => session.disconnect()
  })
}

/**
 * Ties `release` to `owner` scope; the returned function releases early and is idempotent. Shared
 * by app and ownership runtimes; see {@link IAppRuntime.track}.
 */
function trackIn(owner: ISyncLifecycleScope, release: () => void): () => void {
  /** Identity under which the release is owned by the scope. */
  const token = {}
  owner.own(token, { syncSafe: true, force: release })
  return () => {
    if (owner.release(token)) release()
  }
}

/** Builds the base view shape so every view has every section even without its capability. */
function baseView(contract: IContract, app: IAppRuntime): Record<string, unknown> {
  return {
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
  }
}

/**
 * Hub state and behavior: the plugin-host instance, installed drivers, contract registry, ownership
 * channels and connected apps. Also serves as the {@link IHubRuntime} given to drivers.
 */
class MicroHubCore implements IHubRuntime {
  /** Caller's reporter, guarded by `report` so a throwing reporter never breaks the hub. */
  readonly #userReport: ((error: unknown) => void) | undefined
  /** Plugin-host instance owning capability plugins and one plugin per connected app. */
  readonly host = defineHost({ modules: [], host: { execution: HOST_EXECUTION } })
  /** Installed drivers by capability kind. */
  readonly drivers = new Map<MicroCapability, IMicroDriver>()
  /** Registered contracts by name. */
  readonly #contracts = new Map<string, IContractEntry>()
  /** Ownership-change channels, created lazily per contract entry. */
  readonly #ownerChannels = new WeakMap<IContractEntry, IEventChannel<void>>()
  /** Connected apps by name, in connection order. */
  readonly apps = new Map<string, IMicroApp>()
  /** Monotonic suffix that keeps plugin names unique while a previous app plugin is unloading. */
  #generation = 0
  /** Set once `dispose()` starts; all later calls reuse its Promise. */
  #disposal: Promise<void> | undefined
  /** Public handle of this hub, set right after construction; compared on dispose. */
  handle: IMicroHub | undefined

  /** Installs the capability plugins; their handles carry the drivers. */
  constructor(options: ICreateMicroHubOptions) {
    this.#userReport = options.report
    /** Plugin-host handles of the capability plugins, in option order. */
    const handles = this.host.useSync(
      ...(options.plugins.map((plugin) => plugin.bind(this)) as [])
    ) as readonly { readonly extensions: Readonly<Record<string, unknown>> }[]
    options.plugins.forEach((plugin, index) => {
      this.drivers.set(
        plugin.kind,
        handles[index].extensions[capabilityExtensionKey(plugin.kind)] as IMicroDriver
      )
    })
  }

  /** Reporter handed to drivers and scopes; never throws. */
  readonly report = (error: unknown): void => {
    if (!this.#userReport) return defaultReport(error)
    try {
      this.#userReport(error)
    } catch (reporterFailure) {
      defaultReport(reporterFailure)
      defaultReport(error)
    }
  }

  /** Driver of another installed capability, or `undefined`. */
  readonly driver = (kind: MicroCapability): IMicroDriver | undefined => this.drivers.get(kind)

  /** Subscribes to ownership changes of `entry`; the channel is created by the first subscriber. */
  readonly onOwnerChange = (entry: IContractEntry, listener: () => void): (() => void) => {
    /** Ownership channel of this contract entry. */
    let channel = this.#ownerChannels.get(entry)
    if (!channel) {
      channel = createEventChannel<void>({ report: ({ error }) => this.report(error) })
      this.#ownerChannels.set(entry, channel)
    }
    return channel.subscribe(() => listener())
  }

  /** Notifies ownership listeners of `entry`; listener failures are reported, not thrown. */
  notifyOwnerChange(entry: IContractEntry): void {
    try {
      this.#ownerChannels.get(entry)?.publish()
    } catch (error) {
      this.report(error)
    }
  }

  /**
   * Returns the registry entry of a contract, registering it on first use.
   *
   * @throws Error `CONTRACT_VERSION_MISMATCH` when the name is registered with another version;
   *   `PLUGIN_MISSING` when the contract needs an absent capability.
   */
  register(contract: IContract): IContractEntry {
    /** Entry already registered under this contract name, if any. */
    const existing = this.#contracts.get(contract.name)
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
      if (!this.drivers.has(kind) && contractNeeds(contract, kind)) {
        throw createMicroHubError(
          MicroHubErrorCode.pluginMissing,
          MicroHubErrorText.pluginMissing(kind, contract.name)
        )
      }
    }
    /** New entry; drivers fill their slots lazily. */
    const entry: IContractEntry = { contract, owner: undefined, slots: new Map() }
    this.#contracts.set(contract.name, entry)
    return entry
  }

  /** Merges driver members into `target` in capability order. */
  merge(
    target: Record<string, unknown>,
    build: (driver: IMicroDriver) => IDriverMembers | undefined
  ): void {
    for (const driver of this.drivers.values()) {
      /** Members this driver contributes to the target, or `undefined` when it adds none. */
      const members = build(driver)
      if (members) Object.assign(target, members)
    }
  }

  /** Connects one app; see {@link IMicroHub.connect}. */
  connect(name: string): IMicroApp {
    if (this.#disposal) {
      throw createMicroHubError(MicroHubErrorCode.hubNotCreated, MicroHubErrorText.hubNotCreated)
    }
    assertName(NameKind.app, name)
    if (this.apps.has(name)) {
      throw createMicroHubError(
        MicroHubErrorCode.appAlreadyConnected,
        MicroHubErrorText.appAlreadyConnected(name)
      )
    }
    /** App state and behavior; its plugin is installed by the constructor. */
    const session = new MicroAppSession(this, name, ++this.#generation)
    /** Frozen app handle returned to the caller. */
    const app = createAppHandle(session)
    this.apps.set(name, app)
    return app
  }

  /** Disconnects every app first so owners release before capabilities go away; idempotent. */
  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal
    /** Disconnection Promises of every connected app. */
    const disconnections = [...this.apps.values()].map((app) => app.disconnect())
    if (current === this.handle) current = undefined
    this.#disposal = Promise.allSettled(disconnections)
      .then((results) => {
        for (const result of results) if (result.status === 'rejected') this.report(result.reason)
        return this.host.dispose()
      })
      .then(async (result) => {
        // Plugin-host may finish logical disposal before an asynchronous cleanup settles.
        await result.physicalCompletion
      })
    return this.#disposal
  }
}

/**
 * One connected app: its lifecycle scope, plugin registration and contract views. Also serves as
 * the {@link IAppRuntime} given to drivers for this app's non-owner members.
 */
class MicroAppSession implements IAppRuntime {
  /** Hub this app belongs to. */
  readonly #hub: MicroHubCore
  /** App name as given to `connect()`. */
  readonly name: string
  /** Owns every subscription and handler this app registers after connecting. */
  readonly scope: ISyncLifecycleScope
  /** Plugin-host registration name; the generation suffix allows reconnecting during unload. */
  readonly #pluginName: string
  /** Becomes false when `disconnect()` starts; every member of this app checks it before acting. */
  #connected = true
  /** Views by contract entry, so repeated `use()` returns the same object. */
  readonly #views = new Map<IContractEntry, IContractView<IContract>>()
  /** Promise of the first `disconnect()` call. */
  #disconnection: Promise<void> | undefined

  /** Creates the app scope and installs the app plugin that disposes it on unload. */
  constructor(hub: MicroHubCore, name: string, generation: number) {
    this.#hub = hub
    this.name = name
    this.scope = createSyncLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: hub.report
    })
    this.#pluginName = `${APP_PLUGIN_PREFIX}${name}#${generation}`
    hub.host.useSync(
      definePlugin(this.#pluginName, (core) => ({
        install: () => {
          core.onDispose(() => void this.scope.dispose())
          return {}
        }
      }))
    )
  }

  /** Whether this app is still connected. */
  get connected(): boolean {
    return this.#connected
  }

  /** Throws `APP_DISCONNECTED` when this app handle is used after `disconnect()`. */
  readonly assertConnected = (): void => {
    if (!this.#connected) {
      throw createMicroHubError(
        MicroHubErrorCode.appDisconnected,
        MicroHubErrorText.appDisconnected(this.name)
      )
    }
  }

  /** Ties `release` to this app's scope; see {@link IAppRuntime.track}. */
  readonly track = (release: () => void): (() => void) => trackIn(this.scope, release)

  /**
   * Returns the shared view of `contract`, registering the contract on first use. Repeated calls
   * return the same frozen view.
   *
   * @throws Error `APP_DISCONNECTED` after disconnect; `CONTRACT_VERSION_MISMATCH` or
   *   `PLUGIN_MISSING` from registration.
   */
  use<C extends IContract>(contract: C): IContractView<C> {
    this.assertConnected()
    /** Registry entry of the requested contract. */
    const entry = this.#hub.register(contract)
    /** View built by an earlier `use()` of the same contract. */
    const cached = this.#views.get(entry)
    if (cached) return cached as unknown as IContractView<C>
    /** View assembled from every driver's members. */
    const view = baseView(entry.contract, this)
    this.#hub.merge(view, (driver) => driver.view(entry, this))
    Object.freeze(view)
    this.#views.set(entry, view as unknown as IContractView<IContract>)
    return view as unknown as IContractView<C>
  }

  /**
   * Claims ownership of `contract` and returns its view plus the owner-only members. Ownership ends
   * on `release()` or when the app disconnects; a failure while building the owner members rolls
   * the claim back before rethrowing.
   *
   * @throws Error `CONTRACT_OWNED` when another app owns the contract; `PLUGIN_MISSING` when
   *   persistence is requested without the persist plugin.
   */
  own<C extends IContract>(contract: C, ownOptions: IOwnOptions<C> = {}): IOwnedContract<C> {
    this.assertConnected()
    /** Registry entry of the contract being claimed. */
    const entry = this.#hub.register(contract)
    if (entry.owner) {
      throw createMicroHubError(
        MicroHubErrorCode.contractOwned,
        MicroHubErrorText.contractOwned(contract.name, entry.owner.name)
      )
    }
    if ((ownOptions.persist?.length ?? 0) > 0 && !this.#hub.drivers.has(MicroCapability.persist)) {
      throw createMicroHubError(
        MicroHubErrorCode.pluginMissing,
        MicroHubErrorText.pluginMissing(MicroCapability.persist, contract.name)
      )
    }
    /** This ownership's scope, runtime and idempotent release. */
    const ownership = new ContractOwnership(this.#hub, this, entry)
    entry.owner = ownership
    ownership.untrackRelease = this.track(ownership.release)
    try {
      /** Owned contract: building the shared view is part of the ownership transaction. */
      const owned: Record<string, unknown> = {
        ...this.use(contract),
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
        release: ownership.release
      }
      this.#hub.merge(owned, (driver) =>
        driver.own?.(entry, ownership, ownOptions as IOwnOptions<IContract>)
      )
      this.#hub.notifyOwnerChange(entry)
      return Object.freeze(owned) as unknown as IOwnedContract<C>
    } catch (error) {
      ownership.release()
      throw error
    }
  }

  /**
   * Disconnects this app once: marks it disconnected, releases its registrations synchronously so
   * no callback reaches an unmounted app, then unloads its plugin. Later calls return the same
   * Promise.
   */
  disconnect(): Promise<void> {
    if (this.#disconnection) return this.#disconnection
    this.#connected = false
    this.#hub.apps.delete(this.name)
    // Release synchronously so no callback reaches an unmounted app while plugin-host unloads.
    this.scope.dispose()
    this.#disconnection = this.#hub.host.unUse(this.#pluginName).then(() => undefined)
    return this.#disconnection
  }
}

/**
 * One ownership of a contract by an app. Serves as the {@link IAppRuntime} for owner-only members:
 * besides the connection check it fails with `EMIT_DENIED` after release, and ties registrations to
 * the ownership scope instead of the app scope. It is also the `entry.owner` identity.
 */
class ContractOwnership implements IAppRuntime {
  /** Hub notified when this ownership ends. */
  readonly #hub: MicroHubCore
  /** App that claimed the contract. */
  readonly #app: MicroAppSession
  /** Registry entry of the owned contract. */
  readonly #entry: IContractEntry
  /** Owns handlers, providers and persistence of this ownership; released by `release()`. */
  readonly #scope: ISyncLifecycleScope
  /** True until this ownership is released; owner-only members check it. */
  #owning = true
  /** Removes `release` from the app scope once ownership ended earlier than the app. */
  untrackRelease: (() => void) | undefined

  /** Creates the ownership scope; the caller publishes it as `entry.owner`. */
  constructor(hub: MicroHubCore, app: MicroAppSession, entry: IContractEntry) {
    this.#hub = hub
    this.#app = app
    this.#entry = entry
    this.#scope = createSyncLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: hub.report
    })
  }

  /** Owning app's name. */
  get name(): string {
    return this.#app.name
  }

  /** Connected while both the app is connected and this ownership is held. */
  get connected(): boolean {
    return this.#app.connected && this.#owning
  }

  /** Throws `APP_DISCONNECTED` after disconnect, `EMIT_DENIED` after release. */
  readonly assertConnected = (): void => {
    this.#app.assertConnected()
    if (!this.#owning) {
      throw createMicroHubError(
        MicroHubErrorCode.emitDenied,
        MicroHubErrorText.emitDenied(this.#entry.contract.name, this.#app.name)
      )
    }
  }

  /** Ties `release` to this ownership's scope. */
  readonly track = (release: () => void): (() => void) => trackIn(this.#scope, release)

  /** Ends this ownership: releases owner members, then announces the change. Idempotent. */
  readonly release = (): void => {
    if (!this.#owning) return
    this.#owning = false
    this.#scope.dispose()
    if (this.#entry.owner === this) this.#entry.owner = undefined
    this.untrackRelease?.()
    this.#hub.notifyOwnerChange(this.#entry)
  }
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
