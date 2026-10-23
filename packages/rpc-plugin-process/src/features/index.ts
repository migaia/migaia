/** Cold process capacity configuration; the physical connection retains gate ownership. */
export { sendQueueFeature, type ISendQueueFeatureOptions } from './send-queue.js'
/** Diagnostics are attached once by the physical connection's existing log owner. */
export { ipcLogFeature, type IIpcLogFeatureOptions } from './log.js'
/** Existing lane/event contracts remain values and types rather than an invented third factory. */
export * from './flow-control.js'
