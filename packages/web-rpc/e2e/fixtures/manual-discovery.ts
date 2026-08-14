import { createBrowserMessagePortTransport } from '../../src/adapters/message-port';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, echoProvider, installErrorGuards } from './rpc';

const errors = installErrorGuards();

/** Creates a browser MessagePort wrapper pair for the manual discovery scenario. */
const createPair = () => {
  const channel = new MessageChannel();
  const wrap = (port: MessagePort) => ({
    postMessage: (message: unknown, transfer?: readonly Transferable[]) =>
      transfer ? port.postMessage(message, { transfer: [...transfer] }) : port.postMessage(message),
    start: () => port.start(),
    close: () => port.close(),
    addEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.addEventListener(type, listener),
    removeEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.removeEventListener(type, listener)
  });
  return [
    createBrowserMessagePortTransport(wrap(channel.port1)),
    createBrowserMessagePortTransport(wrap(channel.port2))
  ] as const;
};

globalThis.runManualDiscoveryScenario = async () => {
  const [clientTransport, serverTransport] = createPair();
  const client = await createRpc(
    'client',
    ['server'],
    clientTransport,
    {},
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    'manual'
  );
  const server = await createRpc(
    'server',
    ['client'],
    serverTransport,
    { echo: echoProvider },
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    'manual'
  );
  let queryCount = 0;
  server.connect.onQuery?.((query) => {
    queryCount += 1;
    if (query.targetId !== 'server') return;
    if (queryCount === 1) void query.accept({ accepted: true });
    else void query.reject('temporarily unavailable');
  });
  const candidates = await client.connect.query?.('server', { timeoutMs: 500 });
  const result = await client.send('server', 'echo', { manual: true });
  const rejectedCandidates = await client.connect.query?.('server', { timeoutMs: 500 });
  const timedOutCandidates = await client.connect.query?.('missing', { timeoutMs: 20 });
  const queryController = new AbortController();
  const abortedQuery = client.connect.query?.('missing', {
    timeoutMs: 500,
    signal: queryController.signal
  });
  queryController.abort();
  const abortedCandidates = await abortedQuery?.catch(() => []);
  const disposeQuery = client.connect.query?.('missing', { timeoutMs: 500 });
  const disposeQueryOutcome = disposeQuery?.then(
    () => 'resolved',
    (error: { readonly message?: string }) => error.message ?? 'rejected'
  );
  await client.dispose();
  const disposeQueryResult = await disposeQueryOutcome;
  const snapshots = {
    client: readEndpointDebugSnapshot(client),
    server: readEndpointDebugSnapshot(server)
  };
  await server.dispose();
  return {
    candidates,
    rejectedCandidates,
    timedOutCandidates,
    abortedCandidates,
    disposeQueryResult,
    result,
    snapshots,
    errors
  };
};

declare global {
  var runManualDiscoveryScenario: () => Promise<unknown>;
}
