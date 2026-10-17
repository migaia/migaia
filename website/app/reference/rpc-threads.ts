/**
 * Reference documentation of `@migaia/rpc-threads`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-threads/src/threads` (runtime-peer.ts, plugin.ts, short-spawn.ts,
 * channel.ts, bootstrap.ts, child.ts, node-launcher.ts, web-launcher.ts, adapters/*), the shared
 * Core types in `rpc-runtime-shared.ts`, README and USEGUIDE on 2026-10-17.
 */
import type { ICode, ILibraryReference, IMemberDoc, IText, ISymbolDoc } from './contract.js'
import {
  runtimeEventEnum,
  runtimeEventSymbol,
  runtimePeerOptionMembers,
  runtimePluginOptionMembers,
  runtimeOutletGrants,
  runtimeSharedTypes
} from './rpc-runtime-shared.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Shared fields of IRuntimeThreadPeerOptions and its factory option bag. */
const threadPeerOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...runtimePeerOptionMembers,
  connect: {
    summary: t(
      'Application-supplied Core source callback that opens a borrowed channel; select exactly one source.',
      '应用提供的核心来源回调，用于打开借用的通道；只能选择一种来源。'
    ),
    default: t('Omitted: no custom connection source.', '省略时不使用自定义连接来源。')
  },
  listen: {
    summary: t(
      'Application-supplied Core source callback accepting channel sessions; cannot be combined with another source.',
      '应用提供的核心来源回调，用于接受通道会话，不能与另一种来源同时设置。'
    ),
    default: t('Omitted: no custom listening source.', '省略时不使用自定义监听来源。')
  },
  spawn: {
    summary: t(
      'Worker to start: `URL`, path string (relative to the main entry directory), `true` (the current entry), `{ entry, base?, name?, data?, limits? }`, or a full source.',
      '要启动的 Worker：`URL`、路径字符串（相对主入口所在目录）、`true`（当前入口）、`{ entry, base?, name?, data?, limits? }`，或完整 source。'
    ),
    default: t(
      'Not set: inside a library Worker connects to the parent; otherwise `connect` is needed.',
      '不设置：在库启动的 Worker 内会连回父线程；否则需要提供 `connect`。'
    )
  },
  report: {
    summary: t(
      'Receives background errors that no call can reject with.',
      '接收无法通过调用 reject 的后台错误。'
    ),
    default: t('`console.error`.', '`console.error`：输出到控制台。')
  }
}

/** Thread plugins add canonical Host exposure to the thread source options. */
const threadPluginOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...threadPeerOptionMembers,
  ...runtimePluginOptionMembers
}

/** Shared fields of IThreadChannelOptions and its factory option bag. */
const threadChannelOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  scheduler: {
    summary: t('Clock and timers, shared with the source.', '与 source 共用的时钟和计时器。')
  },
  capabilities: {
    summary: t(
      'Local capability proposal; extensions wait for the other side acknowledgement.',
      '本端的能力提议；扩展能力需要等待对端确认。'
    ),
    default: t(
      'Not set: fixed basic profile, synchronous.',
      '不设置：使用固定的基础能力，同步完成。'
    )
  }
}

/** Shared fields of IWebThreadLauncherOptions and its factory option bag. */
const webLauncherOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  Worker: {
    summary: t('`Worker` constructor to use.', '创建线程时要使用的 `Worker` 构造函数。'),
    default: t('The global `Worker`.', '全局的 `Worker` 构造函数。')
  },
  report: {
    summary: t('Receives launcher background errors.', '接收 launcher 在后台产生的错误。'),
    params: { error: t('The failure.', '发生的失败。') },
    returns: t('Nothing.', '无返回值；错误已上报。')
  },
  runtimeApi: {
    summary: t(
      'Runtime API context provided by Core; set by the source automatically.',
      '由 Core 提供的运行时 API 上下文；由 source 自动设置。'
    ),
    default: t('Not set.', '不设置：由 source 自动提供。')
  }
}

/** Canonical shared fields of IRuntimeThreadSpawn. */
const threadSpawnMembers: Readonly<Record<string, IMemberDoc>> = {
  spec: {
    summary: t(
      '`{ entry, name?, data?, limits? }` of the Worker.',
      '要启动的 Worker 规格 `{ entry, name?, data?, limits? }`，决定入口与资源限制。'
    )
  },
  launcher: {
    summary: t(
      'Platform launcher, e.g. `createNodeThreadLauncher()`.',
      '负责创建 Worker 线程的平台 launcher，例如 `createNodeThreadLauncher()`。'
    )
  },
  budget: {
    summary: t(
      'Unit budget limiting concurrent Workers, e.g. `createUnitBudget({ kind: "thread", maxUnits: 1 })`.',
      '限制同时存在的 Worker 数量的预算，例如 `createUnitBudget({ kind: "thread", maxUnits: 1 })`。'
    )
  },
  scheduler: {
    summary: t(
      'Clock and timers; the channel factory must use the same one.',
      '时钟与计时器；通道工厂必须使用同一个。'
    )
  },
  channelFactory: {
    summary: t(
      'Channel factory paired with the launcher.',
      '与 `launcher` 配套使用、负责打开通道的工厂。'
    )
  },
  report: {
    summary: t('Required: receives background errors.', '必填：接收后台运行中产生的错误。'),
    params: { error: t('The background failure.', '后台发生的失败。') },
    returns: t('Nothing.', '无返回值；错误已交给上报函数。')
  },
  health: { summary: t('Optional health-check policy.', '可选的执行单元健康检查策略。') },
  supervisor: {
    summary: t(
      'Supervision policy: `ready`, `startupTimeoutMs`, `restart`, `terminalPolicy`, `stop`, `isolation`.',
      'Worker 执行单元的监督与重启策略：`ready`、`startupTimeoutMs`、`restart`、`terminalPolicy`、`stop`、`isolation`。'
    )
  },
  keyFactory: {
    summary: t('Generates idempotency keys for retried calls.', '为重试的调用生成幂等键。')
  },
  retryPort: {
    summary: t('Retry configuration of the remote proxy.', '远程代理在调用失败时的重试配置。')
  }
}

/** Node launch fields shared by direct and runtime-resource launcher factories. */
const nodeLauncherOptions = {
  runtimeApi: {
    summary: t(
      'Advanced `IRuntimePeerSourceContext` supplied by the Core source owner; per-launch held metadata takes precedence over this configured context.',
      '核心来源所有者提供的高级 `IRuntimePeerSourceContext`；每次启动持有的元数据优先于此配置上下文。'
    ),
    default: t(
      'Omitted: only private per-launch metadata can supply runtime API bootstrap.',
      '省略时仅可由每次启动的私有元数据提供运行时接口启动信息。'
    )
  },
  execArgv: {
    summary: t(
      'Caller-selected runtime argument list forwarded to each native Worker through a fresh array; use entry-appropriate flags.',
      '调用方指定的运行时参数列表，每次通过新数组传给原生工作线程；参数须适用于目标入口。'
    ),
    default: t(
      'Omitted: preserve Node’s native execution-argument inheritance.',
      '省略时保留宿主原生的执行参数继承行为。'
    )
  }
}

/** Main thread side of the quick start. */
const peerExample: ICode = {
  en: `import { createThreadPeer } from '@migaia/rpc-threads'

type IWorkerApi = { math: { double(value: number): number } }
const worker = await createThreadPeer<IWorkerApi>({ spawn: new URL('./worker.js', import.meta.url) })
try {
  console.log(await worker.request('math.double', 21)) // 42
} finally {
  await worker.close() // closes the connection and terminates the Worker
}`,
  zh: `import { createThreadPeer } from '@migaia/rpc-threads'

type IWorkerApi = { math: { double(value: number): number } }
const worker = await createThreadPeer<IWorkerApi>({ spawn: new URL('./worker.js', import.meta.url) })
try {
  console.log(await worker.request('math.double', 21)) // 42
} finally {
  await worker.close() // 关闭连接并终止 Worker
}`
}

/** Host-managed example of `createThreadPlugin`. */
const pluginExample = `import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

type IWorkerApi = { math: { double(value: number): number } }
const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn: new URL('./worker.js', import.meta.url)
})
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21)) // 42
  await host.thread!.restart('worker')
} finally {
  await host.dispose()
}`

/** Platform pairs: launcher plus channel factory. */
const platforms = [
  ['browser', 'Browser', 'browser Web Worker', '浏览器 Web Worker', true],
  ['bun', 'Bun', 'Bun Worker', 'Bun Worker', true],
  ['deno', 'Deno', 'Deno Worker (needs permissions)', 'Deno Worker（需要相应权限）', true],
  [
    'electron-renderer',
    'ElectronRenderer',
    'Electron renderer Web Worker',
    'Electron 渲染进程中的 Web Worker',
    true
  ],
  [
    'electron-main',
    'ElectronMain',
    'Electron main process `worker_threads`',
    'Electron 主进程中的 `worker_threads`',
    false
  ],
  ['node', 'Node', 'Node `worker_threads`', 'Node `worker_threads`', false]
] as const

/** Launcher and channel factory symbol docs for every platform adapter. */
/**
 * Full `spawn` source showing a platform launcher and its channel factory used together; both
 * factories document this pairing (`REF-PAIRED`). `launcherArgs` is the launcher call argument
 * text.
 */
function fullSpawnExample(prefix: string, launcherArgs: string): IText {
  /** Code shared by both locales apart from the comments. */
  const body = (
    entry: string,
    scheduler: string,
    peer: string
  ) => `import { createThreadPeer } from '@migaia/rpc-threads'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

const report = (error: unknown) => console.error(error)
const spawn = {
  spec: { entry: workerEntry }, // ${entry}
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: create${prefix}ThreadLauncher(${launcherArgs}),
  // ${scheduler}
  channelFactory: create${prefix}ThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
// ${peer}
const worker = await createThreadPeer<IWorkerApi>({ spawn, report })`
  return {
    en: body(
      'Worker entry of this platform',
      'same scheduler as the source above',
      'launcher starts the Worker, channelFactory opens the RPC channel on it'
    ),
    zh: body(
      '本平台的 Worker 入口',
      '与上面 source 使用同一个调度器',
      'launcher 启动 Worker，channelFactory 在它的端口上打开 RPC 通道'
    )
  }
}

const platformSymbols: Record<string, ISymbolDoc> = Object.fromEntries(
  platforms.flatMap(([module, prefix, en, zh, web]) => {
    /** How the launcher is called on this platform. */
    const launcherCall =
      module === 'electron-main' ? '()' : module === 'node' ? '()' : '({ report })'
    /** Termination note for Web-style Workers. */
    const termination = web
      ? t(
          ' `terminate()` cannot confirm the code stopped, so supervision treats it as possibly still running.',
          '`terminate()` 无法确认代码已停止，因此监督层保守地视其为可能仍在运行。'
        )
      : t(' Exits are observed, so termination is confirmed.', '可以观察到退出，因此终止可被确认。')
    return [
      [
        `create${prefix}ThreadLauncher`,
        {
          ...(web ? { options: 'IWebThreadLauncherOptions' } : {}),
          role: 'factory',
          purpose: t(
            `Creates the launcher that starts ${en} for a full \`spawn\` source.${termination.en}`,
            `创建为完整 \`spawn\` 来源启动${zh}的 launcher。${termination.zh}`
          ),
          ...(module === 'electron-main'
            ? {}
            : module === 'node'
              ? {
                  optionDocs: nodeLauncherOptions,
                  params: {
                    options: t(
                      'Optional `{ runtimeApi?, execArgv? }`: `execArgv` sets runtime flags for the Worker; omitted, Node inheritance applies.',
                      '可选的 `{ runtimeApi?, execArgv? }`：`execArgv` 为 Worker 设置运行时参数；省略时沿用 Node 的继承规则。'
                    )
                  }
                }
              : {
                  params: {
                    options: t(
                      '`{ report, Worker?, runtimeApi? }`: `report` receives launcher errors; `Worker` replaces the global constructor; see `IWebThreadLauncherOptions`.',
                      '`{ report, Worker?, runtimeApi? }`：`report` 接收 launcher 错误；`Worker` 用于替换全局构造函数；见 `IWebThreadLauncherOptions`。'
                    )
                  }
                }),
          returns: t(
            'An `IThreadLauncher` from `@migaia/supervision/threads`, used as `spawn.launcher`.',
            '来自 `@migaia/supervision/threads` 的 `IThreadLauncher`，用作 `spawn.launcher`。'
          ),
          example: fullSpawnExample(prefix, launcherCall === '()' ? '' : '{ report }')
        } satisfies ISymbolDoc
      ],
      [
        `create${prefix}ThreadChannelFactory`,
        {
          options: 'IThreadChannelOptions',
          role: 'factory',
          purpose: t(
            `Creates the channel factory paired with \`create${prefix}ThreadLauncher()\`: it opens the RPC channel on each launched Worker port.`,
            `创建与 \`create${prefix}ThreadLauncher()\` 配套的通道工厂：在每个已启动 Worker 的端口上打开 RPC 通道。`
          ),
          params: {
            options: t(
              '`{ scheduler, capabilities? }`: use the same `scheduler` as the source; `capabilities` narrows the local proposal.',
              '`{ scheduler, capabilities? }`：`scheduler` 必须与 source 使用同一个；`capabilities` 用于缩小本端提议的能力。'
            )
          },
          returns: t(
            'A channel factory with `open(handle, signal)`.',
            '带 `open(handle, signal)` 的通道工厂。'
          ),
          example: fullSpawnExample(prefix, launcherCall === '()' ? '' : '{ report }')
        } satisfies ISymbolDoc
      ]
    ]
  })
)

/** Module docs of the platform adapters. */
const platformModules = Object.fromEntries(
  platforms.map(([module, prefix, en, zh]) => [
    `adapters/${module}`,
    {
      summary: t(
        `Explicit ${en} pair for a full \`spawn\` source: \`create${prefix}ThreadLauncher()\` and \`create${prefix}ThreadChannelFactory()\`. Short \`spawn\` forms load the right adapter automatically.`,
        `为完整 \`spawn\` 来源提供的${zh}组合：\`create${prefix}ThreadLauncher()\` 与 \`create${prefix}ThreadChannelFactory()\`。使用简写 \`spawn\` 时会自动加载对应的适配器。`
      ),
      example: `import { create${prefix}ThreadChannelFactory, create${prefix}ThreadLauncher } from '@migaia/rpc-threads/adapters/${module}'`
    }
  ])
)

/** Docs of `postMessage` on port-like types. */
const postMessage: IMemberDoc = {
  summary: t('Posts one message to the other side of the port.', '通过端口向另一端发送一条消息。'),
  params: {
    message: t('The encoded RPC message.', '编码后的 RPC 消息。'),
    transfer: t('Objects whose ownership moves with the message.', '随消息一起转移所有权的对象。')
  },
  returns: t('Nothing; the message is queued.', '无返回值；消息已进入队列。'),
  example: `port.postMessage(message, [buffer])`
}

/** Docs of EventTarget listener pairs. */
const eventTargetPair: Readonly<Record<string, IMemberDoc>> = {
  addEventListener: {
    summary: t(
      'Registers a `message` listener installed by the channel.',
      '登记由通道安装的 `message` 监听。'
    ),
    params: {
      type: t('Event name, usually `message`.', '事件名称，通常为 `message`。'),
      listener: t('Listener installed by the channel.', '由通道安装的监听函数。')
    },
    returns: t('Nothing; the listener is registered.', '无返回值；监听已登记。'),
    example: `port.addEventListener('message', onMessage)`
  },
  removeEventListener: {
    summary: t('Removes the listener when the channel closes.', '通道关闭时移除之前登记的监听。'),
    params: {
      type: t('Event name used before.', '之前登记时使用的事件名称。'),
      listener: t('The same listener.', '之前登记的同一个监听函数。')
    },
    returns: t('Nothing; the listener is removed.', '无返回值；监听已移除。'),
    example: `port.removeEventListener('message', onMessage)`
  }
}

/** Members of the Node Worker shape (`IThreadNativeWorker`). */
const nativeWorkerMembers: Readonly<Record<string, IMemberDoc>> = {
  threadId: {
    summary: t(
      'Node thread id of the Worker.',
      'Node 为该 Worker 线程分配的数字 id，用于资源详情。'
    )
  },
  postMessage,
  on: {
    summary: t(
      'Adds a Worker event listener (`message`, `error`, `exit`).',
      '为该 Worker 线程添加原生事件监听（`message`、`error`、`exit`）。'
    ),
    params: {
      event: t('Event name.', 'Worker 事件名称。'),
      listener: t('Listener.', '事件触发时调用的监听函数。')
    },
    returns: t('The Worker, ignored.', '返回 Worker 本身，会被忽略。'),
    example: `worker.on('error', onError)`
  },
  off: {
    summary: t('Removes a Worker event listener.', '移除之前添加的 Worker 事件监听。'),
    params: {
      event: t('Event name.', 'Worker 事件名称。'),
      listener: t('The same listener.', '之前添加的同一个监听函数。')
    },
    returns: t('The Worker, ignored.', '返回 Worker 本身，会被忽略。'),
    example: `worker.off('error', onError)`
  },
  once: {
    summary: t(
      'Listens for the single `exit` event to observe termination.',
      '监听唯一一次 `exit` 事件，以观察终止。'
    ),
    params: {
      event: t('Always `exit`.', '固定为 `exit` 事件。'),
      listener: t('Receives the exit code.', '接收退出码的监听函数。')
    },
    returns: t('The Worker, ignored.', '返回 Worker 本身，会被忽略。'),
    example: `worker.once('exit', (code) => console.log(code))`
  },
  listenerCount: {
    summary: t(
      'Counts `message` listeners, used to check the channel owns the port.',
      '统计 `message` 监听数量，用来确认通道独占该端口。'
    ),
    params: { event: t('Always `message`.', '固定为 `message` 事件。') },
    returns: t('Number of listeners.', '当前监听函数的数量。'),
    example: `worker.listenerCount('message')`
  },
  terminate: {
    summary: t('Stops the Worker thread forcibly.', '强制停止该 Worker 线程的运行。'),
    returns: t('Resolves with the exit code.', '以退出码 resolve。'),
    example: `await worker.terminate()`
  },
  getHeapStatistics: {
    summary: t(
      'Optional heap sampler used for resource details.',
      '可选的堆内存采样函数，用于资源详情。'
    )
  },
  cpuUsage: {
    summary: t(
      'Optional CPU time sampler used for resource details.',
      '可选的 CPU 时间采样函数，用于资源详情。'
    )
  },
  performance: {
    summary: t('Optional event-loop utilisation sampler.', '可选的事件循环利用率采样器。')
  }
}

/** Reference of `@migaia/rpc-threads`. */
export const rpcThreadsReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Worker thread RPC. Start from `createThreadPeer({ spawn | provide })`: the main thread spawns a Worker and calls its functions with `request` / `notify` / `stream`, and the Worker calls back. `createThreadPlugin()` hands the Worker to a PluginHost (`host.thread`). Works on Node, Bun, Deno, browsers and Electron.',
        'Worker 线程 RPC。从 `createThreadPeer({ spawn | provide })` 开始：主线程 spawn 一个 Worker，并用 `request` / `notify` / `stream` 调用其中的函数，Worker 也能反向调用主线程。`createThreadPlugin()` 把 Worker 交给 PluginHost 管理（`host.thread`）。支持 Node、Bun、Deno、浏览器与 Electron。'
      ),
      example: peerExample
    },
    ...platformModules
  },
  symbols: {
    createThreadPeer: {
      options: 'IRuntimeThreadPeerOptions',
      role: 'factory',
      purpose: t(
        'Opens a Runtime Peer to a Worker. In the parent, `spawn` starts the Worker (URL, path, `true` for the current entry, or a full source). Inside a library-launched Worker, calling it without a source connects back to the parent. Resolves after handshake.',
        '打开一个与 Worker 通信的 Runtime Peer。在父线程中，`spawn` 启动 Worker（URL、路径、表示当前入口的 `true`，或完整 source）。在由库启动的 Worker 内部，不传来源调用即可连回父线程。握手完成后 resolve。'
      ),
      params: {
        options: t(
          'See `IRuntimeThreadPeerOptions`: `spawn` or `connect`, `provide` (methods this side offers), `report` (default `console.error`), `defaultTimeoutMs` (default 30000), `authentication`, `providerLimits`, `self`, `probe`.',
          '见 `IRuntimeThreadPeerOptions`：`spawn` 或 `connect`、`provide`（本端提供的方法）、`report`（默认 `console.error`）、`defaultTimeoutMs`（默认 30000）、`authentication`、`providerLimits`、`self`、`probe`。'
        ),
        runtime: t(
          'Advanced: custom Node `worker_threads` resource; default the real module.',
          '高级用法：自定义的 Node `worker_threads` 资源；默认为真实模块。'
        )
      },
      returns: t(
        'An `IRuntimeTypedPeer<TRemote>`; `close()` also terminates a spawned Worker. Bad configuration rejects with `INVALID_CONFIG`.',
        '一个 `IRuntimeTypedPeer<TRemote>`；`close()` 同时终止 spawn 出来的 Worker。配置错误时以 `INVALID_CONFIG` reject。'
      ),
      example: peerExample,
      scenarios: [
        t(
          'Move CPU-heavy parsing, compression or image work off the main thread.',
          '把耗费 CPU 的解析、压缩或图像处理移出主线程。'
        ),
        t(
          'Call Worker functions with types instead of hand-written `postMessage` dispatch.',
          '用带类型的调用代替手写的 `postMessage` 分发。'
        )
      ],
      avoid: [
        t(
          'Process isolation (crash containment, separate permissions): use `@migaia/rpc-process`.',
          '需要进程级隔离（崩溃互不影响、独立权限）时：请使用 `@migaia/rpc-process`。'
        ),
        t(
          '`SharedArrayBuffer` / `Atomics` shared memory: rejected.',
          '需要 `SharedArrayBuffer` / `Atomics` 共享内存时：不受支持，会被拒绝。'
        )
      ]
    },
    createThreadPlugin: {
      options: 'IRuntimeThreadPluginOptions',
      role: 'enhancer',
      purpose: t(
        'Creates a plugin that installs one Worker connection into a PluginHost; the host owns and releases it and gains the `host.thread` outlet.',
        '创建一个把 Worker 连接安装进 PluginHost 的插件；宿主负责持有与释放该连接，并获得 `host.thread` 出口。'
      ),
      params: {
        options: t(
          'Same `spawn` / `provide` as `createThreadPeer`, plus `name` (connection name in the host) and optional `expose` (host method paths the Worker may call).',
          '与 `createThreadPeer` 相同的 `spawn` / `provide`，另加 `name`（宿主中的连接名称）和可选的 `expose`（允许 Worker 调用的宿主方法路径）。'
        ),
        runtime: t(
          'Advanced: custom Node `worker_threads` resource.',
          '高级用法：自定义的 Node `worker_threads` 资源。'
        )
      },
      returns: t('A plugin for `host.use()`.', '可传给 `host.use()` 的插件对象。'),
      example: pluginExample
    },
    isThreadChild: {
      role: 'operation',
      purpose: t(
        'Tells whether the current module runs inside a Worker started by this library, so one file can branch between parent and Worker for `spawn: true`.',
        '判断当前模块是否运行在由本库启动的 Worker 中，使同一个文件可以在 `spawn: true` 时区分父线程与 Worker 两个分支。'
      ),
      returns: t(
        'Resolves `true` in a library-launched Worker; it does not authorise foreign Workers.',
        '在由本库启动的 Worker 中 resolve 为 `true`；它不会为外部 Worker 授权。'
      ),
      example: `if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const worker = await createThreadPeer<{ double(value: number): number }>({ spawn: true })
  console.log(await worker.request('double', 21))
  await worker.close()
}`
    },
    RPC_THREAD_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/threads`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        '本包自有错误的 `source` 值（`@migaia/rpc/threads`）；超时、取消等调用层错误则来自 `@migaia/rpc/core`。'
      ),
      example: `if (error.source === RPC_THREAD_ERROR_SOURCE) showUsageUnavailable()`
    },
    RpcThreadErrorCode: {
      role: 'constant',
      purpose: t(
        'Error codes owned by this package; currently only `THREAD_USAGE_SAMPLE_FAILED`.',
        '本包自有的错误码对照表；目前只有资源采样失败 `THREAD_USAGE_SAMPLE_FAILED` 一项。'
      ),
      example: `if (error.code === RpcThreadErrorCode.usageSampleFailed) console.warn('资源采样不可用')`
    },
    RuntimeEventName: runtimeEventSymbol,
    createWebThreadLauncher: {
      options: 'IWebThreadLauncherOptions',
      role: 'factory',
      purpose: t(
        'Creates a Web Worker launcher with your own `Worker` constructor (polyfill or restricted environment); for adapter authors.',
        '使用你自己提供的 `Worker` 构造函数（polyfill 或受限环境）创建 Web Worker launcher；面向适配器作者。'
      ),
      params: {
        options: t(
          '`{ Worker, report, runtimeApi? }`: your `Worker` constructor and the error reporter; see `IWebThreadLauncherOptions`.',
          '`{ Worker, report, runtimeApi? }`：你提供的 `Worker` 构造函数与错误上报函数；见 `IWebThreadLauncherOptions`。'
        )
      },
      returns: t(
        'An `IThreadLauncher` whose handles open channels with `open(signal, options)`.',
        '一个 `IThreadLauncher`，其句柄通过 `open(signal, options)` 打开通道。'
      ),
      example: fullSpawnExample('Web', '{ Worker: MyWorker, report }')
    },
    createWebThreadChannelFactory: {
      options: 'IThreadChannelOptions',
      role: 'factory',
      purpose: t(
        'Creates the channel factory paired with `createWebThreadLauncher()`.',
        '创建与 `createWebThreadLauncher()` 配套使用的通道工厂，在每个 Worker 端口上打开通道。'
      ),
      params: {
        options: t(
          '`{ scheduler, capabilities? }`; the same scheduler as the source.',
          '`{ scheduler, capabilities? }`；必须与 source 使用同一个调度器。'
        )
      },
      returns: t(
        'A channel factory with `open(handle, signal)`.',
        '带 `open(handle, signal)` 的通道工厂。'
      ),
      example: fullSpawnExample('Web', '{ Worker: MyWorker, report }')
    },
    createAdapterNodeThreadLauncher: {
      role: 'factory',
      optionDocs: nodeLauncherOptions,
      purpose: t(
        'Creates a Node Worker launcher over a custom `worker_threads` resource (`IThreadRuntimeResource`); for adapter authors and tests.',
        '基于自定义的 `worker_threads` 资源（`IThreadRuntimeResource`）创建 Node Worker launcher；面向适配器作者与测试。'
      ),
      params: {
        runtime: t(
          'Object whose `load()` returns the `worker_threads` module.',
          '其 `load()` 返回 `worker_threads` 模块的对象。'
        ),
        options: t(
          '`{ runtimeApi?, execArgv? }` as in `createNodeThreadLauncher`.',
          '`{ runtimeApi?, execArgv? }`，含义与 `createNodeThreadLauncher` 相同。'
        )
      },
      returns: t(
        'An `IThreadLauncher` with handles that can `open()` a channel.',
        '一个 `IThreadLauncher`，其句柄可以 `open()` 通道。'
      ),
      example: `const launcher = createAdapterNodeThreadLauncher({ load: () => import('node:worker_threads'), pid: process.pid })`
    },
    createAdapterNodeThreadPeer: {
      options: 'IRuntimeThreadPeerOptions',
      role: 'factory',
      purpose: t(
        'Worker side, advanced: builds the Peer from a `parentPort` and `workerData` you hold yourself instead of reading the module globals.',
        'Worker 端的高级用法：用你自己持有的 `parentPort` 与 `workerData` 建立 Peer，而不是读取模块全局变量。'
      ),
      params: {
        options: t(
          'Peer options; see `IRuntimeThreadPeerOptions`.',
          'Worker 端的 Peer 选项，见 `IRuntimeThreadPeerOptions`。'
        ),
        parentPort: t(
          '`parentPort` imported from `node:worker_threads` in the Worker.',
          'Worker 内从 `node:worker_threads` 导入的 `parentPort`。'
        ),
        workerData: t(
          '`workerData` from `node:worker_threads`, written by the launcher.',
          '来自 `node:worker_threads` 的 `workerData`，由 launcher 写入。'
        )
      },
      returns: t('The Worker-side `IRuntimePeer`.', '已连回父线程的 Worker 端 `IRuntimePeer`。'),
      example: `import { parentPort, workerData } from 'node:worker_threads'
const peer = await createAdapterNodeThreadPeer({ provide: api }, parentPort, workerData)`
    },
    createNodeThreadChannel: {
      options: 'IThreadChannelOptions',
      role: 'factory',
      purpose: t(
        'Builds a channel on a Node `MessagePort` you own, to connect two Peers over an existing `MessageChannel`.',
        '在你持有的 Node `MessagePort` 上构建通道，用于通过已有的 `MessageChannel` 连接两个 Peer。'
      ),
      params: {
        port: t(
          'One end of a `MessageChannel`; it stays owned by the caller.',
          '`MessageChannel` 的一端；仍由调用方持有。'
        ),
        peerId: t(
          'Instance id of the other side, taken from the `self.instanceId` that side configured.',
          '对端的实例 id，取自对端配置的 `self.instanceId`。'
        ),
        options: t(
          '`{ scheduler, capabilities? }`; pass `context.capabilities` received in `connect(context)` to negotiate extensions.',
          '`{ scheduler, capabilities? }`；传入 `connect(context)` 中收到的 `context.capabilities` 以协商扩展能力。'
        )
      },
      returns: t(
        'The channel (sync for the fixed profile, a Promise when extensions are negotiated).',
        '通道对象（固定能力时同步返回，协商扩展能力时返回 Promise）。'
      ),
      example: `const { port1 } = new MessageChannel()
await createThreadPeer({
  connect: async (context) => createNodeThreadChannel(port1, 'right-1', { scheduler: systemScheduler, capabilities: context.capabilities })
})`
    },
    createWebThreadChannel: {
      options: 'IThreadChannelOptions',
      role: 'factory',
      purpose: t(
        'Builds a channel on a Web `MessagePort` (or Worker global) you own.',
        '在你自己持有的 Web `MessagePort`（或 Worker 全局对象）上构建 RPC 通道，端口所有权不变。'
      ),
      params: {
        port: t(
          'EventTarget-style port; stays owned by the caller.',
          'EventTarget 风格的端口；仍由调用方持有。'
        ),
        peerId: t(
          'Instance id of the other side, from its `self.instanceId`.',
          '对端的实例 id，来自对端的 `self.instanceId`。'
        ),
        options: t(
          '`{ scheduler, capabilities? }` as in `createNodeThreadChannel`.',
          '`{ scheduler, capabilities? }`，含义与 `createNodeThreadChannel` 相同。'
        )
      },
      returns: t(
        'The channel (sync for the fixed profile, a Promise otherwise).',
        '通道对象（固定能力时同步返回，否则返回 Promise）。'
      ),
      example: `createWebThreadChannel(channel.port1, 'worker-1', { scheduler: systemScheduler })`
    },
    readThreadBootstrap: {
      role: 'operation',
      purpose: t(
        'Validates the bootstrap value a launcher wrote (Node `workerData` or the first Web message).',
        '校验并读取 launcher 写入的启动数据（Node 的 `workerData` 或 Web 的第一条消息）。'
      ),
      params: {
        value: t('The raw bootstrap value received by the Worker.', 'Worker 收到的原始启动数据。')
      },
      returns: t(
        '`{ peerId, data? }`; invalid input throws `INVALID_CONFIG`.',
        '`{ peerId, data? }`；输入不合法时抛 `INVALID_CONFIG`。'
      ),
      example: `const { peerId, data } = readThreadBootstrap(workerData)`
    },
    receiveThreadData: {
      role: 'operation',
      purpose: t(
        'In a Web Worker, waits for the bootstrap message, runs `prepare`, then acknowledges readiness to the launcher.',
        '在 Web Worker 中等待父端的启动消息，执行 `prepare`，然后向 launcher 确认已就绪。'
      ),
      params: {
        port: t(
          'The Worker global scope or port receiving the bootstrap.',
          '接收启动消息的 Worker 全局作用域或端口。'
        ),
        prepare: t(
          '`(data, peerId) => void | Promise`; `data` is `spec.data` from the parent, `peerId` the parent address.',
          '`(data, peerId) => void | Promise`；`data` 是父端的 `spec.data`，`peerId` 是父端地址。'
        )
      },
      returns: t(
        'Resolves with the bootstrap data after acknowledging.',
        '确认之后以启动数据 resolve。'
      ),
      example: `const data = await receiveThreadData(self, async (data) => configure(data))`
    },
    AdapterNodeThreadParentChannel: {
      role: 'factory',
      purpose: t(
        'Wraps the Worker `parentPort` you hold so third-party adapters can open the parent channel through the same path the library uses.',
        '包装你持有的 Worker `parentPort`，让第三方适配器通过与本库相同的路径打开通往父线程的通道。'
      ),
      params: {
        native: t(
          'The `parentPort` from `node:worker_threads`.',
          '由当前工作线程从 `node:worker_threads` 取得的原始 `parentPort`，调用方保留原生端口生命周期。'
        )
      },
      returns: t(
        'An object whose `open(peerId, options)` returns a Peer source.',
        '一个对象，其 `open(peerId, options)` 返回 Peer 来源。'
      ),
      example: `const parent = new AdapterNodeThreadParentChannel(parentPort!)`
    },
    ...platformSymbols
  },
  types: {
    ...runtimeSharedTypes,
    IRuntimeThreadPeerOptions: {
      summary: t(
        'Options of `createThreadPeer()`: the Worker source plus the Core Peer options.',
        '`createThreadPeer()` 的选项：Worker 来源以及 Core Peer 的通用选项。'
      ),
      members: threadPeerOptionMembers
    },
    IRuntimeThreadPluginOptions: {
      summary: t(
        'Options of `createThreadPlugin()`.',
        '`createThreadPlugin()` 的选项：连接名称、来源、提供与公开的方法。'
      ),
      members: threadPluginOptionMembers
    },
    IRuntimeThreadShortSpawn: {
      summary: t(
        'Short `spawn` object expanded to a full source with defaults.',
        '会用默认值展开为完整 source 的简写 `spawn` 对象。'
      ),
      example: `const spawn = {
  entry: new URL('./worker.js', import.meta.url),
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler })
}
const peer = await createThreadPeer({ spawn })
await peer.close()`,
      members: {
        ...threadSpawnMembers,
        entry: {
          summary: t(
            '`true`, a `URL` or a path string of the Worker module.',
            '要启动的 Worker 模块：`true`、`URL` 或路径字符串。'
          )
        },
        base: {
          summary: t(
            'Module URL used to resolve a relative `entry`, e.g. `import.meta.url`.',
            '解析相对 `entry` 时使用的模块 URL，例如 `import.meta.url`。'
          ),
          default: t('The main entry directory.', '主入口文件所在的目录。')
        },
        name: {
          summary: t(
            'Worker name shown in tools and details.',
            '在工具与详情中显示的 Worker 名称。'
          ),
          default: t('A generated name.', '自动生成的名称。')
        },
        data: {
          summary: t(
            'Portable data passed to the Worker at start (`receiveThreadData`).',
            '启动时传给 Worker 的可移植数据（见 `receiveThreadData`）。'
          ),
          default: t('Not set.', '不设置：不传初始数据。')
        },
        limits: {
          summary: t(
            'Resource limits such as heap size and `callWallTimeMs`.',
            '资源限制，例如堆大小与 `callWallTimeMs`。'
          ),
          default: t('Not set: no limits.', '不设置：不施加限制。')
        }
      }
    },
    IRuntimeThreadSpawn: {
      summary: t(
        'Full `spawn` source: every dependency explicit.',
        '完整的 `spawn` 来源：所有依赖都显式给出。'
      ),
      example: fullSpawnExample('Node', ''),
      members: threadSpawnMembers
    },
    IRuntimeThreadStopOptions: {
      summary: t(
        'Options of `host.thread.stop()`.',
        '`host.thread.stop()` 的选项：停止前的宽限时间。'
      ),
      members: {
        graceMs: {
          summary: t(
            'Time to finish before the Worker is terminated.',
            'Worker 被终止前允许完成工作的时间（毫秒）。'
          )
        }
      }
    },
    IThreadChannelOptions: {
      summary: t(
        'Options of channel constructors and factories.',
        '通道构造函数与通道工厂的选项。'
      ),
      members: threadChannelOptionMembers
    },
    IThreadChannelFactory: {
      summary: t(
        'Opens the RPC channel of one launched Worker.',
        '为一个已启动的 Worker 打开 RPC 通道。'
      ),
      scenarios: [
        t(
          'Pair a custom launcher with its channel opening logic.',
          '把自定义 launcher 与其通道打开逻辑配对使用。'
        )
      ],
      example: `const channel = await channelFactory.open(handle, signal)`,
      members: {
        open: {
          summary: t(
            'Opens a channel on the Worker port of `handle`.',
            '在 `handle` 对应的 Worker 端口上打开通道。'
          ),
          params: {
            handle: t(
              'Handle returned by `launcher.launch()`.',
              '由 `launcher.launch()` 返回的句柄。'
            ),
            signal: t('Aborts the opening.', '用于中止打开过程的信号。')
          },
          returns: t('The remote channel.', '远程通道对象。'),
          example: `await channelFactory.open(handle, controller.signal)`
        }
      }
    },
    IThreadBootstrapData: {
      summary: t(
        'Bootstrap data written by a launcher: parent address and optional data.',
        'launcher 写入的启动数据：父端地址以及可选数据。'
      ),
      scenarios: [
        t(
          'Read the start configuration in a custom Worker entry.',
          '在自定义的 Worker 入口中读取启动配置。'
        )
      ],
      example: `const { peerId, data } = readThreadBootstrap(workerData)`,
      members: {
        peerId: {
          summary: t('Instance id of the parent Peer.', '父线程中 Peer 的实例 id，用于连回父端。')
        },
        data: {
          summary: t('`spec.data` given by the parent.', '父端在启动规格中给出的 `spec.data`。')
        }
      }
    },
    IThreadWebPort: {
      summary: t(
        'EventTarget-style port or Worker global.',
        'EventTarget 风格的端口或 Worker 全局对象。'
      ),
      members: { postMessage, ...eventTargetPair }
    },
    IWebThreadWorker: {
      summary: t(
        'Web Worker shape created by a custom constructor.',
        '由自定义构造函数创建的 Web Worker 形状。'
      ),
      members: {
        terminate: {
          summary: t(
            'Stops the Worker; completion cannot be observed.',
            '停止该 Worker；无法观察其是否真正结束。'
          ),
          returns: t('Nothing.', '无返回值；已请求停止。'),
          example: `worker.terminate()`
        },
        postMessage,
        ...eventTargetPair
      }
    },
    IWebThreadLauncherOptions: {
      summary: t('Options of Web-style launchers.', 'Web 风格 launcher 的选项：构造函数与上报。'),
      members: webLauncherOptionMembers
    },
    IWebThreadHandle: {
      summary: t(
        'Handle of a launched Web Worker.',
        '由 launcher 启动的 Web Worker 的句柄，供通道工厂使用。'
      ),
      members: {
        port: {
          summary: t('Worker port used by the channel.', '通道收发消息所使用的 Worker 端口。')
        },
        prepared: {
          summary: t(
            'Resolves when the Worker acknowledged its bootstrap.',
            'Worker 确认收到启动数据后才 resolve。'
          )
        }
      }
    },
    INodeThreadHandle: {
      summary: t(
        'Handle of a launched Node Worker.',
        '由 launcher 启动的 Node Worker 的句柄，供通道工厂使用。'
      ),
      members: {
        port: {
          summary: t('Worker port used by the channel.', '通道收发消息所使用的 Worker 端口。')
        }
      }
    },
    IAdapterNodeThreadHandle: {
      summary: t(
        'Node launcher handle that can open its own channel.',
        '可以自行打开通道的 Node launcher 句柄。'
      ),
      members: {
        port: {
          summary: t('Worker port used by the channel.', '通道收发消息所使用的 Worker 端口。')
        },
        open: {
          summary: t(
            'Confirms capabilities on the Worker port and returns the channel source.',
            '在 Worker 端口上确认能力并返回通道来源。'
          ),
          params: {
            signal: t('Aborts the opening.', '用于中止打开过程的信号。'),
            options: t(
              '`{ scheduler, capabilities? }`.',
              '通道选项 `{ scheduler, capabilities? }`。'
            )
          },
          returns: t('A Peer source result.', '一个 Peer 来源结果。'),
          example: `const source = await handle.open(signal, { scheduler: systemScheduler })`
        }
      }
    },
    IAdapterWebThreadHandle: {
      summary: t(
        'Web launcher handle that can open its own channel.',
        '可以自行打开通道的 Web launcher 句柄。'
      ),
      members: {
        port: {
          summary: t('Worker port used by the channel.', '通道收发消息所使用的 Worker 端口。')
        },
        prepared: {
          summary: t(
            'Resolves when the Worker acknowledged its bootstrap.',
            'Worker 确认收到启动数据后才 resolve。'
          )
        },
        open: {
          summary: t(
            'Confirms capabilities on the Worker port and returns the channel source.',
            '在 Worker 端口上确认能力并返回通道来源。'
          ),
          params: {
            signal: t('Aborts the opening.', '用于中止打开过程的信号。'),
            options: t(
              '`{ scheduler, capabilities? }`.',
              '通道选项 `{ scheduler, capabilities? }`。'
            )
          },
          returns: t('A Peer source result.', '一个 Peer 来源结果。'),
          example: `const source = await handle.open(signal, { scheduler: systemScheduler })`
        }
      }
    },
    IThreadRuntimeResource: {
      summary: t(
        'Loader of the Node `worker_threads` module used by the Node launcher.',
        'Node launcher 使用的 `worker_threads` 模块加载器对象。'
      ),
      members: {
        load: {
          summary: t(
            'Imports `worker_threads` (or a test double).',
            '按需导入 `worker_threads` 模块（或测试替身）。'
          ),
          returns: t(
            '`{ Worker, parentPort, workerData }`.',
            '`{ Worker, parentPort, workerData }` 模块对象。'
          ),
          example: `load: () => import('node:worker_threads')`
        },
        pid: { summary: t('Process id shown in resource details.', '资源详情中显示的进程 id。') }
      }
    },
    IThreadNativeRuntimeModule: {
      summary: t(
        'The parts of `worker_threads` the adapter needs.',
        '适配器需要的那部分 `worker_threads` 模块。'
      ),
      members: {
        Worker: {
          summary: t('Constructor that creates Worker threads.', '用于创建线程的 Worker 构造函数。')
        },
        parentPort: {
          summary: t(
            'Port to the parent, `null` on the main thread.',
            '通往父线程的端口；在主线程中为 `null`。'
          )
        },
        workerData: {
          summary: t(
            'Bootstrap data written by the launcher.',
            '由 launcher 写入、供 Worker 读取的启动数据。'
          )
        }
      }
    },
    IThreadNativeWorker: {
      summary: t(
        'The parts of a Node `Worker` the launcher uses.',
        'launcher 实际使用的那部分 Node `Worker` 能力。'
      ),
      members: nativeWorkerMembers
    },
    IThreadNativeWorkerConstructor: {
      summary: t(
        'Constructor of Node `Worker`.',
        'Node `Worker` 线程的构造函数类型，由适配器调用。'
      ),
      members: nativeWorkerMembers
    },
    IThreadParentPort: {
      summary: t(
        '`parentPort` inside a Node Worker.',
        'Node Worker 线程内部通往父线程的 `parentPort` 端口。'
      ),
      members: {
        once: {
          summary: t(
            'Listens for `close` of the parent port.',
            '监听父端口一次性的 `close` 事件。'
          ),
          params: {
            event: t('Always `close`.', '固定为 `close` 事件。'),
            listener: t('Called once on close.', '关闭时调用一次的监听函数。')
          },
          returns: t('The port, ignored.', '返回端口本身，会被忽略。'),
          example: `parentPort.once('close', onClose)`
        },
        listenerCount: {
          summary: t(
            'Counts `message` listeners to check exclusive ownership.',
            '统计 `message` 监听数量，以确认独占使用。'
          ),
          params: { event: t('Always `message`.', '固定为 `message` 事件。') },
          returns: t('Number of listeners.', '当前监听函数的数量。'),
          example: `parentPort.listenerCount('message')`
        }
      }
    },
    AdapterNodeThreadParentChannel: {
      summary: t(
        'Borrowed parent port of a Node Worker, opened like the library does.',
        'Node Worker 中借用的父端口，按本库相同的方式打开。'
      ),
      scenarios: [
        t(
          'Write a third-party Worker adapter that reuses the library bootstrap.',
          '编写复用本库启动流程的第三方 Worker 适配器。'
        )
      ],
      example: `const parent = new AdapterNodeThreadParentChannel(parentPort!)
const source = parent.open(peerId, { scheduler: systemScheduler })`,
      members: {
        open: {
          summary: t(
            'Opens the parent channel with the fixed thread profile.',
            '以固定的线程能力配置打开通往父线程的通道。'
          ),
          params: {
            peerId: t(
              'Parent instance id from the bootstrap (`readThreadBootstrap(workerData).peerId`).',
              '父端实例 id，取自启动数据 `readThreadBootstrap(workerData).peerId`。'
            ),
            options: t(
              '`{ scheduler, capabilities? }`.',
              '通道选项 `{ scheduler, capabilities? }`。'
            )
          },
          returns: t('A Peer source result.', '一个 Peer 来源结果。'),
          example: `parent.open(peerId, { scheduler: systemScheduler })`
        }
      }
    },
    IRpcThreadErrorCode: {
      summary: t(
        'Union of `RpcThreadErrorCode` values.',
        '`RpcThreadErrorCode` 全部取值组成的联合类型。'
      ),
      members: {}
    }
  },
  enums: {
    RuntimeEventName: runtimeEventEnum,
    RpcThreadErrorCode: {
      summary: t(
        'Error codes owned by `@migaia/rpc-threads`.',
        '`@migaia/rpc-threads` 自有的错误码及其含义。'
      ),
      values: {
        usageSampleFailed: t(
          '`THREAD_USAGE_SAMPLE_FAILED`: sampling Worker CPU or memory failed; show the value as unavailable, the Worker keeps running.',
          '`THREAD_USAGE_SAMPLE_FAILED`：采样 Worker 的 CPU 或内存失败；把该值显示为不可用即可，Worker 继续运行。'
        )
      }
    }
  },
  enhancers: {
    createThreadPlugin: {
      kind: 'plugin',
      target: 'PluginHost',
      summary: t(
        'After installation the host has `host.thread`: calls to the Worker by connection name, queries (`list`, `get`), `broadcast`, lifecycle control (`stop`, `kill`, `restart`, `replace`) and events (`on`, `watch`). The host disposes the Worker with itself.',
        '安装后宿主拥有 `host.thread`：按连接名称调用 Worker、查询（`list`、`get`）、`broadcast`、生命周期控制（`stop`、`kill`、`restart`、`replace`）以及事件（`on`、`watch`）。宿主释放时一并释放 Worker。'
      ),
      install: `const worker = createThreadPlugin({ name: 'worker', spawn: new URL('./worker.js', import.meta.url) })
await host.use(worker)`,
      grants: runtimeOutletGrants('thread'),
      behaviors: [
        t(
          '`expose` lists host methods the Worker may call back; nothing is exposed by default.',
          '`expose` 列出 Worker 可以反向调用的宿主方法；默认不公开任何方法。'
        )
      ],
      scenarios: [
        t(
          'Manage several Workers in one host and restart them from an admin panel.',
          '在一个宿主中管理多个 Worker，并从管理面板重启它们。'
        )
      ],
      example: pluginExample
    }
  }
}
