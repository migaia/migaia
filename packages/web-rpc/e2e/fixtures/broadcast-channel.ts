import { createBroadcastChannelTransport } from '../../src/adapters/broadcast-channel';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, installErrorGuards } from './rpc';

const errors = installErrorGuards();
let endpoint: Awaited<ReturnType<typeof createRpc>> | undefined;
let channel: BroadcastChannel | undefined;
let providerCalls = 0;

const allowedIdentity = (allowed: readonly string[]) => (context: { readonly data?: unknown }) => {
  const data = context.data as { __unique_id__?: unknown } | undefined;
  return typeof data?.__unique_id__ === 'string' && allowed.includes(data.__unique_id__);
};

globalThis.startBroadcastServer = async (uniqueId: string, label: string) => {
  channel = new BroadcastChannel('web-rpc-e2e');
  endpoint = await createRpc(
    'service',
    ['client'],
    createBroadcastChannelTransport(channel),
    { who: (context) => context.success({ label, value: context.data }) },
    { uniqueTargetId: uniqueId, identifier: allowedIdentity(['client-id']) }
  );
};

globalThis.startBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-e2e');
  endpoint = await createRpc(
    'client',
    ['service'],
    createBroadcastChannelTransport(channel),
    {},
    {
      uniqueTargetId: 'client-id',
      identifier: allowedIdentity(['server-a', 'server-b'])
    }
  );
};

globalThis.startBroadcastAttacker = () => {
  channel = new BroadcastChannel('web-rpc-e2e');
  channel.addEventListener('message', (event) => {
    if (event.data?.kind !== 'discovery-query' || event.data?.targetId !== 'service') return;
    channel!.postMessage({
      kind: 'discovery-response',
      taskId: event.data.taskId,
      senderId: 'service',
      targetId: event.data.senderId,
      resolvedTargetId: 'service',
      sentAt: Date.now(),
      data: { __unique_id__: 'attacker' },
      receiverId: 'service:attacker'
    });
  });
};

globalThis.startAnonymousBroadcastServer = async () => {
  channel = new BroadcastChannel('web-rpc-anonymous-e2e');
  endpoint = await createRpc('service', ['client'], createBroadcastChannelTransport(channel), {
    who: (context) => context.success({ value: context.data, mode: 'anonymous' })
  });
  endpoint.hooks.on((event) => {
    if (event.name === 'authentication.rejected' || event.name === 'receive.failure')
      errors.push(`server:${event.name}:${event.code ?? ''}`);
  });
};

globalThis.startAnonymousBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-anonymous-e2e');
  endpoint = await createRpc('client', ['service'], createBroadcastChannelTransport(channel));
  endpoint.hooks.on((event) => {
    if (event.name === 'authentication.rejected' || event.name === 'receive.failure')
      errors.push(`client:${event.name}:${event.code ?? ''}`);
  });
};

globalThis.startAuthenticatedBroadcastServer = async () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e');
  providerCalls = 0;
  endpoint = await createRpc(
    'service',
    ['client'],
    createBroadcastChannelTransport(channel),
    {
      who: (context) => {
        providerCalls += 1;
        return context.success({ value: context.data, trusted: true });
      }
    },
    { uniqueTargetId: 'auth-server', identifier: allowedIdentity(['auth-client']) },
    undefined,
    true
  );
};

globalThis.startAuthenticatedBroadcastClient = async () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e');
  endpoint = await createRpc(
    'client',
    ['service'],
    createBroadcastChannelTransport(channel),
    {},
    { uniqueTargetId: 'auth-client', identifier: allowedIdentity(['auth-server']) },
    undefined,
    true
  );
};

globalThis.startAuthenticatedBroadcastAttacker = () => {
  channel = new BroadcastChannel('web-rpc-auth-e2e');
  channel.addEventListener('message', (event) => {
    const frame = event.data as { value?: Record<string, unknown>; signature?: unknown };
    const request = frame?.value;
    if (frame?.signature !== 'trusted' || !request) return;
    if (request.kind === 'request') {
      channel!.postMessage({
        ...request,
        kind: 'response',
        ok: true,
        data: { value: 'forged', trusted: false },
        signature: 'forged'
      });
    }
    if (request.kind === 'variation' && request.variation === 'ping') {
      channel!.postMessage({
        ...request,
        kind: 'variation',
        variation: 'pong',
        signature: 'forged'
      });
    }
  });
};

globalThis.sendBroadcast = (value: unknown) => endpoint!.send('service', 'who', value);
globalThis.pingBroadcast = () => endpoint!.ping('service');
globalThis.broadcastServers = () => endpoint!.connect.getServerList('service');
globalThis.pinBroadcast = (receiverId: string) =>
  endpoint!.connect.pinReceiver('service', receiverId);
globalThis.unpinBroadcast = () => endpoint!.connect.unpinReceiver('service');
globalThis.disposeBroadcast = async () => {
  await endpoint?.dispose();
  channel?.close();
  return errors;
};
globalThis.broadcastSnapshot = () => readEndpointDebugSnapshot(endpoint!);
globalThis.broadcastProviderCalls = () => providerCalls;

declare global {
  var startBroadcastServer: (uniqueId: string, label: string) => Promise<void>;
  var startBroadcastClient: () => Promise<void>;
  var startBroadcastAttacker: () => void;
  var startAnonymousBroadcastServer: () => Promise<void>;
  var startAnonymousBroadcastClient: () => Promise<void>;
  var sendBroadcast: (value: unknown) => Promise<unknown>;
  var pingBroadcast: () => Promise<boolean>;
  var broadcastServers: () => readonly { receiverId: string; uniqueTargetId?: string }[];
  var pinBroadcast: (receiverId: string) => void;
  var unpinBroadcast: () => void;
  var disposeBroadcast: () => Promise<string[]>;
  var broadcastSnapshot: () => unknown;
  var broadcastProviderCalls: () => number;
  var startAuthenticatedBroadcastServer: () => Promise<void>;
  var startAuthenticatedBroadcastClient: () => Promise<void>;
  var startAuthenticatedBroadcastAttacker: () => void;
}
