/** Reserved record keys that must not be shadowed by user fields. */
export const WasmReservedKey = {
  dispose: 'dispose',
  disposed: 'disposed'
} as const

export type IWasmReservedKey = (typeof WasmReservedKey)[keyof typeof WasmReservedKey]
