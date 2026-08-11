import { createWindowMessageTransport } from '../../src/adapters/window';
import { createRpc, echoProvider } from './rpc';

const parentOrigin = new URL(document.referrer).origin;
const transport = createWindowMessageTransport({
  target: parent,
  receiver: window,
  targetOrigin: parentOrigin
});
const endpoint = await createRpc('child', ['parent'], transport, {
  echo: echoProvider,
  never: async () => new Promise(() => undefined)
});

addEventListener('message', (event) => {
  if (event.data?.e2e === 'call-parent') {
    void endpoint
      .send('parent', 'count', null)
      .then((value) => parent.postMessage({ e2e: 'parent-result', value }, parentOrigin));
  }
});
parent.postMessage({ e2e: 'child-ready' }, parentOrigin);

if (new URLSearchParams(location.search).get('mode') === 'spoof') {
  parent.postMessage(
    {
      kind: 'request',
      version: '1',
      taskId: 'cross-origin-spoof',
      senderId: 'child',
      targetId: 'parent',
      method: 'count',
      data: null,
      sentAt: Date.now()
    },
    parentOrigin
  );
}
