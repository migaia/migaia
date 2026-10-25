/** Stable feature kinds are consumed only by the concrete process installer. */
export const ProcessFeatureName = {
  sendQueue: 'process-send-queue',
  flowControl: 'process-flow-control',
  log: 'process-ipc-log'
} as const
/** Original IPC capacity messages stay stable after the unique algorithm moves to this owner. */
export const ProcessFeatureText = {
  capacityInvalid: 'IPC send capacity must be a positive safe integer',
  overloaded: 'IPC send capacity is full'
} as const
/** Original reporter classification uses utils' existing terminal reporter, without another bus. */
export const IpcReporterContext = { operation: 'limiter', phase: 'reporter' } as const
/** Original bounded lane defaults and hysteresis are local physical policy, never wire fields. */
export const IpcCapacity = { data: 256, control: 8, high: 0.75, low: 0.5 } as const
