/**
 * Reference documentation of `@migaia/rpc-process`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-process/src/process` (runtime-peer.ts, adapters/short-source.ts,
 * plugin/types.ts, resilience/*, offer.ts, constants.ts, error-code.ts), the shared Core types in
 * `rpc-runtime-shared.ts`, README and USEGUIDE on 2026-10-17. Source clarification:
 * `receiveAdapterBootstrap` and the public stdio openers do not install a timeout when omitted; the
 * 10000 ms budget belongs to higher-level discovery. Both stdio openers reject `fd` mode.
 */
import type { ICode, ILibraryReference, IMemberDoc, ISymbolDoc, IText } from './contract.js'
import {
  runtimeEventEnum,
  runtimeEventSymbol,
  runtimeOutletGrants,
  runtimePeerOptionMembers,
  runtimeSharedTypes
} from './rpc-runtime-shared.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Public bootstrap readers only create a timer when the caller explicitly supplies a budget. */
const bootstrapTimeoutMember: IMemberDoc = {
  summary: t(
    'Caller-selected finite nonnegative milliseconds to wait for the initial bootstrap frame; this does not bound later handshake or business calls.',
    '调用方选择的有限非负毫秒预算，用于等待初始启动帧；不限制后续握手或业务调用。'
  ),
  default: t(
    'Omitted: this public reader installs no bootstrap timeout timer.',
    '省略时此公开读取函数不安装启动超时定时器。'
  )
}

/** Explicit advanced launch context shared by native process launcher adapters. */
const runtimeBootstrapMember: IMemberDoc = {
  summary: t(
    'Advanced `IProcessRuntimeBootstrapOptions` from the owning Core source setup, supplying the process bootstrap context; normal short sources arrange it automatically.',
    '所属核心来源初始化提供的高级 `IProcessRuntimeBootstrapOptions`，用于进程启动上下文；普通简写来源会自动安排。'
  ),
  default: t(
    'Omitted: no explicit runtime bootstrap override is configured on this launcher.',
    '省略时不为此启动器配置显式运行时启动覆盖。'
  )
}

/** Identity fields written by launcher-owned Core context or an explicit advanced override. */
const processRuntimeBootstrapMembers: Readonly<Record<string, IMemberDoc>> = {
  name: {
    summary: t(
      'Caller-selected child connection name; a held Core launch context supplies its childName or self.name before considering this override.',
      '调用方选择的子连接名称；持有的核心启动上下文优先提供子名称或自身名称，再考虑此覆盖值。'
    )
  },
  parentInstanceId: {
    summary: t(
      'Parent Peer self.instanceId issued by the owning runtime; a held Core launch context supplies its own identity automatically.',
      '所属运行时签发的父连接实例标识；持有的核心启动上下文自动提供自身身份。'
    )
  },
  generation: {
    summary: t(
      'Supervision-issued IRpcRuntimeGeneration for this launch, preserving the original generation identity rather than a caller-invented counter.',
      '监督层为本次启动签发的运行时代次，保留原代次身份，不使用调用方自建计数器。'
    ),
    default: t(
      'Omitted: no explicit generation is written unless held Core launch context supplies one.',
      '省略时不写显式代次，持有的核心启动上下文提供代次时除外。'
    )
  }
}

/** Flat configuration paths for the optional advanced bootstrap object. */
const bootstrapOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  runtimeApiBootstrap: runtimeBootstrapMember,
  ...Object.fromEntries(
    Object.entries(processRuntimeBootstrapMembers).map(([key, doc]) => [
      `runtimeApiBootstrap.${key}`,
      doc
    ])
  )
}

/** Shared authenticated listener fields inherited by reverse host registration. */
const registrationCommonMembers: Readonly<Record<string, IMemberDoc>> = {
  listen: {
    summary: t(
      'Caller-selected `IListenProcessByteChannel` from a socket adapter; it owns the bound address and supplies pending candidates.',
      '调用方从套接字适配器选择的 `IListenProcessByteChannel`，持有绑定地址并提供待接纳候选。'
    )
  },
  address: {
    summary: t(
      'Caller-selected local rendezvous address; successful listening reports its actual bound address.',
      '调用方选择的本机会合地址；监听成功后报告实际绑定地址。'
    )
  },
  serviceId: {
    summary: t(
      'Stable service owner identity issued by the caller, required for Unix rendezvous ownership.',
      '调用方签发的稳定服务所有者身份，使用本地会合路径时必需。'
    ),
    default: t(
      'Omitted for addresses without Unix rendezvous ownership; Unix paths require an explicit value.',
      '没有本地会合所有权的地址可省略；本地路径必须显式提供。'
    )
  },
  offer: {
    summary: t(
      'Local `IRpcHandshakeOffer` returned by offer preparation for this listener’s native protocol.',
      '提议准备过程为此监听者原生协议返回的本地 `IRpcHandshakeOffer`。'
    )
  },
  createConnectionContext: {
    summary: t(
      'Synchronous callback receiving each adapter-provided pending connection and returning its local peer identity and IPC diagnostic context; throws reject candidate preparation.',
      '同步回调，接收适配器提供的每个待处理连接，返回本端对端身份与通信诊断上下文；抛错会拒绝候选准备。'
    ),
    params: {
      pending: t(
        'Pending byte connection supplied by the selected listener adapter.',
        '所选监听适配器提供的待处理字节连接。'
      )
    },
    returns: t(
      'Caller-authored `{ peerId, ipc }` for that one connection, not a promise.',
      '调用方编写的此连接专属 `{ peerId, ipc }`，不能返回异步结果。'
    ),
    example: `createConnectionContext: () => ({ peerId: 'service', ipc: { connectionId: issueConnectionId(), sessionId: issueSessionId(), log: console.log } })`
  },
  verifyToken: {
    summary: t(
      'Receives the remote portable credential and handshake peer metadata; return a trusted principal string synchronously or asynchronously. Throw or rejection refuses authentication.',
      '接收远程可移植凭据与握手对端元数据，同步或异步返回可信主体字符串；抛错或拒绝会拒绝认证。'
    ),
    params: {
      auth: t(
        'Portable credential from the remote handshake, possibly undefined.',
        '来自远程握手的可移植凭据，可能为空值。'
      ),
      peer: t(
        'Peer identity metadata supplied by the native handshake.',
        '原生握手提供的对端身份元数据。'
      )
    },
    returns: t(
      'A verified principal string or its promise; never infer authorization from peer claims alone.',
      '校验后的主体字符串或其异步结果；不能只凭对端声明推断授权。'
    ),
    example: `verifyToken: async (auth, peer) => validateCredential(auth, peer)`
  },
  scheduler: {
    summary: t(
      'Caller-selected `IScheduler` from `@migaia/utils/scheduler` for handshake timing.',
      '调用方从 `@migaia/utils/scheduler` 选择、用于握手计时的 `IScheduler`。'
    ),
    default: t(
      'Omitted: the listener uses its selected runtime default scheduler.',
      '省略时监听者使用所选运行时的默认调度器。'
    )
  },
  handshakeTimeoutMs: {
    summary: t(
      'Optional handshake budget in milliseconds for each accepted candidate; this does not extend connection lifetime.',
      '每个已接受候选的可选握手毫秒预算，不延长连接生命周期。'
    )
  },
  signal: {
    summary: t(
      'Caller-owned `IAbortSignal` ending further candidate acceptance when aborted.',
      '调用方持有的 `IAbortSignal`，中止后结束后续候选接纳。'
    ),
    default: t(
      'Omitted: no external cancellation signal is attached to listening.',
      '省略时不为监听关联外部取消信号。'
    )
  }
}

/** Parent side of the quick start; the child calls `createProcessPeer({ provide })`. */
const peerExample: ICode = {
  en: `import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number } }
const service = await createProcessPeer<IServiceApi>({ spawn: new URL('./service.ts', import.meta.url) })
try {
  console.log(await service.request('math.double', 21)) // 42
} finally {
  await service.close() // closes the connection and stops the child
}`,
  zh: `import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number } }
const service = await createProcessPeer<IServiceApi>({ spawn: new URL('./service.ts', import.meta.url) })
try {
  console.log(await service.request('math.double', 21)) // 42
} finally {
  await service.close() // 关闭连接并停止子进程
}`
}

/** Host-managed example of `createProcessPlugin`. */
const pluginExample = `import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number } }
const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
  name: 'service',
  spawn: new URL('./service.js', import.meta.url)
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(service)
  console.log(await host.process!.request('service', 'math.double', 21)) // 42
  host.process!.on('exit', (event) => console.warn(event.name, event.code))
} finally {
  await host.dispose()
}`

/** Doc of a `report(error)` callback member. */
const reportMember: IMemberDoc = {
  summary: t(
    'Receives background errors that no call can reject with.',
    '接收无法通过调用 reject 的后台错误。'
  ),
  params: {
    error: t(
      'Original background failure value; preserve its source and code when present.',
      '原始后台失败值；存在来源与错误码时保留它们。'
    )
  },
  returns: t('Nothing; the error is reported.', '无返回值；错误已交给上报函数。')
}

/** Members of byte channel shapes (`IProcessByteChannel`). */
const byteChannelMembers: Readonly<Record<string, IMemberDoc>> = {
  kind: {
    summary: t(
      'Always `byte`: an ordered byte stream (stdio or socket).',
      '固定为 `byte`：有序的字节流（stdio 或 socket）。'
    )
  },
  write: {
    summary: t(
      'Writes one chunk; resolves when the carrier accepted it (back-pressure aware).',
      '写入一个数据块；载体接受后 resolve（会遵守背压）。'
    ),
    params: { chunk: t('Bytes to write.', '要写入的字节数据。') },
    returns: t('Resolves when written.', '写入完成后 resolve。'),
    example: `await channel.write(new TextEncoder().encode('hi'))`
  },
  onData: {
    summary: t('Subscribes to incoming chunks.', '订阅对端发来的每个数据块。'),
    params: { listener: t('Receives each chunk in order.', '按顺序接收每个数据块的监听函数。') },
    returns: t('A function that removes the listener.', '移除该监听的函数。'),
    example: `const stop = channel.onData((chunk) => decoder.push(chunk))`
  },
  onClose: {
    summary: t('Subscribes to the end of the carrier.', '订阅载体结束（关闭）的事件。'),
    params: {
      listener: t('Receives the close reason, if any.', '接收关闭原因（如果有）的监听函数。')
    },
    returns: t('A function that removes the listener.', '移除该监听的函数。'),
    example: `channel.onClose((reason) => console.warn('closed', reason))`
  },
  close: {
    summary: t('Closes the carrier and releases it.', '关闭该字节载体，释放底层资源。'),
    returns: t(
      'Nothing or a Promise resolved when closed.',
      '无返回值，或在关闭后 resolve 的 Promise。'
    ),
    example: `await channel.close()`
  }
}

/** Nested IPC fields stay under the original connection diagnostic owner. */
const ipcOptionDocs: Readonly<Record<string, IMemberDoc>> = {
  'ipc.connectionId': {
    summary: t(
      'Caller-issued non-secret identifier for this physical connection, copied into diagnostic records.',
      '调用方签发的此物理连接的非敏感标识，会复制到诊断记录。'
    )
  },
  'ipc.sessionId': {
    summary: t(
      'Caller-issued identifier for this logical session, allowing records from one session to be correlated.',
      '调用方签发的逻辑会话标识，用于关联同一会话的诊断记录。'
    )
  },
  'ipc.processId': {
    summary: t(
      'Optional process label issued by the caller for diagnostic correlation; it grants no authentication authority.',
      '调用方签发的可选进程标签，用于关联诊断，不提供认证授权。'
    ),
    default: t('Omitted: records have no process label.', '省略时记录不附带进程标签。')
  },
  'ipc.maxPendingData': {
    summary: t(
      'Maximum queued data frames in the canonical Core send queue; separate control capacity remains available.',
      '规范核心发送队列的数据帧排队上限，控制帧仍有独立容量。'
    ),
    default: t('256 pending data frames.', '默认允许排队 `256` 个数据帧。')
  },
  'ipc.maxPendingControl': {
    summary: t(
      'Maximum queued control frames in the canonical Core send queue, independent of data-frame capacity.',
      '规范核心发送队列的控制帧排队上限，与数据帧容量独立。'
    ),
    default: t('8 pending control frames.', '默认允许排队 `8` 个控制帧。')
  },
  'ipc.log': {
    summary: t(
      'Callback receiving each Core IIpcLogRecord; synchronous throws and Promise rejections enter the original reporter boundary.',
      '回调接收核心提供的每条 `IIpcLogRecord`；同步抛错与异步拒绝进入原有报告边界。'
    ),
    params: {
      record: t(
        'Structured, connection-labelled IPC record supplied by Core.',
        '核心提供的结构化通信记录，带连接诊断标签。'
      )
    },
    returns: t(
      'Void or Promise<void>; asynchronous completion is observed by the logging owner.',
      '返回空值或空值承诺；日志拥有者会观察异步完成。'
    )
  },
  'ipc.stderr': {
    summary: t(
      'Subscription callback for child stderr bytes. The diagnostic bridge records bounded redacted summaries rather than the raw text.',
      '子进程标准错误字节的订阅回调；诊断桥记录有界脱敏摘要，不保存原始文本。'
    ),
    params: {
      listener: t(
        'Bridge callback receiving each Uint8Array chunk from the child.',
        '桥接回调，接收子进程提供的每个字节数组块。'
      )
    },
    returns: t(
      'Unsubscribe function owned and invoked by the connection cleanup.',
      '返回取消订阅函数，由连接清理流程持有并调用。'
    ),
    default: t(
      'Omitted: no child-stderr subscription is attached.',
      '省略时不关联子进程标准错误订阅。'
    )
  }
}

/** Members shared by the common handshake options. */
const commonOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  peerId: {
    summary: t(
      'Caller-selected remote routing identity, usually from the launched process or received bootstrap; a negotiated runtime identity may supersede it.',
      '调用方选择的远端路由身份，通常来自启动进程或收到的启动数据；协商后的运行时身份可替代它。'
    )
  },
  signal: {
    summary: t(
      'Caller-owned IAbortSignal cancelling this handshake attempt; later connection ownership remains with the returned channel.',
      '调用方持有的中止信号，用于取消本次握手；后续连接所有权归返回通道。'
    ),
    default: t('Omitted: no external abort listener is attached.', '省略时不关联外部中止监听。')
  },
  handshakeTimeoutMs: {
    summary: t(
      'Finite nonnegative handshake budget in milliseconds; expiration rejects with PROCESS_HANDSHAKE_TIMEOUT.',
      '有限非负的握手毫秒预算；到期以进程握手超时错误拒绝。'
    ),
    default: t(
      '10000 ms for the Core byte or message handshake.',
      '核心字节或消息握手默认使用 `10000` 毫秒。'
    )
  },
  scheduler: {
    summary: t(
      'Caller-selected IScheduler providing monotonic time and handshake timers, forwarded to the established endpoint.',
      '调用方选择的调度器，提供单调时间与握手计时器，并传给建立后的端点。'
    ),
    default: t('Core systemScheduler.', '核心默认的系统调度器。')
  },
  report: reportMember,
  ipc: {
    summary: t(
      'Caller-authored connection and session labels plus the logging port; stderr and queue limits are optional.',
      '调用方编写的连接与会话标签及日志端口；标准错误订阅与队列限制可选。'
    )
  }
}

/** Spawn/connect launcher modules. */
const launchers = [
  [
    'node-child-process',
    'createNodeProcessLauncher',
    'Node `child_process`',
    'Node `child_process`'
  ],
  ['bun-spawn', 'createBunProcessLauncher', '`Bun.spawn`', '`Bun.spawn`'],
  [
    'deno-command',
    'createDenoProcessLauncher',
    '`Deno.Command` (needs `--allow-run`)',
    '`Deno.Command`（需要 `--allow-run`）'
  ]
] as const

/** Socket modules sharing `dialProcessByteChannel` / `listenProcessByteChannel`. */
const sockets = [
  ['node-socket', 'Node `net`', 'Node `net`'],
  ['bun-socket', 'Bun sockets', 'Bun 的 socket'],
  ['deno-socket', '`Deno.connect` / `Deno.listen`', '`Deno.connect` / `Deno.listen`']
] as const

/** Docs of `listenProcessByteChannel` (shared by every socket adapter). */
const listenSymbol: ISymbolDoc = {
  role: 'operation',
  purpose: t(
    'Listens on a local address (loopback TCP, Unix socket or Windows pipe) and hands each authenticated pending connection to `onConnection`.',
    '在本机地址（回环 TCP、Unix socket 或 Windows 命名管道）上监听，并把每个待认证的连接交给 `onConnection`。'
  ),
  params: {
    options: t(
      '`{ address, serviceId?, signal?, auth: { mode: "required", verify }, onConnection, report }`: `verify(auth, peer)` returns the principal id or throws; port `0` picks a free port.',
      '`{ address, serviceId?, signal?, auth: { mode: "required", verify }, onConnection, report }`：`verify(auth, peer)` 返回主体 id 或抛错；端口写 `0` 时由系统分配。'
    )
  },
  returns: t(
    'An `IProcessByteListener` with the actual `address` and `close()`; binding failures throw `PROCESS_CHANNEL_LISTEN_FAILED`.',
    '带实际 `address` 与 `close()` 的 `IProcessByteListener`；无法绑定时抛 `PROCESS_CHANNEL_LISTEN_FAILED`。'
  ),
  example: `const listener = await listenProcessByteChannel({
  address: 'tcp://127.0.0.1:0',
  auth: { mode: 'required', verify: (auth) => checkToken(auth) },
  onConnection: async (pending) => serve(await pending.accept(context)),
  report: console.error
})`
}

/** Docs of `dialProcessByteChannel`. */
const dialSymbol: ISymbolDoc = {
  role: 'operation',
  optionDocs: {
    address: {
      summary: t(
        'Caller-selected loopback TCP address or local Unix path. Node also accepts Windows pipe addresses; Deno rejects that address family.',
        '调用方选择的回环网络地址或本地套接字路径。节点运行时还支持视窗系统命名管道；其他对应适配器拒绝此类地址。'
      )
    },
    signal: {
      summary: t(
        'Native signal from the caller’s AbortController; abort cancels pending dialing and destroys the unconnected socket, while established channels own their later lifetime.',
        '来自调用方中止控制器的原生信号；中止取消待完成拨号并销毁未连接套接字，已建立通道自行管理后续生命周期。'
      ),
      default: t('Omitted: dialing has no external abort listener.', '省略时拨号没有外部中止监听。')
    }
  },
  purpose: t(
    'Connects to a local address and returns the raw byte channel (before any handshake).',
    '连接到本机地址，返回尚未握手的原始字节通道，之后交给 `establish` 完成认证。'
  ),
  params: {
    options: t(
      '`{ address, signal? }`: `tcp://127.0.0.1:port`, `tcp://[::1]:port`, an absolute Unix path or `\\\\.\\pipe\\name`.',
      '`{ address, signal? }`：`tcp://127.0.0.1:port`、`tcp://[::1]:port`、Unix 绝对路径或 `\\\\.\\pipe\\name`。'
    )
  },
  returns: t(
    'An `IProcessByteChannel`; failures throw `PROCESS_CHANNEL_CONNECT_FAILED` with the cause.',
    '一个 `IProcessByteChannel`；失败时抛带原因的 `PROCESS_CHANNEL_CONNECT_FAILED`。'
  ),
  example: `const raw = await dialProcessByteChannel({ address: 'tcp://127.0.0.1:4000' })`
}

/** Docs of `openProcessStdioChannel` (child side). */
const stdioSymbol: ISymbolDoc = {
  role: 'operation',
  optionDocs: {
    bootstrap: {
      summary: t(
        'Required bootstrap source policy for this public child stdio opener. Both Node and Deno implement stdin or none and explicitly reject fd.',
        '此公开子进程标准流读取函数必填的启动来源策略。两种实现均支持标准输入或无启动帧，并显式拒绝文件描述符模式。'
      ),
      values: {
        stdin: t(
          'Consume the parent-written bootstrap frame before passing the channel to handshake.',
          '先消费父进程写入的启动帧，再把通道交给握手。'
        ),
        none: t(
          'Skip bootstrap decoding and return the raw stdio channel.',
          '跳过启动帧解码，直接返回原始标准流通道。'
        ),
        fd: t(
          'Declared in the input union but rejected by these implementations with Core INVALID_CONFIG.',
          '输入联合中声明此值，但当前实现以核心无效配置错误拒绝。'
        )
      }
    },
    fd: {
      summary: t(
        'Declared file-descriptor field; these public openers do not read it because fd bootstrap mode is rejected.',
        '声明的文件描述符字段；这些公开读取函数拒绝文件描述符启动模式，因此不读取此字段。'
      ),
      default: t(
        'Omitted: no file descriptor is selected or read.',
        '省略时不会选择或读取文件描述符。'
      )
    },
    bootstrapTimeoutMs: bootstrapTimeoutMember
  },
  purpose: t(
    'Child side, advanced: opens the process own stdio as a byte channel and reads the bootstrap the parent wrote first.',
    '子进程端的高级用法：把本进程的 stdio 打开为字节通道，并先读取父进程写入的启动数据。'
  ),
  params: {
    options: t(
      '`{ bootstrap: "stdin" | "none", bootstrapTimeoutMs? }`: select bootstrap reading; fd mode is unsupported and omitted timeout installs no timer.',
      '`{ bootstrap: "stdin" | "none", bootstrapTimeoutMs? }`：选择启动帧读取方式；文件描述符模式不受支持，省略超时则不建定时器。'
    )
  },
  returns: t('`{ channel, bootstrap? }`.', '包含字节通道与启动数据的 `{ channel, bootstrap? }`。'),
  example: `const { channel, bootstrap } = await openProcessStdioChannel({ bootstrap: 'stdin' })`
}

/** Symbols of launcher and socket adapters. */
const adapterSymbols: Record<string, ISymbolDoc> = {
  ...Object.fromEntries(
    launchers.map(([, name, en, zh]) => [
      name,
      {
        role: 'factory',
        optionDocs: bootstrapOptionDocs,
        purpose: t(
          `Creates the launcher that starts child processes with ${en} for a full \`spawn\` source.`,
          `创建使用${zh}启动子进程的 launcher，用作完整 \`spawn\` 来源里监督配置中的 \`supervision.launcher\`。`
        ),
        params: {
          options: t(
            'Optional `{ runtimeApiBootstrap }`: identity written to the child bootstrap; set by short sources automatically.',
            '可选的 `{ runtimeApiBootstrap }`：写入子进程启动数据的身份；简写来源会自动设置。'
          )
        },
        returns: t(
          'An `IProcessLauncher` from `@migaia/supervision/process`, used as `supervision.launcher`.',
          '来自 `@migaia/supervision/process` 的 `IProcessLauncher`，用作 `supervision.launcher`。'
        ),
        example: `const launcher = ${name}()`
      } satisfies ISymbolDoc
    ])
  ),
  createElectronUtilityProcessLauncher: {
    role: 'factory',
    purpose: t(
      'Creates a launcher for Electron utility processes; they talk over a message channel (`channelKind: "message"`).',
      '创建在 Electron 主进程中启动 utility process 的 launcher；它们通过消息通道（`channelKind: "message"`）通信。'
    ),
    returns: t(
      'An `IProcessLauncher` whose handles carry a message `channel`.',
      '一个 `IProcessLauncher`，其句柄带有消息通道 `channel`。'
    ),
    example: `const launcher = createElectronUtilityProcessLauncher()`
  },
  createWindowsJobProcessLauncher: {
    role: 'factory',
    purpose: t(
      'Placeholder for a Windows Job object launcher; every `launch` currently rejects with `PROCESS_CHANNEL_CONNECT_FAILED`.',
      'Windows Job 对象 launcher 的占位实现，尚未经过真实验证；目前每次 `launch` 都以 `PROCESS_CHANNEL_CONNECT_FAILED` 拒绝。'
    ),
    returns: t(
      'An `IProcessLauncher` that cannot launch yet.',
      '一个暂时无法启动进程的 `IProcessLauncher`。'
    ),
    example: `const launcher = createWindowsJobProcessLauncher() // 目前 launch 一律拒绝`
  },
  'adapters/node-child-process:openProcessStdioChannel': stdioSymbol,
  'adapters/deno-command:openProcessStdioChannel': stdioSymbol,
  ...Object.fromEntries(
    sockets
      .filter(([module]) => module !== 'bun-socket')
      .flatMap(([module]) => [
        [`adapters/${module}:dialProcessByteChannel`, dialSymbol],
        [`adapters/${module}:listenProcessByteChannel`, listenSymbol]
      ])
  ),
  createAdapterChildStdio: {
    role: 'factory',
    purpose: t(
      'Wraps the stdio pipes of a Node `ChildProcess` you started as a byte channel.',
      '把你自己启动的 Node `ChildProcess` 的 stdio 管道包装成可用于握手的字节通道。'
    ),
    params: {
      child: t(
        '`{ stdout, stdin }` of the child, e.g. from `spawn(...)`.',
        '子进程的 `{ stdout, stdin }`，例如来自 `spawn(...)`。'
      )
    },
    returns: t('An `IProcessByteChannel`.', '一个可用于握手的 `IProcessByteChannel`。'),
    example: `const channel = createAdapterChildStdio(spawn('node', ['service.js'], { stdio: 'pipe' }))`
  },
  createAdapterProcessStdio: {
    role: 'factory',
    purpose: t(
      'Child side: wraps the process own `stdin` / `stdout` as a byte channel.',
      '子进程端：把本进程自己的 `stdin` / `stdout` 包装成可用于握手的字节通道。'
    ),
    params: {
      io: t(
        '`{ stdin, stdout }`, usually `process.stdin` and `process.stdout`.',
        '`{ stdin, stdout }`，通常为 `process.stdin` 与 `process.stdout`。'
      )
    },
    returns: t('An `IProcessByteChannel`.', '一个可用于握手的 `IProcessByteChannel`。'),
    example: `const channel = createAdapterProcessStdio({ stdin: process.stdin, stdout: process.stdout })`
  },
  createAdapterNodeProcessLaunch: {
    role: 'operation',
    optionDocs: bootstrapOptionDocs,
    purpose: t(
      'Advanced: performs one Node child launch for a custom launcher, returning the launch description Core expects.',
      '高级用法：为自定义 launcher 执行一次 Node 子进程启动，返回 Core 所需的启动描述。'
    ),
    params: {
      spec: t(
        'Process spec: command, args, env, stdio, bootstrap.',
        '进程启动规格：command、args、env、stdio、bootstrap。'
      ),
      context: t(
        'Launch context received by `launcher.launch(spec, context)`.',
        '`launcher.launch(spec, context)` 收到的启动上下文。'
      ),
      options: t('`{ runtimeApiBootstrap? }`.', '可选的 `{ runtimeApiBootstrap? }` 启动身份设置。')
    },
    returns: t('The launch result for Core.', '交给 Core 的启动结果。'),
    example: `launch: (spec, context) => createAdapterNodeProcessLaunch(spec, context)`
  },
  createAdapterSocketByteIO: {
    role: 'factory',
    purpose: t(
      'Wraps a Node `Duplex` stream (such as a `net.Socket`) as a byte channel.',
      '把 Node 的 `Duplex` 流（例如已连接的 `net.Socket`）包装成可用于握手的字节通道。'
    ),
    params: { socket: t('A connected `Duplex` you own.', '你持有的、已连接的 `Duplex` 流。') },
    returns: t('An `IProcessByteChannel`.', '一个可用于握手的 `IProcessByteChannel`。'),
    example: `const channel = createAdapterSocketByteIO(net.connect(4000, '127.0.0.1'))`
  }
}

/** Field docs shared by the public IRuntimeProcessPeerOptions surface and its operation options. */
const processPeerOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...runtimePeerOptionMembers,
  spawn: {
    summary: t(
      'Child to start and own: `URL`, path (relative to the main entry directory), `true` (current entry), a short object `{ entry | command, args?, wrap?, wire?, ... }`, or a full `ISpawnProcessPluginDeployment`.',
      '要启动并拥有的子进程：`URL`、路径（相对主入口目录）、`true`（当前入口）、简写对象 `{ entry | command, args?, wrap?, wire?, ... }`，或完整的 `ISpawnProcessPluginDeployment`。'
    ),
    default: t('Not set.', '不设置：不启动子进程。')
  },
  connect: {
    summary: t(
      'Running service to dial: a name (`math-service`), `tcp://127.0.0.1:port`, a Unix path, or a full connect deployment.',
      '要连接的运行中服务：名称（`math-service`）、`tcp://127.0.0.1:port`、Unix 路径，或完整的连接部署。'
    ),
    default: t('Not set.', '不设置：不主动连接服务。')
  },
  listen: {
    summary: t(
      'Address or name to accept sessions on; each session is its own connection.',
      '用于接受会话的地址或名称；每个会话都是独立的连接。'
    ),
    default: t('Not set.', '不设置：不监听任何地址。')
  },
  report: {
    ...reportMember,
    default: t('`console.error`.', '`console.error`：输出到控制台。')
  },
  token: {
    summary: t(
      'Shared secret checked in the handshake; required for TCP, explicit socket paths and Windows pipes. Generate it per deployment and never log it.',
      '握手中校验的共享密钥；TCP、显式 socket 路径与 Windows 命名管道必须设置。每次部署生成，切勿写入日志。'
    ),
    default: t(
      'Not set: named endpoints rely on OS user permissions.',
      '不设置：命名端点依赖操作系统的用户权限。'
    )
  },
  verify: {
    summary: t(
      'Listener side: `(auth, peer) => principalId` validating the client credential; throw to reject.',
      '监听端：校验客户端凭据的 `(auth, peer) => principalId`；抛错表示拒绝。'
    ),
    params: {
      auth: t(
        'Portable credential from the incoming handshake, possibly undefined.',
        '传入握手提供的可移植凭据，可能为空值。'
      ),
      peer: t(
        'Handshake peer metadata supplied by the accepted transport.',
        '已接受传输提供的握手对端元数据。'
      )
    },
    returns: t(
      'Verified principal string or its Promise; throw or rejection refuses the candidate.',
      '返回已验证主体字符串或其承诺；抛错或拒绝会拒绝候选。'
    ),
    default: t('Not set: the `token` comparison is used.', '不设置：使用 `token` 比较。')
  },
  connectTimeoutMs: {
    summary: t(
      'How long a named `connect` waits for the listener to appear.',
      '按名称 `connect` 时等待监听方出现的时长。'
    ),
    default: t('`5000`.', '默认值为 `5000` 毫秒。')
  }
}

/** Field docs shared by the public IProcessPluginOptions surface and its operation options. */
const processPluginOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  name: { summary: t('Plugin name in the host.', '插件在宿主中登记的名称。') },
  contract: { summary: t('Declared remote methods.', '对端远程方法的声明契约。') },
  registrationOwner: {
    summary: t(
      'Host that owns and may liquidate this registration.',
      '拥有并可能清算该登记的宿主。'
    )
  },
  resilience: {
    summary: t(
      'Caller-owned governance from createProcessResilience, borrowed by this plugin rather than closed with it.',
      '调用方通过进程治理工厂取得的治理对象，由插件借用，不随插件关闭。'
    ),
    default: t(
      'Omitted: create and own a governor using the deployment scheduler and report callback.',
      '省略时使用部署调度器与报告回调创建并持有治理对象。'
    )
  },
  host: {
    summary: t(
      'Host port used to install and replace the plugin.',
      '用于安装与替换插件的宿主端口。'
    )
  },
  endpointFactory: {
    ...runtimePeerOptionMembers.endpointFactory!,
    default: t(
      'Required in the full deployment overload; no endpoint factory is inferred.',
      '完整部署重载必填，不推导端点工厂。'
    )
  },
  report: reportMember,
  keyFactory: {
    summary: t(
      'Synchronous callback returning an idempotency key when the full deployment remote proxy automatically keys an idempotent call.',
      '同步回调，在完整部署的远程代理为幂等调用自动分配键时返回幂等键。'
    ),
    returns: t(
      'Application-issued string key for that call.',
      '返回为本次调用签发的应用字符串键。'
    ),
    default: t('Omitted: the proxy uses defaultRpcId.', '省略时代理使用默认远程标识工厂。')
  },
  retryPort: {
    summary: t(
      'Caller-provided IRemoteRetryPort dispatching full-deployment proxy retries through the original binding.',
      '调用方提供的远程重试端口，通过原绑定派发完整部署代理的重试。'
    ),
    default: t(
      'Omitted: createRemoteRetryPort uses the binding events, scheduler and reporter.',
      '省略时重试端口工厂使用绑定事件、调度器与报告函数。'
    )
  },
  deployment: {
    summary: t('Spawn or connect deployment.', '进程的部署方式：spawn 或 connect 部署对象。')
  }
}

/** Field docs shared by the public IProcessByteOptions surface and its operation options. */
const processByteOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...commonOptionMembers,
  role: {
    summary: t(
      'Explicit local handshake role: initiator sends an offer, while responder supplies both an offer and an authentication decision.',
      '显式本端握手角色：发起方发送提议，响应方同时提供提议与认证决策。'
    ),
    values: {
      initiator: t(
        'Start the byte handshake using this side’s explicit offer.',
        '使用本端显式提议开始字节握手流程。'
      ),
      responder: t(
        'Answer the byte handshake and enforce the declared auth policy.',
        '响应字节握手并执行声明的认证策略。'
      )
    }
  },
  offer: {
    summary: t(
      'Local `IRpcHandshakeOffer` returned by the selected offer preparation helper or authored from `@migaia/rpc-contract` policy; both roles must supply it.',
      '由所选提议准备函数返回，或按 `@migaia/rpc-contract` 策略编写的本地握手提议；双方角色都必须提供。'
    )
  },
  auth: {
    summary: t(
      'Responder-only authentication union: mode required invokes `verify(auth, peer)` with portable credentials and handshake peer metadata; return a principal string or void, synchronously or asynchronously. Throw/rejection refuses the handshake. Mode none explicitly skips authentication.',
      '仅响应方使用的认证联合：必需模式用可移植凭据与握手对端元数据调用 `verify(auth, peer)`，同步或异步返回主体字符串或空值；抛错或拒绝会拒绝握手。无认证模式显式跳过认证。'
    ),
    params: {
      auth: t(
        'Portable credential value received from the initiator, possibly undefined.',
        '从发起方收到的可移植凭据值，可能为空值。'
      ),
      peer: t(
        'Peer metadata supplied by the handshake boundary from `@migaia/rpc-contract`.',
        '握手边界从 `@migaia/rpc-contract` 提供的对端元数据。'
      )
    },
    returns: t(
      'Verified principal string or void, optionally promised; a failure rejects the handshake.',
      '已校验主体字符串或空值，可为异步结果；失败会拒绝握手。'
    )
  }
}

/** Field docs shared by the public IProcessMessageOptions surface and its operation options. */
const processMessageOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  ...commonOptionMembers,
  staticAgreement: {
    summary: t(
      'Fixed capabilities agreed by both sides (no negotiation).',
      '双方事先约定的固定能力（不再协商）。'
    )
  }
}

/** Field docs shared by the public IProcessResilienceOptions surface and its operation options. */
const processResilienceOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  scheduler: {
    summary: t(
      'Clock for rate windows, idle and drain timers.',
      '用于速率窗口、空闲与排空计时的时钟。'
    )
  },
  report: reportMember,
  idempotencyStore: {
    summary: t(
      'Store of results for `idempotencyKey` calls.',
      '保存带 `idempotencyKey` 调用结果的存储。'
    ),
    default: t('An in-memory store.', '内存中的存储。')
  },
  maxConnections: {
    summary: t('Connections accepted at once.', '同时接受的连接数上限。'),
    default: t('`64`.', '默认值为 `64` 个连接。')
  },
  maxConcurrentCallsPerConnection: {
    summary: t('Calls running at once per connection.', '每个连接同时运行的调用数上限。'),
    default: t('`32`.', '默认值为 `32` 个调用。')
  },
  maxCallsPerMinute: {
    summary: t('Calls per connection per minute.', '每个连接每分钟的调用次数上限。'),
    default: t('`600`.', '默认值为 `600` 次。')
  },
  maxPayloadBytes: {
    summary: t('Largest payload accepted.', '可接受的最大参数字节数。'),
    default: t('16 MiB.', '默认值为 16 MiB。')
  },
  maxConsecutiveTimeouts: {
    summary: t('Timeouts in a row that close the connection.', '连续超时达到该次数时关闭该连接。'),
    default: t('`3`.', '默认值为 `3` 次。')
  },
  idleTimeoutMs: {
    summary: t('Idle time after which a session closes.', '会话空闲多久后关闭（毫秒）。'),
    default: t('`60000`.', '默认值为 `60000` 毫秒。')
  },
  drainMs: {
    summary: t(
      'Time accepted calls get to finish when closing.',
      '关闭时留给已接受调用完成的时间。'
    ),
    default: t('`5000`.', '默认值为 `5000` 毫秒。')
  },
  reportAtMs: {
    summary: t(
      'When to report a terminal registration again (relative times).',
      '对终态登记再次上报的时间点（相对时间）。'
    ),
    default: t('`[0, 60000, 300000, 900000]`.', '默认值为 `[0, 60000, 300000, 900000]`。')
  },
  unhandledLimit: {
    summary: t(
      'Unhandled terminal reports before liquidation starts.',
      '开始清算前允许的未处理终态上报次数。'
    ),
    default: t('`3`.', '默认值为 `3` 次。')
  },
  liquidation: {
    summary: t(
      '`{ cascade }`: also remove plugins depending on the liquidated one.',
      '`{ cascade }`：同时移除依赖被清算插件的插件。'
    ),
    default: t('`cascade: false`: dependants are suspended.', '`cascade: false`：依赖方被挂起。')
  }
}

/** Core plugin fields keep host control behind the explicit exposure whitelist. */
const processRuntimePluginMembers: Readonly<Record<string, IMemberDoc>> = {
  ...processPeerOptionMembers,
  name: {
    summary: t(
      'Caller-selected nonempty registration name copied when constructing the cold plugin; use the same name when addressing host.process.',
      '调用方选择的非空登记名称，在构造冷插件时复制；通过宿主进程扩展寻址时使用同名。'
    )
  },
  expose: {
    summary: t(
      'Distinct nonempty paths explicitly exposing current Host feature methods, runtime connection routes or the reserved host control entry. Only this snapshotted whitelist becomes remotely callable.',
      '显式暴露当前宿主特性方法、运行时连接路由或保留宿主控制入口的路径，不得重复或为空；只有此快照白名单可被远程调用。'
    ),
    default: t(
      'Omitted: an empty whitelist; only provide methods are published.',
      '省略时白名单为空，仅发布显式提供的方法。'
    )
  },
  host: {
    summary: t(
      'The same actual PluginHost handle into which this plugin is installed, supplying use, unUse, plugin and revision for explicit host exposure.',
      '安装本插件的同一真实插件宿主句柄，为显式宿主暴露提供安装、移除、插件检查与版本端口。'
    ),
    default: t(
      'Omitted: allowed unless expose contains host; explicit host exposure requires host, catalog and resolvePlugin together.',
      '省略时可正常使用，但白名单含宿主控制入口时必须同时提供宿主、目录和插件解析器。'
    )
  },
  catalog: {
    summary: t(
      'Application-authored IRemoteHostCatalog declaring the only plugin contracts available through explicitly exposed host control.',
      '应用编写的远程宿主目录，声明显式宿主控制可使用的插件契约范围。'
    ),
    default: t(
      'Omitted: no host-control catalog; required when expose contains host.',
      '省略时没有宿主控制目录；白名单包含宿主入口时必填。'
    )
  },
  resolvePlugin: {
    summary: t(
      'Synchronous local resolver invoked by the canonical host-control owner after catalog admission; definitions remain local and are installed through the original Host.',
      '同步本地解析器，在目录接纳后由规范宿主控制拥有者调用；定义保留本地，通过原宿主安装。'
    ),
    params: {
      name: t('Plugin name admitted by the declared catalog.', '已通过声明目录接纳的插件名称。'),
      config: t(
        'Optional portable configuration from the remote host-use request.',
        '来自远程宿主安装请求的可选可移植配置。'
      )
    },
    returns: t(
      'Local plugin definition accepted by the Host; a thrown error rejects the host-use request.',
      '返回宿主可接受的本地插件定义；抛错会拒绝远程安装请求。'
    ),
    default: t(
      'Omitted: no local resolver; required when expose contains host.',
      '省略时没有本地解析器；白名单包含宿主入口时必填。'
    )
  }
}

/** Full and runtime plugin overloads share only the configuration paths they actually accept. */
const processPluginDocs: Readonly<Record<string, IMemberDoc>> = {
  ...processPluginOptionMembers,
  ...processRuntimePluginMembers,
  contract: {
    summary: t(
      'Application remote contract. Required and matched to name for a full deployment; optional for runtime sources, where provide normally supplies the directory.',
      '应用远程契约；完整部署要求提供并与登记名称一致，运行时来源可省略并通常从提供的方法推导目录。'
    ),
    default: runtimePeerOptionMembers.contract!.default!
  },
  host: {
    summary: t(
      'Full deployment: Host port owning installation and replacement. Runtime form: the actual installing Host, needed only when exposing host control with catalog and resolvePlugin.',
      '完整部署中为拥有安装与替换的宿主端口；运行时形式中为实际安装宿主，仅在配合目录与解析器暴露宿主控制时需要。'
    ),
    default: processRuntimePluginMembers.host!.default!
  },
  endpointFactory: {
    ...runtimePeerOptionMembers.endpointFactory!,
    summary: t(
      'Endpoint factory called with the acquired channel and abort signal; mandatory for full deployments, while runtime sources can use canonical endpoint assembly.',
      '端点工厂接收取得的通道与中止信号；完整部署必填，运行时来源可使用规范端点组装。'
    )
  },
  keyFactory: {
    ...processPluginOptionMembers.keyFactory!,
    summary: t(
      'Full deployment proxy key callback for automatically keyed idempotent calls. Runtime form forwards this inherited field; direct Peer assembly does not read it.',
      '完整部署代理为幂等调用自动分配键的回调；运行时形式转发此继承字段，直接连接组装本身不读取它。'
    )
  },
  retryPort: {
    ...processPluginOptionMembers.retryPort!,
    summary: t(
      'Advanced full-deployment remote-proxy retry port. Runtime form forwards the inherited field, while direct Peer assembly keeps its own call path.',
      '高级完整部署远程代理重试端口；运行时形式转发继承字段，直接连接组装保留自身调用路径。'
    )
  },
  'registrationOwner.name': {
    summary: t(
      'The exact plugin name whose Host registration the resilience owner may liquidate; must equal the full options name.',
      '治理拥有者可以清算的精确宿主插件登记名，必须等于完整选项中的名称。'
    )
  },
  'registrationOwner.host': {
    summary: t(
      'Caller-owned dependency Host port with unUse for removing that exact registration and handling dependant policy.',
      '调用方持有的依赖宿主端口，提供移除方法，用于移除此精确登记并处理依赖策略。'
    )
  }
}

/** Resilience configuration retains a single governor and its existing liquidation policy. */
const processResilienceDocs: Readonly<Record<string, IMemberDoc>> = {
  ...processResilienceOptionMembers,
  'liquidation.cascade': {
    summary: t(
      'Whether terminal liquidation also removes dependent registrations through the existing Host dependency owner.',
      '终态清算是否通过现有宿主依赖拥有者同时移除依赖此登记的其他登记。'
    ),
    default: t(
      'False: dependants are suspended instead of cascade removal.',
      '默认假值，依赖方被挂起，不执行级联移除。'
    ),
    values: {
      true: t(
        'Remove dependants together with the terminal registration.',
        '移除终态登记时一并移除依赖方。'
      ),
      false: t(
        'Keep dependant registrations and let the Host suspend them.',
        '保留依赖方登记，由宿主挂起它们。'
      )
    }
  }
}

/** JSON-RPC bridge options use the caller clocks and strict contract target, not native auth. */
const processJsonRpcMembers: Readonly<Record<string, IMemberDoc>> = {
  ...commonOptionMembers,
  byte: {
    summary: t(
      'Caller-owned ordered IProcessByteChannel returned by a launcher, socket adapter or stdio wrapper, with kind byte.',
      '调用方从启动器、套接字适配器或标准流包装器取得的有序进程字节通道，种类必须为字节。'
    )
  },
  target: {
    summary: t(
      'Explicit plugin contract or host catalog target: plugin requires contract only, while host requires catalog only. Stream declarations are rejected.',
      '显式插件契约或宿主目录目标；插件种类仅接受契约，宿主种类仅接受目录，流调用声明会被拒绝。'
    )
  },
  offer: {
    summary: t(
      'Caller-authored native offer without auth or codecs. The bridge inserts the token, JSON codec and required JSON-RPC capabilities.',
      '调用方编写的不含认证载荷与编解码器的提议；桥接器加入令牌、JSON 编解码器和必需能力。'
    )
  },
  token: {
    summary: t(
      'Nonempty credential issued by the deployment owner and expected by the JSON-RPC peer; copied into the bridge handshake, never diagnostic output.',
      '部署拥有者签发、由 JSON-RPC 对端校验的非空凭据；放入桥接握手，不进入诊断输出。'
    )
  },
  scheduler: {
    summary: t(
      'Required caller-selected IScheduler for handshake deadline and established connection tasks; no clock is inferred by this bridge.',
      '调用方必填的调度器，用于握手期限与已建立连接的任务；桥接器不推导时钟。'
    )
  },
  wallClock: {
    summary: t(
      'Required caller-selected IWallClock supplying timestamp() for outgoing JSON-RPC message sentAt metadata, distinct from monotonic scheduling.',
      '调用方必填的墙上时钟，通过时间戳方法提供出站 JSON-RPC 消息的发送时间元数据，与单调调度时钟独立。'
    )
  },
  handshakeTimeoutMs: {
    summary: t(
      'Finite nonnegative millisecond budget for the initial JSON-RPC bridge handshake; it does not bound later method calls.',
      '初始 JSON-RPC 桥接握手的有限非负毫秒预算，不限制后续方法调用。'
    ),
    default: t(
      '10000 ms from JsonRpcLimit.handshakeMs.',
      '默认使用 JSON-RPC 限制表中的 `10000` 毫秒。'
    )
  }
}

/** Flat paths keep bridge-specific discriminants and nested diagnostic inputs visible. */
const processJsonRpcDocs: Readonly<Record<string, IMemberDoc>> = {
  ...processJsonRpcMembers,
  ...ipcOptionDocs,
  'target.kind': {
    summary: t(
      'Required discriminant selecting the one target contract grammar.',
      '必填判别字段，选择唯一一种目标契约格式。'
    ),
    values: {
      plugin: t('Use target.contract for a single declared plugin.', '通过目标契约声明单个插件。'),
      host: t(
        'Use target.catalog for the declared Host plugin set.',
        '通过目标目录声明宿主插件集合。'
      )
    }
  },
  'target.contract': {
    summary: t(
      'Application-owned IRemoteContract required only for kind plugin; normalized before channel effects and must not require streams.',
      '仅插件目标必填的应用远程契约，在通道产生副作用前规范化，不能要求流能力。'
    )
  },
  'target.catalog': {
    summary: t(
      'Application-owned IRemoteHostCatalog required only for kind host; every declared contract is normalized and checked for unsupported streams.',
      '仅宿主目标必填的应用远程宿主目录；逐项规范化契约并检查不受支持的流能力。'
    )
  }
}

/** Both transport overloads retain their original byte-auth or static-message policy. */
const processTransportDocs: Readonly<Record<string, IMemberDoc>> = {
  ...processByteOptionMembers,
  ...processMessageOptionMembers,
  ...ipcOptionDocs,
  'auth.mode': {
    summary: t(
      'Explicit responder authentication policy; initiator options carry no auth decision object.',
      '显式响应方认证策略；发起方选项不携带认证决策对象。'
    ),
    values: {
      required: t(
        'Verify initiator credentials and reject throw or rejection.',
        '校验发起方凭据，抛错或拒绝会拒绝握手。'
      ),
      none: t(
        'Explicitly perform the handshake without credential verification.',
        '显式在不校验凭据的情况下执行握手。'
      )
    }
  },
  'auth.verify': {
    ...processByteOptionMembers.auth!,
    summary: t(
      'Required-mode responder callback receiving remote portable auth and IRpcPeerInfo; return a principal string or void, synchronously or by Promise. Failure rejects authentication.',
      '必需模式的响应方回调，接收远端可移植凭据与握手身份，同步或异步返回主体字符串或空值；失败会拒绝认证。'
    )
  },
  'staticAgreement.local': {
    summary: t(
      'Caller-authored local static message profile, declared before any message transport activation.',
      '调用方编写的本端静态消息配置，在激活消息传输前声明。'
    )
  },
  'staticAgreement.peer': {
    summary: t(
      'Caller-authored expected peer profile; codec and capability order must exactly match the local profile.',
      '调用方编写的预期对端配置；编解码器与能力顺序必须和本端完全一致。'
    )
  },
  ...Object.fromEntries(
    ['local', 'peer'].flatMap((side) => [
      [
        `staticAgreement.${side}.codec`,
        {
          summary: t(
            'Fixed identity codec for an already-framed message transport; any other codec rejects configuration.',
            '已分帧消息传输固定使用原值编解码器，其他编解码器会导致配置拒绝。'
          ),
          values: {
            identity: t(
              'Preserve the carrier message value without byte encoding.',
              '保留载体消息值，不进行字节编码。'
            )
          }
        }
      ],
      [
        `staticAgreement.${side}.capabilities`,
        {
          summary: t(
            'Caller-declared ordered capability list. Local and peer arrays must match element for element; no byte negotiation fills missing entries.',
            '调用方声明的有序能力列表；双方数组必须逐项一致，不通过字节协商补入缺失能力。'
          )
        }
      ]
    ])
  )
}

/** Reference of `@migaia/rpc-process`. */
export const rpcProcessReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Cross-process RPC. Start from `createProcessPeer({ spawn | connect | listen, provide })`: spawn a child (Node, Bun, Deno, Python over JSON-RPC) or reach a local service by name or address, then call it with `request` / `notify` / `stream`. `createProcessPlugin()` hands it to a PluginHost (`host.process`).',
        '跨进程 RPC。从 `createProcessPeer({ spawn | connect | listen, provide })` 开始：启动子进程（Node、Bun、Deno，或通过 JSON-RPC 的 Python），或按名称、地址连接本机服务，然后用 `request` / `notify` / `stream` 调用。`createProcessPlugin()` 把它交给 PluginHost 管理（`host.process`）。'
      ),
      example: peerExample
    },
    ...Object.fromEntries(
      launchers.map(([module, name, en, zh]) => [
        `adapters/${module}`,
        {
          summary: t(
            `Launcher with ${en} (\`${name}\`) and the child-side \`openProcessStdioChannel\` for full sources.`,
            `基于${zh}启动子进程的 launcher（\`${name}\`），以及供完整来源在子进程端读取自身 stdio 的 \`openProcessStdioChannel\`。`
          ),
          example: `import { ${name} } from '@migaia/rpc-process/adapters/${module}'`
        }
      ])
    ),
    ...Object.fromEntries(
      sockets.map(([module, en, zh]) => [
        `adapters/${module}`,
        {
          summary: t(
            `Local sockets with ${en}: \`dialProcessByteChannel\` and \`listenProcessByteChannel\` (loopback TCP, Unix socket, Windows pipe).`,
            `基于${zh}的本机 socket 适配：拨号函数 \`dialProcessByteChannel\` 与监听函数 \`listenProcessByteChannel\`，支持回环 TCP、Unix socket 与 Windows 命名管道。`
          ),
          example: `import { dialProcessByteChannel, listenProcessByteChannel } from '@migaia/rpc-process/adapters/${module}'`
        }
      ])
    ),
    'adapters/electron-utility-process': {
      summary: t(
        'Electron utility process launcher; requires `electron`.',
        '在 Electron 主进程中启动 utility process 的 launcher，通过消息通道通信；需要安装 `electron`。'
      ),
      example: `import { createElectronUtilityProcessLauncher } from '@migaia/rpc-process/adapters/electron-utility-process'`
    },
    'adapters/windows-job': {
      summary: t(
        'Placeholder Windows Job launcher; `launch` always rejects for now. Requires `koffi`.',
        'Windows Job 对象 launcher 的占位实现，尚未经过真实验证，目前 `launch` 总是拒绝。需要安装 `koffi`。'
      ),
      example: `import { createWindowsJobProcessLauncher } from '@migaia/rpc-process/adapters/windows-job'`
    }
  },
  symbols: {
    createProcessPeer: {
      role: 'factory',
      optionDocs: processPeerOptionMembers,
      purpose: t(
        'Opens a Runtime Peer to another process. Choose exactly one source: `spawn` (start and own a child), `connect` (dial a running service) or `listen` (accept sessions). A child started by the library may omit the source to connect back. Resolves after the authenticated handshake.',
        '打开一个与另一个进程通信的 Runtime Peer。三种来源必须且只能选择一种：`spawn`（启动并拥有子进程）、`connect`（连接运行中的服务）或 `listen`（接受会话）。由本库启动的子进程可以省略来源以连回父进程。认证握手完成后 resolve。'
      ),
      params: {
        options: t(
          'See `IRuntimeProcessPeerOptions`: the source, `provide`, `report` (default `console.error`), `token`, `verify`, `connectTimeoutMs`, `defaultTimeoutMs` (default 30000) and the Core Peer options.',
          '见 `IRuntimeProcessPeerOptions`：来源、`provide`、`report`（默认 `console.error`）、`token`、`verify`、`connectTimeoutMs`、`defaultTimeoutMs`（默认 30000）以及 Core Peer 的通用选项。'
        )
      },
      returns: t(
        'An `IRuntimeTypedPeer<TRemote>`. `close()` stops accepting calls, lets accepted calls finish, closes the connection, and also stops a spawned child.',
        '一个 `IRuntimeTypedPeer<TRemote>`。`close()` 停止接受新调用，等待已接受的调用完成后关闭连接；spawn 来源还会停止子进程。'
      ),
      example: peerExample,
      scenarios: [
        t(
          'Isolate CPU-heavy or crash-prone work in a child process.',
          '把耗费 CPU 或容易崩溃的工作隔离到子进程中。'
        ),
        t(
          'Let a CLI call a resident daemon on the same machine by name.',
          '让命令行工具按名称调用同一台机器上的常驻守护进程。'
        ),
        t(
          'Call a Python or Go process that speaks JSON-RPC (`spawn.wire: "jsonrpc"`).',
          '调用使用 JSON-RPC 的 Python 或 Go 进程（`spawn.wire: "jsonrpc"`）。'
        )
      ],
      avoid: [
        t(
          'Threads in the same process: use `@migaia/rpc-threads` (zero-copy transfer).',
          '同一进程内的线程：请使用 `@migaia/rpc-threads`（支持零拷贝转移）。'
        ),
        t(
          'Other machines: sockets only accept local addresses.',
          '跨机器通信：socket 只接受本机地址。'
        )
      ]
    },
    createProcessPlugin: {
      role: 'enhancer',
      optionDocs: processPluginDocs,
      purpose: t(
        'Creates a plugin that installs one process connection into a PluginHost; the host owns it and gains `host.process`. The advanced overload takes a full `IProcessPluginOptions` remote-plugin deployment.',
        '创建把一个进程连接安装进 PluginHost 的插件；宿主持有该连接并获得 `host.process`。高级重载接受完整的 `IProcessPluginOptions` 远程插件部署。'
      ),
      params: {
        options: t(
          'Usually the same `spawn` / `connect` / `listen` / `provide` as `createProcessPeer`, plus `name` and optional `expose`; or a full `IProcessPluginOptions`.',
          '通常与 `createProcessPeer` 相同的 `spawn` / `connect` / `listen` / `provide`，另加 `name` 与可选的 `expose`；或完整的 `IProcessPluginOptions`。'
        )
      },
      returns: t('A plugin for `host.use()`.', '可传给 `host.use()` 的插件对象。'),
      example: pluginExample
    },
    isProcessChild: {
      role: 'operation',
      purpose: t(
        'Tells whether this entry was started by a library launcher, so one file can branch for `spawn: true`. It grants no trust; authentication still happens in the handshake.',
        '判断当前入口是否由本库 launcher 启动，使同一个文件可以在 `spawn: true` 时分支。它不授予信任，认证仍在握手中完成。'
      ),
      returns: t('`true` in a library-launched child.', '在由本库启动的子进程中返回 `true`。'),
      example: `if (isProcessChild()) await createProcessPeer({ provide: { echo: (value: string) => value } })
else {
  const child = await createProcessPeer<{ echo(value: string): string }>({ spawn: true })
  console.log(await child.request('echo', 'hello'))
  await child.close()
}`
    },
    createProcessResilience: {
      role: 'factory',
      optionDocs: processResilienceDocs,
      purpose: t(
        'Creates the governance owner for process connections: connection, call-rate and payload limits, idle and timeout handling, terminal diagnostics and liquidation. Pass it as `resilience` to plugins or listeners.',
        '创建进程连接的治理对象：连接数、调用速率与参数大小限制，空闲与超时处理，终态诊断与清算。把它作为 `resilience` 传给插件或监听器。'
      ),
      params: {
        options: t(
          '`IProcessResilienceOptions`: `scheduler`, `report` and optional limits.',
          '选项 `IProcessResilienceOptions`：`scheduler`、`report` 以及可选的各项限制。'
        )
      },
      returns: t(
        'An `IProcessResilience`; bad limits throw `PROCESS_RESILIENCE_INVALID_OPTION`.',
        '一个 `IProcessResilience`；限制配置不合法时抛 `PROCESS_RESILIENCE_INVALID_OPTION`。'
      ),
      example: `const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error, maxConnections: 16 })`,
      scenarios: [
        t(
          'Protect a shared daemon from clients that open too many connections or send huge payloads.',
          '保护共享的守护进程，防止客户端打开过多连接或发送过大参数。'
        )
      ]
    },
    createProcessTransport: {
      role: 'operation',
      optionDocs: processTransportDocs,
      purpose: t(
        'Establishes a raw byte channel with its explicit handshake policy, or a message channel with matching static profiles; used in establish of full sources.',
        '按显式握手策略建立原始字节通道，或按一致静态配置建立消息通道；用于完整来源的建立回调。'
      ),
      params: {
        channel: t(
          'Raw channel from a launcher handle, `dialProcessByteChannel` or stdio.',
          '来自 launcher 句柄、`dialProcessByteChannel` 或 stdio 的原始通道。'
        ),
        options: t(
          '`IProcessByteOptions`: `role`, `offer`, `peerId`, `auth` (responder), `scheduler`, `signal`, `ipc`, `report`.',
          '握手选项 `IProcessByteOptions`：`role`、`offer`、`peerId`、`auth`（响应方）、`scheduler`、`signal`、`ipc`、`report`。'
        )
      },
      returns: t(
        'The established channel; bad credentials throw `PROCESS_CHANNEL_AUTH_REJECTED`, slow handshakes `PROCESS_HANDSHAKE_TIMEOUT`.',
        '建立好的通道；凭据错误抛 `PROCESS_CHANNEL_AUTH_REJECTED`，握手超时抛 `PROCESS_HANDSHAKE_TIMEOUT`。'
      ),
      example: `establish: (raw, prepared) => createProcessTransport(raw as IProcessByteChannel, {
  role: 'initiator',
  offer: prepared.offer!,
  peerId: prepared.session.processId!,
  scheduler: prepared.scheduler,
  ipc: { ...prepared.session, log: () => undefined },
  report: console.error
})`
    },
    createNativeProcessOffer: {
      role: 'operation',
      optionDocs: {
        peer: {
          summary: t(
            'Caller-issued local `IRpcPeerInfo` identity containing id and runtime; copied and frozen into the returned offer.',
            '调用方签发的本地 `IRpcPeerInfo` 身份，含标识与运行时；复制并冻结到返回提议中。'
          )
        },
        auth: {
          summary: t(
            'Optional credential from the caller’s handshake authentication policy; passed unchanged into the offer when supplied.',
            '调用方握手认证策略提供的可选凭据；提供时原样放入握手提议。'
          ),
          default: t(
            'Omitted: the offer carries no authentication payload.',
            '省略时握手提议不携带认证载荷。'
          )
        },
        stream: {
          summary: t(
            'Whether to advertise stream immediately. Explicit false also prevents stream from later runtime defaults; omitted may receive the installed Core default at runtime.',
            '是否立即宣告流能力。显式假值也阻止后续运行时默认补入流能力；省略时可在运行时取得已安装核心默认值。'
          ),
          default: t(
            'Omitted: no immediate stream entry, but runtime-default completion may add it.',
            '省略时不立即加入流条目，但运行时默认补全可以加入。'
          ),
          values: {
            true: t(
              'Advertise stream capability in this offer immediately.',
              '立即在当前握手提议中宣告流能力。'
            ),
            false: t(
              'Do not add stream from runtime defaults when completing this offer.',
              '补全提议时不从运行时默认能力加入流。'
            )
          }
        },
        capabilities: {
          summary: t(
            'Caller-supplied extension capabilities appended to ping, close and batch, then deduplicated. An explicit empty list keeps the proposal intentionally narrow.',
            '调用方扩展能力列表，追加到探活、关闭和批处理后去重。显式空列表表示有意保持较窄提议。'
          ),
          default: t(
            'Omitted: retain a marker allowing installed Core runtime defaults to complete this offer.',
            '省略时保留允许已安装核心运行时默认能力补全提议的标记。'
          )
        }
      },
      purpose: t(
        'Builds the native handshake offer: ping, close and batch, plus stream and extra capabilities when requested.',
        '构建原生握手提议：默认包含 ping、close 与 batch，按需加上 stream 与其它扩展能力。'
      ),
      params: {
        options: t(
          '`{ peer, auth?, stream?, capabilities? }`; `peer` is `{ id, runtime }` of this side.',
          '`{ peer, auth?, stream?, capabilities? }`；`peer` 为本端的 `{ id, runtime }`。'
        )
      },
      returns: t('A frozen `IRpcHandshakeOffer`.', '冻结的握手提议 `IRpcHandshakeOffer`。'),
      example: `const offer = createNativeProcessOffer({ peer: { id: 'cli', runtime: 'node' }, stream: true })`
    },
    createProcessJsonRpcChannel: {
      role: 'operation',
      optionDocs: processJsonRpcDocs,
      purpose: t(
        'Bridges a byte channel to a JSON-RPC peer (Python, Go...) and returns a protocol channel.',
        '把字节通道桥接到 JSON-RPC 对端（Python、Go 等其它语言），握手后返回协议通道。'
      ),
      params: {
        options: t(
          '`IProcessJsonRpcChannelOptions`: `byte`, `peerId`, `target`, `offer`, `token`, `scheduler`, `wallClock`, `ipc`, `handshakeTimeoutMs?`, `signal?`, `report`.',
          '选项 `IProcessJsonRpcChannelOptions`，包含 `byte`、`peerId`、`target`、`offer`、`token`、`scheduler`、`wallClock`、`ipc`、`handshakeTimeoutMs?`、`signal?`、`report`。'
        )
      },
      returns: t(
        'A channel; `stream` and `transfer` are not supported over JSON-RPC.',
        '一个通道；JSON-RPC 下不支持 `stream` 与 `transfer`。'
      ),
      example: `const channel = await createProcessJsonRpcChannel({ byte, peerId: 'py', target, offer, token, scheduler, wallClock, ipc, report })`
    },
    createProcessChannelClosedError: {
      role: 'operation',
      purpose: t(
        'Creates the native `PROCESS_CHANNEL_CLOSED` error for custom channels, keeping `cause`.',
        '为自定义通道创建原生的 `PROCESS_CHANNEL_CLOSED` 错误，并把原始原因保留在 `cause` 上。'
      ),
      params: { cause: t('Original reason, kept on `cause`.', '原始原因，保存在 `cause` 上。') },
      returns: t('The error, not thrown.', '创建好的错误对象，不会被抛出。'),
      example: `throw createProcessChannelClosedError(reason)`
    },
    openProcessObjectChannel: {
      role: 'operation',
      optionDocs: { ...commonOptionMembers, ...ipcOptionDocs },
      purpose: t(
        'Opens a held Core object connection with process diagnostics (for message-based carriers).',
        '以进程诊断信息打开持有的 Core 对象连接（用于基于消息的载体）。'
      ),
      params: {
        connection: t('The Core object connection to open.', '要打开的 Core 对象连接。'),
        options: t('`IProcessCommonOptions`.', '通用握手选项 `IProcessCommonOptions`。')
      },
      returns: t('The opened connection result.', '打开后的连接结果。'),
      example: `await openProcessObjectChannel(connection, { peerId, report: console.error, ipc })`
    },
    receiveAdapterBootstrap: {
      role: 'operation',
      optionDocs: {
        bootstrapTimeoutMs: bootstrapTimeoutMember,
        scheduler: {
          summary: t(
            'Caller-selected `IScheduler` providing the optional bootstrap timeout timer.',
            '调用方选择的 `IScheduler`，提供可选启动超时定时器。'
          ),
          default: t(
            'Omitted: use `systemScheduler` only when an explicit timeout needs a timer.',
            '省略时仅在显式超时需要计时器时使用 `systemScheduler`。'
          )
        }
      },
      purpose: t(
        'Child side, advanced: reads the bootstrap frame the launcher wrote on stdin before the handshake.',
        '子进程端的高级用法：在握手前读取 launcher 写入 stdin 的启动帧。'
      ),
      params: {
        channel: t('The child stdio byte channel.', '子进程的 stdio 字节通道。'),
        bootstrap: t(
          '`stdin` to read it, `none` when there is none.',
          '`stdin` 表示读取启动帧，`none` 表示没有启动帧。'
        ),
        options: t(
          '`{ bootstrapTimeoutMs?, scheduler? }`; omission installs no bootstrap timeout timer.',
          '`{ bootstrapTimeoutMs?, scheduler? }`；省略时不安装启动超时定时器。'
        )
      },
      returns: t('The bootstrap bytes (or none).', '启动帧字节（或没有）。'),
      example: `const bootstrap = await receiveAdapterBootstrap(channel, 'stdin')`
    },
    parseProcessPluginDescriptor: {
      role: 'operation',
      purpose: t(
        'Validates a portable process plugin descriptor (JSON) without keeping secrets or launch ports.',
        '校验可移植的进程插件描述（JSON），不保留密钥或启动端口。'
      ),
      params: { input: t('Parsed JSON of a descriptor file.', '描述文件解析得到的 JSON 值。') },
      returns: t(
        'A normalised `IProcessPluginDescriptor`; invalid input throws `PROCESS_PLUGIN_INVALID_OPTION`.',
        '规范化后的 `IProcessPluginDescriptor`；不合法时抛 `PROCESS_PLUGIN_INVALID_OPTION`。'
      ),
      example: `const descriptor = parseProcessPluginDescriptor(JSON.parse(text))`
    },
    createAdapterWebByteIO: {
      role: 'factory',
      purpose: t(
        'Wraps a pair of Web Streams (`ReadableStream` / `WritableStream` of bytes) as a byte channel.',
        '把一对 Web Streams（字节的 `ReadableStream` / `WritableStream`）包装成一个可用于后续握手的字节通道。'
      ),
      params: {
        readable: t('Incoming bytes.', '接收字节的可读流。'),
        writable: t('Outgoing bytes.', '发送字节的可写流。')
      },
      returns: t('An `IProcessByteChannel`.', '一个可用于握手的 `IProcessByteChannel`。'),
      example: `const channel = createAdapterWebByteIO(child.stdout, child.stdin)`
    },
    createAdapterProcessLaunch: {
      role: 'operation',
      optionDocs: bootstrapOptionDocs,
      purpose: t(
        'Advanced: performs one launch for a custom runtime launcher.',
        '高级用法：为自定义运行时的 launcher 执行一次子进程启动，返回 Core 需要的启动结果。'
      ),
      params: {
        spec: t('Process spec.', '进程启动规格，包含 command 与 args。'),
        context: t(
          'Context received by `launch(spec, context)`.',
          '`launch(spec, context)` 收到的启动上下文。'
        ),
        options: t(
          '`{ runtimeApiBootstrap? }`.',
          '可选的 `{ runtimeApiBootstrap? }` 启动身份设置。'
        )
      },
      returns: t('The launch for Core.', '交给 Core 的启动结果对象。'),
      example: `launch: (spec, context) => createAdapterProcessLaunch(spec, context)`
    },
    createAdapterProcessPeer: {
      role: 'factory',
      optionDocs: processPeerOptionMembers,
      purpose: t(
        'Advanced: `createProcessPeer` with a custom runtime I/O loader for unsupported runtimes.',
        '高级用法：使用自定义运行时 I/O 加载器的 `createProcessPeer`，用于尚未支持的运行时。'
      ),
      params: {
        options: t(
          'Peer options; see `IRuntimeProcessPeerOptions`.',
          '子进程端或父进程端的 Peer 选项，见 `IRuntimeProcessPeerOptions`。'
        ),
        runtime: t(
          'Loader whose `load()` returns `{ processRuntimeIO }`.',
          '其 `load()` 返回 `{ processRuntimeIO }` 的加载器。'
        ),
        forwarded: t(
          'Short-source options (`token`, `verify`, `connectTimeoutMs`) forwarded from a plugin.',
          '从插件转发来的简写来源选项（`token`、`verify`、`connectTimeoutMs`）。'
        )
      },
      returns: t('An `IRuntimeTypedPeer`.', '一个带类型的 `IRuntimeTypedPeer`。'),
      example: `const peer = await createAdapterProcessPeer({ provide: api }, myRuntimeLoader)`
    },
    createAdapterProcessPlugin: {
      role: 'factory',
      optionDocs: processPluginDocs,
      purpose: t(
        'Advanced: `createProcessPlugin` with a custom runtime I/O loader.',
        '高级用法：使用自定义运行时 I/O 加载器的 `createProcessPlugin`，用于尚未支持的运行时。'
      ),
      params: {
        options: t('Full `IProcessPluginOptions`.', '完整的 `IProcessPluginOptions` 部署选项。'),
        runtime: t(
          'Loader whose `load()` returns `{ processRuntimeIO }`.',
          '其 `load()` 返回 `{ processRuntimeIO }` 的加载器。'
        )
      },
      returns: t('An `IProcessPlugin`.', '一个可安装的 `IProcessPlugin`。'),
      example: `const plugin = createAdapterProcessPlugin(options, myRuntimeLoader)`
    },
    PROCESS_HANDSHAKE_MAX_FRAME_BYTES: {
      role: 'constant',
      purpose: t(
        'Largest unauthenticated handshake frame accepted (65536 bytes); larger frames are rejected at the length header.',
        '可接受的未认证握手帧的最大长度（65536 字节）；更大的帧在读取长度头时即被拒绝。'
      ),
      example: `if (frame.byteLength > PROCESS_HANDSHAKE_MAX_FRAME_BYTES) reject()`
    },
    PROCESS_RUNTIME_API_ENV: {
      role: 'constant',
      purpose: t(
        'Environment variable (`MIGAIA_RPC_RUNTIME_API_BOOTSTRAP`) that marks a library-launched child; sandbox and container wrappers must forward it.',
        '标记由本库启动的子进程的环境变量（`MIGAIA_RPC_RUNTIME_API_BOOTSTRAP`）；沙箱与容器包装器必须转发它。'
      ),
      example: `docker run -e ${'$'}{PROCESS_RUNTIME_API_ENV} image`
    },
    PROCESS_RUNTIME_API_ENV_VERSION: {
      role: 'constant',
      purpose: t(
        'Value (`1`) of `PROCESS_RUNTIME_API_ENV` that selects the current bootstrap format.',
        '环境变量 `PROCESS_RUNTIME_API_ENV` 的取值（`1`），用于选择当前的启动数据格式。'
      ),
      example: `env[PROCESS_RUNTIME_API_ENV] === PROCESS_RUNTIME_API_ENV_VERSION`
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_KIND: {
      role: 'constant',
      purpose: t(
        '`kind` of the bootstrap frame (`rpc-runtime-api-bootstrap`) a launcher writes before the handshake.',
        'launcher 在协议握手之前写入子进程的启动帧所携带的类型标识 `kind`（`rpc-runtime-api-bootstrap`）。'
      ),
      example: `frame.kind === PROCESS_RUNTIME_API_BOOTSTRAP_KIND`
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_VERSION: {
      role: 'constant',
      purpose: t(
        'Version (`1`) of the bootstrap frame accepted by launch and child.',
        '启动端与子进程端都必须接受的启动帧格式版本号（`1`）。'
      ),
      example: `frame.version === PROCESS_RUNTIME_API_BOOTSTRAP_VERSION`
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS: {
      role: 'constant',
      purpose: t(
        'How long a child waits for the bootstrap frame (10000 ms) before the normal handshake deadline starts.',
        '子进程等待启动帧的时长（10000 毫秒），之后才开始正常的握手截止计时。'
      ),
      example: `openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS })`
    },
    PROCESS_RUNTIME_API_FINGERPRINT_PREFIX: {
      role: 'constant',
      purpose: t(
        'Prefix (`rpc-process-`) of launcher-owned launch identities shown in details instead of native PIDs.',
        'launcher 生成的启动身份前缀（`rpc-process-`），在运行详情中代替原生 PID 显示。'
      ),
      example: `detail.identity.instanceId.startsWith(PROCESS_RUNTIME_API_FINGERPRINT_PREFIX)`
    },
    ProcessPluginWire: {
      role: 'constant',
      purpose: t(
        'Protocols a process connection can speak: `native` (this library) or `jsonrpc` (other languages).',
        '进程连接可以使用的协议：`native`（本库协议）或 `jsonrpc`（其它语言）。'
      ),
      example: `createProcessPeer({ spawn: { command: 'python3', args: ['service.py'], wire: ProcessPluginWire.jsonrpc, contract } })`
    },
    RPC_PROCESS_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/process`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        '本包自有错误的 `source` 值（`@migaia/rpc/process`）；超时、取消等调用层错误来自 `@migaia/rpc/core`。'
      ),
      example: `if (error.source === RPC_PROCESS_ERROR_SOURCE && error.code === RpcProcessErrorCode.authRejected) promptForToken()`
    },
    RpcProcessErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === RpcProcessErrorCode.connectionLimit) await backoff()`
    },
    RuntimeEventName: runtimeEventSymbol,
    ...adapterSymbols
  },
  types: {
    ...runtimeSharedTypes,
    IRuntimeProcessPeerOptions: {
      summary: t(
        'Options of `createProcessPeer()`: one source plus authentication and the Core Peer options.',
        '`createProcessPeer()` 的选项：一种来源，加上认证设置与 Core Peer 的通用选项。'
      ),
      example: `const server = await createProcessPeer({
  listen: 'math-service',
  provide: { math: { double: (value: number) => value * 2 } }
})
const client = await createProcessPeer<{ math: { double(value: number): number } }>({ connect: 'math-service' })
console.log(await client.request('math.double', 21))
await client.close()
await server.close()`,
      members: processPeerOptionMembers
    },
    IRuntimeProcessPluginOptions: {
      summary: t(
        'Options of `createProcessPlugin()` (simple form).',
        '`createProcessPlugin()` 简单形式所使用的选项。'
      ),
      members: processRuntimePluginMembers
    },
    IRuntimeProcessStopOptions: {
      summary: t(
        'Options of `host.process.stop()`.',
        '`host.process.stop()` 的选项：宽限时间与信号。'
      ),
      members: {
        graceMs: {
          summary: t(
            'Time to exit after the signal before it is killed.',
            '发送信号后允许退出的时间，超时后强制终止。'
          )
        },
        signal: {
          summary: t('Signal sent first; only `SIGTERM`.', '首先发送的信号；只能为 `SIGTERM`。')
        }
      }
    },
    IProcessShortSourceOptions: {
      summary: t(
        'Short-source credentials shared by peer and plugin options.',
        'Peer 与插件选项共用的简写来源凭据。'
      ),
      members: {
        token: { summary: t('Shared secret for the handshake.', '握手时使用的共享密钥。') },
        verify: {
          summary: t(
            'Listener credential check returning a principal id.',
            '监听端校验凭据并返回主体 id 的函数。'
          )
        },
        connectTimeoutMs: {
          summary: t(
            'Wait for a named listener; default 5000.',
            '等待命名监听方出现的时间，默认 5000 毫秒。'
          )
        }
      }
    },
    IProcessShortSpawn: {
      summary: t(
        'Short `spawn` object expanded into a full source with defaults.',
        '会用默认值展开为完整来源的简写 `spawn` 对象。'
      ),
      members: {
        entry: {
          summary: t(
            'Module to run with the current runtime (URL or path).',
            '用当前运行时执行的模块（URL 或路径）。'
          )
        },
        base: {
          summary: t(
            'Module URL used to resolve a relative `entry`.',
            '解析相对 `entry` 时使用的模块 URL。'
          )
        },
        command: {
          summary: t(
            'Executable to run instead of `entry`, e.g. `python3`.',
            '代替 `entry` 运行的可执行程序，例如 `python3`。'
          )
        },
        args: {
          summary: t(
            'Arguments of `command`, or extra arguments.',
            '`command` 的参数，或额外的命令行参数。'
          )
        },
        cwd: { summary: t('Working directory of the child.', '子进程的工作目录路径。') },
        env: {
          summary: t(
            '`{ inherit, set }`: variable names to inherit and values to set.',
            '`{ inherit, set }`：要继承的变量名与要设置的值。'
          )
        },
        wrap: {
          summary: t(
            'Rewrites the computed launch command (e.g. to run inside `sandbox-exec` or `bwrap`) on every launch, restart and replace. Must keep stdin/stdout and environment, and forward the exit code.',
            '在每次启动、重启与替换时改写计算出的启动命令（例如放进 `sandbox-exec` 或 `bwrap`）。必须保留 stdin/stdout 与环境变量，并转发退出码。'
          )
        },
        stdio: {
          summary: t(
            'stdio routing; default `{ stdin: "channel", stdout: "channel", stderr: "drain" }`.',
            '子进程标准输入输出的走向；默认 `{ stdin: "channel", stdout: "channel", stderr: "drain" }`。'
          )
        },
        limits: {
          summary: t(
            'Limits such as `callWallTimeMs` per call.',
            '资源限制，例如单次调用的 `callWallTimeMs`。'
          )
        },
        permissions: {
          summary: t('Runtime permissions (Deno).', '子进程的运行时权限设置（用于 Deno）。')
        },
        wire: {
          summary: t(
            '`native` (default) or `jsonrpc` for other languages.',
            '`native`（默认）或用于其它语言的 `jsonrpc`。'
          ),
          values: { enum: 'ProcessPluginWire' }
        },
        contract: {
          summary: t(
            'Local declaration of the remote methods (required for `jsonrpc`).',
            '对端方法的本地声明（`jsonrpc` 时必填）。'
          )
        },
        token: {
          summary: t(
            'Session secret; default a random one per launch.',
            '会话密钥；默认每次启动随机生成。'
          )
        },
        offer: { summary: t('Custom native handshake offer.', '自定义的原生握手提议。') },
        establish: { summary: t('Custom handshake step function.', '自定义的握手步骤函数。') },
        supervision: {
          summary: t(
            'Overrides of the supervisor options (restart, budget, isolation...).',
            '覆盖监督选项（重启、预算、隔离等）。'
          )
        },
        onNotice: {
          summary: t(
            'Receives expected launcher notices, such as the best-effort termination warning, instead of `report`.',
            '代替 `report` 接收预期的 launcher 提示，例如尽力终止的警告。'
          ),
          params: {
            notice: t(
              'The notice, usually `CAPABILITY_UNSUPPORTED` for `termination`.',
              '提示内容，通常是关于 `termination` 的 `CAPABILITY_UNSUPPORTED`。'
            )
          },
          returns: t('Nothing; the notice is handled.', '无返回值；提示已处理。')
        }
      }
    },
    ISpawnProcessPluginDeployment: {
      summary: t(
        'Full spawn source: how to launch, which raw channel, how to handshake, which credential.',
        '完整的 spawn 来源：如何启动、使用哪个原始通道、如何握手、使用什么凭据。'
      ),
      members: {
        kind: {
          summary: t(
            'Always `spawn`: a full spawn source.',
            '固定为 `spawn`，表示对象形式的 spawn 来源。'
          )
        },
        supervision: {
          summary: t(
            'Supervisor options: `id`, `launcher`, `budget`, `isolation`, `spec`, `report`.',
            '子进程的启动与监督选项：`id`、`launcher`、`budget`、`isolation`、`spec`、`report`。'
          )
        },
        rawChannel: {
          summary: t(
            'Returns the raw channel of the launched handle.',
            '返回本次启动句柄上的原始通道。'
          ),
          params: {
            handle: t(
              'Handle returned by `supervision.launcher.launch()`.',
              '由 `supervision.launcher.launch()` 返回的句柄。'
            ),
            signal: t('Aborts while waiting for the channel.', '等待通道期间用于中止的信号。')
          },
          returns: t('The byte or message channel.', '字节通道或消息通道。')
        },
        channelKind: {
          summary: t(
            '`byte` (stdio, socket) or `message` (Electron utility process).',
            '原始通道的类型：字节流 `byte`（stdio、socket）或消息 `message`（Electron utility process）。'
          )
        },
        wire: {
          summary: t(
            '`native` (default) or `jsonrpc`.',
            '使用的线路协议：`native`（默认）或 `jsonrpc`。'
          ),
          values: { enum: 'ProcessPluginWire' }
        },
        token: {
          summary: t(
            'Credential passed in the bootstrap and checked in the handshake.',
            '通过启动数据传递、在握手中校验的凭据。'
          )
        },
        offer: {
          summary: t(
            'Native offer shared by every `establish` call.',
            '每次 `establish` 调用共用的原生提议。'
          )
        },
        establish: {
          summary: t(
            'Runs the handshake, usually with `createProcessTransport`.',
            '执行握手的函数，通常使用 `createProcessTransport`。'
          )
        }
      }
    },
    IConnectProcessPluginDeployment: {
      summary: t('Full connect source for a running service.', '连接运行中服务的完整来源。'),
      members: {
        kind: {
          summary: t(
            'Always `connect`: a connect deployment.',
            '固定为 `connect`，表示这是连接来源对象。'
          )
        },
        wire: {
          summary: t(
            '`native` (default) or `jsonrpc`; JSON-RPC disables the default ping.',
            '线路协议：`native`（默认）或 `jsonrpc`；JSON-RPC 会关闭默认的 ping。'
          ),
          values: { enum: 'ProcessPluginWire' }
        },
        address: {
          summary: t(
            'Local address to dial, e.g. `tcp://127.0.0.1:4000`.',
            '要拨号连接的本机地址，例如 `tcp://127.0.0.1:4000`。'
          )
        },
        token: {
          summary: t('Credential sent in the handshake.', '握手时发送给服务端校验的凭据。')
        },
        offer: {
          summary: t(
            'Native offer shared by every `establish` call.',
            '每次 `establish` 调用共用的原生提议。'
          )
        },
        dial: {
          summary: t(
            'Dials the address, usually `dialProcessByteChannel`.',
            '拨号连接该地址，通常使用 `dialProcessByteChannel`。'
          ),
          params: {
            address: t('The deployment `address`.', '部署中的 `address` 地址。'),
            signal: t('Aborts the dial.', '用于中止拨号的信号。')
          },
          returns: t('The raw byte channel.', '原始字节通道。')
        },
        establish: {
          summary: t(
            'Runs the handshake on the dialled channel.',
            '在已连接的通道上执行握手的函数。'
          )
        },
        supervision: {
          summary: t(
            'Reconnect policy: `restart`, `startupTimeoutMs`, `stop`, `terminalPolicy`, `health`.',
            '断线后的重连与监督策略：`restart`、`startupTimeoutMs`、`stop`、`terminalPolicy`、`health`。'
          )
        }
      }
    },
    IProcessResilienceOptions: {
      summary: t(
        'Options of `createProcessResilience()`.',
        '`createProcessResilience()` 的选项：各项限制与诊断策略。'
      ),
      members: processResilienceOptionMembers
    },
    IProcessResilience: {
      summary: t(
        'Governance owner returned by `createProcessResilience()`.',
        '`createProcessResilience()` 返回的进程连接治理对象。'
      ),
      scenarios: [
        t(
          'Share one set of limits across several process plugins of a host.',
          '在宿主的多个进程插件之间共用同一套限制。'
        )
      ],
      example: `const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })
const off = resilience.onTerminal((snapshot) => alertOps(snapshot.id))
// ... 作为 resilience 传给插件或监听器
off()
await resilience.close()`,
      members: {
        sessionOptions: {
          summary: t(
            'Returns the idempotency and limits for one session.',
            '返回某个会话的幂等配置与调用限制。'
          ),
          params: {
            identity: t(
              'Session identity from the accepted connection.',
              '来自已接受连接的会话身份。'
            )
          },
          returns: t('`{ idempotency, limits }`.', '`{ idempotency, limits }` 配置对象。'),
          example: `const { limits } = resilience.sessionOptions(identity)`
        },
        listenRegistrations: {
          summary: t(
            'Accepts registrations of remote processes on an address.',
            '在某个地址上接受远程进程的登记。'
          ),
          params: {
            options: t(
              '`IProcessRegistrationListenOptions`.',
              '登记监听选项 `IProcessRegistrationListenOptions`。'
            )
          },
          returns: t(
            'A listener with `address` and `close()`.',
            '带 `address` 与 `close()` 的监听器。'
          ),
          example: `const listener = await resilience.listenRegistrations(options)`
        },
        attachRegistration: {
          summary: t(
            'Puts one supervised registration under this governance.',
            '把一个受监督的登记纳入本治理对象管理。'
          ),
          params: {
            name: t('Registration name, the plugin `name`.', '登记名称，即插件的 `name`。'),
            binding: t('Ownership, supervisor and health mode.', '所有权、监督器与健康检查方式。'),
            liquidation: t('Who removes it when liquidated.', '被清算时由谁负责移除它。')
          },
          returns: t('An `IProcessRegistration`.', '一个登记对象 `IProcessRegistration`。'),
          example: `const registration = resilience.attachRegistration('service', binding, owner)`
        },
        callGuard: {
          summary: t(
            'Returns the guard that rejects calls to unhealthy or terminal registrations.',
            '返回用于拒绝调用不健康或终态登记的守卫。'
          ),
          params: { name: t('Registration name.', '要守卫的登记名称。') },
          returns: t('A remote call guard.', '远程调用守卫对象。'),
          example: `const guard = resilience.callGuard('service')`
        },
        inspect: {
          summary: t('Reads the current snapshot of one registration.', '读取某个登记的当前快照。'),
          params: { id: t('Registration id.', '要查询的登记 id。') },
          returns: t(
            'An `IProcessResilienceSnapshot`, or `undefined`.',
            '一个快照 `IProcessResilienceSnapshot`；未知 id 时为 `undefined`。'
          ),
          example: `resilience.inspect('service')?.state`
        },
        onTerminal: {
          summary: t(
            'Observes registrations that entered the terminal state.',
            '观察进入终态、需要处理的登记。'
          ),
          params: { listener: t('Receives the snapshot.', '接收登记快照的监听函数。') },
          returns: t('An unsubscribe function.', '取消订阅的函数。'),
          example: `resilience.onTerminal((snapshot) => alertOps(snapshot))`
        },
        close: {
          summary: t('Closes every session and stops governance.', '关闭所有会话并停止治理。'),
          returns: t('Resolves when closed.', '全部关闭后 resolve。'),
          example: `await resilience.close()`
        }
      }
    },
    IProcessResilienceSnapshot: {
      summary: t('State of one governed registration.', '某个受治理登记的当前状态快照。'),
      members: {
        id: { summary: t('Registration id, its name.', '该登记的 id，即其登记名称。') },
        state: {
          summary: t(
            'Supervisor state, such as `ready` or `terminal`.',
            '监督器的当前状态，例如 `ready` 或 `terminal`。'
          )
        },
        health: {
          summary: t(
            'Health mode: `ping`, `custom` or `none`.',
            '该登记的健康检查方式：`ping`、`custom` 或 `none`。'
          )
        },
        unhandled: {
          summary: t('Terminal reports nobody handled yet.', '尚无人处理的终态上报次数。')
        },
        liquidated: {
          summary: t(
            '`true` once liquidated; it cannot restart.',
            '已被清算时为 `true`；它无法再重启。'
          )
        },
        reason: {
          summary: t('Why it became terminal, if known.', '进入终态的原因（已知时才有）。')
        }
      }
    },
    IProcessByteChannel: {
      summary: t(
        'Ordered byte channel (stdio, socket, Web Streams).',
        '有序的字节通道，可来自 stdio、socket 或 Web Streams。'
      ),
      scenarios: [
        t(
          'Connect to an already listening local service and remove the close listener when releasing the raw byte channel; RPC traffic still requires the process handshake layer.',
          '连接到已经监听的本机服务，在释放原始字节通道时移除关闭监听；RPC 通信仍须经过进程握手层。'
        )
      ],
      example: `import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'

const channel = await dialProcessByteChannel({ address: 'tcp://127.0.0.1:4000' })
const offClose = channel.onClose((reason) => console.log('closed', reason))
try {
  console.log(channel.kind)
} finally {
  offClose()
  await channel.close()
}`,
      members: byteChannelMembers
    },
    IProcessMessageChannel: {
      summary: t(
        'Message channel (Electron utility process).',
        '消息通道，用于与 Electron utility process 互相发送消息。'
      ),
      members: {
        kind: {
          summary: t('Always `message`: a message channel.', '固定为 `message`，表示这是消息通道。')
        },
        send: {
          summary: t('Sends one structured message.', '向 utility process 发送一条结构化消息。'),
          params: { value: t('Message to send.', '要发送的消息对象。') },
          returns: t('Nothing or a Promise.', '无返回值或一个 Promise。'),
          example: `channel.send(message)`
        },
        onMessage: {
          summary: t('Subscribes to incoming messages.', '订阅从对端接收到的消息。'),
          params: { listener: t('Receives each message.', '接收每条消息的监听函数。') },
          returns: t('A function that removes the listener.', '移除该监听的函数。'),
          example: `channel.onMessage((value) => handle(value))`
        },
        onClose: byteChannelMembers.onClose as IMemberDoc,
        close: byteChannelMembers.close as IMemberDoc
      }
    },
    IProcessByteListener: {
      summary: t(
        'Listener returned by `listenProcessByteChannel()`.',
        '调用 `listenProcessByteChannel()` 返回的本机监听器对象。'
      ),
      members: {
        address: {
          summary: t(
            'Actual bound address (the real port when `0` was given).',
            '实际绑定的地址（传入端口 `0` 时为真实端口）。'
          )
        },
        close: {
          summary: t('Stops listening and frees the address.', '停止监听并释放占用的地址。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。'),
          example: `await listener.close()`
        }
      }
    },
    IProcessPendingByteConnection: {
      summary: t(
        'Incoming connection passed to `onConnection`, not yet authenticated.',
        '传给 `onConnection` 的、尚未认证的连接。'
      ),
      members: {
        accept: {
          summary: t(
            'Runs the responder handshake and authenticates the client.',
            '执行响应方握手并认证客户端。'
          ),
          params: {
            options: t('Common options plus the native `offer`.', '通用选项加上原生 `offer`。')
          },
          returns: t('`{ channel, principalId }`.', '认证后的 `{ channel, principalId }`。'),
          example: `const { channel, principalId } = await pending.accept({ ...context, offer })`
        },
        close: {
          summary: t('Rejects and closes the connection.', '拒绝并关闭该待认证的连接。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。'),
          example: `await pending.close()`
        }
      }
    },
    IAuthenticatedProcessChannel: {
      summary: t(
        'Result of `pending.accept()`.',
        '调用 `pending.accept()` 得到的结果：已认证的通道。'
      ),
      members: {
        channel: { summary: t('Protocol channel after the handshake.', '握手完成后的协议通道。') },
        principalId: {
          summary: t(
            'Principal id returned by `verify`.',
            '由 `verify` 校验后返回的客户端主体 id。'
          )
        }
      }
    },
    IProcessCommonOptions: {
      summary: t('Options shared by handshake helpers.', '握手相关函数共用的选项。'),
      members: commonOptionMembers
    },
    IProcessByteOptions: {
      summary: t(
        'Options of `createProcessTransport()` on byte channels.',
        '`createProcessTransport()` 在字节通道上的握手选项。'
      ),
      members: processByteOptionMembers
    },
    IProcessMessageOptions: {
      summary: t(
        'Options of `createProcessTransport()` on message channels.',
        '`createProcessTransport()` 在消息通道上的握手选项。'
      ),
      members: processMessageOptionMembers
    },
    IProcessJsonRpcChannelOptions: {
      summary: t(
        'Options of `createProcessJsonRpcChannel()`.',
        '`createProcessJsonRpcChannel()` 的选项：字节通道与诊断设置。'
      ),
      members: processJsonRpcMembers
    },
    IProcessLaunchCommand: {
      summary: t(
        'Launch command passed to and returned by `wrap`.',
        '传给 `wrap` 并由其返回的启动命令。'
      ),
      members: {
        command: { summary: t('Executable path or name.', '可执行程序的路径或名称。') },
        args: { summary: t('Command-line arguments in order.', '按顺序排列的命令行参数。') },
        cwd: { summary: t('Working directory, when set.', '工作目录（设置了时才有）。') },
        env: {
          summary: t(
            '`{ inherit, set }` environment.',
            '环境变量设置 `{ inherit, set }`：继承与新设的变量。'
          )
        }
      }
    },
    IProcessRuntimeBootstrapOptions: {
      summary: t('Identity written into the child bootstrap.', '写入子进程启动数据的身份信息。'),
      members: processRuntimeBootstrapMembers
    },
    IProcessPlugin: {
      summary: t(
        'Plugin returned by `createProcessPlugin()` with a full deployment.',
        '使用完整部署时 `createProcessPlugin()` 返回的插件。'
      ),
      scenarios: [
        t(
          'Replace the child process with a new spec without restarting the host.',
          '在不重启宿主的情况下以新规格替换子进程。'
        )
      ],
      example: `const result = await plugin.replace({ spec: newSpec, strategy: 'start-then-switch' })`,
      members: {
        replace: {
          summary: t(
            'Replaces the whole process: `stop-then-start` or `start-then-switch`.',
            '替换整个子进程，策略为 `stop-then-start` 或 `start-then-switch`。'
          ),
          params: { options: t('`{ spec?, strategy? }`.', '替换选项 `{ spec?, strategy? }`。') },
          returns: t(
            'The strategy used and its outcome or new plugin.',
            '采用的策略，以及替换结果或新插件。'
          ),
          example: `await plugin.replace({ strategy: 'stop-then-start' })`
        }
      }
    },
    IProcessPluginOptions: {
      summary: t(
        'Full options of the advanced `createProcessPlugin()` overload.',
        '高级 `createProcessPlugin()` 重载使用的完整选项。'
      ),
      members: processPluginOptionMembers
    },
    IAdapterProcessLaunchContext: {
      summary: t(
        'Second argument of `launcher.launch(spec, context)`: signal and launch request from supervision.',
        '`launcher.launch(spec, context)` 的第二个参数：来自监督层的信号与启动请求。'
      ),
      members: {}
    },
    IAdapterProcessLaunchOptions: {
      summary: t('Options of the adapter launch helpers.', '适配器启动辅助函数的选项。'),
      members: { runtimeApiBootstrap: runtimeBootstrapMember }
    },
    IAdapterProcessRuntimeIO: {
      summary: t(
        'Process I/O of a custom runtime used by `createAdapterProcessPeer`.',
        '`createAdapterProcessPeer` 使用的自定义运行时进程 I/O。'
      ),
      members: {
        discover: {
          summary: t('Reads the bootstrap marker and runtime name.', '读取启动标记与运行时名称。'),
          returns: t('`{ marker, runtime }`.', '`{ marker, runtime }` 发现结果。')
        },
        open: {
          summary: t(
            'Opens the stdio byte channel and bootstrap.',
            '打开 stdio 字节通道并读取启动数据。'
          ),
          returns: t('`{ channel, bootstrap? }`.', '`{ channel, bootstrap? }` 通道与启动数据。')
        }
      }
    },
    IAdapterProcessRuntimeLoader: {
      summary: t(
        'Lazy loader of a custom runtime I/O module.',
        '按需加载自定义运行时 I/O 模块的加载器。'
      ),
      members: {
        load: {
          summary: t(
            'Loads `{ processRuntimeIO }`, or `undefined` when unavailable.',
            '按需加载 `{ processRuntimeIO }`；当前运行时不可用时返回 `undefined`。'
          ),
          returns: t('The module or `undefined`.', '加载到的模块或 `undefined`。')
        }
      }
    },
    IAdapterProcessRuntimeModule: {
      summary: t('Module returned by the runtime loader.', '运行时加载器返回的模块对象。'),
      members: {
        processRuntimeIO: {
          summary: t('The runtime process I/O.', '该运行时提供的进程 I/O 实现，含发现与打开。')
        }
      }
    },
    IListenProcessByteChannel: {
      summary: t(
        'Type of `listenProcessByteChannel`.',
        '各 socket 适配器中 `listenProcessByteChannel` 函数的类型。'
      ),
      members: {}
    },
    IProcessConnectionHandle: {
      summary: t(
        'Handle of one dialled connection under supervision.',
        '受监督的一个已拨号连接的句柄。'
      ),
      members: {
        identity: {
          summary: t(
            '`{ fingerprint }` of the connection.',
            '该连接的身份标识 `{ fingerprint }`，用于诊断。'
          )
        },
        exited: {
          summary: t(
            'Resolves with `{ reason }` when the connection ended.',
            '连接结束时以结束原因 `{ reason }` resolve。'
          )
        },
        channel: {
          summary: t('The raw byte channel of the connection.', '该连接上的原始字节通道。')
        },
        close: {
          summary: t('Closes the dialled connection.', '主动关闭该已拨号的连接。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。')
        }
      }
    },
    IProcessDependencyHostPort: {
      summary: t(
        'Host port used to remove a liquidated plugin with `suspend` or `cascade` policy.',
        '用于以 `suspend` 或 `cascade` 策略移除被清算插件的宿主端口。'
      ),
      members: {
        unUse: {
          summary: t(
            'Removes (or with `dryRun` plans removing) a plugin and its dependants.',
            '移除（或在 `dryRun` 时规划移除）某个插件及其依赖方。'
          ),
          params: {
            name: t('Plugin name.', '要移除的插件名称。'),
            options: t('`{ policy, dryRun? }`.', '移除选项 `{ policy, dryRun? }`。')
          },
          returns: t('The removal or the plan.', '移除结果或移除计划。')
        }
      }
    },
    IProcessHostRegistrationApproval: {
      summary: t('Approval of a remote host registration.', '对远程宿主登记的批准信息。'),
      members: {
        targetHost: {
          summary: t('Host the registration is installed into.', '该登记要安装进的宿主。')
        },
        name: { summary: t('Name of the approved registration.', '被批准的远程宿主登记名称。') },
        contract: {
          summary: t('Accepted contract of the registration.', '该登记被接受的方法契约。')
        }
      }
    },
    IProcessHostRegistrations: {
      summary: t(
        'Listener options that approve remote host registrations by principal.',
        '按主体批准远程宿主登记的监听选项。'
      ),
      members: {
        ...registrationCommonMembers,
        resolveRegistration: {
          summary: t(
            'Returns the approval for a principal, or `undefined` to refuse.',
            '返回某个主体的批准信息；返回 `undefined` 表示拒绝。'
          ),
          params: {
            principalId: t('Principal id returned by `verify`.', '由 `verify` 返回的主体 id。')
          },
          returns: t('Approval or `undefined`.', '批准信息或 `undefined`。')
        }
      }
    },
    IProcessLiquidationOwner: {
      summary: t(
        'Who removes a liquidated registration: a proxy plugin in a host, or a standalone host release.',
        '由谁移除被清算的登记：宿主中的代理插件，或独立宿主的释放函数。'
      ),
      members: {
        kind: {
          summary: t(
            'Liquidation ownership discriminant choosing a host-owned proxy registration or an independently released standalone host.',
            '清算所有权判别值，选择宿主拥有的代理登记或独立释放的宿主。'
          ),
          values: {
            'proxy-plugin': t(
              'Remove or suspend dependants through the owning local PluginHost.',
              '通过所属本地插件宿主移除或挂起依赖方。'
            ),
            'standalone-host': t(
              'Invoke the standalone host owner’s explicit release operation.',
              '调用独立宿主所有者提供的显式释放操作。'
            )
          }
        },
        name: {
          summary: t(
            'Proxy plugin registration name chosen when the owning local host installed it; present only for proxy-plugin.',
            '所属本地宿主安装时指定的代理插件登记名，仅代理插件分支存在。'
          )
        },
        host: {
          summary: t(
            'Caller-provided local dependency-host port that commits the proxy registration’s removal policy.',
            '调用方提供的本地依赖宿主端口，提交代理登记的卸载策略。'
          )
        },
        release: {
          summary: t(
            'Caller-owned no-argument cleanup for standalone host liquidation; the governance owner awaits it and observes rejection.',
            '独立宿主清算使用的调用方无参数清理函数；治理所有者等待完成并观察拒绝。'
          ),
          returns: t(
            'A `Promise<void>` indicating that standalone ownership release completed or failed.',
            '表示独立所有权释放完成或失败的 `Promise<void>`。'
          ),
          example: `const owner: IProcessLiquidationOwner = {
  kind: 'standalone-host',
  release: async () => { await host.dispose() }
}
await owner.release()`
        }
      }
    },
    IProcessPluginDescriptor: {
      summary: t(
        'Portable JSON description of a process plugin or host, validated by `parseProcessPluginDescriptor`.',
        '进程插件或宿主的可移植 JSON 描述，由 `parseProcessPluginDescriptor` 校验。'
      ),
      scenarios: [
        t(
          'Validate persisted pure-data deployment descriptions before choosing runtime adapters and materializing a plugin or host.',
          '选择运行时适配器并构造插件或宿主前，校验持久化的纯数据部署描述。'
        )
      ],
      example: `const descriptor = parseProcessPluginDescriptor(JSON.parse(text))
if (descriptor.target === 'plugin') console.log(descriptor.contract)
else console.log(descriptor.catalog)`,
      members: {
        descriptorVersion: {
          summary: t(
            'Required descriptor schema version, currently the literal 1; parser rejects unsupported versions.',
            '必填描述格式版本，目前必须为字面量一；解析器拒绝其他版本。'
          ),
          values: {
            '1': t(
              'Use the current strict process descriptor schema.',
              '采用当前严格进程描述格式进行校验。'
            )
          }
        },
        target: {
          summary: t(
            'Descriptor discriminant choosing the plugin contract branch or the remote host catalog branch.',
            '描述判别值，选择插件契约分支或远程宿主目录分支。'
          ),
          values: {
            plugin: t(
              'Describe one plugin with a required contract and optional instance mode.',
              '描述单个插件，必须提供契约，可选择实例模式。'
            ),
            host: t(
              'Describe a remote host with its required exported catalog.',
              '描述远程宿主，必须提供其导出目录。'
            )
          }
        },
        name: {
          summary: t(
            'Caller-issued remote registration name validated against the canonical remote-name grammar.',
            '调用方指定的远程登记名称，按统一远程名称语法校验。'
          )
        },
        runtime: {
          summary: t(
            'Caller-selected runtime adapter name retained in the portable descriptor for materialization.',
            '调用方选择的运行时适配器名称，保留在可移植描述中以便构造。'
          )
        },
        deployment: {
          summary: t(
            'Pure-data `IProcessPluginDeploymentDescriptor` selecting spawned byte/message deployment or a borrowed external connection.',
            '选择启动字节或消息部署、或借用外部连接的纯数据 `IProcessPluginDeploymentDescriptor`。'
          )
        },
        instanceMode: {
          summary: t(
            'Plugin-only `ProcessPluginInstanceMode` deciding shared or per-connection exposure; host descriptors reject this field.',
            '仅插件可用的 `ProcessPluginInstanceMode`，决定共享或按连接暴露；宿主描述拒绝此字段。'
          ),
          default: t(
            'Omitted: parser preserves absence for the materialization policy to resolve.',
            '省略时解析器保留缺失状态，交由构造策略决定。'
          ),
          values: {
            shared: t(
              'Share the plugin instance across its accepted connections.',
              '让已接纳连接共享同一个插件实例。'
            ),
            'per-connection': t(
              'Select connection-specific plugin instance ownership.',
              '选择每个连接各自的插件实例所有权。'
            )
          }
        },
        replaceStrategy: {
          summary: t(
            'Optional whole-process replacement strategy for spawned deployment: stop-then-start or start-then-switch. Connect deployments reject it.',
            '启动部署可选的整进程替换策略：先停后启或先启后切换；连接部署拒绝此字段。'
          ),
          default: t(
            'Omitted: parser does not add a replacement strategy.',
            '省略时解析器不补充替换策略。'
          ),
          values: {
            'stop-then-start': t(
              'Stop the current generation before starting its replacement.',
              '先停止当前世代，再启动替换世代。'
            ),
            'start-then-switch': t(
              'Prepare a new process candidate before switching the host registration.',
              '先准备新进程候选，再切换宿主登记。'
            )
          }
        },
        contract: {
          summary: t(
            'Required plugin-only `IRemoteContract` describing callable Feature methods; host descriptors use catalog instead.',
            '仅插件分支必填的 `IRemoteContract`，描述可调用特性方法；宿主分支改用目录。'
          )
        },
        catalog: {
          summary: t(
            'Required host-only `IRemoteHostCatalog` describing the exported remote host capabilities.',
            '仅宿主分支必填的 `IRemoteHostCatalog`，描述导出的远程宿主能力。'
          )
        }
      }
    },
    IProcessPluginEstablish: {
      summary: t(
        'Handshake step `(raw, options) => channel` of a deployment.',
        '部署中执行握手的步骤函数 `(raw, options) => channel`。'
      ),
      members: {}
    },
    IProcessPluginReplaceResult: {
      summary: t(
        'Result of `plugin.replace()`: strategy and outcome or new plugin.',
        '`plugin.replace()` 的结果：采用的策略，以及结果或新插件。'
      ),
      members: {
        strategy: {
          summary: t(
            'Replacement strategy discriminant selecting the stopped-then-started supervisor outcome or trusted candidate plugin.',
            '替换策略判别值，选择先停后启的监督结果或可信候选插件。'
          ),
          values: {
            'stop-then-start': t(
              'The supervisor ran in-place replacement; inspect outcome.',
              '监督器执行原位替换，应检查对应结果。'
            ),
            'start-then-switch': t(
              'A new trusted plugin candidate is returned for host switching.',
              '返回新的可信插件候选，供宿主切换。'
            )
          }
        },
        outcome: {
          summary: t(
            'Supervisor `IReplaceOutcome` returned only by stop-then-start replacement, preserving its readiness or terminal outcome.',
            '仅先停后启替换返回的监督 `IReplaceOutcome`，保留就绪或终止结局。'
          )
        },
        plugin: {
          summary: t(
            'Trusted `IProcessPlugin` candidate returned only for start-then-switch; install through the owning host’s replacement operation.',
            '仅先启后切换返回的可信 `IProcessPlugin` 候选；通过所属宿主替换操作安装。'
          )
        }
      }
    },
    IProcessPluginSession: {
      summary: t(
        'Session labels passed to `establish`.',
        '传给 `establish` 握手函数的会话诊断标签。'
      ),
      members: {
        connectionId: {
          summary: t('Id of the connection, for diagnostics.', '该连接的唯一 id，用于诊断。')
        },
        sessionId: {
          summary: t('Id of the session on the connection.', '该连接上本次会话的唯一 id。')
        },
        processId: {
          summary: t(
            'Id of the child process, when spawned.',
            '对应子进程的 id（只有 spawn 时才有）。'
          )
        }
      }
    },
    IProcessRegistration: {
      summary: t(
        'Registration returned by `resilience.attachRegistration()`.',
        '由 `resilience.attachRegistration()` 返回的受治理登记对象。'
      ),
      scenarios: [
        t(
          'Restart or inspect one governed process from an admin command.',
          '通过管理命令重启或查看某个受治理的进程。'
        )
      ],
      example: `const registration = resilience.attachRegistration('service', binding, owner)
console.log(registration.inspect()?.state)
await registration.restart()
await registration.close()`,
      members: {
        restart: {
          summary: t('Restarts the registered unit.', '重启该登记对应的执行单元。'),
          returns: t('A ready outcome of the new generation.', '新代次的就绪结果。'),
          example: `await registration.restart()`
        },
        inspect: {
          summary: t('Reads the current resilience snapshot.', '读取该登记当前的治理快照。'),
          returns: t('The snapshot or `undefined`.', '快照对象或 `undefined`。'),
          example: `registration.inspect()?.liquidated`
        },
        close: {
          summary: t('Detaches it from governance and closes it.', '解除治理附加并关闭该登记。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。'),
          example: `await registration.close()`
        }
      }
    },
    IProcessRegistrationBinding: {
      summary: t('How a registration is supervised.', '某个登记的所有权与监督方式。'),
      members: {
        ownership: {
          summary: t(
            'Who owns the process; decides whether it can restart.',
            '该进程由谁拥有，决定能否重启。'
          ),
          values: {
            'spawn-owned': t(
              'This side started the process and may restart it.',
              '由本端启动的进程，本端可以重启它。'
            ),
            'connection-borrowed': t(
              'A connection to someone else process; only the session is owned.',
              '连接到他人的进程；本端只拥有会话。'
            )
          }
        },
        supervisor: {
          summary: t('Supervisor port used to restart and inspect.', '用于重启与查询的监督器端口。')
        },
        health: {
          summary: t('How the health of the registration is checked.', '该登记的健康检查方式。'),
          values: {
            ping: t(
              'Native ping at intervals (default 5 s, 3 failures).',
              '定时发送原生 ping（默认 5 秒一次，连续 3 次失败）。'
            ),
            custom: t('A health check supplied by the caller.', '由调用方提供的自定义健康检查。'),
            none: t('No health checks.', '不进行任何健康检查。')
          }
        }
      }
    },
    IProcessRegistrationListener: {
      summary: t(
        'Listener returned by `resilience.listenRegistrations()`.',
        '调用 `resilience.listenRegistrations()` 返回的登记监听器。'
      ),
      scenarios: [
        t(
          'Let worker processes register themselves with a coordinator.',
          '让工作进程主动向协调进程登记自己。'
        )
      ],
      example: `const listener = await resilience.listenRegistrations(options)
console.log(listener.address)
await listener.close()`,
      members: {
        address: {
          summary: t(
            'Bound address, with the real port when `0` was given.',
            '实际绑定的地址；传入端口 `0` 时为真实端口。'
          )
        },
        close: {
          summary: t('Stops accepting registrations.', '停止接受新的登记并释放地址。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。'),
          example: `await listener.close()`
        }
      }
    },
    IProcessRegistrationListenOptions: {
      summary: t(
        'Options of `listenRegistrations()`.',
        '`listenRegistrations()` 的选项：监听、认证与会话接纳。'
      ),
      members: {
        wire: {
          summary: t(
            'Always `native`: registrations use this library protocol.',
            '固定为 `native`，登记使用本库协议。'
          )
        },
        listen: {
          summary: t(
            'Socket listener such as `listenProcessByteChannel`.',
            '用于接受连接的 socket 监听函数，例如 `listenProcessByteChannel`。'
          )
        },
        address: {
          summary: t('Local address to bind, e.g. a Unix path.', '要绑定的本机监听地址。')
        },
        serviceId: {
          summary: t(
            'Stable owner id needed for Unix rendezvous paths.',
            'Unix 会合路径所需的稳定所有者 id。'
          )
        },
        offer: { summary: t('Native handshake offer of this side.', '本端发出的原生握手提议。') },
        createConnectionContext: {
          summary: t(
            'Returns `{ peerId, ipc }` for a pending connection.',
            '为每个待处理连接返回 `{ peerId, ipc }`。'
          ),
          params: { pending: t('The pending connection.', '待处理的连接。') },
          returns: t('`{ peerId, ipc }`.', '连接上下文 `{ peerId, ipc }`。')
        },
        verifyToken: {
          summary: t('Checks the client credential.', '校验客户端提交的凭据。'),
          params: {
            auth: t('Credential sent by the client.', '客户端发送的凭据。'),
            peer: t('Peer info of the client.', '客户端的对端信息。')
          },
          returns: t('The principal id.', '校验通过的主体 id。')
        },
        onCandidate: {
          summary: t(
            'Decides to `adopt` or `reject` an authenticated session.',
            '决定 `adopt` 或 `reject` 一个已认证的会话。'
          ),
          params: { candidate: t('Session lease with a signal.', '带信号的会话租约。') },
          returns: t('`adopt` or `reject`.', '返回接纳 `adopt` 或拒绝 `reject`。')
        },
        scheduler: { summary: t('Clock for handshake deadlines.', '握手截止时间所用的时钟。') },
        handshakeTimeoutMs: {
          summary: t('Handshake deadline in milliseconds.', '握手的截止时间，单位毫秒。')
        },
        signal: { summary: t('Stops listening when aborted.', '该信号中止时停止监听。') }
      }
    },
    IProcessRegistrationSupervisorPort: {
      summary: t('Supervisor operations used by resilience.', '治理对象使用的监督器操作。'),
      members: {
        restart: {
          summary: t('Restarts the supervised unit.', '重启受监督的执行单元。'),
          returns: t('A ready outcome.', '重启后的就绪结果。')
        },
        inspect: {
          summary: t('Reads the supervisor snapshot.', '读取监督器的当前快照。'),
          returns: t('The snapshot.', '监督器快照对象。')
        },
        onTerminal: {
          summary: t('Observes terminal entries.', '观察执行单元进入终态的事件。'),
          params: {
            listener: t('Receives `{ entry, error }`.', '接收 `{ entry, error }` 的监听函数。')
          },
          returns: t('An unsubscribe function.', '取消订阅的函数。')
        },
        dispose: {
          summary: t('Disposes the supervisor.', '释放该监督器及其执行单元。'),
          returns: t('Resolves when disposed.', '释放完成后 resolve。')
        }
      }
    },
    IProcessServeChildIngress: {
      summary: t(
        'Child-side ingress: how a served child opens its channel to the parent.',
        '子进程端入口：被服务的子进程如何打开通往父进程的通道。'
      ),
      members: {
        kind: {
          summary: t('Always `child`: a child ingress.', '固定为 `child`，表示子进程入口。')
        },
        channelKind: {
          summary: t(
            'Channel kind: `byte` or `message`.',
            '子进程原始通道的类型：`byte` 或 `message`。'
          )
        },
        openRaw: {
          summary: t(
            'Opens the raw channel and reads the bootstrap.',
            '打开原始通道并读取启动数据。'
          ),
          params: { signal: t('Aborts the opening.', '用于中止打开过程的信号。') },
          returns: t('The channel (and bootstrap).', '通道（以及启动数据）。')
        },
        createVerifier: {
          summary: t(
            'Builds the credential check from the bootstrap.',
            '根据启动数据构建凭据校验函数。'
          ),
          params: { bootstrap: t('Bootstrap bytes.', '启动数据字节。') },
          returns: t('A verify function.', '一个凭据校验函数。')
        },
        establish: {
          summary: t('Runs the handshake with the parent.', '与父进程执行握手的函数。')
        },
        parentLoss: {
          summary: t(
            'What to do when the parent disappears: `exit`, `graceMs`, `probe`.',
            '父进程消失时的处理方式：`exit`、`graceMs`、`probe`。'
          )
        }
      }
    },
    IProcessServeEndpointFactory: {
      summary: t(
        'Builds the serving endpoint for one accepted session.',
        '为一个已接受的会话构建服务端 Endpoint。'
      ),
      members: {}
    },
    IProcessServeListenerIngress: {
      summary: t(
        'Listener ingress: how a served process accepts sessions.',
        '监听入口：被服务的进程如何接受会话。'
      ),
      members: {
        kind: {
          summary: t(
            'Always `listener`: a listener ingress.',
            '固定为 `listener`，表示这是监听入口。'
          )
        },
        listen: {
          summary: t('Socket listener function to use.', '用于接受连接的 socket 监听函数。')
        },
        address: {
          summary: t('Local address to bind, e.g. a Unix path.', '要绑定的本机监听地址。')
        },
        verify: {
          summary: t('Checks client credentials.', '校验客户端提交的凭据。'),
          params: {
            auth: t('Credential sent by the client.', '客户端发送的凭据。'),
            peer: t('Peer info.', '客户端的对端信息。')
          },
          returns: t('The principal id.', '校验通过的主体 id。')
        },
        offer: { summary: t('Native handshake offer of this side.', '本端发出的原生握手提议。') },
        scheduler: { summary: t('Clock used for deadlines.', '计算截止时间所用的时钟。') },
        createConnectionContext: {
          summary: t(
            'Returns `{ peerId, ipc }` per connection.',
            '为每个新到达的连接返回 `{ peerId, ipc }`。'
          ),
          params: { pending: t('The pending connection.', '待处理的连接。') },
          returns: t('`{ peerId, ipc }`.', '连接上下文 `{ peerId, ipc }`。')
        }
      }
    },
    IProcessSessionIdentity: {
      summary: t('Identity of one accepted session.', '一个已接受会话的身份信息。'),
      members: {
        connectionId: {
          summary: t('Id of the connection carrying the session.', '该会话所在连接的唯一 id。')
        },
        sessionId: { summary: t('Unique id of the session itself.', '该会话自身的唯一 id 标识。') },
        principalId: {
          summary: t('Principal returned by `verify`.', '由 `verify` 校验通过后返回的主体 id。')
        },
        processId: {
          summary: t('Child process id, when known.', '对应子进程的 id（已知时才有）。')
        }
      }
    },
    IProcessSessionLease: {
      summary: t(
        'An authenticated session offered to `onCandidate`.',
        '提交给 `onCandidate` 决定是否接纳的已认证会话。'
      ),
      members: {
        channel: { summary: t('Protocol channel of the session.', '该会话已握手的协议通道。') },
        identity: { summary: t('Identity of the session.', '该会话的身份信息与主体。') },
        close: {
          summary: t('Closes the session and its channel.', '关闭该会话并释放通道。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。')
        }
      }
    },
    IBunProcessHandle: {
      summary: t('Handle of a Bun child process.', '由 Bun launcher 启动的子进程句柄对象。'),
      members: {
        channel: {
          summary: t(
            'stdio byte channel, when routed to the channel.',
            'stdio 字节通道（stdio 走通道时才有）。'
          )
        },
        runtimeApiIdentity: {
          summary: t('Identity written in the bootstrap.', '写入启动数据的身份信息。')
        }
      }
    },
    IDenoProcessHandle: {
      summary: t('Handle of a Deno child process.', '由 Deno launcher 启动的子进程句柄对象。'),
      members: {
        channel: {
          summary: t(
            'stdio byte channel, when routed to the channel.',
            'stdio 字节通道（stdio 走通道时才有）。'
          )
        },
        runtimeApiIdentity: {
          summary: t('Identity written in the bootstrap.', '写入启动数据的身份信息。')
        }
      }
    },
    INodeProcessHandle: {
      summary: t('Handle of a Node child process.', '由 Node launcher 启动的子进程句柄对象。'),
      members: {
        channel: {
          summary: t(
            'stdio byte channel, when routed to the channel.',
            'stdio 字节通道（stdio 走通道时才有）。'
          )
        },
        runtimeApiIdentity: {
          summary: t('Identity written in the bootstrap.', '写入启动数据的身份信息。')
        }
      }
    },
    IElectronProcessHandle: {
      summary: t(
        'Handle of an Electron utility process.',
        '由 Electron 启动器创建的 utility process 子进程句柄对象。'
      ),
      members: {
        channel: {
          summary: t(
            'Message channel to the utility process.',
            '通往该 utility process 的双向消息通道。'
          )
        }
      }
    },
    IAdapterChildStdio: {
      summary: t(
        'stdio pipes of a Node child, as seen by the parent.',
        '父进程看到的 Node 子进程 stdio 管道。'
      ),
      members: {
        stdout: { summary: t('Readable stream from the child.', '来自子进程标准输出的可读流。') },
        stdin: { summary: t('Writable stream to the child.', '写往子进程标准输入的可写流。') }
      }
    },
    IAdapterProcessStdio: {
      summary: t(
        'Own stdio of the current process, as seen by a child.',
        '子进程看到的、本进程自身的 stdio。'
      ),
      members: {
        stdin: {
          summary: t('Readable `process.stdin`.', '本进程可读的标准输入 `process.stdin`。')
        },
        stdout: {
          summary: t('Writable `process.stdout`.', '本进程可写的标准输出 `process.stdout`。')
        }
      }
    },
    IRpcProcessErrorCode: {
      summary: t(
        'Union of `RpcProcessErrorCode` values.',
        '`RpcProcessErrorCode` 全部取值组成的联合类型。'
      ),
      members: {}
    }
  },
  enums: {
    RuntimeEventName: runtimeEventEnum,
    ProcessPluginWire: {
      summary: t('Wire protocols of process connections.', '进程连接使用的线路协议。'),
      values: {
        native: t(
          '`native`: this library protocol with streams, cancellation and transfer.',
          '`native`：本库协议，支持流、取消与转移。'
        ),
        jsonrpc: t(
          '`jsonrpc`: JSON-RPC bridge for other languages; no `stream` or `transfer`.',
          '`jsonrpc`：面向其它语言的 JSON-RPC 桥接；不支持 `stream` 与 `transfer`。'
        )
      }
    },
    RpcProcessErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/rpc-process`.',
        '`@migaia/rpc-process` 的稳定错误码及其处理方式。'
      ),
      values: {
        usageSampleFailed: t(
          '`PROCESS_USAGE_SAMPLE_FAILED`: CPU or memory sampling failed; show unavailable.',
          '`PROCESS_USAGE_SAMPLE_FAILED`：CPU 或内存采样失败；显示为不可用即可。'
        ),
        hostInvalidOption: t(
          '`PROCESS_HOST_INVALID_OPTION`: a host option is invalid; fix the named field.',
          '`PROCESS_HOST_INVALID_OPTION`：宿主相关选项不合法；修正对应字段。'
        ),
        hostClosed: t(
          '`PROCESS_HOST_CLOSED`: the outlet is releasing; use a new host or Peer.',
          '`PROCESS_HOST_CLOSED`：出口正在释放；改用新的宿主或 Peer。'
        ),
        handshakeTimeout: t(
          '`PROCESS_HANDSHAKE_TIMEOUT`: the handshake did not finish in time; open a new channel.',
          '`PROCESS_HANDSHAKE_TIMEOUT`：握手未按时完成；需要新建通道。'
        ),
        authRejected: t(
          '`PROCESS_CHANNEL_AUTH_REJECTED`: the credential was refused; do not retry with it.',
          '`PROCESS_CHANNEL_AUTH_REJECTED`：凭据被拒绝；不要用同一凭据重试。'
        ),
        channelClosed: t(
          '`PROCESS_CHANNEL_CLOSED`: work on a closed channel; reconnect and reconcile.',
          '`PROCESS_CHANNEL_CLOSED`：在已关闭的通道上继续工作；重新连接并对账。'
        ),
        connectFailed: t(
          '`PROCESS_CHANNEL_CONNECT_FAILED`: dial or launch failed; see `cause`.',
          '`PROCESS_CHANNEL_CONNECT_FAILED`：拨号或启动子进程失败；原因见 `cause`。'
        ),
        listenFailed: t(
          '`PROCESS_CHANNEL_LISTEN_FAILED`: the address could not be bound; choose another.',
          '`PROCESS_CHANNEL_LISTEN_FAILED`：无法绑定该地址；换一个地址。'
        ),
        pluginInvalidOption: t(
          '`PROCESS_PLUGIN_INVALID_OPTION`: a plugin or source option is invalid.',
          '`PROCESS_PLUGIN_INVALID_OPTION`：插件或来源选项不合法。'
        ),
        resilienceInvalidOption: t(
          '`PROCESS_RESILIENCE_INVALID_OPTION`: a governance limit is invalid.',
          '`PROCESS_RESILIENCE_INVALID_OPTION`：连接治理的限制配置不合法。'
        ),
        connectionLimit: t(
          '`PROCESS_CONNECTION_LIMIT`: connection, rate or payload limit; the call did not run.',
          '`PROCESS_CONNECTION_LIMIT`：超出连接、速率或参数限制；调用没有执行。'
        ),
        instanceUnhealthy: t(
          '`PROCESS_INSTANCE_UNHEALTHY`: the target is suspended until a healthy replacement is ready.',
          '`PROCESS_INSTANCE_UNHEALTHY`：目标已挂起，直到健康的替代就绪。'
        ),
        healthPingFailed: t(
          '`PROCESS_HEALTH_PING_FAILED`: a health ping failed; supervision restarts it.',
          '`PROCESS_HEALTH_PING_FAILED`：健康 ping 失败；由监督策略重启。'
        ),
        terminalCall: t(
          '`PROCESS_TERMINAL_CALL`: the registration is terminal and refuses calls.',
          '`PROCESS_TERMINAL_CALL`：登记已进入终态，拒绝新调用。'
        ),
        liquidated: t(
          '`PROCESS_LIQUIDATED`: the registration was liquidated; create a new one.',
          '`PROCESS_LIQUIDATED`：登记已被清算；需要创建新的登记。'
        )
      }
    }
  },
  enhancers: {
    createProcessPlugin: {
      kind: 'plugin',
      target: 'PluginHost',
      summary: t(
        'After installation the host has `host.process`: calls by connection name, `list` / `get`, `broadcast`, `stop` / `kill` / `restart` / `replace` (spawn sources only), and events (`on`, `watch`). The host disposes the connection, and a spawned child, with itself.',
        '安装后宿主拥有 `host.process`：按连接名称调用、`list` / `get`、`broadcast`、`stop` / `kill` / `restart` / `replace`（仅 spawn 来源），以及事件（`on`、`watch`）。宿主释放时一并释放该连接与 spawn 的子进程。'
      ),
      install: `const service = createProcessPlugin({ name: 'service', spawn: new URL('./service.js', import.meta.url) })
await host.use(service)`,
      grants: runtimeOutletGrants('process'),
      behaviors: [
        t(
          '`stop` / `kill` / `restart` / `replace` on connect or listen sources reject with `CAPABILITY_CONFLICT`.',
          '对 connect 或 listen 来源调用 `stop` / `kill` / `restart` / `replace` 会以 `CAPABILITY_CONFLICT` 拒绝。'
        )
      ],
      scenarios: [
        t(
          'Manage a pool of worker processes and restart crashed ones from one host.',
          '在一个宿主中管理一组工作进程，并重启崩溃的进程。'
        )
      ],
      example: pluginExample
    }
  }
}
