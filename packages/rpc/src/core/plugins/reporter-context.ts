/** IPC diagnostics use the existing limiter reporter classification at the utils boundary. */
export const IpcReporterContext = Object.freeze({
  operation: 'limiter',
  phase: 'reporter'
} as const)
