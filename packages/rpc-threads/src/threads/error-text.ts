import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'

/** Stable configuration diagnostics shared by facade and launcher admission. */
export const ThreadErrorText = {
  /** Resource queries retain native diagnostics on cause, never in portable management details. */
  usageSampleFailed: 'thread resource sampling failed',
  invalidData: 'Thread spec.data must be a portable RPC value',
  invalidEntry: 'Thread spec.entry must be an absolute runtime entry',
  /** Browser bundlers cannot infer the caller's main entry from a library Worker constructor. */
  browserEntryRequired: 'Browser thread spawn requires an explicit URL entry',
  bootstrapFailed: rpcMessageCapabilityControl.failureText
} as const
