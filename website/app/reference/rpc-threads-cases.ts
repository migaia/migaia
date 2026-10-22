import type { ICaseDoc } from './contract.js'

/** Real Node Workers and MessagePorts demonstrate separate execution and resource ownership. */
export const rpcThreadsCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createThreadPeer: [
    {
      title: {
        en: 'Run work on a real Worker without confusing it with another process',
        zh: '在真实 Worker 上执行任务并区分线程与进程'
      },
      problem: {
        en: 'CPU work should leave the main thread, but a returned number does not identify where it ran.\n\nReexecuting the same entry without a child branch creates more Workers, while checking only process ids cannot distinguish threads of one Node process.\n\nAwait isThreadChild(), provide methods in the Worker, and spawn the real current file; compare both native process and thread identities.',
        zh: '计算需要移出主线程，但单看返回的数字，还不知道它在哪里执行。\n\n同一入口重新执行时，若不先区分子线程，就会继续创建更多 Worker；只比较进程 id，也无法区分同一 Node 进程里的线程。\n\n先等待 `isThreadChild()`，子端提供方法，父端从当前真实文件启动 Worker，并同时比较原生进程和线程标识。'
      },
      example: {
        en: "import { threadId } from 'node:worker_threads'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { double(value: number): number; identity(): { pid: number; threadId: number } }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      double: (value: number) => value * 2,\n      identity: () => ({ pid: process.pid, threadId })\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IWorkerApi>({ spawn: true })\n  try {\n    console.log(await worker.request('double', 21))\n    const identity = await worker.request('identity')\n    console.log(identity.pid === process.pid)\n    console.log(identity.threadId !== threadId)\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { threadId } from 'node:worker_threads'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { double(value: number): number; identity(): { pid: number; threadId: number } }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      double: (value: number) => value * 2,\n      identity: () => ({ pid: process.pid, threadId })\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IWorkerApi>({ spawn: true })\n  try {\n    console.log(await worker.request('double', 21))\n    const identity = await worker.request('identity')\n    console.log(identity.pid === process.pid)\n    console.log(identity.threadId !== threadId)\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: 'Output is `42`, `true`, `true`: the result is correct, process ids match, and native thread ids differ.\n\nThis proves a real Node Worker within one process; it does not provide process isolation, and the owning Peer must close the Worker explicitly.',
        zh: '输出为 `42`、`true`、`true`：结果正确，进程 id 相同，而原生线程 id 不同。\n\n这证明任务运行在同一进程的真实 Node Worker 中，不代表进程级隔离；持有它的 Peer 仍要显式关闭 Worker。'
      }
    },
    {
      title: {
        en: 'Call the parent and consume Worker results through one connection',
        zh: '通过同一连接反向调用父端并消费 Worker 结果'
      },
      problem: {
        en: 'A Worker needs a parent-owned operation while also exposing a sequence of task results.\n\nSeparate postMessage routes require their own correlation and cleanup, and collecting the whole sequence delays access to its individual values.\n\nProvide the parent method, await its request from the Worker, and expose an async generator for stream(); the parent closes one owner afterward.',
        zh: 'Worker 既需要父端持有的操作，也要提供一串任务结果。\n\n拆成多套 `postMessage` 路由，就得分别维护结果对应和清理；先收集整个序列，又会推迟读取其中的值。\n\n父端提供方法，Worker 等待反向请求结果；序列方法返回异步生成器，由父端通过 `stream()` 消费，最后统一关闭所有者。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IParentApi = { prefix(value: string): string }\ntype IWorkerApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (await isThreadChild()) {\n  const parent = createThreadPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const worker = await createThreadPeer<IWorkerApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => 'main:' + value }\n  })\n  try {\n    console.log(await worker.request('label', 'job'))\n    const values: number[] = []\n    for await (const value of worker.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IParentApi = { prefix(value: string): string }\ntype IWorkerApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (await isThreadChild()) {\n  const parent = createThreadPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const worker = await createThreadPeer<IWorkerApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => '主端:' + value }\n  })\n  try {\n    console.log(await worker.request('label', '任务'))\n    const values: number[] = []\n    for await (const value of worker.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: 'Output is `main:job` and `1,2,3`: one request crosses back to the parent and the stream supplies three values.\n\nThese are separate methods on the same connection; streams are lazy until iteration, and notify completion would not acknowledge provider completion.',
        zh: '输出为 `主端:任务`、`1,2,3`：一个请求反向调用父端，流则提供三个值。\n\n这是同一连接上的两个独立方法；流开始迭代时才执行发送，`notify` 完成也不表示提供方已经执行完成。'
      }
    },
    {
      title: {
        en: 'Keep copied bytes usable when unsigned RPC transfer is refused',
        zh: '未签名的 RPC 转移被拒绝后仍可使用原字节'
      },
      problem: {
        en: 'A Worker mutates its input, but the caller still needs its original bytes for later work.\n\nAssuming every native port send transfers ownership can detach storage unexpectedly; requesting RPC transfer without its trust configuration must not silently bypass that boundary.\n\nUse the default copying request, then attempt transfer without authentication and check the error, original storage and provider call count.',
        zh: 'Worker 会修改收到的输入，但调用方后续还要使用自己的原始字节。\n\n把所有原生端口发送都当成转移所有权，会意外让原存储失效；未配置签名的 RPC 转移也不能悄悄绕过信任边界。\n\n先用默认复制方式请求，再尝试未配置认证的转移，并检查错误、原始存储和提供方调用次数。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IBytesApi = {\n  inspect(buffer: ArrayBuffer): { length: number; first: number }\n  calls(): number\n}\nif (await isThreadChild()) {\n  let calls = 0\n  await createThreadPeer({\n    provide: {\n      inspect: (buffer: ArrayBuffer) => {\n        calls++\n        const bytes = new Uint8Array(buffer)\n        const result = { length: buffer.byteLength, first: bytes[0]! }\n        bytes[0] = 99\n        return result\n      },\n      calls: () => calls\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IBytesApi>({ spawn: true })\n  try {\n    const bytes = new Uint8Array([7, 8, 9])\n    const result = await worker.request('inspect', bytes.buffer)\n    console.log(result.length, result.first)\n    console.log(bytes.byteLength, bytes[0])\n    try {\n      await worker.request('inspect', bytes.buffer, { transfer: [bytes.buffer] })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      if (failure.code !== 'CAPABILITY_UNSUPPORTED') throw error\n      console.log(failure.code)\n    }\n    console.log(bytes.byteLength, await worker.request('calls'))\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IBytesApi = {\n  inspect(buffer: ArrayBuffer): { length: number; first: number }\n  calls(): number\n}\nif (await isThreadChild()) {\n  let calls = 0\n  await createThreadPeer({\n    provide: {\n      inspect: (buffer: ArrayBuffer) => {\n        calls++\n        const bytes = new Uint8Array(buffer)\n        const result = { length: buffer.byteLength, first: bytes[0]! }\n        bytes[0] = 99\n        return result\n      },\n      calls: () => calls\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IBytesApi>({ spawn: true })\n  try {\n    const bytes = new Uint8Array([7, 8, 9])\n    const result = await worker.request('inspect', bytes.buffer)\n    console.log(result.length, result.first)\n    console.log(bytes.byteLength, bytes[0])\n    try {\n      await worker.request('inspect', bytes.buffer, { transfer: [bytes.buffer] })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      if (failure.code !== 'CAPABILITY_UNSUPPORTED') throw error\n      console.log(failure.code)\n    }\n    console.log(bytes.byteLength, await worker.request('calls'))\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: "Output is `3 7`, `3 7`, `CAPABILITY_UNSUPPORTED`, then `3 1`: the Worker changed only its copy, and rejected transfer neither detached the original nor invoked it again.\n\nSigned RPC transfer requires both endpoints' real authentication configuration and negotiated native capabilities; this example intentionally leaves it disabled.",
        zh: '输出依次为 `3 7`、`3 7`、`CAPABILITY_UNSUPPORTED`、`3 1`：Worker 只修改了副本，被拒绝的转移既未让原存储失效，也未再次调用提供方。\n\n已签名的 RPC 转移需要双方真实认证配置及协商后的原生能力；此例有意保留默认禁用状态。'
      }
    },
    {
      title: {
        en: 'Fail a stuck call at its deadline or cancel it midway',
        zh: '调用卡住时按期限失败，或中途取消'
      },
      problem: {
        en: 'The main thread hands report rendering to a Worker. One input is too large and the Worker never finishes, or the user has already pressed "Cancel" and no longer needs the result.\n\nA typical `postMessage` wrapper resolves only when a reply arrives. If the Worker gets stuck, that Promise stays pending forever. For a timeout you wrap it again in `Promise.race` and must remember to delete the entry from your callback table when time runs out. For cancellation you design another "cancel" message and teach the Worker to recognize it.\n\nHere every `request` has a 30-second deadline by default, which `timeoutMs` overrides per call, and passing an `AbortSignal` cancels it. Both reject the call with a native error that carries a `code`.',
        zh: '主线程把报表渲染交给 Worker。某次输入太大，Worker 一直算不完；或者用户已经点了“取消”，结果不再需要。\n\n常见的 `postMessage` 封装只在结果回来时 resolve。Worker 卡住，这个 Promise 就永远 pending。想要超时，只能自己用 `Promise.race` 再包一层，到期后还得记得删掉回调表里的那一项；想要取消，还得另外设计一种“取消”消息，并让 Worker 认得它。\n\n这里每次 `request` 默认有 30 秒期限，也可以用 `timeoutMs` 单独设置；传入 `AbortSignal` 就能取消。到期和取消都会让调用以带 `code` 的原生错误拒绝。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IReportApi = { render(pages: number): Promise<string> }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      render: (pages: number) =>\n        new Promise<string>((resolve) => setTimeout(() => resolve(`${pages} pages`), pages * 20))\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IReportApi>({ spawn: true })\n  try {\n    console.log(await worker.request('render', 2))\n    try {\n      await worker.request('render', 500, { timeoutMs: 100 })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.name, failure.code)\n    }\n    const controller = new AbortController()\n    setTimeout(() => controller.abort(), 50)\n    try {\n      await worker.request('render', 500, { signal: controller.signal })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.name, failure.code)\n    }\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IReportApi = { render(pages: number): Promise<string> }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      render: (pages: number) =>\n        new Promise<string>((resolve) => setTimeout(() => resolve(`${pages} pages`), pages * 20))\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IReportApi>({ spawn: true })\n  try {\n    console.log(await worker.request('render', 2))\n    try {\n      await worker.request('render', 500, { timeoutMs: 100 })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.name, failure.code)\n    }\n    const controller = new AbortController()\n    setTimeout(() => controller.abort(), 50)\n    try {\n      await worker.request('render', 500, { signal: controller.signal })\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.name, failure.code)\n    }\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: "Output is `2 pages`, `TimeoutError DEADLINE_EXCEEDED`, then `AbortError CANCELLED`: the normal call returns as usual. The call that runs out of time rejects with `TimeoutError`, the cancelled call with `AbortError`, and both carry a `code` you can branch on.\n\nA deadline or cancellation only ends the caller's wait. It does not interrupt a function that has already started in the Worker; that function runs to completion and keeps its concurrency slot until then. So neither a timeout nor a cancellation proves the Worker did nothing, and a non-idempotent operation must be reconciled before it is retried. To stop the computation right away, close or restart the Worker.",
        zh: '输出为 `2 pages`、`TimeoutError DEADLINE_EXCEEDED`、`AbortError CANCELLED`：正常的调用照常返回；超时的调用以 `TimeoutError` 拒绝，取消的调用以 `AbortError` 拒绝，两者都带有可以用来分支的 `code`。\n\n期限和取消只结束调用方的等待，不会强行中断 Worker 里已经开始执行的函数，函数会继续运行到结束，并一直占用并发名额。所以超时或取消都不能证明 Worker 没有执行；非幂等操作重试前要先对账。需要立刻停下计算时，关闭或重启 Worker。'
      }
    },
    {
      title: {
        en: 'Fail in-flight calls at once when the Worker crashes',
        zh: 'Worker 崩溃时，进行中的调用立即失败'
      },
      problem: {
        en: 'A Worker crashes while converting a file, for example because a native module fails and the thread exits.\n\nA typical wrapper keeps each call\'s resolve and reject in a table and looks them up by id when the Worker replies. Once the Worker exits, no reply ever comes, and every call in that table stays pending forever. Unless you also listen for the `exit` event and walk the table to reject each call yourself, callers wait indefinitely.\n\nHere, when the connection drops, every unfinished call rejects immediately with `REMOTE_RESULT_UNKNOWN`. The code means "result unknown": the Worker may have done part of the work, so the caller decides whether to reconcile or retry.',
        zh: 'Worker 正在转换文件时崩溃了，例如原生模块出错，线程直接退出。\n\n常见封装把每个调用的 resolve 和 reject 存在一张表里，等 Worker 回消息时按编号取出。Worker 一旦退出，就再也不会有回复，表里所有调用都永远 pending。除非你另外监听 `exit` 事件，自己遍历这张表逐个拒绝，否则调用方会一直等下去。\n\n这里连接断开时，所有还没完成的调用立即以 `REMOTE_RESULT_UNKNOWN` 拒绝。这个 code 的意思是“结果未知”：Worker 可能已经执行了一部分，调用方据此决定是先对账还是重试。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IJobApi = { convert(file: string): Promise<string>; crash(): void }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      convert: (file: string) =>\n        new Promise<string>((resolve) => setTimeout(() => resolve(file + '.pdf'), 5_000)),\n      crash: () => process.exit(1)\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IJobApi>({\n    spawn: { entry: true, supervisor: { restart: { mode: 'never' } } }\n  })\n  try {\n    const started = performance.now()\n    const converting = worker.request('convert', 'invoice.docx')\n    void worker.notify('crash')\n    try {\n      await converting\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.code)\n      console.log(performance.now() - started < 1_000)\n    }\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IJobApi = { convert(file: string): Promise<string>; crash(): void }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      convert: (file: string) =>\n        new Promise<string>((resolve) => setTimeout(() => resolve(file + '.pdf'), 5_000)),\n      crash: () => process.exit(1)\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IJobApi>({\n    spawn: { entry: true, supervisor: { restart: { mode: 'never' } } }\n  })\n  try {\n    const started = performance.now()\n    const converting = worker.request('convert', 'invoice.docx')\n    void worker.notify('crash')\n    try {\n      await converting\n    } catch (error) {\n      const failure = error as Error & { code?: string }\n      console.log(failure.code)\n      console.log(performance.now() - started < 1_000)\n    }\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: 'Output is `REMOTE_RESULT_UNKNOWN`, then `true`: the conversion call rejects with `REMOTE_RESULT_UNKNOWN` less than a second after the Worker exits. It neither waits the full 5 seconds nor hangs forever.\n\nThe rejection only says the result is unknown; it does not say the Worker did nothing, so reconcile a non-idempotent operation before retrying it. Whether the Worker restarts after a crash is set by `supervisor.restart`; this example turns restarts off.',
        zh: '输出为 `REMOTE_RESULT_UNKNOWN`、`true`：转换调用在 Worker 退出后不到 1 秒就以 `REMOTE_RESULT_UNKNOWN` 拒绝，既没有等满 5 秒，也没有永远等下去。\n\n这个拒绝只说明结果未知，不说明 Worker 没有执行；非幂等操作重试前要先对账。崩溃后是否重启由 `supervisor.restart` 决定，本例关闭了重启。'
      }
    },
    {
      title: {
        en: 'Get the error class, code and cause back from the Worker',
        zh: '错误类名、code 和 cause 跨 Worker 原样返回'
      },
      problem: {
        en: 'Order validation inside a Worker fails and throws a custom `OrderError`. It carries a `code`, and its `cause` holds the original `RangeError` behind the failure.\n\n`postMessage` moves data by structured cloning. After cloning, built-in error types and `message` survive, but a custom error class turns into a plain `Error` and loses its name, and custom fields such as `code` are dropped. The main thread then has nothing to branch on.\n\nHere an error coming back from a Worker keeps its class name, `message`, `code` and `cause` chain. The caller branches on `code` and follows `cause` exactly as it would for a local error.',
        zh: 'Worker 里的下单校验失败，抛出自定义的 `OrderError`。它带有 `code`，`cause` 上是导致失败的原始 `RangeError`。\n\n`postMessage` 靠结构化克隆传递数据。错误经过克隆后，内置错误类型和 `message` 能保留，但自定义错误类会变成普通的 `Error`，类名丢失，`code` 这类自定义字段会被直接丢掉。主线程想按 `code` 分支处理时，就拿不到依据。\n\n这里错误跨 Worker 返回时，保留类名、`message`、`code` 和 `cause` 链。调用方可以像处理本地错误一样按 `code` 分支，并沿着 `cause` 找到原因。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\nclass OrderError extends Error {\n  readonly code = 'ORDER_INVALID'\n  constructor(message: string, options?: ErrorOptions) {\n    super(message, options)\n    this.name = 'OrderError'\n  }\n}\n\ntype IOrderApi = { place(quantity: number): string }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      place: (quantity: number) => {\n        if (quantity <= 0)\n          throw new OrderError('order rejected', {\n            cause: new RangeError('quantity must be positive')\n          })\n        return 'placed'\n      }\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IOrderApi>({ spawn: true })\n  try {\n    await worker.request('place', 0)\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    console.log(failure.name, failure.code, failure.message)\n    console.log(failure.cause instanceof RangeError, (failure.cause as Error).message)\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\nclass OrderError extends Error {\n  readonly code = 'ORDER_INVALID'\n  constructor(message: string, options?: ErrorOptions) {\n    super(message, options)\n    this.name = 'OrderError'\n  }\n}\n\ntype IOrderApi = { place(quantity: number): string }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      place: (quantity: number) => {\n        if (quantity <= 0)\n          throw new OrderError('order rejected', {\n            cause: new RangeError('quantity must be positive')\n          })\n        return 'placed'\n      }\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IOrderApi>({ spawn: true })\n  try {\n    await worker.request('place', 0)\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    console.log(failure.name, failure.code, failure.message)\n    console.log(failure.cause instanceof RangeError, (failure.cause as Error).message)\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: "Output is `OrderError ORDER_INVALID order rejected`, then `true quantity must be positive`: the class name, `code` and `message` are restored, and `cause` is still a `RangeError` with its original message.\n\nWhat comes back is the error's name and fields, not the same object: the error the main thread receives is not an `OrderError` instance. Branch on `code`; do not rely on `instanceof` with a custom class or on matching `message` text.",
        zh: '输出为 `OrderError ORDER_INVALID order rejected`、`true quantity must be positive`：类名、`code` 和 `message` 都还原了，`cause` 仍是一个 `RangeError`，消息也没变。\n\n还原的是错误的类名和字段，不是同一个对象：主线程拿到的错误不是 `OrderError` 的实例。请按 `code` 分支，不要依赖 `instanceof` 自定义类，也不要匹配 `message` 文本。'
      }
    },
    {
      title: {
        en: "Reject calls beyond the Worker's limit instead of queueing them",
        zh: 'Worker 忙不过来时直接拒绝超额调用'
      },
      problem: {
        en: 'During an upload peak, the main thread sends a burst of image resize requests to a Worker.\n\nA typical wrapper posts every request straight to the Worker, where messages queue without limit. When the Worker cannot keep up, requests pile up, every call waits longer, memory grows, and the caller cannot tell that the Worker is overloaded.\n\nHere the number of calls a provider runs at the same time is capped, by default 64 per peer and 256 overall, and `providerLimits` adjusts both. A call over the cap rejects at once with `OVERLOADED` and the provider function does not run, so the caller can degrade, throttle or retry later right away.',
        zh: '图片上传高峰时，主线程在很短时间内向 Worker 发出大量缩放请求。\n\n常见封装把每个请求都直接 `postMessage` 给 Worker，消息在 Worker 的队列里排队，没有上限。Worker 处理不过来时，请求越积越多，每个调用等得越来越久，内存也跟着上涨，调用方却看不出 Worker 已经过载。\n\n这里提供方同时执行的调用数有上限，默认每个对端 64 个、全局 256 个，可以用 `providerLimits` 调整。超出上限的调用立即以 `OVERLOADED` 拒绝，提供方函数不会执行，调用方可以马上降级、限流或稍后重试。'
      },
      example: {
        en: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IResizeApi = { resize(id: number): Promise<number>; started(): number }\nif (await isThreadChild()) {\n  let started = 0\n  await createThreadPeer({\n    providerLimits: { maxPerPeer: 2 },\n    provide: {\n      resize: (id: number) => {\n        started++\n        return new Promise<number>((resolve) => setTimeout(() => resolve(id), 100))\n      },\n      started: () => started\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IResizeApi>({ spawn: true })\n  try {\n    const results = await Promise.allSettled([1, 2, 3].map((id) => worker.request('resize', id)))\n    console.log(\n      results\n        .map((result) =>\n          result.status === 'fulfilled' ? result.value : (result.reason as { code?: string }).code\n        )\n        .join(' ')\n    )\n    console.log(await worker.request('started'))\n  } finally {\n    await worker.close()\n  }\n}",
        zh: "import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IResizeApi = { resize(id: number): Promise<number>; started(): number }\nif (await isThreadChild()) {\n  let started = 0\n  await createThreadPeer({\n    providerLimits: { maxPerPeer: 2 },\n    provide: {\n      resize: (id: number) => {\n        started++\n        return new Promise<number>((resolve) => setTimeout(() => resolve(id), 100))\n      },\n      started: () => started\n    }\n  })\n} else {\n  const worker = await createThreadPeer<IResizeApi>({ spawn: true })\n  try {\n    const results = await Promise.allSettled([1, 2, 3].map((id) => worker.request('resize', id)))\n    console.log(\n      results\n        .map((result) =>\n          result.status === 'fulfilled' ? result.value : (result.reason as { code?: string }).code\n        )\n        .join(' ')\n    )\n    console.log(await worker.request('started'))\n  } finally {\n    await worker.close()\n  }\n}"
      },
      result: {
        en: 'Output is `1 2 OVERLOADED`, then `2`: the first two calls complete, the third is rejected at once, and the provider ran only twice.\n\nThe cap limits how many calls run at the same time, not how long a queue grows. A function that has timed out or been cancelled but is still running in the Worker keeps its slot. `OVERLOADED` guarantees the provider did not run, so the call is safe to retry.',
        zh: '输出为 `1 2 OVERLOADED`、`2`：前两个调用正常完成，第三个立即被拒绝，提供方只执行了两次。\n\n上限限制的是同时执行的数量，不是排队长度。已经超时或取消、但仍在 Worker 里运行的函数也占用名额。`OVERLOADED` 保证提供方没有执行，可以放心重试。'
      }
    }
  ],
  createThreadPlugin: [
    {
      title: {
        en: 'Call a restarted Worker as soon as its Host reports ready',
        zh: 'Host 报告重启就绪后立即调用新 Worker'
      },
      problem: {
        en: 'A Host restarts a Worker, and the next request must reach the fresh generation rather than a retired instance.\n\nA native restart result alone may not mean an application directory has rebound; adding arbitrary delays obscures that boundary.\n\nInstall a named thread plugin in a real Host, await its restart result, and immediately call its counter again without a sleep.',
        zh: 'Host 重启 Worker 后，下一次请求需要到达新代次，而不是已经退役的实例。\n\n只收到原生重启结果，并不一定说明应用目录已更新；随意增加延时，又会掩盖真正的就绪边界。\n\n把带名称的线程插件安装到真实 Host，等待出口的重启结果后立刻再次读取计数器，不插入固定等待。'
      },
      example: {
        en: "import { defineHost } from '@migaia/plugin-host'\nimport { createThreadPeer, createThreadPlugin, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { next(): number }\nif (await isThreadChild()) {\n  let count = 0\n  await createThreadPeer({ provide: { next: () => ++count } })\n} else {\n  const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({\n    name: 'worker',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(worker)\n    console.log(await host.thread!.request('worker', 'next'))\n    const restarted = await host.thread!.restart('worker')\n    console.log(restarted.state)\n    console.log(await host.thread!.request('worker', 'next'))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}",
        zh: "import { defineHost } from '@migaia/plugin-host'\nimport { createThreadPeer, createThreadPlugin, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { next(): number }\nif (await isThreadChild()) {\n  let count = 0\n  await createThreadPeer({ provide: { next: () => ++count } })\n} else {\n  const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({\n    name: 'worker',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(worker)\n    console.log(await host.thread!.request('worker', 'next'))\n    const restarted = await host.thread!.restart('worker')\n    console.log(restarted.state)\n    console.log(await host.thread!.request('worker', 'next'))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}"
      },
      result: {
        en: "Output is `1`, `ready`, `1`, then `true`: the fresh Worker starts its counter again, accepts an immediate call, and Host cleanup completes.\n\nThe Host owns the installed Worker; both required execution budgets are explicitly false for no deadline, and restart does not migrate the old Worker's in-memory state.",
        zh: '输出为 `1`、`ready`、`1`、`true`：新 Worker 的计数器重新开始，能够立即接收调用，Host 清理也已完成。\n\nHost 拥有安装后的 Worker；两个必填执行预算显式设为 `false`，表示不设期限；重启不会迁移旧 Worker 的内存状态。'
      }
    }
  ],
  createNodeThreadChannel: [
    {
      title: {
        en: 'Close a borrowed channel while keeping its native port usable',
        zh: '关闭借用通道后继续使用原生端口'
      },
      problem: {
        en: "A component stops using an existing MessagePort, but its caller still owns that physical port.\n\nUnconditionally closing the port during adapter cleanup can break the caller's remaining protocol or another explicitly managed use.\n\nConstruct a fixed-profile Node channel, release its subscription and shared close result, then send a native message through the same held port.",
        zh: '组件停止使用已有 MessagePort 时，调用方仍可能拥有这个物理端口。\n\n适配器清理时直接关闭原生端口，会破坏调用方剩余的协议或其他显式管理的用途。\n\n创建固定基础配置的 Node 通道，释放订阅并等待共享关闭结果，再用同一个原生端口发送消息。'
      },
      example: {
        en: "import { once } from 'node:events'\nimport { MessageChannel } from 'node:worker_threads'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst { port1, port2 } = new MessageChannel()\nconst channel = createNodeThreadChannel(port1, 'remote', { scheduler: systemScheduler })\ntry {\n  const off = channel.transport.subscribe(() => undefined)\n  console.log(channel.agreement.source, channel.scheduler === systemScheduler)\n  off()\n  const closing = channel.close()\n  console.log(closing === channel.close())\n  await closing\n  const received = once(port2, 'message')\n  port1.postMessage('still open')\n  console.log((await received)[0])\n} finally {\n  await channel.close()\n  port1.close()\n  port2.close()\n}",
        zh: "import { once } from 'node:events'\nimport { MessageChannel } from 'node:worker_threads'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst { port1, port2 } = new MessageChannel()\nconst channel = createNodeThreadChannel(port1, 'remote', { scheduler: systemScheduler })\ntry {\n  const off = channel.transport.subscribe(() => undefined)\n  console.log(channel.agreement.source, channel.scheduler === systemScheduler)\n  off()\n  const closing = channel.close()\n  console.log(closing === channel.close())\n  await closing\n  const received = once(port2, 'message')\n  port1.postMessage('端口仍可用')\n  console.log((await received)[0])\n} finally {\n  await channel.close()\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: 'Output is `static true`, `true`, then `still open`: fixed construction preserves the scheduler, close shares its Promise, and the native port still delivers afterward.\n\nThis is a borrowed low-level channel, not a spawned Worker owner; the caller finally closes both ports, and omitted capabilities do not perform runtime-extension ACK.',
        zh: '输出为 `static true`、`true`、`端口仍可用`：固定配置保留调度器，关闭复用同一个 Promise，原生端口之后仍能交付消息。\n\n这是借用的底层通道，并非拥有 Worker 的启动所有者；最后仍由调用方关闭两个端口，省略 capabilities 不执行运行时扩展能力的双边确认。'
      }
    },
    {
      title: {
        en: 'Retain captured bytes across a real native transfer and observer replacement',
        zh: '真实原生转移后保留捕获字节并替换观察回调'
      },
      problem: {
        en: "A diagnostics tool must retain transferred bytes even after native sending detaches the caller's original buffer.\n\nKeeping only the detached reference loses those bytes, while an old unsubscribe can accidentally remove a replacement observer if generations are not distinguished.\n\nObserve the actual Node carrier, replace its observer, invoke the old disposer, and transfer through two real MessagePorts before stopping the current observer.",
        zh: '诊断工具需要保留转移的字节，即使原生发送已经让调用方的原始 buffer 失效。\n\n只保留失效后的引用，就会丢掉字节；若不区分代次，旧退订函数还可能错误移除新的观察回调。\n\n观察真实 Node 载体，替换回调后执行旧 disposer，再通过两个真实 MessagePort 转移字节，最后停止当前观察回调。'
      },
      example: {
        en: "import { MessageChannel } from 'node:worker_threads'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst { port1, port2 } = new MessageChannel()\nconst left = createNodeThreadChannel(port1, 'right', { scheduler: systemScheduler })\nconst right = createNodeThreadChannel(port2, 'left', { scheduler: systemScheduler })\nconst captures: unknown[] = []\nlet staleCalls = 0\nconst stale = left.transport.observe!({\n  capturing: false,\n  emit: () => {\n    staleCalls++\n  }\n})\nconst stop = left.transport.observe!({\n  capturing: true,\n  emit(_direction, _size, _carrier, _detail, content) {\n    captures.push(content)\n  }\n})\nstale()\nlet off: () => void = () => undefined\ntry {\n  const received = new Promise<ArrayBuffer>((resolve) => {\n    off = right.transport.subscribe((message) => {\n      resolve(message.data as ArrayBuffer)\n    })\n  })\n  const buffer = new Uint8Array([7, 9]).buffer\n  left.transport.send(buffer, { transfer: [buffer] })\n  console.log(buffer.byteLength)\n  console.log(new Uint8Array(await received).join(','))\n  console.log(new Uint8Array(captures[0] as ArrayBuffer).join(','))\n  console.log(staleCalls, captures.length)\n  off()\n  stop()\n  const next = new Promise<unknown>((resolve) => {\n    off = right.transport.subscribe((message) => {\n      resolve(message.data)\n    })\n  })\n  left.transport.send(42)\n  console.log(await next, captures.length)\n} finally {\n  off()\n  stop()\n  await left.close()\n  await right.close()\n  port1.close()\n  port2.close()\n}",
        zh: "import { MessageChannel } from 'node:worker_threads'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst { port1, port2 } = new MessageChannel()\nconst left = createNodeThreadChannel(port1, 'right', { scheduler: systemScheduler })\nconst right = createNodeThreadChannel(port2, 'left', { scheduler: systemScheduler })\nconst captures: unknown[] = []\nlet staleCalls = 0\nconst stale = left.transport.observe!({\n  capturing: false,\n  emit: () => {\n    staleCalls++\n  }\n})\nconst stop = left.transport.observe!({\n  capturing: true,\n  emit(_direction, _size, _carrier, _detail, content) {\n    captures.push(content)\n  }\n})\nstale()\nlet off: () => void = () => undefined\ntry {\n  const received = new Promise<ArrayBuffer>((resolve) => {\n    off = right.transport.subscribe((message) => {\n      resolve(message.data as ArrayBuffer)\n    })\n  })\n  const buffer = new Uint8Array([7, 9]).buffer\n  left.transport.send(buffer, { transfer: [buffer] })\n  console.log(buffer.byteLength)\n  console.log(new Uint8Array(await received).join(','))\n  console.log(new Uint8Array(captures[0] as ArrayBuffer).join(','))\n  console.log(staleCalls, captures.length)\n  off()\n  stop()\n  const next = new Promise<unknown>((resolve) => {\n    off = right.transport.subscribe((message) => {\n      resolve(message.data)\n    })\n  })\n  left.transport.send(42)\n  console.log(await next, captures.length)\n} finally {\n  off()\n  stop()\n  await left.close()\n  await right.close()\n  port1.close()\n  port2.close()\n}"
      },
      result: {
        en: 'Output is `0`, `7,9`, `7,9`, `0 1`, then `42 1`: storage detaches, delivery and captured bytes agree, the old disposer leaves the new observer active, and stopping it prevents another capture.\n\nThis is physical carrier transfer, not signed RPC admission; captured transferred bytes require a copy, and no end-to-end allocation or speed claim follows.',
        zh: '输出依次为 `0`、`7,9`、`7,9`、`0 1`、`42 1`：原存储失效，实际接收与捕获字节一致，旧 disposer 不移除新观察回调，停止后不再捕获下一条消息。\n\n这证明物理载体转移，不代表已签名的 RPC 准入；捕获已转移字节需要复制，不能据此声称全链路没有分配或速度更快。'
      }
    }
  ]
}
