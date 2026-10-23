import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'

/** Stable configuration diagnostics shared by facade and launcher admission. */
export const ThreadErrorText = {
  /** Native Worker construction rejected launch options before acquiring a Worker. */
  workerOptionsInvalid: 'Thread Worker options are invalid',
  /** The default Web-thread health check requires the negotiated native ping operation. */
  healthPingUnavailable:
    'Thread default health requires negotiated ping; supply custom health when ping is disabled',
  /** A failed actual endpoint ping is a Core transport liveness failure, not native exit evidence. */
  healthPingFailed: 'Thread health ping failed',
  /** Resource queries retain native diagnostics on cause, never in portable management details. */
  usageSampleFailed: 'thread resource sampling failed',
  invalidData: 'Thread spec.data must be a portable RPC value',
  invalidEntry: 'Thread spec.entry must be an absolute runtime entry',
  /** Browser bundlers cannot infer the caller's main entry from a library Worker constructor. */
  browserEntryRequired: 'Browser thread spawn requires an explicit URL entry',
  bootstrapFailed: rpcMessageCapabilityControl.failureText
} as const
