/** Ordinary diagnostics preserve the existing public Process tables and stable semantic source. */
export {
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  RpcProcessErrorCode,
  type IRpcProcessErrorCode
} from './adapter-owned/process/error-code.js'
export { RpcProcessErrorText } from './adapter-owned/process/error-text.js'
/** Runtime adapters classify original IPC diagnostic events using this single stable data table. */
export { IpcReporterContext } from './core/plugins/reporter-context.js'
