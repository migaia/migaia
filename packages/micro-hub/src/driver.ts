import { definePlugin } from '@migaia/plugin-host'
import type { IContract } from './contract.ts'
import { CAPABILITY_PLUGIN_PREFIX, MicroCapability, capabilityExtensionKey } from './text.ts'
import type { IOwnOptions } from './types.ts'

/**
 * Hub-side record of one registered contract. Capability drivers keep their per-contract state in
 * `slots`, so the hub core stays unaware of what each capability stores.
 */
export type IContractEntry = {
  readonly contract: IContract
  /** Current owner; `undefined` while nobody owns the contract. */
  owner: IAppRuntime | undefined
  /** Capability-private per-contract state, keyed by capability. */
  readonly slots: Map<MicroCapability, unknown>
}

/** What drivers know about one connected app. */
export type IAppRuntime = {
  readonly name: string
  readonly connected: boolean
  /** Throws `APP_DISCONNECTED` when the app is no longer connected. */
  assertConnected(): void
  /**
   * Ties `release` to the app's lifetime: it runs at disconnect unless the returned function ran it
   * earlier. The returned function is idempotent.
   */
  track(release: () => void): () => void
}

/** What drivers know about the hub. */
export type IHubRuntime = {
  /** Reports an error that must not interrupt the current operation. Never throws. */
  report(error: unknown): void
  /** Driver of another installed capability, or `undefined`. */
  driver(kind: MicroCapability): IMicroDriver | undefined
  /** Subscribes to ownership changes of a contract; returns the unsubscribe function. */
  onOwnerChange(entry: IContractEntry, listener: () => void): () => void
}

/** Members a driver contributes to a view or an owned contract; merged by the hub. */
export type IDriverMembers = Readonly<Record<string, unknown>>

/** One capability implementation. Capability plugins publish exactly one driver. */
export type IMicroDriver = {
  readonly kind: MicroCapability
  /** Members every app's view gets. */
  view(entry: IContractEntry, app: IAppRuntime): IDriverMembers
  /** Extra members the owner gets; called once per `own()`. */
  own?(entry: IContractEntry, app: IAppRuntime, options: IOwnOptions<IContract>): IDriverMembers
  /** Releases hub-wide resources, awaiting pending work when the capability plugin is removed. */
  dispose?(): void | Promise<void>
}

/**
 * A capability plugin as `createMicroHub({ plugins })` takes it: kind and dependencies are readable
 * before installation, so the hub rejects a missing dependency without side effects.
 */
export type IMicroPlugin = {
  readonly kind: MicroCapability
  readonly requires: readonly MicroCapability[]
  /** Builds the plugin-host definition bound to one hub; installing it creates the driver. */
  readonly bind: (hub: IHubRuntime) => ReturnType<typeof definePlugin>
}

/**
 * Defines a capability plugin. The bound plugin-host definition publishes the driver under
 * `<kind>Driver` and registers the driver's `dispose` with plugin-host, so `hub.dispose()` releases
 * capabilities in reverse installation order.
 */
export function defineMicroPlugin(
  kind: MicroCapability,
  requires: readonly MicroCapability[],
  create: (hub: IHubRuntime) => IMicroDriver
): IMicroPlugin {
  return Object.freeze({
    kind,
    requires: Object.freeze([...requires]),
    bind: (hub: IHubRuntime) =>
      definePlugin(`${CAPABILITY_PLUGIN_PREFIX}${kind}`, (core) => ({
        install: () => {
          /** Driver owned by this installation; released by plugin-host on removal. */
          const driver = create(hub)
          if (driver.dispose) core.onDispose(() => driver.dispose?.())
          return { [capabilityExtensionKey(kind)]: driver }
        }
      }))
  })
}
