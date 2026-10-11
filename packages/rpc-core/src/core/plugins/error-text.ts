/** Stable plugins error text stays with its owner outside the root endpoint graph. */
export const RpcPluginErrorText = {
  /** IPC capacity configuration must be a positive safe integer for bounded admission. */
  ipcCapacityInvalid: 'IPC send capacity must be a positive safe integer',
  /** A bounded IPC connection cannot admit another envelope of this class. */
  ipcSendOverloaded: 'IPC send capacity is full'
} as const
