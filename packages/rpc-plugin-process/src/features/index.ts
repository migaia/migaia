/**
 * Complete native process features own their original executing algorithms and installation
 * lifetime.
 */
export { sendQueue, type ISendQueueOptions } from './send-queue.js'
export {
  flowControl,
  IpcSendClass,
  IpcLogEventName,
  type IIpcFlowControlOptions,
  type IIpcLogRecord,
  type IIpcBacklogEvent
} from './flow-control.js'
export { ipcLog, type IIpcLogOptions, type IIpcLogContext } from './log.js'
export type {
  IProcessFeatureContext,
  IIpcSendFacts,
  IIpcSendAdmission,
  IIpcWrite,
  IIpcBatchGuard
} from './metadata.js'
