/**
 * Complete native process features own their original executing algorithms and installation
 * lifetime.
 */
export { sendQueue, type ISendQueueOptions } from './send-queue.ts'
export {
  flowControl,
  IpcSendClass,
  IpcLogEventName,
  type IIpcFlowControlOptions,
  type IIpcLogRecord,
  type IIpcBacklogEvent
} from './flow-control.ts'
export { ipcLog, type IIpcLogOptions, type IIpcLogContext } from './log.ts'
export type {
  IProcessFeatureContext,
  IIpcSendFacts,
  IIpcSendAdmission,
  IIpcWrite,
  IIpcBatchGuard
} from './metadata.ts'
