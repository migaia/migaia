/** Defines shared cold browser transport options, namespace metadata and installed call features. */
import type { IRpcAuthenticationRetain, IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import type { IRpcFlowFeature } from '@migaia/rpc-host/sdk'

/** Call policies and opaque flow capabilities share the same receiving transport namespace. */
export type IBrowserFeature = IRpcCallFeature | IRpcFlowFeature<object>

/** Shared cold carrier options keep installation and handshake policy in the host SDK. */
export type IBrowserPluginOptions<N extends string = string> = Readonly<{
  /** Local native plugin registration name, independent of remote handshake identity. */
  name?: string
  /** A caller may install this physical source under its own unique host namespace. */
  namespace?: N
  /** Explicit methods exposed by an ordinary plugin-host installation. */
  expose?: readonly string[]
  /** One budget for the existing message identity and agreement exchange. */
  connect?: Readonly<{
    timeoutMs?: number
    /** Native receiver Sessions override auth retention through the same local connection context. */
    retain?: IRpcAuthenticationRetain
  }>
  /** Complete call policies and opaque flow features share the actual transport scope. */
  features?: readonly IBrowserFeature[]
}>
