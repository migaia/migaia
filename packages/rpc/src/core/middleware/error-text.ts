/** Stable middleware error text stays with its owner outside the root endpoint graph. */
export const RpcMiddlewareErrorText = {
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationDescriptorIsInvalid: 'authentication descriptor is invalid',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationDescriptorIsUnreadable: 'authentication descriptor is unreadable',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationTransformInvalid: (name: string): string =>
    `authentication.${name} must be a function`,
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationEncryptDecryptMustBeConfiguredTogether:
    'authentication encrypt/decrypt must be configured together',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationSignVerifyMustBeConfiguredTogether:
    'authentication sign/verify must be configured together',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationRequiresEncryptionOrSigningTransforms:
    'authentication requires encryption or signing transforms',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  authenticationEncodedTypeIsInvalid: 'authentication.encodedType is invalid',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  outboundFrameAuthenticationFailed: 'Outbound frame authentication failed',
  /**
   * Stable core error text consumed by core/middleware/authentication.ts; preserves its existing
   * caller-facing wording.
   */
  inboundFrameAuthenticationFailed: 'Inbound frame authentication failed',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  transportTopologyIsInvalid: 'transport topology is invalid',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectDiscoveryModeIsInvalid: 'connect.discoveryMode is invalid',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectReceiverSelectorMustBeAFunction: 'connect.receiverSelector must be a function',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectIdentifierIsRequiredWhenBaseVerificationIsDisabled:
    'connect identifier is required when base verification is disabled',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectTransportIsRequired: 'connect transport is required',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectTransportMustProvideSendAndSubscribeFunctions:
    'connect transport must provide send and subscribe functions',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectUseBaseIdVerifyOnlyMustBeABoolean: 'connect.useBaseIdVerifyOnly must be a boolean',
  /**
   * Stable core error text consumed by core/middleware/connect.ts; preserves its existing
   * caller-facing wording.
   */
  connectIdentifierMustBeAFunction: 'connect identifier must be a function',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractDescriptorIsInvalid: 'contract descriptor is invalid',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractDescriptorIsUnreadable: 'contract descriptor is unreadable',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  schemasMustBeAnObject: 'schemas must be an object',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  schemaDescriptorInvalid: (method: string): string => `schema descriptor is invalid: ${method}`,
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractSchemasMustContainParamsResultSchemasWithParseFunctions:
    'contract.schemas must contain params/result schemas with parse functions',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractAcceptVersionsMustContainNonEmptyStrings:
    'contract.acceptVersions must contain non-empty strings',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractAcceptVersionsIsUnreadable: 'contract.acceptVersions is unreadable',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  contractVersionMustBeANonEmptyString: 'contract version must be a non-empty string',
  /**
   * Stable core error text consumed by core/middleware/contract.ts; preserves its existing
   * caller-facing wording.
   */
  maxIdentifierLengthMustBeAPositiveSafeInteger:
    'maxIdentifierLength must be a positive safe integer',
  /**
   * Stable core error text consumed by core/middleware/hooks.ts; preserves its existing
   * caller-facing wording.
   */
  hooksDescriptorIsInvalid: 'hooks descriptor is invalid',
  /**
   * Stable core error text consumed by core/middleware/hooks.ts; preserves its existing
   * caller-facing wording.
   */
  hooksDescriptorIsUnreadable: 'hooks descriptor is unreadable',
  /**
   * Stable core error text consumed by core/middleware/hooks.ts; preserves its existing
   * caller-facing wording.
   */
  hooksListenersMustContainFunctions: 'hooks.listeners must contain functions',
  /**
   * Stable core error text consumed by core/middleware/hooks.ts; preserves its existing
   * caller-facing wording.
   */
  hooksOnHookErrorMustBeAFunction: 'hooks.onHookError must be a function',
  /**
   * Stable core error text consumed by core/middleware/timeout.ts; preserves its existing
   * caller-facing wording.
   */
  timeoutDescriptorIsInvalid: 'timeout descriptor is invalid',
  /**
   * Stable core error text consumed by core/middleware/timeout.ts; preserves its existing
   * caller-facing wording.
   */
  timeoutDescriptorIsUnreadable: 'timeout descriptor is unreadable',
  /**
   * Stable core error text consumed by core/middleware/timeout.ts; preserves its existing
   * caller-facing wording.
   */
  timeoutMsMustBeFalseOrANonNegativeNumber: 'timeoutMs must be false or a non-negative number',
  /**
   * Stable core error text consumed by core/middleware/uuid.ts; preserves its existing
   * caller-facing wording.
   */
  uuidDescriptorIsInvalid: 'uuid descriptor is invalid',
  /**
   * Stable core error text consumed by core/middleware/uuid.ts; preserves its existing
   * caller-facing wording.
   */
  uuidDescriptorIsUnreadable: 'uuid descriptor is unreadable',
  /**
   * Stable core error text consumed by core/middleware/uuid.ts; preserves its existing
   * caller-facing wording.
   */
  uuidGenerateMustBeAFunction: 'uuid generate must be a function'
} as const
