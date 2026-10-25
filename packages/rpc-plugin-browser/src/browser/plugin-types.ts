/** Defines shared cold browser transport options, namespace metadata and installed call features. */
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'

/** Shared cold carrier options keep installation and handshake policy in the host SDK. */
export type IBrowserPluginOptions<N extends string = string> = Readonly<{
  /** Local native plugin registration name, independent of remote handshake identity. */
  name?: string
  /** A caller may install this physical source under its own unique host namespace. */
  namespace?: N
  /** Explicit methods exposed by an ordinary plugin-host installation. */
  expose?: readonly string[]
  /** One budget for the existing message identity and agreement exchange. */
  connect?: Readonly<{ timeoutMs?: number }>
  /** Complete call features are installed by the actual transport scope. */
  features?: readonly IRpcCallFeature[]
}>
