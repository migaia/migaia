import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Keeps native Worker option scenarios complete in either language. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Reader snippets use application-owned workers and keep native setup in verification files. */
export const storeWorkerOptionExamples = {
  client: `import { WorkerAdapter } from '@migaia/store-worker'

const adapter = new WorkerAdapter(cartWorker, { clientId: 'main', timeoutMs: 1000 })
renderTotal(await adapter.request<number[], number>(cartPrices))`,
  timeout: `import { WorkerAdapter } from '@migaia/store-worker'

const adapter = new WorkerAdapter(cartWorker, { timeoutMs: 2000 })
try {
  renderTotal(await adapter.request<number[], number>(cartPrices))
} catch (error) {
  showRecalculateButton(error)
}`,
  handler: `import { createWorkerHandler } from '@migaia/store-worker'

const handle = createWorkerHandler(calculateCartTotal, postToPage, { timeoutMs: 1000 })
workerScope.addEventListener('message', (event) => {
  void handle(event.data).catch(reportToMonitoring)
})`,
  cache: `import { workerComputed } from '@migaia/store-worker'
import { ResourceStatus } from '@migaia/resource'

const total = workerComputed<number[], number>(adapter, () => cartPrices.value, {
  runtime,
  scheduler: applicationClock,
  debugName: 'cart-total',
  ttl: 10_000,
  staleWhileRevalidate: true
})
runtime.effect(() => {
  const state = total.state
  if (state.status === ResourceStatus.success)
    renderTotal(state.data, { updating: state.refreshing ?? false })
})`,
  lazy: `import { workerComputed } from '@migaia/store-worker'

const total = workerComputed<number[], number>(adapter, readCartPrices, { autoStart: false })
summaryPanel.addEventListener('toggle', () => {
  if (summaryPanel.open) void total.promise.then(renderTotal)
})`,
  snapshot: `import { workerComputed } from '@migaia/store-worker'

const total = workerComputed<number[], number>(adapter, readCartPrices, {
  initialSnapshot: serverTotalSnapshot
})
renderTotal(await total.promise)`,
  retry: `import { workerComputed } from '@migaia/store-worker'

const total = workerComputed<number[], number>(adapter, readCartPrices, {
  retry: 2,
  retryDelay: (failureCount) => 500 * failureCount
})
renderTotal(await total.promise)`,
  prefetch: `import { workerComputed } from '@migaia/store-worker'

const nextPage = runtime.signal(2)
const summary = workerComputed<number[], number>(adapter, () => pagePrices(nextPage.value), {
  runtime,
  keepAlive: true
})
nextPage.value = 3`,
  copyParser: `import { workerParser } from '@migaia/store-worker/serialize/worker'

const parser = workerParser({
  worker: jsonWorker,
  type: 'json',
  clientId: 'main',
  terminateOnDispose: false
})
const bytes = await readUploadBytes(file)
const value = await parser.decode(['bytes', bytes], {
  signal: importLifetime.signal,
  context: 'cart-import'
})
renderImportedCart(value)
await saveOriginalUpload(bytes)
await parser.dispose?.()`,
  ownedPlugin: `import { createSerializeRegistry } from '@migaia/serialize'
import { workerPlugin } from '@migaia/store-worker/serialize/worker'

const registry = createSerializeRegistry([workerPlugin({
  worker: jsonWorker,
  type: 'json',
  clientId: 'main',
  terminateOnDispose: true
})])
const bytes = await readUploadBytes(file)
try {
  await registry.decode(['bytes', bytes], {
    signal: importLifetime.signal, context: 'cart-import'
  })
  await saveOriginalUpload(bytes)
} finally {
  await registry.dispose()
}`
}

/** Each option case explains one visible application outcome. */
export const storeWorkerOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  client: [
    {
      title: t('Calculate the cart before checkout continues', '结账继续前算出购物车合计'),
      problem: t(
        'A checkout page needs a total from its existing worker before enabling payment. Use the matching main identity and a one-second request deadline so a missing reply does not leave payment waiting forever.',
        '结账页需要从已有工作线程取得合计，才能启用支付。使用匹配的main身份并设置一秒请求期限，回复丢失时便不会让支付一直等待。'
      ),
      example: storeWorkerOptionExamples.client,
      result: t(
        'The cart total appears before payment continues; a missing response reaches the request error path after the configured deadline.',
        '支付继续前显示购物车合计；回复未到达时，请求会在设置的期限后进入错误处理。'
      ),
      covers: ['clientId', 'timeoutMs']
    },
    {
      title: t('Offer another calculation after a slow reply', '回复过慢时提供重新计算入口'),
      problem: t(
        'A pricing worker may be busy while the customer edits a cart. The page should regain control instead of waiting indefinitely. Bound the client wait and offer a recalculation control when it fails; this does not forcibly stop work in the worker.',
        '客户编辑购物车时，计价工作线程可能正忙。页面应恢复操作，而不是无限等待。限制客户端等待，并在失败时提供重新计算入口；这不会强行停止工作线程中的计算。'
      ),
      example: storeWorkerOptionExamples.timeout,
      result: t(
        'A timely total is displayed. Otherwise the page shows a recalculation control while the application retains ownership of the worker.',
        '及时返回的合计正常显示，否则页面显示重新计算入口，工作线程仍由应用拥有。'
      ),
      covers: ['timeoutMs']
    }
  ],
  computed: [
    {
      title: t('Keep the previous total visible during refresh', '刷新期间保留上次合计'),
      problem: t(
        'A cart summary can reuse a recent calculation, but it should refresh after ten seconds. Switching to an empty loading view makes the total flash. Keep the successful value during refresh and show a small updating indicator on the same application clock.',
        '购物车摘要可以复用近期计算，但十秒后需要刷新。切到空的等待界面会让合计闪烁；刷新期间保留成功值，并按应用统一时钟显示小型更新提示。'
      ),
      example: storeWorkerOptionExamples.cache,
      result: t(
        'The summary keeps its previous total while a stale read starts a new calculation, then replaces it when the new total arrives.',
        '过期读取启动新计算时，摘要继续显示上次合计；新合计返回后再替换。'
      ),
      covers: ['runtime', 'scheduler', 'debugName', 'ttl', 'staleWhileRevalidate']
    },
    {
      title: t('Restore a server-computed total', '恢复服务端已经算好的合计'),
      problem: t(
        'The server already calculated the cart summary. Starting another worker request on hydration repeats the same work and can show a loading state over correct content. Supply its fresh snapshot to begin with the existing result.',
        '服务端已经算好购物车摘要。页面恢复时再请求工作线程会重复计算，还可能在正确内容上显示等待状态。传入仍新鲜的快照，直接使用现有结果。'
      ),
      example: storeWorkerOptionExamples.snapshot,
      result: t(
        'The cart shows the restored total immediately; worker calculation resumes when the snapshot becomes stale or its dependencies change.',
        '购物车直接显示恢复的合计，快照过期或依赖变化后才重新计算。'
      ),
      covers: ['initialSnapshot']
    },
    {
      title: t('Retry a transient pricing failure', '重试短暂的计价失败'),
      problem: t(
        'A pricing worker can briefly fail while its supporting data is refreshed. Without retries, the cart summary immediately enters its error view. Allow two extra attempts with increasing waits so short failures can recover without rapid repeated requests.',
        '计价工作线程更新依赖数据时可能短暂失败。不重试时，购物车摘要会立即显示错误。允许额外尝试两次并逐步增加等待，短暂故障便有机会恢复，也不会连续快速请求。'
      ),
      example: storeWorkerOptionExamples.retry,
      result: t(
        'The cart continues waiting through the allowed retries and displays the total if a later attempt succeeds.',
        '允许的重试期间购物车继续等待，后续尝试成功后显示合计。'
      ),
      covers: ['retry', 'retryDelay']
    },
    {
      title: t('Prepare the next page summary in the background', '在后台准备下一页摘要'),
      problem: t(
        'A report pager wants its next summary ready before the user opens the summary panel. With no observer, default dependency suspension can postpone recalculation until that opening. Keep the input connected so changing the next-page number starts the background work.',
        '报表分页器希望用户打开摘要面板前，下一页摘要已经准备好。没有观察者时，默认依赖挂起可能把计算推迟到面板打开。保持输入连接，下一页页码变化时便开始后台工作。'
      ),
      example: storeWorkerOptionExamples.prefetch,
      result: t(
        'Changing the page number starts the next summary calculation while the panel is still closed.',
        '面板尚未打开时，页码变化便会启动下一页摘要计算。'
      ),
      covers: ['keepAlive', 'runtime']
    },
    {
      title: t('Calculate only when the summary panel opens', '摘要面板展开时才计算'),
      problem: t(
        'Most visitors never open the optional cart summary. Starting its worker request on every visit wastes work. Leave it idle and request its Promise only when the panel is opened.',
        '大多数访问者不会打开可选的购物车摘要。每次访问都请求工作线程会浪费计算。让资源保持空闲，只在面板展开时读取它的Promise。'
      ),
      example: storeWorkerOptionExamples.lazy,
      result: t(
        'Closed panels issue no initial calculation; opening the panel starts work and then displays its total.',
        '未展开的面板不会发起初始计算；展开后开始计算，再显示合计。'
      ),
      covers: ['autoStart']
    }
  ],
  serializer: [
    {
      title: t('Keep an uploaded file for validation and archiving', '保留上传文件供校验与归档'),
      problem: t(
        'A cart importer decodes an uploaded JSON file and also archives the original bytes. Worker calls copy parameters without detaching that input. Its JSON worker is shared with other imports, so disposing this parser must release only the borrowed endpoint.',
        '购物车导入器需要解码JSON文件，还要归档原始字节。Worker 调用复制参数，不 detach 这些输入。JSON工作线程还供其他导入使用，因此释放解析器时只能结束借用的端点。'
      ),
      example: storeWorkerOptionExamples.copyParser,
      result: t(
        'The imported cart is shown and the original upload can still be archived. Parser cleanup leaves the shared worker available.',
        '导入后的购物车正常显示，原始上传仍可归档，解析器清理后共享工作线程继续可用。'
      ),
      covers: ['worker', 'type', 'clientId', 'terminateOnDispose']
    },
    {
      title: t(
        'Decode copied bytes and retire the owned worker',
        '解码复制的字节并关闭拥有的工作线程'
      ),
      problem: t(
        'Decode a copied upload while preserving its original bytes. Finally dispose the registry and request its explicitly configured Worker termination.',
        '解码复制的上传并保留原始字节。finally 释放注册表并按显式配置请求终止 Worker。'
      ),
      example: storeWorkerOptionExamples.ownedPlugin,
      result: t(
        'The decoded result is available, the input remains readable, and registry disposal requests termination of its dedicated Worker.',
        '解码成功后输入仍可读取，注册表释放会请求终止专用 Worker。'
      ),
      covers: ['worker', 'type', 'clientId', 'terminateOnDispose']
    }
  ]
}

/** Complete native Node Worker examples shared with both usage guides. */
export const storeWorkerCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  WorkerAdapter: [
    {
      title: {
        en: 'Run a calculation in a real Worker',
        zh: '把计算交给真实 Worker'
      },
      problem: {
        en: 'A large calculation needs to leave the UI thread without making callers manage message identifiers and response matching.\n\nPosting application data alone leaves request matching, startup readiness and failure settlement to handwritten listeners.\n\nCreate a real Node Worker, transfer a MessagePort to it, and pair WorkerAdapter with createWorkerHandler. request waits for endpoint initialization; the returned PID and thread id show where the calculation ran.',
        zh: '一项计算需要离开界面线程，调用方又不想自己维护消息标识与响应匹配。\n\n只发送业务数据，还需要手写请求匹配、启动就绪和失败处理；主线程的等待也容易与 Worker 初始化错开。\n\n创建真实 Node Worker，把 `MessagePort` 转交给它，再配对 `WorkerAdapter` 与 `createWorkerHandler`；`request` 自动等待端点初始化，返回的进程与线程标识可核对计算位置。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (values: number[]) => ({\n      total: values.reduce((sum, value) => sum + value, 0),\n      pid: process.pid,\n      threadId\n    }),\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const result = await adapter.request<\n      number[],\n      {\n        total: number\n        pid: number\n        threadId: number\n      }\n    >([20, 22])\n    console.log('result:', result.total, result.pid === process.pid, result.threadId !== threadId)\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (values: number[]) => ({\n      total: values.reduce((sum, value) => sum + value, 0),\n      pid: process.pid,\n      threadId\n    }),\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const result = await adapter.request<\n      number[],\n      {\n        total: number\n        pid: number\n        threadId: number\n      }\n    >([20, 22])\n    console.log('结果：', result.total, result.pid === process.pid, result.threadId !== threadId)\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: "The output is `result: 42 true true`: the result is 42, the Worker shares the parent's process, and it runs on a different thread.\n\nThis is Node 24 native Worker execution, not a browser or process-isolation test. clientId defaults to 'main' and timeoutMs to undefined; the caller must close its borrowed port and terminate its own Worker.",
        zh: "输出 `结果： 42 true true`：结果是 `42`，Worker 与父线程位于同一进程，却使用不同线程。\n\n这里验证的是 Node 24 原生 Worker，不是浏览器环境或进程隔离；`clientId` 默认 `'main'`，`timeoutMs` 默认 `undefined`。端口由适配器借用，调用方仍需关闭端口并终止自己创建的 Worker。"
      }
    },
    {
      title: {
        en: 'Stop requests without terminating a borrowed Worker',
        zh: '停止请求并保留借用的 Worker'
      },
      problem: {
        en: 'A screen closes its RPC client while the application still owns the Worker and its port.\n\nTerminating the Worker inside client cleanup destroys a resource owned elsewhere; only marking the client closed leaves its endpoint subscriptions installed.\n\nUse close to reject new requests immediately, then await dispose to release the endpoint. Repeated dispose calls share one Promise; a native ping afterward checks that the borrowed Worker port still works.',
        zh: '页面关闭了请求客户端，应用却仍持有 Worker 和端口。\n\n在客户端清理时直接终止 Worker，会释放不属于它的资源；只标记关闭，又会留下端点订阅。\n\n用 `close` 立即拒绝新请求，再等待 `dispose` 释放端点；重复销毁复用同一个 Promise，最后用原生消息确认借用的 Worker 端口仍能通信。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (value: number) => value * 2,\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => {\n    if (message === 'ping') {\n      port.postMessage('pong')\n      return\n    }\n    void handler(message).catch(console.error)\n  })\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    console.log('before close:', await adapter.request(21))\n    adapter.close()\n    const failure = await adapter.request(21).catch((error: unknown) => error)\n    console.log('closed:', adapter.disposed, (failure as { code?: string }).code)\n    const first = adapter.dispose()\n    console.log('same cleanup:', first === adapter.dispose())\n    await first\n    const pong = new Promise<unknown>((resolve) => port1.once('message', resolve))\n    port1.postMessage('ping')\n    console.log('borrowed port:', await pong)\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (value: number) => value * 2,\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => {\n    if (message === 'ping') {\n      port.postMessage('pong')\n      return\n    }\n    void handler(message).catch(console.error)\n  })\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    console.log('关闭前：', await adapter.request(21))\n    adapter.close()\n    const failure = await adapter.request(21).catch((error: unknown) => error)\n    console.log('已关闭：', adapter.disposed, (failure as { code?: string }).code)\n    const first = adapter.dispose()\n    console.log('同一清理：', first === adapter.dispose())\n    await first\n    const pong = new Promise<unknown>((resolve) => port1.once('message', resolve))\n    port1.postMessage('ping')\n    console.log('借用端口：', await pong)\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: 'The output is `before close: 42`, `closed: true ADAPTER_DISPOSED`, `same cleanup: true`, then `borrowed port: pong`.\n\nclose only changes admission; dispose performs asynchronous endpoint cleanup and can reject. Neither closes the native port nor terminates the Worker. The final ping is a separate native host message, not an RPC request.',
        zh: '依次输出 `关闭前： 42`、`已关闭： true ADAPTER_DISPOSED`、`同一清理： true`、`借用端口： pong`。\n\n`close` 只停止接收新请求，`dispose` 才执行可能失败的异步端点清理；两者都不关闭原生端口或终止 Worker。最后的探测是独立宿主消息，不是 RPC 请求。'
      }
    }
  ],
  createWorkerHandler: [
    {
      title: {
        en: 'Keep a Worker computation failure traceable',
        zh: '保留 Worker 计算失败的原因链'
      },
      problem: {
        en: 'A Worker calculation throws a TypeError caused by an earlier RangeError, but the caller needs both failures to diagnose the input.\n\nSending only an error message loses native types, the nested cause and the original stack information across the thread boundary.\n\nWrap the real computation with createWorkerHandler and forward incoming messages to it. RPC preserves the native TypeError as the top-level failure and its RangeError cause; no custom error-message protocol is needed.',
        zh: 'Worker 中的计算因输入问题抛出 `TypeError`，其原因又是一个 `RangeError`，调用方需要同时看到两层失败。\n\n只回传错误消息，会在线程边界丢失原生类型、嵌套原因和原始堆栈信息。\n\n用 `createWorkerHandler` 包装真实计算，并向它转交收到的消息；RPC 保留顶层原生 `TypeError` 与内部 `RangeError` 原因，无需另建错误消息协议。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const root = new RangeError('invalid row')\n  const failure = new TypeError('cannot compute total', { cause: root })\n  const handler = createWorkerHandler(\n    () => {\n      throw failure\n    },\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error\n    const primary = failure\n    const root = primary.cause as Error\n    console.log('remote:', failure.name, (failure as Error & { code?: string }).code)\n    console.log('primary:', primary instanceof TypeError, primary.message)\n    console.log('cause:', root instanceof RangeError, root.message)\n    console.log('stacks:', Boolean(primary.stack), Boolean(root.stack))\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const root = new RangeError('行数据无效')\n  const failure = new TypeError('无法计算总数', { cause: root })\n  const handler = createWorkerHandler(\n    () => {\n      throw failure\n    },\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error\n    const primary = failure\n    const root = primary.cause as Error\n    console.log('远端错误：', failure.name, (failure as Error & { code?: string }).code)\n    console.log('原始错误：', primary instanceof TypeError, primary.message)\n    console.log('原因：', root instanceof RangeError, root.message)\n    console.log('堆栈：', Boolean(primary.stack), Boolean(root.stack))\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: "The output is `remote: TypeError UNKNOWN`, `primary: true cannot compute total`, `cause: true invalid row`, then `stacks: true true`.\n\nThe original TypeError remains top-level with its RangeError cause and both original stacks; no synthetic RpcRemoteError wrapper is added. The message handler's Promise covers delivery, not compute completion; await the main-side request for the operation result.",
        zh: '依次输出 `远端错误： TypeError UNKNOWN`、`原始错误： true 无法计算总数`、`原因： true 行数据无效`、`堆栈： true true`。\n\n原生 TypeError 保留在顶层，RangeError 原因与两层原始堆栈均可读取；不会添加伪造 RpcRemoteError 外壳。消息处理器的 Promise 只等待投递，不代表计算完成；操作结果由主端请求等待。'
      }
    }
  ],
  workerComputed: [
    {
      title: {
        en: 'Use Resource state and cache for Worker results',
        zh: '用 Resource 管理 Worker 结果与缓存'
      },
      problem: {
        en: "A view needs loading and successful states plus a cached Worker result, and its inputs can change later.\n\nKeeping a separate result variable and cache beside Worker requests duplicates Resource behavior and makes it easy to show a result for outdated inputs.\n\nUse workerComputed with a synchronous selector and the signal's Runtime. autoStart false skips eager construction work; reading state can still start lazy work. Await refetch, read the cached promise, then explicitly refresh after input changes.",
        zh: '界面需要展示加载与成功状态，也需要缓存 Worker 结果，输入之后还可能继续变化。\n\n在请求旁再维护结果变量和缓存，会重复实现 `Resource` 的行为，也容易把旧输入的结果留在界面上。\n\n用 `workerComputed` 同步选择输入，并传入信号所属的运行时；`autoStart: false` 跳过构造时主动启动，读取 `state` 仍可按需取值，再等待 `refetch`、读取缓存并在输入改变后刷新。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { createRuntime } from '@migaia/reactive'\nimport { WorkerAdapter, createWorkerHandler, workerComputed } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (values: number[]) => values.reduce((total, value) => total + value, 0),\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  const runtime = createRuntime()\n  const values = runtime.signal([1, 2, 3])\n  const sum = workerComputed<number[], number>(adapter, () => values.value, {\n    runtime,\n    autoStart: false\n  })\n  try {\n    console.log('before:', sum.state.status)\n    console.log('first:', await sum.refetch(), sum.state.status)\n    const cached = sum.promise\n    console.log('cache:', cached === sum.promise, await cached)\n    values.value = [4, 5]\n    console.log('next:', await sum.refetch(), sum.state.status)\n  } finally {\n    sum.dispose()\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { createRuntime } from '@migaia/reactive'\nimport { WorkerAdapter, createWorkerHandler, workerComputed } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createWorkerHandler(\n    (values: number[]) => values.reduce((total, value) => total + value, 0),\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  const runtime = createRuntime()\n  const values = runtime.signal([1, 2, 3])\n  const sum = workerComputed<number[], number>(adapter, () => values.value, {\n    runtime,\n    autoStart: false\n  })\n  try {\n    console.log('取值前：', sum.state.status)\n    console.log('首次：', await sum.refetch(), sum.state.status)\n    const cached = sum.promise\n    console.log('缓存：', cached === sum.promise, await cached)\n    values.value = [4, 5]\n    console.log('更新：', await sum.refetch(), sum.state.status)\n  } finally {\n    sum.dispose()\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: 'The output is `before: pending`, `first: 6 success`, `cache: true 6`, then `next: 9 success`.\n\nautoStart defaults to true; false skips eager construction, not lazy state reads. The first state read starts work and reports pending. ttl defaults to Infinity; passive promise reads reuse fresh cache, while refetch forces work. Dispose Resource before its borrowed adapter and Worker.',
        zh: '依次输出 `取值前： pending`、`首次： 6 success`、`缓存： true 6`、`更新： 9 success`。\n\n`autoStart` 默认 `true`，设为 `false` 只跳过构造时主动启动；首次读取 `state` 会按需取值并显示 `pending`。`ttl` 默认 `Infinity`，被动读取 `promise` 复用新鲜缓存，`refetch` 则强制刷新；先释放资源，再清理借用的适配器与 Worker。'
      }
    }
  ],
  workerPlugin: [
    {
      title: {
        en: 'Run an existing JSON parser through a Worker registry plugin',
        zh: '把现有 JSON 解析器接入 Worker 注册表插件'
      },
      problem: {
        en: 'An application already uses a serialization registry, but one parser should execute inside a Worker.\n\nReplacing registry calls with ad hoc messages duplicates format routing and cleanup, while running another parser on the main thread defeats the intended execution boundary.\n\nInstall jsonParser with createSerializeWorkerHandler inside a real Worker, then register workerPlugin on the main side. Keep the existing registry encode and decode calls; the type label selects this plugin.',
        zh: '应用已经使用序列化注册表，现在需要把某个解析器放到 Worker 执行。\n\n把注册表调用改成临时消息，会重复实现格式选择与清理；主线程再运行一份解析器，又没有建立预期的执行边界。\n\n在真实 Worker 中用 `createSerializeWorkerHandler` 接入 `jsonParser`，主线程注册 `workerPlugin`；继续调用注册表的编码与解码接口，由格式标签选择此插件。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { createSerializeRegistry } from '@migaia/serialize'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerPlugin } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const registry = createSerializeRegistry([workerPlugin({ worker: port1, type: 'json' })])\n  try {\n    const chunk = await registry.encode({ title: 'report', count: 2 })\n    const value = (await registry.decode(chunk)) as { title: string; count: number }\n    console.log('chunk:', chunk[0])\n    console.log('restored:', value.title, value.count)\n  } finally {\n    await registry.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { createSerializeRegistry } from '@migaia/serialize'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerPlugin } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const registry = createSerializeRegistry([workerPlugin({ worker: port1, type: 'json' })])\n  try {\n    const chunk = await registry.encode({ title: 'report', count: 2 })\n    const value = (await registry.decode(chunk)) as { title: string; count: number }\n    console.log('数据块：', chunk[0])\n    console.log('恢复：', value.title, value.count)\n  } finally {\n    await registry.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: "The output is `chunk: text`, then `restored: report 2`: the Worker-side JSON parser produces a text chunk and restores the original fields.\n\nThe explicit type 'json' replaces the default 'worker'; terminateOnDispose defaults to false. Registry disposal releases its parser endpoint, while the caller closes the native port and Worker. This is wiring evidence, not a speed measurement.",
        zh: "依次输出 `数据块： text`、`恢复： report 2`：工作端 JSON 解析器返回文本块，并恢复了原有字段。\n\n显式 `type: 'json'` 覆盖默认 `'worker'`，`terminateOnDispose` 默认 `false`。注册表释放解析器端点，原生端口与 Worker 仍由调用方关闭；这里证明接线，不作速度结论。"
      }
    }
  ],
  workerParser: [
    {
      title: {
        en: 'Keep input bytes available when a decode is cancelled',
        zh: '取消解码时保留输入字节'
      },
      problem: {
        en: "A byte buffer may be needed for a later retry, while the current decode can become unnecessary before it is sent.\n\nAll Worker calls copy parameters without detaching caller input. Cancellation and input memory remain separately observable; work already running must cooperate with its signal.\n\nUse workerParser's copying path for the real Worker JSON parser. Decode once, then pass a pre-aborted signal and inspect its failure cause and the original bytes before deciding whether to retry.",
        zh: '输入字节可能还要留给下一次重试，当前解码却可能在发送前就不再需要。\n\n所有 Worker 调用复制参数，不 detach 输入。取消结果与输入内存分别可观察；已经开始的计算仍需主动处理取消信号。\n\n为真实 Worker JSON 解析器使用 `workerParser` 的复制路径，先完成一次解码，再传入预先中止的信号，检查失败原因和原字节后决定是否重试。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const parser = workerParser({ worker: port1 })\n  const bytes = new TextEncoder().encode('{\"count\":2}')\n  try {\n    const context = { signal: new AbortController().signal, context: 'settings' }\n    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }\n    console.log('decoded:', value.count, bytes.byteLength)\n    const controller = new AbortController()\n    const reason = new DOMException('Request no longer needed', 'AbortError')\n    controller.abort(reason)\n    const failure = (await Promise.resolve(\n      parser.decode(['bytes', bytes], {\n        signal: controller.signal,\n        context: 'settings'\n      })\n    ).catch((error: unknown) => error)) as Error & { code?: string }\n    console.log('cancelled:', failure.code, failure.cause === reason)\n    console.log('input:', new TextDecoder().decode(bytes))\n  } finally {\n    await parser.dispose?.()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const parser = workerParser({ worker: port1 })\n  const bytes = new TextEncoder().encode('{\"count\":2}')\n  try {\n    const context = { signal: new AbortController().signal, context: 'settings' }\n    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }\n    console.log('解码：', value.count, bytes.byteLength)\n    const controller = new AbortController()\n    const reason = new DOMException('已不再需要此次请求', 'AbortError')\n    controller.abort(reason)\n    const failure = (await Promise.resolve(\n      parser.decode(['bytes', bytes], {\n        signal: controller.signal,\n        context: 'settings'\n      })\n    ).catch((error: unknown) => error)) as Error & { code?: string }\n    console.log('已取消：', failure.code, failure.cause === reason)\n    console.log('输入：', new TextDecoder().decode(bytes))\n  } finally {\n    await parser.dispose?.()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: 'The output is `decoded: 2 11`, `cancelled: REQUEST_ABORTED true`, then `input: {"count":2}`.\n\nThis pre-cancelled decode preserves the caller\'s reason as cause and does not send work; it does not prove interruption of an already-running calculation. ',
        zh: '依次输出 `解码： 2 11`、`已取消： REQUEST_ABORTED true`、`输入： {"count":2}`。\n\n本次预取消保留调用方的原始原因且不发送工作，不证明已经运行的计算会被抢占中断。'
      }
    }
  ]
}
