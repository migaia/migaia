/** Stable public diagnostics owned by `@migaia/store-worker`. */
export const StoreWorkerErrorText = {
  /** Stable stream-unwind message consumed by the worker credit/cancellation boundary. */
  streamCancelled: 'serialize stream cancelled',
  /** Native cancellation classification must remain AbortError across the worker error chain. */
  abortName: 'AbortError',
  optionsObject: '[store] worker options must be an object',
  workerComputedAdapter: '[store] workerComputed adapter must be a WorkerAdapter',
  workerComputedCallback: (name: string): string =>
    `[store] workerComputed ${name} must be a function`,
  workerHandlerCallback: (name: string): string =>
    `[store] createWorkerHandler ${name} must be a function`,
  handlerInvalid:
    '[store] serialize worker handler requires encode/decode parser functions and a post function',
  worker: '[store] worker options.worker must be an object',
  ownership: '[store] worker options.ownership must be copy or transfer',
  terminateOnDispose: '[store] worker options.terminateOnDispose must be boolean',
  stringOption: (name: string): string => `[store] worker options.${name} must be a string`,
  disposed: '[store] worker adapter is disposed',
  requestAbortedBoundary: '[store] worker request aborted',
  requestTimedOut: '[store] worker request timed out',
  invalidChunk: '[store] serialize worker returned an invalid chunk',
  /** Ownership is only a requested policy; the caller must inspect whether a send detached input. */
  aborted: (transferRequested: boolean): string =>
    `[store] serialize worker request aborted${transferRequested ? '; transfer may detach sent input; inspect the backing buffer before retrying' : ''}`,
  cleanupFailed: '[store] serialize worker cleanup failed',
  invalidRequestChunk: '[store] invalid serialize worker request chunk',
  invalidPhase: '[store] invalid serialize worker phase'
} as const
