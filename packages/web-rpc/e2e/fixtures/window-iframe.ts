import { createWindowMessageTransport } from '../../src/adapters/window';
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer';
import type { IWebRpcEndpointDebugSnapshot } from '../../src/internal/test-observer';
import { createRpc, installErrorGuards } from './rpc';

const errors = installErrorGuards();

globalThis.runWindowIframeScenario = async () => {
  const childOrigin =
    new URLSearchParams(location.search).get('origin') === 'cross'
      ? 'http://127.0.0.1:4179'
      : location.origin;
  const child = document.createElement('iframe');
  child.src = `${childOrigin}/e2e/fixtures/window-child.html`;
  document.body.append(child);
  await new Promise<void>((resolve) => {
    addEventListener('message', function ready(event) {
      if (event.source === child.contentWindow && event.data?.e2e === 'child-ready') {
        removeEventListener('message', ready);
        resolve();
      }
    });
  });
  const target = child.contentWindow!;
  let providerCalls = 0;
  let listenerAdds = 0;
  let listenerRemoves = 0;
  const receiver = {
    addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
      listenerAdds += 1;
      window.addEventListener(type, listener);
    },
    removeEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
      listenerRemoves += 1;
      window.removeEventListener(type, listener);
    }
  };
  const endpoint = await createRpc(
    'parent',
    ['child'],
    createWindowMessageTransport({ target, receiver, targetOrigin: childOrigin }),
    { count: (context) => context.success(++providerCalls) }
  );
  const crossOriginSpoof =
    new URLSearchParams(location.search).get('spoof') === 'cross'
      ? document.createElement('iframe')
      : undefined;
  if (crossOriginSpoof) {
    crossOriginSpoof.src = 'http://127.0.0.1:4179/e2e/fixtures/window-child.html?mode=spoof';
    document.body.append(crossOriginSpoof);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const echo = await endpoint.send('child', 'echo', 'window-ok');

  const sibling = document.createElement('iframe');
  sibling.srcdoc = `<script>parent.postMessage({kind:'request',version:'1',taskId:'spoof',senderId:'child',targetId:'parent',method:'count',data:null,sentAt:Date.now()}, '*')</script>`;
  document.body.append(sibling);
  await new Promise((resolve) => setTimeout(resolve, 30));

  const parentResult = await new Promise<number>((resolve) => {
    addEventListener('message', function result(event) {
      if (event.source === target && event.data?.e2e === 'parent-result') {
        removeEventListener('message', result);
        resolve(event.data.value);
      }
    });
    target.postMessage({ e2e: 'call-parent' }, childOrigin);
  });

  const pending = endpoint.send('child', 'never', null, { timeoutMs: 80 });
  child.remove();
  const removedResult = await pending.then(
    () => 'unexpected',
    (error: { code?: string }) => error.code ?? 'error'
  );
  sibling.remove();
  crossOriginSpoof?.remove();
  await endpoint.dispose();
  return {
    echo,
    parentResult,
    providerCalls,
    removedResult,
    errors,
    listenerAdds,
    listenerRemoves,
    snapshot: readEndpointDebugSnapshot(endpoint) as IWebRpcEndpointDebugSnapshot
  };
};

declare global {
  var runWindowIframeScenario: () => Promise<unknown>;
}
