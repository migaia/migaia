import {
  isDefinedPlugin,
  isPluginHandleCurrent,
  PluginHostErrorCode,
  type IDefinedPluginConstraint,
  type IHostHandle,
  type IPluginRemoval
} from '@migaia/plugin-host'
import { probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { serializeRpcError } from '../contract/error.js'
import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRemoteControlShape,
  normalizeRemoteHostCatalog,
  type IRemoteHostCatalog
} from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import { contractRequiresStream, registerRemoteMethods } from './serve-methods.js'
import type { IRemoteServeEndpoint } from './types.js'

/** One successful installation is shared by connections using the same Host definition. */
type IInstalledRemotePlugin = Readonly<{
  definition: IDefinedPluginConstraint
  handle: { getFeature(name: string): Record<string, unknown> }
  features: ReadonlyMap<string, Record<string, unknown>>
}>

/** Only successful remote catalog operations enter this Host-scoped view. */
const installedByHost = new WeakMap<object, Map<string, IInstalledRemotePlugin>>()

/** Same-name Host admission is shared while one definition is still installing. */
type IInstallingRemotePlugin = Readonly<{
  definition: IDefinedPluginConstraint
  promise: Promise<IInstalledRemotePlugin>
}>

/** In-flight admissions belong to the Host, not to a single remote connection. */
const installingByHost = new WeakMap<object, Map<string, IInstallingRemotePlugin>>()

/** Reads a name-addressed Host handle without trusting an older Feature output. */
function registrationState(record: IInstalledRemotePlugin): 'enabled' | 'disabled' | 'stale' {
  if (!isPluginHandleCurrent(record.handle)) return 'stale'
  for (const [feature, original] of record.features) {
    try {
      if (record.handle.getFeature(feature) !== original) return 'stale'
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === PluginHostErrorCode.pluginNotInstalled) return 'stale'
        if (
          error.code === PluginHostErrorCode.pluginDisabled ||
          error.code === PluginHostErrorCode.pluginSuspended
        )
          return 'disabled'
      }
      throw error
    }
  }
  return 'enabled'
}

/** The resolver remains local and synchronous; plugin definitions never cross the wire. */
export type IRemoteHostPluginResolver = (name: string, config?: IRpcPortableValue) => unknown

/** Host ownership is limited to the public operations needed for catalog control. */
export type IRemoteServeHostOptions = Readonly<{
  host: Pick<IHostHandle<object, unknown, readonly []>, 'use' | 'unUse' | 'plugin' | 'revision'>
  catalog: IRemoteHostCatalog
  resolvePlugin: IRemoteHostPluginResolver
  endpoint: IRemoteServeEndpoint
  report(error: unknown): void
}>

/** Closing this service releases only its dedicated endpoint. */
export type IRemoteServeHostHandle = Readonly<{ close(): Promise<void> }>

/** Rejects a name outside the normalized catalog before touching resolver or Host. */
function declared(catalog: IRemoteHostCatalog, name: string): void {
  if (!Object.hasOwn(catalog, name))
    throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
}

/** Projects one registered name through the current Host revision and enablement. */
function inspectItem(
  host: IRemoteServeHostOptions['host'],
  catalog: IRemoteHostCatalog,
  name: string,
  record: IInstalledRemotePlugin
): IRpcPortableValue {
  return {
    name,
    state:
      host.plugin.disabled().includes(name) || registrationState(record) === 'disabled'
        ? 'disabled'
        : 'enabled',
    revision: host.revision,
    features: Object.keys(catalog[name]!.features)
  }
}

/** The same explicit catalog/resolver authority is reused by both reserved-control assemblies. */
export type IRemoteHostControlOptions = Omit<IRemoteServeHostOptions, 'endpoint'>

/** Extract only callable operations from the original adoption owner, never a second Host registry. */
export function createRemoteHostControl(options: IRemoteHostControlOptions) {
  /** The original catalog normalizer owns both legacy and symmetric control configuration. */
  const catalog = normalizeRemoteHostCatalog(options.catalog)
  const installed = installedByHost.get(options.host) ?? new Map<string, IInstalledRemotePlugin>()
  installedByHost.set(options.host, installed)
  /** Concurrent connections consult one admission record for each Host plugin name. */
  const installing =
    installingByHost.get(options.host) ?? new Map<string, IInstallingRemotePlugin>()
  installingByHost.set(options.host, installing)
  /** Installed Host handles expose Feature outputs after a successful use. */
  const handles = new Map<string, IInstalledRemotePlugin>()
  /** A stale or suspended PluginHost handle cannot forward a remote method. */
  const liveFeature = (plugin: string, feature: string): Record<string, unknown> | undefined => {
    const captured = handles.get(plugin)
    if (!captured || installed.get(plugin) !== captured) return undefined
    return registrationState(captured) === 'enabled' ? captured.features.get(feature) : undefined
  }
  /** Reuse one in-flight Host mutation and inspect the winning definition afterward. */
  const ensureInstalled = async (
    name: string,
    candidate: IDefinedPluginConstraint
  ): Promise<IInstalledRemotePlugin> => {
    for (;;) {
      let captured = installed.get(name)
      if (captured && registrationState(captured) === 'stale') {
        installed.delete(name)
        captured = undefined
      }
      if (captured?.definition === candidate) return captured
      const pending = installing.get(name)
      if (pending) {
        try {
          await pending.promise
        } catch (error) {
          if (pending.definition === candidate) throw error
        }
        continue
      }
      /** Schedule admission after registration so a second caller sees this Promise. */
      const promise = Promise.resolve().then(async (): Promise<IInstalledRemotePlugin> => {
        const [handle] = await options.host.use(candidate)
        const featureHandle = handle as unknown as IInstalledRemotePlugin['handle']
        /** Snapshots detect replacement through a name-addressed PluginHost handle. */
        const features = new Map<string, Record<string, unknown>>()
        for (const feature of Object.keys(catalog[name]!.features))
          features.set(feature, featureHandle.getFeature(feature))
        const record = { definition: candidate, handle: featureHandle, features }
        installed.set(name, record)
        return record
      })
      installing.set(name, { definition: candidate, promise })
      try {
        return await promise
      } finally {
        if (installing.get(name)?.promise === promise) installing.delete(name)
      }
    }
  }
  return Object.freeze({
    catalog,
    liveFeature,
    use: async (data: unknown): Promise<IRpcPortableValue> => {
      const params = normalizeRemoteControlShape(
        'hostUseParams',
        data
      ) as readonly IRpcPortableValue[]
      const name = params[0] as string
      declared(catalog, name)
      const candidate = options.resolvePlugin(name, params[1])
      const thenable = probeThenable(candidate)
      if (thenable.kind !== ThenableProbeKind.notThenable)
        throw createRemoteLayerError(
          RpcRemoteLayerErrorCode.contractInvalid,
          thenable.kind === ThenableProbeKind.failed ? thenable.error : undefined
        )
      if (!isDefinedPlugin(candidate) || candidate.name !== name)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      const captured = await ensureInstalled(name, candidate)
      handles.set(name, captured)
      return inspectItem(options.host, catalog, name, captured)
    },
    unUse: async (data: unknown): Promise<IRpcPortableValue> => {
      const params = normalizeRemoteControlShape(
        'hostUnUseParams',
        data
      ) as readonly IRpcPortableValue[]
      const name = params[0] as string
      declared(catalog, name)
      /** Only this connection's live remote adoption authorizes removal or dependency inspection. */
      const adopted = handles.get(name)
      if (!adopted || installed.get(name) !== adopted || registrationState(adopted) === 'stale')
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.hostNotAdopted)
      const input = (params[1] ?? {}) as {
        readonly policy?: 'reject' | 'suspend'
        readonly dryRun?: boolean
      }
      const policy = input.policy ?? 'reject'
      if (input.dryRun === true) {
        const plan = await options.host.unUse(name, { policy, dryRun: true })
        return normalizePortable({ dryRun: true, ...plan })
      }
      const removal = (await options.host.unUse(name, { policy })) as IPluginRemoval
      handles.delete(name)
      installed.delete(name)
      if (removal.ok) return { ok: true }
      return {
        ok: false,
        errors: removal.errors.map((error) =>
          serializeRpcError(error, { report: ({ error: failure }) => options.report(failure) })
        )
      }
    },
    inspect: (data: unknown): IRpcPortableValue => {
      normalizeRemoteControlShape('hostInspectParams', data)
      for (const [name, record] of installed)
        if (registrationState(record) === 'stale') installed.delete(name)
      return {
        revision: options.host.revision,
        plugins: [...installed.keys()]
          .filter((name) => Object.hasOwn(catalog, name))
          .sort()
          .map((name) => inspectItem(options.host, catalog, name, installed.get(name)!))
      }
    }
  })
}

/** Exposes one Host through the reserved core control methods. */
export async function serveRemoteHost(
  options: IRemoteServeHostOptions
): Promise<IRemoteServeHostHandle> {
  /** Reuse the original resolver and exact-adopter owner for this physical connection. */
  const control = createRemoteHostControl(options)
  const catalog = control.catalog
  if (Object.values(catalog).some(contractRequiresStream) && !options.endpoint.stream) {
    try {
      await options.endpoint.endpoint.dispose()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw new RpcError(
      RpcCoreErrorCode.capabilityConflict,
      RpcRemoteLayerErrorText.streamUnavailable
    )
  }
  /** Stream providers release their registrations before endpoint disposal. */
  const streamReleases: (() => void)[] = []
  try {
    for (const contract of Object.values(catalog))
      streamReleases.push(
        ...registerRemoteMethods(
          contract,
          options.endpoint,
          (featureName) => control.liveFeature(contract.plugin, featureName),
          () => options.host.plugin.disabled().includes(contract.plugin),
          options.report
        )
      )
    options.endpoint.endpoint.provide(RemoteMethodName.describe, (context) =>
      context.success({ schemaVersion: 1, catalog })
    )
    options.endpoint.endpoint.provide(RemoteMethodName.hostUse, async (context) =>
      context.success(await control.use(context.data))
    )
    options.endpoint.endpoint.provide(RemoteMethodName.hostUnUse, async (context) =>
      context.success(await control.unUse(context.data))
    )
    options.endpoint.endpoint.provide(RemoteMethodName.hostInspect, (context) =>
      context.success(control.inspect(context.data))
    )
  } catch (error) {
    for (const release of streamReleases) release()
    try {
      await options.endpoint.endpoint.dispose()
    } catch (cleanupError) {
      options.report(cleanupError)
    }
    throw error
  }
  let closePromise: Promise<void> | undefined
  return Object.freeze({
    close: (): Promise<void> =>
      (closePromise ??= (async () => {
        for (const release of streamReleases) release()
        await options.endpoint.endpoint.dispose()
      })())
  })
}
