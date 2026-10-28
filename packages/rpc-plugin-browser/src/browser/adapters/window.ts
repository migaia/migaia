/** Supplies a Window carrier with exact native source filtering and explicit destination origin. */
import { detectGlobalScope, GlobalScopeKind } from '@migaia/utils'
import { RpcCarrierPlatform, RpcCarrierTopology } from '@migaia/rpc-contract/interfaces'
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { BrowserRpcErrorText } from '../error-text.ts'
import { createBrowserConfigurationError } from '../error.ts'
import { browserMessageCarrier } from '../native-message.ts'

/** The caller owns the remote Window; transfer retains native structured-clone semantics. */
export type IWindowMessageTarget = {
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly Transferable[]): void
}
/** The local receiving realm owns registration independently from the outgoing Window. */
export type IWindowMessageReceiver = {
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void
}
/** Native source identity and explicit destination origin form one immutable admission rule. */
export type IWindowMessageTransportOptions = Readonly<{
  target: IWindowMessageTarget
  receiver?: IWindowMessageReceiver
  targetOrigin?: string
  allowUnsafeTargetOrigin?: boolean
}>

/** Reject wrong native source/origin before codec admission; retirement never closes a Window. */
export function createWindowCarrier(
  options: IWindowMessageTransportOptions,
  context: Pick<IRpcTransportSetupContext, 'report'>
) {
  /** Realm fallback is native acquisition, never a protocol identity fallback. */
  const receiver =
    options.receiver ??
    (detectGlobalScope() === GlobalScopeKind.window
      ? (globalThis as unknown as IWindowMessageReceiver)
      : undefined)
  /** The admitted remote origin is reused for both the native send and source filter. */
  const origin =
    options.targetOrigin ??
    (globalThis as unknown as { location?: { origin?: unknown } }).location?.origin
  if (!receiver)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.receiverIsRequiredOutsideAWindowLikeRealm
    )
  if (typeof origin !== 'string' || !origin)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.targetOriginMustBeExplicitUseOnlyIntentionally
    )
  if (origin === '*' && options.allowUnsafeTargetOrigin !== true)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.wildcardTargetOriginRequiresAllowUnsafeTargetOrigin
    )
  return Object.assign(
    browserMessageCarrier(
      {
        receiver,
        origin: origin === '*' ? undefined : origin,
        send: (value, transfer) => options.target.postMessage(value, origin, transfer),
        accept: (event) =>
          event.source === options.target && (origin === '*' || event.origin === origin)
      },
      context,
      RpcCarrierPlatform.iframe,
      RpcCarrierTopology.multiplexed
    ),
    { startupMessagesMayBeLost: true as const }
  )
}
