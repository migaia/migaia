/** Native fixture messages are local test data, with one owner and unchanged RED spellings. */
export const RuntimeApiFixtureText = {
  /** Tests the result wrapper's preservation of its child summary secret boundary. */
  resultGetterFailure: 'private-result-marker',
  /** Distinguishes local cancellation after a notify send has already completed. */
  postCommitCancellation: 'post-commit fixture cancellation',
  /** This native business cause must keep its original name, message and stack. */
  businessRange: 'business range fixture',
  /** A handler-created serialization error must retain the original INTERNAL classification. */
  businessSerialization: 'business serialization fixture',
  /** Identity of a caller's already-aborted native reason is independently asserted. */
  preAbort: 'one-way cancellation fixture',
  /** Identity of cancellation while the canonical physical queue is occupied is asserted. */
  queuedAbort: 'queued one-way cancellation fixture',
  /** A sign failure after cancellation must remain reported through the original cause. */
  lateAuthentication: 'late authentication fixture failure',
  /** Native caller cancellation during asynchronous signing must not become a transport failure. */
  signingAbort: 'signing cancellation fixture',
  /** A notify business rejection is independent from successful physical send completion. */
  notifyFailure: 'notify-business-rejection',
  /** Ordered native children prove AggregateError.errors transfer rather than only a cause chain. */
  aggregateType: 'aggregate-type',
  /** The second native child must retain its distinct identity and serialized stack. */
  aggregateRange: 'aggregate-range',
  /** The aggregate's message and original native type are retained in both directions. */
  aggregateFailure: 'aggregate-business-failure'
} as const
