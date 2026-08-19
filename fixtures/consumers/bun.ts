// @migaia/storage-web 故意不在这里引入：web-only 包，Bun 运行时同样没有
// localStorage/document.cookie/IndexedDB 全局对象。见 SDD §12.6。
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory';

const [client, server] = createMemoryTransportPair();
const unsubscribe = server.subscribe(() => undefined);

client.send({ kind: 'bun-consumer-contract' });
unsubscribe();
client.close();
