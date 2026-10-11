/** Stable auxiliary error text stays with its owner outside the root endpoint graph. */
export const RpcAuxiliaryErrorText = {
  /** Stable aggregate message when construction and rollback both fail. */
  endpointConstructionCleanupFailed: 'Endpoint construction failed; cleanup also failed',
  /** Stable aggregate text when listener registration fails and rollback also reports failures. */
  listenerRegistrationCleanupFailed: 'listener registration failed; cleanup also failed',
  /** Stable aggregate text for listener and reporter failures surfaced at an adapter boundary. */
  listenerCleanupFailed: 'listener cleanup failed',
  /** Describes a byte-length hook result that cannot safely represent its input. */
  invalidByteLengthMeasurement: 'Custom byteLength returned an unsafe measurement',
  /** Describes an encoded message that exceeds the configured message budget. */
  encodedMessageTooLarge: 'Encoded message exceeds configured maximum',
  /** Describes a splitter result that violates the bounded framing contract. */
  invalidChunkFrames: 'Chunk splitter returned invalid frames',
  /** Stable range text for the minimum UTF-8 chunk budget accepted by WebRPC. */
  utf8ChunkBudgetInvalid: 'maxBytes must be at least 4 bytes',
  /**
   * Stable core error text consumed by core/internal/peers.ts; preserves its existing caller-facing
   * wording.
   */
  maxLearnedMustBeAPositiveSafeInteger: 'maxLearned must be a positive safe integer',
  /**
   * Stable core error text consumed by core/internal/peers.ts; preserves its existing caller-facing
   * wording.
   */
  learnedTtlMsMustBeAPositiveSafeInteger: 'learnedTtlMs must be a positive safe integer'
} as const
