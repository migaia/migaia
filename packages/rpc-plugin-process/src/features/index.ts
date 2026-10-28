/**
 * Complete native process features own their original executing algorithms and installation
 * lifetime.
 */
export { sendQueueFeature, type ISendQueueOptions } from './send-queue.ts'
export {
  flowControlFeature,
  IpcSendClass,
  IpcLogEventName,
  type IIpcFlowControlOptions,
  type IIpcLogRecord,
  type IIpcBacklogEvent
} from './flow-control.ts'
export { ipcLogFeature, type IIpcLogOptions, type IIpcLogContext } from './log.ts'
export type {
  IProcessFeatureContext,
  IIpcSendFacts,
  IIpcSendAdmission,
  IIpcWrite,
  IIpcBatchGuard
} from './metadata.ts'
