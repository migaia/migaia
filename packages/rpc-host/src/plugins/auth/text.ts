/** Stable authentication diagnostics move with their unique plugin execution owner. */
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
  /** Entropy failure keeps the original cause on a coded configuration error. */
  authenticationNonceFailed: 'Authentication replay nonce generation failed',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationDescriptorIsInvalid: 'authentication descriptor is invalid',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationDescriptorIsUnreadable: 'authentication descriptor is unreadable',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationTransformInvalid: (name: string): string =>
    `authentication.${name} must be a function`,
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationEncryptDecryptMustBeConfiguredTogether:
    'authentication encrypt/decrypt must be configured together',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationSignVerifyMustBeConfiguredTogether:
    'authentication sign/verify must be configured together',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationRequiresEncryptionOrSigningTransforms:
    'authentication requires encryption or signing transforms',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  authenticationEncodedTypeIsInvalid: 'authentication.encodedType is invalid',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  outboundFrameAuthenticationFailed: 'Outbound frame authentication failed',
  /** Stable core error text consumed by plugins/auth; preserves its existing caller-facing wording. */
  inboundFrameAuthenticationFailed: 'Inbound frame authentication failed'
} as const
