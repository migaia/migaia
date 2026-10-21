/**
 * Reference for `@migaia/rpc-pool`, checked against src/index.ts, types.ts, pool.ts, error.ts,
 * error-code.ts, text.ts and README on 2026-10-17. No source/document contradiction found.
 * Ownership: this package schedules client slots and FIFO waiting; original public Thread and
 * Process Peers own wire calls, native creation, transfer rules, timeouts and supervision.
 */
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText } from './contract.js'
import { runtimeSharedTypes } from './rpc-runtime-shared.js'
import { rpcPoolCases } from './rpc-pool-cases.js'

/** Creates bilingual prose without sharing fallback language. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Both native pool kinds expose the same scheduling options through their public factories. */
const poolOptionExamples = (kind: 'Thread' | 'Process') => {
  const childCheck = kind === 'Thread' ? 'await isThreadChild()' : 'isProcessChild()'
  const packageName = kind === 'Thread' ? 'rpc-threads' : 'rpc-process'
  return {
    capacity: `import { create${kind}Pool } from '@migaia/rpc-pool'
import { create${kind}Peer, is${kind}Child } from '@migaia/${packageName}'
import { defineProbe } from '@migaia/rpc-core/probe'

type IWorkerApi = { double(value: number): number }
if (${childCheck}) {
  await create${kind}Peer({ provide: { double: (value: number) => value * 2 } })
} else {
  const lifecycle: string[] = []
  const probe = defineProbe({
    stages: ['peer'],
    emit: (event) => { if (event.lifecycle) lifecycle.push(event.lifecycle) }
  })
  const pool = await create${kind}Pool<IWorkerApi>({ spawn: true, size: 2, maxQueue: 8, probe })
  try {
    console.log(await pool.request('double', 21))
    console.log(pool.stats().targetSize, pool.stats().memberCount, lifecycle.includes('ready'))
  } finally {
    await pool.close()
  }
}`,
    idle: `import { create${kind}Pool } from '@migaia/rpc-pool'
import { create${kind}Peer, is${kind}Child } from '@migaia/${packageName}'
import { createManualScheduler } from '@migaia/utils/testing'

type IWorkerApi = { identity(): string }
if (${childCheck}) {
  const identity = crypto.randomUUID()
  await create${kind}Peer({ provide: { identity: () => identity } })
} else {
  const scheduler = createManualScheduler()
  const pool = await create${kind}Pool<IWorkerApi>({
    spawn: true,
    size: 1,
    idleTimeoutMs: 1000,
    scheduler
  })
  try {
    const before = await pool.request('identity')
    scheduler.advance(1001)
    const after = await pool.request('identity')
    console.log(before !== after, pool.stats().targetSize)
  } finally {
    await pool.close()
  }
}`
  }
}

/** Shared scenarios keep the Thread and Process option sets in sync without unknown covers. */
const poolOptionCases = (kind: 'Thread' | 'Process'): readonly IOptionCaseDoc[] => {
  const examples = poolOptionExamples(kind)
  return [
    {
      title: t('Choose capacity and observe member startup', '选择容量并观察成员启动'),
      problem: t(
        'A service needs two independent members and at most eight waiting calls. size and spawn are required. maxQueue defaults to 256, and without probe member lifecycle events are not sent to this observer. The child guard lets one entry publish methods in children and create the pool only in the parent.',
        '服务需要两个独立成员，最多允许八个调用等待。size 和 spawn 必填。maxQueue 默认为 256；不传 probe 时，不会向这个观察器发送成员生命周期事件。子程序判断让同一个入口在子程序中发布方法，只在父程序中创建池。'
      ),
      example: examples.capacity,
      result: t(
        'Prints 42, then 2 2 true. Two members are acquired, and the probe has observed readiness. Waiting calls beyond eight are rejected with QUEUE_FULL.',
        '先输出 42，再输出 2 2 true。池已取得两个成员，探针已观察到就绪。超过八个等待调用时，以 QUEUE_FULL 拒绝。'
      ),
      covers: ['spawn', 'size', 'maxQueue', 'probe']
    },
    {
      title: t('Release idle members and recreate them on demand', '释放空闲成员并按需重建'),
      problem: t(
        'A bursty service should release unused members between bursts. Without idleTimeoutMs, the pool does not retire idle members. A manual scheduler demonstrates a one-second idle timeout immediately; omit scheduler in an application to use the system clock. This scheduler controls only pool idle timers.',
        '突发型服务需要在两次请求高峰之间释放闲置成员。不设 idleTimeoutMs 时，池不会回收空闲成员。手动调度器可以立即演示一秒空闲过期；应用中省略 scheduler 即使用系统时钟。这个调度器只控制池的空闲计时器。'
      ),
      example: examples.idle,
      result: t(
        'Prints true 1. Advancing idle time retires the first member; the next request runs in a new member while the target remains one.',
        '输出 true 1。推进空闲时间后，第一个成员被退役；下一次请求使用新成员，目标容量仍为一。'
      ),
      covers: ['spawn', 'size', 'idleTimeoutMs', 'scheduler']
    }
  ]
}

/** A guarded single entry can serve both the parent pool and its spawned Thread children. */
const threadExample = `import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = {
  double(value: number): number
  log(value: string): void
  count(limit: number): Generator<number>
}

if (await isThreadChild()) {
  await createThreadPeer({ provide: {
    double: (value: number) => value * 2,
    log: (value: string) => console.log(value),
    count: function* (limit: number) { for (let index = 0; index < limit; index++) yield index }
  } })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 2, maxQueue: 16 })
  try {
    console.log(await pool.request('double', 21))
    await pool.notify('log', 'started')
    for await (const value of pool.stream('count', 3)) console.log(value)
    await pool.resize(3)
    console.log(pool.stats())
  } finally {
    await pool.close()
  }
}`

/** Process peers retain their original source policy and do not accept native transfer lists. */
const processExample = `import { createProcessPool } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = {
  add(value: { a: number; b: number }): number
  log(value: string): void
  count(limit: number): Generator<number>
}

if (isProcessChild()) {
  await createProcessPeer({ provide: {
    add: (value: { a: number; b: number }) => value.a + value.b,
    log: (value: string) => console.log(value),
    count: function* (limit: number) { for (let index = 0; index < limit; index++) yield index }
  } })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 2, maxQueue: 16 })
  try {
    console.log(await pool.request('add', { a: 20, b: 22 }))
    await pool.notify('log', 'started')
    for await (const value of pool.stream('count', 3)) console.log(value)
    await pool.resize(3)
    console.log(pool.stats())
  } finally {
    await pool.close()
  }
}`

/** The pool shares one explicit lifecycle vocabulary across stats and the exported constant. */
const stateValues = {
  open: t(
    'Accepts new operations, dispatches free slots and queues accepted overflow within maxQueue.',
    '接收新操作，派发空闲槽，并在等待容量内排队接纳的溢出操作。'
  ),
  closing: t(
    'Rejects new operations while draining accepted work and closing all owned members.',
    '拒绝新操作，同时排空已接纳工作并关闭全部所属成员。'
  ),
  closed: t(
    'All member closes have been attempted; stats remains readable but no new calls are admitted.',
    '已尝试全部成员关闭，统计仍可读取但不再接纳新调用。'
  )
}

/** Only admission, waiting cancellation and pool cleanup errors use this package error identity. */
const errorValues = {
  invalidOptions: t(
    'Construction or resize input is invalid; fix the option before native member acquisition.',
    '构造或调整大小输入非法，需要在原生成员接纳前修正选项。'
  ),
  poolClosed: t(
    'A closing or closed pool rejects a new operation or resize; create a new pool for new work.',
    '关闭中或已关闭的池拒绝新操作或调整大小，新工作需要新建池。'
  ),
  queueFull: t(
    'All client slots are busy and the bounded FIFO is full; no member receives the rejected operation.',
    '全部客户端槽忙且有界先进先出队列已满，被拒操作不会发送给成员。'
  ),
  callAborted: t(
    'An operation was cancelled while waiting in the FIFO; native AbortError cause retains the exact signal reason.',
    '操作在先进先出队列中等待时取消，原生取消错误原因保留精确信号理由。'
  ),
  closeFailed: t(
    'Every member close was attempted and one or more failed; AggregateError retains errors and the first original cause.',
    '已尝试全部成员关闭且至少一个失败，聚合错误保留错误列表及首个原始原因。'
  )
}

/** Common option semantics are identical for Thread and Process scheduling. */
const commonOptions: Readonly<Record<string, IMemberDoc>> = {
  size: {
    summary: t(
      'Required positive integer target count selected by the caller. Initial construction acquires that many independent public Peers before exposing the pool.',
      '调用者指定的必填正整数目标数量，初次构造在发布池前取得相应数量的独立公开连接。'
    )
  },
  maxQueue: {
    summary: t(
      'Nonnegative integer bound on FIFO waiters, excluding operations already assigned to members. Zero rejects immediately when every slot is busy.',
      '先进先出等待者数量的非负整数上限，不包含已分配成员的操作，零表示全部槽忙时立即拒绝。'
    ),
    default: t(
      '256 waiting operations; overflow rejects QUEUE_FULL without calling a Peer.',
      '默认 `256` 个等待操作，溢出以 `QUEUE_FULL` 拒绝且不调用底层连接。'
    )
  },
  idleTimeoutMs: {
    summary: t(
      'Finite positive idle duration no greater than 2147483647 milliseconds. Retires genuinely idle members through their original close; future demand recreates missing target capacity.',
      '不超过 `2147483647` 毫秒的有限正空闲时长，经原有关闭接口退役真正空闲成员，后续需求重新创建缺失目标容量。'
    ),
    default: t(
      'undefined, disabling pool-owned idle retirement; native Peer supervision remains unchanged.',
      '默认 `undefined`，不执行池级空闲退役，原生连接监督保持原策略。'
    )
  },
  scheduler: {
    summary: t(
      'IScheduler from @migaia/utils/scheduler or a compatible injected scheduler, controlling only pool idle timers and their optional unref.',
      '来自 `@migaia/utils/scheduler` 或兼容注入实现的调度器，仅控制池空闲计时器及其可选取消宿主保活。'
    ),
    default: t(
      'systemScheduler from @migaia/utils/scheduler; Peer restart and deadline policy stays with each original spawn source.',
      '默认 `systemScheduler`，各原始启动来源仍拥有连接重启及截止时间策略。'
    )
  }
}

/** Probe handles are external types; the pool forwards rather than clones or owns them. */
const probeOption: IMemberDoc = {
  summary: t(
    'One IRpcProbe or readonly probe array from @migaia/rpc-core/probe, for example from createRpcDevtools. The exact same handle is forwarded to every public member factory; use event endpointId to distinguish members.',
    '来自核心探针包、例如采集器工厂产生的单个探针或只读探针数组，相同句柄原样传给每个公开成员工厂，按事件端点标识区分成员。'
  ),
  default: t(
    'undefined; no pool-added source probe is passed to member factories.',
    '默认 `undefined`，不向成员工厂传入池额外提供的来源探针。'
  )
}

/** Pool-owned controls reuse one exact implementation for Thread and Process members. */
const controlMembers: Readonly<Record<string, IMemberDoc>> = {
  stats: {
    summary: t(
      'Returns the current pool client-slot and FIFO snapshot, including during or after close. This does not measure provider concurrency or native worker load.',
      '返回当前池客户端槽及先进先出队列快照，关闭期间及之后也可读取，不测量提供者并发或原生工作程序负载。'
    ),
    returns: t(
      'Frozen IRpcPoolStats with target size, acquired member count, actual dispatched in-flight slots, queued waiters and pool state.',
      '返回冻结统计，包含目标大小、已取得成员数、实际派发的在途槽、排队等待者及池状态。'
    ),
    example: threadExample
  },
  resize: {
    summary: t(
      'Serializes target-size changes in call order. Expansion acquires a transactional batch; shrink retires idle members first and waits for busy retired members to finish their accepted operations.',
      '按调用顺序串行改变目标大小，扩容事务式接纳一批成员，缩容优先退役空闲成员并等待被退役忙成员完成已接纳操作。'
    ),
    params: {
      size: t(
        'New positive integer target selected by the caller; it replaces the construction target after this resize is admitted.',
        '调用者选择的新正整数目标，本次调整被接纳后替换构造目标。'
      )
    },
    returns: t(
      'Promise<void> after acquisition or retirement. Invalid size uses INVALID_OPTIONS; closure uses POOL_CLOSED. Expansion failure restores the previous target and retains the original factory failure.',
      '成员创建或退役完成后兑现 `Promise<void>`；非法大小使用 `INVALID_OPTIONS`，关闭使用 `POOL_CLOSED`，扩容失败恢复旧目标并保留原工厂失败。'
    ),
    whenToUse: t(
      'Change capacity on an existing pool. This complete Node 24 example uses a guarded Thread entry with spawn true and required size 1; maxQueue defaults to 256, idleTimeoutMs to undefined and scheduler to systemScheduler. Each resize argument is the new required positive integer target.',
      '已有池需要调整容量时使用。完整 Node 24 示例以子线程判断保护入口，设置 `spawn: true` 和必填初始 `size: 1`；`maxQueue` 默认 `256`，`idleTimeoutMs` 默认 `undefined`，`scheduler` 默认 `systemScheduler`。每次 `resize(size)` 的必填参数都是新的正整数目标。'
    ),
    example: rpcPoolCases.resize![0]!.example
  },
  close: {
    summary: t(
      'Stops new admission, drains accepted queue entries and operations, then closes every owned member once. Long streams must end, return, throw or be cancelled to release their slot before drain can finish.',
      '停止接收新操作，排空已接纳队列及操作，再将每个所属成员关闭一次，长流需结束、返回、抛错或取消释放槽后才能完成排空。'
    ),
    returns: t(
      'The same Promise<void> on repeated calls. Resolves after all member closes, or rejects with CLOSE_FAILED AggregateError retaining every original close failure and the first cause.',
      '重复调用返回同一个 `Promise<void>`；全部成员关闭后兑现，或以保留所有原始关闭失败及首个原因的 `CLOSE_FAILED` 聚合错误拒绝。'
    ),
    example: threadExample
  }
}

/** Shared Core method contracts are narrowed with this package exact scheduling semantics. */
const threadCallMembers: Readonly<Record<string, IMemberDoc>> = {
  request: {
    ...runtimeSharedTypes.IRuntimeTypedPeer!.members.request!,
    summary: t(
      'Schedules one original Thread Peer request in a single member slot. If busy it waits in the bounded FIFO; the slot remains occupied until the original result promise settles. Peer failures pass through unchanged and are never replayed.',
      '在单个成员槽调度原线程连接请求，忙时进入有界先进先出等待队列，原结果 Promise 完成后才释放槽，底层失败原样通过且不重放。'
    ),
    params: {
      method: t(
        'Dotted method path declared by the spawned Thread program provide API and checked against TRemote.',
        '由启动线程程序提供接口声明、按远端泛型检查的点分方法路径。'
      ),
      args: t(
        'Original optional payload and Thread call options, including signal, timeoutMs, idempotencyKey and supported transfer list. Values come from the application; timeouts start at Peer dispatch, not while waiting in the pool.',
        '应用提供的原始可选载荷及线程调用选项，包含信号、超时、幂等键和支持的转移列表，超时从派发给底层连接开始，不计池排队时间。'
      )
    },
    returns: t(
      'Promise of the original typed result after queued dispatch. Pool-owned admission may reject POOL_CLOSED, QUEUE_FULL or queued CALL_ABORTED; native and Peer errors keep original identity and source/code.',
      '派发后返回原类型化结果 Promise，池接纳可因关闭、队列满或排队取消拒绝，原生及底层连接错误保留原身份与来源错误码。'
    ),
    example: threadExample
  },
  notify: {
    ...runtimeSharedTypes.IRuntimeTypedPeer!.members.notify!,
    summary: t(
      'Schedules one original Thread Peer notification; a slot is released when its send promise settles, without waiting for a remote business result.',
      '调度原线程连接单向通知，发送 Promise 完成后即释放槽，不等待远端业务结果。'
    ),
    params: {
      method: t(
        'Method path in the spawned Thread provide API that accepts a one-way call.',
        '启动线程提供接口中接受单向调用的方法路径。'
      ),
      args: t(
        'Original application payload and Thread call options forwarded intact, including a caller signal and supported native transfer semantics.',
        '原样转发的应用载荷及线程调用选项，包含调用者信号与支持的原生转移语义。'
      )
    },
    returns: t(
      'Promise<void> from the original send boundary after pool scheduling; pool queue failures use its own codes and original send failures pass through.',
      '池调度后返回原发送边界的 `Promise<void>`，排队失败使用池错误码，原发送失败原样通过。'
    ),
    example: threadExample
  },
  stream: {
    ...runtimeSharedTypes.IRuntimeTypedPeer!.members.stream!,
    summary: t(
      'Returns a lazy iterator; the first next() admits a pool operation, not the stream() call. One member slot stays occupied until done, return or throw. Early termination before dispatch removes only its own waiter.',
      '返回惰性迭代器，首次推进才接纳池操作，创建流时不接纳，单个成员槽持续占用到结束、返回或抛错，派发前结束仅移除自身等待者。'
    ),
    params: {
      method: t(
        'Iterator-returning method path provided by the spawned Thread program and checked against TRemote.',
        '启动线程提供、按远端泛型检查且返回迭代源的方法路径。'
      ),
      args: t(
        'Original payload and Thread stream options, including caller signal and supported transfer data. The exact arguments reach one selected public Peer.',
        '原始载荷及线程流选项，含调用者信号与支持的转移数据，精确参数送达单个所选公开连接。'
      )
    },
    returns: t(
      'Original typed async iterator semantics behind pool admission. next() yields or rejects unchanged; return(value) and throw(error) forward original termination when available and release the slot exactly once.',
      '池接纳之后保留原类型化异步迭代语义，推进值及拒绝原样通过，可用时向原消费者转发返回值或抛出原因，并仅释放槽一次。'
    ),
    example: threadExample
  }
}

/** Process methods share scheduling but preserve the public Process prohibition on transfer. */
const processCallMembers: Readonly<Record<string, IMemberDoc>> = {
  request: {
    ...threadCallMembers.request!,
    summary: t(
      'Schedules one original Process Peer request. Queue waiting does not start the native deadline; the occupied slot is released only when the original result promise settles. Pool scheduling never retries a failed business call.',
      '调度原进程连接请求，排队不启动原截止时间，原结果 Promise 完成后才释放槽，池调度从不重试失败业务调用。'
    ),
    params: {
      method: t(
        'Dotted method path declared by the spawned Process provide API and checked against TRemote.',
        '由启动进程提供接口声明、按远端泛型检查的点分方法路径。'
      ),
      args: t(
        'Original payload and Process call options from the application, including signal, timeoutMs and idempotencyKey. Process public types prohibit native transfer lists; the pool preserves that prohibition.',
        '应用提供的原载荷及进程调用选项，含信号、超时和幂等键，进程公开类型禁止原生转移列表，池保留该限制。'
      )
    },
    example: processExample
  },
  notify: {
    ...threadCallMembers.notify!,
    summary: t(
      'Schedules one original Process Peer notification and holds its client slot until the send promise settles; no business response is awaited.',
      '调度原进程连接单向通知，发送 Promise 完成前占用客户端槽，不等待业务响应。'
    ),
    params: {
      method: t(
        'One-way method route supplied by the spawned Process provide API.',
        '启动进程提供接口声明的单向方法路由。'
      ),
      args: t(
        'Original application payload and Process options, retaining caller cancellation and the prohibition on native transfer lists.',
        '原应用载荷及进程选项，保留调用者取消与禁止原生转移列表的约束。'
      )
    },
    example: processExample
  },
  stream: {
    ...threadCallMembers.stream!,
    summary: t(
      'Creates a lazy Process stream iterator, admitting work only at first next(). The slot remains owned until the original stream finishes or termination is forwarded; never starting it does not block pool close.',
      '创建惰性进程流迭代器，首次推进才接纳，槽持续拥有到原流完成或终止已转发，未启动迭代器不会阻塞池关闭。'
    ),
    params: {
      method: t(
        'Iterator method path provided by the spawned Process program and checked against TRemote.',
        '启动进程提供、按远端泛型检查的迭代方法路径。'
      ),
      args: t(
        'Original payload and Process stream options from the application, including signal; native transfer lists remain unsupported.',
        '应用提供的原载荷及进程流选项，包含信号，不支持原生转移列表。'
      )
    },
    example: processExample
  }
}

/** Complete pool reference with shared external protocol ownership and pool-owned scheduling. */
export const rpcPoolReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Composes Thread and Process pools over their existing public Peer factories. Start with createThreadPool or createProcessPool; each member owns one client operation slot, with bounded FIFO waiting and explicit resize/close controls.',
        '在已有公开线程及进程连接工厂上组合池，从线程池或进程池工厂开始，每个成员拥有一个客户端操作槽，并提供有界先进先出等待及显式调整与关闭控制。'
      ),
      example: threadExample
    }
  },
  symbols: {
    createThreadPool: {
      role: 'factory',
      purpose: t(
        'Creates independent Thread Peers and schedules one client operation per member. The exact spawn source and probe pass to each original public factory; communication, handshake, transfer and restart remain Thread-owned. Pair the spawned entry with createThreadPeer to provide its methods.',
        '创建独立线程连接，每个成员调度一个客户端操作槽，精确启动来源与探针原样传给原公开工厂，通信、握手、转移及重启仍归线程层，启动入口通过 `createThreadPeer` 提供方法。'
      ),
      options: 'IThreadPoolOptions',
      returns: t(
        'Promise<IThreadPool<TRemote>> after all initial members are ready. Invalid pool input uses INVALID_OPTIONS; original factory failures preserve their identity, and partial acquisition closes successful members before rejecting. Caller must close the pool.',
        '全部初始成员就绪后兑现池 Promise，非法池输入使用 `INVALID_OPTIONS`，原工厂失败保留身份，部分接纳失败在拒绝前关闭成功成员，调用者必须关闭池。'
      ),
      exampleIntro: {
        en: "Run the complete .ts example with Node 24. spawn true reruns the current entry, so its child guard must surround the pool-creation branch. size is a required positive integer; maxQueue defaults to 256, idleTimeoutMs to undefined and scheduler to systemScheduler. The scheduler controls only pool idle retirement. Each accepted operation occupies one member client slot; these counts do not measure provider concurrency.\n\nInstall @migaia/rpc-core, @migaia/rpc-threads and @migaia/rpc-process directly alongside this package's required peers. await isThreadChild selects the real Worker branch, and createThreadPeer({ provide }) publishes the shown methods. The identity payload contains actual process.pid and native threadId; request method names come from provide. The queue example uses a native AbortController: the call options object is optional, signal defaults to undefined and its reason is retained if cancellation occurs while waiting. Unspecified call policies still belong to the original ThreadPeer. The resize task below uses that same public pool method.",
        zh: '用 Node 24 运行完整 `.ts` 示例；`spawn: true` 会重跑当前入口，必须用子程序判断分开发布方法与创建池。`size` 必填正整数，`maxQueue` 默认 `256`，`idleTimeoutMs` 默认 `undefined`，`scheduler` 默认 `systemScheduler`，只控制池的空闲回收；每项已接纳操作占用一个成员客户端槽，统计值不是远端计算并发。\n\n同时直接安装必需的三个 Peer 依赖 `@migaia/rpc-core`、`@migaia/rpc-threads`、`@migaia/rpc-process`；`await isThreadChild()` 选择真实 Worker 分支，`createThreadPeer({ provide })` 发布代码中的方法。身份数据来自真实 `process.pid` 与原生 `threadId`，请求方法名来自 `provide`；排队示例使用原生 `AbortController`，调用选项可省略，`signal` 默认 `undefined`，排队取消时保留其原始原因。其余调用策略仍归原 ThreadPeer，下方扩缩容任务使用同一公开池方法。'
      },
      cases: [...rpcPoolCases.createThreadPool!, ...rpcPoolCases.resize!],
      example: rpcPoolCases.createThreadPool![0]!.example,
      scenarios: [
        t(
          'Run independent CPU or worker calls across several Thread Peers without introducing another RPC protocol.',
          '跨多个线程连接运行独立计算或工作调用，无需引入另一套远程调用协议。'
        )
      ]
    },
    createProcessPool: {
      role: 'factory',
      purpose: t(
        'Creates independent Process Peers and applies pool-owned client-slot scheduling. Every member receives the original spawn source and probe; native Process runtime, wire format, permissions and restart budget remain unchanged. The spawned program uses createProcessPeer to provide its methods.',
        '创建独立进程连接并应用池拥有的客户端槽调度，每成员接收原始启动来源及探针，原生进程运行时、线格式、权限及重启预算保持原策略，启动程序通过 `createProcessPeer` 提供方法。'
      ),
      options: 'IProcessPoolOptions',
      returns: t(
        'Promise<IProcessPool<TRemote>> preserving Process public call-option types, including no native transfer lists. Invalid pool input uses INVALID_OPTIONS and original acquisition errors pass through; caller owns explicit pool close.',
        '返回池 Promise，保留进程公开调用选项类型及禁止原生转移列表的约束，非法池输入使用 `INVALID_OPTIONS`，原接纳错误原样通过，调用者负责显式关闭。'
      ),
      exampleIntro: {
        en: 'Run the complete .ts example with Node 24. spawn true reruns the current entry, so its child guard must surround the pool-creation branch. size is a required positive integer; maxQueue defaults to 256, idleTimeoutMs to undefined and scheduler to systemScheduler. The scheduler controls only pool idle retirement. Each accepted operation occupies one member client slot; these counts do not measure provider concurrency.\n\nDirectly install all three required peers: @migaia/rpc-core, @migaia/rpc-process and @migaia/rpc-threads. isProcessChild is synchronous; createProcessPeer({ provide }) publishes the shown child methods. The identity method returns its real process.pid. The stream returns two numeric values; the client must consume or return it to release its slot. Process call options retain the original API and forbid Thread transfer lists. The failure task receives the native TypeError itself with a RangeError cause, not a Worker-style outer wrapper.\n\nThe original short Process source defaults to best-effort isolation and can report a supervision CAPABILITY_UNSUPPORTED notice for unsupported process termination. This expected degradation does not turn a successful business call into failure, and it does not establish guaranteed termination of an entire process tree. The pool forwards original Peer failures and does not replay failed work.',
        zh: '用 Node 24 运行完整 `.ts` 示例；`spawn: true` 会重跑当前入口，必须用子程序判断分开发布方法与创建池。`size` 必填正整数，`maxQueue` 默认 `256`，`idleTimeoutMs` 默认 `undefined`，`scheduler` 默认 `systemScheduler`，只控制池的空闲回收；每项已接纳操作占用一个成员客户端槽，统计值不是远端计算并发。\n\n直接安装三个必需依赖 `@migaia/rpc-core`、`@migaia/rpc-process`、`@migaia/rpc-threads`；`isProcessChild()` 同步判断子进程，`createProcessPeer({ provide })` 发布代码中的方法。身份方法返回真实 `process.pid`，流依次返回两个数字；调用方需消费或归还流才能释放槽。进程调用选项保留原接口，禁止线程转移列表；失败任务直接收到原生 `TypeError`，其 `cause` 为 `RangeError`，不是 Worker 示例中的外层包装。\n\n原进程短来源默认采用 `best-effort` 隔离，可能因不支持进程终止能力报告监督层的 `CAPABILITY_UNSUPPORTED` 提示；这种预期能力降级不把已成功的业务调用变成失败，也不保证整棵进程树一定能被强制终止。池透传原 Peer 失败，不重放失败工作。'
      },
      cases: rpcPoolCases.createProcessPool,
      example: rpcPoolCases.createProcessPool![0]!.example,
      scenarios: [
        t(
          'Distribute independent service calls across owned child processes while preserving each public Process Peer lifecycle.',
          '跨所属子进程分配独立服务调用，同时保留各公开进程连接生命周期。'
        )
      ]
    },
    RPC_POOL_ERROR_SOURCE: {
      role: 'error',
      purpose: t(
        'Canonical @migaia/rpc-pool source for pool-owned admission, queued cancellation and cleanup failures. Original Peer errors keep their own source and code; do not rewrite them as pool failures.',
        '池接纳、排队取消及清理失败的规范来源，原底层连接错误保留其自身来源与错误码，不改写为池失败。'
      ),
      example: `import { RPC_POOL_ERROR_SOURCE, RpcPoolErrorCode } from '@migaia/rpc-pool'
console.log(RPC_POOL_ERROR_SOURCE, RpcPoolErrorCode.queueFull)`
    },
    RpcPoolErrorCode: {
      role: 'error',
      purpose: t(
        'Stable pool-owned semantic codes for invalid configuration, closed admission, queue overflow, queued abort and aggregated member cleanup. Native error classes and original causes remain intact.',
        '提供非法配置、关闭接纳、队列溢出、排队取消及聚合成员清理的稳定池语义码，保留原生错误类型与原始原因。'
      ),
      example: `import { RpcPoolErrorCode } from '@migaia/rpc-pool'
console.log(RpcPoolErrorCode.callAborted)`
    },
    RpcPoolState: {
      role: 'constant',
      purpose: t(
        'Client scheduling lifecycle reported by stats(): open accepts work, closing drains accepted operations, closed records completed member cleanup attempts. It does not describe individual native supervisor generations.',
        '统计报告的客户端调度生命周期，打开接收工作、关闭中排空已接纳操作、关闭记录成员清理尝试已完成，不描述单独原生监督代次。'
      ),
      example: threadExample
    }
  },
  types: {
    IThreadPool: {
      summary: t(
        'Caller-owned pool returned by createThreadPool. It preserves the original Thread request, notify and stream type contracts and adds pool-owned stats, resize and idempotent close. Original native supervision remains outside this package.',
        '线程池工厂返回的调用者实例，保留原线程请求、通知及流类型契约，增加池统计、调整及幂等关闭，原生监督仍由外包拥有。'
      ),
      scenarios: [
        t(
          'Bound client concurrency and queue demand across independent Thread Peers.',
          '跨独立线程连接限制客户端并发及排队需求。'
        )
      ],
      example: threadExample,
      members: { ...threadCallMembers, ...controlMembers }
    },
    IProcessPool: {
      summary: t(
        'Caller-owned pool returned by createProcessPool. Preserves Process request, notify and stream types with no native transfer list, adding the same pool-owned lifecycle controls as Thread pools.',
        '进程池工厂返回的调用者实例，保留禁止原生转移列表的进程请求、通知及流类型，增加与线程池相同的池生命周期控制。'
      ),
      scenarios: [
        t(
          'Schedule service operations across owned processes without replacing their communication or restart policy.',
          '跨所属进程调度服务操作，不替换其通信或重启策略。'
        )
      ],
      example: processExample,
      members: {
        ...processCallMembers,
        ...Object.fromEntries(
          Object.entries(controlMembers).map(([name, doc]) => [
            name,
            { ...doc, example: processExample }
          ])
        )
      }
    },
    IRpcPoolControls: {
      summary: t(
        'Pool-owned control surface shared by Thread and Process pools; owns only the public Peers acquired by the corresponding pool factory.',
        '线程及进程池共享的池控制表面，仅拥有对应池工厂接纳的公开连接。'
      ),
      scenarios: [
        t(
          'Resize or close either pool through one control contract while observing pool client slots.',
          '通过统一控制契约调整或关闭任一池，并观察池客户端槽。'
        )
      ],
      example: threadExample,
      members: controlMembers
    },
    IRpcPoolStats: {
      summary: t(
        'Frozen pool scheduling snapshot, independent of provider concurrency and per-Peer native readiness or restart states. Available even after pool closure.',
        '冻结池调度快照，独立于提供者并发及各连接原生就绪或重启状态，池关闭后仍可读取。'
      ),
      example: threadExample,
      members: {
        targetSize: {
          summary: t(
            'Configured member target from construction or the latest admitted resize; idle retirement does not lower it.',
            '构造或最新接纳调整指定的成员目标，空闲退役不会降低此目标。'
          )
        },
        memberCount: {
          summary: t(
            'Currently acquired public Peer count, including members still retained for retirement; missing idle capacity may make it lower than targetSize.',
            '当前已取得公开连接数量，包含仍因退役而保留的成员，空闲容量缺失时可低于目标大小。'
          )
        },
        inFlight: {
          summary: t(
            'Member slots with an actual acquired Peer assigned to an accepted operation; acquiring slots are excluded until ready.',
            '已有实际连接且被分配给已接纳操作的成员槽，仍在接纳中的槽在就绪前不计入。'
          )
        },
        queued: {
          summary: t(
            'Accepted FIFO waiters without a member assignment; excludes occupied slots and cold acquisition reservations.',
            '尚未分配成员的已接纳先进先出等待者，不含占用槽及冷接纳预留。'
          )
        },
        state: {
          summary: t(
            'Pool-owned admission and drain lifecycle, separate from member native restart state.',
            '池拥有的接纳及排空生命周期，与成员原生重启状态分开。'
          ),
          values: { enum: 'RpcPoolState' }
        }
      }
    },
    IThreadPoolOptions: {
      summary: t(
        'Required original Thread spawn source and pool scheduling limits. The pool does not clone the source or rewrite its child runtime, transfer or supervision policy.',
        '必填原线程启动来源与池调度限制，池不复制来源或改写子运行时、转移及监督策略。'
      ),
      example: threadExample,
      optionCases: poolOptionCases('Thread'),
      members: {
        ...commonOptions,
        spawn: {
          summary: t(
            'Required NonNullable<IRuntimeThreadPeerOptions[spawn]> from @migaia/rpc-threads: true for the guarded current entry, path, URL or original Thread spawn configuration. The spawned entry provides methods through createThreadPeer; every member receives this exact source.',
            '必填原线程启动类型，支持通过守卫复用当前入口的真值、路径、网址对象或原线程启动配置，启动入口经线程连接工厂提供方法，每成员接收完全相同来源。'
          )
        },
        probe: { ...probeOption, example: poolOptionExamples('Thread').capacity }
      }
    },
    IProcessPoolOptions: {
      summary: t(
        'Required original Process spawn source and common pool limits. Original runtime, permissions, JSON-RPC bindings and restart policy stay owned by @migaia/rpc-process.',
        '必填原进程启动来源及通用池限制，原运行时、权限、线协议绑定及重启策略仍归进程包拥有。'
      ),
      example: processExample,
      optionCases: poolOptionCases('Process'),
      members: {
        ...commonOptions,
        spawn: {
          summary: t(
            'Required NonNullable<IRuntimeProcessPeerOptions[spawn]> from @migaia/rpc-process: true for the guarded current entry, path, URL or original process source configuration. The program provides methods through createProcessPeer and the pool forwards the exact source unchanged.',
            '必填原进程启动类型，支持通过守卫复用当前入口的真值、路径、网址对象或原进程来源配置，程序经进程连接工厂提供方法，池原样转发精确来源。'
          )
        },
        probe: { ...probeOption, example: poolOptionExamples('Process').capacity }
      }
    },
    IRpcPoolErrorCode: {
      summary: t(
        'Value union of RpcPoolErrorCode; only failures owned by pool scheduling use this union, while original Peer errors retain external contracts.',
        '池语义错误码的值联合，仅池调度拥有的失败使用此联合，原底层连接错误保留外包契约。'
      ),
      example: `import { RpcPoolErrorCode } from '@migaia/rpc-pool'
console.log(RpcPoolErrorCode.closeFailed)`,
      members: {}
    }
  },
  enums: {
    RpcPoolErrorCode: {
      summary: t(
        'Pool-owned error categories, classified with RPC_POOL_ERROR_SOURCE rather than replacing underlying Peer identity.',
        '池拥有的错误分类，与规范池来源一起识别，不替换底层连接身份。'
      ),
      values: errorValues
    },
    RpcPoolState: {
      summary: t(
        'Pool client admission states reported in IRpcPoolStats; these are lifecycle values rather than thrown codes.',
        '池统计报告的客户端接纳状态，属于生命周期值而非抛出错误码。'
      ),
      values: stateValues
    }
  },
  enhancers: {}
}
