import type { IWebRpcEndpoint } from '@migaia/web-rpc';

export type ManagedRpcHandler = {
  (message: unknown): Promise<void>;
  dispose(): void;
  disposeAsync(): Promise<void>;
  readonly pendingCount: number;
  readonly disposed: boolean;
};

export function toManagedRpcHandler<TTargetId extends string>(
  endpointPromise: Promise<IWebRpcEndpoint<TTargetId, 'automatic', false>>,
  deliver: (message: unknown) => void
): ManagedRpcHandler {
  let pendingCount = 0;
  let disposed = false;
  const handler = (async (message: unknown): Promise<void> => {
    if (disposed) return;
    pendingCount += 1;
    try {
      await endpointPromise;
      deliver(message);
      await Promise.resolve();
    } finally {
      pendingCount -= 1;
    }
  }) as ManagedRpcHandler;
  handler.dispose = () => {
    disposed = true;
    void endpointPromise.then((endpoint) => endpoint.dispose()).catch(() => undefined);
  };
  handler.disposeAsync = async () => {
    disposed = true;
    const endpoint = await endpointPromise;
    await endpoint.dispose();
  };
  Object.defineProperty(handler, 'pendingCount', { get: () => pendingCount });
  Object.defineProperty(handler, 'disposed', { get: () => disposed });
  return handler;
}
