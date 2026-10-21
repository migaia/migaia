/**
 * Reference documentation of `@migaia/rpc-threads`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-threads/src/threads` (runtime-peer.ts, plugin.ts, short-spawn.ts,
 * channel.ts, bootstrap.ts, child.ts, node-launcher.ts, web-launcher.ts, adapters/*), the shared
 * Core types in `rpc-runtime-shared.ts`, README and USEGUIDE on 2026-10-17. Source/guide
 * difference: USEGUIDE says Electron main can confirm Worker exit, but its adapter explicitly
 * declares termination, exit-observation and heap-limit unsupported. Only the Node adapter
 * advertises those guarantees. Examples use built .js files, matching the guide's verified groups;
 * browser entries must already be built rather than inferred by a bundler. The guide calls
 * readThreadBootstrap().peerId the parent address, but both launchers write the launched handle
 * fingerprint there. Runtime parent identity lives separately in Core bootstrap.
 */
import type {
  ICode,
  ILibraryReference,
  IMemberDoc,
  IText,
  ISymbolDoc,
  IOptionCaseDoc
} from './contract.js'
import { rpcThreadsCases } from './rpc-threads-cases.js'
import {
  runtimePeerOptionMembers,
  runtimePluginOptionMembers,
  runtimeOutletGrants,
  runtimePairedTypes
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
    default: t('`defaultRpcReporter`.', '`defaultRpcReporter`，使用默认控制台报告路径。')
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
  health: {
    summary: t(
      'Custom health policy takes priority. Without enforced native exit observation, the bound generation uses RPC ping every 5000ms, a 2000ms budget and 3 consecutive failures. Before endpoint binding the original startup deadline applies. Disabling ping requires custom health or Core INVALID_CONFIG.',
      '自定义健康策略优先；缺少原生退出强制观察时，绑定代次默认每 `5000ms` 心跳、单次 `2000ms`、连续三次失败；端点绑定前沿用原启动截止。禁用心跳须提供自定义健康策略，否则核心拒绝配置。'
    ),
    default: t(
      'Native exit observation where enforced; otherwise RPC ping on the actual bound endpoint.',
      '原生退出可强制观察时使用原生观察，否则对实际绑定端点执行心跳。'
    )
  },
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
const nodeLauncherOptions: Record<string, IMemberDoc> = {
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
      'Caller-selected runtime argument list copied for each native Worker. If new Worker throws synchronously, launch rejects with Core INVALID_CONFIG. An existing native code such as ERR_WORKER_INVALID_EXEC_ARGV is not overwritten: the original Error, code, name, message and stack remain on cause under the established conflict policy. This classification does not cover later asynchronous Worker business failures.',
      '调用方指定的运行时参数列表，每次复制后传给原生 Worker。new Worker 同步抛错时，launch 以 Core INVALID_CONFIG 拒绝；已有 ERR_WORKER_INVALID_EXEC_ARGV 等原生 code 时，不覆盖它，而是按既有冲突策略包装，原 Error、code、name、message、stack 保留在 cause 上。此分类不适用于 Worker 之后的异步业务失败。'
    ),
    default: t(
      'Omitted: preserve Node’s native execution-argument inheritance.',
      '省略时保留宿主原生的执行参数继承行为。'
    )
  }
}

/** Shared application contract used by both actual modules in each Worker example. */
const threadContractCode = `export type IWorkerApi = {
  math: { double(value: number): Promise<number> }
  feed: { count(limit: number): AsyncIterableIterator<number> }
}
export type IParentApi = { audit: { record(message: string): void } }`

/** Worker implementation also calls its parent before completing the requested operation. */
function workerCode(advanced = false): string {
  return `${advanced ? "import { parentPort, workerData } from 'node:worker_threads'\n" : ''}import { ${advanced ? 'createAdapterNodeThreadPeer, readThreadBootstrap' : 'createThreadPeer'} } from '@migaia/rpc-threads'
import type { IParentApi, IWorkerApi } from './contracts.js'

${advanced ? 'const bootstrap = readThreadBootstrap(workerData)\nconsole.log(bootstrap.peerId, bootstrap.data)\n' : ''}const provide: IWorkerApi = {
    math: {
      double: async (value: number) => {
        await (await parent).request('audit.record', 'double')
        return value * 2
      }
    },
    feed: {
      count: async function* (limit: number) {
        for (let index = 1; index <= limit; index++) yield index
      }
    }
}
const parent = ${advanced ? 'createAdapterNodeThreadPeer' : 'createThreadPeer<IParentApi>'}({ provide }${advanced ? ', parentPort, workerData' : ''})
await parent`
}

/** Combines real contract, Worker and parent files, localizing every explanatory comment. */
function pairedThreadExample(main: string, advanced = false): IText {
  /** File boundaries carry prose in the selected locale, while module paths stay identical. */
  const body = (zh: boolean) => `${zh ? '// 契约文件：contracts.ts' : '// contracts.ts'}
${threadContractCode}

${zh ? '// 工作线程文件：worker.ts；生命周期由父端持有，父端关闭时请求终止。' : '// worker.ts: the parent owns execution and requests termination when it closes.'}
${workerCode(advanced)}

${zh ? '// 父端文件：main.ts；先将这些文件编译为同目录的可执行模块。' : '// main.ts: compile these files to JavaScript modules in the same directory first.'}
${main}`
  return { en: body(false), zh: body(true) }
}

/** Bidirectional URL spawn, including unary and streaming calls and the owner's final close. */
const peerExample: ICode =
  pairedThreadExample(`import { createThreadPeer } from '@migaia/rpc-threads'
import type { IParentApi, IWorkerApi } from './contracts.js'

const provide: IParentApi = { audit: { record: (message) => console.log(message) } }
const worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url),
  provide
})
try {
  console.log(await worker.request('math.double', 21))
  for await (const value of worker.stream('feed.count', 3)) console.log(value)
} finally {
  await worker.close()
}`)

/** Real background diagnostics are classified without replacing or deliberately triggering errors. */
const diagnosticExample: ICode = pairedThreadExample(`import {
  createThreadPeer,
  RPC_THREAD_ERROR_SOURCE,
  RpcThreadErrorCode
} from '@migaia/rpc-threads'
import type { IParentApi, IWorkerApi } from './contracts.js'

const report = (error: unknown) => {
  if (error instanceof Error && 'source' in error && 'code' in error &&
      error.source === RPC_THREAD_ERROR_SOURCE && error.code === RpcThreadErrorCode.usageSampleFailed) {
    console.warn(error)
    return
  }
  console.error(error)
}
const worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url),
  provide: { audit: { record: (message: string) => console.log(message) } } satisfies IParentApi,
  report
})
try {
  console.log(await worker.request('math.double', 21))
} finally {
  await worker.close()
}`)

/** Host owns the plugin and Worker; the plugin's own provider serves the reverse call. */
const pluginExample: ICode = pairedThreadExample(`import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'
import type { IParentApi, IWorkerApi } from './contracts.js'

const provide: IParentApi = { audit: { record: (message) => console.log(message) } }
const worker = createThreadPlugin<IWorkerApi, IParentApi, 'worker'>({
  name: 'worker',
  spawn: new URL('./worker.js', import.meta.url),
  provide
})
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21))
  for await (const value of host.thread!.stream('worker', 'feed.count', 3)) console.log(value)
  console.log(await host.thread!.get('worker'))
} finally {
  await host.dispose()
}`)

/** Self spawn executes the same compiled module in two branches and retains symmetric methods. */
const selfSpawnExample: ICode = {
  en: `// self.ts: compile to self.js, then run that file with Node, Bun or Deno.
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { double(value: number): Promise<number> }
type IParentApi = { record(message: string): void }
if (await isThreadChild()) {
  const provide: IWorkerApi = {
      double: async (value: number) => {
        await (await parent).request('record', 'double')
        return value * 2
      }
  }
  const parent = createThreadPeer<IParentApi>({ provide })
  await parent
} else {
  const worker = await createThreadPeer<IWorkerApi>({
    spawn: true,
    provide: { record: (message: string) => console.log(message) } satisfies IParentApi
  })
  try {
    console.log(await worker.request('double', 21))
  } finally {
    await worker.close() // parent owns this Worker
  }
}`,
  zh: `// 同文件的两端：self.ts；编译为 self.js 后由 Node、Bun 或 Deno 运行。
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { double(value: number): Promise<number> }
type IParentApi = { record(message: string): void }
if (await isThreadChild()) {
  const provide: IWorkerApi = {
      double: async (value: number) => {
        await (await parent).request('record', 'double')
        return value * 2
      }
  }
  const parent = createThreadPeer<IParentApi>({ provide })
  await parent
} else {
  const worker = await createThreadPeer<IWorkerApi>({
    spawn: true,
    provide: { record: (message: string) => console.log(message) } satisfies IParentApi
  })
  try {
    console.log(await worker.request('double', 21))
  } finally {
    await worker.close() // 父端持有并释放此工作线程
  }
}`
}

/** Existing ports remain application-owned; two real modules share their exact API contract. */
function borrowedPortExample(web: boolean): IText {
  /** Web ports require explicit start; Node MessagePorts use the EventEmitter adapter. */
  const body = (zh: boolean) => `${zh ? '// 左端文件：left.ts' : '// left.ts'}
${web ? '' : "import type { MessagePort } from 'node:worker_threads'\n"}import { createThreadPeer, create${web ? 'Web' : 'Node'}ThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'

export type ILeftApi = { double(value: number): Promise<number> }
export type IRightApi = { record(message: string): void }
export function createLeft(port: MessagePort) {
  ${web ? 'port.start()\n  ' : ''}const provide: ILeftApi = {
      double: async (value: number) => {
        await (await peer).request('record', 'double')
        return value * 2
      }
  }
  const peer = createThreadPeer<IRightApi>({
    self: { name: 'left', instanceId: 'left-1' },
    provide,
    connect: async (context) => create${web ? 'Web' : 'Node'}ThreadChannel(port, 'right-1', {
      scheduler: systemScheduler,
      capabilities: context.capabilities
    })
  })
  return peer
}

${zh ? '// 右端文件：main.ts；两端可在同一线程中演示，端口也可由应用先传给其他线程。' : '// main.ts: both ends run locally here; the application can first move a port to another thread.'}
${web ? '' : "import { MessageChannel } from 'node:worker_threads'\n"}import { createThreadPeer, create${web ? 'Web' : 'Node'}ThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createLeft, type ILeftApi, type IRightApi } from './left.js'

const { port1, port2 } = new MessageChannel()
${web ? 'port2.start()\n' : ''}const [left, right] = await Promise.all([
  createLeft(port1),
  createThreadPeer<ILeftApi>({
    self: { name: 'right', instanceId: 'right-1' },
    provide: { record: (message: string) => console.log(message) } satisfies IRightApi,
    connect: async (context) => create${web ? 'Web' : 'Node'}ThreadChannel(port2, 'left-1', {
      scheduler: systemScheduler,
      capabilities: context.capabilities
    })
  })
])
try {
  console.log(await right.request('double', 21))
} finally {
  await Promise.all([left.close(), right.close()])
  ${zh ? '// 逻辑连接只借用端口；应用在两端关闭后释放原生资源。' : '// Peers borrow the ports; the application releases both native resources after closing them.'}
  port1.close()
  port2.close()
}`
  return { en: body(false), zh: body(true) }
}

/** Native adapter authors borrow Worker messaging without claiming a library bootstrap. */
function nativeWorkerExample(web: boolean): IText {
  /** Native construction remains explicitly application-owned in this lower-level path. */
  const body = (zh: boolean) => `${zh ? '// 契约文件：contracts.ts' : '// contracts.ts'}
${threadContractCode}

${zh ? '// 工作线程文件：worker.ts；应用自行创建工作线程，因此显式使用核心工厂。' : '// worker.ts: an application-created Worker uses the explicit Core factory, not automatic discovery.'}
${web ? '' : "import { parentPort } from 'node:worker_threads'\n"}import { ${web ? 'createWebThreadChannel' : 'AdapterNodeThreadParentChannel'} } from '@migaia/rpc-threads'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IParentApi, IWorkerApi } from './contracts.js'

${web ? '' : 'const channel = new AdapterNodeThreadParentChannel(parentPort!)\n'}const provide: IWorkerApi = {
  math: {
    double: async (value: number) => {
      await (await parent).request('audit.record', 'double')
      return value * 2
    }
  },
  feed: {
    count: async function* (limit: number) {
      for (let index = 1; index <= limit; index++) yield index
    }
  }
}
const parent = createRuntimePeer<IParentApi>({
  self: { name: 'worker', instanceId: 'worker-1' },
  provide,
  connect: async () => ${web ? 'createWebThreadChannel(self, ' : 'channel.open('}'main-1', { scheduler: systemScheduler }),
  report: (error) => console.error(error)
})
${web ? '' : "parentPort!.once('close', () => { void parent.then((peer) => peer.close()) })\nconsole.log(parentPort!.listenerCount('message'))\n"}await parent

${zh ? '// 父端文件：main.ts；固定能力通道不协商扩展，父端负责停止原生工作线程。' : '// main.ts: the fixed channel negotiates no extensions; the parent owns native termination.'}
${web ? '' : "import { Worker } from 'node:worker_threads'\nimport type { INodeMessagePortLike } from '@migaia/rpc-core/adapters/message-port'\n"}import { create${web ? 'Web' : 'Node'}ThreadChannel${web ? ', type IThreadWebPort' : ''} } from '@migaia/rpc-threads'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IParentApi, IWorkerApi } from './contracts.js'

const native = new Worker(new URL('./worker.js', import.meta.url)${web ? ", { type: 'module' }" : ''})
const report = (error: unknown) => console.error(error)
${web ? "native.addEventListener('error', report)" : "native.on('error', report)\nconst exited = new Promise<number>((resolve) => native.once('exit', resolve))\nconsole.log(native.threadId, native.listenerCount('message'))"}
const port: ${web ? 'IThreadWebPort' : 'INodeMessagePortLike'} = {
  postMessage: (message, transfer) => native.postMessage(message, transfer as ${web ? 'Transferable[]' : "Parameters<Worker['postMessage']>[1]"}),
  ${web ? 'addEventListener: (type, listener) => native.addEventListener(type, listener),\n  removeEventListener: (type, listener) => native.removeEventListener(type, listener)' : "on: (event, listener) => native.on(event === 'close' ? 'exit' : event, listener),\n  off: (event, listener) => native.off(event === 'close' ? 'exit' : event, listener)"}
}
const peer = await createRuntimePeer<IWorkerApi>({
  self: { name: 'main', instanceId: 'main-1' },
  provide: { audit: { record: (message: string) => console.log(message) } } satisfies IParentApi,
  connect: async () => create${web ? 'Web' : 'Node'}ThreadChannel(port, 'worker-1', { scheduler: systemScheduler }),
  report
})
try {
  console.log(await peer.request('math.double', 21))
} finally {
  await peer.close()
  ${web ? "native.removeEventListener('error', report)\n  native.terminate()\n  " + (zh ? '// 浏览器无法确认实际退出，不等待退出回执。' : '// Browser termination has no actual-exit receipt.') : "await native.terminate()\n  await exited\n  native.off('error', report)"}
}`
  return { en: body(false), zh: body(true) }
}

/** Raw Web launcher bootstrap is consumed once before constructing fixed-profile Core Peers. */
function webBootstrapExample(handleOpen = false): IText {
  /** This advanced path deliberately uses Core instead of consuming the same bootstrap twice. */
  const body = (zh: boolean) => `${zh ? '// 契约文件：contracts.ts' : '// contracts.ts'}
${threadContractCode}

${zh ? '// 工作线程文件：worker.ts；启动准备只消费一次，然后显式打开固定能力通道。' : '// worker.ts: consume startup once, then explicitly open the fixed capability channel.'}
import { receiveThreadData, createWebThreadChannel } from '@migaia/rpc-threads'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IParentApi, IWorkerApi } from './contracts.js'

let address!: string
await receiveThreadData(self, (data, peerId) => {
  address = peerId
  console.log(data)
})
const provide: IWorkerApi = {
  math: {
    double: async (value: number) => {
      await (await parent).request('audit.record', 'double')
      return value * 2
    }
  },
  feed: {
    count: async function* (limit: number) {
      for (let index = 1; index <= limit; index++) yield index
    }
  }
}
const parent = createRuntimePeer<IParentApi>({
  self: { name: 'worker', instanceId: address },
  provide,
  connect: async () => createWebThreadChannel(self, 'main-1', { scheduler: systemScheduler }),
  report: (error) => console.error(error)
})
await parent

${zh ? '// 父端文件：main.ts；原生工作线程由此处的句柄持有并请求终止。' : '// main.ts: this handle owns the native Worker and requests its termination.'}
import { createWebThreadLauncher, createWebThreadChannelFactory } from '@migaia/rpc-threads'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IParentApi, IWorkerApi } from './contracts.js'

const controller = new AbortController()
const report = (error: unknown) => console.error(error)
const launcher = createWebThreadLauncher({ report })
const channelFactory = createWebThreadChannelFactory({ scheduler: systemScheduler })
const handle = await launcher.launch({
  entry: new URL('./worker.js', import.meta.url).href,
  data: { label: 'math' }
}, { signal: controller.signal })
const peer = await createRuntimePeer<IWorkerApi>({
  self: { name: 'main', instanceId: 'main-1' },
  provide: { audit: { record: (message: string) => console.log(message) } } satisfies IParentApi,
  connect: async () => ${handleOpen ? 'handle.open(controller.signal, { scheduler: systemScheduler })' : 'channelFactory.open(handle, controller.signal)'},
  report
})
try {
  console.log(await peer.request('math.double', 21))
} finally {
  await peer.close()
  handle.terminate()
  ${zh ? '// 此平台不支持实际退出确认，不能等待永不完成的退出回执。' : '// Actual exit observation is unsupported; do not await its never-settled exit receipt.'}
}`
  return { en: body(false), zh: body(true) }
}

/** Signed binary transfer follows the guide's verified HMAC group and consumes the original buffer. */
const transferExample: IText = {
  en: `// signing.ts: both ends read the same deployment key locally; never send the key over RPC.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IRpcAuthenticationConfig } from '@migaia/rpc-core'

const key = Buffer.from(process.env.RPC_SIGNING_KEY!, 'hex')
const signature = (value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest()
export const authentication: IRpcAuthenticationConfig = {
  sign: (value) => ({ value, signature: signature(value).toString('hex') }),
  verify: (input) => {
    const frame = input as { value: unknown; signature: string }
    const received = Buffer.from(frame.signature, 'hex')
    const expected = signature(frame.value)
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new TypeError('Invalid RPC signature')
    return frame.value
  }
}

// contracts.ts
export type IBytesApi = { inspect(buffer: ArrayBuffer): Promise<{ length: number; first: number }> }
export type IParentApi = { record(length: number): void }

// worker.ts: compile all files first; the parent owns the Worker lifetime.
import { createThreadPeer } from '@migaia/rpc-threads'
import { authentication } from './signing.js'
import type { IBytesApi, IParentApi } from './contracts.js'

const provide: IBytesApi = {
    inspect: async (buffer: ArrayBuffer) => {
      await (await parent).request('record', buffer.byteLength)
      return { length: buffer.byteLength, first: new Uint8Array(buffer)[0] }
    }
}
const parent = createThreadPeer<IParentApi>({ authentication, provide })
await parent

// main.ts: set a demonstration key before importing signing.ts or starting the Worker.
import { randomBytes } from 'node:crypto'
import { createThreadPeer } from '@migaia/rpc-threads'
import type { IBytesApi, IParentApi } from './contracts.js'

process.env.RPC_SIGNING_KEY ??= randomBytes(32).toString('hex')
const { authentication } = await import('./signing.js')
const worker = await createThreadPeer<IBytesApi>({
  spawn: new URL('./worker.js', import.meta.url),
  authentication,
  provide: { record: (length: number) => console.log(length) } satisfies IParentApi
})
try {
  const buffer = new Uint8Array([7, 8, 9]).buffer
  console.log(await worker.request('inspect', buffer, { transfer: [buffer] }))
  console.log(buffer.byteLength) // 0: the transferred backing and every alias are detached.
} finally {
  await worker.close()
}`,
  zh: `// 签名文件：signing.ts；两端分别读取同一部署密钥，不通过远程调用发送密钥。
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IRpcAuthenticationConfig } from '@migaia/rpc-core'

const key = Buffer.from(process.env.RPC_SIGNING_KEY!, 'hex')
const signature = (value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest()
export const authentication: IRpcAuthenticationConfig = {
  sign: (value) => ({ value, signature: signature(value).toString('hex') }),
  verify: (input) => {
    const frame = input as { value: unknown; signature: string }
    const received = Buffer.from(frame.signature, 'hex')
    const expected = signature(frame.value)
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new TypeError('Invalid RPC signature')
    return frame.value
  }
}

// 契约文件：contracts.ts
export type IBytesApi = { inspect(buffer: ArrayBuffer): Promise<{ length: number; first: number }> }
export type IParentApi = { record(length: number): void }

// 工作线程文件：worker.ts；先编译所有文件，父端持有工作线程的生命周期。
import { createThreadPeer } from '@migaia/rpc-threads'
import { authentication } from './signing.js'
import type { IBytesApi, IParentApi } from './contracts.js'

const provide: IBytesApi = {
    inspect: async (buffer: ArrayBuffer) => {
      await (await parent).request('record', buffer.byteLength)
      return { length: buffer.byteLength, first: new Uint8Array(buffer)[0] }
    }
}
const parent = createThreadPeer<IParentApi>({ authentication, provide })
await parent

// 父端文件：main.ts；导入签名模块和启动工作线程前先设置演示密钥。
import { randomBytes } from 'node:crypto'
import { createThreadPeer } from '@migaia/rpc-threads'
import type { IBytesApi, IParentApi } from './contracts.js'

process.env.RPC_SIGNING_KEY ??= randomBytes(32).toString('hex')
const { authentication } = await import('./signing.js')
const worker = await createThreadPeer<IBytesApi>({
  spawn: new URL('./worker.js', import.meta.url),
  authentication,
  provide: { record: (length: number) => console.log(length) } satisfies IParentApi
})
try {
  const buffer = new Uint8Array([7, 8, 9]).buffer
  console.log(await worker.request('inspect', buffer, { transfer: [buffer] }))
  console.log(buffer.byteLength) // 为零：已转移的底层存储及其全部视图失效。
} finally {
  await worker.close()
}`
}

/** Platform pairs: launcher plus channel factory. */
const platforms = [
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
function fullSpawnExample(prefix: string, launcherArgs: string, handleOpen = false): IText {
  /** Each platform owns its import path; generic Web and custom Node factories use root exports. */
  const platform = platforms.find(([, name]) => name === prefix)?.[0]
  /** The custom Node resource reuses the ordinary Node channel factory. */
  const launcher =
    prefix === 'AdapterNode' ? 'createAdapterNodeThreadLauncher' : `create${prefix}ThreadLauncher`
  /** The ordinary channel factory preserves the actual custom launcher handle. */
  const channelFactory =
    prefix === 'AdapterNode'
      ? 'createNodeThreadChannelFactory'
      : `create${prefix}ThreadChannelFactory`
  /** Both peer modules share real application types and a synchronous provider directory. */
  const main = `import { createThreadPeer${prefix === 'Web' || prefix === 'AdapterNode' ? `, ${launcher}${prefix === 'Web' ? `, ${channelFactory}` : ''}` : ''}${handleOpen ? ', type IAdapterNodeThreadHandle' : ''} } from '@migaia/rpc-threads'
${prefix === 'Web' ? '' : `import { ${prefix === 'AdapterNode' ? channelFactory : `${launcher}, ${channelFactory}`} } from '@migaia/rpc-threads/adapters/${platform ?? 'node'}'\n`}import type { IParentApi, IWorkerApi } from './contracts.js'
import { createUnitBudget } from '@migaia/supervision'
${handleOpen ? "import type { IAbortSignal } from '@migaia/utils/promise'\n" : ''}import { systemScheduler } from '@migaia/utils/scheduler'

const report = (error: unknown) => console.error(error)
${prefix === 'AdapterNode' ? "const runtime = { load: () => import('node:worker_threads'), pid: process.pid }\n" : ''}const provide: IParentApi = { audit: { record: (message) => console.log(message) } }
const spawn = {
  spec: { entry: new URL('./worker.js', import.meta.url).href },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: ${launcher}(${prefix === 'AdapterNode' ? 'runtime' : launcherArgs}),
  channelFactory: ${handleOpen ? '{ open: (handle: IAdapterNodeThreadHandle, signal: IAbortSignal) => handle.open(signal, { scheduler: systemScheduler }) }' : `${channelFactory}({ scheduler: systemScheduler })`},
  report
}
const worker = await createThreadPeer<IWorkerApi>({ spawn, provide, report })
try {
  console.log(await worker.request('math.double', 21))
} finally {
  await worker.close()
}`
  return pairedThreadExample(main, prefix === 'AdapterNode')
}

const platformSymbols: Record<string, ISymbolDoc> = Object.fromEntries(
  platforms.flatMap(([module, prefix, en, zh, web]) => {
    /** How the launcher is called on this platform. */
    const launcherCall =
      module === 'electron-main' ? '()' : module === 'node' ? '()' : '({ report })'
    /** Termination note for Web-style Workers. */
    const termination =
      web || module === 'electron-main'
        ? t(
            ' Termination, exit observation and heap limits are declared unsupported; requesting termination does not prove execution stopped.',
            '终止确认、退出观察与堆限制均声明为不支持；请求终止不能证明代码已经停止。'
          )
        : t(
            ' Exits are observed, so termination is confirmed.',
            '可以观察到退出，因此终止可被确认。'
          )
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
              '`{ scheduler, capabilities? }`: use the same `scheduler` as the source; `capabilities` intersects the actual launch offer; only the peer acknowledgement establishes the agreed result.',
              '`{ scheduler, capabilities? }`：`scheduler` 必须与 source 使用同一个；`capabilities` 与实际启动提议取交集，最终协商结果仍须由对端确认。'
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
        `Use this subpath for ${en} when building a full \`spawn\` source that explicitly supplies worker launching and communication. \`create${prefix}ThreadLauncher()\` starts the worker, while \`create${prefix}ThreadChannelFactory()\` opens its RPC channel.\n\nPass both to \`createThreadPeer()\` from the root with the rest of the source options. Ordinary URL or path shorthand selects the platform adapter automatically, so it does not need these explicit factories.`,
        `需要自行指定工作线程的启动方式和通信方式时，使用这个子路径。\`create${prefix}ThreadLauncher()\` 负责启动线程，\`create${prefix}ThreadChannelFactory()\` 负责打开远程调用通道。将两者连同其余来源选项交给根入口的 \`createThreadPeer()\`，即可为 ${zh.replaceAll('Node', '`Node`').replaceAll('Electron', '`Electron`')} 提供完整的 \`spawn\` 配置。普通网址或路径简写会自动选择平台适配器，无须显式使用这两个工厂。`
      ),
      example: fullSpawnExample(
        prefix,
        module === 'node' || module === 'electron-main' ? '' : '{ report }'
      )
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
  example: nativeWorkerExample(true)
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
    example: nativeWorkerExample(true)
  },
  removeEventListener: {
    summary: t('Removes the listener when the channel closes.', '通道关闭时移除之前登记的监听。'),
    params: {
      type: t('Event name used before.', '之前登记时使用的事件名称。'),
      listener: t('The same listener.', '之前登记的同一个监听函数。')
    },
    returns: t('Nothing; the listener is removed.', '无返回值；监听已移除。'),
    example: nativeWorkerExample(true)
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
  postMessage: { ...postMessage, example: nativeWorkerExample(false) },
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
    example: nativeWorkerExample(false)
  },
  off: {
    summary: t('Removes a Worker event listener.', '移除之前添加的 Worker 事件监听。'),
    params: {
      event: t('Event name.', 'Worker 事件名称。'),
      listener: t('The same listener.', '之前添加的同一个监听函数。')
    },
    returns: t('The Worker, ignored.', '返回 Worker 本身，会被忽略。'),
    example: nativeWorkerExample(false)
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
    example: nativeWorkerExample(false)
  },
  listenerCount: {
    summary: t(
      'Counts `message` listeners, used to check the channel owns the port.',
      '统计 `message` 监听数量，用来确认通道独占该端口。'
    ),
    params: { event: t('Always `message`.', '固定为 `message` 事件。') },
    returns: t('Number of listeners.', '当前监听函数的数量。'),
    example: nativeWorkerExample(false)
  },
  terminate: {
    summary: t('Stops the Worker thread forcibly.', '强制停止该 Worker 线程的运行。'),
    returns: t('Resolves with the exit code.', '以退出码 resolve。'),
    example: nativeWorkerExample(false)
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

/** Application helpers own existing ports and expose no private adapter operations. */
const threadOptionExamples = {
  peerListen: `import { createThreadPeer } from '@migaia/rpc-threads'
import { acceptWorkerChannel, closeApplicationThreads } from './app-thread.js'

const worker = await createThreadPeer<{ math: { double(value: number): number } }>({
  listen: acceptWorkerChannel
})
try { console.log(await worker.request('math.double', 21)) }
finally { await worker.close(); await closeApplicationThreads() }`,
  peerEndpoint: `import { createThreadPeer } from '@migaia/rpc-threads'
import { openRawWorkerChannel, closeApplicationThreads } from './app-thread.js'

const failure = new Error('application endpoint setup failed')
try {
  await createThreadPeer({
    connect: openRawWorkerChannel,
    endpointFactory: async (_channel, signal) => {
      if (signal.aborted) throw signal.reason
      throw failure
    }
  })
} catch (error) { console.log(error === failure) }
finally { await closeApplicationThreads() }`,
  peerPolicy: `import { createThreadPeer } from '@migaia/rpc-threads'
import { defineProbe } from '@migaia/rpc-core/probe'
import { openWorkerChannel, closeApplicationThreads } from './app-thread.js'

const stages: number[] = []
const probe = defineProbe({ stages: ['message'], emit: (event) => { stages.push(event.stage) } })
const worker = await createThreadPeer<{ math: { double(value: number): number } }>({
  connect: openWorkerChannel,
  provide: { math: { double: (value: number) => value * 2 } },
  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },
  probe,
  defaultTimeoutMs: 2000,
  contract: { schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }
})
try { console.log(await worker.request('math.double', 21), stages.length > 0) }
finally { await worker.close(); await closeApplicationThreads() }`,
  peerRetry: `import { createThreadPeer } from '@migaia/rpc-threads'
import { openWorkerChannel, closeApplicationThreads } from './app-thread.js'

let keyCalls = 0
let retryCalls = 0
const worker = await createThreadPeer<{ math: { double(value: number): number } }>({
  connect: openWorkerChannel,
  keyFactory: () => { keyCalls += 1; return 'logical-call-1' },
  retryPort: {
    dispatch: async (input) => {
      retryCalls += 1
      return input.sendOnce({ expectedGeneration: input.generation, key: input.key })
    }
  }
})
try { console.log(await worker.request('math.double', 21), keyCalls, retryCalls) }
finally { await worker.close(); await closeApplicationThreads() }`,
  pluginHost: `import { createThreadPlugin } from '@migaia/rpc-threads'
import { applicationHost, applicationCatalog, resolveApplicationPlugin, openWorkerChannel, closeApplicationThreads } from './app-thread.js'

const worker = createThreadPlugin({
  name: 'worker',
  connect: openWorkerChannel,
  expose: ['host'],
  host: applicationHost,
  catalog: applicationCatalog,
  resolvePlugin: resolveApplicationPlugin
})
try {
  await applicationHost.use(worker)
  console.log(applicationHost.revision > 0)
} finally { await applicationHost.dispose(); await closeApplicationThreads() }`,
  nodeLauncher: `import { createNodeThreadLauncher } from '@migaia/rpc-threads/adapters/node'
import { openNodeSession } from './app-thread.js'

const session = await openNodeSession((context) => createNodeThreadLauncher({
  runtimeApi: context,
  execArgv: []
}))
try { console.log(await session.peer.request('math.double', 21)) }
finally { await session.close() }`,
  nodeAdapterLauncher: `import { createAdapterNodeThreadLauncher } from '@migaia/rpc-threads'
import { nodeRuntime, openNodeSession } from './app-thread.js'

const session = await openNodeSession((context) => createAdapterNodeThreadLauncher(nodeRuntime, {
  runtimeApi: context,
  execArgv: []
}))
try { console.log(await session.peer.request('math.double', 21)) }
finally { await session.close() }`,
  webLauncher: `import { createWebThreadLauncher } from '@migaia/rpc-threads'
import { AppWorker, openWebSession } from './app-thread.js'

const failures: unknown[] = []
const session = await openWebSession((context) => createWebThreadLauncher({
  Worker: AppWorker,
  report: (error) => { failures.push(error) },
  runtimeApi: context
}))
try { console.log(await session.peer.request('math.double', 21)) }
finally { await session.close() }`,
  webGlobalLauncher: `import { createWebThreadLauncher } from '@migaia/rpc-threads'
import { openWebSession } from './app-thread.js'

const session = await openWebSession((context) => createWebThreadLauncher({
  report: (error) => { console.error(error) },
  runtimeApi: context
}))
try { console.log(await session.peer.request('math.double', 21)) }
finally { await session.close() }`,
  pluginListen: `import { createThreadPlugin } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'
import { acceptWorkerChannel, closeApplicationThreads } from './app-thread.js'

const plugin = createThreadPlugin<{ math: { double(value: number): number } }>({
  name: 'worker',
  listen: acceptWorkerChannel
})
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try {
  await host.use(plugin)
  console.log(await host.thread!.request('worker', 'math.double', 21))
} finally { await host.dispose(); await closeApplicationThreads() }`,
  pluginPolicy: `import { createThreadPlugin } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'
import { defineProbe } from '@migaia/rpc-core/probe'
import { openAuthenticatedWorkerChannel, applicationAuthentication, closeApplicationThreads } from './app-thread.js'

const stages: number[] = []
const probe = defineProbe({ stages: ['message'], emit: (event) => { stages.push(event.stage) } })
const plugin = createThreadPlugin<{ math: { double(value: number): number } }>({
  name: 'worker',
  connect: openAuthenticatedWorkerChannel,
  authentication: applicationAuthentication,
  provide: { math: { double: (value: number) => value * 2 } },
  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },
  probe,
  defaultTimeoutMs: 2000,
  contract: { schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }
})
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try {
  await host.use(plugin)
  console.log(await host.thread!.request('worker', 'math.double', 21), stages.length > 0)
} finally { await host.dispose(); await closeApplicationThreads() }`,
  pluginRetry: `import { createThreadPlugin } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'
import { openWorkerChannel, closeApplicationThreads } from './app-thread.js'

let keyCalls = 0
let retryCalls = 0
const plugin = createThreadPlugin<{ math: { double(value: number): number } }>({
  name: 'worker',
  connect: openWorkerChannel,
  keyFactory: () => { keyCalls += 1; return 'logical-call-1' },
  retryPort: {
    dispatch: async (input) => {
      retryCalls += 1
      return input.sendOnce({ expectedGeneration: input.generation, key: input.key })
    }
  }
})
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try {
  await host.use(plugin)
  console.log(await host.thread!.request('worker', 'math.double', 21), keyCalls, retryCalls)
} finally { await host.dispose(); await closeApplicationThreads() }`,
  pluginEndpoint: `import { createThreadPlugin } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'
import { openRawWorkerChannel, closeApplicationThreads } from './app-thread.js'

const failure = new Error('application endpoint setup failed')
const plugin = createThreadPlugin({ name: 'worker', connect: openRawWorkerChannel,
  endpointFactory: async (_channel, signal) => {
    if (signal.aborted) throw signal.reason
    throw failure
  }
})
const host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try { await host.use(plugin) }
catch (error) { console.log(error instanceof Error) }
finally { await host.dispose(); await closeApplicationThreads() }`,
  peerSpawn: pairedThreadExample(`import { createThreadPeer } from '@migaia/rpc-threads'
import type { IWorkerApi, IParentApi } from './contracts.js'

const failures: unknown[] = []
const worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url),
  self: { name: 'main', instanceId: 'main-1' },
  provide: { audit: { record: (message: string) => console.log(message) } } satisfies IParentApi,
  report: (error) => { failures.push(error) }
})
try { console.log(await worker.request('math.double', 21)) }
finally { await worker.close() }`),
  peerConnect: borrowedPortExample(false),
  webChannel: borrowedPortExample(true),
  pluginSpawn: pairedThreadExample(`import { createThreadPlugin } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'
import type { IWorkerApi, IParentApi } from './contracts.js'

const plugin = createThreadPlugin<IWorkerApi, IParentApi, 'worker'>({
  name: 'worker', spawn: new URL('./worker.js', import.meta.url), expose: [],
  self: { name: 'main', instanceId: 'main-1' },
  provide: { audit: { record: (message: string) => console.log(message) } },
  report: (error) => { console.error(error) }
})
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try { await host.use(plugin); console.log(await host.thread!.request('worker', 'math.double', 21)) }
finally { await host.dispose() }`)
}
/** Configuration cases stay within the source and ownership model each caller already uses. */
const threadOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  peer: [
    {
      title: t('Name an owned worker and its reverse service', '为持有的线程及反向服务命名'),
      problem: t(
        'spawn starts a library-owned worker. self supplies the parent identity, provide publishes the reverse audit method, and report collects background failures. Without provide the worker cannot call audit.record; without report the default writes to console.error.',
        'spawn 启动由库持有的线程。self 提供父端身份，provide 发布反向 audit 方法，report 收集后台失败。省略 provide 后，线程无法调用 audit.record；省略 report 时默认输出到控制台错误通道。'
      ),
      example: threadOptionExamples.peerSpawn,
      result: t(
        'The worker calls audit.record with double, then returns 42. Closing the peer requests worker termination.',
        '线程用 double 调用 audit.record，然后返回 42。关闭 Peer 会请求终止线程。'
      ),
      covers: ['spawn', 'self', 'provide', 'report']
    },
    {
      title: t('Borrow application-owned ports', '借用应用持有的端口'),
      problem: t(
        'Use connect when the application already owns the port. The callback receives the actual capability proposal and returns its channel. Do not also set spawn or listen; closing the peer does not close the borrowed native ports.',
        '应用已经持有端口时使用 connect。回调接收实际能力提议并返回通道。不能同时设置 spawn 或 listen；关闭 Peer 不会关闭借用的原生端口。'
      ),
      example: threadOptionExamples.peerConnect,
      result: t(
        'The right peer calls double and receives 42; the application closes both ports afterwards.',
        '右端调用 double 得到 42，随后由应用关闭两个端口。'
      ),
      covers: ['connect', 'self', 'provide']
    },
    {
      title: t('Accept an application-owned session', '接受应用持有的会话'),
      problem: t(
        'acceptWorkerChannel is the application helper that accepts one session and returns a real thread channel. Select listen for this direction; omission requires another source, and sources are mutually exclusive.',
        'acceptWorkerChannel 是应用接受一次会话并返回真实线程通道的辅助函数。这个方向选择 listen；省略时必须选择其它来源，几种来源互斥。'
      ),
      example: threadOptionExamples.peerListen,
      result: t(
        'The accepted session returns 42. The application helper releases its borrowed ports after peer closure.',
        '已接受会话返回 42；Peer 关闭后，应用辅助函数释放借用端口。'
      ),
      covers: ['listen']
    },
    {
      title: t('Roll back a failed custom endpoint setup', '回滚失败的自定义端点准备'),
      problem: t(
        'An advanced host can assemble its own endpoint for the acquired channel. endpointFactory receives that channel and the construction signal. Here setup fails deliberately; omission would use canonical endpoint assembly. openRawWorkerChannel supplies an application-owned real port.',
        '高级宿主可以为取得的通道自行组装端点。endpointFactory 接收通道和构造信号。这里刻意使准备失败；省略时使用规范端点组装。openRawWorkerChannel 提供应用持有的真实端口。'
      ),
      example: threadOptionExamples.peerEndpoint,
      result: t(
        'The original setup failure is preserved and construction rolls back.',
        '保留原始准备失败，并回滚构造。'
      ),
      covers: ['endpointFactory', 'connect']
    },
    {
      title: t('Bound and observe the local provider', '限制并观察本端提供方'),
      problem: t(
        'An application exposes math.double with an explicit contract and small admission limits. probe observes message stages, while defaultTimeoutMs limits request and stream calls to 2000 ms. openWorkerChannel owns the existing port session. Omission uses inferred declarations, standard limits, no probe and a 30000 ms call default.',
        '应用以显式契约和较小接纳上限提供 math.double。probe 观察消息阶段，defaultTimeoutMs 把请求和流的默认等待设为 2000 毫秒。openWorkerChannel 持有已有端口会话。省略时推导声明、使用标准上限、不安装观察者，默认调用等待 30000 毫秒。'
      ),
      example: threadOptionExamples.peerPolicy,
      result: t(
        'The request returns 42 and at least one message observation is recorded.',
        '请求返回 42，并记录至少一次消息观察。'
      ),
      covers: ['connect', 'provide', 'providerLimits', 'probe', 'defaultTimeoutMs', 'contract']
    },
    {
      title: t('Keep inherited proxy hooks out of direct calls', '明确继承代理钩子不控制直接调用'),
      problem: t(
        'keyFactory and retryPort belong to advanced proxy paths. A borrowed connect peer does not read them for a direct request. The application’s openWorkerChannel supplies that borrowed channel; this example shows why these inherited fields do not enable direct-call retry.',
        'keyFactory 和 retryPort 属于高级代理路径。使用借用 connect 的 Peer 不会为直接请求读取它们。应用的 openWorkerChannel 提供该借用通道；此例说明继承字段不会开启直接调用重试。'
      ),
      example: threadOptionExamples.peerRetry,
      result: t(
        'The call returns 42; keyCalls and retryCalls both remain 0.',
        '调用返回 42，keyCalls 和 retryCalls 都保持 0。'
      ),
      covers: ['connect', 'keyFactory', 'retryPort']
    }
  ],
  plugin: [
    {
      title: t('Publish only the plugin’s reverse audit method', '只发布插件自己的反向审计方法'),
      problem: t(
        'name selects the installed outlet registration. spawn owns the worker, provide publishes audit.record, and an empty expose list publishes no extra Host methods. self names the parent; report receives background errors.',
        'name 选择安装后的出口登记。spawn 持有线程，provide 发布 audit.record，空 expose 不额外发布 Host 方法。self 为父端命名，report 接收后台错误。'
      ),
      example: threadOptionExamples.pluginSpawn,
      result: t(
        'The worker calls audit.record and returns 42 through the Host thread outlet.',
        '线程调用 audit.record，并通过 Host 的 thread 出口返回 42。'
      ),
      covers: ['name', 'spawn', 'provide', 'expose', 'self', 'report']
    },
    {
      title: t('Install a signed and bounded provider session', '安装带认证且有上限的提供方会话'),
      problem: t(
        'openAuthenticatedWorkerChannel returns the application’s existing port session, using the same applicationAuthentication at both ends. The explicit contract, providerLimits and probe stay with endpoint assembly; defaultTimeoutMs sets request and stream waiting. Omitting authentication adds no signing or verification.',
        'openAuthenticatedWorkerChannel 返回应用已有端口会话，两端使用同一 applicationAuthentication。显式 contract、providerLimits 和 probe 仍由端点组装处理，defaultTimeoutMs 设置请求和流的等待。省略 authentication 时不增加签名或校验。'
      ),
      example: threadOptionExamples.pluginPolicy,
      result: t(
        'The installed outlet returns 42 and records a message observation.',
        '安装后的出口返回 42，并记录消息观察。'
      ),
      covers: [
        'name',
        'connect',
        'authentication',
        'provide',
        'providerLimits',
        'probe',
        'defaultTimeoutMs',
        'contract'
      ]
    },
    {
      title: t('Install an accepted session', '安装已接受的会话'),
      problem: t(
        'acceptWorkerChannel is an application-owned channel accepter. listen selects that source without starting another worker; choose exactly one of listen, connect and spawn. The Host owns plugin removal.',
        'acceptWorkerChannel 是应用持有的通道接收函数。listen 选择该来源，不启动另一线程；listen、connect 和 spawn 只能选择一个。Host 负责移除插件。'
      ),
      example: threadOptionExamples.pluginListen,
      result: t(
        'The Host outlet calls math.double and receives 42.',
        'Host 出口调用 math.double，得到 42。'
      ),
      covers: ['name', 'listen']
    },
    {
      title: t(
        'Reject installation when custom endpoint setup fails',
        '自定义端点准备失败时拒绝安装'
      ),
      problem: t(
        'An application endpointFactory can fail after a real port is acquired. The plugin installation then rejects and rolls back instead of publishing a callable outlet. Omission uses the canonical endpoint; openRawWorkerChannel owns the borrowed port.',
        '应用的 endpointFactory 可能在取得真实端口后失败。插件安装随后拒绝并回滚，不发布可调用出口。省略时使用规范端点；openRawWorkerChannel 持有借用端口。'
      ),
      example: threadOptionExamples.pluginEndpoint,
      result: t(
        'Installation rejects with an Error and the Host remains disposable.',
        '安装以 Error 拒绝，Host 仍可释放。'
      ),
      covers: ['name', 'connect', 'endpointFactory']
    },
    {
      title: t(
        'Inspect inherited hooks on a borrowed plugin source',
        '查看借用插件来源上的继承钩子'
      ),
      problem: t(
        'The application’s openWorkerChannel returns a borrowed connect source. Direct outlet requests on that source do not consume proxy keyFactory or retryPort. Omission keeps the original direct-call behavior.',
        '应用的 openWorkerChannel 返回借用 connect 来源。该来源上的直接出口请求不使用代理 keyFactory 或 retryPort。省略时保持原直接调用行为。'
      ),
      example: threadOptionExamples.pluginRetry,
      result: t(
        'The call returns 42; neither inherited hook runs.',
        '调用返回 42，两个继承钩子均不运行。'
      ),
      covers: ['name', 'connect', 'keyFactory', 'retryPort']
    },
    {
      title: t('Expose controlled Host management explicitly', '显式公开受控的 Host 管理'),
      problem: t(
        'applicationHost is the same Host that installs this plugin. applicationCatalog declares allowed plugin contracts, and resolveApplicationPlugin returns only local definitions admitted by that catalog. expose must include host before these controls are published; omitting the three helpers is allowed when host is not exposed.',
        'applicationHost 是安装本插件的同一 Host。applicationCatalog 声明允许的插件契约，resolveApplicationPlugin 仅返回目录接纳的本地定义。只有 expose 含 host 才发布这些控制；不公开 host 时可以省略这三个辅助项。'
      ),
      example: threadOptionExamples.pluginHost,
      result: t(
        'The plugin installs and the Host revision advances. The example grants no remote access outside the explicit catalog.',
        '插件安装成功，Host revision 推进；此例不公开目录之外的远程管理能力。'
      ),
      covers: ['name', 'connect', 'expose', 'host', 'catalog', 'resolvePlugin']
    }
  ],
  channel: [
    {
      title: t('Negotiate a Node MessagePort pair', '协商 Node MessagePort 端口对'),
      problem: t(
        'The channel uses the same systemScheduler as its source and forwards the Core context capabilities to the other side. Omitting capabilities uses the fixed basic profile; an application-owned raw channel does not invent runtime guarantees.',
        '通道与来源共用 systemScheduler，并把 Core 上下文 capabilities 提议给另一端。省略 capabilities 时使用固定基础能力；应用持有的原始通道不会凭空获得运行时保证。'
      ),
      example: threadOptionExamples.peerConnect,
      result: t(
        'A real MessagePort pair carries the request and result 42.',
        '真实 MessagePort 对传递请求及结果 42。'
      ),
      covers: ['scheduler', 'capabilities']
    },
    {
      title: t('Negotiate an EventTarget MessagePort pair', '协商 EventTarget MessagePort 端口对'),
      problem: t(
        'Web-style MessagePorts need start() before message delivery. scheduler supplies their timer owner, and capabilities forwards the actual source proposal. These options change neither native port ownership nor unsupported exit observation.',
        'Web 风格 MessagePort 必须先 start() 才投递消息。scheduler 提供计时拥有者，capabilities 转交实际来源提议。这些选项不改变原生端口归属，也不提供不受支持的退出观察。'
      ),
      example: threadOptionExamples.webChannel,
      result: t(
        'The Web-style ports carry double and return 42, then the application closes both ports.',
        'Web 风格端口传递 double 并返回 42，随后应用关闭两个端口。'
      ),
      covers: ['scheduler', 'capabilities']
    }
  ],
  nodeLauncher: [
    {
      title: t(
        'Launch with the actual Core context and clean flags',
        '使用真实 Core 上下文及独立参数启动'
      ),
      problem: t(
        'The application helper openNodeSession supplies its actual Core source context and owns native teardown. runtimeApi forwards that context to child bootstrap. execArgv [] prevents inheriting parent controller flags; omission preserves native inheritance.',
        '应用辅助函数 openNodeSession 提供实际 Core 来源上下文，并负责原生释放。runtimeApi 将上下文送入子端启动数据。execArgv [] 避免继承父端控制参数；省略时保持原生继承。'
      ),
      example: threadOptionExamples.nodeLauncher,
      result: t(
        'The launched Node worker returns 42, then the helper closes the peer and observes actual exit.',
        '启动的 Node 线程返回 42，辅助函数随后关闭 Peer 并观察实际退出。'
      ),
      covers: ['runtimeApi', 'execArgv']
    },
    {
      title: t('Supply a native runtime loader explicitly', '显式提供原生运行时加载器'),
      problem: t(
        'An adapter already owns its native runtime loader. createAdapterNodeThreadLauncher receives that loader plus actual runtimeApi context and explicit execArgv. openNodeSession opens the resulting real handle and owns cleanup.',
        '适配器已有自己的原生运行时加载器。createAdapterNodeThreadLauncher 接收加载器、实际 runtimeApi 上下文和显式 execArgv。openNodeSession 打开返回的真实句柄，并负责清理。'
      ),
      example: threadOptionExamples.nodeAdapterLauncher,
      result: t(
        'The adapted native worker returns 42 and its owner waits for actual exit.',
        '适配后的原生线程返回 42，拥有者等待实际退出。'
      ),
      covers: ['runtimeApi', 'execArgv']
    }
  ],
  webLauncher: [
    {
      title: t('Inject the host’s module Worker constructor', '注入宿主的模块 Worker 构造函数'),
      problem: t(
        'AppWorker is the application-selected real Worker constructor. openWebSession supplies the actual Core context, opens the handle and owns termination. Worker selects the constructor, report receives native background errors, and runtimeApi forwards bootstrap data. Omission reads global Worker at launch time.',
        'AppWorker 是应用选择的真实 Worker 构造函数。openWebSession 提供实际 Core 上下文、打开句柄并负责终止。Worker 选择构造函数，report 接收原生后台错误，runtimeApi 透传启动数据。省略 Worker 时在启动时读取全局构造函数。'
      ),
      example: threadOptionExamples.webLauncher,
      result: t(
        'The module worker returns 42. Closing requests termination; this platform has no actual-exit receipt.',
        '模块线程返回 42。关闭时请求终止；此平台没有实际退出回执。'
      ),
      covers: ['Worker', 'report', 'runtimeApi']
    },
    {
      title: t('Use the global constructor with a diagnostic sink', '使用全局构造函数及诊断出口'),
      problem: t(
        'When the host already provides Worker, omit the constructor and keep an explicit report callback. The launcher requires that sink. openWebSession supplies runtimeApi and owns the physical Worker; no native exit guarantee is added.',
        '宿主已有 Worker 时省略构造函数，并保留显式 report 回调。启动器要求提供此出口。openWebSession 提供 runtimeApi 并持有物理 Worker，不增加原生退出保证。'
      ),
      example: threadOptionExamples.webGlobalLauncher,
      result: t(
        'The global Worker returns 42 and its owner requests termination after closing the peer.',
        '全局 Worker 返回 42，拥有者在关闭 Peer 后请求终止。'
      ),
      covers: ['report', 'runtimeApi']
    }
  ]
}
/** Usage belongs to this Thread entry and does not mutate shared runtime documentation. */
const threadPeerUsageMembers = {
  ...threadPeerOptionMembers,
  report: {
    ...threadPeerOptionMembers.report!,
    whenToUse: t(
      'Set a sink when the application needs to collect background or contained failures separately from request rejections. Omitting it uses defaultRpcReporter and console.error; it does not make a failed request successful.',
      '应用需要把后台或隔离失败与请求拒绝分开记录时设置。省略时使用 defaultRpcReporter 和 console.error；它不会让失败请求成功。'
    ),
    example: threadOptionExamples.peerSpawn
  },
  endpointFactory: {
    ...threadPeerOptionMembers.endpointFactory!,
    whenToUse: t(
      'Use it only when the application already owns advanced endpoint assembly for the acquired channel. The callback receives the construction signal and must return a real IRemoteServeEndpoint. Failure rolls back construction; omission uses canonical assembly.',
      '仅当应用已有取得通道后的高级端点组装逻辑时设置。回调接收构造信号，必须返回真实 IRemoteServeEndpoint。失败回滚构造；省略时使用规范组装。'
    ),
    example: threadOptionExamples.peerEndpoint
  },
  keyFactory: {
    ...threadPeerOptionMembers.keyFactory!,
    whenToUse: t(
      'Use it on managed proxy paths that generate keys for retryable calls. A borrowed direct connect/listen peer does not read it. Omission uses defaultRpcId in proxy paths and leaves direct call-option keys unchanged.',
      '需要为可重试调用生成键的托管代理路径使用此项。借用的直接 connect/listen Peer 不读取它。省略时代理路径使用 defaultRpcId，直接调用选项中的键保持原语义。'
    ),
    example: threadOptionExamples.peerRetry
  }
}
/** Plugin-specific callback examples run through Host installation. */
const threadPluginUsageMembers = {
  ...threadPluginOptionMembers,
  ...threadPeerUsageMembers,
  report: { ...threadPeerUsageMembers.report, example: threadOptionExamples.pluginSpawn },
  endpointFactory: {
    ...threadPeerUsageMembers.endpointFactory,
    example: threadOptionExamples.pluginEndpoint
  },
  keyFactory: { ...threadPeerUsageMembers.keyFactory, example: threadOptionExamples.pluginRetry }
}
nodeLauncherOptions.runtimeApi = {
  ...nodeLauncherOptions.runtimeApi!,
  example: threadOptionExamples.nodeLauncher
}
nodeLauncherOptions.execArgv = {
  ...nodeLauncherOptions.execArgv!,
  example: threadOptionExamples.nodeLauncher
}
/** Reference of `@migaia/rpc-threads`. */
/** Node adapter aliases share the same public option group as the advanced launcher. */
if (platformSymbols['adapters/node:createNodeThreadLauncher'])
  platformSymbols['adapters/node:createNodeThreadLauncher'] = {
    ...platformSymbols['adapters/node:createNodeThreadLauncher'],
    optionCases: threadOptionCases.nodeLauncher
  }
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
      cases: rpcThreadsCases.createThreadPeer,
      exampleIntro: {
        en: "Install this package and its Core and Contract peers, save each complete ESM example as a real file, and run it with Node 24. Await `isThreadChild()` before any parent-only work: `spawn: true` reexecutes the entry, not just its provider. `provide` defaults to no methods; functions accept the request payload, and async generators supply streams. A short spawn selects the native runtime launcher, `systemScheduler`, a thread budget of `1`, and `isolation: 'best-effort'`; optional name/data/limits default to `undefined`. `defaultTimeoutMs` is `30000`, `report` defaults to `defaultRpcReporter`, and authentication defaults to `undefined`. ArrayBuffer and Uint8Array requests copy by default. The optional transfer list defaults to `undefined`; unsigned RPC rejects it before provider execution, so enabling native transfer requires real signing at both endpoints and actual capability negotiation. Node Workers share process.pid but have distinct threadId values; this is not process isolation.",
        zh: "直接安装本包及 Core、Contract 两个 peer，把每个完整 ESM 示例保存为真实文件，用 Node 24 运行。父端操作前先等待 `isThreadChild()`；`spawn: true` 重新执行整个入口，不只是提供方函数。`provide` 默认没有方法；函数接收请求参数，异步生成器提供流。短启动选择原生运行时启动器、`systemScheduler`、容量为 `1` 的线程预算及 `isolation: 'best-effort'`；可选 name/data/limits 默认为 `undefined`。`defaultTimeoutMs` 默认 `30000`，`report` 默认 `defaultRpcReporter`，authentication 默认 `undefined`。ArrayBuffer、Uint8Array 请求默认复制。可选 transfer 列表默认 `undefined`；未签名的 RPC 会在执行提供方前拒绝转移，启用它需要双方真实签名及实际能力协商。Node Worker 共享 process.pid，但 threadId 不同，这不是进程级隔离。"
      },
      purpose: t(
        'Opens a Runtime Peer to a Worker. In the parent, `spawn` starts the Worker (URL, path, `true` for the current entry, or a full source). Inside a library-launched Worker, calling it without a source connects back to the parent. Resolves after handshake.',
        '打开一个与 Worker 通信的 Runtime Peer。在父线程中，`spawn` 启动 Worker（URL、路径、表示当前入口的 `true`，或完整 source）。在由库启动的 Worker 内部，不传来源调用即可连回父线程。握手完成后 resolve。'
      ),
      params: {
        options: t(
          'See `IRuntimeThreadPeerOptions`: `spawn` or `connect`, `provide`, `report` (default `defaultRpcReporter`), `defaultTimeoutMs` (default `30000`), `authentication`, `providerLimits`, `self` and `probe`.',
          '见 `IRuntimeThreadPeerOptions`：`spawn` 或 `connect`、`provide`、`report`（默认 `defaultRpcReporter`）、`defaultTimeoutMs`（默认 `30000`）、`authentication`、`providerLimits`、`self`、`probe`。'
        ),
        runtime: t(
          'Advanced: custom Node `worker_threads` resource; default the real module.',
          '高级用法：自定义的 Node `worker_threads` 资源；默认为真实模块。'
        )
      },
      returns: t(
        'An `IRuntimeTypedPeer<TRemote>`; `close()` drains under its owner budget and requests termination of an owned Worker. Bad configuration rejects with `INVALID_CONFIG`. Web close may report `REAP_TIMEOUT` and retain an abandoned lease because terminate has no actual-exit receipt.',
        '返回 `IRuntimeTypedPeer<TRemote>`；关闭时按所有者预算排空，并请求终止自己拥有的 Worker。配置错误以 `INVALID_CONFIG` 拒绝；Web 线程没有实际退出回执，关闭可能报告 `REAP_TIMEOUT` 并保留已放弃租约。'
      ),
      example: rpcThreadsCases.createThreadPeer![0]!.example,
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
      cases: rpcThreadsCases.createThreadPlugin,
      exampleIntro: {
        en: "Directly install `@migaia/plugin-host`. `name: 'worker'` selects the Host outlet target, and `spawn: true` uses the guarded child branch. The child publishes `next`, whose local counter starts at zero in every fresh Worker. `provide` defaults to no methods and `expose` to an empty whitelist. `defineHost` requires `host.execution.mutationTimeoutMs` and `pipelineDrainTimeoutMs`; each is explicitly `false` here for no deadline, not an omitted default. `host.use()` installs the cold plugin. `request(name, method, payload?)` omits payload for this zero-argument method; `restart(name)` waits for the successor to enter the outlet directory before returning ready. `host.dispose()` releases the owned Worker; it does not copy the old Worker's local state into the new one.",
        zh: "还需直接安装 `@migaia/plugin-host`。`name: 'worker'` 选择 Host 出口目标，`spawn: true` 使用已分支的子入口。子端发布 `next`，每个新 Worker 的局部计数器都从零开始。`provide` 默认没有方法，`expose` 默认空白名单。`defineHost` 必须提供 `host.execution.mutationTimeoutMs` 与 `pipelineDrainTimeoutMs`；此例都显式设为 `false`，表示不设期限，并非省略后的默认值。`host.use()` 安装尚未启动的插件。`request(name, method, payload?)` 对零参数方法省略 payload；`restart(name)` 等待后继进入出口目录后才返回 ready。`host.dispose()` 释放它拥有的 Worker，不会把旧 Worker 的局部状态复制到新 Worker。"
      },
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
      example: rpcThreadsCases.createThreadPlugin![0]!.example
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
      example: selfSpawnExample,
      avoid: [
        t(
          'Self spawn is unsupported in browsers, Electron, REPL/eval sessions, bundled executables and entries controlled by a test runner; use an explicit built Worker URL.',
          '浏览器、Electron、交互或求值入口、打包二进制及由测试运行器持有的入口不支持同文件自启动；应使用明确的已构建工作线程 URL。'
        )
      ]
    },
    RPC_THREAD_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/threads`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        '本包自有错误的 `source` 值（`@migaia/rpc/threads`）；超时、取消等调用层错误则来自 `@migaia/rpc/core`。'
      ),
      example: diagnosticExample
    },
    RpcThreadErrorCode: {
      role: 'constant',
      purpose: t(
        'Error codes owned by this package; currently only `THREAD_USAGE_SAMPLE_FAILED`.',
        '本包自有的错误码对照表；目前只有资源采样失败 `THREAD_USAGE_SAMPLE_FAILED` 一项。'
      ),
      example: diagnosticExample
    },
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
        'An `IThreadLauncher` whose handles open channels with `open(signal, options)`. Construction or initial send failure removes acquired listeners and requests termination; original native failures remain reachable, without claiming native exit confirmation.',
        '一个 `IThreadLauncher`，句柄通过 `open(signal, options)` 打开通道；构造或初始发送失败移除已取得监听并请求终止，原生失败仍可追踪，不宣称确认原生退出。'
      ),
      example: fullSpawnExample('Web', '{ Worker, report }')
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
          '`{ scheduler, capabilities? }`; use the source scheduler. Capabilities narrow the actual launch offer, and Core retains the peer acknowledgement.',
          '`{ scheduler, capabilities? }`；使用来源同一调度器，能力仅缩小实际启动提议，核心保留对端实际确认。'
        )
      },
      returns: t(
        'A channel factory with `open(handle, signal)`.',
        '带 `open(handle, signal)` 的通道工厂。'
      ),
      example: fullSpawnExample('Web', '{ Worker, report }')
    },
    createAdapterNodeThreadLauncher: {
      role: 'factory',
      optionDocs: nodeLauncherOptions,
      optionCases: threadOptionCases.nodeLauncher,
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
          '`{ runtimeApi?, execArgv? }`, default {} as in `createNodeThreadLauncher`. A synchronous native Worker-constructor rejection is classified as Core INVALID_CONFIG; a native code conflict keeps that original error and its original diagnostic fields on cause.',
          '`{ runtimeApi?, execArgv? }` 默认 {}，含义与 `createNodeThreadLauncher` 相同。原生 Worker 构造器同步拒绝时分类为 Core INVALID_CONFIG；原生 code 冲突时，把原错误及其原诊断字段保留在 cause 上。'
        )
      },
      returns: t(
        'An `IThreadLauncher` with handles that can `open()` a channel.',
        '一个 `IThreadLauncher`，其句柄可以 `open()` 通道。'
      ),
      example: fullSpawnExample('AdapterNode', 'runtime')
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
      example: fullSpawnExample('AdapterNode', 'runtime')
    },
    createNodeThreadChannel: {
      options: 'IThreadChannelOptions',
      role: 'factory',
      cases: rpcThreadsCases.createNodeThreadChannel,
      exampleIntro: {
        en: "Directly install `@migaia/utils` for the required borrowed `systemScheduler`. Each port is a real end of Node's `MessageChannel`; peerId is its opposite routing label, not authentication. Omitted capabilities selects the synchronous fixed profile; passing Core `connect(context).capabilities` proposes runtime extensions and waits for actual bilateral ACK instead. `transport.subscribe(listener)` returns an unsubscribe; channel.close() shares one completion and does not close a borrowed native port. The first example uses Node `once(port, 'message')` to await actual delivery after logical close. The second observes the physical transport: capturing is a required boolean, emit(direction, sizeBytes, carrier, detail, content) returns void, and each new observer replaces the previous generation. `send(buffer, { transfer: [buffer] })` detaches that native buffer; captured transferred bytes are copied before detachment. The receiving subscription exposes message.data; both channel owners close before the caller closes the ports. This low-level path does not perform signed RPC admission.",
        zh: "还需直接安装 `@migaia/utils`，为必填调度器传入借用的 `systemScheduler`。两个端口来自真实 Node `MessageChannel`；peerId 是对端路由标签，不构成认证。省略 capabilities 选择同步的固定基础配置；传入 Core 的 `connect(context).capabilities` 则提议运行时扩展，必须等待真实双边确认。`transport.subscribe(listener)` 返回退订函数；channel.close() 共用一次完成结果，不关闭借用的原生端口。第一例用 Node `once(port, 'message')` 等待逻辑关闭后的实际交付。第二例观察物理载体：capturing 为必填布尔值，`emit(direction, sizeBytes, carrier, detail, content)` 返回 `void`，每次新观察回调替换旧代次。`send(buffer, { transfer: [buffer] })` 让原生 buffer 失效；被捕获的转移字节会在失效前复制。接收订阅通过 message.data 提供内容；先关闭两个通道，再由调用方关闭原生端口。此底层路径不执行已签名 RPC 的准入。"
      },
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
      example: rpcThreadsCases.createNodeThreadChannel![0]!.example
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
      example: borrowedPortExample(true)
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
      example: fullSpawnExample('AdapterNode', 'runtime')
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
          '`(data, peerId) => void | Promise`; `data` is `spec.data` from the launcher, and `peerId` is the launched handle fingerprint used for the fixed channel address.',
          '`(data, peerId) => void | Promise`；`data` 来自 launcher 的 `spec.data`，`peerId` 是用于固定通道寻址的已启动句柄指纹。'
        )
      },
      returns: t(
        'Resolves with the bootstrap data after acknowledging.',
        '确认之后以启动数据 resolve。'
      ),
      example: webBootstrapExample()
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
      example: nativeWorkerExample(false)
    },
    ...platformSymbols
  },
  types: {
    RuntimeEventName: {
      summary: t(
        'Type-only union of supported runtime lifecycle event names. This package re-exports the type; use a literal such as exit when subscribing.',
        '仅类型导出的运行时生命周期事件名联合；本包不导出同名运行常量，订阅时可使用退出等事件字面量。'
      ),
      members: {},
      example: `import type { RuntimeEventName } from '@migaia/rpc-threads'
const event: RuntimeEventName = 'exit'
console.log(event)`
    },
    ...runtimePairedTypes('thread'),
    IRuntimeThreadPeerOptions: {
      optionCases: threadOptionCases.peer,
      summary: t(
        'Options of `createThreadPeer()`: the Worker source plus the Core Peer options.',
        '`createThreadPeer()` 的选项：Worker 来源以及 Core Peer 的通用选项。'
      ),
      example: transferExample,
      members: {
        ...threadPeerUsageMembers,
        authentication: {
          ...threadPeerOptionMembers.authentication!,
          example: transferExample
        }
      }
    },
    IRuntimeThreadPluginOptions: {
      optionCases: threadOptionCases.plugin,
      summary: t(
        'Options of `createThreadPlugin()`.',
        '`createThreadPlugin()` 的选项：连接名称、来源、提供与公开的方法。'
      ),
      members: threadPluginUsageMembers
    },
    IRuntimeThreadShortSpawn: {
      summary: t(
        'Short `spawn` object expanded to a full source with defaults.',
        '会用默认值展开为完整 source 的简写 `spawn` 对象。'
      ),
      example: pairedThreadExample(`import { createThreadPeer } from '@migaia/rpc-threads'
import { createNodeThreadLauncher, createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IParentApi, IWorkerApi } from './contracts.js'

const worker = await createThreadPeer<IWorkerApi>({
  spawn: {
    entry: new URL('./worker.js', import.meta.url),
    name: 'math-worker',
    launcher: createNodeThreadLauncher(),
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler })
  },
  provide: { audit: { record: (message: string) => console.log(message) } } satisfies IParentApi
})
try {
  console.log(await worker.request('math.double', 21))
} finally {
  await worker.close()
}`),
      members: {
        launcher: {
          ...threadSpawnMembers.launcher!,
          default: t(
            'Runtime-selected Node or canonical Web launcher.',
            '默认选择运行环境对应的节点或规范网页线程启动器。'
          )
        },
        budget: {
          ...threadSpawnMembers.budget!,
          default: t(
            'One thread unit, using the source scheduler.',
            '默认使用来源调度器的单线程执行单元预算。'
          )
        },
        scheduler: {
          ...threadSpawnMembers.scheduler!,
          default: t('systemScheduler.', '默认使用系统调度器。')
        },
        channelFactory: {
          ...threadSpawnMembers.channelFactory!,
          default: t(
            'Canonical factory matching the selected runtime launcher.',
            '默认使用匹配运行环境启动器的规范通道工厂。'
          )
        },
        report: {
          ...threadSpawnMembers.report!,
          summary: t('Optional source background reporter.', '可选来源后台错误报告函数。'),
          default: t(
            'Source report, then Peer report, then defaultRpcReporter.',
            '依次选用来源报告、对端报告及默认核心报告函数。'
          )
        },
        health: threadSpawnMembers.health!,
        supervisor: {
          ...threadSpawnMembers.supervisor!,
          default: t(
            'Existing supervision defaults; isolation is best-effort.',
            '默认使用既有监督策略，隔离采用尽力模式。'
          )
        },
        keyFactory: {
          ...threadSpawnMembers.keyFactory!,
          default: t(
            'Existing runtime key factory; a top-level override takes priority.',
            '默认使用既有运行时键工厂，顶层覆盖优先。'
          )
        },
        retryPort: {
          ...threadSpawnMembers.retryPort!,
          default: t(
            'Existing runtime retry port; a top-level override takes priority.',
            '默认使用既有运行时重试端口，顶层覆盖优先。'
          )
        },
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
      optionCases: threadOptionCases.channel,
      summary: t(
        'Options of channel constructors and factories.',
        '通道构造函数与通道工厂的选项。'
      ),
      example: borrowedPortExample(false),
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
      example: webBootstrapExample(),
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
          example: webBootstrapExample()
        }
      }
    },
    IThreadBootstrapData: {
      summary: t(
        'Bootstrap data written by a launcher: the launched handle channel address and optional application data.',
        'launcher 写入的启动数据：已启动句柄的通道地址以及可选的应用数据。'
      ),
      scenarios: [
        t(
          'Read the start configuration in a custom Worker entry.',
          '在自定义的 Worker 入口中读取启动配置。'
        )
      ],
      example: fullSpawnExample('AdapterNode', 'runtime'),
      members: {
        peerId: {
          summary: t(
            'Launcher-generated handle fingerprint; matches `handle.identity.fingerprint`, not the runtime parent identity.',
            'launcher 生成的句柄指纹，与 `handle.identity.fingerprint` 相同，不是运行时父端身份。'
          )
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
          example: nativeWorkerExample(true)
        },
        postMessage,
        ...eventTargetPair
      }
    },
    IWebThreadLauncherOptions: {
      optionCases: threadOptionCases.webLauncher,
      summary: t('Options of Web-style launchers.', 'Web 风格 launcher 的选项：构造函数与上报。'),
      members: {
        ...webLauncherOptionMembers,
        Worker: {
          ...webLauncherOptionMembers.Worker!,
          whenToUse: t(
            'Inject the actual module Worker constructor when the host does not expose it globally or an application supplies its own runtime. Omission reads global Worker only when launch starts; this does not add exit observation.',
            '宿主没有全局构造函数，或应用自选运行时时，注入真实模块 Worker 构造函数。省略时只在启动时读取全局 Worker，不会增加退出观察。'
          ),
          example: threadOptionExamples.webLauncher
        },
        report: {
          ...webLauncherOptionMembers.report!,
          whenToUse: t(
            'Always supply the native launcher diagnostic sink. It receives background Worker errors; there is no default callback. The owner must still close the peer and request Worker termination.',
            '必须提供原生启动器诊断出口。它接收 Worker 后台错误，没有默认回调。拥有者仍须关闭 Peer 并请求终止 Worker。'
          ),
          example: threadOptionExamples.webLauncher
        }
      }
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
          example: fullSpawnExample('AdapterNode', 'runtime', true)
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
          example: webBootstrapExample(true)
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
          example: fullSpawnExample('AdapterNode', 'runtime')
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
        'Node Worker constructor called with the module entry and launch options: required workerData, optional name, execArgv and resourceLimits. It returns IThreadNativeWorker; instance threadId/on/terminate belong to that returned value.',
        '适配器以模块入口及启动选项调用的线程构造函数；选项必含 `workerData`，可选名称、运行参数及资源限制；返回线程实例，其标识、监听及终止成员属于返回值。'
      ),
      members: {},
      example: `import type { IThreadNativeWorkerConstructor } from '@migaia/rpc-threads'
declare const Worker: IThreadNativeWorkerConstructor
const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { name: 'worker' } })
await worker.terminate()`
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
          example: nativeWorkerExample(false)
        },
        listenerCount: {
          summary: t(
            'Counts `message` listeners to check exclusive ownership.',
            '统计 `message` 监听数量，以确认独占使用。'
          ),
          params: { event: t('Always `message`.', '固定为 `message` 事件。') },
          returns: t('Number of listeners.', '当前监听函数的数量。'),
          example: nativeWorkerExample(false)
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
      example: nativeWorkerExample(false),
      members: {
        open: {
          summary: t(
            'Opens the parent channel with the fixed thread profile.',
            '以固定的线程能力配置打开通往父线程的通道。'
          ),
          params: {
            peerId: t(
              'Peer instance id from the actual parent’s `self.instanceId`; both example modules explicitly configure `main-1`.',
              '对端实例标识取自真实父端配置的 `self.instanceId`；示例两个模块显式配置为 `main-1`。'
            ),
            options: t(
              '`{ scheduler, capabilities? }`.',
              '通道选项 `{ scheduler, capabilities? }`。'
            )
          },
          returns: t('A Peer source result.', '一个 Peer 来源结果。'),
          example: nativeWorkerExample(false)
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
      install: pluginExample,
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
