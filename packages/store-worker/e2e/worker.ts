import { createWorkerHandler } from '@migaia/store-worker';

const handler = createWorkerHandler<unknown, number>(
  async (payload) => {
    if (payload === 'hang') {
      await new Promise<never>(() => undefined);
    }
    if (payload === 'fail') throw new Error('worker-e2e-failure');
    if (payload instanceof ArrayBuffer) return payload.byteLength;
    return (payload as number) * 2;
  },
  (message) => self.postMessage(message)
);

self.onmessage = (event) => {
  void handler(event.data);
};
