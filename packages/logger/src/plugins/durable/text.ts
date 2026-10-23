/** Stable durable boundary messages never include record contents or authentication options. */
export const DurableText = {
  payloadInvalid: 'durable log payload must contain only plain JSON data',
  invalidOption: 'durable log argument or call order is invalid',
  closed: 'durable log resource is no longer accepting work',
  inUse: 'durable log store is already borrowed by a plugin',
  unavailable: 'durable log SQLite builtin is unavailable in this runtime',
  locked: 'durable log SQLite file is locked by another owner',
  ioFailed: 'durable log storage operation failed',
  corrupt: 'durable log committed data is corrupt',
  exhausted: 'durable log sequence is outside the safe integer range',
  truncated: 'durable log subscription cursor was truncated',
  walInvalid: 'durable log record is missing or no longer pending',
  undoExists: 'durable undo transaction already has active images'
} as const
