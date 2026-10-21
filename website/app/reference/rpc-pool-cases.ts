import type { ICaseDoc } from './contract.js'

/** Native Thread/Process Peer tasks; resize is documented on its public controls member. */
export const rpcPoolCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createThreadPool: [
    {
      title: {
        en: 'Distribute calls over independent native Workers',
        zh: '把调用分配给独立的原生 Worker'
      },
      problem: {
        en: 'Independent jobs need more than one Worker, but callers should not select a thread or repeat its startup logic for every request.\n\nA single shared client can serialize work unintentionally; creating a Worker per call repeatedly acquires resources and loses a stable capacity limit.\n\nCreate a Thread pool with size 2 and provide methods through the real ThreadPeer child branch. Two sequential identity calls demonstrate rotation between idle members; pool stats describe client slots, not provider concurrency.',
        zh: '独立任务需要多个 Worker，调用方却不想每次选择线程或重复执行启动逻辑。\n\n所有工作共用一个客户端可能意外串行；每次调用都新建 Worker，又会反复取得资源，并失去固定容量限制。\n\n用 `createThreadPool` 建立两个成员，在真实 `ThreadPeer` 子线程分支提供方法；顺序读取两次身份可核对空闲成员轮转，统计值描述客户端操作槽，不是远端计算并发。'
      },
      example: {
        en: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\nimport { threadId } from 'node:worker_threads'\n\ntype IWorkerApi = { identity(): { pid: number; threadId: number } }\nif (await isThreadChild()) {\n  await createThreadPeer({ provide: { identity: () => ({ pid: process.pid, threadId }) } })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 2 })\n  try {\n    const first = await pool.request('identity')\n    const second = await pool.request('identity')\n    console.log('workers:', first.threadId !== second.threadId)\n    console.log('process:', first.pid === process.pid, second.pid === process.pid)\n    const stats = pool.stats()\n    console.log(\n      'pool:',\n      stats.targetSize,\n      stats.memberCount,\n      stats.inFlight,\n      stats.queued,\n      stats.state\n    )\n  } finally {\n    await pool.close()\n  }\n}",
        zh: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\nimport { threadId } from 'node:worker_threads'\n\ntype IWorkerApi = { identity(): { pid: number; threadId: number } }\nif (await isThreadChild()) {\n  await createThreadPeer({ provide: { identity: () => ({ pid: process.pid, threadId }) } })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 2 })\n  try {\n    const first = await pool.request('identity')\n    const second = await pool.request('identity')\n    console.log('工作线程：', first.threadId !== second.threadId)\n    console.log('所在进程：', first.pid === process.pid, second.pid === process.pid)\n    const stats = pool.stats()\n    console.log(\n      '池状态：',\n      stats.targetSize,\n      stats.memberCount,\n      stats.inFlight,\n      stats.queued,\n      stats.state\n    )\n  } finally {\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `workers: true`, `process: true true`, then `pool: 2 2 0 0 open`: two different native threads share the parent process and return to idle slots.\n\nsize is required; maxQueue defaults to 256, idleTimeoutMs to undefined, and scheduler to systemScheduler. The original Peer owns startup, wire calls and supervision; the pool does not add another native recovery mechanism.',
        zh: '依次输出 `工作线程： true`、`所在进程： true true`、`池状态： 2 2 0 0 open`：两个不同的原生线程共享父进程，调用完成后操作槽恢复空闲。\n\n`size` 必填，`maxQueue` 默认 `256`，`idleTimeoutMs` 默认 `undefined`，`scheduler` 默认 `systemScheduler`；启动、通信和监督仍归原 Peer，池不再增加一套原生恢复机制。'
      }
    },
    {
      title: {
        en: 'Bound waiting work and cancel one queued call',
        zh: '限制等待任务并取消其中一项'
      },
      problem: {
        en: "All member slots are occupied, more calls arrive, and one queued request is no longer needed.\n\nAn unbounded pending list keeps obsolete work alive; cancelling a request without removing its exact queue entry can leave capacity occupied or remove another caller's work.\n\nHold the sole client slot with a real stream, set maxQueue to 1, then cancel the queued request with its own signal. A further call is rejected before dispatch, and returning the stream releases the active slot.",
        zh: '成员槽已经占满，新调用还在继续进入，其中一项排队请求也已不再需要。\n\n无界等待列表会继续保留过时工作；取消时若没有移除对应的队列项，可能占着等待容量，或误删其他调用方的任务。\n\n用真实流持有唯一客户端槽，把 `maxQueue` 设为 `1`，再用请求自己的信号取消排队项；额外调用在派发前被拒绝，归还流后才释放活跃槽。'
      },
      example: {
        en: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { values(): AsyncIterableIterator<number>; echo(value: number): number }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      },\n      echo: (value: number) => value\n    }\n  })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1, maxQueue: 1 })\n  const stream = pool.stream('values')\n  try {\n    console.log('lazy:', pool.stats().inFlight)\n    await stream.next()\n    const controller = new AbortController()\n    const queued = pool\n      .request('echo', 7, { signal: controller.signal })\n      .catch((error: unknown) => error)\n    const overflow = await pool.request('echo', 9).catch((error: unknown) => error)\n    console.log(\n      'capacity:',\n      pool.stats().inFlight,\n      pool.stats().queued,\n      (overflow as { code?: string }).code\n    )\n    const reason = new Error('Queued request is no longer needed')\n    controller.abort(reason)\n    const failure = (await queued) as Error & { code?: string }\n    console.log('cancelled:', failure.name, failure.code, failure.cause === reason)\n    console.log('waiting:', pool.stats().queued)\n    await stream.return?.()\n    console.log('released:', pool.stats().inFlight)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}",
        zh: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { values(): AsyncIterableIterator<number>; echo(value: number): number }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      },\n      echo: (value: number) => value\n    }\n  })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1, maxQueue: 1 })\n  const stream = pool.stream('values')\n  try {\n    console.log('尚未读取：', pool.stats().inFlight)\n    await stream.next()\n    const controller = new AbortController()\n    const queued = pool\n      .request('echo', 7, { signal: controller.signal })\n      .catch((error: unknown) => error)\n    const overflow = await pool.request('echo', 9).catch((error: unknown) => error)\n    console.log(\n      '容量：',\n      pool.stats().inFlight,\n      pool.stats().queued,\n      (overflow as { code?: string }).code\n    )\n    const reason = new Error('已不再需要排队请求')\n    controller.abort(reason)\n    const failure = (await queued) as Error & { code?: string }\n    console.log('已取消：', failure.name, failure.code, failure.cause === reason)\n    console.log('等待项：', pool.stats().queued)\n    await stream.return?.()\n    console.log('已释放：', pool.stats().inFlight)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `lazy: 0`, `capacity: 1 1 QUEUE_FULL`, `cancelled: AbortError CALL_ABORTED true`, `waiting: 0`, then `released: 0`.\n\nThe cancellation belongs to pool waiting and preserves the exact reason on cause. After dispatch, cancellation belongs to the original Peer. maxQueue defaults to 256; zero forbids waiting. Stream creation is lazy, but first next holds a slot until completion or return.',
        zh: '依次输出 `尚未读取： 0`、`容量： 1 1 QUEUE_FULL`、`已取消： AbortError CALL_ABORTED true`、`等待项： 0`、`已释放： 0`。\n\n本次取消发生在池队列中，`cause` 保留同一个原始原因；已经派发的取消归原 Peer。`maxQueue` 默认 `256`，设为 `0` 禁止等待；创建流不占槽，首次读取后直到完成或归还才释放。'
      }
    }
  ],
  resize: [
    {
      title: {
        en: 'Shrink idle capacity without cutting an active stream',
        zh: '缩减空闲容量而不中断在用的流'
      },
      problem: {
        en: 'The configured capacity needs to decrease while one member is still serving a stream.\n\nClosing arbitrary members can interrupt accepted work; merely changing a number can leave unwanted native Workers alive indefinitely.\n\nAwait resize to grow or shrink the real pool. Shrinking prefers idle members and waits for their original Peer cleanup; the retained busy member continues its stream, and returning that stream releases its client slot.',
        zh: '一条流仍在使用某个成员，应用却需要调低池容量。\n\n任意关闭成员可能中断已经接纳的工作；只改一个容量数字，又可能一直留下不再需要的原生 Worker。\n\n等待 `resize` 完成真实扩缩容；缩容优先释放空闲成员并等待其原 Peer 清理，保留的忙成员继续提供流，归还流后才释放客户端槽。'
      },
      example: {
        en: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { values(): AsyncIterableIterator<number> }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      }\n    }\n  })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1 })\n  const stream = pool.stream('values')\n  try {\n    await pool.resize(2)\n    console.log('grown:', pool.stats().targetSize, pool.stats().memberCount)\n    console.log('first:', (await stream.next()).value)\n    await pool.resize(1)\n    console.log('shrunk:', pool.stats().targetSize, pool.stats().memberCount, pool.stats().inFlight)\n    console.log('continued:', (await stream.next()).value)\n    await stream.return?.()\n    console.log('released:', pool.stats().inFlight)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}",
        zh: "import { createThreadPool } from '@migaia/rpc-pool'\nimport { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'\n\ntype IWorkerApi = { values(): AsyncIterableIterator<number> }\nif (await isThreadChild()) {\n  await createThreadPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      }\n    }\n  })\n} else {\n  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1 })\n  const stream = pool.stream('values')\n  try {\n    await pool.resize(2)\n    console.log('扩容：', pool.stats().targetSize, pool.stats().memberCount)\n    console.log('第一项：', (await stream.next()).value)\n    await pool.resize(1)\n    console.log('缩容：', pool.stats().targetSize, pool.stats().memberCount, pool.stats().inFlight)\n    console.log('继续读取：', (await stream.next()).value)\n    await stream.return?.()\n    console.log('已释放：', pool.stats().inFlight)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `grown: 2 2`, `first: 1`, `shrunk: 1 1 1`, `continued: 2`, then `released: 0`.\n\nresize requires a positive integer and has no default size. Resize operations execute in call order. If a busy member must itself retire, resize waits for its accepted operation; there is no pool-level forced interruption or added drain deadline.',
        zh: '依次输出 `扩容： 2 2`、`第一项： 1`、`缩容： 1 1 1`、`继续读取： 2`、`已释放： 0`。\n\n`resize` 必填正整数大小，没有默认值，多次调整按调用顺序执行；若必须回收忙成员，会等待它已接纳的操作结束，池不额外强行中断工作，也不添加排空期限。'
      }
    }
  ],
  createProcessPool: [
    {
      title: {
        en: 'Use real child processes for pooled business calls',
        zh: '用真实子进程处理池化业务调用'
      },
      problem: {
        en: 'Some jobs need separate processes, while callers still want the same typed request API used for ordinary Peers.\n\nTreating a Worker thread as a process does not create a separate PID; replacing native creation with a local object also cannot demonstrate process ownership.\n\nCreate a Process pool from the guarded entry and let the real ProcessPeer publish its methods. Call the business method, then query two member PIDs through the same public request path.',
        zh: '有些任务需要单独的进程，调用方又希望继续使用普通 Peer 的类型化请求接口。\n\n把 Worker 线程当成进程，并不会产生独立 PID；用本地对象代替原生创建，也无法证明进程归属。\n\n用带子进程分支的入口创建 `createProcessPool`，让真实 `ProcessPeer` 发布方法；先调用业务方法，再沿同一个公开请求路径读取两个成员的 PID。'
      },
      example: {
        en: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; identity(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: {\n      double: (value: number) => value * 2,\n      identity: () => process.pid\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 2 })\n  try {\n    console.log('result:', await pool.request('double', 21))\n    const first = await pool.request('identity')\n    const second = await pool.request('identity')\n    console.log('processes:', first !== process.pid, second !== process.pid, first !== second)\n    console.log('members:', pool.stats().memberCount)\n  } finally {\n    await pool.close()\n  }\n}",
        zh: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; identity(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: {\n      double: (value: number) => value * 2,\n      identity: () => process.pid\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 2 })\n  try {\n    console.log('结果：', await pool.request('double', 21))\n    const first = await pool.request('identity')\n    const second = await pool.request('identity')\n    console.log('子进程：', first !== process.pid, second !== process.pid, first !== second)\n    console.log('成员数：', pool.stats().memberCount)\n  } finally {\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `result: 42`, `processes: true true true`, then `members: 2`: both members have PIDs different from the parent and from each other.\n\nspawn and size are required; spawn true reruns the guarded entry. Process call options keep their original type and do not accept Thread transfer lists. These are Node 24 process results, not evidence for another runtime or OS.',
        zh: '依次输出 `结果： 42`、`子进程： true true true`、`成员数： 2`：两个成员的 PID 都不同于父进程，也彼此不同。\n\n`spawn` 和 `size` 必填，`spawn: true` 重跑带分支判断的入口；进程调用选项保留原类型，不接受线程专有的转移列表。这里是 Node 24 进程结果，不代替其他运行时或系统的验证。'
      }
    },
    {
      title: {
        en: 'Drain accepted work while rejecting new calls',
        zh: '关闭时完成已接纳工作并拒绝新调用'
      },
      problem: {
        en: 'An application starts shutdown with an active stream and a request already waiting behind it.\n\nStopping every process immediately loses accepted work; continuing to accept new calls prevents shutdown from converging.\n\nCall close to switch admission to closing and retain its shared Promise. End the active stream explicitly so the already-queued request can finish; await close before considering the owned processes released.',
        zh: '应用开始关闭时，一条流仍在使用成员，后面还排着已经接纳的请求。\n\n立即停掉所有进程会丢掉已接纳工作；继续接收新调用，又会让关闭无法收敛。\n\n调用 `close` 停止新接纳并保存其共享 Promise，显式结束活跃流，让原先排队的请求完成；等待关闭 Promise 后再确认池持有的进程已释放。'
      },
      example: {
        en: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { values(): AsyncIterableIterator<number>; double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      },\n      double: (value: number) => value * 2\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })\n  const stream = pool.stream('values')\n  try {\n    await stream.next()\n    const accepted = pool.request('double', 21)\n    const closing = pool.close()\n    console.log('closing:', pool.stats().state, closing === pool.close(), pool.stats().queued)\n    const rejected = await pool.request('double', 1).catch((error: unknown) => error)\n    console.log('new work:', (rejected as { code?: string }).code)\n    await stream.return?.()\n    console.log('accepted:', await accepted)\n    await closing\n    console.log('closed:', pool.stats().state, pool.stats().memberCount)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}",
        zh: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { values(): AsyncIterableIterator<number>; double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: {\n      values: async function* () {\n        yield 1\n        yield 2\n      },\n      double: (value: number) => value * 2\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })\n  const stream = pool.stream('values')\n  try {\n    await stream.next()\n    const accepted = pool.request('double', 21)\n    const closing = pool.close()\n    console.log('关闭中：', pool.stats().state, closing === pool.close(), pool.stats().queued)\n    const rejected = await pool.request('double', 1).catch((error: unknown) => error)\n    console.log('新任务：', (rejected as { code?: string }).code)\n    await stream.return?.()\n    console.log('已接纳：', await accepted)\n    await closing\n    console.log('已关闭：', pool.stats().state, pool.stats().memberCount)\n  } finally {\n    await stream.return?.()\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `closing: closing true 1`, `new work: POOL_CLOSED`, `accepted: 42`, then `closed: closed 0`.\n\nclose has no arguments, is stable across repeated calls, and adds no pool drain timeout. A long-lived stream can keep shutdown waiting; consume it, return it or cancel it. An unstarted stream has not acquired a slot and does not block close.',
        zh: '依次输出 `关闭中： closing true 1`、`新任务： POOL_CLOSED`、`已接纳： 42`、`已关闭： closed 0`。\n\n`close` 无参数，重复调用返回同一 Promise，不添加池级排空超时；长流可能让关闭继续等待，应消费、归还或取消它。尚未开始读取的流没有取得操作槽，不阻碍关闭。'
      }
    },
    {
      title: {
        en: 'Keep the original Peer failure without replaying the call',
        zh: '保留原 Peer 失败而不重放调用'
      },
      problem: {
        en: "A child process reports a business failure after entering the method, and retrying that method could repeat its side effects.\n\nWrapping every error with a pool code hides the original owner; silently replaying a failed operation makes one client call execute more than once.\n\nLet createProcessPool forward the original Peer rejection. Inspect the returned native TypeError and its RangeError cause, then query the actual child method's attempt count to confirm that this failed business call ran once.",
        zh: '子进程已经进入业务方法后失败，重新执行这个方法可能重复其副作用。\n\n给所有失败换上池错误码，会隐藏原来的错误归属；静默重放失败操作，又可能让一次调用执行多遍。\n\n由 `createProcessPool` 透传原 Peer 的拒绝，检查返回的原生 `TypeError` 及其 `RangeError` 原因，再查询真实子进程中的执行次数，确认这次失败业务调用只进入了一次。'
      },
      example: {
        en: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { fail(): never; attempts(): number }\nif (isProcessChild()) {\n  let attempts = 0\n  const root = new RangeError('invalid amount')\n  const failure = new TypeError('payment calculation failed', { cause: root })\n  await createProcessPeer({\n    provide: {\n      fail: () => {\n        attempts += 1\n        throw failure\n      },\n      attempts: () => attempts\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })\n  try {\n    const failure = (await pool.request('fail').catch((error: unknown) => error)) as Error & {\n      source?: string\n    }\n    const primary = failure\n    console.log('remote:', failure.name, failure.source !== RPC_POOL_ERROR_SOURCE)\n    console.log('native:', primary instanceof TypeError, primary.message)\n    console.log('cause:', primary.cause instanceof RangeError)\n    console.log('attempts:', await pool.request('attempts'))\n  } finally {\n    await pool.close()\n  }\n}",
        zh: "import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'\nimport { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { fail(): never; attempts(): number }\nif (isProcessChild()) {\n  let attempts = 0\n  const root = new RangeError('金额无效')\n  const failure = new TypeError('金额计算失败', { cause: root })\n  await createProcessPeer({\n    provide: {\n      fail: () => {\n        attempts += 1\n        throw failure\n      },\n      attempts: () => attempts\n    }\n  })\n} else {\n  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })\n  try {\n    const failure = (await pool.request('fail').catch((error: unknown) => error)) as Error & {\n      source?: string\n    }\n    const primary = failure\n    console.log('远端错误：', failure.name, failure.source !== RPC_POOL_ERROR_SOURCE)\n    console.log('原生错误：', primary instanceof TypeError, primary.message)\n    console.log('原因：', primary.cause instanceof RangeError)\n    console.log('执行次数：', await pool.request('attempts'))\n  } finally {\n    await pool.close()\n  }\n}"
      },
      result: {
        en: 'The output is `remote: TypeError true`, `native: true payment calculation failed`, `cause: true`, then `attempts: 1`.\n\nThe pool owns admission and cleanup errors, not this Peer error. This example proves no replay of the business failure; it does not simulate a process crash. Native restart policy remains with the original ProcessPeer source, and failed work is not automatically replayed by the pool.',
        zh: '依次输出 `远端错误： TypeError true`、`原生错误： true 金额计算失败`、`原因： true`、`执行次数： 1`。\n\n本例失败来自 Peer，池只给自己持有的接纳和清理失败附加池错误码；这里证明业务失败没有重放，没有模拟进程崩溃。原生重启策略仍归原 `ProcessPeer` 启动来源，池不会自动重放失败工作。'
      }
    }
  ]
}
