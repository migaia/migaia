import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Option stories keep the same complete program in both language versions. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Public endpoints need the negotiated channel's actual pipeline and flow-control features. */
const endpointFactoryCode = `const endpointFactory: NonNullable<IRuntimeProcessPeerOptions['endpointFactory']> = async (channel) => {
  const [queue, log] = channel.features
  const endpoint = createRuntimeApiEndpoint({
    id: 'application', targetIds: [channel.peerId], transport: channel.transport,
    scheduler: channel.scheduler,
    features: [queue!, log!] as const,
    middlewares: [codec(channel.pipeline.codec), framer(channel.pipeline.framer),
      abort(), timeout(), hooks({ onHookError: report }),
      connect({ transport: channel.transport }), ping()]
  }, channel)
  await endpoint.ready
  return { endpoint: endpoint as unknown as IRpcEndpoint, oneWay: endpoint, stream: endpoint.stream }
}`

/** Advanced adapter examples use the same public Node-compatible discovery and stdio reader. */
const loaderCode = `const runtime = { load: async () => ({ processRuntimeIO: {
  discover: () => {
    const marker = process.env[PROCESS_RUNTIME_API_ENV]
    if (marker !== undefined) delete process.env[PROCESS_RUNTIME_API_ENV]
    return { marker, runtime: 'node' }
  },
  open: () => openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 5000 })
} }) }`

/** Self-spawn runs one real child and keeps advanced endpoint construction on its owning side. */
const spawnOptionsCode = (
  adapter: boolean
): string => `import { createProcessPeer, ${adapter ? 'createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV, ' : ''}isProcessChild, type IRuntimeProcessPeerOptions } from '@migaia/rpc-process'
import { createRuntimeApiEndpoint, codec, framer, abort, timeout, hooks, connect, ping, type IRpcEndpoint } from '@migaia/rpc-core'
${adapter ? "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n" : ''}
type IServiceApi = { service: { math: { double(value: number): number } } }
const report = (error: unknown) => { console.error(error) }
${adapter ? loaderCode : ''}
if (isProcessChild()) {
  await createProcessPeer({
    provide: { service: { math: { double: (value: number) => value * 2 } } }, report,
    contract: { schemaVersion: 1, plugin: 'service', features: {
      math: { methods: { double: { mode: 'request', idempotent: true } } }
    } }
  })
} else {
  ${endpointFactoryCode}
  let keys = 0
  let retries = 0
  const child = await ${adapter ? 'createAdapterProcessPeer' : 'createProcessPeer'}<IServiceApi>({
    spawn: true, self: { name: 'desktop', instanceId: crypto.randomUUID() },
    defaultTimeoutMs: 2000, endpointFactory, report,
    keyFactory: () => { keys++; return crypto.randomUUID() },
    retryPort: { dispatch: (input) => {
      retries++
      return input.sendOnce({ expectedGeneration: input.generation, key: input.key })
    } }
  }${adapter ? ', runtime' : ''})
  try {
    console.log(await child.request('service.math.double', 21), child.self.name)
    console.log(keys, retries)
  } finally { await child.close() }
}`

/** HMAC protects real frames; the random key remains in this local deployment's two endpoints. */
const namedOptionsCode = (
  adapter: boolean
): string => `import { createHmac, timingSafeEqual } from 'node:crypto'
import { createProcessPeer${adapter ? ', createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV' : ''} } from '@migaia/rpc-process'
import { defineProbe } from '@migaia/rpc-core/probe'
${adapter ? "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n" : ''}
${adapter ? loaderCode : ''}
const name = 'reports-' + crypto.randomUUID()
const token = crypto.randomUUID()
const key = crypto.randomUUID()
const signature = (value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest()
const authentication = {
  encodedType: 'string' as const,
  sign: (value: unknown) => JSON.stringify({ value, signature: signature(value).toString('hex') }),
  verify: (input: unknown) => {
    const frame = JSON.parse(String(input)) as { value: unknown; signature: string }
    const actual = Buffer.from(frame.signature, 'hex')
    const expected = signature(frame.value)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new TypeError('invalid signature')
    return frame.value
  }
}
let observed = 0
const probe = defineProbe({ stages: ['peer'], emit: () => { observed++ } })
const report = (error: unknown) => { console.error(error) }
const contract = { schemaVersion: 1 as const, plugin: 'math', features: {
  math: { methods: { double: { mode: 'request' as const, idempotent: true } } }
} }
const server = await ${adapter ? 'createAdapterProcessPeer' : 'createProcessPeer'}({
  listen: name, token, verify: (auth) => {
    if (auth !== token) throw new TypeError('invalid credential')
    return 'desktop-account'
  },
  self: { name: 'math', instanceId: crypto.randomUUID() },
  provide: { math: { double: (value: number) => value * 2 } }, contract,
  providerLimits: { maxGlobal: 4, maxPerPeer: 2 }, authentication, probe, report
}${adapter ? ', runtime' : ''})
try {
  const client = await ${adapter ? 'createAdapterProcessPeer' : 'createProcessPeer'}<{ math: { double(value: number): number } }>({
    connect: name, token, connectTimeoutMs: 2000, authentication, probe, report,
    defaultTimeoutMs: 2000
  }${adapter ? ', runtime' : ''})
  try { console.log(await client.request('math.double', 21), observed > 0) }
  finally { await client.close() }
} finally { await server.close() }`

/** Runtime options are shared by the public factory and its explicit runtime-loader variant. */
export const processPeerOptionCases = (adapter = false): readonly IOptionCaseDoc[] => [
  {
    title: t('Own a child with an application endpoint', '用应用端点持有子进程'),
    problem: t(
      'A desktop owns a helper and needs its existing endpoint composition. Supply the acquired channel pipeline to the factory and close the Peer after the request.',
      '桌面应用持有辅助进程，需要沿用自己的端点组装。工厂使用已取得通道的管线，请求结束后关闭连接。'
    ),
    example: spawnOptionsCode(adapter),
    result: t(
      'The request returns `42` and the local name is `desktop`. This managed spawn consumes keyFactory and retryPort for its declared idempotent request. Function sources use direct Core assembly instead. Native process capability warnings may still be reported.',
      '请求返回 `42`，本端名称为 `desktop`。此受管理启动为声明为幂等的请求使用 keyFactory 与 retryPort；函数来源则走直接核心组装。原生进程能力警告仍可能被上报。'
    ),
    covers: [
      'spawn',
      'self',
      'defaultTimeoutMs',
      'endpointFactory',
      'report',
      'keyFactory',
      'retryPort'
    ]
  },
  {
    title: t('Authenticate a named service and protect its frames', '认证命名服务并保护通信帧'),
    problem: t(
      'A same-user local service needs an application credential and signed traffic. Keep one generated secret on both ends, publish an explicit method contract and bound provider concurrency.',
      '同用户本地服务还需要应用凭据与签名通信。双方持有本次生成的密钥，发布明确的方法契约，并限制提供方并发。'
    ),
    example: namedOptionsCode(adapter),
    result: t(
      'Output is `42 true`: the verified connection executes a declared method and the probe observes traffic. The credential and signing key are never printed; the client closes its session before the server closes its listener.',
      '输出为 `42 true`：通过校验的连接执行声明方法，探针观察到通信。凭据与签名密钥不输出；客户端先关闭会话，服务端再关闭监听。'
    ),
    covers: [
      'listen',
      'connect',
      'token',
      'verify',
      'connectTimeoutMs',
      'provide',
      'contract',
      'providerLimits',
      'authentication',
      'probe',
      'self',
      'defaultTimeoutMs',
      'report'
    ]
  }
]

/** Native stdio owns real stderr subscriptions and leaves physical termination with the caller. */
const stdioTransportCode = `import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createProcessPeer, createProcessTransport, createNativeProcessOffer } from '@migaia/rpc-process'
import { createAdapterChildStdio, openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'
import { systemScheduler } from '@migaia/utils/scheduler'
const reports: unknown[] = []
const report = (error: unknown) => { reports.push(error) }
const token = 'public-stdio-example'
if (process.argv.includes('--stdio-child')) {
  await createProcessPeer({
    provide: { double: (value: number) => { console.error('helper completed'); return value * 2 } },
    connect: async ({ self, capabilities }) => {
      const { channel } = await openProcessStdioChannel({ bootstrap: 'none', bootstrapTimeoutMs: 5000 })
      return createProcessTransport(channel, {
        role: 'responder', peerId: 'main',
        offer: createNativeProcessOffer({ peer: { id: self.instanceId, runtime: 'node' }, capabilities }),
        auth: { mode: 'required', verify: (auth) => {
          if (auth !== token) throw new TypeError('invalid credential')
          return 'stdio-owner'
        } },
        ipc: { connectionId: 'helper', sessionId: 'job', log: () => {} }, report
      })
    }
  })
} else {
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--stdio-child'], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exited = once(child, 'close')
  const observedStderr = Promise.withResolvers<void>()
  const original = new Error('diagnostic sink unavailable')
  const names: string[] = []
  let failed = false
  const caller = new AbortController()
  try {
    const peer = await createProcessPeer<{ double(value: number): number }>({
      connect: async ({ self, capabilities }) => createProcessTransport(createAdapterChildStdio(child), {
        role: 'initiator', peerId: 'helper',
        offer: createNativeProcessOffer({ peer: { id: self.instanceId, runtime: 'node' }, auth: token, capabilities }),
        signal: caller.signal, handshakeTimeoutMs: 2000, scheduler: systemScheduler, report,
        ipc: {
          connectionId: 'helper-connection', sessionId: 'job', processId: String(child.pid),
          maxPendingData: 16, maxPendingControl: 4,
          log: (record) => {
            names.push(record.name)
            if (record.name === 'ipc.stderr' && !failed) { failed = true; throw original }
          },
          stderr: (listener) => {
            const onData = (chunk: Buffer) => { listener(chunk); observedStderr.resolve() }
            child.stderr.on('data', onData)
            return () => { child.stderr.off('data', onData) }
          }
        }
      }), report
    })
    try {
      console.log(await peer.request('double', 21))
      await observedStderr.promise
      console.log(names.includes('ipc.stderr'), reports.includes(original))
    } finally { await peer.close() }
  } finally { child.kill(); await exited }
}`

/** Crossed Web Streams are genuine ordered carriers, without a mock handshake or fake agreement. */
const trustedByteCode = `import { createAdapterWebByteIO, createNativeProcessOffer, createProcessPeer, createProcessTransport } from '@migaia/rpc-process'
import { systemScheduler } from '@migaia/utils/scheduler'
const forward = new TransformStream<Uint8Array>()
const backward = new TransformStream<Uint8Array>()
const clientBytes = createAdapterWebByteIO(backward.readable, forward.writable)
const serverBytes = createAdapterWebByteIO(forward.readable, backward.writable)
const report = (error: unknown) => { console.error(error) }
const opening = createProcessPeer<{ echo(value: string): string }>({
  connect: async ({ self, capabilities }) => createProcessTransport(clientBytes, {
    role: 'initiator', peerId: 'helper', scheduler: systemScheduler,
    offer: createNativeProcessOffer({ peer: { id: self.instanceId, runtime: 'web' }, capabilities }),
    ipc: { connectionId: 'local-client', sessionId: 'local', log: () => {} }, report
  }), report
})
const serving = createProcessPeer({
  provide: { echo: (value: string) => value },
  connect: async ({ self, capabilities }) => createProcessTransport(serverBytes, {
    role: 'responder', peerId: 'client', scheduler: systemScheduler,
    offer: createNativeProcessOffer({ peer: { id: self.instanceId, runtime: 'web' }, capabilities }),
    auth: { mode: 'none' },
    ipc: { connectionId: 'local-server', sessionId: 'local', log: () => {} }, report
  }), report
})
const [client, server] = await Promise.all([opening, serving])
try { console.log(await client.request('echo', 'local-only')) }
finally { await client.close(); await server.close() }`

/** Native MessagePorts preserve whole messages and require matching identity profiles. */
const messageTransportCode = `import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createProcessPeer, createProcessTransport, type IProcessMessageChannel } from '@migaia/rpc-process'
const { port1, port2 } = new MessageChannel()
function channel(port: MessagePort): IProcessMessageChannel {
  return {
    kind: 'message', send: (value) => port.postMessage(value),
    onMessage: (listener) => { port.on('message', listener); return () => { port.off('message', listener) } },
    onClose: (listener) => { port.on('close', listener); return () => { port.off('close', listener) } },
    close: () => { port.close() }
  }
}
const report = (error: unknown) => { console.error(error) }
const profile = { codec: 'identity' as const, capabilities: ['runtime-api@1', 'close@1', 'batch@1', 'abort@1', 'wire-error@1'] }
const staticAgreement = { local: profile, peer: profile }
const [client, server] = await Promise.all([
  createProcessPeer<{ double(value: number): number }>({
    self: { name: 'client', instanceId: 'client' },
    connect: async () => createProcessTransport(channel(port1), {
      peerId: 'server', staticAgreement,
      ipc: { connectionId: 'messages-client', sessionId: 'messages', log: () => {} }, report
    }), report
  }),
  createProcessPeer({
    self: { name: 'server', instanceId: 'server' },
    provide: { double: (value: number) => value * 2 },
    connect: async () => createProcessTransport(channel(port2), {
      peerId: 'client', staticAgreement: { local: profile, peer: profile },
      ipc: { connectionId: 'messages-server', sessionId: 'messages', log: () => {} }, report
    }), report
  })
])
try { console.log(await client.request('double', 21)) }
finally { await client.close(); await server.close() }`

/** The three channel configurations have distinct wire and authentication ownership. */
export const processTransportOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t(
      'Authenticate manual stdio and record bounded diagnostics',
      '认证手动标准流并记录有界诊断'
    ),
    problem: t(
      'A caller already launches a helper and must keep ownership of its native process. Explicit byte roles authenticate the inherited pipe; IPC labels and a stderr subscription feed structured diagnostics.',
      '调用方已经启动辅助进程，需要继续持有原生进程。显式字节角色认证继承管道，通信标签与标准错误订阅用于生成结构化诊断。'
    ),
    example: stdioTransportCode,
    result: t(
      'Output is `42`, then `true true`: stderr produces a redacted IPC record and a throwing log sink reaches report with the original Error. The signal and 2000 ms budget apply to setup; the caller terminates and joins the child.',
      '输出为 `42`、`true true`：标准错误生成脱敏通信记录，日志接收端抛错时 report 收到原始错误。信号与 2000 毫秒预算作用于建立连接；调用方终止并等待子进程。'
    ),
    covers: [
      'role',
      'offer',
      'auth',
      'auth.mode',
      'auth.verify',
      'peerId',
      'signal',
      'handshakeTimeoutMs',
      'scheduler',
      'report',
      'ipc',
      'ipc.connectionId',
      'ipc.sessionId',
      'ipc.processId',
      'ipc.maxPendingData',
      'ipc.maxPendingControl',
      'ipc.log',
      'ipc.stderr'
    ]
  },
  {
    title: t(
      'Use no-auth only on an already private local carrier',
      '仅在已私有的本地载体上选择无认证'
    ),
    problem: t(
      'Two in-process Web Stream owners already control both ends. Select none explicitly rather than implying that a routing label authenticates the remote side.',
      '进程内两个网页流拥有者已经控制两端。显式选择无认证，避免把路由标签误当成对端认证。'
    ),
    example: trustedByteCode,
    result: t(
      'The real byte handshake completes and the request returns `local-only`. This configuration intentionally does not verify credentials and is unsuitable for a public listener.',
      '真实字节握手完成，请求返回 `local-only`。此配置有意不验证凭据，不适用于公开监听端。'
    ),
    covers: ['role', 'offer', 'auth', 'auth.mode', 'scheduler', 'peerId', 'ipc', 'report']
  },
  {
    title: t(
      'Keep a native message carrier in identity format',
      '让原生消息载体保持 identity 格式'
    ),
    problem: t(
      'A process bridge exposes complete native messages. Both owners declare identity and the same capability order before activation; a byte codec would not match this carrier.',
      '进程桥接已经提供完整原生消息。两端在激活前声明 identity 以及同序能力；字节编解码器无法匹配此载体。'
    ),
    example: messageTransportCode,
    result: t(
      'The MessagePort request returns `42`. Matching static profiles configure the message path; Core still owns the actual control acknowledgement and accepted directory.',
      '消息端口请求返回 `42`。一致的静态配置设定消息路径；实际控制确认与已接纳目录仍由核心拥有。'
    ),
    covers: [
      'staticAgreement',
      'staticAgreement.local',
      'staticAgreement.peer',
      'staticAgreement.local.codec',
      'staticAgreement.peer.codec',
      'staticAgreement.local.capabilities',
      'staticAgreement.peer.capabilities',
      'peerId',
      'ipc',
      'report'
    ]
  }
]

/** Offers are configuration proposals, never proof of bilateral negotiation. */
export const processOfferOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t('Advertise a streaming helper contract', '声明辅助进程的流契约'),
    problem: t(
      'A helper serves an iterable method. Explicitly advertise stream and the runtime extension, and let the later handshake select common capabilities.',
      '辅助进程提供可迭代方法。显式声明流与运行时扩展，再由后续握手选择共同能力。'
    ),
    example: `import { createNativeProcessOffer } from '@migaia/rpc-process'
const offer = createNativeProcessOffer({
  peer: { id: 'feed-helper', runtime: 'node' }, auth: crypto.randomUUID(),
  stream: true, capabilities: ['runtime-api@1', 'stream@1']
})
console.log(offer.capabilities.includes('stream@1'))
console.log(offer.capabilities.filter(value => value === 'stream@1').length)`,
    result: t(
      'Output is `true` and `1`: stream is present once after deduplication. The secret remains unprinted; the offer alone has not authenticated another process.',
      '输出为 `true`、`1`：去重后流能力只出现一次。密钥不输出，单凭提议尚未认证其他进程。'
    ),
    covers: ['peer', 'auth', 'stream', 'capabilities']
  },
  {
    title: t('Keep a scalar-only proposal narrow', '保持仅标量调用的窄提议'),
    problem: t(
      'A small local helper exposes no streams or automatic extensions. Disable stream and supply an explicit empty extension list.',
      '小型本地辅助进程不提供流或自动扩展。禁用流，并显式传入空扩展列表。'
    ),
    example: `import { createNativeProcessOffer } from '@migaia/rpc-process'
const offer = createNativeProcessOffer({ peer: { id: 'scalar-helper', runtime: 'node' }, stream: false, capabilities: [] })
console.log(offer.capabilities.join(','), Object.isFrozen(offer))`,
    result: t(
      'Output is `ping@1,close@1,batch@1 true`: only the base controls remain. Omission of capabilities has a different meaning: it allows runtime-default completion.',
      '输出为 `ping@1,close@1,batch@1 true`，只保留基础控制能力。省略 capabilities 则不同，仍允许运行时补全默认扩展。'
    ),
    covers: ['peer', 'stream', 'capabilities']
  }
]

/** A native launch wrapper reads the original Core proposal, including its issued generation. */
const launcherOptionsCode = (
  module: string,
  factory: string
): string => `import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'
import { ${factory}, type ${module === 'deno-command' ? 'IDenoProcessHandle' : module === 'bun-spawn' ? 'IBunProcessHandle' : 'INodeProcessHandle'} } from '@migaia/rpc-process/adapters/${module}'
import { holdAdapterLaunch } from '@migaia/rpc-core/adapter/internal-advanced'
import type { IProcessLauncher } from '@migaia/supervision/process'
type IHandle = ${module === 'deno-command' ? 'IDenoProcessHandle' : module === 'bun-spawn' ? 'IBunProcessHandle' : 'INodeProcessHandle'}
${module === 'deno-command' ? "if (!Reflect.has(globalThis, 'Deno')) { console.log('Deno.Command required') } else " : ''}if (isProcessChild()) {
  await createProcessPeer({ provide: { answer: () => 42 } })
} else {
  const native = ${factory}()
  const launcher: IProcessLauncher<IHandle> = {
    capabilities: native.capabilities,
    launch: (spec, context) => {
      const proposal = holdAdapterLaunch(context).proposal
      if (!proposal) throw new TypeError('Core launch context required')
      const runtimeApiBootstrap = {
        name: proposal.childName ?? proposal.self.name,
        parentInstanceId: proposal.self.instanceId,
        generation: proposal.generation
      }
      console.log(runtimeApiBootstrap.name, runtimeApiBootstrap.generation?.kind)
      return ${factory}({ runtimeApiBootstrap }).launch(spec, context)
    }
  }
  const peer = await createProcessPeer<{ answer(): number }>({
    self: { name: 'desktop', instanceId: crypto.randomUUID() },
    spawn: { entry: new URL(import.meta.url), ${module === 'deno-command' ? "wrap: command => ({ ...command, args: [command.args[0]!, '--node-modules-dir=manual', ...command.args.slice(1)] }), " : ''}supervision: { id: 'helper', launcher } }
  })
  try { console.log(await peer.request('answer')) }
  finally { await peer.close() }
}`

/** Bootstrap validation precedes native acquisition, including Deno-only acquisition. */
const invalidBootstrapCode = (
  module: string,
  factory: string
): string => `import { ${factory} } from '@migaia/rpc-process/adapters/${module}'
const launcher = ${factory}({ runtimeApiBootstrap: {
  name: 'helper', parentInstanceId: crypto.randomUUID()
} })
try {
  await launcher.launch({
    command: process.execPath, args: [], env: { inherit: [], set: {} },
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
  }, { signal: new AbortController().signal, output: () => {} })
} catch (error) {
  const failure = error as Error & { code?: string }
  if (failure.code !== 'INVALID_CONFIG') throw error
  console.log(failure.code)
}`

/** Launcher construction stays lazy; only the full launch can supply an execution generation. */
export const processLauncherOptionCases = (
  module: string,
  factory: string
): readonly IOptionCaseDoc[] => [
  {
    title: t('Forward the owning runtime launch identity', '转发所属运行时的启动身份'),
    problem: t(
      'An application wraps a native launcher. Copy bootstrap fields from the exact Core launch request, including its real generation, rather than inventing a restart counter.',
      '应用包装原生启动器时，应从同一个核心启动请求取得引导字段及真实代次，不能自建重启计数。'
    ),
    example: launcherOptionsCode(module, factory),
    result: t(
      module === 'deno-command'
        ? 'Under Deno the wrapper prints `helper restart` and the request returns `42`. Bun prints `Deno.Command required` without pretending to spawn through Deno. The second scenario still exercises early validation under Bun.'
        : 'The wrapper prints `helper restart` and the child request returns `42`. The held context supplies identity before the explicit override; capability diagnostics remain observable.',
      module === 'deno-command'
        ? '在 Deno 下，包装器输出 `helper restart`，请求返回 `42`。Bun 输出 `Deno.Command required`，不会声称已经通过 Deno 启动；第二个场景仍可在 Bun 下执行前置校验。'
        : '包装器输出 `helper restart`，子进程请求返回 `42`。持有的上下文优先提供身份，显式覆盖不能替换它，能力诊断仍可被观察。'
    ),
    covers: [
      'runtimeApiBootstrap',
      'runtimeApiBootstrap.name',
      'runtimeApiBootstrap.parentInstanceId',
      'runtimeApiBootstrap.generation'
    ]
  },
  {
    title: t('Reject bootstrap without the required pipes', '缺少必需管道时拒绝引导配置'),
    problem: t(
      'A deployment accidentally ignores stdin and stdout while requesting runtime bootstrap. Reject before creating a process instead of silently losing the first secret frame.',
      '部署请求运行时引导，却错误地忽略标准输入输出。应在创建进程前拒绝，不能静默丢失首个敏感帧。'
    ),
    example: invalidBootstrapCode(module, factory),
    result: t(
      'Output is `INVALID_CONFIG`; no native child is created. Explicit runtime bootstrap requires stdin bootstrap plus channel-mode stdin and stdout.',
      '输出为 `INVALID_CONFIG`，不创建原生子进程。显式运行时引导需要标准输入引导，以及通道模式的标准输入输出。'
    ),
    covers: [
      'runtimeApiBootstrap',
      'runtimeApiBootstrap.name',
      'runtimeApiBootstrap.parentInstanceId'
    ]
  }
]

/** The helper prepares an actual launch, while native Node owns spawning and pipe creation. */
const launchPreparationCode = (web: boolean): string => `import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { createProcessPeer, isProcessChild, ${web ? 'createAdapterProcessLaunch, ' : ''}PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION, type IProcessByteChannel } from '@migaia/rpc-process'
import { createNodeProcessLauncher${web ? '' : ', createAdapterNodeProcessLaunch'} } from '@migaia/rpc-process/adapters/node-child-process'
import { holdAdapterLaunch } from '@migaia/rpc-core/adapter/internal-advanced'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import type { IProcessHandle, IProcessLauncher } from '@migaia/supervision/process'
type IHandle = IProcessHandle & { channel: IProcessByteChannel; runtimeApiIdentity: { name: string; instanceId: string } }
if (isProcessChild()) {
  await createProcessPeer({ provide: { answer: () => 42 } })
} else {
  const launcher: IProcessLauncher<IHandle> = {
    capabilities: createNodeProcessLauncher().capabilities,
    launch: async (spec, context) => {
      const proposal = holdAdapterLaunch(context).proposal
      if (!proposal) throw new TypeError('Core launch context required')
      const operation = ${web ? 'createAdapterProcessLaunch' : 'createAdapterNodeProcessLaunch'}(spec, context, { runtimeApiBootstrap: {
        name: proposal.childName ?? proposal.self.name, parentInstanceId: proposal.self.instanceId,
        generation: proposal.generation
      } })
      operation.assertActive()
      const bootstrap = operation.bootstrap!
      const inherited = Object.fromEntries(spec.env.inherit.map(key => [key, process.env[key]]))
      const child = spawn(spec.command, [...spec.args], {
        env: { ...inherited, ...spec.env.set, [PROCESS_RUNTIME_API_ENV]: PROCESS_RUNTIME_API_ENV_VERSION },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal }))
      })
      child.stderr.on('data', (chunk: Buffer) => context.output('stderr', chunk))
      const onAbort = () => { child.kill('SIGKILL') }
      context.signal.addEventListener('abort', onAbort, { once: true })
      void exited.finally(() => context.signal.removeEventListener('abort', onAbort))
      try {
        await new Promise<void>((resolve, reject) => child.stdin.write(encodeRpcStreamFrame(bootstrap.payload), error => error ? reject(error) : resolve()))
        operation.assertActive()
        return {
          identity: { fingerprint: bootstrap.self.instanceId, pid: child.pid },
          runtimeApiIdentity: bootstrap.self, exited,
          channel: ${web ? 'operation.createWebChannel(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, Writable.toWeb(child.stdin) as WritableStream<Uint8Array>)' : 'operation.createChildChannel(child)'},
          terminate: (mode) => { child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM') }
        }
      } catch (error) { child.kill('SIGKILL'); await exited; throw error }
    }
  }
  const peer = await createProcessPeer<{ answer(): number }>({ spawn: {
    entry: new URL(import.meta.url), supervision: { id: 'prepared-helper', launcher }
  } })
  try { console.log(await peer.request('answer')) }
  finally { await peer.close() }
}`

/** Invalid preparation has no native side effects, unlike the successful custom-launch story. */
const invalidPreparationCode = (
  web: boolean
): string => `import { ${web ? 'createAdapterProcessLaunch' : 'PROCESS_RUNTIME_API_ENV'} } from '@migaia/rpc-process'
${web ? '' : "import { createAdapterNodeProcessLaunch } from '@migaia/rpc-process/adapters/node-child-process'"}
try {
  ${web ? 'createAdapterProcessLaunch' : 'createAdapterNodeProcessLaunch'}({
    command: process.execPath, args: [], env: { inherit: [], set: {} },
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
  }, { signal: new AbortController().signal, output: () => {} }, {
    runtimeApiBootstrap: { name: 'helper', parentInstanceId: crypto.randomUUID() }
  })
} catch (error) {
  const failure = error as Error & { code?: string }
  if (failure.code !== 'INVALID_CONFIG') throw error
  console.log(failure.code)
}`

/** Custom launchers use real pipe handles, without asking preparation to spawn a process. */
export const processLaunchPreparationCases = (web = false): readonly IOptionCaseDoc[] => [
  {
    title: t(
      'Prepare bootstrap once before a custom native launch',
      '自定义原生启动前只准备一次引导'
    ),
    problem: t(
      'A custom launcher owns spawning but needs the standard bootstrap identity and carrier construction. Use the original Core request and write exactly the prepared payload before protocol traffic.',
      '自定义启动器负责创建进程，但需要标准引导身份与通道构造。使用原始核心请求，在协议通信前准确写入准备好的载荷。'
    ),
    example: launchPreparationCode(web),
    result: t(
      'The real helper answers `42`. The same prepared self identity becomes the handle fingerprint and runtime identity; the supervisor owns termination and waiting.',
      '真实辅助进程返回 `42`。同一个准备好的自身身份成为句柄指纹与运行时身份，监督器拥有终止与等待。'
    ),
    covers: [
      'runtimeApiBootstrap',
      'runtimeApiBootstrap.name',
      'runtimeApiBootstrap.parentInstanceId',
      'runtimeApiBootstrap.generation'
    ]
  },
  {
    title: t('Validate the pipe contract before spawning', '创建进程前校验管道契约'),
    problem: t(
      'A custom launcher receives an incompatible stdio spec. Preparation should fail before the caller acquires any native child.',
      '自定义启动器收到不兼容的标准流规格，应在调用方取得原生子进程前由准备阶段拒绝。'
    ),
    example: invalidPreparationCode(web),
    result: t(
      'Output is `INVALID_CONFIG`. Preparation itself has no spawned process to clean up.',
      '输出为 `INVALID_CONFIG`；准备操作本身没有已启动进程需要清理。'
    ),
    covers: [
      'runtimeApiBootstrap',
      'runtimeApiBootstrap.name',
      'runtimeApiBootstrap.parentInstanceId'
    ]
  }
]

/** The parent writes one real framed prefix; each child opens only its own standard streams. */
const stdioBootstrapCode = (
  module: string,
  mode: 'stdin' | 'none',
  reader = false
): string => `import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
${reader ? "import { receiveAdapterBootstrap } from '@migaia/rpc-process'\nimport { createAdapterProcessStdio } from '@migaia/rpc-process/adapters/node-child-process'" : `import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/${module}'`}
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { systemScheduler } from '@migaia/utils/scheduler'
if (process.argv.includes('--bootstrap-child')) {
  const result = await ${reader ? `receiveAdapterBootstrap(createAdapterProcessStdio(process), '${mode}', { bootstrapTimeoutMs: 2000, scheduler: systemScheduler })` : `openProcessStdioChannel({ bootstrap: '${mode}', bootstrapTimeoutMs: 2000 })`}
  console.error(${mode === 'stdin' ? "new TextDecoder().decode(result.bootstrap) === 'configuration'" : 'result.bootstrap === undefined'})
  await result.channel.close()
} else {
  const entry = fileURLToPath(import.meta.url)
  const child = spawn(${module === 'deno-command' ? "'deno', ['run', '--allow-all', '--node-modules-dir=manual', entry, '--bootstrap-child']" : "process.execPath, [...process.execArgv, entry, '--bootstrap-child']"}, {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let result = ''
  child.stdout.resume()
  child.stderr.on('data', (chunk: Buffer) => { result += chunk.toString() })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve(code))
  })
  ${mode === 'stdin' ? "child.stdin.end(encodeRpcStreamFrame(new TextEncoder().encode('configuration')))" : 'child.stdin.end()'}
  console.log(await exited, result.trim())
}`

/** The fd branch rejects before touching either runtime's current stdio. */
const fdBootstrapCode = (
  module: string
): string => `import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/${module}'
try { await openProcessStdioChannel({ bootstrap: 'fd', fd: 3, bootstrapTimeoutMs: 1000 }) }
catch (error) {
  const failure = error as Error & { code?: string }
  if (failure.code !== 'INVALID_CONFIG') throw error
  console.log(failure.code)
}`

/** Child bootstrap selection is separate from later handshake and method-call deadlines. */
export const processStdioOptionCases = (
  module = 'node-child-process'
): readonly IOptionCaseDoc[] => [
  {
    title: t('Consume the parent prefix before handing off the pipe', '交接管道前消费父进程前缀'),
    problem: t(
      'A manually launched helper expects one framed configuration before RPC. Give the first-frame read its own budget without claiming it limits later calls.',
      '手动启动的辅助进程在远程调用前需要一个分帧配置。为首帧读取设置独立预算，不把它说成后续调用期限。'
    ),
    example: stdioBootstrapCode(module, 'stdin'),
    result: t(
      'Output is `0 true`: the real child receives the prefix and closes its channel. The parent writes exactly one length-prefixed frame; application logs use stderr.',
      '输出为 `0 true`：真实子进程收到前缀并关闭通道。父进程只写入一个长度前缀帧，应用日志使用标准错误。'
    ),
    covers: ['bootstrap', 'bootstrapTimeoutMs']
  },
  {
    title: t('Open a pipe with no bootstrap prefix', '打开没有引导前缀的管道'),
    problem: t(
      'The caller will begin the protocol directly and writes no bootstrap frame. Select none so setup does not wait for a nonexistent prefix.',
      '调用方直接开始协议，不写入引导帧。选择 none，避免建立连接时等待不存在的前缀。'
    ),
    example: stdioBootstrapCode(module, 'none'),
    result: t(
      'Output is `0 true`; no bootstrap bytes are returned. The explicit budget does not cause none mode to read a frame.',
      '输出为 `0 true`，不返回引导字节。显式预算不会让 none 模式读取一帧。'
    ),
    covers: ['bootstrap', 'bootstrapTimeoutMs']
  },
  {
    title: t('Handle the declared but unsupported fd mode', '处理已声明但不支持的文件描述符模式'),
    problem: t(
      'A shared launcher configuration selects a dedicated fd. These public openers support stdin or none only, so fail visibly instead of reading another descriptor.',
      '共用启动配置选择独立文件描述符，但这些公开读取函数仅支持标准输入或无前缀，应明确失败，不能读取其他描述符。'
    ),
    example: fdBootstrapCode(module),
    result: t(
      'Output is `INVALID_CONFIG` before stdio acquisition. Supplying fd does not make this declared mode supported.',
      '取得标准流前输出 `INVALID_CONFIG`。提供 fd 字段不会让已声明的模式变成受支持功能。'
    ),
    covers: ['bootstrap', 'fd', 'bootstrapTimeoutMs']
  }
]

/** The lower-level reader uses the same native pipes plus a caller-owned scheduler. */
export const processBootstrapReaderCases: readonly IOptionCaseDoc[] = ['stdin', 'none'].map(
  (mode) => ({
    title:
      mode === 'stdin'
        ? t('Bound the first frame on an existing channel', '限制已有通道上的首帧等待')
        : t('Retain an existing channel without a prefix read', '保留已有通道而不读取前缀'),
    problem:
      mode === 'stdin'
        ? t(
            'A custom stdio adapter already owns the byte channel. Borrow its scheduler for the first frame and retain the same channel for later protocol setup.',
            '自定义标准流适配器已经持有字节通道。借用调度器等待首帧，后续协议建立仍使用原通道。'
          )
        : t(
            'An existing channel starts directly with protocol bytes. Explicit none mode returns it without installing a bootstrap read.',
            '已有通道直接从协议字节开始。显式无前缀模式返回原通道，不安装引导读取。'
          ),
    example: stdioBootstrapCode('node-child-process', mode as 'stdin' | 'none', true),
    result: t(
      'Output is `0 true`: the child selects the intended read policy and releases its own channel. The 2000 ms timeout only belongs to the optional first-frame read.',
      '输出为 `0 true`：子进程选择预期读取策略并释放自身通道。2000 毫秒超时只属于可选的首帧读取。'
    ),
    covers: ['bootstrapTimeoutMs', 'scheduler']
  })
)

/** Authentication uses an actual local socket selected by the operating system. */
const socketDialCode = (module: string, cancel: boolean): string =>
  cancel
    ? `import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/${module}'
const caller = new AbortController()
const reason = new Error('view closed')
caller.abort(reason)
try { await dialProcessByteChannel({ address: 'tcp://127.0.0.1:0', signal: caller.signal }) }
catch (error) { console.log(error === reason || (error as Error).cause === reason) }`
    : `import { createProcessPeer, createProcessTransport, createNativeProcessOffer } from '@migaia/rpc-process'
import { dialProcessByteChannel, listenProcessByteChannel } from '@migaia/rpc-process/adapters/${module}'
const token = crypto.randomUUID()
const report = (error: unknown) => { console.error(error) }
const accepted = Promise.withResolvers<Awaited<ReturnType<typeof createProcessPeer>>>()
const listener = await listenProcessByteChannel({
  address: 'tcp://127.0.0.1:0',
  auth: { mode: 'required', verify: (auth) => {
    if (auth !== token) throw new TypeError('invalid credential')
    return 'desktop-account'
  } }, report,
  onConnection: async (pending) => {
    try {
      const peer = await createProcessPeer({
        self: { name: 'server', instanceId: 'server' }, provide: { answer: () => 42 }, report,
        connect: async ({ capabilities }) => (await pending.accept({
          peerId: 'client', offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' }, capabilities }),
          ipc: { connectionId: 'accepted', sessionId: 'local', log: () => {} }, report
        })).channel
      })
      accepted.resolve(peer)
    } catch (error) { accepted.reject(error); throw error }
  }
})
try {
  const caller = new AbortController()
  const client = await createProcessPeer<{ answer(): number }>({
    self: { name: 'client', instanceId: 'client' }, report,
    connect: async ({ capabilities }) => createProcessTransport(await dialProcessByteChannel({ address: listener.address, signal: caller.signal }), {
      role: 'initiator', peerId: 'server',
      offer: createNativeProcessOffer({ peer: { id: 'client', runtime: 'node' }, auth: token, capabilities }),
      ipc: { connectionId: 'dialed', sessionId: 'local', log: () => {} }, report
    })
  })
  const server = await accepted.promise
  try { console.log(await client.request('answer')) }
  finally { await client.close(); await server.close() }
} finally { await listener.close() }`

/** Dial-only cancellation does not transfer ownership of an established remote process. */
export const processDialOptionCases = (module: string): readonly IOptionCaseDoc[] => [
  {
    title: t('Dial an authenticated loopback listener', '连接已认证的回环监听端'),
    problem: t(
      'A running local service should accept a client without hard-coding an available port. Dial the listener’s actual address and keep the client abort signal scoped to dialing.',
      '运行中的本地服务需要接纳客户端，不能硬编码可用端口。使用监听器真实地址拨号，把客户端中止信号限定在拨号阶段。'
    ),
    example: socketDialCode(module, false),
    result: t(
      'The authenticated request returns `42`. Closing the client and server sessions precedes closing the listener; no remote process is terminated by dialing.',
      '通过认证的请求返回 `42`。先关闭客户端与服务端会话，再关闭监听器；拨号不会终止远端进程。'
    ),
    covers: ['address', 'signal']
  },
  {
    title: t('Cancel a dial after its caller has already left', '调用方已离开时取消拨号'),
    problem: t(
      'A view is gone before a local connection starts. Pass its already-aborted signal so the adapter does not open a socket for obsolete work.',
      '本地连接开始前页面已经关闭。传入已经中止的信号，避免适配器为过期任务打开套接字。'
    ),
    example: socketDialCode(module, true),
    result: t(
      'Output is `true`: cancellation preserves the original reason directly or as its cause. No listener or remote process is required.',
      '输出为 `true`：取消保留原始原因，直接返回或置于 cause。此场景不需要监听器或远端进程。'
    ),
    covers: ['address', 'signal']
  }
]

/** Real session projections expose the selected shared replay owner and concurrency policy. */
const resilienceLimitsCode = `import { createProcessResilience } from '@migaia/rpc-process'
import { createRpcIdempotencyStore } from '@migaia/rpc-core'
import { systemScheduler } from '@migaia/utils/scheduler'
const store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 128 })
const reports: unknown[] = []
const governor = createProcessResilience({
  scheduler: systemScheduler, report: error => { reports.push(error) }, idempotencyStore: store,
  maxConnections: 8, maxConcurrentCallsPerConnection: 4, maxCallsPerMinute: 120,
  maxPayloadBytes: 65536, maxConsecutiveTimeouts: 2, idleTimeoutMs: 15000, drainMs: 1000,
  reportAtMs: [0, 1000, 5000], unhandledLimit: 2, liquidation: { cascade: false }
})
try {
  const first = governor.sessionOptions({ connectionId: 'one', sessionId: 'login-one', principalId: 'account-A' })
  const next = governor.sessionOptions({ connectionId: 'two', sessionId: 'login-two', principalId: 'account-A' })
  const context = { token: 'operation', senderId: 'client' }
  console.log(first.idempotency.store === store, first.limits.maxGlobal, first.limits.maxPerPeer)
  console.log(first.idempotency.scope!(context) === next.idempotency.scope!(context))
} finally { await governor.close() }`

/** Terminal policy acts on a real supervised exit and a real dependent Host registration. */
const liquidationCode = (
  cascade: boolean
): string => `import { setImmediate } from 'node:timers/promises'
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { createProcessResilience } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'
const removed = Promise.withResolvers<void>()
let dependentDisposed = false
const service = definePlugin({
  name: 'service', features: { api: defineFeature(() => ({ read: () => 42 })) },
  install: () => ({}), dispose: () => { removed.resolve() }
})
const dependent = definePlugin({
  name: 'dependent', features: { api: defineFeature((_core, deps) => ({ read: () => deps.base.read() }), { base: service.getFeature('api') }) },
  install: () => ({}), dispose: () => { dependentDisposed = true }
})
const host = defineHost<Record<string, never>, never, readonly [typeof service, typeof dependent]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
const reports: unknown[] = []
const report = (error: unknown) => { reports.push(error) }
const supervisor = createProcessSupervisor({
  id: 'service', launcher: createNodeProcessLauncher(),
  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }), scheduler: systemScheduler,
  report, isolation: 'best-effort', restart: { mode: 'never' },
  spec: { command: process.execPath, args: ['-e', 'process.exit(1)'], env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' } }
})
const governor = createProcessResilience({
  scheduler: systemScheduler, report, reportAtMs: [0, 1], unhandledLimit: 1,
  liquidation: { cascade: ${cascade} }
})
try {
  const [, handle] = await host.use(service, dependent)
  governor.attachRegistration('service', {
    ownership: 'spawn-owned', health: 'none', supervisor: {
      restart: () => supervisor.restart(), inspect: () => supervisor.inspect(), dispose: () => supervisor.dispose(),
      onTerminal: listener => supervisor.subscribe(event => { if (event.type === 'terminal') listener(event) })
    }
  }, { kind: 'proxy-plugin', name: 'service', host })
  await supervisor.start()
  await removed.promise
  await setImmediate()
  console.log(governor.inspect('service')?.liquidated, dependentDisposed)
  try { handle.getFeature('api').read() }
  catch (error) { console.log((error as Error & { code?: string }).code) }
  console.log(reports.some(error => (error as { code?: string })?.code === 'PROCESS_TERMINAL_CALL'))
} finally { await governor.close(); await supervisor.dispose(); await host.dispose() }`

/** Session limits and terminal dependency policy remain separate application decisions. */
export const processResilienceOptionCases: readonly IOptionCaseDoc[] = [
  {
    title: t('Share replay storage with a bounded session policy', '共享重放存储并限制会话策略'),
    problem: t(
      'A daemon needs a selected replay store and smaller connection, call and payload budgets. Build one governor and derive session options only after authenticating a stable principal.',
      '守护进程需要指定重放存储，以及较小的连接、调用和载荷预算。创建一个治理对象，仅在认证稳定主体后派生会话配置。'
    ),
    example: resilienceLimitsCode,
    result: t(
      'Output is `true 4 4` and `true`: the governor borrows the selected store, projects concurrency four and keeps one principal’s scope across connections. The other configured admission and retirement limits are not triggered by this projection-only example.',
      '输出为 `true 4 4`、`true`：治理对象借用指定存储，投影并发四，并在连接变化后保持同一主体的范围。此例仅派生配置，不触发其余接纳与退出限制。'
    ),
    covers: [
      'scheduler',
      'report',
      'idempotencyStore',
      'maxConnections',
      'maxConcurrentCallsPerConnection',
      'maxCallsPerMinute',
      'maxPayloadBytes',
      'maxConsecutiveTimeouts',
      'idleTimeoutMs',
      'drainMs',
      'reportAtMs',
      'unhandledLimit',
      'liquidation',
      'liquidation.cascade'
    ]
  },
  ...[false, true].map((cascade) => ({
    title: cascade
      ? t('Remove dependent registrations after terminal liquidation', '终态清算时移除依赖登记')
      : t('Retain and suspend dependants after terminal liquidation', '终态清算时保留并挂起依赖方'),
    problem: cascade
      ? t(
          'An unrecoverable service and its dependent should release together. Use cascade with the actual installing Host, after bounded unhandled reports.',
          '无法恢复的服务及其依赖方需要一并释放。使用实际安装宿主，在有限次未处理上报后执行级联清算。'
        )
      : t(
          'An unrecoverable service should be removed while its dependent resources remain retained. Keep cascade false and let the original Host suspend the dependant.',
          '无法恢复的服务应被移除，但依赖方资源仍需保留。保持 cascade 为假，让原宿主挂起依赖方。'
        ),
    example: liquidationCode(cascade),
    result: cascade
      ? t(
          'Output includes `true true`, `PLUGIN_NOT_INSTALLED`, `false`: the real child exits, the second unhandled report liquidates, and the Host releases the dependent. Capability warnings remain diagnostics.',
          '输出包含 `true true`、`PLUGIN_NOT_INSTALLED`、`false`：真实子进程退出，第二次未处理上报触发清算，宿主释放依赖方。能力警告仍属于诊断。'
        )
      : t(
          'Output includes `true false`, `PLUGIN_SUSPENDED`, `true`: the second unhandled report liquidates the service while the dependent remains suspended until final Host cleanup.',
          '输出包含 `true false`、`PLUGIN_SUSPENDED`、`true`：第二次未处理上报清算服务，依赖方仍被挂起，直到最后释放宿主。'
        ),
    covers: [
      'scheduler',
      'report',
      'reportAtMs',
      'unhandledLimit',
      'liquidation',
      'liquidation.cascade'
    ]
  }))
]

/** Managed PluginHost installation uses canonical endpoint admission for its shared process slot. */
const pluginSpawnCode = (
  adapter: boolean
): string => `import { defineHost } from '@migaia/plugin-host'
import { createProcessPeer, createProcessPlugin, ${adapter ? 'createAdapterProcessPlugin, PROCESS_RUNTIME_API_ENV, ' : ''}isProcessChild } from '@migaia/rpc-process'
${adapter ? "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n" : ''}
${adapter ? loaderCode : ''}
if (isProcessChild()) {
  await createProcessPeer({ provide: { answer: () => 42 } })
} else {
  const service = ${adapter ? 'createAdapterProcessPlugin' : 'createProcessPlugin'}<{ answer(): number }>({
    name: 'service', spawn: true, defaultTimeoutMs: 2000,
    self: { name: 'desktop', instanceId: crypto.randomUUID() },
    provide: { parent: { label: () => 'desktop' } }, expose: [],
    report: (error) => { console.error(error) }
  }${adapter ? ', runtime' : ''})
  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try { await host.use(service); console.log(await host.process!.request('service', 'answer')) }
  finally { await host.dispose() }
}`

/** The same shared frame-protection configuration is installed through actual runtime plugins. */
const pluginNamedCode = (adapter: boolean): string =>
  namedOptionsCode(adapter)
    .replace(
      'import { createProcessPeer',
      'import { createProcessPlugin, type IRuntimeProcessPeerOptions, createProcessPeer'
    )
    .replace(
      'import { defineProbe }',
      "import { defineHost } from '@migaia/plugin-host'\nimport { defineProbe }"
    )
    .replace(
      adapter ? ', createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV' : 'createProcessPeer }',
      adapter ? ', createAdapterProcessPlugin, PROCESS_RUNTIME_API_ENV' : 'createProcessPeer }'
    )
    .replaceAll('}, runtime)', '})')
    .replace(
      'const name = ',
      `async function open(options: IRuntimeProcessPeerOptions) {
  const plugin = ${adapter ? 'createAdapterProcessPlugin' : 'createProcessPlugin'}<{ math: { double(value: number): number } }>({ name: 'bridge', ...options }${adapter ? ', runtime' : ''})
  const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
  await host.use(plugin)
  return { request: (method: 'math.double', value: number) => host.process!.request('bridge', method, value), close: async () => { await host.dispose() } }
}
const name = `
    )
    .replaceAll(
      adapter ? 'await createAdapterProcessPeer' : 'await createProcessPeer',
      'await open'
    )
    .replace('await open<{ math: { double(value: number): number } }>', 'await open')

/** Catalog admission and resolver execution use the same actual installing Host. */
const hostControlOptionsCode = (
  adapter: boolean
): string => `import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createProcessPeer, createProcessPlugin, createProcessTransport, ${adapter ? 'createAdapterProcessPlugin, PROCESS_RUNTIME_API_ENV, ' : ''}type IProcessMessageChannel } from '@migaia/rpc-process'
import { RemoteMethodName, type IRemoteHostCatalog } from '@migaia/rpc-core/remote'
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
${adapter ? "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'" : ''}
${adapter ? loaderCode : ''}
function carrier(port: MessagePort): IProcessMessageChannel {
  return { kind: 'message', send: value => port.postMessage(value),
    onMessage: listener => { port.on('message', listener); return () => { port.off('message', listener) } },
    onClose: listener => { port.on('close', listener); return () => { port.off('close', listener) } },
    close: () => { port.close() }
  }
}
const report = (error: unknown) => { console.error(error) }
const ports = new MessageChannel()
const business = definePlugin({ name: 'math',
  features: { api: defineFeature(() => ({ double: (value: number) => value * 2 })) }, install: () => ({})
})
const catalog: IRemoteHostCatalog = { math: { schemaVersion: 1, plugin: 'math', features: {
  api: { methods: { double: { mode: 'request', idempotent: true } } }
} } }
const host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
type IControlApi = { migaia: { remote: { host: {
  inspect(args: []): { plugins: unknown[] }
  use(args: [string]): { name: string; state: string }
} } } }
const caller = createProcessPeer<IControlApi>({ self: { name: 'controller', instanceId: 'controller' }, report,
  connect: async ({ capabilities }) => createProcessTransport(carrier(ports.port2), {
    peerId: 'host', staticAgreement: { local: { codec: 'identity', capabilities }, peer: { codec: 'identity', capabilities } },
    ipc: { connectionId: 'controller', sessionId: 'control', log: () => {} }, report
  })
})
void caller.catch(() => {})
let resolutions = 0
const link = ${adapter ? 'createAdapterProcessPlugin' : 'createProcessPlugin'}({
  name: 'control-link', self: { name: 'host', instanceId: 'host' }, expose: ['host'], host, catalog,
  resolvePlugin: name => {
    if (name !== 'math') throw new TypeError('unknown catalog entry')
    resolutions++; return business
  },
  connect: async ({ capabilities }) => createProcessTransport(carrier(ports.port1), {
    peerId: 'controller', staticAgreement: { local: { codec: 'identity', capabilities }, peer: { codec: 'identity', capabilities } },
    ipc: { connectionId: 'host', sessionId: 'control', log: () => {} }, report
  }), report
}${adapter ? ', runtime' : ''})
try {
  await host.use(link)
  const remote = await caller
  const before = await remote.request(RemoteMethodName.hostInspect, []) as { plugins: unknown[] }
  console.log(before.plugins.length)
  const installed = await remote.request(RemoteMethodName.hostUse, ['math']) as { name: string; state: string }
  console.log(installed.state, installed.name)
  const after = await remote.request(RemoteMethodName.hostInspect, []) as { plugins: unknown[] }
  console.log(after.plugins.length, resolutions)
} finally {
  await host.dispose(); ports.port1.close(); ports.port2.close(); await (await caller).close()
}`

/** Runtime plugin cases cover actual source installation, while full deployment has its own owner. */
export const processRuntimePluginOptionCases = (adapter = false): readonly IOptionCaseDoc[] => [
  {
    title: t(
      'Install an owned child into the shared process outlet',
      '把持有的子进程安装到共用进程出口'
    ),
    problem: t(
      'An application wants Host disposal to release an auxiliary process. Register one named cold plugin, publish parent methods explicitly and keep host exposure empty.',
      '应用希望由宿主释放辅助进程。登记一个有名称的冷插件，显式发布父端方法，并保持宿主暴露列表为空。'
    ),
    example: pluginSpawnCode(adapter),
    result: t(
      'The Host process request returns `42`; disposal owns this child. The local self identity is configured separately from credentials and provided methods.',
      '宿主进程请求返回 `42`，释放宿主负责回收此子进程。本端身份配置与凭据、已提供方法彼此独立。'
    ),
    covers: ['name', 'spawn', 'defaultTimeoutMs', 'self', 'provide', 'expose', 'report']
  },
  {
    ...processPeerOptionCases(adapter)[1]!,
    title: t(
      'Install authenticated named-service plugins on two Hosts',
      '在两个宿主安装已认证的命名服务插件'
    ),
    example: pluginNamedCode(adapter),
    covers: [
      'name',
      'listen',
      'connect',
      'token',
      'verify',
      'connectTimeoutMs',
      'provide',
      'contract',
      'providerLimits',
      'authentication',
      'probe',
      'self',
      'defaultTimeoutMs',
      'report'
    ]
  },
  {
    title: t('Expose only catalog-approved Host installation', '仅暴露目录批准的宿主安装'),
    problem: t(
      'A private controller may install a known local plugin through this process bridge. Explicitly expose host and give the same installing Host its catalog and local resolver.',
      '私有控制端可以通过进程桥接安装已知本地插件。显式暴露宿主入口，并为实际安装宿主提供目录及本地解析器。'
    ),
    example: hostControlOptionsCode(adapter),
    result: t(
      'Output is `0`, `enabled math`, then `1 1`: the caller reads an empty catalog state, installs the approved local definition and invokes the resolver once. The MessagePorts are real private carriers; this example does not claim to spawn a process.',
      '输出为 `0`、`enabled math`、`1 1`：调用方读取空安装状态，安装批准的本地定义，解析器执行一次。消息端口是真实私有载体，此例不声称启动进程。'
    ),
    covers: ['name', 'connect', 'self', 'expose', 'host', 'catalog', 'resolvePlugin', 'report']
  }
]

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

/** A complete local responder uses the published framing contract and the real bridge handshake. */
const jsonRpcOptionsCode = (
  objectMode: boolean,
  hostMode: boolean
): string => `import { createServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { encodeJsonRpcFrame, createJsonRpcFrameDecoder } from '@migaia/rpc-contract/framing/jsonrpc'
import { RpcProtocol } from '@migaia/rpc-contract'
import { createProcessPeer, createProcessJsonRpcChannel, openProcessObjectChannel,
  createProcessChannelClosedError, type IProcessJsonRpcChannelOptions } from '@migaia/rpc-process'
import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'
import { createAdapterJsonRpcChannel } from '@migaia/rpc-core/adapter/internal-advanced'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'

const objectMode = ${objectMode}
const hostMode = ${hostMode}
const token = crypto.randomUUID()
const sockets = new Set<Socket>()
let authenticated = 0
let invokes = 0
const server = createServer((socket) => {
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
  const decoder = createJsonRpcFrameDecoder()
  socket.on('data', (chunk) => {
    for (const value of decoder.push(chunk as Uint8Array)) {
      const request = value as { id?: string | number; method: string; params: Record<string, unknown> }
      let result: unknown
      if (request.method === 'migaia.hello') {
        const hello = JSON.parse(request.params.hello as string) as { auth: string; capabilities: string[] }
        if (hello.auth !== token) { socket.destroy(new Error('invalid responder token')); return }
        authenticated++
        result = {
          reply: JSON.stringify({ kind: 'handshake', step: 'accept', protocol: 'migaia.rpc',
            major: RpcProtocol.major, minor: RpcProtocol.minor, codec: 'json',
            capabilities: hello.capabilities, peer: { id: 'foreign-service', runtime: 'node' } }),
          methods: ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel']
        }
      } else if (request.method === 'migaia.describe') {
        result = { schemaVersion: 2, self: { name: 'foreign', instanceId: 'foreign-service' },
          methods: [{ name: 'math.add', supportedModes: ['request', 'notify'], modeSource: 'declared' }] }
      } else if (request.method === 'migaia.invoke') {
        invokes++
        result = (request.params.args as number[]).reduce((sum, value) => sum + value, 0)
      } else if (request.method === 'migaia.cancel') continue
      else throw new Error('unexpected responder method')
      if (request.id !== undefined) socket.write(encodeJsonRpcFrame({ jsonrpc: '2.0', id: request.id, result }))
    }
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('missing loopback address')
const reports: unknown[] = []
const records: unknown[] = []
const stderr = new PassThrough()
const controller = new AbortController()
const contract = { schemaVersion: 1 as const, plugin: 'foreign', features: {
  math: { methods: { add: { mode: 'request' as const, idempotent: false } } }
} }
const peer = await createProcessPeer<{ math: { add(args: [number, number]): number } }>({
  self: { name: 'main', instanceId: 'jsonrpc-main' },
  connect: async ({ self }) => {
    const options: IProcessJsonRpcChannelOptions = {
      byte: await dialProcessByteChannel({ address: 'tcp://127.0.0.1:' + address.port }),
      peerId: 'foreign-service',
      target: hostMode ? { kind: 'host', catalog: { foreign: contract } } : { kind: 'plugin', contract },
      offer: { peer: { id: self.instanceId, runtime: 'bun' },
        versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }], capabilities: [] },
      token: token, scheduler: systemScheduler, wallClock: systemWallClock,
      signal: controller.signal, handshakeTimeoutMs: 2500,
      ipc: { connectionId: 'jsonrpc-loopback', sessionId: 'jsonrpc-session', processId: 'external-responder',
        maxPendingData: 8, maxPendingControl: 2, log: (record) => { records.push(record) },
        stderr: (listener) => { stderr.on('data', listener); return () => { stderr.off('data', listener) } }
      },
      report: (error) => { reports.push(error) }
    }
    return objectMode ? createAdapterJsonRpcChannel(options, {
      closedError: createProcessChannelClosedError,
      openConnection: (connection, current) => openProcessObjectChannel(connection, current)
    }) : createProcessJsonRpcChannel(options)
  }
})
try {
  stderr.write(new Uint8Array([65, 66]))
  console.log(await peer.request('math.add', [20, 22]))
  console.log(authenticated, invokes, records.length > 0, reports.length)
} finally {
  await peer.close()
  stderr.end()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
`

/** Plugin and Host targets select different admitted contract grammars. */
export const processJsonRpcOptionCases = (objectMode = false): readonly IOptionCaseDoc[] =>
  [false, true].map((hostMode) => ({
    title: hostMode
      ? t('Bridge an approved Host catalog', '桥接已批准的宿主目录')
      : t('Bridge one approved plugin contract', '桥接一个已批准的插件契约'),
    problem: hostMode
      ? t(
          'A local JSON-RPC responder serves a declared set of plugins. Select host with catalog, retaining the actual byte channel and explicit clocks.',
          '本地 JSON-RPC 响应端提供声明过的插件集合。选择带目录的宿主目标，保留真实字节通道并显式提供时钟。'
        )
      : t(
          'A local responder implements the Migaia JSON-RPC extensions for one service. Select plugin with contract; an arbitrary JSON-RPC server cannot satisfy this handshake.',
          '本地响应端为一个服务实现 Migaia JSON-RPC 扩展。选择带契约的插件目标，任意 JSON-RPC 服务不能满足此握手。'
        ),
    example: jsonRpcOptionsCode(objectMode, hostMode),
    result: t(
      'Output is `42` then `1 1 true 0`: the real loopback responder verifies the generated token, handles one invocation, and produces IPC records without reports. A borrowed application PassThrough supplies stderr bytes; it is not described as an OS stderr source. The object variant opens the actual Core-negotiated connection through Process diagnostics.',
      '输出为 `42`、`1 1 true 0`：真实回环响应端校验生成的令牌，处理一次调用，生成通信记录且没有上报错误。借用的应用 PassThrough 提供标准错误字节，不声称它来自操作系统标准错误。对象变体通过进程诊断打开核心实际协商所得连接。'
    ),
    covers: [
      'byte',
      'peerId',
      'target',
      'target.kind',
      hostMode ? 'target.catalog' : 'target.contract',
      'offer',
      'token',
      'scheduler',
      'wallClock',
      'signal',
      'handshakeTimeoutMs',
      'report',
      'ipc',
      'ipc.connectionId',
      'ipc.sessionId',
      'ipc.processId',
      'ipc.maxPendingData',
      'ipc.maxPendingControl',
      'ipc.log',
      'ipc.stderr'
    ]
  }))
