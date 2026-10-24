/** Bilingual public boundary and original ownership contracts. */
import { rpcPluginOptionDocs } from './rpc-runtime-shared.js'
import { rpcApiGuides } from '../rpc-api-guides.js'
import type { ILibraryReference } from './contract.js'

/** Authored public reference; author primitives retain their actual parameter and resource owners. */
export const rpcBrowserReference: ILibraryReference = {
  modules: {
    index: {
      summary: {
        en: 'Choose one of seven actual browser carriers and install it in createRpcHost. Both sides use the compatible RPC protocol. Native objects are borrowed; host closure releases only its sessions/subscriptions, with reliable WebTransport stream ownership handled separately.',
        zh: '选择七种实际浏览器载体之一安装到宿主，双方使用兼容调用协议。原生对象为借入，宿主关闭仅释放其会话和订阅，可靠网络传输流单独按归属清理。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/window': {
      summary: {
        en: 'Original origin/source-checked Window carrier for authors. Applications normally start from the corresponding plugin.',
        zh: '供作者使用的原来源域及消息来源校验页面载体。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/shared-worker': {
      summary: {
        en: 'Original borrowed SharedWorker port carrier for authors. Applications normally start from the corresponding plugin.',
        zh: '供作者使用的原借用共享工作程序端口载体。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/service-worker': {
      summary: {
        en: 'Original target/receiver-separated ServiceWorker carrier. Applications normally start from the corresponding plugin.',
        zh: '原发送目标和接收面分离的服务工作程序载体。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/broadcast-channel': {
      summary: {
        en: 'Original shared native broadcast subscription; discovery and per-party acceptance belong to the plugin. Applications normally start from the corresponding plugin.',
        zh: '原共享原生广播订阅，发现和逐参与者接纳归插件。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/rtc-data-channel': {
      summary: {
        en: 'Original JSON carrier on a reliable ordered data channel. Applications normally start from the corresponding plugin.',
        zh: '可靠有序数据频道上的原消息载体。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/web-transport': {
      summary: {
        en: 'Reliable ordered WebTransport stream transport; its enclosing session remains borrowed. Applications normally start from the corresponding plugin.',
        zh: '可靠有序网络传输流载体，外层会话仍为借入。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/message-port': {
      summary: {
        en: 'Safe shell exporting the canonical host-owned message-port subscription owner without copying its algorithm. Applications normally start from the corresponding plugin.',
        zh: '安全外壳导出宿主原消息端口订阅所有者，不复制算法。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    'adapters/web-worker': {
      summary: {
        en: 'Safe shell exporting the canonical host-owned structural EventTarget Worker carrier. Applications normally start from the corresponding plugin.',
        zh: '安全外壳导出宿主原结构事件目标工作程序载体。应用通常从对应传输插件开始。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    }
  },
  symbols: {
    RPC_BROWSER_ERROR_SOURCE: {
      role: 'constant',
      purpose: {
        en: 'The `source` value (`@migaia/rpc/browser`) of Peer configuration and decoding errors of this package; compare it before branching on `code`.',
        zh: '本包 Peer 配置错误与解码错误上的 `source` 值（`@migaia/rpc/browser`）；先比对它确认来源，再按 `code` 分支处理。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    RpcBrowserErrorCode: {
      role: 'constant',
      purpose: {
        en: 'Table of the stable error codes of this package; values are the strings on `error.code`.',
        zh: '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createWindowMessageTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a Window postMessage carrier with exact target/origin sourceProof. Raw subscribe preserves all event records; pair it with `connect` for Endpoint admission or use the Browser Peer projection.',
        zh: '创建带精确目标及来源域证明的窗口载体；原始订阅保留全部事件记录，端点须搭配 `connect` 执行准入，或使用浏览器对端投影。'
      },
      returns: {
        en: 'An `IRpcTransport` for `createRpcHost()`; `*` as origin without `allowUnsafeTargetOrigin` throws `INVALID_CONFIG`.',
        zh: '供 `createRpcHost()` 使用的 `IRpcTransport`；源为 `*` 且未开启 `allowUnsafeTargetOrigin` 时抛 `INVALID_CONFIG`。'
      },
      options: 'IWindowMessageTransportOptions',
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createSharedWorkerTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a transport over one SharedWorker `MessagePort` and starts the port when listening begins.',
        zh: '创建基于单个 SharedWorker `MessagePort` 的 transport，并在开始监听消息时启动该端口。'
      },
      params: {
        port: {
          en: 'Page side: `sharedWorker.port`; worker side: a port from the `connect` event.',
          zh: '页面端为 `sharedWorker.port`；Worker 端为 `connect` 事件中的端口。'
        }
      },
      returns: {
        en: 'An `IRpcTransport`; the port is borrowed and must be closed by its owner.',
        zh: '一个 `IRpcTransport`；端口是借用的，需由其持有者关闭。'
      },
      exampleIntro: {
        en: 'Install @migaia/rpc-plugin-browser and its @migaia/rpc-host peer directly. Node 24 supplies the real MessageChannel; its constructor takes no arguments and returns paired port1/port2. These complete native ports satisfy the public port contract. The examples prove port delivery only, not SharedWorker lifecycle, Window origins, RTC signaling, or browser authentication. createSharedWorkerTransport(port) has no options argument. subscribe(listener) supplies {data, origin?, source?} and returns an idempotent disposer; it uses no business result but observes synchronous and thenable failures. send(message, {transfer}) defaults transfer to undefined; an explicit array transfers those native objects. onListenerError(error => void) reports listener failures, distinct from physical onTransportError. Promise.withResolvers creates a local delivery Promise and does not implement RPC.',
        zh: '直接安装 `@migaia/rpc-plugin-browser` 及其 peer 依赖 `@migaia/rpc-host`。Node 24 提供真实 MessageChannel，无参数构造后取得配对的 `port1`、`port2`，它们完整实现公开端口契约。示例只证明端口交付，不证明 SharedWorker 生命周期、窗口来源、RTC 信令或浏览器认证。`createSharedWorkerTransport(port)` 没有选项参数。`subscribe(listener)` 提供 `{ data, origin?, source? }` 并返回幂等退订函数；不使用业务返回值，但会观察同步抛错及类 Promise 对象的拒绝。`send(message, { transfer })` 的 `transfer` 默认 `undefined`，显式数组会转移其中原生对象。`onListenerError(error => void)` 接收监听器失败，与物理故障的 `onTransportError` 不同；`Promise.withResolvers` 只创建本地交付 Promise，不实现 RPC。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}"
      },
      cases: [
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
            en: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}",
            zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst received = Promise.withResolvers<unknown>()\nconst stop = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  const bytes = new Uint8Array([7, 8])\n  sender.send(bytes.buffer, { transfer: [bytes.buffer] })\n  console.log(bytes.byteLength)\n  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))\n} finally {\n  stop()\n  port1.close()\n  port2.close()\n}"
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
            en: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst failureText = 'message observer failed'\nconst failure = new Error(failureText)\nconst reports: unknown[] = []\nconst stopErrors = receiver.onListenerError?.((error) => {\n  reports.push(error)\n})\nconst stopFirst = receiver.subscribe(() => {\n  throw failure\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  sender.send('delivered')\n  console.log(await received.promise)\n  console.log(reports.length, reports[0] === failure)\n} finally {\n  stopFirst()\n  stopSecond()\n  stopErrors?.()\n  port1.close()\n  port2.close()\n}",
            zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createSharedWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/shared-worker'\n\nconst { port1, port2 } = new MessageChannel()\nconst sender = createSharedWorkerTransport(port1)\nconst receiver = createSharedWorkerTransport(port2)\nconst failureText = '消息观察者失败'\nconst failure = new Error(failureText)\nconst reports: unknown[] = []\nconst stopErrors = receiver.onListenerError?.((error) => {\n  reports.push(error)\n})\nconst stopFirst = receiver.subscribe(() => {\n  throw failure\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  sender.send('已交付')\n  console.log(await received.promise)\n  console.log(reports.length, reports[0] === failure)\n} finally {\n  stopFirst()\n  stopSecond()\n  stopErrors?.()\n  port1.close()\n  port2.close()\n}"
          },
          result: {
            en: "The output is delivered then 1 true: the second subscriber receives the message and the error observer sees the exact original exception once.\n\nThis isolates business-listener failure, not a failed physical port. Without an error observer, listener failures remain in the transport's failure channel; cleanup may surface retained failures.",
            zh: '输出为 `已交付`、`1 true`：第二个订阅者收到消息，错误观察者恰好收到一次原异常。\n\n这里隔离的是业务监听器失败，不代表原生端口故障可以继续工作；未登记错误观察者时，失败仍留在载体错误通道，清理操作可能再次呈现尚未处理的失败。'
          }
        }
      ]
    },
    createServiceWorkerTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a page/ServiceWorker carrier whose sourceProof accepts its exact target or actual matching Client id. Raw subscribe retains records; pair `connect` with this transport for Endpoint admission.',
        zh: '创建页面服务工作者载体，其来源证明认可精确目标或实际匹配客户端标识；原始订阅保留记录，端点须搭配 `connect` 执行准入。'
      },
      returns: {
        en: 'An `IRpcTransport` for `createRpcHost()`.',
        zh: '供 `createRpcHost()` 使用的 `IRpcTransport`。'
      },
      options: 'IServiceWorkerTransportOptions',
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createBroadcastChannelTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a transport over a `BroadcastChannel`; every same-origin context on the channel receives the messages.',
        zh: '创建基于 `BroadcastChannel` 的 transport；频道上所有同源上下文都会收到消息。'
      },
      params: {
        channel: {
          en: 'An open `BroadcastChannel` owned by the caller.',
          zh: '由调用方持有、已打开的 `BroadcastChannel`。'
        }
      },
      returns: {
        en: 'An `IRpcTransport`; the caller still closes the channel.',
        zh: '一个 `IRpcTransport`；频道仍需调用方自行关闭。'
      },
      exampleIntro: {
        en: 'Install @migaia/rpc-plugin-browser and @migaia/rpc-host directly. Node 24 supplies native BroadcastChannel(name); name is required, and the examples reuse one randomUUID string across distinct channels to isolate the run. createBroadcastChannelTransport(channel) has no options argument. subscribe receives {data, origin?, source?} and returns a disposer. send(message) uses native structured cloning with no transfer-list support. Channel close() is a separate no-argument operation owned by the caller; once:true removes the final raw native listener after one delivery.',
        zh: '直接安装 `@migaia/rpc-plugin-browser` 与 `@migaia/rpc-host`。Node 24 的原生 `BroadcastChannel(name)` 名称必填，示例让不同频道实例复用同一个随机 UUID，隔离本次运行。`createBroadcastChannelTransport(channel)` 没有选项参数；`subscribe` 接收 `{ data, origin?, source? }` 并返回退订函数，`send(message)` 使用原生结构化克隆，不支持转移列表。频道的无参数 `close()` 由调用方负责；`once: true` 让最后的原生监听在收到一条消息后自动移除。'
      },
      example: {
        en: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}",
        zh: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}"
      },
      cases: [
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
            en: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}",
            zh: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))\nconst [sender, first, second] = channels.map(createBroadcastChannelTransport)\nconst one = Promise.withResolvers<unknown>()\nconst two = Promise.withResolvers<unknown>()\nconst stopOne = first.subscribe(({ data }) => one.resolve(data))\nconst stopTwo = second.subscribe(({ data }) => two.resolve(data))\ntry {\n  sender.send(7)\n  console.log((await Promise.all([one.promise, two.promise])).join(','))\n} finally {\n  stopOne()\n  stopTwo()\n  for (const channel of channels) channel.close()\n}"
          },
          result: {
            en: "The output is 7,7: both native channel participants receive the same update through their own transport subscriptions.\n\nThis proves Node's native channel delivery, not browser origin or storage-partition admission. BroadcastChannel is not a createRpcHost source; Endpoint IDs select logical recipients without making broadcast private.",
            zh: '输出 `7,7`：两个原生频道参与者通过各自载体的订阅收到同一条更新。\n\n这里只证明 Node 原生频道交付，不证明浏览器来源或存储分区准入。BroadcastChannel 不属于 `createRpcHost` 来源；端点标识可以选逻辑接收方，但不会把广播变成私有通信。'
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
            en: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst outbound = new BroadcastChannel(name)\nconst inbound = new BroadcastChannel(name)\nconst sender = createBroadcastChannelTransport(outbound)\nconst receiver = createBroadcastChannelTransport(inbound)\nlet retiredCalls = 0\nconst stopFirst = receiver.subscribe(() => {\n  retiredCalls += 1\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  stopFirst()\n  stopFirst()\n  sender.send('first')\n  console.log(retiredCalls, await received.promise)\n  stopSecond()\n  const native = Promise.withResolvers<unknown>()\n  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })\n  sender.send('native')\n  console.log(await native.promise)\n} finally {\n  stopFirst()\n  stopSecond()\n  outbound.close()\n  inbound.close()\n}",
            zh: "import { createBroadcastChannelTransport } from '@migaia/rpc-plugin-browser/adapters/broadcast-channel'\n\nconst name = crypto.randomUUID()\nconst outbound = new BroadcastChannel(name)\nconst inbound = new BroadcastChannel(name)\nconst sender = createBroadcastChannelTransport(outbound)\nconst receiver = createBroadcastChannelTransport(inbound)\nlet retiredCalls = 0\nconst stopFirst = receiver.subscribe(() => {\n  retiredCalls += 1\n})\nconst received = Promise.withResolvers<unknown>()\nconst stopSecond = receiver.subscribe(({ data }) => received.resolve(data))\ntry {\n  stopFirst()\n  stopFirst()\n  sender.send('第一条')\n  console.log(retiredCalls, await received.promise)\n  stopSecond()\n  const native = Promise.withResolvers<unknown>()\n  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })\n  sender.send('原生消息')\n  console.log(await native.promise)\n} finally {\n  stopFirst()\n  stopSecond()\n  outbound.close()\n  inbound.close()\n}"
          },
          result: {
            en: "The output is 0 first then native: the retired subscriber is not called, the remaining subscriber receives the first message, and raw channel delivery still works after final unsubscribe.\n\nDisposers are idempotent after successful removal. They release only this transport's registrations; the application must still close its BroadcastChannel instances.",
            zh: '输出 `0 第一条`、`原生消息`：已退订者没有运行，剩余订阅者收到第一条消息，最后退订后原生频道仍可交付消息。\n\n监听移除成功后，重复退订不会再次移除；退订函数只释放此载体的登记，BroadcastChannel 实例仍须由应用关闭。'
          }
        }
      ]
    },
    createRtcDataChannelTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a raw RTC carrier in open or already-terminal closed state; non-string sends are JSON-stringified, while received data is not parsed. MESSAGE_DECODE_FAILED belongs to the Browser Peer projection, not this raw transport.',
        zh: '在已打开或已经终止关闭状态创建原始数据频道载体；非字符串发送值被转换为字符串，接收数据不解析；消息解码失败属于浏览器对端投影，不属于此原始载体。'
      },
      params: {
        channel: {
          en: 'An `RTCDataChannel` created by the caller, usually from `peerConnection.createDataChannel()`.',
          zh: '由调用方创建的 `RTCDataChannel`，通常来自 `peerConnection.createDataChannel()`。'
        }
      },
      returns: {
        en: 'An `IRpcTransport`; other channel states throw `INVALID_CONFIG`.',
        zh: '一个 `IRpcTransport`；频道处于其它状态时抛 `INVALID_CONFIG`。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
      }
    },
    createWebTransportDatagramTransport: {
      role: 'enhancer',
      purpose: {
        en: 'Creates a byte transport over WebTransport datagrams; it takes the datagram writer and reader and closes the writer when the transport closes.',
        zh: '创建基于 WebTransport 数据报的字节 transport；它取得数据报的写入端与读取端，并在 transport 关闭时关闭写入端。'
      },
      params: {
        datagrams: {
          en: '`session.datagrams` of a `WebTransport` session created by the caller.',
          zh: '调用方创建的 `WebTransport` 会话的 `session.datagrams`。'
        }
      },
      returns: {
        en: 'An `IRpcTransport<Uint8Array>`; the session itself is closed by the caller.',
        zh: '一个 `IRpcTransport<Uint8Array>`；会话本身仍由调用方关闭。'
      },
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 服务端须在配置的安全网址接纳网页传输，每个数据报承载一个完整通用文本编码对象；原样返回请求标识及回显载荷，两类消息均须适合路径最大传输单元；可能丢失乱序，此客户端不重试业务操作。\n// 数据报不提供运行对端来源或现成核心端点组合；仅字节编解码不足，默认分帧报告未知输出，原生二进制分帧可能输出此载体拒绝的分片对象；这里的对象是应用协议，不是核心信封或运行握手帧。\n// 网页客户端 web-client.ts：应用拥有原生网页传输会话并签发请求标识。\nimport { createWebTransportDatagramTransport } from '@migaia/rpc-plugin-browser/adapters/web-transport'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst session = new WebTransport('https://rpc.example:4433/echo')\nawait session.ready\nconst transport = createWebTransportDatagramTransport(session.datagrams)\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder('utf-8', { fatal: true })\nlet resolveReply!: (response: IResponse) => void\nlet rejectReply!: (error: unknown) => void\nconst reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\nconst remove = transport.subscribe(({ data }) => {\n  try {\n    const response = JSON.parse(decoder.decode(data)) as IResponse\n    if (response.id === 'echo-1') resolveReply(response)\n  } catch (error) { rejectReply(error) }\n})\nconst removeError = transport.onTransportError?.(rejectReply)\nconst timer = setTimeout(() => rejectReply(new Error('Datagram deadline elapsed')), 3000)\ntry {\n  const request: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\n  await transport.send(encoder.encode(JSON.stringify(request)))\n  console.log((await reply).payload)\n} finally {\n  clearTimeout(timer); remove(); removeError?.()\n  try { await transport.close?.() } finally { session.close() }\n}\n\n// 外部服务端协议：本库不提供服务端库，须在实际服务端实现下列精确数据报约束。\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst received: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\nconst reply: IResponse = { id: received.id, payload: { text: received.payload.text } }"
      }
    },
    windowPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:windowPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:windowPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Create a Window transport that accepts messages only when both the configured origin and native event.source match the intended peer.',
        zh: '创建与实际窗口通信的传输，同时核对配置的来源域和原生事件来源，仅接收目标窗口发来的匹配消息。'
      },
      options: 'IWindowPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    dedicatedWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:dedicatedWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:dedicatedWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      options: 'IWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    sharedWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:sharedWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:sharedWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      options: 'ISharedWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    broadcastChannelPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:broadcastChannelPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:broadcastChannelPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      options: 'IBroadcastChannelPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    serviceWorkerPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:serviceWorkerPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:serviceWorkerPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      options: 'IServiceWorkerPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    rtcDataChannelPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:rtcDataChannelPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:rtcDataChannelPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      options: 'IRtcDataChannelPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    webTransportPlugin: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:index:webTransportPlugin'].en.quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:index:webTransportPlugin'].zh.quickStart!
      },
      role: 'enhancer',
      purpose: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      options: 'IWebTransportPluginOptions',
      returns: {
        en: 'Cold genuine transport definition. Install on one host; borrowed native objects remain application-owned.',
        zh: '返回冷真实传输定义，安装到一个宿主，借入原生对象仍归应用。'
      }
    },
    createBrowserMessagePortTransport: {
      example: {
        en: rpcApiGuides[
          'rpc-plugin-browser:adapters-message-port:createBrowserMessagePortTransport'
        ].en.quickStart!,
        zh: rpcApiGuides[
          'rpc-plugin-browser:adapters-message-port:createBrowserMessagePortTransport'
        ].zh.quickStart!
      },
      options: 'IBrowserMessagePortTransportOptions',
      role: 'factory',
      purpose: {
        en: 'Wrap a browser MessagePort with subscriptions attached on demand, preserving native transfer lists; closing an owned wrapper closes the port, while a borrowed wrapper only removes its listeners.',
        zh: '将实际浏览器消息端口包装为按需订阅的传输，保留原生转移列表；关闭时仅拥有模式关闭端口，借用模式只撤回监听。'
      },
      params: {
        port: {
          en: 'Actual structural port with postMessage/start/close and listener add/remove.',
          zh: '带消息发送启动关闭及监听增删的实际结构端口。'
        },
        options: {
          en: 'Optional ownership selection; defaults to owned, while borrowed detaches only this wrapper.',
          zh: '可选归属选择，默认拥有；借用仅撤回此包装。'
        }
      },
      returns: {
        en: 'IRpcTransport retaining transfer lists and original native error causes. Owned close closes the port; borrowed close only removes adapter listeners.',
        zh: '返回保留转移列表及原生错误原因的传输，拥有时关闭物理端口，借用时仅移除适配器监听。'
      }
    },
    createWebWorkerTransport: {
      example: {
        en: rpcApiGuides['rpc-plugin-browser:adapters-web-worker:createWebWorkerTransport'].en
          .quickStart!,
        zh: rpcApiGuides['rpc-plugin-browser:adapters-web-worker:createWebWorkerTransport'].zh
          .quickStart!
      },
      options: 'IWebWorkerTransportOptions',
      role: 'factory',
      purpose: {
        en: 'Wrap a real Worker/port EventTarget with the canonical subscription and failure observer, without duplicating native transport state.',
        zh: '以规范订阅和失败观察包装真实工作程序端口，不复制原生传输状态。'
      },
      params: {
        port: {
          en: 'Actual postMessage/addEventListener/removeEventListener native surface.',
          zh: '实际原生消息发送及监听增删接口。'
        },
        options: {
          en: 'Optional static capabilities, peerId and expected origin from the deployment owner.',
          zh: '部署所有者提供的可选静态能力、对端标识及预期来源域。'
        }
      },
      returns: {
        en: 'Borrowed IRpcTransport; error/messageerror fail pending work through the original transport path. close removes hooks and never terminates the Worker.',
        zh: '返回借入传输，原生错误沿原传输路径结束等待工作；关闭移除监听，不终止工作程序。'
      }
    }
  },
  types: {
    IRpcBrowserErrorCode: {
      summary: {
        en: 'Union of `RpcBrowserErrorCode` values.',
        zh: '`RpcBrowserErrorCode` 全部取值组成的联合类型。'
      },
      members: {}
    },
    IWindowMessageTransportOptions: {
      optionCases: [
        {
          title: {
            en: 'Address a known popup origin',
            zh: '向已知来源域的弹窗发送消息'
          },
          problem: {
            en: 'The application already owns a popup and its inbound `window` receiver. Supplying the target and origin makes outgoing delivery explicit; outside a Window-like global, the receiver cannot be inferred. Raw subscriptions preserve source metadata, while endpoint admission uses `sourceProof`.',
            zh: '应用已持有弹窗及接收消息的 `window`。显式指定目标与来源域，就能确定消息发往何处；不在类 Window 全局环境中时，接收者也必须提供。原始订阅保留来源元数据，端点接纳则使用 `sourceProof`。'
          },
          example:
            "import { createWindowMessageTransport } from '@migaia/rpc-plugin-browser/adapters/window'\n\nconst transport = createWindowMessageTransport({\n  target: popupWindow,\n  receiver: window,\n  targetOrigin: 'https://reports.example'\n})\nconst stop = transport.subscribe((message) => {\n  if (transport.sourceProof?.(message.source, message.origin)) renderReport(message.data)\n})\nrefreshButton.onclick = () => transport.send({ operation: 'refresh' })\nonReportClosed(stop)",
          result: {
            en: 'Clicking refresh sends the report request only to the configured origin; incoming report data updates the report view.',
            zh: '点击刷新时，报告请求只发往指定来源域；收到的报告数据用于更新视图。'
          },
          covers: ['target', 'receiver', 'targetOrigin']
        },
        {
          title: {
            en: 'Explicitly allow an unknown destination origin',
            zh: '显式允许尚未确定的目标来源域'
          },
          problem: {
            en: 'A caller-owned window can change origin while retaining its native identity. A wildcard is rejected by default. `allowUnsafeTargetOrigin: true` permits that wildcard and relaxes only the origin check; another window still fails the source check.',
            zh: '调用方拥有的窗口可能改变来源域，但保持原生窗口身份。默认会拒绝通配来源域。`allowUnsafeTargetOrigin: true` 允许通配符，只放宽来源域检查；其他窗口仍无法通过来源身份检查。'
          },
          example:
            "import { createWindowMessageTransport } from '@migaia/rpc-plugin-browser/adapters/window'\n\nconst transport = createWindowMessageTransport({\n  target: popupWindow,\n  receiver: window,\n  targetOrigin: '*',\n  allowUnsafeTargetOrigin: true\n})\nrefreshButton.onclick = () => transport.send({ operation: 'refresh' })\n",
          result: {
            en: 'The refresh request follows the retained popup across origin changes. Source proof still identifies that popup; raw subscriptions require their own admission check.',
            zh: '刷新请求可跟随保留的弹窗跨越来源域变化。来源证明仍识别该弹窗；原始订阅仍须自行检查准入。'
          },
          covers: ['target', 'receiver', 'targetOrigin', 'allowUnsafeTargetOrigin']
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'Options of `createWindowMessageTransport()`.',
        zh: '`createWindowMessageTransport()` 的选项：目标窗口、接收者与源。'
      },
      members: {
        target: {
          summary: {
            en: 'Outbound window and the expected source used by `sourceProof`; raw subscriptions still receive every record.',
            zh: '消息发往的窗口，也是来源证明所期望的来源；原始订阅仍接收全部消息记录。'
          }
        },
        receiver: {
          summary: {
            en: 'Object that receives `message` events.',
            zh: '负责接收对端 `message` 事件的对象。'
          },
          default: {
            en: 'The global scope when it has `addEventListener`.',
            zh: '全局作用域（具有 `addEventListener` 时）。'
          }
        },
        targetOrigin: {
          summary: {
            en: 'Outbound origin and receive proof checked by Endpoint `connect` or the Peer projection.',
            zh: '发送时使用的源；接收准入由端点 `connect` 或运行对端投影按它检查。'
          },
          default: {
            en: '`window.location.origin` when available (same origin).',
            zh: '可用时为 `window.location.origin`（同源）。'
          }
        },
        allowUnsafeTargetOrigin: {
          summary: {
            en: 'Allows `targetOrigin: "*"`; the source window is still checked.',
            zh: '允许 `targetOrigin: "*"`；仍会校验来源窗口。'
          },
          default: {
            en: '`undefined`: omitted disables `*`.',
            zh: '默认 `undefined`，省略时拒绝使用 `*`。'
          }
        }
      }
    },
    IWindowMessageTarget: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'Window-like object messages are posted to.',
        zh: '接收发送消息的类窗口对象。'
      },
      members: {
        postMessage: {
          summary: {
            en: 'Posts a message with a target origin.',
            zh: '以指定目标源发送一条消息。'
          },
          params: {
            message: {
              en: 'The encoded RPC message.',
              zh: '编码后的 RPC 消息。'
            },
            targetOrigin: {
              en: '`targetOrigin` / `origin` from the options.',
              zh: '选项中的 `targetOrigin` / `origin`。'
            },
            transfer: {
              en: 'Transferable objects of this message.',
              zh: '本条消息要转移所有权的可转移对象。'
            }
          },
          returns: {
            en: 'Nothing; the message is posted.',
            zh: '无返回值；消息已发出。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        }
      }
    },
    IWindowMessageReceiver: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'Object whose `message` events are read.',
        zh: 'transport 从中读取 `message` 事件的接收对象。'
      },
      members: {
        addEventListener: {
          summary: {
            en: 'Registers a `message` listener on the receiving window; listening installs it; raw transports wait for the first subscription or error observer.',
            zh: '在接收消息的窗口上登记 `message` 监听；原始载体在首次订阅或错误观察开始时安装，监听工厂在开始接纳时安装。'
          },
          params: {
            type: {
              en: 'Event name: message.',
              zh: '事件名称：message。'
            },
            listener: {
              en: 'Listener the transport installs.',
              zh: '由 transport 安装的监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is registered.',
            zh: '无返回值；监听已登记。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        removeEventListener: {
          summary: {
            en: 'Removes the native listener after its final corresponding subscription is released; closing its owning Peer or listener also releases those subscriptions.',
            zh: '最后一个对应订阅释放后移除原生监听；所属运行对端或接纳监听者关闭时也释放这些订阅。'
          },
          params: {
            type: {
              en: 'Event name: message.',
              zh: '事件名称：message。'
            },
            listener: {
              en: 'The same listener installed before.',
              zh: '之前安装的同一个监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is removed.',
            zh: '无返回值；监听已移除。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        }
      }
    },
    ISharedWorkerPort: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'The `MessagePort` of a SharedWorker connection.',
        zh: 'SharedWorker 连接所使用的消息端口 `MessagePort`。'
      },
      members: {
        postMessage: {
          summary: {
            en: 'Posts a message to the other side.',
            zh: '通过端口向对端发送一条消息。'
          },
          params: {
            message: {
              en: 'The encoded RPC message.',
              zh: '编码后的 RPC 消息。'
            },
            transfer: {
              en: 'Transferable objects.',
              zh: '要转移所有权的可转移对象。'
            }
          },
          returns: {
            en: 'Nothing; the message is posted.',
            zh: '无返回值；消息已发出。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        start: {
          summary: {
            en: 'Optional; called when listening begins so queued messages are delivered.',
            zh: '可选；开始监听时调用，使排队的消息得以交付。'
          },
          returns: {
            en: 'Nothing; the port delivers messages.',
            zh: '无返回值；端口开始交付消息。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        addEventListener: {
          summary: {
            en: 'Registers a `message / messageerror` listener on the port; listening installs it; raw transports wait for the first subscription or error observer.',
            zh: '在端口上登记 `message / messageerror` 监听；原始载体在首次订阅或错误观察开始时安装，监听工厂在开始接纳时安装。'
          },
          params: {
            type: {
              en: 'Event name: message / messageerror.',
              zh: '事件名称：message / messageerror。'
            },
            listener: {
              en: 'Listener the transport installs.',
              zh: '由 transport 安装的监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is registered.',
            zh: '无返回值；监听已登记。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        removeEventListener: {
          summary: {
            en: 'Removes the native listener after its final corresponding subscription is released; closing its owning Peer or listener also releases those subscriptions.',
            zh: '最后一个对应订阅释放后移除原生监听；所属运行对端或接纳监听者关闭时也释放这些订阅。'
          },
          params: {
            type: {
              en: 'Event name: message / messageerror.',
              zh: '事件名称：message / messageerror。'
            },
            listener: {
              en: 'The same listener installed before.',
              zh: '之前安装的同一个监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is removed.',
            zh: '无返回值；监听已移除。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        }
      }
    },
    IServiceWorkerTransportOptions: {
      optionCases: [
        {
          title: {
            en: 'Send to the controlling worker',
            zh: '向当前控制页面的工作线程发送消息'
          },
          problem: {
            en: 'The application already has a ServiceWorker target and its `navigator.serviceWorker` receiver. Neither is created by this adapter. Pass both to separate outgoing delivery from incoming events; omitting either does not discover or register a worker.',
            zh: '应用已有 ServiceWorker 目标及 `navigator.serviceWorker` 接收端。适配器不会创建它们。分别传入发送目标与事件接收端；省略字段不会自动查找或注册工作线程。'
          },
          example:
            "import { createServiceWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/service-worker'\n\nconst transport = createServiceWorkerTransport({\n  target: serviceWorker,\n  receiver: navigator.serviceWorker\n})\nconst stop = transport.subscribe((message) => {\n  if (transport.sourceProof?.(message.source)) showCacheStatus(message.data)\n})\nrefreshButton.onclick = () => transport.send({ operation: 'refresh-cache' })\nonPageClosed(stop)",
          result: {
            en: 'Clicking refresh asks the controlling worker to update its cache; incoming status messages update the page’s cache indicator.',
            zh: '点击刷新会请求控制页面的工作线程更新缓存，收到的状态消息用于更新页面缓存提示。'
          },
          covers: ['target', 'receiver']
        },
        {
          title: {
            en: 'Recognize the same client through another wrapper',
            zh: '通过不同包装识别同一个客户端'
          },
          problem: {
            en: 'A worker receives a wrapper for an already known Client. `peerId` identifies that client when object identity differs. Omission uses `target.id` when available; an explicit id selects the expected Client id rather than accepting every source.',
            zh: '工作线程可能收到已知 Client 的另一个包装对象。对象身份不同时，`peerId` 用于识别这个客户端。省略时可使用 `target.id`；显式标识只接纳指定 Client，不会放行所有来源。'
          },
          example:
            "import { createServiceWorkerTransport } from '@migaia/rpc-plugin-browser/adapters/service-worker'\n\nconst transport = createServiceWorkerTransport({\n  target: client,\n  receiver: workerScope,\n  peerId: client.id\n})\nconst stop = transport.subscribe((message) => {\n  if (transport.sourceProof?.(message.source)) handleEditorMessage(message.data)\n})\ntransport.send({ operation: 'cache-updated' })\nonClientDisconnected(stop)",
          result: {
            en: 'The worker accepts messages for the selected Client id and sends cache updates to that client, even when inbound events use another wrapper.',
            zh: '即使接收事件使用另一个包装对象，工作线程仍按所选 Client id 接纳消息，并向该客户端发送缓存更新。'
          },
          covers: ['target', 'receiver', 'peerId']
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'Options of `createServiceWorkerTransport()`.',
        zh: '`createServiceWorkerTransport()` 的选项：目标、接收者与对端 id。'
      },
      members: {
        target: {
          summary: {
            en: 'ServiceWorker or Client that receives outgoing messages.',
            zh: '接收本端发出消息的 ServiceWorker 或 Client 对象。'
          }
        },
        receiver: {
          summary: {
            en: 'Owner of `message` events: `navigator.serviceWorker` in a page, `self` in the worker.',
            zh: '`message` 事件的所有者：页面中为 `navigator.serviceWorker`，Worker 中为 `self`。'
          }
        },
        peerId: {
          summary: {
            en: 'Id of the expected remote Client, taken from `client.id` in the worker.',
            zh: '预期的远端 Client 的 id，在 Worker 中取自 `client.id`。'
          },
          default: {
            en: '`target.id` when available.',
            zh: '可用时为 `target.id`。'
          }
        }
      }
    },
    IServiceWorkerMessageTarget: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'ServiceWorker or Client messages are posted to.',
        zh: '接收本端发送消息的 ServiceWorker 或 Client 对象。'
      },
      members: {
        postMessage: {
          summary: {
            en: 'Posts one message to the ServiceWorker or Client.',
            zh: '向目标 ServiceWorker 或 Client 发送一条编码后的 RPC 消息。'
          },
          params: {
            message: {
              en: 'The encoded RPC message.',
              zh: '编码后的 RPC 消息。'
            },
            transfer: {
              en: 'Transferable objects.',
              zh: '要转移所有权的可转移对象。'
            }
          },
          returns: {
            en: 'Nothing; the message is posted.',
            zh: '无返回值；消息已发出。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        id: {
          summary: {
            en: 'Client id, generated by the browser; used to accept replies.',
            zh: '由浏览器生成的 Client id；用于接受回复。'
          }
        }
      }
    },
    IServiceWorkerMessageReceiver: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      summary: {
        en: 'Owner of Service Worker `message` events.',
        zh: 'Service Worker 场景中负责派发 `message` 事件的对象。'
      },
      members: {
        addEventListener: {
          summary: {
            en: 'Registers a `message` listener on the Service Worker container; listening installs it; raw transports wait for the first subscription or error observer.',
            zh: '在Service Worker 容器上登记 `message` 监听；原始载体在首次订阅或错误观察开始时安装，监听工厂在开始接纳时安装。'
          },
          params: {
            type: {
              en: 'Event name: message.',
              zh: '事件名称：message。'
            },
            listener: {
              en: 'Listener the transport installs.',
              zh: '由 transport 安装的监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is registered.',
            zh: '无返回值；监听已登记。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        },
        removeEventListener: {
          summary: {
            en: 'Removes the native listener after its final corresponding subscription is released; closing its owning Peer or listener also releases those subscriptions.',
            zh: '最后一个对应订阅释放后移除原生监听；所属运行对端或接纳监听者关闭时也释放这些订阅。'
          },
          params: {
            type: {
              en: 'Event name: message.',
              zh: '事件名称：message。'
            },
            listener: {
              en: 'The same listener installed before.',
              zh: '之前安装的同一个监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is removed.',
            zh: '无返回值；监听已移除。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
          }
        }
      }
    },
    IRTCDataChannel: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
      },
      summary: {
        en: 'The parts of `RTCDataChannel` the transport uses.',
        zh: 'transport 实际使用的那部分 `RTCDataChannel` 能力。'
      },
      members: {
        send: {
          summary: {
            en: 'Sends one message as a JSON string.',
            zh: '把一条消息作为 JSON 字符串发送出去。'
          },
          params: {
            data: {
              en: 'The encoded message.',
              zh: '编码后的消息文本。'
            }
          },
          returns: {
            en: 'Nothing; the message is queued.',
            zh: '无返回值；消息已进入发送队列。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
          }
        },
        readyState: {
          summary: {
            en: 'Must be `open` or `closed` when the transport is created.',
            zh: '创建 transport 时频道状态必须为 `open` 或 `closed`。'
          }
        },
        addEventListener: {
          summary: {
            en: 'Registers a `message / closing / close / error` listener on the channel; listening installs it; raw transports wait for the first subscription or error observer.',
            zh: '在数据频道上登记 `message / closing / close / error` 监听；原始载体在首次订阅或错误观察开始时安装，监听工厂在开始接纳时安装。'
          },
          params: {
            type: {
              en: 'Event name: message / closing / close / error.',
              zh: '事件名称：message / closing / close / error。'
            },
            listener: {
              en: 'Listener the transport installs.',
              zh: '由 transport 安装的监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is registered.',
            zh: '无返回值；监听已登记。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
          }
        },
        removeEventListener: {
          summary: {
            en: 'Removes the native listener after its final corresponding subscription is released; closing its owning Peer or listener also releases those subscriptions.',
            zh: '最后一个对应订阅释放后移除原生监听；所属运行对端或接纳监听者关闭时也释放这些订阅。'
          },
          params: {
            type: {
              en: 'Event name: message / closing / close / error.',
              zh: '事件名称：message / closing / close / error。'
            },
            listener: {
              en: 'The same listener installed before.',
              zh: '之前安装的同一个监听函数。'
            }
          },
          returns: {
            en: 'Nothing; the listener is removed.',
            zh: '无返回值；监听已移除。'
          },
          example: {
            en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
            zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
          }
        }
      }
    },
    IWebTransportDatagrams: {
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 服务端须在配置的安全网址接纳网页传输，每个数据报承载一个完整通用文本编码对象；原样返回请求标识及回显载荷，两类消息均须适合路径最大传输单元；可能丢失乱序，此客户端不重试业务操作。\n// 数据报不提供运行对端来源或现成核心端点组合；仅字节编解码不足，默认分帧报告未知输出，原生二进制分帧可能输出此载体拒绝的分片对象；这里的对象是应用协议，不是核心信封或运行握手帧。\n// 网页客户端 web-client.ts：应用拥有原生网页传输会话并签发请求标识。\nimport { createWebTransportDatagramTransport } from '@migaia/rpc-plugin-browser/adapters/web-transport'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst session = new WebTransport('https://rpc.example:4433/echo')\nawait session.ready\nconst transport = createWebTransportDatagramTransport(session.datagrams)\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder('utf-8', { fatal: true })\nlet resolveReply!: (response: IResponse) => void\nlet rejectReply!: (error: unknown) => void\nconst reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\nconst remove = transport.subscribe(({ data }) => {\n  try {\n    const response = JSON.parse(decoder.decode(data)) as IResponse\n    if (response.id === 'echo-1') resolveReply(response)\n  } catch (error) { rejectReply(error) }\n})\nconst removeError = transport.onTransportError?.(rejectReply)\nconst timer = setTimeout(() => rejectReply(new Error('Datagram deadline elapsed')), 3000)\ntry {\n  const request: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\n  await transport.send(encoder.encode(JSON.stringify(request)))\n  console.log((await reply).payload)\n} finally {\n  clearTimeout(timer); remove(); removeError?.()\n  try { await transport.close?.() } finally { session.close() }\n}\n\n// 外部服务端协议：本库不提供服务端库，须在实际服务端实现下列精确数据报约束。\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst received: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\nconst reply: IResponse = { id: received.id, payload: { text: received.payload.text } }"
      },
      summary: {
        en: '`session.datagrams` of a WebTransport session.',
        zh: 'WebTransport 会话上的 `session.datagrams` 数据报读写流对象。'
      },
      members: {
        writable: {
          summary: {
            en: 'Datagram writer; the transport locks and later closes it.',
            zh: '数据报写入流；transport 会锁定它并在关闭时关闭。'
          }
        },
        readable: {
          summary: {
            en: 'Datagram reader; the transport reads it until closed.',
            zh: '数据报读取流；transport 会一直读取到关闭。'
          }
        }
      }
    },
    IWindowPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        window: {
          summary: {
            en: 'Application-selected Window or iframe message destination; origin restricts delivery, and this target does not replace the local receiving container.',
            zh: '应用指定的页面或内嵌页面消息发送目标，配合 origin 限定投递范围，不作为本地消息接收容器。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        origin: {
          summary: {
            en: 'Required nonempty destination origin. Wildcard requires explicit unsafe opt-in.',
            zh: '必填非空目标来源域，通配值须显式不安全选择。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        receiver: {
          summary: {
            en: 'Local native receiving surface configured separately from the sending target; received events must still satisfy the selected origin and peer checks.',
            zh: '本地原生消息接收面，与发送目标分开配置，接收事件仍须满足已选来源与对端校验。'
          },
          default: {
            en: 'Omitted: original default receiver.',
            zh: '省略时使用原默认接收面。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
        },
        allowUnsafeTargetOrigin: {
          summary: {
            en: 'Explicit true permits wildcard target origin; real source checking remains.',
            zh: '显式真值允许通配目标来源域，真实来源校验仍保留。'
          },
          default: {
            en: 'Omitted/false: wildcard rejected.',
            zh: '省略或假值时拒绝通配。'
          }
        }
      }
    },
    IWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        worker: {
          summary: {
            en: 'Actual browser Worker or its global sending/receiving surface supplied by the application; the Host borrows native listeners and neither launches nor terminates the Worker.',
            zh: '应用提供的实际浏览器工作程序或其全局收发面，宿主借用原生监听，不负责创建或终止工作程序。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    ISharedWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        'sharedWorker.port': {
          summary: {
            en: 'The actual port supplied by the page-owned SharedWorker; the plugin subscribes to it without closing the borrowed port.',
            zh: '页面持有的共享工作程序提供的实际端口；插件订阅该借入端口，关闭插件不会关闭物理端口。'
          },
          default: {
            en: 'Absent in listen mode; required through sharedWorker in page mode.',
            zh: '监听模式不提供；页面模式通过 sharedWorker 提供。'
          }
        },

        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        sharedWorker: {
          summary: {
            en: 'Actual SharedWorker whose port is borrowed. Mutually exclusive with listen.',
            zh: '借入端口的实际共享工作程序，与监听来源互斥。'
          },
          default: {
            en: 'Absent in listener mode.',
            zh: '监听模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}"
        },
        listen: {
          summary: {
            en: 'Native SharedWorker connect-event scope issuing actual ports.',
            zh: '签发实际端口的原生共享工作程序连接事件域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          }
        }
      }
    },
    IBroadcastChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        channel: {
          summary: {
            en: 'Actual BroadcastChannel created and owned by the application; the Host borrows it for messaging and does not close the native channel on Host shutdown.',
            zh: '应用创建并拥有的实际广播频道，宿主只借用它收发消息，关闭宿主不会代替应用关闭频道。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}"
        }
      }
    },
    IServiceWorkerPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        serviceWorker: {
          summary: {
            en: 'Actual page-side sending target. Mutually exclusive with clients.',
            zh: '实际页面发送目标，与客户端监听来源互斥。'
          },
          default: {
            en: 'Absent in worker listener mode.',
            zh: '子端监听模式不提供。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        receiver: {
          summary: {
            en: 'Local receiving container independent of the sending target, normally navigator.serviceWorker on a page; receives native messages returned by the selected target.',
            zh: '与发送目标独立的本地接收容器，页面端通常为 navigator.serviceWorker，用于接收目标返回的原生消息。'
          },
          default: {
            en: 'Omitted: navigator.serviceWorker when present.',
            zh: '省略时使用存在的原生服务工作程序容器。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
        },
        clients: {
          summary: {
            en: 'Real worker scope with clients.get and native message subscription.',
            zh: '带原生客户端查询和消息订阅的真实子端域。'
          },
          default: {
            en: 'Absent in page mode.',
            zh: '页面模式不提供。'
          }
        }
      }
    },
    IRtcDataChannelPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        rtcDataChannel: {
          summary: {
            en: 'Application-supplied reliable ordered native data channel; the Host borrows its messaging interface while signaling, creation and native closure remain application-owned.',
            zh: '应用提供的可靠有序原生数据频道，宿主借用其消息接口；信令、频道创建与原生关闭仍由应用负责。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IWebTransportPluginOptions: {
      summary: {
        en: 'Exactly this carrier source plus common cold installation options.',
        zh: '此载体的精确来源加上共用冷安装选项。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        },
        session: {
          summary: {
            en: 'Application-established reliable session with createBidirectionalStream; counterpart must implement the compatible byte RPC protocol.',
            zh: '应用已建立且能创建双向流的可靠会话，对端须实现兼容字节调用协议。'
          },
          example:
            "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
        }
      }
    },
    IBrowserPluginOptions: {
      summary: {
        en: 'Shared cold registration, exposure and handshake policy; it provides no source authority by itself.',
        zh: '共用冷登记、公开及握手策略，本身不提供来源权限。'
      },
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      members: {
        name: {
          ...rpcPluginOptionDocs.name,
          default: {
            en: 'Omitted: native carrier registration name.',
            zh: '省略时使用原生载体登记名。'
          }
        },
        expose: {
          ...rpcPluginOptionDocs.expose,
          default: {
            en: 'Omitted: original exposure policy.',
            zh: '省略时保留原公开策略。'
          }
        },
        connect: {
          ...rpcPluginOptionDocs.connect,
          default: {
            en: 'Omitted: canonical source handshake policy.',
            zh: '省略时使用原来源握手策略。'
          }
        },
        'connect.timeoutMs': {
          ...rpcPluginOptionDocs['connect.timeoutMs'],
          default: {
            en: 'Omitted: preserve source defaults.',
            zh: '省略时保留来源默认。'
          }
        }
      }
    },
    IBrowserMessagePortLike: {
      summary: {
        en: 'Structural EventTarget MessagePort with postMessage/start/close, exact listener removal and optional physical observations. The adapter does not steal mutable onmessage slots. Import from `@migaia/rpc-plugin-browser/adapters/message-port`.',
        zh: '带发送启动关闭、精确移除监听及可选物理观察的结构消息端口，适配器不占用可变消息回调槽。从 `@migaia/rpc-plugin-browser/adapters/message-port` 导入。'
      },
      members: {}
    },
    IBrowserMessagePortTransportOptions: {
      summary: {
        en: 'Select physical ownership for the low-level port wrapper: owned is the default and closes the port; borrowed removes only this adapter and its listeners. Import from `@migaia/rpc-plugin-browser/adapters/message-port`.',
        zh: '选择底层端口包装的物理归属，默认拥有并关闭端口；借用仅撤回此适配器及其监听。从 `@migaia/rpc-plugin-browser/adapters/message-port` 导入。'
      },
      members: {
        ownership: {
          summary: {
            en: 'Decide whether logical transport close also closes the supplied native MessagePort. Borrowed mode removes only this adapter and its listeners.',
            zh: '决定逻辑传输关闭是否同时关闭传入的原生消息端口；借用模式仅撤回此适配器及其监听。'
          },
          default: {
            en: '`owned`: close the supplied native port.',
            zh: '`owned`：关闭传入的原生端口。'
          },
          values: {
            owned: {
              en: 'The adapter closes the physical port during its own close.',
              zh: '适配器关闭时关闭物理端口。'
            },
            borrowed: {
              en: 'The caller retains physical-port shutdown responsibility.',
              zh: '调用方保留关闭物理端口的责任。'
            }
          }
        }
      }
    },
    IWebWorkerLikePort: {
      summary: {
        en: 'Structural Worker/port EventTarget with postMessage and exact message/error listener add/remove operations. No browser or Node global type dependency is required. Import from `@migaia/rpc-plugin-browser/adapters/web-worker`.',
        zh: '带消息发送及精确消息错误监听增删操作的结构工作程序端口，无需浏览器或服务端全局类型依赖。从 `@migaia/rpc-plugin-browser/adapters/web-worker` 导入。'
      },
      members: {}
    },
    IWebWorkerPortEvent: {
      summary: {
        en: 'Native event projection read by the adapter: data, actual error and optional origin/source/type. It does not authenticate a claimed sender inside data. Import from `@migaia/rpc-plugin-browser/adapters/web-worker`.',
        zh: '适配器读取的原生事件投影，含数据、实际错误及可选来源域、来源对象和类型，不认证载荷自报发送者。从 `@migaia/rpc-plugin-browser/adapters/web-worker` 导入。'
      },
      members: {}
    },
    IWebWorkerTransportOptions: {
      summary: {
        en: 'Optional static capabilities, direct peer address and expected native origin for an author-controlled deployment. Labels do not create a handshake or native qualification; the Worker stays borrowed. Import from `@migaia/rpc-plugin-browser/adapters/web-worker`.',
        zh: '作者控制部署的可选静态能力、直连地址及预期原生来源域；标签不创建握手或原生资格，工作程序仍为借入。从 `@migaia/rpc-plugin-browser/adapters/web-worker` 导入。'
      },
      members: {
        capabilities: {
          summary: {
            en: 'Static agreement supplied by the deployment owner; both endpoints must use the same capability set. Local metadata does not add authentication or transfer qualification.',
            zh: '部署所有者提供的静态协商集合，双方必须使用相同能力集合；本地元数据不会增加认证或转移资格。'
          },
          default: {
            en: 'Omitted: register the original batch-only static agreement.',
            zh: '省略时登记原仅含批处理的静态协商。'
          }
        },
        peerId: {
          summary: {
            en: 'Direct-peer address known by the deployment owner, not an identity discovered from an incoming payload.',
            zh: '部署所有者已知的直连对端地址，不是从入站载荷中发现的身份。'
          },
          default: {
            en: 'Omitted: the adapter publishes no static peer address.',
            zh: '省略时适配器不发布静态对端地址。'
          }
        },
        origin: {
          summary: {
            en: 'Expected native message origin supplied by the deployment owner for connection verification; it does not replace source or handshake checks.',
            zh: '部署所有者提供的预期原生消息来源域，用于连接校验，不替代来源对象或握手检查。'
          },
          default: {
            en: 'Omitted: no static expected origin is recorded.',
            zh: '省略时不记录静态预期来源域。'
          }
        }
      }
    }
  },
  enums: {
    RpcBrowserErrorCode: {
      summary: {
        en: 'Stable error codes of `@migaia/rpc-plugin-browser`.',
        zh: '`@migaia/rpc-plugin-browser` 的稳定错误码及其触发场景。'
      },
      values: {
        windowOriginRequired: {
          en: '`WINDOW_ORIGIN_REQUIRED`: a window Peer needs a non-empty `origin`.',
          zh: '`WINDOW_ORIGIN_REQUIRED`：创建窗口 Peer 时必须提供非空的 `origin`。'
        },
        rtcChannelUnreliable: {
          en: '`RTC_CHANNEL_UNRELIABLE`: the RTC channel is unordered or has retransmit limits.',
          zh: '`RTC_CHANNEL_UNRELIABLE`：RTC 频道无序或设置了重传限制。'
        },
        listenerAlreadyBound: {
          en: '`LISTENER_ALREADY_BOUND`: the SharedWorker scope already has a listener; close it first.',
          zh: '`LISTENER_ALREADY_BOUND`：该 SharedWorker 作用域已有监听器；需先关闭它。'
        },
        invalidPeerSource: {
          en: '`INVALID_PEER_SOURCE`: give exactly one supported `connect` or `listen`.',
          zh: '`INVALID_PEER_SOURCE`：必须且只能提供一个受支持的 `connect` 或 `listen`。'
        },
        messageDecodeFailed: {
          en: '`MESSAGE_DECODE_FAILED`: an RTC message is not valid JSON; see `cause`.',
          zh: '`MESSAGE_DECODE_FAILED`：收到的 RTC 消息不是合法的 JSON；原因见 `cause`。'
        }
      }
    }
  },
  enhancers: {
    createWindowMessageTransport: {
      kind: 'transport',
      target: 'Endpoint',
      summary: {
        en: 'After installation the Endpoint exchanges messages with one window over `postMessage`, accepting only that window and origin.',
        zh: '安装后 Endpoint 通过 `postMessage` 与某个窗口交换消息，只接受该窗口与该源的消息。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: '`endpoint.dispose()` removes the `message` listener; the window is not closed.',
          zh: '`endpoint.dispose()` 会移除 `message` 监听；窗口不会被关闭。'
        }
      ],
      scenarios: [
        {
          en: 'An Endpoint with custom middlewares between a page and an iframe.',
          zh: '在页面与 iframe 之间使用带自定义中间件的 Endpoint。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createSharedWorkerTransport: {
      kind: 'transport',
      target: 'Endpoint',
      summary: {
        en: 'After installation the Endpoint talks over one SharedWorker port.',
        zh: '安装后 Endpoint 通过一个 SharedWorker 端口与对面的 Worker 或页面互相发送调用。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: 'The port is started when listening begins and is never closed by the transport.',
          zh: '开始监听时启动端口，transport 不会关闭端口。'
        }
      ],
      scenarios: [
        {
          en: 'A custom Endpoint per tab connected to one SharedWorker.',
          zh: '每个标签页使用自定义 Endpoint 连接同一个 SharedWorker。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createServiceWorkerTransport: {
      kind: 'transport',
      target: 'Endpoint',
      summary: {
        en: 'After installation the Endpoint talks between a page and its Service Worker.',
        zh: '安装后 Endpoint 可以在页面与其注册的 Service Worker 之间互相发送调用。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: 'Endpoint `connect` checks `sourceProof` to ignore other clients; raw subscriptions retain their records.',
          zh: '端点 `connect` 按来源证明忽略其它客户端，原始订阅仍保留其消息记录。'
        }
      ],
      scenarios: [
        {
          en: 'Ask the Service Worker to prefetch or clear caches.',
          zh: '请求 Service Worker 预取或清理缓存。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createBroadcastChannelTransport: {
      kind: 'transport',
      target: 'Endpoint',
      summary: {
        en: 'After installation the Endpoint broadcasts to every same-origin context on the channel.',
        zh: '安装后 Endpoint 会向该频道上所有同源上下文广播每一条消息。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: 'Every tab sees every message; do not send private data. A native send failure keeps its type, stack and object identity when mutable; Core attaches `TRANSPORT` unless a full external semantic identity already exists. Unattachable values remain on `cause`.',
          zh: '所有标签页都能看到每条消息；不要发送私密数据。原生发送失败在可修改时保留类型、堆栈及对象身份；已有完整外部语义身份时保持原身份，否则核心附加 `TRANSPORT`；不可附加身份的值保留在 `cause`。'
        }
      ],
      scenarios: [
        {
          en: 'Keep a shopping cart in sync across tabs.',
          zh: '在多个标签页之间同步购物车。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
      }
    },
    createRtcDataChannelTransport: {
      kind: 'transport',
      target: 'RTCDataChannel',
      summary: {
        en: 'The application exchanges raw JSON strings through the same real RTC carrier; decoding remains explicit in the paired application protocol.',
        zh: '应用通过同一真实数据频道载体交换原始字符串，解码仍由双端应用协议显式执行。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: 'Closing the channel terminates the transport and releases observers. An RTC error event retains its original `error` as `cause` under Core `TRANSPORT`.',
          zh: '频道关闭时载体终止并释放观察者；数据频道错误事件的原 `error` 保留在核心 `TRANSPORT` 错误的 `cause` 中。'
        }
      ],
      scenarios: [
        {
          en: 'Peer-to-peer calls between two browsers without a server relay.',
          zh: '两个浏览器之间不经服务器中转的点对点调用。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 此处为原始载体上的应用字符串协议，不是运行对端流量；应用拥有信令、频道及原生连接的关闭；远程调用应使用双端运行对端示例，默认端点分帧不等于此字符串协议。\n// 数据频道调用方 rtc-client.ts：应用完成自备信令后提供已打开可靠频道。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport async function runClient(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const transport = createRtcDataChannelTransport(channel)\n  let resolveReply!: (response: IResponse) => void\n  let rejectReply!: (error: unknown) => void\n  const reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\n  const remove = transport.subscribe(({ data }) => {\n    try {\n      const response = JSON.parse(data as string) as IResponse\n      if (response.id === 'echo-1') resolveReply(response)\n    } catch (error) { rejectReply(error) }\n  })\n  const removeError = transport.onTransportError?.(rejectReply)\n  const timer = setTimeout(() => rejectReply(new Error('Reply deadline elapsed')), 3000)\n  try {\n    transport.send({ id: 'echo-1', method: 'echo', payload: { text: 'hello' } } satisfies IRequest)\n    console.log((await reply).payload)\n  } finally { clearTimeout(timer); remove(); removeError?.(); channel.close(); connection.close() }\n}\n\n// 数据频道服务方 rtc-service.ts：在匹配远端频道上先于调用方运行，随后由所有者调用返回的清理。\nimport { createRtcDataChannelTransport } from '@migaia/rpc-plugin-browser/adapters/rtc-data-channel'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nexport function attachService(channel: RTCDataChannel, connection: RTCPeerConnection) {\n  const service: IEchoApi = { echo: (input) => input }\n  const transport = createRtcDataChannelTransport(channel)\n  const remove = transport.subscribe(({ data }) => {\n    const request = JSON.parse(data as string) as IRequest\n    if (request.method === 'echo') transport.send({ id: request.id, payload: service.echo(request.payload) } satisfies IResponse)\n  })\n  return () => { remove(); channel.close(); connection.close() }\n}"
      }
    },
    createWebTransportDatagramTransport: {
      kind: 'transport',
      target: 'WebTransport.datagrams',
      summary: {
        en: 'The application exchanges actual Uint8Array datagrams with its external server protocol; no Runtime Peer or ready-made compatible Endpoint framing is installed.',
        zh: '应用使用外部服务端协议交换实际字节数组数据报，不安装运行对端或现成兼容端点分帧。'
      },
      install: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 服务端须在配置的安全网址接纳网页传输，每个数据报承载一个完整通用文本编码对象；原样返回请求标识及回显载荷，两类消息均须适合路径最大传输单元；可能丢失乱序，此客户端不重试业务操作。\n// 数据报不提供运行对端来源或现成核心端点组合；仅字节编解码不足，默认分帧报告未知输出，原生二进制分帧可能输出此载体拒绝的分片对象；这里的对象是应用协议，不是核心信封或运行握手帧。\n// 网页客户端 web-client.ts：应用拥有原生网页传输会话并签发请求标识。\nimport { createWebTransportDatagramTransport } from '@migaia/rpc-plugin-browser/adapters/web-transport'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst session = new WebTransport('https://rpc.example:4433/echo')\nawait session.ready\nconst transport = createWebTransportDatagramTransport(session.datagrams)\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder('utf-8', { fatal: true })\nlet resolveReply!: (response: IResponse) => void\nlet rejectReply!: (error: unknown) => void\nconst reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\nconst remove = transport.subscribe(({ data }) => {\n  try {\n    const response = JSON.parse(decoder.decode(data)) as IResponse\n    if (response.id === 'echo-1') resolveReply(response)\n  } catch (error) { rejectReply(error) }\n})\nconst removeError = transport.onTransportError?.(rejectReply)\nconst timer = setTimeout(() => rejectReply(new Error('Datagram deadline elapsed')), 3000)\ntry {\n  const request: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\n  await transport.send(encoder.encode(JSON.stringify(request)))\n  console.log((await reply).payload)\n} finally {\n  clearTimeout(timer); remove(); removeError?.()\n  try { await transport.close?.() } finally { session.close() }\n}\n\n// 外部服务端协议：本库不提供服务端库，须在实际服务端实现下列精确数据报约束。\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst received: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\nconst reply: IResponse = { id: received.id, payload: { text: received.payload.text } }"
      },
      grants: [],
      behaviors: [
        {
          en: '`transport.observe(probe)` reports one event per physical send and per accepted receive, with `carrier` on the event and `origin`, `transfers` and `rejectedSource` in `detail`. `sizeBytes` is exact for known native bytes and `-1` for strings or containers.',
          zh: '`transport.observe(probe)` 为每次物理发送和每次通过来源校验的接收各报告一个事件，事件自身记录 `carrier`，`detail` 中包含 `origin`、`transfers` 与 `rejectedSource`；已知原生字节的 `sizeBytes` 精确，字符串与容器为 `-1`。'
        },
        {
          en: 'Datagrams may be lost or reordered. Read and write failures use the Core transport boundary: mutable native errors retain type, stack and identity; immutable failures remain on `cause`. The send Promise handles writer rejection and need not equal the native write Promise.',
          zh: '数据报可能丢失或乱序。读写失败经过核心载体边界：可修改原生错误保留类型、堆栈及身份，不可修改的失败保留在 `cause`；发送返回处理写入拒绝的承诺，不保证与原生写入承诺引用相同。'
        }
      ],
      scenarios: [
        {
          en: 'Low-latency game or telemetry updates where a lost update is acceptable.',
          zh: '允许丢失更新的低延迟游戏或遥测数据。'
        }
      ],
      example: {
        en: "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
        zh: "// 服务端须在配置的安全网址接纳网页传输，每个数据报承载一个完整通用文本编码对象；原样返回请求标识及回显载荷，两类消息均须适合路径最大传输单元；可能丢失乱序，此客户端不重试业务操作。\n// 数据报不提供运行对端来源或现成核心端点组合；仅字节编解码不足，默认分帧报告未知输出，原生二进制分帧可能输出此载体拒绝的分片对象；这里的对象是应用协议，不是核心信封或运行握手帧。\n// 网页客户端 web-client.ts：应用拥有原生网页传输会话并签发请求标识。\nimport { createWebTransportDatagramTransport } from '@migaia/rpc-plugin-browser/adapters/web-transport'\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst session = new WebTransport('https://rpc.example:4433/echo')\nawait session.ready\nconst transport = createWebTransportDatagramTransport(session.datagrams)\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder('utf-8', { fatal: true })\nlet resolveReply!: (response: IResponse) => void\nlet rejectReply!: (error: unknown) => void\nconst reply = new Promise<IResponse>((resolve, reject) => { resolveReply = resolve; rejectReply = reject })\nconst remove = transport.subscribe(({ data }) => {\n  try {\n    const response = JSON.parse(decoder.decode(data)) as IResponse\n    if (response.id === 'echo-1') resolveReply(response)\n  } catch (error) { rejectReply(error) }\n})\nconst removeError = transport.onTransportError?.(rejectReply)\nconst timer = setTimeout(() => rejectReply(new Error('Datagram deadline elapsed')), 3000)\ntry {\n  const request: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\n  await transport.send(encoder.encode(JSON.stringify(request)))\n  console.log((await reply).payload)\n} finally {\n  clearTimeout(timer); remove(); removeError?.()\n  try { await transport.close?.() } finally { session.close() }\n}\n\n// 外部服务端协议：本库不提供服务端库，须在实际服务端实现下列精确数据报约束。\ntype IEchoApi = { echo(input: { text: string }): { text: string } }\ntype IRequest = { id: string; method: 'echo'; payload: Parameters<IEchoApi['echo']>[0] }\ntype IResponse = { id: string; payload: ReturnType<IEchoApi['echo']> }\nconst received: IRequest = { id: 'echo-1', method: 'echo', payload: { text: 'hello' } }\nconst reply: IResponse = { id: received.id, payload: { text: received.payload.text } }"
      }
    },
    windowPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Validate both explicit origin and the actual native event.source.',
        zh: '同时验证显式来源域及实际原生事件来源。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { windowPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callFrame(target: Window, origin: string) {\n  const host = await createRpcHost<{ title(): string }>({\n    plugins: [windowPlugin({ window: target, origin, receiver: window })]\n  })\n  try {\n    return await host.request('title')\n  } finally {\n    await host.close()\n  }\n}"
    },
    dedicatedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Borrow an actual page Worker or Worker self through the original EventTarget transport. No terminate is acquired.',
        zh: '经原事件目标传输借用实际页面工作程序或子端自身，不获取终止权限。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function doubleInWorker(worker: Worker) {\n  const host = await createRpcHost<{ double(value: number): number }>({\n    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('double', 21)\n  } finally {\n    await host.close()\n  }\n}"
    },
    sharedWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Choose sharedWorker on the page or listen on a real connect-event scope. Each MessagePort has independent acceptance; closing one leaves other sessions intact.',
        zh: '页面选择共享工作程序，子端选择真实连接事件监听域，每个消息端口独立接纳，关闭一条会话不影响其他会话。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function readSharedValue(worker: SharedWorker) {\n  const host = await createRpcHost<{ value(): number }>({\n    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]\n  })\n  try {\n    return await host.request('value')\n  } finally {\n    await host.close()\n  }\n}"
    },
    broadcastChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Join a real multiparty BroadcastChannel using original discovery, join/leave, and independent source proofs. The channel name is not peer identity; no transfer list exists.',
        zh: '经原发现、加入退出及独立来源证明接入真实多参与者频道，频道名不是对端身份，也没有转移列表。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function listenOnChannel(channel: BroadcastChannel) {\n  const host = await createRpcHost({\n    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],\n    provide: { double: (value: number) => value * 2 }\n  })\n  return host\n}"
    },
    serviceWorkerPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Separate page send target from receiver. Worker mode resolves actual event.source.id through clients.get before per-client handshake; payload claims grant no authority.',
        zh: '页面发送目标与接收面分开；子端经原生客户端查询解析真实事件来源标识后逐客户端握手，载荷自报不授予权限。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function askServiceWorker(worker: ServiceWorker) {\n  const host = await createRpcHost<{ version(): string }>({\n    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]\n  })\n  try {\n    return await host.request('version')\n  } finally {\n    await host.close()\n  }\n}"
    },
    rtcDataChannelPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Admit only ordered=true with maxRetransmits and maxPacketLifeTime both null. Applications own WebRTC negotiation and final native close.',
        zh: '仅接纳有序且重传次数、存活期限均为空的可靠频道，应用拥有协商及最终原生关闭。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'\n\nexport async function callRtc(channel: RTCDataChannel) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    },
    webTransportPlugin: {
      kind: 'transport',
      target: 'IRpcHost / PluginHost',
      summary: {
        en: 'Await the borrowed session.ready and create exactly one reliable bidirectional byte stream. Own reader/writer cleanup, not session.close; no datagram RPC.',
        zh: '等待借入会话就绪并只创建一条可靠双向字节流，拥有读写流清理而不关闭整个会话，不提供数据报调用。'
      },
      install:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}",
      grants: [],
      behaviors: [
        {
          en: 'Shared host calls preserve direct/broadcast shapes and original cancellation/error graphs.',
          zh: '共用宿主调用保留直连广播形状及原取消和错误图。'
        }
      ],
      scenarios: [
        {
          en: 'Connect this actual native carrier, with the same RPC protocol on both ends.',
          zh: '连接此实际原生载体，双方运行同一调用协议。'
        }
      ],
      example:
        "import { createRpcHost } from '@migaia/rpc-host'\nimport { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'\n\nexport async function callReliableSession(session: IWebTransportPluginOptions['session']) {\n  const host = await createRpcHost<{ echo(value: string): string }>({\n    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]\n  })\n  try {\n    return await host.request('echo', 'hello')\n  } finally {\n    await host.close()\n  }\n}"
    }
  }
}
