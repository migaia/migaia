import { createBrowserMessagePortTransport } from '../../src/adapters/message-port';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, echoProvider, installErrorGuards } from './rpc';

const errors = installErrorGuards();

globalThis.runMessagePortScenario = async () => {
  const channel = new MessageChannel();
  const closeCounts = [0, 0];
  const wrapPort = (port: MessagePort, index: number) => ({
    postMessage: (message: unknown, transfer?: readonly Transferable[]) =>
      transfer ? port.postMessage(message, { transfer: [...transfer] }) : port.postMessage(message),
    start: () => port.start(),
    close: () => {
      closeCounts[index] += 1;
      port.close();
    },
    addEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.addEventListener(type, listener),
    removeEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.removeEventListener(type, listener)
  });
  const left = await createRpc(
    'left',
    ['right'],
    createBrowserMessagePortTransport(wrapPort(channel.port1, 0))
  );
  const right = await createRpc(
    'right',
    ['left'],
    createBrowserMessagePortTransport(wrapPort(channel.port2, 1)),
    { echo: echoProvider }
  );
  const result = await left.send('right', 'echo', { value: 42 });
  await left.dispose();
  await right.dispose();
  return {
    result,
    errors,
    portsClosed: closeCounts,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  };
};

globalThis.runBorrowedMessagePortScenario = async () => {
  const channel = new MessageChannel();
  const closeCounts = [0, 0];
  const wrapPort = (port: MessagePort, index: number) => ({
    postMessage: (message: unknown, transfer?: readonly Transferable[]) =>
      transfer ? port.postMessage(message, { transfer: [...transfer] }) : port.postMessage(message),
    start: () => port.start(),
    close: () => {
      closeCounts[index] += 1;
      port.close();
    },
    addEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.addEventListener(type, listener),
    removeEventListener: (type: 'message' | 'messageerror', listener: EventListener) =>
      port.removeEventListener(type, listener)
  });
  const left = await createRpc(
    'left',
    ['right'],
    createBrowserMessagePortTransport(wrapPort(channel.port1, 0), { ownership: 'borrowed' })
  );
  const right = await createRpc(
    'right',
    ['left'],
    createBrowserMessagePortTransport(wrapPort(channel.port2, 1)),
    { echo: echoProvider }
  );
  const result = await left.send('right', 'echo', 'borrowed');
  await left.dispose();
  await right.dispose();
  channel.port1.close();
  return {
    result,
    errors,
    portsClosed: closeCounts,
    snapshots: {
      left: readEndpointDebugSnapshot(left),
      right: readEndpointDebugSnapshot(right)
    }
  };
};

declare global {
  var runMessagePortScenario: () => Promise<unknown>;
  var runBorrowedMessagePortScenario: () => Promise<unknown>;
}
