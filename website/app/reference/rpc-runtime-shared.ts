/**
 * Shared reference docs for the Runtime Peer types that `@migaia/rpc-threads` and
 * `@migaia/rpc-process` both re-export from `@migaia/rpc-core` (one source of truth, so the two
 * libraries never drift). Verified against `packages/rpc-core/src/remote/runtime-api` (overview.ts,
 * outlet.ts, events.ts, typing.ts, constants.ts, catalog.ts, peer.ts) on 2026-10-17. Paired
 * keyed-call examples include the advanced method declaration required by catalog.ts; a TypeScript
 * method type alone does not declare runtime idempotency support.
 */
import type {
  ICode,
  IEnumDoc,
  IGrantDoc,
  IMemberDoc,
  ISymbolDoc,
  IText,
  ITypeDoc
} from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete multi-file examples use the selected platform's real automatic child bootstrap. */
const runtimePairedExample = (
  slot: 'thread' | 'process',
  action: string,
  managed = false
): ICode => {
  /** The public package and factory spellings follow the selected native execution family. */
  const family = slot === 'thread' ? 'Thread' : 'Process'
  /** Child entry is compiled alongside the main entry before running Node. */
  const childFile = slot === 'thread' ? 'worker' : 'service'
  /** A managed outlet dispatches through the installed plugin rather than a separate Peer. */
  const setup = managed
    ? `const plugin = create${family}Plugin<IWorkerApi, IParentApi, 'worker'>({
  name: 'worker', spawn: new URL('./${childFile}.js', import.meta.url), provide
})
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})`
    : `const worker = await create${family}Peer<IWorkerApi>({
  spawn: new URL('./${childFile}.js', import.meta.url), provide
})`
  /** Each locale describes real files and parent-owned shutdown without English prose leakage. */
  const render = (
    zh: boolean
  ): string => `${zh ? '// 类型契约文件：api.ts' : '// Contract file: api.ts'}
export type IWorkerApi = {
  demo: {
    math: { double(value: number): number }
    log: { write(message: string): void }
    feed: { count(limit: number): AsyncIterableIterator<number> }
  }
}
export type IParentApi = { hello(name: string): string; ready(): void }

${zh ? '// 子端文件：' : '// Child file: '}${childFile}.ts
import { create${family}Peer } from '@migaia/rpc-${slot === 'thread' ? 'threads' : 'process'}'
import type { IWorkerApi, IParentApi } from './api.js'
const provide: IWorkerApi = {
  demo: {
    math: { double: value => value * 2 },
    log: { write: message => console.${slot === 'process' ? 'error' : 'log'}(message) },
    feed: { count: async function* (limit) {
      for (let index = 1; index <= limit; index++) yield index
    } }
  }
}
const parent = await create${family}Peer<IParentApi>({
  provide,
  contract: {
    schemaVersion: 1, plugin: 'demo', features: {
      math: { methods: { double: { mode: 'request', idempotent: true } } },
      log: { methods: { write: { mode: 'one-way', idempotent: false } } },
      feed: { methods: { count: { mode: 'async-generator', idempotent: false } } }
    }
  }
})
console.${slot === 'process' ? 'error' : 'log'}(await parent.request('hello', '${childFile}'))
await parent.notify('ready')
${zh ? '// 父端持有派生资源；父端关闭时会释放此连接并终止子端。' : '// The parent owns this spawned resource; its close releases the connection and child.'}

${zh ? '// 父端文件：main.ts；先将这三个文件编译为同目录的模块。' : '// Parent file: main.ts; compile all three files to modules in the same directory first.'}
import { create${family}${managed ? 'Plugin' : 'Peer'} } from '@migaia/rpc-${slot === 'thread' ? 'threads' : 'process'}'
${managed ? "import { defineHost } from '@migaia/plugin-host'\n" : ''}import type { IWorkerApi, IParentApi } from './api.js'
const childReady = Promise.withResolvers<void>()
const provide: IParentApi = {
  hello: name => 'hello ' + name,
  ready: () => childReady.resolve()
}
${setup}
try {
${managed ? '  await host.use(plugin)\n' : ''}  await childReady.promise
${action
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
} finally {
  await ${managed ? 'host.dispose()' : 'worker.close()'}
}`
  return { en: render(false), zh: render(true) }
}

/** Typed methods remain fully paired even on pages that render just one member example. */
const pairedPeerActions: Readonly<Record<string, string>> = {
  outcome: `await worker.request('demo.math.double', 21, { idempotencyKey: 'double-42' })
console.log(await worker.outcome('double-42'))`,
  describe: `console.log(await worker.request('demo.math.double', 21))
console.log(await worker.describe())
console.log(await worker.describe({ format: 'json' }))`,
  on: `const off = worker.on('exit', event => console.log(event))
try { console.log(await worker.request('demo.math.double', 21)) } finally { off() }`,
  close: `console.log(await worker.request('demo.math.double', 21))
await worker.close()
await worker.close()`,
  '[Symbol.asyncDispose]': `console.log(await worker.request('demo.math.double', 21))
await worker[Symbol.asyncDispose]()`,
  request: `console.log(await worker.request('demo.math.double', 21, { timeoutMs: 1000 }))`,
  notify: `await worker.notify('demo.log.write', 'started')`,
  stream: `for await (const value of worker.stream('demo.feed.count', 3)) console.log(value)`,
  group: `console.log(await worker.group([
  { method: 'demo.math.double', payload: 1 },
  { method: 'demo.math.double', payload: 2 }
]))`
}

/** Text for fields whose value can be an explicit "unavailable" marker. */
const orUnavailable = t(
  'or `{ status: "unavailable", reason }` when the owner cannot observe it.',
  '无法观察时为 `{ status: "unavailable", reason }`。'
)

/** Members shared by connection details and local Peer details. */
const detailCommon: Readonly<Record<string, IMemberDoc>> = {
  methods: {
    summary: t(
      'Method paths callable on the other side, from its accepted directory.',
      '对端已接受目录中可调用的方法路径。'
    )
  },
  counters: {
    summary: t(
      `Call counters: \`inFlight\` (calls not yet finished) is measured; \`sent\`, \`received\`, \`errors\`, \`lastActiveAt\` are reported unavailable; ${orUnavailable.en}`,
      `调用计数：\`inFlight\`（尚未结束的调用数）会被测量；\`sent\`、\`received\`、\`errors\`、\`lastActiveAt\` 报告为不可用；${orUnavailable.zh}`
    )
  },
  recent: {
    summary: t(
      'Recent lifecycle records (`IRuntimeRecent`), newest last.',
      '最近的生命周期记录（`IRuntimeRecent`），最新的在最后。'
    )
  }
}

/** Typed Peer call methods (`IRuntimeTypedPeer`). */
const typedPeerMembers: Readonly<Record<string, IMemberDoc>> = {
  self: {
    summary: t(
      'Frozen local peer name and instanceId minted or supplied during this connection construction; it is not a remote authentication principal.',
      '连接构造时签发或由应用提供的冻结本端名称与实例标识，不代表对端认证主体。'
    )
  },
  outcome: {
    summary: t(
      'Queries the original remote operation ledger for a prior idempotency key, without dispatching that operation again.',
      '查询原始远端操作账本中已有幂等键的结果，不会再次派发对应操作。'
    ),
    params: {
      idempotencyKey: t(
        'The caller-issued key supplied as options.idempotencyKey on an earlier request to this connection.',
        '来自调用方先前在此连接请求的 `options.idempotencyKey` 中指定的幂等键。'
      )
    },
    returns: t(
      'Promise of IRpcRuntimeOutcomeResult; support and availability come from the accepted remote runtime contract.',
      '返回 `IRpcRuntimeOutcomeResult` 承诺，支持程度与可用性取决于已接受的远端运行时契约。'
    ),
    example: `await worker.request('orders.create', order, { idempotencyKey: 'order-42' })\nconsole.log(await worker.outcome('order-42'))`
  },
  describe: {
    summary: t(
      'Queries the local accepted peer detail asynchronously. Without format returns IRuntimeDetail; json, yaml or toml returns the admitted text projection. It does not claim unavailable physical metrics.',
      '异步查询本地已接受的连接详情，不选格式时返回 `IRuntimeDetail`，选择 `json`、`yaml` 或 `toml` 时返回允许的文本投影，不编造不可观察的物理指标。'
    ),
    params: {
      options: t(
        'Optional query format from IRuntimeQueryOptions; omitted returns the object snapshot.',
        '来自 `IRuntimeQueryOptions` 的可选查询格式，省略时返回对象快照。'
      )
    },
    returns: t(
      'Promise of local detail or formatted text, following the selected query format.',
      '根据所选查询格式返回本地详情或格式化文本的承诺。'
    ),
    example: `console.log(await worker.describe())\nconsole.log(await worker.describe({ format: 'json' }))`
  },
  on: {
    summary: t(
      'Registers a future RuntimeEventName listener after construction; factory resolution already represents initial readiness. Listener return is ignored and failures are contained by the runtime reporter.',
      '构造完成后登记未来运行时事件监听，工厂完成已经代表首次就绪；不消费监听返回值，失败由运行时报告接收方隔离。'
    ),
    params: {
      event: t(
        'A RuntimeEventName value such as ready or exit; it selects future connection lifecycle notifications.',
        '来自 `RuntimeEventName` 的取值，例如 `ready` 或 `exit`，用于选择未来连接生命周期通知。'
      ),
      listener: t(
        'Callback receives IRuntimeEvent from this connection; return is ignored and throws or rejected thenables are reported.',
        '回调接收来自本连接的 `IRuntimeEvent`，返回值不消费，抛错或类承诺拒绝会报告。'
      )
    },
    returns: t(
      'Idempotent removal function for this registration; closing the peer clears its publisher.',
      '返回本次登记的幂等移除函数，关闭连接会清理其事件发布者。'
    ),
    example: `const off = worker.on('exit', event => console.log(event))\nawait worker.close()\noff()`
  },
  close: {
    summary: t(
      'Ends this logical connection and releases its owned channel resources; platform factories also terminate a worker or child they spawned.',
      '结束本逻辑连接并释放其拥有的通道资源，平台工厂还会终止由它启动的线程或子进程。'
    ),
    returns: t(
      'Shared completion Promise retaining the original close operation identity; no new calls are admitted once closing begins.',
      '返回保持原始关闭操作身份的共享完成承诺，关闭开始后不再接纳新调用。'
    ),
    example: `await worker.close()\nawait worker.close()`
  },
  '[Symbol.asyncDispose]': {
    summary: t(
      'Scoped asynchronous cleanup is the exact original close operation, including its Promise identity.',
      '作用域异步清理使用原始关闭操作本身，并保持其完成承诺身份。'
    ),
    returns: t(
      'The same completion Promise as close(), including platform-owned resource cleanup.',
      '返回与 `close()` 相同的完成承诺，包含平台拥有资源的清理。'
    ),
    example: `await worker[Symbol.asyncDispose]()`
  },
  request: {
    summary: t(
      'Calls a method the other side provides and waits for its result. Default deadline 30000 ms (`defaultTimeoutMs`); errors keep their native type and `(source, code)`.',
      '调用对端提供的方法并等待结果。默认截止时间为 30000 毫秒（可由 `defaultTimeoutMs` 修改）；错误保留原生类型与 `(source, code)`。'
    ),
    params: {
      method: t(
        'Dotted path of a method in the other side `provide`, e.g. `math.double`.',
        '对端 `provide` 中方法的点分路径，例如 `math.double`。'
      ),
      args: t(
        '`(payload?, options?)`: one payload and call options (`timeoutMs`, `signal`, `transfer`, `idempotencyKey`).',
        '`(payload?, options?)`：一个参数，以及调用选项（`timeoutMs`、`signal`、`transfer`、`idempotencyKey`）。'
      )
    },
    returns: t(
      'The method result, typed from `TRemote`.',
      '方法的返回结果，类型由 `TRemote` 推导。'
    ),
    example: `const total = await worker.request('math.double', 21, { timeoutMs: 1000 })`
  },
  notify: {
    summary: t('Sends a one-way call; no result comes back.', '发送单向调用，不会返回结果。'),
    params: {
      method: t('Dotted method path provided by the other side.', '对端提供的方法的点分路径。'),
      args: t(
        '`(payload?, options?)` as for `request`.',
        '`(payload?, options?)`，规则与 `request` 相同。'
      )
    },
    returns: t('Resolves once the call was sent.', '调用发送后 resolve。'),
    example: `await worker.notify('log.write', 'started')`
  },
  stream: {
    summary: t(
      'Calls a method that returns an iterable and yields its items as they arrive.',
      '调用返回可迭代对象的方法，并在元素到达时逐个产出。'
    ),
    params: {
      method: t(
        'Dotted path of an iterator method provided by the other side.',
        '对端提供的迭代器方法的点分路径。'
      ),
      args: t(
        '`(payload?, options?)` as for `request`.',
        '`(payload?, options?)`，规则与 `request` 相同。'
      )
    },
    returns: t('An async iterator of the yielded items.', '所产出元素的异步迭代器。'),
    example: `for await (const value of worker.stream('feed.count', 3)) console.log(value)`
  },
  group: {
    summary: t(
      'Sends several calls as one batch and returns the outcome of each step in order.',
      '把多次调用作为一个批次发送，并按顺序返回每一步的结果。'
    ),
    params: {
      steps: t(
        'Steps `{ method, payload? }` in order.',
        '按顺序排列的步骤 `{ method, payload? }`。'
      ),
      options: t(
        'Batch options such as `timeoutMs` and `signal`.',
        '批次选项，例如 `timeoutMs` 与 `signal`。'
      )
    },
    returns: t(
      'One outcome per step (success value or error).',
      '每一步对应一个结果（成功值或错误）。'
    ),
    example: `const [a, b] = await worker.group([{ method: 'math.double', payload: 1 }, { method: 'math.double', payload: 2 }])`
  }
}

/**
 * Common Peer input fields owned by rpc-core/remote/runtime-api/peer.ts. Platform references reuse
 * these semantics and override only fields whose platform preparation changes the default.
 */
export const runtimePeerOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  endpointFactory: {
    summary: t(
      'Advanced synchronous invocation of an async endpoint factory with this acquired channel and native abort signal; its Promise must resolve an IRemoteServeEndpoint. Failure triggers construction rollback.',
      '高级端点工厂在取得通道后接收该通道与原生中止信号，其承诺须返回 `IRemoteServeEndpoint`，失败会触发构造回滚。'
    ),
    params: {
      channel: t(
        'IRemoteChannelResources acquired by the selected platform source; ownership remains with the original construction.',
        '由所选平台来源取得的 `IRemoteChannelResources`，所有权仍归原始构造流程。'
      ),
      signal: t(
        'Native construction cancellation signal supplied by the peer owner.',
        '由连接拥有者提供的原生构造取消信号。'
      )
    },
    returns: t(
      'Promise of the endpoint assembled for this exact channel; throw or rejection preserves the original construction failure.',
      '返回为此精确通道组装的端点承诺，抛错或拒绝保留原始构造失败。'
    ),
    default: t(
      'Omitted: the canonical runtime endpoint is assembled from the acquired channel and common options.',
      '省略时根据已取得通道与通用选项组装规范运行时端点。'
    )
  },
  self: {
    summary: t(
      'Application-supplied safe identity with nonempty name and instanceId; neither credentials nor arbitrary properties are published.',
      '应用提供的安全身份，含非空名称与实例标识，不会发布凭据或任意额外属性。'
    ),
    default: t(
      'Omitted: the core uses RUNTIME_PEER_DEFAULT_NAME and a generated defaultRpcId; trusted platform bootstrap may supply its own identity.',
      '省略时核心使用默认连接名称常量与自动生成的实例标识，可信平台启动数据也可提供自身身份。'
    )
  },
  provide: {
    summary: t(
      'Application-provided local methods, descriptors or allowed runtime forwarding entries compiled into the accepted directory; methods receive the remote payload and preserve synchronous or async failures.',
      '应用提供的本端方法、描述符或获准运行时转发条目，会编译为已接受目录；方法接收远端载荷，同步或异步失败均保留。'
    ),
    default: t(
      'Omitted: this side publishes no application methods.',
      '省略时本端不发布任何应用方法。'
    )
  },
  providerLimits: {
    summary: t(
      'Provider admission policy forwarded to the canonical endpoint; it does not alter transport framing or acquire another provider registry.',
      '转交规范端点的提供方接纳策略，不改变传输分帧，也不另建提供方登记表。'
    ),
    default: t(
      'Omitted: the original endpoint or listener admission owner supplies its standard provider limits.',
      '省略时由原端点或监听接纳拥有者提供标准提供方限制。'
    )
  },
  authentication: {
    summary: t(
      'Original signing, verification and optional encryption configuration installed into canonical endpoint assembly; invalid credentials reject construction before publication.',
      '安装到规范端点组装的原始签名、校验与可选加密配置，非法凭据会在发布前拒绝构造。'
    ),
    default: t(
      'Omitted: no authentication middleware is added by these options.',
      '省略时不通过本选项增加认证中间件。'
    )
  },
  probe: {
    summary: t(
      'One IRpcProbe or an array of probes from the application, installed as endpoint-local synchronous observers without selecting a different pipeline.',
      '应用提供的一个或多个 `IRpcProbe`，安装为端点本地同步观察者，不会据此选择另一套管线。'
    ),
    default: t('Omitted: no observer is added by this field.', '省略时不通过此字段增加观察者。')
  },
  defaultTimeoutMs: {
    summary: t(
      'Finite positive millisecond default for request and stream calls, validated before acquiring source resources; it does not extend the notify or group timeout scope.',
      '请求与流调用使用的有限正毫秒默认值，在取得来源资源前校验，不扩展通知或分组操作的超时作用域。'
    ),
    default: t(
      '30000 ms for request and stream in the original timeout scope.',
      '默认三万毫秒，仅用于原有请求与流超时作用域。'
    )
  },
  contract: {
    summary: t(
      'Optional IRemoteContract with explicit method schemas, supported modes and idempotency declarations, compiled by the original remote contract owner.',
      '可选的 `IRemoteContract`，提供显式方法模式、支持的调用方式与幂等声明，由原远端契约拥有者编译。'
    ),
    default: t(
      'Omitted: provided method definitions supply the normal inferred runtime directory.',
      '省略时根据已提供的方法定义推导通常的运行时目录。'
    )
  },
  report: {
    summary: t(
      'Synchronous callback receives background or contained failures as error; no return is consumed, and failure handling stays with the original runtime reporter owner.',
      '同步回调以错误参数接收后台或隔离的失败，不消费返回值，失败处理仍归原运行时报告拥有者。'
    ),
    params: {
      error: t(
        'Original background or secondary failure supplied by the runtime owner.',
        '来自运行时拥有者的原始后台或次级失败。'
      )
    },
    returns: t(
      'No result is used; reporter errors are contained by the reporting boundary.',
      '不使用返回结果，报告函数失败由报告边界隔离。'
    ),
    default: t(
      'Omitted: defaultRpcReporter reports to console.error.',
      '省略时默认报告函数输出到控制台错误通道。'
    )
  },
  keyFactory: {
    summary: t(
      'Advanced remote-proxy key callback returning an application string for automatically keyed retry paths. The direct createRuntimePeer assembly does not read this inherited field itself.',
      '高级远程代理键回调，返回应用字符串供自动分配键的重试路径使用；直接运行时连接组装本身不读取这个继承字段。'
    ),
    default: t(
      'Omitted: proxy paths use defaultRpcId when generating keys; direct peer call keys retain their own call-option semantics.',
      '省略时代理生成键使用默认标识工厂，直接连接调用仍按自身调用选项处理幂等键。'
    )
  },
  retryPort: {
    summary: t(
      'Advanced application-supplied retry dispatch port for remote-proxy paths; it receives the original retry input and returns the selected dispatch result. Direct createRuntimePeer assembly does not read it itself.',
      '高级应用重试派发端口，供远程代理路径接收原始重试输入并返回所选派发结果；直接运行时连接组装本身不读取它。'
    ),
    default: t(
      'Omitted: the remote proxy keeps its original retry dispatch owner; no second retry policy is installed by a direct peer.',
      '省略时远程代理保留原重试派发拥有者，直接连接不会额外安装另一套重试策略。'
    )
  }
}

/** Plugin configuration owned by Core and shared by the thread and process adapters. */
export const runtimePluginOptionMembers: Readonly<Record<string, IMemberDoc>> = {
  name: {
    summary: t(
      'Caller-selected nonempty registration name copied when constructing the cold plugin; use the same name when addressing the installed runtime outlet.',
      '调用方选择的非空登记名称，在构造冷插件时复制；通过已安装的运行时出口寻址时使用同名。'
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

/** Shared type docs keyed by the re-exported type name. */
export const runtimeSharedTypes: Readonly<Record<string, ITypeDoc>> = {
  IRuntimeTypedPeer: {
    summary: t(
      'A Runtime Peer typed by `TRemote`: method names, payloads and results are checked against the other side API. Also has `self`, `describe()`, `outcome()`, `on()` and `close()`.',
      '按 `TRemote` 类型化的 Runtime Peer：方法名、参数与结果都按对端 API 检查。另有 `self`、`describe()`、`outcome()`、`on()` 与 `close()`。'
    ),
    scenarios: [
      t(
        'Call worker or child process functions as if they were local, with types.',
        '像调用本地函数一样带类型地调用 Worker 或子进程中的函数。'
      ),
      t(
        'Retry a non-idempotent call safely with `idempotencyKey` and `outcome(key)`.',
        '借助 `idempotencyKey` 与 `outcome(key)` 安全地重试非幂等调用。'
      )
    ],
    example: {
      en: `type IWorkerApi = { math: { double(value: number): number } }
const worker = await createThreadPeer<IWorkerApi>({ spawn: new URL('./worker.js', import.meta.url) })
try {
  console.log(await worker.request('math.double', 21)) // 42
} finally {
  await worker.close() // also stops a spawned worker
}`,
      zh: `type IWorkerApi = { math: { double(value: number): number } }
const worker = await createThreadPeer<IWorkerApi>({ spawn: new URL('./worker.js', import.meta.url) })
try {
  console.log(await worker.request('math.double', 21)) // 42
} finally {
  await worker.close() // spawn 出来的 Worker 也会随之停止
}`
    },
    members: typedPeerMembers
  },
  IRuntimeUnavailable: {
    summary: t(
      'Explicit marker for a fact that cannot be observed, used instead of inventing `0` or `null`.',
      '表示某个事实无法观察的显式标记，用来代替编造的 `0` 或 `null`。'
    ),
    members: {
      status: {
        summary: t(
          'Always `unavailable`: the value could not be observed.',
          '固定为 `unavailable`，表示该值不可用。'
        )
      },
      reason: {
        summary: t(
          'Why it is unavailable, e.g. `native-resource-sampling-not-connected`.',
          '该值不可用的具体原因，例如 `native-resource-sampling-not-connected`。'
        )
      }
    }
  },
  IRuntimeConnectionDetail: {
    summary: t(
      'Detail of one connection, returned by `get(target)`, listed by `list()` and in `describe().connections`.',
      '单个连接的详情，由 `get(target)` 返回，也出现在 `list()` 与 `describe().connections` 中。'
    ),
    members: {
      ...detailCommon,
      identity: {
        summary: t(
          `Identity \`{ name, instanceId }\` the other side announced, ${orUnavailable.en}`,
          `对端声明的身份 \`{ name, instanceId }\`；${orUnavailable.zh}`
        )
      },
      generation: {
        summary: t(
          'Generation accepted from the other side (not the local restart count).',
          '从对端接受的代次（不是本地重启次数）。'
        )
      },
      kind: {
        summary: t(
          'How the connection was configured: `spawn`, `connect` or `listen`.',
          '该连接在本端的配置方式：`spawn`、`connect` 或 `listen`。'
        )
      },
      direction: {
        summary: t(
          'Who started it: `spawned`, `spawned-by` (this side is the child), `connect` or `listen`.',
          '由哪一方发起：`spawned`、`spawned-by`（本端是子端）、`connect` 或 `listen`。'
        )
      },
      carrier: {
        summary: t(
          'Name of the physical carrier, such as a MessagePort or stdio.',
          '物理载体的名称，例如 MessagePort 或 stdio。'
        )
      },
      connection: {
        summary: t(
          '`{ status }`: `ready`, `closed`, `departed`, or unavailable.',
          '逻辑连接状态 `{ status }`：`ready`、`closed`、`departed` 或不可用。'
        )
      },
      unit: {
        summary: t(
          `Supervised unit \`{ kind, state, generation, degraded }\`, ${orUnavailable.en}`,
          `受监督的执行单元 \`{ kind, state, generation, degraded }\`；${orUnavailable.zh}`
        )
      },
      health: {
        summary: t(
          `Health check metric \`{ state, failures }\`, ${orUnavailable.en}`,
          `健康检查指标 \`{ state, failures }\`；${orUnavailable.zh}`
        )
      },
      restartCount: {
        summary: t(
          `Number of restarts as a metric, ${orUnavailable.en}`,
          `以指标形式给出的重启次数；${orUnavailable.zh}`
        )
      },
      resources: {
        summary: t(
          `Sampled resources (pid or threadId, memory, CPU time, event-loop utilisation), ${orUnavailable.en}`,
          `采样得到的资源（pid 或 threadId、内存、CPU 时间、事件循环利用率）；${orUnavailable.zh}`
        )
      },
      lastExit: {
        summary: t(
          `Last exit \`{ generation, reason, code, signal, error? }\`, ${orUnavailable.en}`,
          `最近一次退出 \`{ generation, reason, code, signal, error? }\`；${orUnavailable.zh}`
        )
      }
    }
  },
  IRuntimeDetail: {
    summary: t(
      'Result of `peer.describe()`: this side identity, its methods and its connections.',
      '`peer.describe()` 的结果：本端身份、本端方法以及各个连接。'
    ),
    members: {
      ...detailCommon,
      methods: {
        summary: t(
          'Method paths provided by this local Peer; each connection detail separately lists its accepted remote methods.',
          '此本端对端提供的方法路径；每条连接详情另外列出已接纳远端的方法。'
        )
      },
      identity: {
        summary: t(
          'Identity `{ name, instanceId }` of this Peer.',
          '当前这个本地 Peer 自身的身份 `{ name, instanceId }`。'
        )
      },
      self: {
        summary: t(
          'Same identity, as given by the `self` option or generated.',
          '同一身份，来自 `self` 选项或自动生成。'
        )
      },
      provide: {
        summary: t('Method paths this side provides.', '本端通过 `provide` 提供的方法路径。')
      },
      connections: {
        summary: t(
          'Details of every connection (`IRuntimeConnectionDetail`).',
          '本 Peer 当前每个连接的运行详情（`IRuntimeConnectionDetail`）。'
        )
      },
      unit: {
        summary: t(
          'Unavailable for a local Peer; see `connections`.',
          '对本地 Peer 不可用；执行单元信息请查看 `connections`。'
        )
      },
      health: {
        summary: t('Unavailable for a local Peer.', '对本地 Peer 不可用，健康状态见各连接。')
      },
      restartCount: {
        summary: t('Unavailable for a local Peer.', '对本地 Peer 不可用，重启次数见各连接。')
      },
      resources: {
        summary: t('Unavailable for a local Peer.', '对本地 Peer 不可用，资源用量见各连接。')
      }
    }
  },
  IRuntimeOverview: {
    summary: t(
      'Result of `host.thread.list()` / `host.process.list()`.',
      '调用 `host.thread.list()` / `host.process.list()` 时返回的全部连接总览。'
    ),
    members: {
      self: {
        summary: t(
          'Identity `{ name, instanceId }` of the host.',
          '宿主自身的身份 `{ name, instanceId }`，用于区分不同宿主。'
        )
      },
      connections: {
        summary: t('Details of the selected connections.', '按筛选条件选出的各个连接的详情。')
      }
    }
  },
  IRuntimeQueryOptions: {
    summary: t(
      'Options of `describe()` and `get()`.',
      '`describe()` 与 `get()` 的选项：控制结果的输出格式。'
    ),
    members: {
      format: {
        summary: t(
          'Return text in `json`, `yaml` or `toml` instead of an object.',
          '以 `json`、`yaml` 或 `toml` 文本返回，而不是对象。'
        ),
        default: t('Not set: return an object.', '不设置：返回对象。')
      }
    }
  },
  IRuntimeListOptions: {
    summary: t(
      'Options of `list()`: filter and output format.',
      '`list()` 的选项：筛选条件与输出格式。'
    ),
    members: {
      filter: {
        summary: t(
          'Selects connections; see `IRuntimeListFilter`.',
          '用于选择连接的条件，见 `IRuntimeListFilter`。'
        ),
        default: t('Not set: all connections.', '不设置：返回全部连接。')
      },
      format: {
        summary: t(
          'Return text in `json`, `yaml` or `toml`.',
          '改为以 `json`、`yaml` 或 `toml` 文本返回结果。'
        ),
        default: t('Not set: return an object.', '不设置：返回对象。')
      }
    }
  },
  IRuntimeListFilter: {
    summary: t(
      'Filter of `list({ filter })`; every given field must match.',
      '`list({ filter })` 的筛选条件；给出的字段都必须匹配。'
    ),
    members: {
      state: {
        summary: t(
          'Supervisor state: `idle`, `queued`, `starting`, `ready`, `backoff`, `stopping`, `stopped`, `terminal` or `disposed`.',
          '受监督执行单元的状态：`idle`、`queued`、`starting`、`ready`、`backoff`、`stopping`、`stopped`、`terminal` 或 `disposed`。'
        )
      },
      name: {
        summary: t(
          '`{ exact }` or `{ prefix }` match on the connection name.',
          '按连接名称 `{ exact }` 精确匹配或 `{ prefix }` 前缀匹配。'
        )
      },
      kind: {
        summary: t(
          '`spawn`, `connect` or `listen`.',
          '按连接配置方式筛选：`spawn`、`connect` 或 `listen`。'
        )
      },
      direction: {
        summary: t(
          '`spawned`, `spawned-by`, `connect` or `listen`.',
          '按连接发起方向筛选：`spawned`、`spawned-by`、`connect` 或 `listen`。'
        )
      }
    }
  },
  IRuntimeRecent: {
    summary: t('One recent lifecycle record of a connection.', '某个连接最近的一条生命周期记录。'),
    members: {
      generation: { summary: t('Generation the record belongs to.', '该记录所属的代次编号。') },
      timestamp: {
        summary: t(
          'Scheduler time (monotonic milliseconds), not epoch time.',
          '调度器时间（单调毫秒数），不是纪元时间。'
        )
      },
      clock: {
        summary: t(
          'Clock of `timestamp`; `scheduler`.',
          '`timestamp` 所使用的时钟，取值固定为 `scheduler`。'
        )
      },
      kind: {
        summary: t(
          'What happened, such as `ready` or `exit`.',
          '记录的事件类型，例如 `ready` 或 `exit`。'
        )
      },
      identity: {
        summary: t('Peer identity at that time, if known.', '当时的对端身份（已知时才有）。')
      },
      source: {
        summary: t('Error source when the record is a failure.', '记录为失败时对应错误的 source。')
      },
      code: {
        summary: t('Error code when the record is a failure.', '记录为失败时对应错误的 code。')
      }
    }
  },
  IRuntimeEvent: {
    summary: t(
      'Lifecycle event received by `on(event, listener)` and `watch()`.',
      '`on(event, listener)` 与 `watch()` 收到的生命周期事件。'
    ),
    members: {
      type: {
        summary: t(
          'Event name; see `RuntimeEventName`.',
          '生命周期事件名称，取值见 `RuntimeEventName`。'
        ),
        values: { enum: 'RuntimeEventName' }
      },
      name: {
        summary: t(
          'Connection name, e.g. the plugin `name`.',
          '发生事件的连接名称，例如插件的 `name`。'
        )
      },
      instanceId: {
        summary: t(
          `Instance id of that generation, ${orUnavailable.en}`,
          `该代次的实例 id；${orUnavailable.zh}`
        )
      },
      generation: {
        summary: t(`Generation number, ${orUnavailable.en}`, `代次编号；${orUnavailable.zh}`)
      },
      timestamp: {
        summary: t(
          `Scheduler time of the observation, ${orUnavailable.en}`,
          `观察到该事件时的调度器时间；${orUnavailable.zh}`
        )
      },
      clock: {
        summary: t(
          'Clock of `timestamp`; `scheduler`.',
          '`timestamp` 所使用的时钟，取值固定为 `scheduler`。'
        )
      },
      reason: {
        summary: t('`exit` only: why the unit exited.', '仅 `exit` 事件：执行单元退出的原因。')
      },
      code: {
        summary: t('`exit` only: exit code, or unavailable.', '仅 `exit` 事件：退出码，或不可用。')
      },
      signal: {
        summary: t(
          '`exit` only: terminating signal, or unavailable.',
          '仅 `exit` 事件：终止信号，或不可用。'
        )
      },
      error: {
        summary: t(
          '`exit` / `terminal`: `{ source, code }` of the failure.',
          '仅 `exit` / `terminal` 事件：导致退出的失败 `{ source, code }`。'
        )
      },
      count: {
        summary: t(
          '`restart` only: how many restarts so far.',
          '仅 `restart` 事件：到目前为止的重启次数。'
        )
      },
      degraded: {
        summary: t(
          '`degraded` only: features that are degraded.',
          '仅 `degraded` 事件：处于降级状态的功能。'
        )
      }
    }
  },
  IRuntimeSurface: {
    summary: t(
      'Type of the methods a runtime plugin publishes: its `provide` plus the selected host `expose` paths.',
      '运行时插件发布的方法类型：其 `provide` 加上所选的宿主 `expose` 路径。'
    ),
    members: {}
  },
  IRuntimeDynamicSurface: {
    summary: t(
      'Untyped method record used when the remote API is not declared.',
      '未声明远端 API 时使用的无类型方法记录。'
    ),
    members: {}
  }
}

/** Shared enum doc of `RuntimeEventName`. */
export const runtimeEventEnum: IEnumDoc = {
  summary: t(
    'Lifecycle events of runtime connections, observed with `on()` and `watch()`.',
    '运行时连接的生命周期事件，可用 `on()` 与 `watch()` 观察。'
  ),
  values: {
    ready: t(
      '`ready`: a (new) generation completed its handshake and accepts calls.',
      '`ready`：某个（新的）代次完成握手，可以接收调用。'
    ),
    exit: t(
      '`exit`: the worker or process exited; see `reason`, `code`, `signal`.',
      '`exit`：工作线程或子进程已经退出；通过 `reason`、`code`、`signal` 检查原因。'
    ),
    degraded: t(
      '`degraded`: some capability (such as exit observation) is not available.',
      '`degraded`：某些能力（例如退出观察）不可用。'
    ),
    restart: t(
      '`restart`: the supervisor starts a new generation; `count` says how many so far.',
      '`restart`：监督器启动新的代次；`count` 表示已重启的次数。'
    ),
    terminal: t(
      '`terminal`: the supervisor gave up restarting; create or replace the unit.',
      '`terminal`：监督器放弃重启；需要重新创建或替换该执行单元。'
    ),
    liquidated: t(
      '`liquidated`: the process resilience layer removed the registration; it cannot restart.',
      '`liquidated`：进程容错层已移除该登记；它无法再重启。'
    )
  }
}

/** Shared symbol doc of the `RuntimeEventName` constant. */
export const runtimeEventSymbol: ISymbolDoc = {
  role: 'constant',
  purpose: t(
    'Names of the lifecycle events passed to `peer.on(name, listener)` and `host.thread.on()` / `host.process.on()`.',
    '传给 `peer.on(name, listener)` 以及 `host.thread.on()` / `host.process.on()` 的生命周期事件名称，用于订阅连接状态变化。'
  ),
  example: `const off = peer.on('exit', (event) => console.warn(event.name, event.reason))`
}

/** Platform pages share semantics while showing that platform's own complete child/parent pair. */
export const runtimePairedTypes = (
  slot: 'thread' | 'process'
): Readonly<Record<string, ITypeDoc>> => ({
  ...runtimeSharedTypes,
  IRuntimeTypedPeer: {
    ...runtimeSharedTypes.IRuntimeTypedPeer!,
    example: runtimePairedExample(slot, pairedPeerActions.request!),
    members: Object.fromEntries(
      Object.entries(typedPeerMembers).map(([name, member]) => [
        name,
        pairedPeerActions[name]
          ? { ...member, example: runtimePairedExample(slot, pairedPeerActions[name]) }
          : member
      ])
    )
  }
})

/** Event pages also establish the real connection that owns the observed lifecycle. */
export const runtimePairedEventSymbol = (slot: 'thread' | 'process'): ISymbolDoc => ({
  ...runtimeEventSymbol,
  example: runtimePairedExample(slot, pairedPeerActions.on!)
})

/**
 * Grants of a runtime plugin (`createThreadPlugin` / `createProcessPlugin`): the `host.thread` or
 * `host.process` outlet the host gains after installation. `slot` is the outlet property name.
 */
export const runtimeOutletGrants = (slot: 'thread' | 'process'): IGrantDoc[] => {
  /** Receiver written in every call form. */
  const on = `host.${slot}`
  /** Target parameter text shared by the call methods. */
  const target = t(
    'Connection name given as the plugin `name`, or `{ name, instanceId }` for one exact generation.',
    '插件的 `name` 所给出的连接名称，或用于指定某一代的 `{ name, instanceId }`。'
  )
  /** Options of `stop`, which differ between threads and processes. */
  const stopOptions =
    slot === 'thread'
      ? t(
          '`{ graceMs }`: time to finish before termination; `signal` is rejected.',
          '`{ graceMs }`：终止前允许完成工作的时间；传入 `signal` 会被拒绝。'
        )
      : t(
          '`{ graceMs, signal }`: grace time and the signal sent first (default `SIGTERM`).',
          '`{ graceMs, signal }`：宽限时间以及首先发送的信号（默认 `SIGTERM`）。'
        )
  /** Every granted method example installs its provider and releases the owning Host. */
  const example = (action: string): ICode => runtimePairedExample(slot, action, true)
  return [
    {
      signature: `${on}.request(target, method, payload?, options?)`,
      summary: t(
        'Calls a method on one connection and waits for the result.',
        '在某个连接上调用方法并等待结果。'
      ),
      params: {
        target,
        method: t('Dotted method path provided by that side.', '该连接对端提供的方法的点分路径。'),
        payload: t('One portable payload.', '一个可移植的参数值。'),
        options: t(
          'Call options (`timeoutMs`, `signal`, `transfer`, `idempotencyKey`).',
          '调用选项（`timeoutMs`、`signal`、`transfer`、`idempotencyKey`）。'
        )
      },
      returns: t(
        'The method result; an unknown target rejects with `TARGET_UNKNOWN`.',
        '方法的结果；目标不存在时以 `TARGET_UNKNOWN` reject。'
      ),
      example: example(`console.log(await ${on}!.request('worker', 'demo.math.double', 21))`)
    },
    {
      signature: `${on}.notify(target, method, payload?, options?)`,
      summary: t('Sends a one-way call to one connection.', '向某个连接发送单向调用，不等待结果。'),
      params: {
        target,
        method: t('Dotted method path.', '要调用的方法的点分路径。'),
        payload: t('One portable payload.', '一个可移植的参数值。'),
        options: t('Call options.', '调用选项，例如 `signal`。')
      },
      returns: t('Resolves once sent.', '调用发送后 resolve。'),
      example: example(`await ${on}!.notify('worker', 'demo.log.write', 'started')`)
    },
    {
      signature: `${on}.stream(target, method, payload?, options?)`,
      summary: t(
        'Calls an iterator method on one connection and yields its items.',
        '在某个连接上调用迭代器方法并逐个产出元素。'
      ),
      params: {
        target,
        method: t('Dotted path of an iterator method.', '迭代器方法的点分路径。'),
        payload: t('One portable payload.', '一个可移植的参数值。'),
        options: t('Call options.', '调用选项，例如 `signal`。')
      },
      returns: t('An async iterator.', '产出元素的异步迭代器。'),
      example: example(
        `for await (const value of ${on}!.stream('worker', 'demo.feed.count', 3)) console.log(value)`
      )
    },
    {
      signature: `${on}.group(target, steps, options?)`,
      summary: t(
        'Sends several calls to one connection as a batch.',
        '把多次调用作为一个批次发给某个连接。'
      ),
      params: {
        target,
        steps: t(
          'Steps `{ method, payload? }` in order.',
          '按顺序排列的步骤 `{ method, payload? }`。'
        ),
        options: t(
          'Batch options (`timeoutMs`, `signal`, `transfer`).',
          '批次选项（`timeoutMs`、`signal`、`transfer`）。'
        )
      },
      returns: t('One outcome per step.', '每一步对应一个结果。'),
      example: example(
        `console.log(await ${on}!.group('worker', [{ method: 'demo.math.double', payload: 1 }]))`
      )
    },
    {
      signature: `${on}.outcome(target, idempotencyKey)`,
      summary: t(
        'Reads the stored result of a call sent with `idempotencyKey`, without running it again.',
        '读取以 `idempotencyKey` 发送的调用所保存的结果，不会再次执行。'
      ),
      params: {
        target,
        idempotencyKey: t(
          'The key the caller passed in the original call options.',
          '调用方在原始调用选项中传入的幂等键。'
        )
      },
      returns: t(
        'The recorded outcome, or a status saying none exists.',
        '记录的结果，或说明不存在记录的状态。'
      ),
      example:
        example(`await ${on}!.request('worker', 'demo.math.double', 21, { idempotencyKey: 'double-42' })
console.log(await ${on}!.outcome('worker', 'double-42'))`)
    },
    {
      signature: `${on}.list(options?)`,
      summary: t(
        'Lists the connections installed through this outlet.',
        '列出通过该出口安装的全部连接。'
      ),
      params: {
        options: t(
          '`{ filter?, format? }`; see `IRuntimeListOptions`.',
          '筛选与格式选项 `{ filter?, format? }`，见 `IRuntimeListOptions`。'
        )
      },
      returns: t(
        'An `IRuntimeOverview`, or text when `format` is set.',
        '一个 `IRuntimeOverview`；设置 `format` 时返回文本。'
      ),
      example: example(`console.log(await ${on}!.request('worker', 'demo.math.double', 21))
console.log(await ${on}!.list({ filter: { state: 'ready' } }))`)
    },
    {
      signature: `${on}.get(target, options?)`,
      summary: t('Reads the detail of one connection.', '读取某个连接的完整运行详情。'),
      params: {
        target,
        options: t('`{ format? }` for text output.', '`{ format? }`，用于输出文本。')
      },
      returns: t(
        'An `IRuntimeConnectionDetail`, or text.',
        '一个 `IRuntimeConnectionDetail`，或文本。'
      ),
      example: example(`console.log(await ${on}!.request('worker', 'demo.math.double', 21))
console.log(await ${on}!.get('worker'))`)
    },
    {
      signature: `${on}.broadcast(method, payload?, options?)`,
      summary: t(
        'Sends the same one-way notification to every ready connection; the method must admit notify mode.',
        '向每个就绪连接发送同一个单向通知；该方法必须支持 `notify` 模式。'
      ),
      params: {
        method: t('Dotted method path.', '要调用的方法的点分路径。'),
        payload: t('One portable payload.', '一个可移植的参数值。'),
        options: t('Call options.', '调用选项，例如 `timeoutMs`。')
      },
      returns: t(
        '`{ instanceId, ok, error? }` for each connection.',
        '每个连接对应一个 `{ instanceId, ok, error? }`。'
      ),
      example: example(`console.log(await ${on}!.broadcast('demo.log.write', 'broadcast message'))`)
    },
    {
      signature: `${on}.stop(name, options?)`,
      summary: t(
        'Stops a spawned connection gracefully; it stays registered.',
        '优雅地停止某个 spawn 出来的连接；它仍保持登记。'
      ),
      params: {
        name: t('Connection name (plugin `name`).', '连接名称（即插件的 `name`）。'),
        options: stopOptions
      },
      returns: t('Resolves once stopped.', '停止完成后 resolve。'),
      example: example(`console.log(await ${on}!.request('worker', 'demo.math.double', 21))
await ${on}!.stop('worker', { graceMs: 1000 })`)
    },
    {
      signature: `${on}.kill(name)`,
      summary: t('Terminates a spawned connection immediately.', '立即终止某个 spawn 出来的连接。'),
      params: { name: t('Connection name.', '要终止的连接名称。') },
      returns: t('Resolves once terminated.', '终止完成后 resolve。'),
      example: example(`console.log(await ${on}!.request('worker', 'demo.math.double', 21))
await ${on}!.kill('worker')`)
    },
    {
      signature: `${on}.restart(name)`,
      summary: t(
        'Starts a new generation; when it resolves `ready`, calls can go to it at once.',
        '启动新的代次；resolve 为 `ready` 时即可立即向它发起调用。'
      ),
      params: { name: t('Connection name.', '要重启的连接名称。') },
      returns: t('A ready outcome of the new generation.', '新代次的就绪结果。'),
      example: example(`await ${on}!.restart('worker')
console.log(await ${on}!.request('worker', 'demo.math.double', 21))`)
    },
    {
      signature: `${on}.replace(name, spec?)`,
      summary: t(
        'Replaces the spec (entry, data, limits) and starts a new generation with it.',
        '替换启动规格（入口、数据、限制），并以它启动新的代次。'
      ),
      params: {
        name: t('Connection name.', '要替换的连接名称。'),
        spec: t('New spec; omitted keeps the current one.', '新的启动规格；省略时沿用当前规格。')
      },
      returns: t(
        'A replace outcome; `replaced` means the new generation is ready.',
        '替换结果；`replaced` 表示新代次已就绪。'
      ),
      example: example(`await ${on}!.replace('worker')
console.log(await ${on}!.request('worker', 'demo.math.double', 21))`)
    },
    {
      signature: `${on}.on(event, listener)`,
      summary: t(
        'Observes lifecycle events of all connections of this outlet.',
        '观察该出口下所有连接的生命周期事件。'
      ),
      params: {
        event: t('A `RuntimeEventName`.', '一个 `RuntimeEventName` 事件名。'),
        listener: t('Receives an `IRuntimeEvent`.', '接收一个 `IRuntimeEvent` 事件对象。')
      },
      returns: t('An unsubscribe function.', '取消订阅的函数。'),
      example: example(`const off = ${on}!.on('exit', event => console.warn(event.name, event.code))
try { console.log(await ${on}!.request('worker', 'demo.math.double', 21)) } finally { off() }`)
    },
    {
      signature: `${on}.watch()`,
      summary: t('Iterates over lifecycle events.', '以异步迭代的方式读取生命周期事件。'),
      returns: t('An async iterator of `IRuntimeEvent`.', '`IRuntimeEvent` 的异步迭代器。'),
      example: example(`const events = ${on}!.watch()
try {
  const next = events.next()
  await ${on}!.restart('worker')
  console.log((await next).value)
  console.log(await ${on}!.request('worker', 'demo.math.double', 21))
} finally {
  await events.return?.()
}`)
    }
  ]
}
