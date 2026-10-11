/** Adapter authors classify Process failures by their stable semantic source and code. */
export {
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  RpcProcessErrorCode,
  type IRpcProcessErrorCode
} from './adapter-owned/process/error-code.js'
/** Runtime adapters classify original IPC diagnostic events using this single stable data table. */
export { IpcReporterContext } from './core/plugins/reporter-context.js'
