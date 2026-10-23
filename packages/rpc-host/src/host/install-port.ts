import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import { createLifecycleScope } from '@migaia/lifecycle'
import { onceAsync } from '@migaia/utils/function'
import type {
  IRpcFeaturePlugin,
  IRpcFeaturePluginDefinition,
  IRpcTransportPluginDefinition
} from '../plugin/types.js'
import type { IRpcHostFeatureContext } from './types.js'

/** This private domain-core port lets native SDK hooks join their actual receiving host. */
export const rpcInstallationPort = Symbol('rpc-host-installation')

/** Installation dispatch is domain-owned; feature-only imports retain no transport implementation. */
export type IRpcInstallationPort = Readonly<{
  transport(
    core: IPluginHostCore,
    definition: IRpcTransportPluginDefinition
  ): Promise<Record<never, never>>
  feature(core: IPluginHostCore, definition: IRpcFeaturePluginDefinition): void | Promise<void>
}>

/** Read only the private domain field on the genuine native core passed to the install hook. */
export function readRpcInstallationPort(core: IPluginHostCore): IRpcInstallationPort | undefined {
  return Reflect.get(core, rpcInstallationPort) as IRpcInstallationPort | undefined
}

/** A feature hook retains only lightweight configuration and the receiving Host's installation port. */
export function installRpcFeature(
  core: IPluginHostCore,
  definition: IRpcFeaturePluginDefinition,
  plugin: IRpcFeaturePlugin
): Record<never, never> | Promise<Record<never, never>> {
  /** Feature-only imports never acquire or import the ordinary transport runtime graph. */
  const port = readRpcInstallationPort(core)
  if (!port) {
    registerOrdinaryRpcFeature(core, definition, plugin)
    return {}
  }
  /** The native hook owns asynchronous failure; an absent contribution returns an empty extension. */
  const result = port.feature(core, definition)
  return result === undefined ? {} : Promise.resolve(result).then(() => ({}))
}

/** Ordinary Hosts retain configuration through their genuine identity, never a caller-supplied key. */
type IOrdinaryFeatureRegistration = Readonly<{
  definition: IRpcFeaturePluginDefinition
  plugin: IRpcFeaturePlugin
  setup(context: IRpcHostFeatureContext): Promise<void>
}>

/** This cold inventory does not own directories, native sessions or mutable endpoint configuration. */
const ordinaryFeatures = new WeakMap<object, Set<IOrdinaryFeatureRegistration>>()

/** Register fixed feature configuration while its original native feature scope owns all cleanup. */
export function registerOrdinaryRpcFeature(
  core: IPluginHostCore,
  definition: IRpcFeaturePluginDefinition,
  plugin: IRpcFeaturePlugin
): void {
  /** Only a genuine native core provides the stable receiving Host identity. */
  const identity = getPluginRuntimeIntegration(core).identity
  /**
   * A canonical lifecycle scope can accept later transport-installed resources without reusing an
   * expired core.
   */
  const resources = createLifecycleScope()
  /** One native Host owns one configuration inventory for its ordinary transport registrations. */
  const registrations = ordinaryFeatures.get(identity) ?? new Set<IOrdinaryFeatureRegistration>()
  /** Native disposal and transport disposal share each exact idempotent cleanup operation. */
  const registration: IOrdinaryFeatureRegistration = {
    definition,
    plugin,
    async setup(context) {
      await definition.setup?.({
        ...context,
        onDispose(dispose) {
          /**
           * The existing helper coalesces both native owners without a second lifecycle state
           * machine.
           */
          const release = onceAsync(async () => {
            await dispose()
          })
          resources.own(release, { force: release })
          context.onDispose(release)
        }
      })
    }
  }
  registrations.add(registration)
  ordinaryFeatures.set(identity, registrations)
  core.onDispose(async () => {
    registrations.delete(registration)
    await resources.dispose()
  })
}

/**
 * Read a fixed feature snapshot for a new ordinary transport; live endpoints are never
 * reconfigured.
 */
export function readOrdinaryRpcFeatures(
  core: IPluginHostCore
): readonly IOrdinaryFeatureRegistration[] {
  return [...(ordinaryFeatures.get(getPluginRuntimeIntegration(core).identity) ?? [])]
}
