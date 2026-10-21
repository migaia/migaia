import type { ICaseDoc } from './contract.js'

/** Complete Node examples use real process owners and explicit cleanup. */
export const rpcProcessCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createProcessPeer: [
    {
      title: {
        en: 'Run a function in a real child and close its owner',
        zh: '在真实子进程中执行函数并关闭其所有者'
      },
      problem: {
        en: 'CPU work must run outside the main process, but a function call alone does not show where it executes.\n\nHandwritten spawning also needs framing, authentication and cleanup; rerunning one entry without a role check can recursively spawn more children.\n\nBranch with isProcessChild(), provide methods in the child, and use spawn: true in the parent; close the returned Peer in finally.',
        zh: '主进程需要把计算移到另一个操作系统进程里，但只看到函数返回值，还无法判断代码究竟在哪里执行。\n\n手写启动还要处理分帧、认证与清理；同一个入口重新执行时，若不先区分角色，子进程又会继续启动子进程。\n\n先用 `isProcessChild()` 分支，子端提供方法，父端用 `spawn: true` 启动，并在 `finally` 中关闭返回的 Peer。'
      },
      example: {
        en: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; pid(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: { double: (value: number) => value * 2, pid: () => process.pid }\n  })\n} else {\n  const child = await createProcessPeer<IServiceApi>({ spawn: true })\n  try {\n    console.log(await child.request('double', 21))\n    console.log((await child.request('pid')) !== process.pid)\n  } finally {\n    await child.close()\n  }\n}",
        zh: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; pid(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: { double: (value: number) => value * 2, pid: () => process.pid }\n  })\n} else {\n  const child = await createProcessPeer<IServiceApi>({ spawn: true })\n  try {\n    console.log(await child.request('double', 21))\n    console.log((await child.request('pid')) !== process.pid)\n  } finally {\n    await child.close()\n  }\n}"
      },
      result: {
        en: 'Output is `42` then `true`: the method doubles 21, and its native process id differs from the parent.\n\nThe parent owns this child and closes it explicitly; this Node entry must be a real file, not eval or a test runner, and Node does not guarantee terminating every descendant.',
        zh: '输出依次为 `42`、`true`：计算结果为 42，返回的原生进程 id 也确实不同于父进程。\n\n父端拥有此子进程并显式关闭；Node 自派生入口必须是真实文件，不能是 eval 或测试运行器，也不保证终止所有后代进程。'
      }
    },
    {
      title: {
        en: 'Use reverse calls and streaming on the same child connection',
        zh: '在同一条子进程连接上使用反向调用与流'
      },
      problem: {
        en: 'A child may need a parent-owned service while producing a sequence of results for its caller.\n\nIndependent one-way pipes require separate routing and correlation, and treating a sequence as one response forces the producer to collect it first.\n\nProvide a parent method, let the child request it through its Peer, and expose an async generator consumed with stream().',
        zh: '子进程处理任务时，既要调用父端持有的服务，也要把一串结果逐项交回调用方。\n\n分别搭建单向管道，就要重复处理路由和结果对应关系；把整串结果塞进一次响应，又迫使提供方先收集全部数据。\n\n父端通过 `provide` 提供方法，子端拿自己的 Peer 反向请求；序列方法返回异步生成器，父端通过 `stream()` 消费。'
      },
      example: {
        en: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IParentApi = { prefix(value: string): string }\ntype IChildApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (isProcessChild()) {\n  const parent = createProcessPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const child = await createProcessPeer<IChildApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => 'main:' + value }\n  })\n  try {\n    console.log(await child.request('label', 'job'))\n    const values: number[] = []\n    for await (const value of child.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await child.close()\n  }\n}",
        zh: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IParentApi = { prefix(value: string): string }\ntype IChildApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (isProcessChild()) {\n  const parent = createProcessPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const child = await createProcessPeer<IChildApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => '主端:' + value }\n  })\n  try {\n    console.log(await child.request('label', '任务'))\n    const values: number[] = []\n    for await (const value of child.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await child.close()\n  }\n}"
      },
      result: {
        en: 'Output is `main:job` then `1,2,3`, proving the child awaited a reverse request and the parent consumed its three stream items.\n\nBoth directions use the same authenticated connection; stream transmission starts on iteration, while notify completion would only mean sending completed.',
        zh: '输出为 `主端:任务`、`1,2,3`，证明子端等待了反向请求结果，父端也读取了流的三个值。\n\n双向调用复用同一条已认证连接；流在开始迭代时才发送请求，`notify` 完成则只表示发送完成。'
      }
    },
    {
      title: {
        en: 'Close one client while leaving a named local service available',
        zh: '关闭一个客户端后仍可连接本机命名服务'
      },
      problem: {
        en: 'A CLI connection ends, but the local service must remain available to the next caller.\n\nIf the client treats a connection as ownership of the server process or listener, its cleanup can remove a service still used by others.\n\nUse a unique named listener and connect separate clients; close each borrowed connection before closing the server owner.',
        zh: '一条 CLI 连接结束后，本机服务还需要继续接受后续调用方。\n\n如果把持有连接误当成拥有服务进程或监听器，客户端清理时就可能释放其他调用方仍在使用的服务。\n\n用唯一名称创建监听，再分别建立客户端；每个客户端先关闭自己的借用连接，最后才由服务端关闭监听。'
      },
      example: {
        en: "import { randomUUID } from 'node:crypto'\nimport { createProcessPeer } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nconst name = 'reader-' + randomUUID()\nconst server = await createProcessPeer({\n  listen: name,\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const first = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await first.request('double', 20))\n  } finally {\n    await first.close()\n  }\n  const second = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await second.request('double', 21))\n  } finally {\n    await second.close()\n  }\n} finally {\n  await server.close()\n}",
        zh: "import { randomUUID } from 'node:crypto'\nimport { createProcessPeer } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nconst name = 'reader-' + randomUUID()\nconst server = await createProcessPeer({\n  listen: name,\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const first = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await first.request('double', 20))\n  } finally {\n    await first.close()\n  }\n  const second = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await second.request('double', 21))\n  } finally {\n    await second.close()\n  }\n} finally {\n  await server.close()\n}"
      },
      result: {
        en: 'Output is `40` then `42`; the second client connects and calls successfully after the first closes.\n\nThis Node/POSIX example uses same-user endpoint permissions, not authentication between applications of that user; Windows and explicit addresses require a token.',
        zh: '输出为 `40`、`42`；第一个客户端关闭后，第二个客户端仍能连接并成功调用。\n\n此例使用 Node/POSIX 的同用户端点权限，不能区分同一用户下的不同应用；Windows 以及显式地址需要提供 token。'
      }
    }
  ],
  createProcessPlugin: [
    {
      title: {
        en: 'Let a Host own a spawned service and its release',
        zh: '把子进程服务及其释放交给 Host'
      },
      problem: {
        en: 'An application installs several services and needs one owner to close their process connections during shutdown.\n\nKeeping each child in a separate local variable makes it easy to omit one from cleanup or mix service lookup with native process ownership.\n\nCreate a named process plugin, install it with host.use(), call through host.process, and dispose the Host in finally.',
        zh: '应用安装多个服务时，需要一个所有者在退出时统一关闭它们的进程连接。\n\n把每个子进程分散保存在局部变量里，容易漏掉清理项，也容易把服务查找与原生进程所有权混在一起。\n\n创建带名称的进程插件，用 `host.use()` 安装，经 `host.process` 调用，并在 `finally` 中释放 Host。'
      },
      example: {
        en: "import { defineHost } from '@migaia/plugin-host'\nimport { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })\n} else {\n  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({\n    name: 'service',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(service)\n    console.log(await host.process!.request('service', 'double', 21))\n    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}",
        zh: "import { defineHost } from '@migaia/plugin-host'\nimport { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })\n} else {\n  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({\n    name: 'service',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(service)\n    console.log(await host.process!.request('service', 'double', 21))\n    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}"
      },
      result: {
        en: 'Output is `42`, `spawn`, then `true`: the call succeeds, the outlet identifies a spawned connection, and Host cleanup completes.\n\nThe Host owns this installed child; both execution budgets are explicitly false, meaning unlimited, rather than defaults, and no arbitrary application side effects are rolled back.',
        zh: '输出为 `42`、`spawn`、`true`：调用成功，出口识别出启动型连接，Host 清理也已完成。\n\nHost 拥有已安装的子进程；两个执行预算都显式设为 `false`，表示不设上限，并非默认值，也不会回滚应用任意外部副作用。'
      }
    }
  ],
  createProcessResilience: [
    {
      title: {
        en: 'Keep retry scopes stable across reconnections and separate principals',
        zh: '让重连复用同一去重范围并隔离不同身份'
      },
      problem: {
        en: 'A reconnect changes connection labels, but retries for the same authenticated principal should still address one retained result scope.\n\nScoping only by connection loses that continuity, while sharing one unqualified scope can mix results belonging to different principals.\n\nDerive sessionOptions from explicit identities and compare their store and scope; these inputs demonstrate configuration, not authentication.',
        zh: '连接重建后，连接标签会变化，但同一个已认证身份的重试仍应指向同一份已保留结果范围。\n\n只按连接划分会丢掉连续性；直接共用一个没有身份区分的范围，又可能把不同身份的结果混在一起。\n\n用完整身份调用 `sessionOptions`，比较返回的存储与范围；这里仅演示配置派生，身份字段本身不构成认证。'
      },
      example: {
        en: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })\ntry {\n  const first = resilience.sessionOptions({\n    connectionId: 'connection-1',\n    sessionId: 'session-1',\n    principalId: 'account-A'\n  })\n  const reconnect = resilience.sessionOptions({\n    connectionId: 'connection-2',\n    sessionId: 'session-2',\n    principalId: 'account-A'\n  })\n  const other = resilience.sessionOptions({\n    connectionId: 'connection-3',\n    sessionId: 'session-3',\n    principalId: 'account-B'\n  })\n  const admission = { token: 'operation', senderId: 'caller' }\n  console.log(first.idempotency.store === reconnect.idempotency.store)\n  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))\n  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))\n  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)\n} finally {\n  await resilience.close()\n}",
        zh: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })\ntry {\n  const first = resilience.sessionOptions({\n    connectionId: 'connection-1',\n    sessionId: 'session-1',\n    principalId: 'account-A'\n  })\n  const reconnect = resilience.sessionOptions({\n    connectionId: 'connection-2',\n    sessionId: 'session-2',\n    principalId: 'account-A'\n  })\n  const other = resilience.sessionOptions({\n    connectionId: 'connection-3',\n    sessionId: 'session-3',\n    principalId: 'account-B'\n  })\n  const admission = { token: 'operation', senderId: 'caller' }\n  console.log(first.idempotency.store === reconnect.idempotency.store)\n  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))\n  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))\n  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)\n} finally {\n  await resilience.close()\n}"
      },
      result: {
        en: 'Output is `true`, `true`, `true`, then `32 32`: one owner shares a store, the same principal keeps its scope, and a different principal gets another scope.\n\nThe default concurrent limits are 32 globally and per peer for this session; the application must obtain principalId from successful authentication before applying these options.',
        zh: '输出为 `true`、`true`、`true`、`32 32`：同一治理对象共用存储，相同身份保持范围，不同身份使用不同范围。\n\n此会话默认的全局和单对端并发上限都是 `32`；应用必须在认证成功后取得 `principalId`，再把这些配置用于实际连接。'
      }
    },
    {
      title: {
        en: 'Reject new work after a real child reaches terminal state',
        zh: '真实子进程进入终态后拒绝新任务'
      },
      problem: {
        en: 'A supervised child exits and the selected policy will not restart it, yet an application may still try to dispatch another request.\n\nA cached ready flag can outlive the actual process; replacing the supervisor with a diagnostic object also loses the real lifecycle boundary.\n\nAttach a real Node process supervisor, subscribe to its terminal notification through resilience, and run the returned guard before dispatch.',
        zh: '受监督子进程退出，当前策略不会重启，但应用仍可能继续发送新任务。\n\n缓存的就绪标记可能比真实进程活得更久；用诊断对象替代监督器，又会丢掉实际的生命周期边界。\n\n把真实 Node 进程监督器登记到治理对象，等待它的终态通知，并在发送任务前执行返回的守卫。'
      },
      example: {
        en: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createProcessSupervisor } from '@migaia/supervision/process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => {\n  reports.push(error)\n}\nconst supervisor = createProcessSupervisor({\n  id: 'worker',\n  launcher: createNodeProcessLauncher(),\n  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  report,\n  isolation: 'best-effort',\n  restart: { mode: 'never' },\n  spec: {\n    command: process.execPath,\n    args: ['-e', 'process.exit(1)'],\n    env: { inherit: ['PATH'], set: {} },\n    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }\n  }\n})\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report })\nlet finish: () => void = () => undefined\nconst terminal = new Promise<void>((resolve) => {\n  finish = resolve\n})\nconst off = resilience.onTerminal(() => {\n  finish()\n})\nconst registration = resilience.attachRegistration(\n  'worker',\n  {\n    ownership: 'spawn-owned',\n    health: 'none',\n    supervisor: {\n      restart: () => supervisor.restart(),\n      inspect: () => supervisor.inspect(),\n      dispose: () => supervisor.dispose(),\n      onTerminal: (listener) =>\n        supervisor.subscribe((event) => {\n          if (event.type === 'terminal') listener(event)\n        })\n    }\n  },\n  { kind: 'standalone-host', release: () => supervisor.dispose() }\n)\ntry {\n  const guard = resilience.callGuard('worker')\n  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  await supervisor.start()\n  await terminal\n  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)\n  try {\n    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error\n    console.log(failure.code)\n  }\n  off()\n  const closing = resilience.close()\n  console.log(closing === resilience.close())\n  await closing\n  console.log(resilience.inspect('worker') === undefined)\n  console.log(supervisor.inspect().state)\n} finally {\n  off()\n  await resilience.close()\n  await supervisor.dispose()\n}",
        zh: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createProcessSupervisor } from '@migaia/supervision/process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => {\n  reports.push(error)\n}\nconst supervisor = createProcessSupervisor({\n  id: 'worker',\n  launcher: createNodeProcessLauncher(),\n  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  report,\n  isolation: 'best-effort',\n  restart: { mode: 'never' },\n  spec: {\n    command: process.execPath,\n    args: ['-e', 'process.exit(1)'],\n    env: { inherit: ['PATH'], set: {} },\n    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }\n  }\n})\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report })\nlet finish: () => void = () => undefined\nconst terminal = new Promise<void>((resolve) => {\n  finish = resolve\n})\nconst off = resilience.onTerminal(() => {\n  finish()\n})\nconst registration = resilience.attachRegistration(\n  'worker',\n  {\n    ownership: 'spawn-owned',\n    health: 'none',\n    supervisor: {\n      restart: () => supervisor.restart(),\n      inspect: () => supervisor.inspect(),\n      dispose: () => supervisor.dispose(),\n      onTerminal: (listener) =>\n        supervisor.subscribe((event) => {\n          if (event.type === 'terminal') listener(event)\n        })\n    }\n  },\n  { kind: 'standalone-host', release: () => supervisor.dispose() }\n)\ntry {\n  const guard = resilience.callGuard('worker')\n  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  await supervisor.start()\n  await terminal\n  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)\n  try {\n    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error\n    console.log(failure.code)\n  }\n  off()\n  const closing = resilience.close()\n  console.log(closing === resilience.close())\n  await closing\n  console.log(resilience.inspect('worker') === undefined)\n  console.log(supervisor.inspect().state)\n} finally {\n  off()\n  await resilience.close()\n  await supervisor.dispose()\n}"
      },
      result: {
        en: 'Output is `terminal none`, `PROCESS_TERMINAL_CALL`, `true`, `true`, then `terminal`: the guard rejects, close is shared, and governance removal leaves the supervisor state intact.\n\nThe child really exits with code 1 under restart mode never; the handler marks the terminal report handled, while caller cleanup still disposes the original supervisor.',
        zh: '输出依次为 `terminal none`、`PROCESS_TERMINAL_CALL`、`true`、`true`、`terminal`：守卫拒绝新任务，关闭复用同一 Promise，解除治理后监督器状态仍被保留。\n\n子进程确实以退出码 `1` 结束，重启模式为 `never`；监听回调将该终态报告标记为已处理，调用方仍负责释放原始监督器。'
      }
    }
  ]
}
