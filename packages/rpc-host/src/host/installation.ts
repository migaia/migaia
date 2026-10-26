/** Join SDK definitions to their genuine native receiving host without creating another plugin-host. */
import { defineHost, getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcDefinitionMetadata } from '../sdk/metadata.js'
import {
  rpcHostPipelines,
  rpcPipelineOwner,
  type IRpcNativePipelineCore
} from '../sdk/flow-pipelines.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from './error-text.js'
import { RpcHost } from './rpc-host.js'
import { RpcFlowProgram } from '../sdk/flow-program.js'
import { readRpcDefinition, RpcDefinitionKind } from '../sdk/metadata.js'
import type { IRpcFlowPlugin, IRpcHostPlugin, IRpcTransportPlugin } from '../sdk/types.js'
import type { IRpcHost } from './public.js'
import type { IRpcSelf } from './identity.js'
import { originalRpcInstallationFailure, rpcConstructionFailure } from './error-owner.js'

/** Only createRpcHost supplies this private domain field on its actual native installation core. */
export const rpcInstallationOwner = Symbol('rpc-installation-owner')

/** Ordinary native hosts share one RPC owner under their authenticated native identity. */
const ordinaryOwners = new WeakMap<object, RpcHost>()

/** Native hooks remain the only acquisition path; their original transaction owns rollback. */
export async function installRpcDefinition(
  core: IPluginHostCore,
  metadata: IRpcDefinitionMetadata
): Promise<Record<never, never>> {
  /** Canonical native integration rejects forged structural cores before any resource opens. */
  const integration = getPluginRuntimeIntegration(core)
  /** Specialized hosts lend the exact owner already created for their one defineHost call. */
  const direct = Reflect.get(core, rpcInstallationOwner) as RpcHost | undefined
  /** Ordinary hosts reuse the authenticated identity, never a namespace supplied by a caller. */
  let owner = direct ?? ordinaryOwners.get(integration.identity)
  if (!owner || (!direct && owner.closed)) {
    /** Only the actual native host owner may lend execution; a plugin core carries registration. */
    const pipelines = Reflect.get(core, rpcPipelineOwner) as
      | IRpcNativePipelineCore[typeof rpcPipelineOwner]
      | undefined
    if (!pipelines || !integration.matchesHost(pipelines.host))
      throw tagRpcError(
        new TypeError(HostErrorText.nativePipelinesRequired),
        RpcCoreErrorCode.invalidConfig
      )
    owner = new RpcHost(
      {
        self: { name: integration.identity.name, instanceId: integration.identity.id },
        report: integration.report
      },
      integration.nodeId,
      false
    )
    ordinaryOwners.set(integration.identity, owner)
  }
  await owner.install(core, metadata)
  return {}
}

/** Installation borrows Root lifetime and publication without owning Session or pipeline state. */
type IRpcInstallationPorts = Readonly<{
  owner: object
  self(): IRpcSelf
  provide: IRpcHost['provide']
  close: IRpcHost['close']
  assertOpen(): void
  announceDirectory(): Promise<void>
  setNative(
    native: Readonly<{ dispose(): Promise<Readonly<{ cleanupErrors: readonly unknown[] }>> }>
  ): void
}>

/** Only the genuine native Host supplies these transactional operations. */
type IRpcNativeInstallation = Readonly<{
  use(...plugins: readonly (IRpcFlowPlugin | IRpcTransportPlugin)[]): Promise<unknown>
  unuse: IRpcHost['unuse']
}>

/** Compose cold startup and later batches through one native Host's existing transaction owner. */
export class RpcHostInstallation {
  /** Root retains global lifetime; this adapter only wires its native installation boundary. */
  readonly #ports: IRpcInstallationPorts
  /** Each public operation borrows the same real native Host after initial construction. */
  #native: IRpcNativeInstallation | undefined
  /** One stable projection widens types after use while preserving public object identity. */
  #public: IRpcHost | undefined

  /** Capture explicit lifetime and directory ports without acquiring any native resource. */
  constructor(ports: IRpcInstallationPorts) {
    this.#ports = ports
  }

  /** A cold failure closes the entire unpublished Host, including the committed flow prefix. */
  async open(program: RpcFlowProgram): Promise<IRpcHost> {
    /** Domain-core construction lends each actual registration its own native execution context. */
    const configuration = rpcHostPipelines(
      () => native,
      (name, request) => native.pipeline(name, request)
    )
    /** Root surface functions already carry their original receiverless method identity. */
    const ports = this.#ports
    /** Native plugin definitions, including transports, alone declare their pipeline groups. */
    const native = defineHost({
      host: {
        identity: { name: ports.self().name },
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      },
      surface: {
        get self() {
          return ports.self()
        },
        provide: ports.provide,
        close: ports.close,
        [Symbol.asyncDispose]: ports.close
      },
      domainCore: (request) => ({
        ...configuration.domainCore(request),
        [rpcInstallationOwner]: ports.owner
      })
    })
    ports.setNative(native)
    this.#native = {
      use: (...plugins) => native.use(...plugins),
      unuse: native.unUse
    }
    this.#public = this.#project(native)
    try {
      await native.use(...program.flows, program.plugin())
      await native.use(...program.transports)
      await ports.announceDirectory()
      return this.#public
    } catch (primary) {
      try {
        await ports.close()
      } catch (cleanup) {
        throw await rpcConstructionFailure(primary, cleanup)
      }
      throw (await originalRpcInstallationFailure(primary)).error
    }
  }

  /** Failure rolls back this one native batch and keeps earlier namespaces and shared setup alive. */
  readonly use = async (...plugins: readonly IRpcHostPlugin[]): Promise<IRpcHost> => {
    this.#ports.assertOpen()
    for (const plugin of plugins)
      if (readRpcDefinition(plugin)?.kind === RpcDefinitionKind.feature)
        throw tagRpcError(new TypeError(HostErrorText.flowStarted), RpcCoreErrorCode.invalidConfig)
    /** The same compiler fixes placement order before any new transport opens IO. */
    const program = new RpcFlowProgram(plugins)
    try {
      await this.#native!.use(...program.flows, ...program.transports)
      await this.#ports.announceDirectory()
      return this.#public!
    } catch (failure) {
      throw (await originalRpcInstallationFailure(failure)).error
    }
  }

  /** The native frozen facade stays the identity authority; an empty target permits method wiring. */
  #project(native: object): IRpcHost {
    /**
     * The existing native removal hook closes Sessions before its stages drain and group
     * disappears.
     */
    const unuse = this.#native!.unuse
    return new Proxy(Object.create(null), {
      get: (_target, key) =>
        key === 'use' ? this.use : key === 'unuse' ? unuse : Reflect.get(native, key),
      has: (_target, key) => key === 'unuse' || Reflect.has(native, key),
      ownKeys: () => [...Reflect.ownKeys(native), 'unuse'],
      getOwnPropertyDescriptor: (_target, key) => {
        if (key === 'use' || key === 'unuse')
          return { value: key === 'use' ? this.use : unuse, enumerable: true, configurable: true }
        /** Proxy descriptors describe this projection, not the frozen native target. */
        const descriptor = Object.getOwnPropertyDescriptor(native, key)
        return descriptor && { ...descriptor, configurable: true }
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false
    }) as IRpcHost
  }
}

/** One original close flight belongs either to native pre-release or its resource fallback. */
type IRpcTransportCloseReceipt = {
  readonly close: () => Promise<void>
  beforeRelease?: Promise<void>
}

/** Exact native registration signals route the existing beforeRelease hook to Session grace. */
const transportClosers = new WeakMap<object, IRpcTransportCloseReceipt>()

/** Attach no second lifetime; native onDispose removes this private collaboration receipt. */
export function ownRpcTransportClose(core: IPluginHostCore, close: () => Promise<void>): void {
  /** Capture the exact native signal before cleanup revokes reads through the install core. */
  const signal = core.lifecycle.signal
  /** The native hook's ledger owns its flight, including timeout continuation and late failure. */
  const receipt: IRpcTransportCloseReceipt = { close }
  transportClosers.set(signal, receipt)
  core.onDispose(() => {
    transportClosers.delete(signal)
    /** Failed installation skips beforeRelease and still needs the original resource cleanup. */
    if (!receipt.beforeRelease) return receipt.close()
  })
}

/** Native removal calls this before retiring pipeline stages or disposing transport resources. */
export function closeRpcTransport(signal: object): Promise<void> | undefined {
  /** Returning the original flight keeps one rejection in the native pre-release collection. */
  const receipt = transportClosers.get(signal)
  return receipt && (receipt.beforeRelease ??= receipt.close())
}
