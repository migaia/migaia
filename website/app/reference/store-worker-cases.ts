import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Keeps native Worker option scenarios complete in either language. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Wraps one option workflow in a real native Worker and transferred MessagePort. */
const computeOptionsExample = (
  body: string,
  client = '{}',
  handler = '{}',
  compute = `(values: number[] | Uint8Array) => {
      if (Array.from(values).some((value) => value < 0)) throw new Error('retry this input')
      return Array.from(values).reduce((sum, value) => sum + value, 0)
    }`
): string => `import { Worker, MessageChannel, workerData, isMainThread, type MessagePort } from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler, workerComputed } from '@migaia/store-worker'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(${compute}, (message) => port.postMessage(message), ${handler})
  port.on('message', (message) => { void handler(message).catch(console.error) })
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1, ${client})
  try {
${body}
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}`

/** Serializer cases keep physical Worker ownership separate from endpoint ownership. */
const serializerOptionsExample = (
  transfer: boolean
): string => `import { Worker, MessageChannel, workerData, isMainThread, type MessagePort } from 'node:worker_threads'
import { createSerializeRegistry } from '@migaia/serialize'
import { jsonParser } from '@migaia/serialize/plugins'
import { workerParser, workerPlugin, createSerializeWorkerHandler } from '@migaia/store-worker/serialize/worker'
if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) => port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1]))
  port.on('message', (message) => { void handler(message).catch(console.error) })
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  let termination: Promise<number> | undefined
  const ownedPort = Object.assign(port1, { terminate: () => { termination = worker.terminate() } })
  const options = { worker: ownedPort, type: 'json', clientId: 'main', ownership: '${transfer ? 'transfer' : 'copy'}' as const, terminateOnDispose: ${transfer} }
  const parser = ${transfer ? 'createSerializeRegistry([workerPlugin(options)])' : 'workerParser(options)'}
  const bytes = new TextEncoder().encode('{"count":2}')
  try {
    const value = await parser.decode(['bytes', bytes], { signal: new AbortController().signal, context: 'cart' }) as { count: number }
    console.log(value.count, bytes.byteLength)
    await parser.dispose?.()
    console.log(termination !== undefined)
  } finally {
    await parser.dispose?.()
    port1.close()
    await (termination ?? worker.terminate())
  }
}`

/** Field examples share exact code with the matching configuration workflow. */
export const storeWorkerOptionExamples = {
  client: computeOptionsExample(
    '    console.log(await adapter.request([20, 22]))',
    "{ clientId: 'main', timeoutMs: 1000 }"
  ),
  timeout: computeOptionsExample(
    '    try { await adapter.request([20, 22]) } catch (error) { console.log((error as { code?: string }).code) }',
    '{ timeoutMs: 1 }',
    '{}',
    'async (values: number[]) => { await new Promise((resolve) => setTimeout(resolve, 30)); return values.reduce((sum, value) => sum + value, 0) }'
  ),
  handler: computeOptionsExample(
    '    console.log(await adapter.request([20, 22]))',
    '{}',
    '{ timeoutMs: 1000 }'
  ),
  handlerSlow: computeOptionsExample(
    '    console.log(await adapter.request([20, 22]))',
    '{}',
    '{ timeoutMs: 1 }',
    'async (values: number[]) => { await new Promise((resolve) => setTimeout(resolve, 10)); return values.reduce((sum, value) => sum + value, 0) }'
  ),
  cache: computeOptionsExample(`    const runtime = createRuntime()
    const scheduler = createManualScheduler()
    const total = workerComputed<number[], number>(adapter, () => [20, 22], {
      runtime, scheduler, debugName: 'cartTotal', autoStart: false,
      ttl: 1000, staleWhileRevalidate: true
    })
    console.log(total.peekState().status)
    console.log(await total.promise)
    scheduler.advance(1001)
    console.log(total.state.status, total.refreshing)
    await total.promise
    total.dispose()`),
  snapshot:
    computeOptionsExample(`    const original = workerComputed<number[], number>(adapter, () => [20, 22])
    await original.promise
    const initialSnapshot = original.dehydrate()
    original.dispose()
    let selected = 0
    const total = workerComputed<number[], number>(adapter, () => { selected++; return [1] }, { initialSnapshot })
    console.log(await total.promise, selected)
    total.dispose()`),
  retry: computeOptionsExample(`    let attempts = 0
    const total = workerComputed<number[], number>(adapter, () => ++attempts === 1 ? [-1] : [20, 22], {
      retry: 2,
      retryDelay: (failureCount) => failureCount * 5
    })
    console.log(await total.promise, attempts)
    total.dispose()`),
  prefetch: computeOptionsExample(`    const runtime = createRuntime()
    const input = runtime.signal([1])
    const total = workerComputed<number[], number>(adapter, () => input.value, { runtime, keepAlive: true })
    await total.promise
    input.value = [2]
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.log(await total.promise)
    total.dispose()
    input.dispose()`),
  transfer: computeOptionsExample(`    const bytes = new Uint8Array([20, 22])
    const total = workerComputed<Uint8Array, number>(adapter, () => bytes, {
      transfer: (input) => [input.buffer]
    })
    console.log(await total.promise, bytes.byteLength)
    total.dispose()`),
  copyParser: serializerOptionsExample(false),
  transferPlugin: serializerOptionsExample(true)
}

/** Configuration cases expose only public options and observable business outcomes. */
export const storeWorkerOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  client: [
    {
      title: t('Pair the default main identity with a deadline', '为默认主端身份设置截止期限'),
      problem: t(
        'The worker helper addresses main. Keep that matching clientId and set timeoutMs when a request must not wait indefinitely; without timeoutMs there is no default request deadline.',
        '工作端辅助指向 main。使用匹配的 clientId；请求不能一直等待时设置 timeoutMs。不设置则没有请求默认截止期限。'
      ),
      example: storeWorkerOptionExamples.client,
      result: t('Prints 42 before the one-second deadline.', '在一秒截止期限前输出 42。'),
      covers: ['clientId', 'timeoutMs']
    },
    {
      title: t('Stop waiting for a slow computation', '停止等待慢速计算'),
      problem: t(
        'A caller no longer wants to wait for a slow response. The client deadline rejects waiting; it does not prove that the remote computation stopped.',
        '调用方不想继续等待慢速响应。客户端截止期限会拒绝等待，不代表远端计算已经停止。'
      ),
      example: storeWorkerOptionExamples.timeout,
      result: t(
        'Prints the RPC timeout code; endpoint and native Worker cleanup still run.',
        '输出 RPC 超时码；随后仍清理端点和原生 Worker。'
      ),
      covers: ['timeoutMs']
    }
  ],
  handler: [
    {
      title: t('Configure the worker endpoint timeout', '配置工作端点的超时'),
      problem: t(
        'A worker-side endpoint can carry an outgoing request timeout. This option belongs to the endpoint, and does not impose a compute execution deadline. Omission leaves that outgoing timeout unset.',
        '工作端点可以设置向外请求的超时。此选项属于端点，不限制计算执行时间。省略时不设置该向外请求超时。'
      ),
      example: storeWorkerOptionExamples.handler,
      result: t('The paired client receives 42.', '配对客户端收到 42。'),
      covers: ['timeoutMs']
    },
    {
      title: t('Keep compute deadlines on the caller', '由调用方决定计算等待期限'),
      problem: t(
        'Setting handler timeoutMs to 1 does not stop a ten-millisecond compute callback. Use the client deadline when bounding how long the caller waits.',
        '把处理器 timeoutMs 设为 1 不会停止执行十毫秒的计算回调。限制调用方等待时间时，应设置客户端截止期限。'
      ),
      example: storeWorkerOptionExamples.handlerSlow,
      result: t('Prints 42 after the computation finishes.', '计算完成后输出 42。'),
      covers: ['timeoutMs']
    }
  ],
  computed: [
    {
      title: t('Load a cached total only when needed', '按需加载并缓存合计'),
      problem: t(
        'A collapsed panel needs no immediate Worker request. autoStart false leaves it idle until read. ttl limits cache age; staleWhileRevalidate keeps the previous total during refresh. runtime owns the graph, debugName labels it, and the manual scheduler demonstrates expiry without a real wait.',
        '折叠面板不需要立即请求 Worker。autoStart false 让它保持空闲，读取时才启动。ttl 限制缓存年龄；staleWhileRevalidate 在刷新期间保留旧合计。runtime 持有依赖图，debugName 提供标签，手动调度器无需真实等待即可演示过期。'
      ),
      example: storeWorkerOptionExamples.cache,
      result: t(
        'Prints idle, 42, then success true while refreshing.',
        '依次输出 idle、42，以及刷新中的 success true。'
      ),
      covers: ['runtime', 'scheduler', 'debugName', 'autoStart', 'ttl', 'staleWhileRevalidate']
    },
    {
      title: t('Restore an already computed total', '恢复已经算好的合计'),
      problem: t(
        'A saved fresh snapshot avoids repeating Worker work. Pass initialSnapshot from dehydrate(); without it, the resource starts its first computation normally.',
        '已有的新鲜快照可以避免重复 Worker 计算。把 dehydrate() 结果传入 initialSnapshot；不设置则正常启动第一次计算。'
      ),
      example: storeWorkerOptionExamples.snapshot,
      result: t(
        'Prints 42 0; the replacement resource never selects new input.',
        '输出 42 0；替代资源没有选择新输入。'
      ),
      covers: ['initialSnapshot']
    },
    {
      title: t('Retry a failed input with a delay', '延迟重试失败的输入'),
      problem: t(
        'A transient Worker failure should not immediately leave the resource in error. retry allows extra attempts; retryDelay computes each wait from a one-based failure count. Defaults perform no retry and add no delay.',
        '短暂 Worker 失败不应立即让资源停在错误状态。retry 允许额外尝试；retryDelay 根据从一开始的失败次数计算等待。默认不重试，也不增加等待。'
      ),
      example: storeWorkerOptionExamples.retry,
      result: t(
        'Prints 42 2; the second selected input succeeds.',
        '输出 42 2；第二次选择的输入计算成功。'
      ),
      covers: ['retry', 'retryDelay']
    },
    {
      title: t('Prefetch while nobody observes the result', '无人观察时也预取结果'),
      problem: t(
        'A background total must follow input changes before the panel opens. keepAlive keeps input dependencies connected while unobserved; by default they may disconnect.',
        '后台合计需要在面板打开前跟随输入变化。keepAlive 在无人观察时保持输入依赖；默认可能断开这些依赖。'
      ),
      example: storeWorkerOptionExamples.prefetch,
      result: t(
        'Prints 2 after the input changes, without creating an observer.',
        '输入变化后输出 2，无需创建观察者。'
      ),
      covers: ['keepAlive', 'runtime']
    },
    {
      title: t('Transfer disposable input bytes', '转移不再需要的输入字节'),
      problem: t(
        'An application can give up ownership of a complete buffer after sending it. transfer selects native transfer entries per input. Without it no explicit transfer list is supplied. This can detach aliases and is not an end-to-end zero-copy guarantee.',
        '应用发送完整缓冲区后，可以放弃其所有权。transfer 为每次输入选择原生转移条目。不设置则不提供显式转移列表。这可能分离所有别名，不保证全程零拷贝。'
      ),
      example: storeWorkerOptionExamples.transfer,
      result: t(
        'Prints 42 0; the Worker calculates the total and the caller buffer is detached.',
        '输出 42 0；Worker 算出合计，调用方缓冲区已分离。'
      ),
      covers: ['transfer']
    }
  ],
  serializer: [
    {
      title: t('Keep bytes for another decode', '保留字节供再次解码'),
      problem: t(
        'The caller still needs input bytes after decoding. ownership copy keeps them available. Match type json to the Worker parser and clientId main to the helper. terminateOnDispose false leaves physical Worker ownership with the caller.',
        '调用方解码后仍需要输入字节。ownership copy 保留这些字节。type json 匹配 Worker 解析器，clientId main 匹配辅助端点。terminateOnDispose false 让调用方继续持有物理 Worker。'
      ),
      example: storeWorkerOptionExamples.copyParser,
      result: t(
        'Prints count 2, a nonzero input length, then false for automatic termination.',
        '输出计数 2、非零输入长度，以及表示未自动终止的 false。'
      ),
      covers: ['worker', 'type', 'clientId', 'ownership', 'terminateOnDispose']
    },
    {
      title: t('Transfer bytes and own Worker termination', '转移字节并负责终止 Worker'),
      problem: t(
        'A dedicated parser may consume an entire buffer and terminate its Worker on disposal. Choose ownership transfer and terminateOnDispose true explicitly. Partial views and SharedArrayBuffer are not selected for transfer; defaults copy and do not terminate.',
        '专用解析器可以消耗完整缓冲区，并在释放时终止 Worker。显式选择 ownership transfer 与 terminateOnDispose true。局部视图和 SharedArrayBuffer 不会被选中转移；默认复制且不终止。'
      ),
      example: storeWorkerOptionExamples.transferPlugin,
      result: t(
        'Prints 2 0, then true; input bytes detach and disposal requests physical termination.',
        '先输出 2 0，再输出 true；输入字节分离，释放时请求终止物理 Worker。'
      ),
      covers: ['worker', 'type', 'clientId', 'ownership', 'terminateOnDispose']
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
        en: 'A Worker calculation throws a TypeError caused by an earlier RangeError, but the caller needs both failures to diagnose the input.\n\nSending only an error message loses native types, the nested cause and the original stack information across the thread boundary.\n\nWrap the real computation with createWorkerHandler and forward incoming messages to it. RPC returns a remote failure whose cause retains the native TypeError and its RangeError cause; no custom error-message protocol is needed.',
        zh: 'Worker 中的计算因输入问题抛出 `TypeError`，其原因又是一个 `RangeError`，调用方需要同时看到两层失败。\n\n只回传错误消息，会在线程边界丢失原生类型、嵌套原因和原始堆栈信息。\n\n用 `createWorkerHandler` 包装真实计算，并向它转交收到的消息；RPC 返回远端失败，其原因链保留原生 `TypeError` 与内部 `RangeError`，无需另建错误消息协议。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const root = new RangeError('invalid row')\n  const failure = new TypeError('cannot compute total', { cause: root })\n  const handler = createWorkerHandler(\n    () => {\n      throw failure\n    },\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error\n    const primary = failure.cause as Error\n    const root = primary.cause as Error\n    console.log('remote:', failure.name, (failure as Error & { code?: string }).code)\n    console.log('primary:', primary instanceof TypeError, primary.message)\n    console.log('cause:', root instanceof RangeError, root.message)\n    console.log('stacks:', Boolean(primary.stack), Boolean(root.stack))\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const root = new RangeError('行数据无效')\n  const failure = new TypeError('无法计算总数', { cause: root })\n  const handler = createWorkerHandler(\n    () => {\n      throw failure\n    },\n    (message) => port.postMessage(message)\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const adapter = new WorkerAdapter(port1)\n  try {\n    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error\n    const primary = failure.cause as Error\n    const root = primary.cause as Error\n    console.log('远端错误：', failure.name, (failure as Error & { code?: string }).code)\n    console.log('原始错误：', primary instanceof TypeError, primary.message)\n    console.log('原因：', root instanceof RangeError, root.message)\n    console.log('堆栈：', Boolean(primary.stack), Boolean(root.stack))\n  } finally {\n    await adapter.dispose()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: "The output is `remote: RpcRemoteError INTERNAL`, `primary: true cannot compute total`, `cause: true invalid row`, then `stacks: true true`.\n\nThe outer error belongs to RPC Core; the native errors remain below cause rather than becoming the top-level TypeError. The message handler's Promise covers delivery, not compute completion; await the main-side request for the operation result.",
        zh: '依次输出 `远端错误： RpcRemoteError INTERNAL`、`原始错误： true 无法计算总数`、`原因： true 行数据无效`、`堆栈： true true`。\n\n外层错误属于 RPC Core，原生错误保留在 `cause` 链中，不会把最外层变成 `TypeError`。消息处理器的 Promise 只等待投递，不代表计算完成；操作结果由主端请求等待。'
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
        en: "The output is `chunk: text`, then `restored: report 2`: the Worker-side JSON parser produces a text chunk and restores the original fields.\n\nThe explicit type 'json' replaces the default 'worker'; ownership defaults to 'copy' and terminateOnDispose to false. Registry disposal releases its parser endpoint, while the caller closes the native port and Worker. This is wiring evidence, not a speed measurement.",
        zh: "依次输出 `数据块： text`、`恢复： report 2`：工作端 JSON 解析器返回文本块，并恢复了原有字段。\n\n显式 `type: 'json'` 覆盖默认 `'worker'`，`ownership` 默认 `'copy'`，`terminateOnDispose` 默认 `false`。注册表释放解析器端点，原生端口与 Worker 仍由调用方关闭；这里证明接线，不作速度结论。"
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
        en: "A byte buffer may be needed for a later retry, while the current decode can become unnecessary before it is sent.\n\nTransferring a shared backing buffer can invalidate all its views; treating every cancellation as proof of detachment also discards input that was never sent.\n\nUse workerParser's default copy policy for the real Worker JSON parser. Decode once, then pass a pre-aborted signal and inspect its failure cause and the original bytes before deciding whether to retry.",
        zh: '输入字节可能还要留给下一次重试，当前解码却可能在发送前就不再需要。\n\n转移共用的底层缓冲区可能让所有视图失效；把取消一律当成已经分离，也会丢弃根本没有发送的输入。\n\n为真实 Worker JSON 解析器使用 `workerParser` 的默认复制策略，先完成一次解码，再传入预先中止的信号，检查失败原因和原字节后决定是否重试。'
      },
      example: {
        en: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const parser = workerParser({ worker: port1 })\n  const bytes = new TextEncoder().encode('{\"count\":2}')\n  try {\n    const context = { signal: new AbortController().signal, context: 'settings' }\n    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }\n    console.log('decoded:', value.count, bytes.byteLength)\n    const controller = new AbortController()\n    const reason = new DOMException('Request no longer needed', 'AbortError')\n    controller.abort(reason)\n    const failure = (await Promise.resolve(\n      parser.decode(['bytes', bytes], {\n        signal: controller.signal,\n        context: 'settings'\n      })\n    ).catch((error: unknown) => error)) as Error & { code?: string }\n    console.log('cancelled:', failure.code, failure.cause === reason)\n    console.log('input:', new TextDecoder().decode(bytes))\n  } finally {\n    await parser.dispose?.()\n    port1.close()\n    await worker.terminate()\n  }\n}",
        zh: "import {\n  Worker,\n  MessageChannel,\n  workerData,\n  isMainThread,\n  threadId,\n  type MessagePort\n} from 'node:worker_threads'\nimport { jsonParser } from '@migaia/serialize/plugins'\nimport { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'\n\nif (!isMainThread) {\n  const port = workerData as MessagePort\n  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>\n    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])\n  )\n  port.on('message', (message) => void handler(message).catch(console.error))\n} else {\n  const { port1, port2 } = new MessageChannel()\n  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })\n  port1.start()\n  const parser = workerParser({ worker: port1 })\n  const bytes = new TextEncoder().encode('{\"count\":2}')\n  try {\n    const context = { signal: new AbortController().signal, context: 'settings' }\n    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }\n    console.log('解码：', value.count, bytes.byteLength)\n    const controller = new AbortController()\n    const reason = new DOMException('已不再需要此次请求', 'AbortError')\n    controller.abort(reason)\n    const failure = (await Promise.resolve(\n      parser.decode(['bytes', bytes], {\n        signal: controller.signal,\n        context: 'settings'\n      })\n    ).catch((error: unknown) => error)) as Error & { code?: string }\n    console.log('已取消：', failure.code, failure.cause === reason)\n    console.log('输入：', new TextDecoder().decode(bytes))\n  } finally {\n    await parser.dispose?.()\n    port1.close()\n    await worker.terminate()\n  }\n}"
      },
      result: {
        en: 'The output is `decoded: 2 11`, `cancelled: REQUEST_ABORTED true`, then `input: {"count":2}`.\n\nCopy is the default ownership policy. This pre-cancelled decode preserves the caller\'s reason as cause and does not send work; it does not prove interruption of an already-running calculation. Transfer and byte detachment also do not establish zero-copy payload delivery.',
        zh: '依次输出 `解码： 2 11`、`已取消： REQUEST_ABORTED true`、`输入： {"count":2}`。\n\n默认所有权策略为 `\'copy\'`；本次预取消保留调用方的原始原因且不发送工作，不证明已经运行的计算会被抢占中断。显式转移和字节分离同样不代表载荷实现了零拷贝。'
      }
    }
  ]
}
