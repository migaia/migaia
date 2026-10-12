/** Generic byte presentation uses existing Core semantic codes without importing a physical runtime. */
export const AdapterDefinitionText = {
  /** A closed ordered byte carrier rejects further work through the Core transport category. */
  byteClosed: 'Runtime adapter byte connection is closed',
  /** The canonical native hello exchange exhausted its existing handshake deadline. */
  handshakeTimeout: 'Runtime adapter byte handshake timed out',
  /** A real verifier refused this byte connection's received authentication value. */
  authenticationRejected: 'Runtime adapter byte authentication was rejected',
  /** The same raw byte I/O cannot have a second physical control reader. */
  duplicateBinding: 'Runtime adapter byte connection is already bound',
  /** Byte control requires one valid local offer and connection configuration. */
  optionsInvalid: 'Invalid runtime adapter byte options',
  /** Native byte control always uses the existing JSON codec. */
  jsonCodecRequired: 'Runtime adapter byte handshake requires JSON',
  /** An accepted codec outside the canonical byte owner cannot be used. */
  negotiatedCodecUnsupported: 'Runtime adapter byte codec is unsupported',
  /** Startup timeout configuration must be finite and nonnegative. */
  handshakeTimeoutInvalid: 'Invalid runtime adapter byte handshake timeout',
  /** The byte codec accepts the original serialized string, never arbitrary carrier objects. */
  expectedString: 'Runtime adapter byte channel expects a string'
} as const
