import type { ICaseDoc } from './contract.js'

/** Native Node channels prove only their public port and delivery contracts. */
export const rpcBrowserCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createBrowserPeer: [
    {
      title: {
        en: 'Call a typed method and release only the logical connection',
        zh: '调用有类型的方法并只释放逻辑连接'
      },
      problem: {
        en: 'A caller needs a method result across an existing port, while the application must keep owning that physical port.\n\nHand-written request identifiers and response listeners add another protocol, and closing a borrowed port during cleanup can disrupt its owner.\n\ncreateBrowserPeer completes the real Core handshake over each native MessagePort; request returns the remote result and close retires only the logical connection.',
        zh: '调用方需要通过已有端口取得方法结果，同时仍要由应用管理这个原生端口。\n\n手写请求编号和响应监听会再造一层协议，清理时若顺手关闭借用端口，还会影响端口拥有者。\n\n`createBrowserPeer` 在原生 MessagePort 上完成真实 Core 握手；`request` 返回远端结果，`close` 只释放逻辑连接。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createBrowserPeer } from '@migaia/rpc-browser'\n\ntype ICounterApi = { double(value: number): number }\nconst { port1, port2 } = new MessageChannel()\nconst [client, service] = await Promise.all([\n  createBrowserPeer<ICounterApi>({ connect: { sharedWorker: { port: port1 } } }),\n  createBrowserPeer({\n    connect: { sharedWorker: { port: port2 } },\n    provide: { double: (value: number) => value * 2 }\n  })\n])\ntry {\n  console.log(await client.request('double', 21))\n  const closing = client.close()\n  console.log(closing === client.close())\n  await closing\n  await service.close()\n  const delivered = Promise.withResolvers<unknown>()\n  port2.once('message', (data: unknown) => delivered.resolve(data))\n  port1.postMessage('still-open')\n  console.log(await delivered.promise)\n} finally {\n  await Promise.all([client.close(), service.close()])\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createBrowserPeer } from '@migaia/rpc-browser'\n\ntype ICounterApi = { double(value: number): number }\nconst { port1, port2 } = new MessageChannel()\nconst [client, service] = await Promise.all([\n  createBrowserPeer<ICounterApi>({ connect: { sharedWorker: { port: port1 } } }),\n  createBrowserPeer({\n    connect: { sharedWorker: { port: port2 } },\n    provide: { double: (value: number) => value * 2 }\n  })\n])\ntry {\n  console.log(await client.request('double', 21))\n  const closing = client.close()\n  console.log(closing === client.close())\n  await closing\n  await service.close()\n  const delivered = Promise.withResolvers<unknown>()\n  port2.once('message', (data: unknown) => delivered.resolve(data))\n  port1.postMessage('端口仍可用')\n  console.log(await delivered.promise)\n} finally {\n  await Promise.all([client.close(), service.close()])\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: "The output is 42, true, then still-open: the remote method runs, repeated close returns one Promise, and raw delivery still works after both Peers close.\n\nNode's MessageChannel supplies the real port operations accepted by connect.sharedWorker.port. This proves that port path, not a browser SharedWorker realm or Window origin checks; the caller closes both ports.",
        zh: '输出为 `42`、`true`、`端口仍可用`：远端方法已执行，重复关闭复用同一 Promise，两个 Peer 关闭后原生端口仍能送达消息。\n\nNode MessageChannel 提供 `connect.sharedWorker.port` 接受的真实端口操作；这里只证明端口路径，不代表浏览器 SharedWorker 宿主或窗口来源检查，最终由调用方关闭两个端口。'
      }
    },
    {
      title: {
        en: 'Consume a remote async generator through the same Peer',
        zh: '通过同一对端消费远端异步生成器'
      },
      problem: {
        en: 'A remote task produces several values, but a single request result cannot represent that sequence.\n\nCollecting everything remotely delays consumption, while treating a generator as a normal method loses its iteration protocol.\n\nDeclare the generator in the remote API and call stream; each next operation uses the same negotiated port connection.',
        zh: '远端任务会陆续产生多个值，单次请求返回值却无法表达这一序列。\n\n在远端先收齐结果会推迟消费，把生成器当普通方法调用又会丢掉迭代协议。\n\n在远端类型中声明异步生成器，并使用 `stream`；每次取下一项都复用已经协商的端口连接。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createBrowserPeer } from '@migaia/rpc-browser'\n\ntype ISequenceApi = { values(start: number): AsyncIterableIterator<number> }\nconst { port1, port2 } = new MessageChannel()\nconst [client, service] = await Promise.all([\n  createBrowserPeer<ISequenceApi>({ connect: { sharedWorker: { port: port1 } } }),\n  createBrowserPeer({\n    connect: { sharedWorker: { port: port2 } },\n    provide: {\n      async *values(start: number) {\n        yield start\n        yield start + 1\n      }\n    }\n  })\n])\ntry {\n  const values: number[] = []\n  for await (const value of client.stream('values', 3)) values.push(value)\n  console.log(values.join(','))\n} finally {\n  await Promise.all([client.close(), service.close()])\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createBrowserPeer } from '@migaia/rpc-browser'\n\ntype ISequenceApi = { values(start: number): AsyncIterableIterator<number> }\nconst { port1, port2 } = new MessageChannel()\nconst [client, service] = await Promise.all([\n  createBrowserPeer<ISequenceApi>({ connect: { sharedWorker: { port: port1 } } }),\n  createBrowserPeer({\n    connect: { sharedWorker: { port: port2 } },\n    provide: {\n      async *values(start: number) {\n        yield start\n        yield start + 1\n      }\n    }\n  })\n])\ntry {\n  const values: number[] = []\n  for await (const value of client.stream('values', 3)) values.push(value)\n  console.log(values.join(','))\n} finally {\n  await Promise.all([client.close(), service.close()])\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: 'The output is 3,4 after consuming the real remote generator to completion over the native port pair.\n\nstream is lazy and starts on first iteration; request is for scalar results. This example does not prove browser signaling, reconnection, or cross-window authorization, and both ports remain caller-owned.',
        zh: '完整消费通过原生端口传来的远端生成器后，输出 `3,4`。\n\n`stream` 惰性启动，首次迭代才发送；单个结果使用 `request`。本例不证明浏览器信令、重连或跨窗口授权，两个端口仍由调用方拥有。'
      }
    }
  ],
  createSharedWorkerTransport: [
    {
      title: {
        en: 'Transfer a byte buffer through a native message port',
        zh: '通过原生消息端口转移字节缓冲区'
      },
      problem: {
        en: "An application deliberately transfers a buffer and must know which side owns its bytes after sending.\n\nOrdinary structured cloning keeps a copy, whereas a transfer list detaches the sender's buffer; hiding that choice makes later buffer access misleading.\n\nPass the actual buffer in send(message, { transfer }); the adapter forwards the list to the native port without inventing ownership rules.",
        zh: '应用要显式转移一个缓冲区，需要清楚发送后哪一端还能使用其中的字节。\n\n普通结构化克隆会保留副本，转移列表却会让发送端缓冲区分离；如果隐藏这个选择，后续读写就容易误用已经失效的缓冲区。\n\n通过 `send(message, { transfer })` 传入实际缓冲区，适配器把列表交给原生端口，所有权变化遵循宿主的转移规则。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: "The output is 0 then 7,8: the sender's byte view is detached and the receiver gets the original byte values.\n\nThe transfer option defaults to undefined, which uses native cloning instead. This is raw transport I/O, not an RPC payload contract; the caller unsubscribes and closes both native ports.",
        zh: '输出先是 `0`，然后是 `7,8`：发送端字节视图已分离，接收端取得原字节值。\n\n`transfer` 默认 `undefined`，此时使用原生克隆。本例是原始载体收发，不是 RPC 载荷契约；调用方最终退订并关闭两个原生端口。'
      }
    },
    {
      title: {
        en: 'Report one failing message listener without skipping the next',
        zh: '报告一个消息监听器的失败并继续交付其他监听器'
      },
      problem: {
        en: 'One observer throws while another observer still needs the incoming message.\n\nCalling listeners in one unguarded loop makes the first exception interrupt delivery and can hide which observer failed.\n\nRegister onListenerError alongside subscribe; the transport reports that exception through its listener-error channel and continues dispatching the same native message.',
        zh: '一个观察者处理消息时抛错，另一个观察者却仍需要收到这条消息。\n\n用没有隔离的循环逐个调用监听器，首个异常就会中断交付，也可能让调用方不知道究竟哪个观察者失败。\n\n在 `subscribe` 之外登记 `onListenerError`；载体通过监听器错误通道报告原异常，并继续分发同一条原生消息。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst failureText = 'message observer failed'\nconst failure = new Error(failureText)\nconst reports: unknown[] = []\nconst stopErrors = receiver.onListenerError?.((error) => {\n  reports.push(error)\n})\nconst stopFirst = receiver.subscribe(() => {\n  throw failure\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  sender.send('delivered')\n  console.log(await received.promise)\n  console.log(reports.length, reports[0] === failure)\n} finally {\n  stopFirst()\n  stopSecond()\n  stopErrors?.()\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst failureText = '消息观察者失败'\nconst failure = new Error(failureText)\nconst reports: unknown[] = []\nconst stopErrors = receiver.onListenerError?.((error) => {\n  reports.push(error)\n})\nconst stopFirst = receiver.subscribe(() => {\n  throw failure\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  sender.send('已交付')\n  console.log(await received.promise)\n  console.log(reports.length, reports[0] === failure)\n} finally {\n  stopFirst()\n  stopSecond()\n  stopErrors?.()\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: "The output is delivered then 1 true: the second subscriber receives the message and the error observer sees the exact original exception once.\n\nThis isolates business-listener failure, not a failed physical port. Without an error observer, listener failures remain in the transport's failure channel; cleanup may surface retained failures.",
        zh: '输出为 `已交付`、`1 true`：第二个订阅者收到消息，错误观察者恰好收到一次原异常。\n\n这里隔离的是业务监听器失败，不代表原生端口故障可以继续工作；未登记错误观察者时，失败仍留在载体错误通道，清理操作可能再次呈现尚未处理的失败。'
      }
    }
  ],
  createBroadcastChannelTransport: [
    {
      title: {
        en: 'Deliver one broadcast to two channel participants',
        zh: '把一条广播交付给两个频道参与者'
      },
      problem: {
        en: 'Several participants need the same update instead of selecting one exclusive remote endpoint.\n\nTreating a shared channel as a private peer hides its fan-out: every other eligible participant can receive the payload.\n\nCreate a transport for each native BroadcastChannel with the same name; one send reaches both subscribed receivers in this Node example.',
        zh: '多个参与者都需要同一条更新，而不是只选一个独占的远端接收方。\n\n把共享频道当成私有对端，会忽略它的广播性质：其他符合宿主条件的参与者也能收到载荷。\n\n为同名的原生 BroadcastChannel 分别创建载体；本例在 Node 中一次发送，两个已订阅接收者都会得到消息。'
      },
      example: {
        en: "import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}",
        zh: "import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}"
      },
      result: {
        en: "The output is 7,7: both native channel participants receive the same update through their own transport subscriptions.\n\nThis proves Node's native channel delivery, not browser origin or storage-partition admission. BroadcastChannel is not a createBrowserPeer source; Endpoint IDs select logical recipients without making broadcast private.",
        zh: '输出 `7,7`：两个原生频道参与者通过各自载体的订阅收到同一条更新。\n\n这里只证明 Node 原生频道交付，不证明浏览器来源或存储分区准入。BroadcastChannel 不属于 `createBrowserPeer` 来源；端点标识可以选逻辑接收方，但不会把广播变成私有通信。'
      }
    },
    {
      title: {
        en: 'Retire one subscription while leaving the native channel usable',
        zh: '独立退订一个监听器并保留原生频道'
      },
      problem: {
        en: 'One view leaves a shared channel while another view must keep receiving updates.\n\nA global cleanup that removes all listeners or closes the channel cuts off consumers that did not release their own subscriptions.\n\nKeep the disposer returned by each subscribe call; releasing one subscriber leaves the other active, and releasing both still leaves the caller-owned channel open.',
        zh: '一个视图退出共享频道，另一个视图却仍要继续接收更新。\n\n如果清理时一次移除全部监听器或直接关闭频道，就会截断尚未退订的其他使用者。\n\n保存每次 `subscribe` 返回的退订函数；释放其中一个订阅不影响另一个，全部退订后也不会关闭调用方拥有的频道。'
      },
      example: {
        en: "import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst outbound = new BroadcastChannel(name)\nconst inbound = new BroadcastChannel(name)\nconst sender = createBroadcastChannelTransport(outbound)\nconst receiver = createBroadcastChannelTransport(inbound)\nlet retiredCalls = 0\nconst stopFirst = receiver.subscribe(() => {\n  retiredCalls += 1\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  stopFirst()\n  stopFirst()\n  sender.send('first')\n  console.log(retiredCalls, await received.promise)\n  stopSecond()\n  const native = Promise.withResolvers<unknown>()\n  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })\n  sender.send('native')\n  console.log(await native.promise)\n} finally {\n  stopFirst()\n  stopSecond()\n  outbound.close()\n  inbound.close()\n}",
        zh: "import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst outbound = new BroadcastChannel(name)\nconst inbound = new BroadcastChannel(name)\nconst sender = createBroadcastChannelTransport(outbound)\nconst receiver = createBroadcastChannelTransport(inbound)\nlet retiredCalls = 0\nconst stopFirst = receiver.subscribe(() => {\n  retiredCalls += 1\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  stopFirst()\n  stopFirst()\n  sender.send('第一条')\n  console.log(retiredCalls, await received.promise)\n  stopSecond()\n  const native = Promise.withResolvers<unknown>()\n  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })\n  sender.send('原生消息')\n  console.log(await native.promise)\n} finally {\n  stopFirst()\n  stopSecond()\n  outbound.close()\n  inbound.close()\n}"
      },
      result: {
        en: "The output is 0 first then native: the retired subscriber is not called, the remaining subscriber receives the first message, and raw channel delivery still works after final unsubscribe.\n\nDisposers are idempotent after successful removal. They release only this transport's registrations; the application must still close its BroadcastChannel instances.",
        zh: '输出 `0 第一条`、`原生消息`：已退订者没有运行，剩余订阅者收到第一条消息，最后退订后原生频道仍可交付消息。\n\n监听移除成功后，重复退订不会再次移除；退订函数只释放此载体的登记，BroadcastChannel 实例仍须由应用关闭。'
      }
    }
  ]
}
