import { cookies, indexedDb, localStorage, memoryStorage } from '../src/index';

type IWorkerResult = {
  readonly memory: string | null;
  readonly indexedDb: string | null;
  readonly localStorageCode: string | undefined;
  readonly cookiesCode: string | undefined;
};

const getFailureCode = (factory: () => unknown): string | undefined => {
  try {
    factory();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

self.onmessage = async (): Promise<void> => {
  const memory = memoryStorage();
  await memory.set('worker-memory', 'ok');
  const database = indexedDb({ dbName: `worker-${crypto.randomUUID()}` });
  await database.set('worker-indexeddb', 'ok');
  const result: IWorkerResult = {
    memory: await memory.get('worker-memory'),
    indexedDb: await database.get('worker-indexeddb'),
    localStorageCode: getFailureCode(() => localStorage()),
    cookiesCode: getFailureCode(() => cookies({ namespace: 'worker' }))
  };
  await memory.dispose();
  await database.dispose();
  self.postMessage(result);
};
