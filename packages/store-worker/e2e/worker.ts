import { createWorkerHandler } from '@migaia/store-worker';

const handler = createWorkerHandler<number, number>(
  async (payload) => {
    if (payload === ('hang' as unknown as number)) {
      await new Promise<never>(() => undefined);
    }
    return payload * 2;
  },
  (message) => self.postMessage(message)
);

self.onmessage = (event) => { void handler(event.data); };
