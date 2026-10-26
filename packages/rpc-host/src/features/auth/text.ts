/** Keep authentication diagnostics with the plugin that emits them. */
export const RpcAuthenticationText = {
  /** Requires a signed replay binding inside encryption; encrypt-only callers must add signing. */
  authenticationEncryptionRequiresSigning:
    'authentication encryption requires sign/verify replay binding',
  /** Binding parse/session failure is sanitized before provider admission. */
  authenticationReplayBindingInvalid: 'Authentication replay binding is invalid',
  /** A verified counter already seen or outside the fixed 64-slot window cannot execute again. */
  authenticationFrameReplayed: 'Authentication frame was replayed',
  /** Uint64 protection counters never wrap; callers must establish a new endpoint/session. */
  authenticationCounterExhausted: 'Authentication replay counter is exhausted',
  /** Signed replay nonces require 128 bits of secure entropy; weak randomness is never substituted. */
  authenticationNonceUnavailable: 'Authentication replay nonce is unavailable',
  /** Preserve entropy failure as the configuration error's cause. */
  authenticationNonceFailed: 'Authentication replay nonce generation failed',
  /** Reject non-object configuration before reading transform properties. */
  authenticationDescriptorIsInvalid: 'authentication descriptor is invalid',
  /** Identify configuration getters that failed during the installation snapshot. */
  authenticationDescriptorIsUnreadable: 'authentication descriptor is unreadable',
  /** Name the configured transform that is not callable. */
  authenticationTransformInvalid: (name: string): string =>
    `authentication.${name} must be a function`,
  /** Require decryption wherever encryption changes the callback representation. */
  authenticationEncryptDecryptMustBeConfiguredTogether:
    'authentication encrypt/decrypt must be configured together',
  /** Require verification wherever signing protects the callback representation. */
  authenticationSignVerifyMustBeConfiguredTogether:
    'authentication sign/verify must be configured together',
  /** Refuse transform configuration that supplies neither protection pair. */
  authenticationRequiresEncryptionOrSigningTransforms:
    'authentication requires encryption or signing transforms',
  /** Reject encoding choices outside the supported callback categories. */
  authenticationEncodedTypeIsInvalid: 'authentication.encodedType is invalid',
  /** Auth and connection retention share this admission rule before native credential handling. */
  authenticationRetainIsInvalid:
    'authentication.retain must be false, window, or a positive safe integer',
  /** Counter-window retention requires the configured sign/verify pair to establish real counters. */
  authenticationWindowRetentionRequiresSigning: 'authentication.retain window requires signing',
  /** Classify outbound transform failure while retaining its cause locally. */
  outboundFrameAuthenticationFailed: 'Outbound frame authentication failed',
  /** Classify inbound transform failure while retaining its cause locally. */
  inboundFrameAuthenticationFailed: 'Inbound frame authentication failed'
} as const
