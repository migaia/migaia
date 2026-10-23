import type { IRpcConnectOptions } from '@migaia/rpc-host/plugin'

/** Shared cold carrier options keep installation and handshake policy in the host SDK. */
export type IBrowserPluginOptions = Readonly<{
  /** Local native plugin registration name, independent of remote handshake identity. */
  name?: string
  /** Explicit methods exposed by an ordinary plugin-host installation. */
  expose?: readonly string[]
  /** One budget for the existing message identity and agreement exchange. */
  connect?: IRpcConnectOptions
}>
