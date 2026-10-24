import {
  defineFeaturePlugin,
  runtimeQuery,
  RpcTransportMode,
  type IRpcFeaturePlugin,
  type IRpcFeaturePluginDefinition,
  type IRpcHost,
  type IRpcHostMember
} from '@migaia/rpc-host/plugin'
import { createPool, validatePoolOptions } from './pool.js'
import { tagPoolError } from './error.js'
import { RpcPoolErrorCode } from './error-code.js'
import { RPC_POOL_PEER_ID, RpcPoolText } from './text.js'
import type { IPoolPluginOptions, IRpcPoolControls } from './types.js'

/** The surface looks up the original controls for this exact installed Host identity. */
type IPoolPluginSurface = Readonly<{
  controls<T>(host: IRpcHost<T>): IRpcPoolControls
}>

/** Own installation-specific controls for one configured pool feature definition. */
class PoolInstallations {
  /** Construction options belong to this plugin instance and retain their original read semantics. */
  #options: IPoolPluginOptions
  /** Only an actual installation can publish controls for that exact Host identity. */
  #installations = new WeakMap<object, IRpcPoolControls>()
  /** The Host receives the same one feature definition with its original typed surface. */
  readonly definition: IRpcFeaturePluginDefinition & Readonly<{ surface: IPoolPluginSurface }>
  /** Validate before exposing an installable definition; native members remain cold until assemble. */
  constructor(options: IPoolPluginOptions) {
    validatePoolOptions(options)
    this.#options = options
    this.definition = {
      name: RPC_POOL_PEER_ID,
      surface: { controls: this.#controls },
      assemble: this.#assemble
    }
  }
  /** Lookup original controls without reviving or replacing a retired pool installation. */
  #controls = <T>(host: IRpcHost<T>): IRpcPoolControls => {
    const controls = this.#installations.get(host)
    if (!controls)
      throw tagPoolError(
        new TypeError(RpcPoolText.controlsUnavailable),
        RpcPoolErrorCode.invalidOptions
      )
    return controls
  }
  /** Compose one real pool scheduler through the Host's existing member opener and query owner. */
  #assemble: NonNullable<IRpcFeaturePluginDefinition['assemble']> = async (
    context
  ): Promise<IRpcHostMember> => {
    if (
      context.transport.mode !== RpcTransportMode.spawn &&
      context.transport.mode !== RpcTransportMode.connect
    )
      throw tagPoolError(
        new TypeError(RpcPoolText.transportUnsupported),
        RpcPoolErrorCode.transportUnsupported
      )
    /** The existing scheduler acquires every real member through the Host's one endpoint. */
    const pool = await createPool(this.#options, context.openMember)
    /** Read the canonical local view before the Host publishes this assembled member. */
    const base = await context.host.describe()
    /** No new drain or cleanup receipt sits between these controls and their original scheduler. */
    const controls: IRpcPoolControls = Object.freeze({
      stats: pool.stats,
      resize: pool.resize,
      close: pool.close
    })
    this.#installations.set(context.host, controls)
    return Object.freeze({
      id: RPC_POOL_PEER_ID,
      request: pool.request,
      notify: pool.notify,
      stream: pool.stream,
      group: pool.group,
      outcome: pool.outcome,
      describe: runtimeQuery(() => ({ ...base, pool: pool.stats() })),
      on: (...args: Parameters<IRpcHostMember['on']>) => context.host.on(...args),
      close: pool.close,
      [Symbol.asyncDispose]: pool.close
    })
  }
}

/** One definition owns distinct installation controls while each Host retains its actual pool. */
export const poolPlugin: (options: IPoolPluginOptions) => IRpcFeaturePlugin & IPoolPluginSurface =
  defineFeaturePlugin<IPoolPluginOptions, IPoolPluginSurface>(
    (options) => new PoolInstallations(options).definition
  )
