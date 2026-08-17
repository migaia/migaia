/** Field mutation mode used by WASM-backed store fields. */
export const WasmFieldMode = { sync: 'sync' } as const;

/** Reserved record keys that must not be shadowed by user fields. */
export const WasmReservedKey = {
  dispose: 'dispose',
  disposed: 'disposed'
} as const;

export type IWasmFieldMode = (typeof WasmFieldMode)[keyof typeof WasmFieldMode];
export type IWasmReservedKey = (typeof WasmReservedKey)[keyof typeof WasmReservedKey];
