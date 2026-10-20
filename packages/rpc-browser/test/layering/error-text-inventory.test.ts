import { describe, expect, it } from 'vitest'
import { BrowserRpcErrorText } from '../../src/browser/error-text.js'

describe('error text inventory', () => {
  it('preserves every browser error text from the pre-migration inventory', () => {
    expect(
      BrowserRpcErrorText.rtcDataChannelMustExposeReadyStateAndTerminalEventListeners,
      'rtcDataChannelMustExposeReadyStateAndTerminalEventListeners'
    ).toBe('RTCDataChannel must expose readyState and terminal event listeners')
    expect(
      BrowserRpcErrorText.rtcDataChannelMustBeOpenBeforeTransportConstruction,
      'rtcDataChannelMustBeOpenBeforeTransportConstruction'
    ).toBe('RTCDataChannel must be open before transport construction')
    expect(BrowserRpcErrorText.rtcClosed, 'rtcClosed').toBe('RTCDataChannel closed')
    expect(BrowserRpcErrorText.rtcDataChannelIsClosed, 'rtcDataChannelIsClosed').toBe(
      'RTCDataChannel is closed'
    )
    expect(BrowserRpcErrorText.rpcSharedWorkerMessageError, 'rpcSharedWorkerMessageError').toBe(
      '[rpc] shared worker message error'
    )
    expect(
      BrowserRpcErrorText.webTransportDatagramStreamEnded,
      'webTransportDatagramStreamEnded'
    ).toBe('WebTransport datagram stream ended')
    expect(BrowserRpcErrorText.webTransportIsClosed, 'webTransportIsClosed').toBe(
      'WebTransport is closed'
    )
    expect(
      BrowserRpcErrorText.webTransportRequiresUint8ArrayEncodedMessages,
      'webTransportRequiresUint8ArrayEncodedMessages'
    ).toBe('WebTransport requires Uint8Array encoded messages')
    expect(
      BrowserRpcErrorText.receiverIsRequiredOutsideAWindowLikeRealm,
      'receiverIsRequiredOutsideAWindowLikeRealm'
    ).toBe('receiver is required outside a window-like realm')
    expect(
      BrowserRpcErrorText.targetOriginMustBeExplicitUseOnlyIntentionally,
      'targetOriginMustBeExplicitUseOnlyIntentionally'
    ).toBe('targetOrigin must be explicit; use "*" only intentionally')
    expect(
      BrowserRpcErrorText.wildcardTargetOriginRequiresAllowUnsafeTargetOrigin,
      'wildcardTargetOriginRequiresAllowUnsafeTargetOrigin'
    ).toBe('wildcard targetOrigin requires allowUnsafeTargetOrigin')
  })
})
