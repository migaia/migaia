import { describe, expect, it } from 'vitest'
import { RpcCoreErrorText, RpcAbortError, RpcTimeoutError } from '@migaia/rpc-contract/errors'

/** Literal snapshots retain the original public Contract diagnostics after Host ownership moves. */
describe('public Contract error text inventory', () => {
  it('preserves original public cancellation and timeout text', () => {
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
    expect(new RpcAbortError().message).toBe('Web RPC request cancelled')
    expect(new RpcTimeoutError().message).toBe('Web RPC request deadline exceeded')
  })

  it('preserves original public discovery and target diagnostic data', () => {
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
  })

  it('preserves original public configuration and provider diagnostic data', () => {
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
      RpcCoreErrorText.transportIdentityDescriptorInvalid,
      'transportIdentityDescriptorInvalid'
    ).toBe('transport identity descriptor is invalid')
  })
})
