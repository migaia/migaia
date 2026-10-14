/**
 * The part of a native worker `message` event that store-worker reads. Declared structurally so the
 * package needs no DOM types; a real `MessageEvent` from any supported runtime is assignable.
 */
export type IWorkerMessageEvent = Readonly<{ data: unknown }>
