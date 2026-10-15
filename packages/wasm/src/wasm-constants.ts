/** MIME type required when a WASM module is streamed by the browser. */
export const WasmMimeType = { module: 'application/wasm' } as const;

export type IWasmMimeType = (typeof WasmMimeType)[keyof typeof WasmMimeType];
