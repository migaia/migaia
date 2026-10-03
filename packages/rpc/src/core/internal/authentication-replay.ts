import type { IRpcAuthenticationCapability, IRpcAuthenticationContext } from '../typing.js'
import { RpcConfigurationError } from '../errors.js'
import { RpcMiddlewareErrorText } from '../middleware/error-text.js'

/** Only the receiver owner can associate a transform context with a physical session. */
const contexts = new WeakMap<object, { session: object; active: () => boolean }>()
/** Successful physical binding is carried to canonical semantic envelopes after decoding. */
const verifiedContexts = new WeakSet<object>()
/** Envelope identity supplies provider admission with a private, unforgeable binding fact. */
const verifiedEnvelopes = new WeakSet<object>()
/** Internal counter injection permits exact uint64 boundary cases without public options. */
const counterSetters = new WeakMap<object, (counter: bigint) => void>()
/** Only locally created counter exhaustion may retain INVALID_CONFIG through sender wrapping. */
const counterErrors = new WeakSet<object>()

/**
 * Creates the existing coded configuration error and records private ownership for sender
 * reporting.
 */
export function authenticationCounterExhaustion(): RpcConfigurationError {
  /** Exact error identity prevents an arbitrary transform error from claiming this exception. */
  const error = new RpcConfigurationError(RpcMiddlewareErrorText.authenticationCounterExhausted)
  counterErrors.add(error)
  return error
}

/** Sender preserves and reports only the allocator's genuine exhaustion error. */
export function isAuthenticationCounterExhaustion(error: unknown): boolean {
  return typeof error === 'object' && error !== null && counterErrors.has(error)
}

/** Binds a receiver-owned context; caller-visible context properties do not grant authority. */
export function bindAuthenticationReplayContext(
  context: IRpcAuthenticationContext,
  session: object,
  active: () => boolean = () => true
): void {
  contexts.set(context, { session, active })
}

/** A late verification cannot revive the physical owner that supplied its context. */
export function authenticationReplaySession(
  context: IRpcAuthenticationContext
): object | undefined {
  /** Exact context ownership survives async verification without trusting user fields. */
  const binding = contexts.get(context)
  return binding?.active() ? binding.session : undefined
}

/** Records completed physical authentication before the receiver decodes any semantic member. */
export function recordAuthenticationReplayBinding(context: IRpcAuthenticationContext): void {
  verifiedContexts.add(context)
}

/** Transfers a successful whole-frame binding to a normalized member without another verification. */
export function markAuthenticationReplayEnvelope(
  context: IRpcAuthenticationContext,
  envelope: object
): void {
  if (verifiedContexts.has(context)) verifiedEnvelopes.add(envelope)
}

/** Reads only private member identity; shape, metadata and frozen copies confer no proof. */
export function hasAuthenticationReplayBinding(envelope: object): boolean {
  return verifiedEnvelopes.has(envelope)
}

/** Keeps boundary injection confined to the package's internal test surface. */
export function registerAuthenticationCounterSetter(
  capability: IRpcAuthenticationCapability,
  setter: (counter: bigint) => void
): void {
  counterSetters.set(capability, setter)
}

/** Sets only a genuine installed capability's sequence for package boundary cases. */
export function setAuthenticationReplayCounter(
  capability: IRpcAuthenticationCapability,
  counter: bigint
): boolean {
  /** A copied or arbitrary capability has no mutable counter authority. */
  const setter = counterSetters.get(capability)
  if (!setter) return false
  setter(counter)
  return true
}
