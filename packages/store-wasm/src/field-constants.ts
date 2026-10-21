/** Reserved record keys that must not be shadowed by user fields. */
export const WasmReservedKey = {
  /** Owned record cleanup method; a user field cannot shadow it. */
  dispose: 'dispose',
  /** Terminal record-state getter; a user field cannot shadow it. */
  disposed: 'disposed'
} as const

/** Public reserved record-name values, rejected when the Store creates the record field. */
export type IWasmReservedKey = (typeof WasmReservedKey)[keyof typeof WasmReservedKey]
