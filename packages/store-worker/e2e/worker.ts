import { createWorkerHandler } from '@migaia/store-worker';

const handler = createWorkerHandler<number, number>(
  (payload) => payload * 2,
  (message) => self.postMessage(message)
);

self.onmessage = (event) => { void handler(event.data); };
