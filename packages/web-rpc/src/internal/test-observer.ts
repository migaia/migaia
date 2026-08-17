/** Snapshot of endpoint-owned lifecycle state exposed only to package tests. */
export type IWebRpcEndpointDebugSnapshot = {
  readonly phase: (typeof WebRpcDebugPhase)[keyof typeof WebRpcDebugPhase];
  readonly pending: number;
  readonly pingPending: number;
  readonly activeControllers: number;
  readonly chunks: number;
  readonly providers: number;
  readonly events: number;
  readonly hooks: number;
  readonly resources: number;
  readonly discovery: {
    readonly local: number;
    readonly remote: number;
    readonly waiters: number;
    readonly tasks: number;
    readonly timers: number;
    readonly manualWaiters: number;
    readonly inboundQueries: number;
    readonly inboundTimers: number;
  };
};

type IEndpointSnapshotReader = () => IWebRpcEndpointDebugSnapshot;

const readers = new WeakMap<object, IEndpointSnapshotReader>();

/** Registers a non-public lifecycle snapshot reader for deterministic package tests. */
export function registerEndpointDebugSnapshot(
  endpoint: object,
  reader: IEndpointSnapshotReader
): void {
  readers.set(endpoint, reader);
}

/** Reads an endpoint lifecycle snapshot without adding it to the public API. */
export function readEndpointDebugSnapshot(
  endpoint: object
): IWebRpcEndpointDebugSnapshot | undefined {
  return readers.get(endpoint)?.();
}
import { WebRpcDebugPhase } from '../protocol-constants.js';
