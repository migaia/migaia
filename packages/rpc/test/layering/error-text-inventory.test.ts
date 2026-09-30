import { RpcAuxiliaryErrorText } from '../../src/core/internal/auxiliary-error-text.js'
import { RpcAdapterErrorText } from '../../src/core/adapters/error-text.js'
import { RpcMiddlewareErrorText } from '../../src/core/middleware/error-text.js'
import { describe, expect, it } from 'vitest'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { BrowserRpcErrorText } from '../../src/browser/error-text.js'
import { RpcAbortError, RpcTimeoutError } from '../../src/core/errors.js'

describe('error text inventory', () => {
  it('[A2] preserves every core error text from the pre-migration inventory', () => {
    expect(RpcAdapterErrorText.rpcMemoryTransportIsClosed, 'rpcMemoryTransportIsClosed').toBe(
      '[rpc] memory transport is closed'
    )
    expect(RpcCoreErrorText.webRPCRequestCancelled, 'webRPCRequestCancelled').toBe(
      'Web RPC request cancelled'
    )
    expect(RpcCoreErrorText.webRPCRequestDeadlineExceeded, 'webRPCRequestDeadlineExceeded').toBe(
      'Web RPC request deadline exceeded'
    )
    expect(
      RpcCoreErrorText.timeoutMustBeFalseOrANonNegativeFiniteNumber,
      'timeoutMustBeFalseOrANonNegativeFiniteNumber'
    ).toBe('timeout must be false or a non-negative finite number')
    expect(RpcCoreErrorText.queryListenerMustBeAFunction, 'queryListenerMustBeAFunction').toBe(
      'query listener must be a function'
    )
    expect(
      RpcCoreErrorText.broadcastTargetNotIdentifiable('x'),
      'broadcastTargetNotIdentifiable'
    ).toBe('BroadcastChannel target is not individually identifiable: x')
    expect(RpcCoreErrorText.unknownReceiver('x'), 'unknownReceiver').toBe('Unknown receiver: x')
    expect(RpcCoreErrorText.pinnedReceiverUnavailable('x'), 'pinnedReceiverUnavailable').toBe(
      'Pinned receiver is unavailable: x'
    )
    expect(
      RpcCoreErrorText.receiverSelectorReturnedAnInvalidReceiver,
      'receiverSelectorReturnedAnInvalidReceiver'
    ).toBe('receiverSelector returned an invalid receiver')
    expect(RpcCoreErrorText.selectedReceiverUnavailable('x'), 'selectedReceiverUnavailable').toBe(
      'receiverSelector returned an unavailable receiver: x'
    )
    expect(RpcCoreErrorText.unknownTarget('x'), 'unknownTarget').toBe('Unknown target: x')
    expect(
      RpcCoreErrorText.discoveryTimeoutMustBeFiniteAndNonNegative,
      'discoveryTimeoutMustBeFiniteAndNonNegative'
    ).toBe('discovery timeout must be finite and non-negative')
    expect(RpcCoreErrorText.discoveryAborted, 'discoveryAborted').toBe('Discovery aborted')
    expect(RpcCoreErrorText.discoveryCandidateIsInvalid, 'discoveryCandidateIsInvalid').toBe(
      'discovery candidate is invalid'
    )
    expect(
      RpcCoreErrorText.discoveryCandidateWasNotProducedByAVerifiedManualQuery,
      'discoveryCandidateWasNotProducedByAVerifiedManualQuery'
    ).toBe('discovery candidate was not produced by a verified manual query')
    expect(
      RpcCoreErrorText.discoveryCandidateReceiverIdIsInvalid,
      'discoveryCandidateReceiverIdIsInvalid'
    ).toBe('discovery candidate receiverId is invalid')
    expect(RpcCoreErrorText.discoveryCandidateWasRevoked, 'discoveryCandidateWasRevoked').toBe(
      'discovery candidate was revoked'
    )
    expect(RpcCoreErrorText.receiverLimitExceeded, 'receiverLimitExceeded').toBe(
      'receiver limit exceeded'
    )
    expect(
      RpcCoreErrorText.verifiedDiscoveryBindingIsNoLongerAvailable,
      'verifiedDiscoveryBindingIsNoLongerAvailable'
    ).toBe('verified discovery binding is no longer available')
    expect(
      RpcCoreErrorText.remoteDiscoveryTargetLimitExceeded,
      'remoteDiscoveryTargetLimitExceeded'
    ).toBe('remote discovery target limit exceeded')
    expect(
      RpcCoreErrorText.manualRevocationCapacityExceeded,
      'manualRevocationCapacityExceeded'
    ).toBe('manual revocation capacity exceeded')
    expect(
      RpcCoreErrorText.discoveryCandidateUniqueTargetIdMustBeAString,
      'discoveryCandidateUniqueTargetIdMustBeAString'
    ).toBe('discovery candidate uniqueTargetId must be a string')
    expect(
      RpcCoreErrorText.queryRejectionReasonMustBeAString,
      'queryRejectionReasonMustBeAString'
    ).toBe('query rejection reason must be a string')
    expect(RpcCoreErrorText.manualDiscoveryIsUnavailable, 'manualDiscoveryIsUnavailable').toBe(
      'manual discovery is unavailable'
    )
    expect(RpcCoreErrorText.identifierInvalid('x'), 'identifierInvalid').toBe(
      'x must be a non-empty identifier within the limit'
    )
    expect(RpcCoreErrorText.discoveryRegistryClosed, 'discoveryRegistryClosed').toBe(
      'discovery registry closed'
    )
    expect(RpcCoreErrorText.connectMiddlewareIsRequired, 'connectMiddlewareIsRequired').toBe(
      'connect middleware is required'
    )
    expect(
      RpcCoreErrorText.idAndTargetIdsMustFitTheConfiguredIdentifierLimit,
      'idAndTargetIdsMustFitTheConfiguredIdentifierLimit'
    ).toBe('id and targetIds must fit the configured identifier limit')
    expect(
      RpcCoreErrorText.connectUniqueTargetIdFactoryFailed,
      'connectUniqueTargetIdFactoryFailed'
    ).toBe('connect.uniqueTargetId factory failed')
    expect(
      RpcCoreErrorText.outboundFrameAndTransportEncodedTypesAreIncompatible,
      'outboundFrameAndTransportEncodedTypesAreIncompatible'
    ).toBe('outbound frame and transport encoded types are incompatible')
    expect(RpcCoreErrorText.factoryDescriptorIsInvalid, 'factoryDescriptorIsInvalid').toBe(
      'factory descriptor is invalid'
    )
    expect(RpcCoreErrorText.factoryDescriptorIsUnreadable, 'factoryDescriptorIsUnreadable').toBe(
      'factory descriptor is unreadable'
    )
    expect(RpcCoreErrorText.idMustBeANonEmptyString, 'idMustBeANonEmptyString').toBe(
      'id must be a non-empty string'
    )
    expect(RpcCoreErrorText.middlewaresMustBeAnArray, 'middlewaresMustBeAnArray').toBe(
      'middlewares must be an array'
    )
    expect(RpcCoreErrorText.targetIdsMustBeAnArray, 'targetIdsMustBeAnArray').toBe(
      'targetIds must be an array'
    )
    expect(
      RpcCoreErrorText.targetIdsMustContainNonEmptyStrings,
      'targetIdsMustContainNonEmptyStrings'
    ).toBe('targetIds must contain non-empty strings')
    expect(RpcCoreErrorText.factoryCollectionIsUnreadable, 'factoryCollectionIsUnreadable').toBe(
      'factory collection is unreadable'
    )
    expect(RpcCoreErrorText.duplicateMiddleware('x'), 'duplicateMiddleware').toBe(
      'Duplicate middleware: x'
    )
    expect(RpcCoreErrorText.middlewaresAreUnreadable, 'middlewaresAreUnreadable').toBe(
      'middlewares are unreadable'
    )
    expect(
      RpcCoreErrorText.connectMiddlewareMustProvideTransport,
      'connectMiddlewareMustProvideTransport'
    ).toBe('connect middleware must provide transport')
    expect(RpcCoreErrorText.transportDescriptorInvalid, 'transportDescriptorInvalid').toBe(
      'transport descriptor is invalid'
    )
    expect(
      RpcCoreErrorText.uuidGeneratorMustReturnANonEmptyString,
      'uuidGeneratorMustReturnANonEmptyString'
    ).toBe('UUID generator must return a non-empty string')
    expect(RpcCoreErrorText.uuidConflict('x'), 'uuidConflict').toBe('UUID conflict: x')
    expect(RpcCoreErrorText.uuidUnavailable, 'uuidUnavailable').toBe('UUID unavailable')
    expect(
      RpcCoreErrorText.bindingLimitsMustBePositiveSafeIntegers,
      'bindingLimitsMustBePositiveSafeIntegers'
    ).toBe('binding limits must be positive safe integers')
    expect(RpcCoreErrorText.endpointDisposed, 'endpointDisposed').toBe('Endpoint disposed')
    expect(
      RpcAuxiliaryErrorText.maxLearnedMustBeAPositiveSafeInteger,
      'maxLearnedMustBeAPositiveSafeInteger'
    ).toBe('maxLearned must be a positive safe integer')
    expect(
      RpcAuxiliaryErrorText.learnedTtlMsMustBeAPositiveSafeInteger,
      'learnedTtlMsMustBeAPositiveSafeInteger'
    ).toBe('learnedTtlMs must be a positive safe integer')
    expect(
      RpcCoreErrorText.providerAdmissionLimitsMustBePositiveSafeIntegers,
      'providerAdmissionLimitsMustBePositiveSafeIntegers'
    ).toBe('provider admission limits must be positive safe integers')
    expect(
      RpcCoreErrorText.providerTransferMustBeABoundedArray,
      'providerTransferMustBeABoundedArray'
    ).toBe('provider transfer must be a bounded array')
    expect(
      RpcCoreErrorText.providerFailureMessageAndCodeMustBeStrings,
      'providerFailureMessageAndCodeMustBeStrings'
    ).toBe('provider failure message and code must be strings')
    expect(RpcCoreErrorText.requestReplayLedgerIsFull, 'requestReplayLedgerIsFull').toBe(
      'Request replay ledger is full'
    )
    expect(RpcCoreErrorText.providerAdmissionLimitReached, 'providerAdmissionLimitReached').toBe(
      'Provider admission limit reached'
    )
    expect(RpcCoreErrorText.verifiedPeerBindingExpired, 'verifiedPeerBindingExpired').toBe(
      'Verified peer binding expired'
    )
    expect(RpcCoreErrorText.providerContextExpired, 'providerContextExpired').toBe(
      'Provider context expired'
    )
    expect(
      RpcCoreErrorText.dispatchTargetIdMustBeANonEmptyString,
      'dispatchTargetIdMustBeANonEmptyString'
    ).toBe('dispatch target id must be a non-empty string')
    expect(RpcCoreErrorText.providerNotFound, 'providerNotFound').toBe('Provider not found')
    expect(RpcCoreErrorText.providerDidNotSettle, 'providerDidNotSettle').toBe(
      'Provider did not settle'
    )
    expect(RpcCoreErrorText.providerFailed, 'providerFailed').toBe('Provider failed')
    expect(
      RpcCoreErrorText.replayLimitsMustBePositiveSafeIntegers,
      'replayLimitsMustBePositiveSafeIntegers'
    ).toBe('replay limits must be positive safe integers')
    expect(
      RpcCoreErrorText.requestReplayLimitsMustBePositiveSafeIntegers,
      'requestReplayLimitsMustBePositiveSafeIntegers'
    ).toBe('request replay limits must be positive safe integers')
    expect(
      RpcCoreErrorText.pluginInstallFailureDetail('x', 'x'),
      'pluginInstallFailureDetail'
    ).toBe('x: x')
    expect(
      RpcMiddlewareErrorText.authenticationDescriptorIsInvalid,
      'authenticationDescriptorIsInvalid'
    ).toBe('authentication descriptor is invalid')
    expect(
      RpcMiddlewareErrorText.authenticationDescriptorIsUnreadable,
      'authenticationDescriptorIsUnreadable'
    ).toBe('authentication descriptor is unreadable')
    expect(
      RpcMiddlewareErrorText.authenticationTransformInvalid('x'),
      'authenticationTransformInvalid'
    ).toBe('authentication.x must be a function')
    expect(
      RpcMiddlewareErrorText.authenticationEncryptDecryptMustBeConfiguredTogether,
      'authenticationEncryptDecryptMustBeConfiguredTogether'
    ).toBe('authentication encrypt/decrypt must be configured together')
    expect(
      RpcMiddlewareErrorText.authenticationSignVerifyMustBeConfiguredTogether,
      'authenticationSignVerifyMustBeConfiguredTogether'
    ).toBe('authentication sign/verify must be configured together')
    expect(
      RpcMiddlewareErrorText.authenticationRequiresEncryptionOrSigningTransforms,
      'authenticationRequiresEncryptionOrSigningTransforms'
    ).toBe('authentication requires encryption or signing transforms')
    expect(
      RpcMiddlewareErrorText.authenticationEncodedTypeIsInvalid,
      'authenticationEncodedTypeIsInvalid'
    ).toBe('authentication.encodedType is invalid')
    expect(
      RpcMiddlewareErrorText.outboundFrameAuthenticationFailed,
      'outboundFrameAuthenticationFailed'
    ).toBe('Outbound frame authentication failed')
    expect(
      RpcMiddlewareErrorText.inboundFrameAuthenticationFailed,
      'inboundFrameAuthenticationFailed'
    ).toBe('Inbound frame authentication failed')
    expect(RpcMiddlewareErrorText.transportTopologyIsInvalid, 'transportTopologyIsInvalid').toBe(
      'transport topology is invalid'
    )
    expect(
      RpcMiddlewareErrorText.connectDiscoveryModeIsInvalid,
      'connectDiscoveryModeIsInvalid'
    ).toBe('connect.discoveryMode is invalid')
    expect(
      RpcMiddlewareErrorText.connectReceiverSelectorMustBeAFunction,
      'connectReceiverSelectorMustBeAFunction'
    ).toBe('connect.receiverSelector must be a function')
    expect(
      RpcMiddlewareErrorText.connectIdentifierIsRequiredWhenBaseVerificationIsDisabled,
      'connectIdentifierIsRequiredWhenBaseVerificationIsDisabled'
    ).toBe('connect identifier is required when base verification is disabled')
    expect(RpcMiddlewareErrorText.connectTransportIsRequired, 'connectTransportIsRequired').toBe(
      'connect transport is required'
    )
    expect(
      RpcMiddlewareErrorText.connectTransportMustProvideSendAndSubscribeFunctions,
      'connectTransportMustProvideSendAndSubscribeFunctions'
    ).toBe('connect transport must provide send and subscribe functions')
    expect(
      RpcMiddlewareErrorText.connectUseBaseIdVerifyOnlyMustBeABoolean,
      'connectUseBaseIdVerifyOnlyMustBeABoolean'
    ).toBe('connect.useBaseIdVerifyOnly must be a boolean')
    expect(
      RpcMiddlewareErrorText.connectIdentifierMustBeAFunction,
      'connectIdentifierMustBeAFunction'
    ).toBe('connect identifier must be a function')
    expect(
      RpcCoreErrorText.transportIdentityDescriptorInvalid,
      'transportIdentityDescriptorInvalid'
    ).toBe('transport identity descriptor is invalid')
    expect(RpcMiddlewareErrorText.contractDescriptorIsInvalid, 'contractDescriptorIsInvalid').toBe(
      'contract descriptor is invalid'
    )
    expect(
      RpcMiddlewareErrorText.contractDescriptorIsUnreadable,
      'contractDescriptorIsUnreadable'
    ).toBe('contract descriptor is unreadable')
    expect(RpcMiddlewareErrorText.schemasMustBeAnObject, 'schemasMustBeAnObject').toBe(
      'schemas must be an object'
    )
    expect(RpcMiddlewareErrorText.schemaDescriptorInvalid('x'), 'schemaDescriptorInvalid').toBe(
      'schema descriptor is invalid: x'
    )
    expect(
      RpcMiddlewareErrorText.contractSchemasMustContainParamsResultSchemasWithParseFunctions,
      'contractSchemasMustContainParamsResultSchemasWithParseFunctions'
    ).toBe('contract.schemas must contain params/result schemas with parse functions')
    expect(
      RpcMiddlewareErrorText.contractAcceptVersionsMustContainNonEmptyStrings,
      'contractAcceptVersionsMustContainNonEmptyStrings'
    ).toBe('contract.acceptVersions must contain non-empty strings')
    expect(
      RpcMiddlewareErrorText.contractAcceptVersionsIsUnreadable,
      'contractAcceptVersionsIsUnreadable'
    ).toBe('contract.acceptVersions is unreadable')
    expect(
      RpcMiddlewareErrorText.contractVersionMustBeANonEmptyString,
      'contractVersionMustBeANonEmptyString'
    ).toBe('contract version must be a non-empty string')
    expect(
      RpcMiddlewareErrorText.maxIdentifierLengthMustBeAPositiveSafeInteger,
      'maxIdentifierLengthMustBeAPositiveSafeInteger'
    ).toBe('maxIdentifierLength must be a positive safe integer')
    expect(RpcMiddlewareErrorText.hooksDescriptorIsInvalid, 'hooksDescriptorIsInvalid').toBe(
      'hooks descriptor is invalid'
    )
    expect(RpcMiddlewareErrorText.hooksDescriptorIsUnreadable, 'hooksDescriptorIsUnreadable').toBe(
      'hooks descriptor is unreadable'
    )
    expect(
      RpcMiddlewareErrorText.hooksListenersMustContainFunctions,
      'hooksListenersMustContainFunctions'
    ).toBe('hooks.listeners must contain functions')
    expect(
      RpcMiddlewareErrorText.hooksOnHookErrorMustBeAFunction,
      'hooksOnHookErrorMustBeAFunction'
    ).toBe('hooks.onHookError must be a function')
    expect(RpcMiddlewareErrorText.timeoutDescriptorIsInvalid, 'timeoutDescriptorIsInvalid').toBe(
      'timeout descriptor is invalid'
    )
    expect(
      RpcMiddlewareErrorText.timeoutDescriptorIsUnreadable,
      'timeoutDescriptorIsUnreadable'
    ).toBe('timeout descriptor is unreadable')
    expect(
      RpcMiddlewareErrorText.timeoutMsMustBeFalseOrANonNegativeNumber,
      'timeoutMsMustBeFalseOrANonNegativeNumber'
    ).toBe('timeoutMs must be false or a non-negative number')
    expect(RpcMiddlewareErrorText.uuidDescriptorIsInvalid, 'uuidDescriptorIsInvalid').toBe(
      'uuid descriptor is invalid'
    )
    expect(RpcMiddlewareErrorText.uuidDescriptorIsUnreadable, 'uuidDescriptorIsUnreadable').toBe(
      'uuid descriptor is unreadable'
    )
    expect(RpcMiddlewareErrorText.uuidGenerateMustBeAFunction, 'uuidGenerateMustBeAFunction').toBe(
      'uuid generate must be a function'
    )
  })
  it('[A2] preserves every browser error text from the pre-migration inventory', () => {
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
    expect(BrowserRpcErrorText.workerMessageReadFailed('x'), 'workerMessageReadFailed').toBe(
      '[rpc] worker message could not be read: x'
    )
    expect(BrowserRpcErrorText.workerFailure('x', 'x'), 'workerFailure').toBe('[rpc] worker x: x')
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
  it('[A2] keeps native cancellation and timeout default messages unchanged', () => {
    expect(new RpcAbortError().message).toBe('Web RPC request cancelled')
    expect(new RpcTimeoutError().message).toBe('Web RPC request deadline exceeded')
  })
})
