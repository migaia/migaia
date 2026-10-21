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
