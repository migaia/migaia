/**
 * Reference documentation of `@migaia/rpc-process`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/rpc-process/src/process` (runtime-peer.ts, adapters/short-source.ts,
 * plugin/types.ts, resilience/*, offer.ts, constants.ts, error-code.ts), the shared Core types in
 * `rpc-runtime-shared.ts`, README and USEGUIDE on 2026-10-17. Source clarification:
 * `receiveAdapterBootstrap` and the public stdio openers do not install a timeout when omitted; the
 * 10000 ms budget belongs to higher-level discovery. Both stdio openers reject `fd` mode. Interop
 * review: USEGUIDE labels Bun spawn and Deno sockets with native Bun/Deno APIs, but bun-spawn
 * re-exports Node child_process, bun-socket re-exports Node net, and deno-socket delegates to
 * Node-compatible net while rejecting Windows pipes. Electron has no automatic stdio child
 * discovery: its launcher rejects bootstrap and non-ignore stdin; use explicit message sources.
 * Windows Job launch always rejects and does not import koffi. The public launch helpers prepare
 * bootstrap/channel ownership; native spawning is still the custom launcher's responsibility.
 * Electron parentPort event.data comes from the native API documented at
 * https://www.electronjs.org/docs/latest/api/parent-port (read 2026-10-17).
 */
import type { ICode, ILibraryReference, IMemberDoc, ISymbolDoc, IText } from './contract.js'
import {
  runtimeOutletGrants,
  runtimePeerOptionMembers,
  runtimePairedTypes
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

/** Matching contracts copied into each file so both processes type their remote calls. */
const processApiCode = `type IMainApi = { parent: { prefix(value: string): string } }
type IServiceApi = {
  math: { double(value: number): number | Promise<number> }
  log: { note(value: string): void }
  feed: { count(limit: number): AsyncIterableIterator<number> }
}`

/** Child owns its providers; the parent's Peer owns the launched process lifetime. */
const processProvidersCode = `const provide: IServiceApi = {
  math: { double: (value) => value * 2 },
  log: { note: (value) => console.error(value) },
  feed: { count: async function* (limit) {
    for (let value = 1; value <= limit; value++) yield value
  } }
}`

/** A forward request waits for the child's reverse call before the parent may close it. */
const processReverseProvidersCode = `const provide: IServiceApi = {
  math: { double: async (value): Promise<number> => {
    const peer = await parent
    console.error(await peer.request('parent.prefix', 'double'))
    return value * 2
  } },
  log: { note: (value) => console.error(value) },
  feed: { count: async function* (limit) {
    for (let value = 1; value <= limit; value++) yield value
  } }
}`

/** Build complete service/main examples with a real optional launcher selection. */
const processSpawnExample = (module?: string, factory?: string): ICode => {
  /** Adapter-specific examples execute under the runtime that owns the selected launcher. */
  const runtime =
    module === 'deno-command'
      ? 'Deno'
      : module === 'bun-spawn'
        ? 'Bun'
        : module === 'node-child-process'
          ? 'Node'
          : 'Node/Bun/Deno'
  const code = (
    zh: boolean
  ) => `// ${zh ? `service.ts：${runtime} 子进程，标准输出留给协议` : `service.ts: ${runtime} child; stdout is reserved for protocol bytes`}
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

${processApiCode}
if (!isProcessChild()) throw new TypeError('library-launched child required')
${processReverseProvidersCode}
const parent = createProcessPeer<IMainApi>({ provide })
await parent
// ${zh ? '父端关闭连接后，库结束子进程生命周期。' : 'The parent closes the connection and ends the child lifetime.'}

// ${zh ? `main.ts：${runtime} 父进程；Deno 需要相应的读取、环境和启动权限` : `main.ts: ${runtime} parent; Deno needs read, env and run permissions`}
import { createProcessPeer } from '@migaia/rpc-process'
${module ? `import { ${factory} } from '@migaia/rpc-process/adapters/${module}'\n` : ''}
${processApiCode}
const service = await createProcessPeer<IServiceApi>({
  spawn: ${module ? `{ entry: new URL('./service.ts', import.meta.url), supervision: { launcher: ${factory}() } }` : `new URL('./service.ts', import.meta.url)`},
  provide: { parent: { prefix: (value: string) => 'main: ' + value } }
})
const off = service.on('exit', (event) => console.error(event))
try {
  console.log(await service.request('math.double', 21))
  await service.notify('log.note', 'hello')
  for await (const value of service.stream('feed.count', 3)) console.log(value)
} finally {
  off()
  await service.close()
}`
  return t(code(false), code(true))
}

/** Complete automatic child plus parent, including both directions and all three call modes. */
const peerExample = processSpawnExample()

/** Host installation and its child share the exact same method contracts. */
const pluginExample: ICode = t(
  `// service.ts: child; use stderr for application logs.
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
${processReverseProvidersCode}
const parent = createProcessPeer<IMainApi>({ provide })
await parent

// main.ts: host owns the connection and the child.
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

${processApiCode}
const service = createProcessPlugin<IServiceApi, IMainApi, 'service'>({
  name: 'service',
  spawn: new URL('./service.ts', import.meta.url),
  provide: { parent: { prefix: (value) => 'main: ' + value } }
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(service)
  console.log(await host.process!.request('service', 'math.double', 21))
  await host.process!.notify('service', 'log.note', 'hello')
  for await (const value of host.process!.stream('service', 'feed.count', 3)) console.log(value)
} finally {
  await host.dispose()
}`,
  `// service.ts：子进程；应用日志写入标准错误。
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
${processReverseProvidersCode}
const parent = createProcessPeer<IMainApi>({ provide })
await parent

// main.ts：宿主持有连接与子进程。
import { defineHost } from '@migaia/plugin-host'
import { createProcessPlugin } from '@migaia/rpc-process'

${processApiCode}
const service = createProcessPlugin<IServiceApi, IMainApi, 'service'>({
  name: 'service',
  spawn: new URL('./service.ts', import.meta.url),
  provide: { parent: { prefix: (value) => 'main: ' + value } }
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(service)
  console.log(await host.process!.request('service', 'math.double', 21))
  await host.process!.notify('service', 'log.note', 'hello')
  for await (const value of host.process!.stream('service', 'feed.count', 3)) console.log(value)
} finally {
  await host.dispose()
}`
)

/** Self-spawn must branch before any parent-only initialization. */
const selfSpawnExample: ICode = t(
  `// main.ts: both branches execute the same entry under the current runtime.
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

${processApiCode}
if (isProcessChild()) {
  ${processReverseProvidersCode}
  const parent = createProcessPeer<IMainApi>({ provide })
  await parent
  } else {
  const service = await createProcessPeer<IServiceApi>({
    spawn: true,
    provide: { parent: { prefix: (value: string) => 'main: ' + value } }
  })
  try {
    console.log(await service.request('math.double', 21))
    await service.notify('log.note', 'hello')
    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } finally {
    await service.close()
  }
}`,
  `// main.ts：两条分支由当前运行时执行同一个入口。
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

${processApiCode}
if (isProcessChild()) {
  ${processReverseProvidersCode}
  const parent = createProcessPeer<IMainApi>({ provide })
  await parent
  } else {
  const service = await createProcessPeer<IServiceApi>({
    spawn: true,
    provide: { parent: { prefix: (value: string) => 'main: ' + value } }
  })
  try {
    console.log(await service.request('math.double', 21))
    await service.notify('log.note', 'hello')
    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } finally {
    await service.close()
  }
}`
)

/** Separate independently running services retain process ownership after client disconnection. */
const namedSocketExample: ICode = t(
  `// service.ts: start this resident process first; Ctrl-C closes its listener and sessions.
import { once } from 'node:events'
import process from 'node:process'
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
${processProvidersCode}
const server = await createProcessPeer({ listen: 'reference-math-service', provide })
try {
  await once(process, 'SIGINT')
} finally {
  await server.close()
}

// main.ts: a separate client; closing it does not terminate service.ts.
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
const client = await createProcessPeer<IServiceApi>({ connect: 'reference-math-service' })
try {
  console.log(await client.request('math.double', 21))
  await client.notify('log.note', 'hello')
  for await (const value of client.stream('feed.count', 3)) console.log(value)
} finally {
  await client.close()
}`,
  `// service.ts：先启动此常驻进程；中断信号关闭监听与会话。
import { once } from 'node:events'
import process from 'node:process'
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
${processProvidersCode}
const server = await createProcessPeer({ listen: 'reference-math-service', provide })
try {
  await once(process, 'SIGINT')
} finally {
  await server.close()
}

// main.ts：独立客户端；关闭客户端不会终止服务进程。
import { createProcessPeer } from '@migaia/rpc-process'

${processApiCode}
const client = await createProcessPeer<IServiceApi>({ connect: 'reference-math-service' })
try {
  console.log(await client.request('math.double', 21))
  await client.notify('log.note', 'hello')
  for await (const value of client.stream('feed.count', 3)) console.log(value)
} finally {
  await client.close()
}`
)

/** Full adapter pair exposes both native dial/listen and the protocol establishment owner. */
const processSocketExample = (module: string, runtime: string): ICode => {
  const code = (
    zh: boolean
  ) => `// ${zh ? `service.ts：${runtime} 服务进程；先启动，中断信号负责关闭` : `service.ts: ${runtime} service; start first, interrupt to close`}
import { once } from 'node:events'
import process from 'node:process'
import { createNativeProcessOffer, createProcessPeer } from '@migaia/rpc-process'
import { listenProcessByteChannel } from '@migaia/rpc-process/adapters/${module}'

${processApiCode}
${processProvidersCode}
// ${zh ? '仅示例凭据；部署时由应用凭据所有者向两端发放同一密钥。' : 'Example credential only; the application distributes a shared secret in deployment.'}
const token = 'reference-local-demo'
let sequence = 0
const server = await createProcessPeer({
  report: console.error,
  provide,
  listen: {
    kind: 'listener',
    address: 'tcp://127.0.0.1:4000',
    listen: async (options) => {
      const listener = await listenProcessByteChannel({
        ...options,
        onConnection: (pending) => options.onConnection({
          accept: (context) => pending.accept(context),
          close: () => pending.close()
        })
      })
      return { address: listener.address, close: () => listener.close() }
    },
    verify: (auth) => {
      if (auth !== token) throw new TypeError('invalid credential')
      return 'reference-client'
    },
    offer: createNativeProcessOffer({ peer: { id: 'reference-service', runtime: '${runtime.toLowerCase()}' }, stream: true }),
    createConnectionContext: () => {
      sequence += 1
      return { peerId: 'client-' + sequence, ipc: {
        connectionId: 'connection-' + sequence,
        sessionId: 'session-' + sequence,
        log: () => undefined
      } }
    }
  }
})
try {
  await once(process, 'SIGINT')
} finally {
  await server.close()
}

// ${zh ? `main.ts：独立 ${runtime} 客户端；只持有会话，不持有服务进程` : `main.ts: independent ${runtime} client; owns its session, not the service process`}
import { createProcessPeer, createProcessTransport, type IProcessByteChannel } from '@migaia/rpc-process'
import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/${module}'

${processApiCode}
const client = await createProcessPeer<IServiceApi>({
  report: console.error,
  connect: {
    kind: 'connect',
    address: 'tcp://127.0.0.1:4000',
    token: 'reference-local-demo',
    dial: (address, signal) => dialProcessByteChannel({ address, signal }),
    establish: (raw, prepared) => createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator',
      offer: prepared.offer!,
      peerId: 'reference-service',
      scheduler: prepared.scheduler,
      signal: prepared.signal,
      ipc: { ...prepared.session, log: () => undefined },
      report: console.error
    })
  }
})
try {
  console.log(await client.request('math.double', 21))
  await client.notify('log.note', 'hello')
  for await (const value of client.stream('feed.count', 3)) console.log(value)
} finally {
  await client.close()
}`
  return t(code(false), code(true))
}

/** Native socket example shared by transport and byte-channel nodes. */
const socketExample = processSocketExample('node-socket', 'Node')

/** Make each byte operation visible without attaching a second protocol reader. */
const byteForwardingCode = `function forwardByte(raw: IProcessByteChannel): IProcessByteChannel {
  return {
    kind: 'byte',
    write: (chunk) => raw.write(chunk),
    onData: (listener) => raw.onData(listener),
    onClose: (listener) => raw.onClose(listener),
    close: () => raw.close()
  }
}`

/** Manual stdio sources own only channels; the application must terminate its native child. */
const processStdioExample = (
  mode: 'raw' | 'open' | 'bootstrap' | 'web' = 'raw',
  runtime = 'Node'
): ICode => {
  const deno = runtime === 'Deno' || mode === 'web'
  const childImport =
    mode === 'web'
      ? `import { createAdapterWebByteIO } from '@migaia/rpc-process'`
      : `import { ${mode === 'open' ? 'openProcessStdioChannel' : 'createAdapterProcessStdio'} } from '@migaia/rpc-process/adapters/${deno ? 'deno-command' : 'node-child-process'}'`
  const openCode =
    mode === 'web'
      ? 'const raw = createAdapterWebByteIO(Deno.stdin.readable, Deno.stdout.writable)'
      : mode === 'open'
        ? "const { channel: raw } = await openProcessStdioChannel({ bootstrap: 'none' })"
        : mode === 'bootstrap'
          ? "const { channel: raw } = await receiveAdapterBootstrap(createAdapterProcessStdio(process), 'none')"
          : 'const raw = createAdapterProcessStdio(process)'
  const code = (
    zh: boolean
  ) => `// ${zh ? `service.ts：${deno ? 'Deno' : runtime} 子进程；此手动启动不写入启动帧` : `service.ts: ${deno ? 'Deno' : runtime} child; this manual launch writes no bootstrap frame`}
import process from 'node:process'
import { createProcessPeer, createProcessTransport, createNativeProcessOffer, ${mode === 'bootstrap' ? 'receiveAdapterBootstrap, ' : ''}type IProcessByteChannel } from '@migaia/rpc-process'
${childImport}

${processApiCode}
${processReverseProvidersCode}
${byteForwardingCode}
const parent = createProcessPeer<IMainApi>({
  self: { name: 'service', instanceId: 'manual-service' },
  provide,
  connect: async (context) => {
    ${openCode}
    return createProcessTransport(forwardByte(raw), {
      role: 'responder',
      peerId: 'manual-main',
      offer: createNativeProcessOffer({ peer: { id: context.self.instanceId, runtime: '${deno ? 'deno' : runtime.toLowerCase()}' }, capabilities: context.capabilities }),
      auth: { mode: 'required', verify: (auth) => {
        if (auth !== 'manual-demo') throw new TypeError('invalid credential')
        return 'manual-main'
      } },
      ipc: { connectionId: 'manual-child', sessionId: 'manual-session', log: () => undefined },
      report: console.error
    })
  }
})
await parent

// ${zh ? 'main.ts：Node 父进程；连接关闭后仍由应用终止并等待原生子进程' : 'main.ts: Node parent; the application terminates and joins its borrowed child'}
import process from 'node:process'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createProcessPeer, createProcessTransport, createNativeProcessOffer, type IProcessByteChannel } from '@migaia/rpc-process'
import { createAdapterChildStdio } from '@migaia/rpc-process/adapters/node-child-process'

${processApiCode}
${byteForwardingCode}
const entry = fileURLToPath(new URL('./service.ts', import.meta.url))
const child = spawn(${deno ? "'deno', ['run', '--allow-all', entry]" : runtime === 'Bun' ? "'bun', [entry]" : 'process.execPath, [...process.execArgv, entry]'}, { stdio: ['pipe', 'pipe', 'inherit'] })
const exited = once(child, 'close')
try {
  const service = await createProcessPeer<IServiceApi>({
    self: { name: 'main', instanceId: 'manual-main' },
    provide: { parent: { prefix: (value: string) => 'main: ' + value } },
    spawn: async (context) => createProcessTransport(forwardByte(createAdapterChildStdio(child)), {
      role: 'initiator',
      peerId: 'manual-service',
      offer: createNativeProcessOffer({ peer: { id: context.self.instanceId, runtime: 'node' }, auth: 'manual-demo', capabilities: context.capabilities }),
      ipc: { connectionId: 'manual-parent', sessionId: 'manual-session', log: () => undefined },
      report: console.error
    })
  })
  try {
    console.log(await service.request('math.double', 21))
    await service.notify('log.note', 'hello')
    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } finally {
    await service.close()
  }
} finally {
  child.kill()
  await exited
}`
  return t(code(false), code(true))
}

/** Covers raw byte methods and the two public Node stdio wrapper operations. */
const stdioExample = processStdioExample()

/** Electron exposes a real message port, but no stdio/bootstrap automatic-child combination. */
const electronExample: ICode = (() => {
  const code = (
    zh: boolean
  ) => `// ${zh ? 'service.ts：编译为 service.js，在 Electron 的实用进程中执行' : 'service.ts: compile to service.js; runs in the Electron utility process'}
import process from 'node:process'
import type {} from 'electron'
import { createProcessPeer, createProcessTransport, type IProcessMessageChannel } from '@migaia/rpc-process'

${processApiCode}
${processReverseProvidersCode}
// ${zh ? '等父端先发送真实控制消息，再把该原始消息交回核心校验，避免子端先发送而父端尚未监听。' : 'Wait for the parent first, then replay its actual control message for Core validation before sending from the child.'}
const first = await new Promise<unknown>((resolve) => process.parentPort.once('message', (event: { data: unknown }) => resolve(event.data)))
let firstPending = true
const raw: IProcessMessageChannel = {
  kind: 'message',
  send: (value) => process.parentPort.postMessage(value),
  onMessage: (listener) => {
    const receive = (event: { data: unknown }) => listener(event.data)
    process.parentPort.on('message', receive)
    if (firstPending) {
      firstPending = false
      listener(first)
    }
    return () => process.parentPort.off('message', receive)
  },
  onClose: (listener) => {
    process.on('exit', listener)
    return () => process.off('exit', listener)
  },
  close: () => undefined
}
const parent = createProcessPeer<IMainApi>({
  self: { name: 'service', instanceId: 'electron-service' },
  provide,
  connect: async ({ capabilities }) => {
    const profile = { codec: 'identity' as const, capabilities }
    return createProcessTransport(raw, {
      peerId: 'electron-main',
      staticAgreement: { local: profile, peer: profile },
      ipc: { connectionId: 'utility-child', sessionId: 'utility-session', log: () => undefined },
      report: console.error
    })
  }
})
await parent
// ${zh ? '关闭协议只移除监听；原生子进程由主进程持有的句柄终止。' : 'Protocol close removes listeners; the main process terminates the native child handle.'}

// ${zh ? 'main.ts：Electron 主进程，在应用就绪后启动，不能把启动帧或标准输入交给此启动器' : 'main.ts: Electron main after app ready; this launcher rejects bootstrap and stdin channels'}
import { app } from 'electron'
import { fileURLToPath } from 'node:url'
import { createProcessPeer, createProcessTransport } from '@migaia/rpc-process'
import { createElectronUtilityProcessLauncher } from '@migaia/rpc-process/adapters/electron-utility-process'

${processApiCode}
await app.whenReady()
const handle = await createElectronUtilityProcessLauncher().launch({
  command: fileURLToPath(new URL('./service.js', import.meta.url)),
  args: [],
  env: { inherit: ['PATH'], set: {} },
  stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
}, { signal: new AbortController().signal, output: (_stream, chunk) => console.error(new TextDecoder().decode(chunk)) })
try {
  const service = await createProcessPeer<IServiceApi>({
    self: { name: 'main', instanceId: 'electron-main' },
    provide: { parent: { prefix: (value: string) => 'main: ' + value } },
    spawn: async ({ capabilities }) => {
      const profile = { codec: 'identity' as const, capabilities }
      const raw = handle.channel
      return createProcessTransport({
        kind: 'message',
        send: (value) => raw.send(value),
        onMessage: (listener) => raw.onMessage(listener),
        onClose: (listener) => raw.onClose(listener),
        close: () => raw.close()
      }, {
        peerId: 'electron-service',
        staticAgreement: { local: profile, peer: profile },
        ipc: { connectionId: 'utility-main', sessionId: 'utility-session', log: () => undefined },
        report: console.error
      })
    }
  })
  try {
    console.log(await service.request('math.double', 21))
    await service.notify('log.note', 'hello')
    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } finally {
    await service.close()
  }
} finally {
  handle.terminate('force')
  await handle.exited
  app.quit()
}`
  return t(code(false), code(true))
})()

/** Foreign implementations speak this protocol; no foreign-language client API is assumed. */
const jsonRpcExample: ICode = (() => {
  const capabilities = ['jsonrpc-bridge@1', 'runtime-api@1', 'batch@1', 'abort@1', 'wire-error@1']
  const messages = JSON.stringify(
    [
      {
        receive: {
          jsonrpc: '2.0',
          id: 'migaia.hello',
          method: 'migaia.hello',
          params: {
            hello: JSON.stringify({
              kind: 'handshake',
              step: 'hello',
              protocol: 'migaia.rpc',
              versions: [{ major: 1, minor: 1 }],
              codecs: ['json'],
              capabilities,
              peer: { id: 'jsonrpc-main', runtime: 'node' },
              auth: 'protocol-demo'
            })
          }
        }
      },
      {
        send: {
          jsonrpc: '2.0',
          id: 'migaia.hello',
          result: {
            reply: JSON.stringify({
              kind: 'handshake',
              step: 'accept',
              protocol: 'migaia.rpc',
              major: 1,
              minor: 1,
              codec: 'json',
              capabilities,
              peer: { id: 'foreign-service', runtime: 'python' }
            }),
            methods: ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel']
          }
        }
      },
      { receive: { jsonrpc: '2.0', id: 'd1', method: 'migaia.describe', params: { args: [] } } },
      {
        send: {
          jsonrpc: '2.0',
          id: 'd1',
          result: {
            schemaVersion: 2,
            self: { name: 'foreign', instanceId: 'foreign-service' },
            methods: [
              { name: 'math.add', supportedModes: ['request', 'notify'], modeSource: 'declared' },
              { name: 'log.note', supportedModes: ['notify'], modeSource: 'declared' }
            ]
          }
        }
      },
      {
        receive: {
          jsonrpc: '2.0',
          id: 'r1',
          method: 'migaia.invoke',
          params: { method: 'math.add', args: [20, 22] }
        }
      },
      { send: { jsonrpc: '2.0', id: 'r1', result: 42 } },
      {
        receive: {
          jsonrpc: '2.0',
          method: 'migaia.invoke',
          params: { method: 'log.note', args: ['hello'] }
        }
      },
      {
        receive: {
          jsonrpc: '2.0',
          id: 'r2',
          method: 'migaia.invoke',
          params: { method: 'math.add', args: [1, 2] }
        }
      },
      { receive: { jsonrpc: '2.0', method: 'migaia.cancel', params: { id: 'r2' } } }
    ],
    null,
    2
  )
  const code = (
    zh: boolean
  ) => `// ${zh ? 'main.ts：TypeScript 发起端；先启动遵循下面协议的本机服务' : 'main.ts: TypeScript initiator; start a local responder implementing the protocol below'}
import { createProcessPeer, createProcessJsonRpcChannel } from '@migaia/rpc-process'
import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'
import { RpcProtocol } from '@migaia/rpc-contract'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'

type IForeignApi = {
  math: { add(args: [number, number]): number }
  log: { note(args: [string]): void }
}
const peer = await createProcessPeer<IForeignApi>({
  self: { name: 'main', instanceId: 'jsonrpc-main' },
  connect: async ({ self }) => createProcessJsonRpcChannel({
    byte: await dialProcessByteChannel({ address: 'tcp://127.0.0.1:4001' }),
    peerId: 'foreign-service',
    target: { kind: 'plugin', contract: {
      schemaVersion: 1, plugin: 'foreign', features: {
        math: { methods: { add: { mode: 'request', idempotent: false } } },
        log: { methods: { note: { mode: 'one-way', idempotent: false } } }
      }
    } },
    offer: {
      peer: { id: self.instanceId, runtime: 'node' },
      versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
      capabilities: []
    },
    token: 'protocol-demo',
    scheduler: systemScheduler,
    wallClock: systemWallClock,
    ipc: { connectionId: 'foreign-connection', sessionId: 'foreign-session', log: () => undefined },
    report: console.error
  })
})
try {
  console.log(await peer.request('math.add', [20, 22]))
  await peer.notify('log.note', ['hello'])
} finally {
  await peer.close()
}

// ${zh ? 'peer.protocol.json：另一个进程的收发记录示意，不是虚构的外语库接口' : 'peer.protocol.json: responder transcript, not an invented foreign-language library API'}
// ${zh ? '应用实现监听、凭据校验和方法执行；必须原样回复收到的关联标识。' : 'The application implements listening, authentication and methods; echo each received correlation id.'}
// ${zh ? '每条消息独立按 UTF-8 字节数编码为 Content-Length: N\\r\\n\\r\\nJSON；下面的外层记录数组不发送。' : 'Frame each message separately as Content-Length: N\\r\\n\\r\\nJSON using UTF-8 byte length; do not send the transcript array.'}
// ${zh ? '先校验握手密钥，按对方提议顺序返回共同能力；描述目录中的实例标识必须与握手一致。' : 'Authenticate hello, preserve offered capability order, and keep the description instance id equal to the handshake peer id.'}
// ${zh ? '通知不回复；取消只尽力停止对应在途调用，不回滚副作用。此配置不支持流或转移。' : 'Notifications receive no reply; cancel is best effort without rollback. Streams and transfer are unsupported.'}
${messages}`
  return t(code(false), code(true))
})()

/** Local variants retain complete bilingual files while demonstrating one advanced constructor. */
const processExampleVariant = (
  example: ICode,
  transform: (code: string, zh: boolean) => string
): ICode =>
  t(
    transform(typeof example === 'string' ? example : example.en, false),
    transform(typeof example === 'string' ? example : example.zh, true)
  )

/** Node launch preparation is used once, then the application performs the actual native spawn. */
const nodeLaunchExample = processExampleVariant(stdioExample, (code) =>
  code
    .replace(
      "import { createAdapterChildStdio } from '@migaia/rpc-process/adapters/node-child-process'",
      "import { createAdapterNodeProcessLaunch } from '@migaia/rpc-process/adapters/node-child-process'"
    )
    .replace(
      "const child = spawn(process.execPath, [...process.execArgv, entry], { stdio: ['pipe', 'pipe', 'inherit'] })",
      `const spec = {
  command: process.execPath, args: [...process.execArgv, entry],
  env: { inherit: ['PATH'], set: {} },
  stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' } as const
}
const launch = createAdapterNodeProcessLaunch(spec, {
  signal: new AbortController().signal, output: (_stream, chunk) => console.error(chunk)
})
launch.assertActive()
const child = spawn(spec.command, spec.args, { stdio: ['pipe', 'pipe', 'inherit'] })`
    )
    .replace(
      'forwardByte(createAdapterChildStdio(child))',
      'forwardByte(launch.createChildChannel(child))'
    )
)

/** Web-stream preparation wraps a real manually launched Deno process without a bootstrap claim. */
const webLaunchExample = processExampleVariant(processStdioExample('web', 'Deno'), (code, zh) =>
  code
    .replace("import { spawn } from 'node:child_process'\n", '')
    .replace("import { once } from 'node:events'\n", '')
    .replace(
      "import { createAdapterChildStdio } from '@migaia/rpc-process/adapters/node-child-process'",
      "import { createAdapterProcessLaunch } from '@migaia/rpc-process'"
    )
    .replace(
      zh
        ? '// main.ts：Node 父进程；连接关闭后仍由应用终止并等待原生子进程'
        : '// main.ts: Node parent; the application terminates and joins its borrowed child',
      zh
        ? '// main.ts：Deno 父进程，以所需的环境、读取和启动权限运行；应用终止并等待子进程'
        : '// main.ts: Deno parent with env, read and run permissions; the application terminates and joins its child'
    )
    .replace(
      "const child = spawn('deno', ['run', '--allow-all', entry], { stdio: ['pipe', 'pipe', 'inherit'] })\nconst exited = once(child, 'close')",
      `const spec = {
  command: Deno.execPath(), args: ['run', '--allow-all', entry],
  env: { inherit: ['PATH'], set: {} },
  stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' } as const
}
const launch = createAdapterProcessLaunch(spec, {
  signal: new AbortController().signal, output: (_stream, chunk) => console.error(chunk)
})
launch.assertActive()
const child = new Deno.Command(spec.command, {
  args: spec.args, stdin: 'piped', stdout: 'piped', stderr: 'inherit'
}).spawn()
let childExited = false
const exited = child.status.then((status) => { childExited = true; return status })`
    )
    .replace(
      'forwardByte(createAdapterChildStdio(child))',
      'forwardByte(launch.createWebChannel(child.stdout, child.stdin))'
    )
    .replace('  child.kill()', '  if (!childExited) child.kill("SIGTERM")')
)

/** The object-opening hook is supplied by the actual Core JSON-RPC negotiation owner. */
const objectChannelExample = processExampleVariant(jsonRpcExample, (code) =>
  code
    .replace(
      "import { createProcessPeer, createProcessJsonRpcChannel } from '@migaia/rpc-process'",
      "import { createProcessPeer, createProcessChannelClosedError, openProcessObjectChannel } from '@migaia/rpc-process'\nimport { createAdapterJsonRpcChannel } from '@migaia/rpc-core/adapter/internal-advanced'"
    )
    .replace(
      'connect: async ({ self }) => createProcessJsonRpcChannel({',
      'connect: async ({ self }) => createAdapterJsonRpcChannel({'
    )
    .replace(
      '    report: console.error\n  })\n})',
      `    report: console.error
  }, {
    closedError: createProcessChannelClosedError,
    openConnection: (connection, options) => openProcessObjectChannel(connection, options)
  })
})`
    )
)

/** Existing native acquisition methods provide a concrete custom-loader example. */
const processLoaderCode = `const runtime = {
  load: async () => ({ processRuntimeIO: {
    discover: () => {
      const marker = process.env[PROCESS_RUNTIME_API_ENV]
      if (marker !== undefined) delete process.env[PROCESS_RUNTIME_API_ENV]
      return { marker, runtime: 'node' }
    },
    open: () => openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 10_000 })
  } })
}`

/** The custom-loader factory still connects to the same automatic child and matching providers. */
const adapterPeerExample = processExampleVariant(peerExample, (code) =>
  code
    .replace(
      "import { createProcessPeer } from '@migaia/rpc-process'",
      "import process from 'node:process'\nimport { createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV } from '@migaia/rpc-process'\nimport { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'"
    )
    .replace(
      'const service = await createProcessPeer<IServiceApi>({',
      processLoaderCode + '\nconst service = await createAdapterProcessPeer<IServiceApi>({'
    )
    .replace('})\nconst off = service.on', '}, runtime)\nconst off = service.on')
    .replace(
      'Node/Bun/Deno parent; Deno needs read, env and run permissions',
      'Node parent using this custom native loader'
    )
    .replace(
      'Node/Bun/Deno 父进程；Deno 需要相应的读取、环境和启动权限',
      'Node 父进程，使用此自定义原生加载器'
    )
)

/** Installation uses the same concrete native loader and exposes the canonical process slot. */
const adapterPluginExample = processExampleVariant(pluginExample, (code) =>
  code
    .replace(
      "import { createProcessPlugin } from '@migaia/rpc-process'",
      "import process from 'node:process'\nimport { createAdapterProcessPlugin, PROCESS_RUNTIME_API_ENV } from '@migaia/rpc-process'\nimport { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'"
    )
    .replace(
      "const service = createProcessPlugin<IServiceApi, IMainApi, 'service'>({",
      processLoaderCode +
        "\nconst service = createAdapterProcessPlugin<IServiceApi, IMainApi, 'service'>({"
    )
    .replace('})\nconst host = defineHost', '}, runtime)\nconst host = defineHost')
)

/** The borrowed socket wrapper is created only after the actual Node connection is established. */
const socketIoExample = processExampleVariant(socketExample, (code) =>
  code
    .replace(
      "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'",
      "import { createAdapterSocketByteIO } from '@migaia/rpc-process/adapters/node-socket'\nimport { createConnection } from 'node:net'\nimport { once } from 'node:events'"
    )
    .replace(
      'dial: (address, signal) => dialProcessByteChannel({ address, signal }),',
      `dial: async () => {
      const socket = createConnection({ host: '127.0.0.1', port: 4000 })
      await once(socket, 'connect')
      return createAdapterSocketByteIO(socket)
    },`
    )
)

/** Actual bootstrap discovery plus both callable ends gives constants their real native context. */
const bootstrapExample = processExampleVariant(adapterPeerExample, (code) =>
  code
    .replace(
      'createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV',
      'createAdapterProcessPeer, PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION, PROCESS_RUNTIME_API_BOOTSTRAP_KIND, PROCESS_RUNTIME_API_BOOTSTRAP_VERSION, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS, PROCESS_RUNTIME_API_FINGERPRINT_PREFIX, PROCESS_HANDSHAKE_MAX_FRAME_BYTES'
    )
    .replace(
      "bootstrap: 'stdin', bootstrapTimeoutMs: 10_000",
      "bootstrap: 'stdin', bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS"
    )
    .replace(
      'const runtime = {',
      `console.error({
  discovery: PROCESS_RUNTIME_API_ENV,
  discoveryVersion: PROCESS_RUNTIME_API_ENV_VERSION,
  bootstrapKind: PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  bootstrapVersion: PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
  bootstrapLimit: PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  nativeIdentityPrefix: PROCESS_RUNTIME_API_FINGERPRINT_PREFIX
})
const runtime = {`
    )
)

/** Native close causes and public error identities are handled within one actual stdio pair. */
const processErrorExample = processExampleVariant(stdioExample, (code) =>
  code
    .replaceAll(
      'createNativeProcessOffer, type IProcessByteChannel',
      'createNativeProcessOffer, createProcessChannelClosedError, RPC_PROCESS_ERROR_SOURCE, RpcProcessErrorCode, type IProcessByteChannel'
    )
    .replaceAll(
      'onClose: (listener) => raw.onClose(listener)',
      'onClose: (listener) => raw.onClose((reason) => listener(createProcessChannelClosedError(reason)))'
    )
    .replace(
      `    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } finally {`,
      `    for await (const value of service.stream('feed.count', 3)) console.log(value)
  } catch (error) {
    const failure = error as { source?: unknown; code?: unknown }
    if (failure.source === RPC_PROCESS_ERROR_SOURCE && failure.code === RpcProcessErrorCode.channelClosed)
      console.error(failure.source, failure.code)
    throw error
  } finally {`
    )
)

/** A portable descriptor chooses data; the application still selects and owns live adapters. */
const descriptorExample = processExampleVariant(socketExample, (code) =>
  code
    .replace(
      'createProcessPeer, createProcessTransport, type IProcessByteChannel',
      'createProcessPeer, createProcessTransport, parseProcessPluginDescriptor, type IProcessByteChannel'
    )
    .replace(
      'const client = await createProcessPeer<IServiceApi>({',
      `const descriptor = parseProcessPluginDescriptor({
  descriptorVersion: 1, target: 'plugin', name: 'service', runtime: 'node',
  deployment: { kind: 'connect', address: 'tcp://127.0.0.1:4000' },
  contract: { schemaVersion: 1, plugin: 'service', features: {
    math: { methods: { double: { mode: 'request', idempotent: false } } },
    log: { methods: { note: { mode: 'one-way', idempotent: false } } },
    feed: { methods: { count: { mode: 'async-generator', idempotent: false } } }
  } }
})
if (descriptor.deployment.kind !== 'connect') throw new TypeError('connect descriptor required')
const client = await createProcessPeer<IServiceApi>({`
    )
    .replace(
      "    address: 'tcp://127.0.0.1:4000',\n    token:",
      '    address: descriptor.deployment.address,\n    token:'
    )
)

/** Native wire selection is a real full-deployment field beside its socket counterpart. */
const wireExample = processExampleVariant(socketExample, (code) =>
  code
    .replace(
      'createProcessPeer, createProcessTransport, type IProcessByteChannel',
      'createProcessPeer, createProcessTransport, ProcessPluginWire, type IProcessByteChannel'
    )
    .replace(
      "    kind: 'connect',\n    address:",
      "    kind: 'connect',\n    wire: ProcessPluginWire.native,\n    address:"
    )
)

/** A real process supervisor supplies registration state and replacement handles. */
const registrationExample: ICode = (() => {
  const code = (zh: boolean) => {
    const original =
      typeof stdioExample === 'string' ? stdioExample : zh ? stdioExample.zh : stdioExample.en
    const child = original.slice(0, original.indexOf('// main.ts'))
    return (
      child +
      `// ${zh ? 'main.ts：Node 父端；监督器持有原生进程，治理登记只观察它' : 'main.ts: Node parent; supervision owns the process, registration observes its actual state'}
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createNodeProcessLauncher, type INodeProcessHandle } from '@migaia/rpc-process/adapters/node-child-process'
import { createProcessPeer, createProcessTransport, createNativeProcessOffer, createProcessResilience, type IProcessByteChannel, type IProcessRegistrationBinding, type IProcessLiquidationOwner } from '@migaia/rpc-process'

${processApiCode}
${byteForwardingCode}
const supervisor = createProcessSupervisor({
  id: 'service',
  launcher: createNodeProcessLauncher(),
  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
  scheduler: systemScheduler,
  isolation: 'best-effort',
  report: console.error,
  spec: {
    command: process.execPath,
    args: [...process.execArgv, fileURLToPath(new URL('./service.ts', import.meta.url))],
    env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
  }
})
const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error, maxConnections: 16 })
const off = resilience.onTerminal((snapshot) => console.error(snapshot.id, snapshot.state))
let sequence = 0
const openPeer = (handle: INodeProcessHandle) => createProcessPeer<IServiceApi>({
  self: { name: 'main', instanceId: 'manual-main' },
  provide: { parent: { prefix: (value: string) => 'main: ' + value } },
  connect: async (context) => {
    sequence += 1
    return createProcessTransport(forwardByte(handle.channel!), {
      role: 'initiator', peerId: 'manual-service',
      offer: createNativeProcessOffer({ peer: { id: context.self.instanceId, runtime: 'node' }, auth: 'manual-demo', capabilities: context.capabilities }),
      ipc: { connectionId: 'governed-' + sequence, sessionId: 'session-' + sequence, log: () => undefined },
      report: console.error
    })
  }
})
let peer: Awaited<ReturnType<typeof openPeer>> | undefined
const binding: IProcessRegistrationBinding = {
  ownership: 'spawn-owned', health: 'none',
  supervisor: {
    restart: () => supervisor.restart(),
    inspect: () => supervisor.inspect(),
    dispose: () => supervisor.dispose(),
    onTerminal: (listener) => supervisor.subscribe((event) => {
      if (event.type === 'terminal') listener(event)
    })
  }
}
const owner: IProcessLiquidationOwner = { kind: 'standalone-host', release: async () => {
  try { await peer?.close() } finally { await supervisor.dispose() }
} }
const registration = resilience.attachRegistration('service', binding, owner)
const guard = resilience.callGuard('service')
try {
  const initial = await supervisor.start()
  if (initial.state !== 'ready') throw new TypeError('process did not become ready')
  peer = await openPeer(initial.unit)
  guard.beforeDispatch({ method: 'math.double', mode: 'request', generation: supervisor.generation })
  console.log(await peer.request('math.double', 21))
  await peer.notify('log.note', 'before restart')
  for await (const value of peer.stream('feed.count', 3)) console.log(value)
  console.log(registration.inspect(), resilience.inspect('service'))
  // ${zh ? '先关闭旧会话；重启返回的是新原生执行单元，必须重新建立协议连接。' : 'Close the old session first; a restarted native unit needs a new protocol connection.'}
  await peer.close()
  await registration.restart()
  const successor = await supervisor.whenReady()
  if (successor.state !== 'ready') throw new TypeError('replacement did not become ready')
  peer = await openPeer(successor.unit)
  guard.beforeDispatch({ method: 'math.double', mode: 'request', generation: supervisor.generation })
  console.log(await peer.request('math.double', 22))
} finally {
  try { await peer?.close() } finally {
    off()
    try { await registration.close() } finally {
      try { await resilience.close() } finally { await supervisor.dispose() }
    }
  }
}`
    )
  }
  return t(code(false), code(true))
})()

/** Authenticated candidate identity supplies real session policy and application-owned endpoints. */
const registrationListenerExample: ICode = (() => {
  const code = (
    zh: boolean
  ) => `// ${zh ? 'service.ts：Node 服务端；先启动，应用持有接纳后的端点与会话' : 'service.ts: Node responder; start first, application owns adopted endpoints and sessions'}
import process from 'node:process'
import { once } from 'node:events'
import { createProcessResilience, createNativeProcessOffer } from '@migaia/rpc-process'
import { listenProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'
import { createRuntimeApiEndpoint, codec, framer, connect, ping, type IRpcContext, type IRpcProviderResult } from '@migaia/rpc-core'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'

type IServiceApi = { double(value: number): number }
type IMainApi = { title(): string }
const api: IServiceApi = { double: (value) => value * 2 }
const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error, maxConnections: 16 })
const sessions = new Set<() => Promise<void>>()
let sequence = 0
const listener = await resilience.listenRegistrations({
  wire: 'native',
  address: 'tcp://127.0.0.1:4000',
  listen: listenProcessByteChannel,
  offer: createNativeProcessOffer({ peer: { id: 'service', runtime: 'node' } }),
  verifyToken: (auth) => {
    if (auth !== 'reference-local-demo') throw new TypeError('invalid credential')
    return 'example-client'
  },
  createConnectionContext: () => {
    sequence += 1
    return { peerId: 'client', ipc: {
      connectionId: 'accepted-' + sequence, sessionId: 'session-' + sequence, log: () => undefined
    } }
  },
  onCandidate: async (candidate) => {
    const channel = candidate.channel
    const session = resilience.sessionOptions(candidate.identity)
    const endpoint = createRuntimeApiEndpoint({
      id: 'service', targetIds: [channel.peerId], transport: channel.transport,
      scheduler: channel.scheduler, idempotency: session.idempotency, providerLimits: session.limits,
      construction: { signal: candidate.signal },
      provider: { double: async (context: IRpcContext): Promise<IRpcProviderResult> => {
        console.error(await endpoint.send<ReturnType<IMainApi['title']>>('client', 'title', null))
        return context.success(api.double(context.data as Parameters<IServiceApi['double']>[0]))
      } },
      middlewares: [codec(channel.pipeline.codec), framer(channel.pipeline.framer), connect({ transport: channel.transport }), ping()],
      features: channel.features
    }, channel)
    const close = async () => {
      try { await endpoint.dispose() } finally { await candidate.close() }
    }
    sessions.add(close)
    await endpoint.ready
    ;(channel as IRuntimePeerSourceResult).activateReceive?.()
    return 'adopt'
  }
})
console.error(listener.address)
try {
  await once(process, 'SIGINT')
} finally {
  try { await listener.close() } finally {
    const results = await Promise.allSettled([...sessions].map((close) => close()))
    for (const result of results) if (result.status === 'rejected') console.error(result.reason)
    await resilience.close()
  }
}

// ${zh ? 'main.ts：Node 客户端；端点释放后再关闭所持有的协议连接' : 'main.ts: Node client; dispose the endpoint before closing its protocol channel'}
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc-process'
import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'
import { createRuntimeApiEndpoint, codec, framer, connect, ping } from '@migaia/rpc-core'

type IServiceApi = { double(value: number): number }
type IMainApi = { title(): string }
const api: IMainApi = { title: () => 'main' }
const channel = await createProcessTransport(await dialProcessByteChannel({ address: 'tcp://127.0.0.1:4000' }), {
  role: 'initiator', peerId: 'service',
  offer: createNativeProcessOffer({ peer: { id: 'client', runtime: 'node' }, auth: 'reference-local-demo' }),
  ipc: { connectionId: 'client-1', sessionId: 'client-session-1', log: () => undefined },
  report: console.error
})
const endpoint = createRuntimeApiEndpoint({
  id: 'client', targetIds: ['service'], transport: channel.transport, scheduler: channel.scheduler,
  provider: { title: (context) => context.success(api.title()) },
  middlewares: [codec(channel.pipeline.codec), framer(channel.pipeline.framer), connect({ transport: channel.transport }), ping()],
  features: channel.features
}, channel)
try {
  await endpoint.ready
  channel.activateReceive?.()
  const payload: Parameters<IServiceApi['double']>[0] = 21
  console.log(await endpoint.send<ReturnType<IServiceApi['double']>>('service', 'double', payload))
} finally {
  try { await endpoint.dispose() } finally { await channel.close() }
}`
  return t(code(false), code(true))
})()

/** The advanced plugin owns a real supervised deployment and replaces only after installation. */
const legacyReplaceExample: ICode = (() => {
  const declarations = `type IServiceApi = { math: { double(value: number): Promise<number> } }
type IMainApi = { parent: { prefix(value: string): string } }
const serviceContract: IRemoteContract = {
  schemaVersion: 1, plugin: 'service',
  features: { math: { methods: { double: { mode: 'request', idempotent: false } } } }
}`
  const code = (
    zh: boolean
  ) => `// ${zh ? 'service.ts：Node 子进程，使用显式原生协议，不读取自动启动帧' : 'service.ts: Node child using an explicit native protocol, without an automatic bootstrap frame'}
import process from 'node:process'
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createEndpoint, connect, contract, ping } from '@migaia/rpc-core'
import { serveRemotePlugin, type IRemoteContract } from '@migaia/rpc-core/remote'
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc-process'
import { createAdapterProcessStdio } from '@migaia/rpc-process/adapters/node-child-process'

${declarations}
const channel = await createProcessTransport(createAdapterProcessStdio(process), {
  role: 'responder', peerId: 'legacy-main',
  offer: createNativeProcessOffer({ peer: { id: 'legacy-service', runtime: 'node' }, stream: false, capabilities: ['runtime-api@1'] }),
  auth: { mode: 'required', verify: (auth) => {
    if (auth !== 'legacy-demo') throw new TypeError('invalid credential')
    return 'legacy-main'
  } },
  ipc: { connectionId: 'legacy-child', sessionId: 'legacy-session', log: () => undefined },
  report: console.error
})
// ${zh ? '原生字节通道返回的两个真实特性分别持有发送队列与诊断日志，原样安装。' : 'The native byte channel returns its actual queue and log features; install both unchanged.'}
const [queue, log] = channel.features
const endpoint = await createEndpoint({
  id: 'legacy-service', targetIds: ['legacy-main'], transport: channel.transport, scheduler: channel.scheduler,
  codec: channel.pipeline.codec, framer: channel.pipeline.framer,
  features: [queue!, log!] as const,
  middlewares: [connect({ transport: channel.transport }), contract({ version: '1.0.0' }), ping()]
})
const api: IServiceApi = { math: { double: async (value) => {
  console.error(await endpoint.send<ReturnType<IMainApi['parent']['prefix']>>('legacy-main', 'parent.prefix', 'double'))
  return value * 2
} } }
const local = definePlugin({ name: 'service', features: { math: defineFeature(() => api.math) }, install: () => ({}) })
const childHost = defineHost<Record<string, never>, never, readonly [typeof local]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
await childHost.use(local)
const served = await serveRemotePlugin({ host: childHost, contract: serviceContract, endpoint: { endpoint }, report: console.error })
let offClose: () => void = () => undefined
const closed = new Promise<void>((resolve) => {
  offClose = channel.transport.onTransportError!(() => resolve())
})
channel.activateReceive?.()
try {
  await closed
} finally {
  offClose()
  try { await served.close() } finally {
    try { await childHost.dispose() } finally { await channel.close() }
  }
}

// ${zh ? 'main.ts：Node 父进程；安装真实插件并调用，替换结果只证明原生就绪，不保证代理已经重新绑定。' : 'main.ts: Node parent; install and call the plugin. Replacement proves native readiness, not proxy rebinding.'}
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineHost } from '@migaia/plugin-host'
import { createEndpoint, connect, contract, ping } from '@migaia/rpc-core'
import type { IRemoteContract } from '@migaia/rpc-core/remote'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createNodeProcessLauncher, type INodeProcessHandle } from '@migaia/rpc-process/adapters/node-child-process'
import { createProcessPlugin, createProcessTransport, createNativeProcessOffer, type IProcessByteChannel, type IProcessPlugin } from '@migaia/rpc-process'

${declarations}
const host = defineHost<Record<string, never>, never, readonly [IProcessPlugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
const api: IMainApi = { parent: { prefix: (value) => 'main: ' + value } }
const plugin = createProcessPlugin<INodeProcessHandle>({
  name: 'service', contract: serviceContract,
  registrationOwner: { name: 'service', host },
  host: {
    disable: (name, options) => host.plugin.disable(name, options),
    enable: (name) => host.plugin.enable(name),
    replace: (name, candidate) => host.replace(name, candidate)
  },
  endpointFactory: async (channel) => {
    const [queue, log] = channel.features
    const endpoint = await createEndpoint({
      id: 'legacy-main', targetIds: [channel.peerId], transport: channel.transport, scheduler: channel.scheduler,
      codec: channel.pipeline.codec, framer: channel.pipeline.framer,
      features: [queue!, log!] as const,
      provider: { 'parent.prefix': (context) => context.success(api.parent.prefix(context.data as Parameters<IMainApi['parent']['prefix']>[0])) },
      middlewares: [connect({ transport: channel.transport }), contract({ version: '1.0.0' }), ping()]
    })
    return { endpoint }
  },
  deployment: {
    kind: 'spawn', channelKind: 'byte', wire: 'native', token: 'legacy-demo',
    offer: createNativeProcessOffer({ peer: { id: 'legacy-main', runtime: 'node' }, auth: 'legacy-demo', stream: false, capabilities: ['runtime-api@1'] }),
    supervision: {
      id: 'legacy-service', launcher: createNodeProcessLauncher(),
      budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
      scheduler: systemScheduler, isolation: 'best-effort', report: console.error,
      spec: {
        command: process.execPath, args: [...process.execArgv, fileURLToPath(new URL('./service.ts', import.meta.url))],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
      }
    },
    rawChannel: async (handle) => handle.channel!,
    establish: (raw, prepared) => createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator', offer: prepared.offer!, peerId: 'legacy-service', scheduler: prepared.scheduler,
      signal: prepared.signal, ipc: { ...prepared.session, log: () => undefined }, report: console.error
    })
  },
  report: console.error
})
try {
  const [handle] = await host.use(plugin)
  const math = handle.getFeature('math') as IServiceApi['math']
  console.log(await math.double(21))
  console.log(await plugin.replace({ strategy: 'stop-then-start' }))
} finally {
  await host.dispose()
}`
  return t(code(false), code(true))
})()

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
    example: stdioExample
  },
  onData: {
    summary: t('Subscribes to incoming chunks.', '订阅对端发来的每个数据块。'),
    params: { listener: t('Receives each chunk in order.', '按顺序接收每个数据块的监听函数。') },
    returns: t('A function that removes the listener.', '移除该监听的函数。'),
    example: stdioExample
  },
  onClose: {
    summary: t('Subscribes to the end of the carrier.', '订阅载体结束（关闭）的事件。'),
    params: {
      listener: t('Receives the close reason, if any.', '接收关闭原因（如果有）的监听函数。')
    },
    returns: t('A function that removes the listener.', '移除该监听的函数。'),
    example: stdioExample
  },
  close: {
    summary: t(
      'Closes the byte carrier once. Web Streams close publishes completion before callbacks, notifies every observer and attempts reader cancellation, writer abort and physical close even if an observer throws.',
      '一次关闭字节载体；网页流在回调前发布完成承诺，通知全部观察者，即使观察者抛错仍尝试取消读取、终止写入及关闭物理资源。'
    ),
    returns: t(
      'Nothing or a Promise resolved when closed. Web Streams failures reject this cached Promise with native AggregateError/PROCESS_CHANNEL_CLOSED: cause is the first original failure and errors contains every failure. Reentrant close shares the same result.',
      '无返回值或关闭后兑现的承诺；网页流失败以原生汇总错误及通道关闭码拒绝缓存承诺，原因指向首项原错，错误列表包含全部原错，重入关闭共享同一结果。'
    ),
    example: stdioExample
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
  [
    'bun-spawn',
    'createBunProcessLauncher',
    'Bun Node-compatible `child_process`',
    'Bun 的 Node 兼容 `child_process`'
  ],
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
  ['bun-socket', 'Bun Node-compatible `net`', 'Bun 的 Node 兼容 `net`'],
  [
    'deno-socket',
    'Deno Node-compatible `net` (no Windows pipes)',
    'Deno 的 Node 兼容 `net`（不支持 Windows 命名管道）'
  ]
] as const

/** Docs of `listenProcessByteChannel` (shared by every socket adapter). */
const listenSymbol: ISymbolDoc = {
  role: 'operation',
  purpose: t(
    'Listens on a local address (loopback TCP, Unix socket or Windows pipe) and hands each authenticated pending connection to `onConnection`.',
    '在本机地址监听，并把每个待认证连接交给 `onConnection`；配合 `dialProcessByteChannel` 与 `createProcessTransport` 完成双端通信。Deno 不支持 Windows 命名管道。'
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
  example: socketExample
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
    '连接到本机地址，返回尚未握手的原始字节通道；配合 `listenProcessByteChannel` 与 `createProcessTransport` 完成对端接纳及认证。'
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
  example: socketExample
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
  example: processStdioExample('open')
}

/** Symbols of launcher and socket adapters. */
const adapterSymbols: Record<string, ISymbolDoc> = {
  ...Object.fromEntries(
    launchers.map(([module, name, en, zh]) => [
      name,
      {
        role: 'factory',
        optionDocs: bootstrapOptionDocs,
        purpose: t(
          `Creates the launcher that starts child processes with ${en} for a full \`spawn\` source.`,
          `创建使用${zh}启动子进程的 launcher，配合 \`createProcessPeer\` 使用，用作完整 \`spawn\` 来源里监督配置中的 \`supervision.launcher\`。`
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
        example: processSpawnExample(module, name)
      } satisfies ISymbolDoc
    ])
  ),
  createElectronUtilityProcessLauncher: {
    role: 'factory',
    purpose: t(
      'Creates an Electron main-process utility launcher. Pair with `createProcessTransport` over explicit message sources; the application terminates the native handle. Stdin bootstrap and automatic child discovery are unsupported.',
      '创建在 Electron 主进程中启动实用进程的启动器；配合 `createProcessTransport` 手动组合消息通道，应用负责终止句柄。不支持标准输入启动帧或自动子进程来源。'
    ),
    returns: t(
      'An `IProcessLauncher` whose handles carry a message `channel`.',
      '一个 `IProcessLauncher`，其句柄带有消息通道 `channel`。'
    ),
    example: electronExample
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
    example: t(
      '// Unsupported: Windows Job launch always rejects, so no paired program can run with this launcher.',
      '// 不受支持：Windows Job 启动一律拒绝，此启动器无法运行双端程序。'
    )
  },
  'adapters/node-child-process:openProcessStdioChannel': stdioSymbol,
  'adapters/deno-command:openProcessStdioChannel': {
    ...stdioSymbol,
    example: processStdioExample('open', 'Deno')
  },
  ...Object.fromEntries(
    sockets
      .filter(([module]) => module !== 'bun-socket')
      .flatMap(([module]) => [
        [
          `adapters/${module}:dialProcessByteChannel`,
          {
            ...dialSymbol,
            example: processSocketExample(module, module === 'deno-socket' ? 'Deno' : 'Node')
          }
        ],
        [
          `adapters/${module}:listenProcessByteChannel`,
          {
            ...listenSymbol,
            example: processSocketExample(module, module === 'deno-socket' ? 'Deno' : 'Node')
          }
        ]
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
    example: stdioExample
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
    example: stdioExample
  },
  createAdapterNodeProcessLaunch: {
    role: 'operation',
    optionDocs: bootstrapOptionDocs,
    purpose: t(
      'Advanced: prepares bootstrap and channel construction for one actual Node child launch; the custom launcher still performs the native spawn and termination.',
      '高级用法：为自定义启动器准备一次 Node 启动的引导数据与通道构造；原生进程仍由调用方创建、终止并等待。'
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
    returns: t(
      'A prepared operation exposing bootstrap, assertActive() and createChildChannel(); it has not spawned a native process.',
      '返回含引导数据、活动检查和子通道构造的准备对象，此时尚未创建原生进程。'
    ),
    example: nodeLaunchExample
  },
  createAdapterSocketByteIO: {
    role: 'factory',
    purpose: t(
      'Wraps a Node `Duplex` stream (such as a `net.Socket`) as a byte channel.',
      '把 Node 的 `Duplex` 流（例如已连接的 `net.Socket`）包装成可用于握手的字节通道。'
    ),
    params: { socket: t('A connected `Duplex` you own.', '你持有的、已连接的 `Duplex` 流。') },
    returns: t('An `IProcessByteChannel`.', '一个可用于握手的 `IProcessByteChannel`。'),
    example: socketIoExample
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
      'Identifies the plugin registration that may be removed if its process cannot recover. In the full deployment form, supply the exact registration name and the Host that installs it. When failure reports remain unhandled, cleanup uses this Host to remove that registration. The name must equal options.name and the Host must provide unUse; missing or mismatched values reject configuration before process setup.',
      '指明进程无法恢复时可以移除的插件登记。完整部署形式必须提供准确登记名，以及实际安装此插件的 Host。故障报告一直无人处理时，清理会通过这个 Host 移除该登记。name 必须等于 options.name，host 必须提供 unUse 移除方法；缺少或不匹配会在建立进程连接前导致配置被拒绝。'
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
      'Names the one registration that failure cleanup may remove. Set it to the value of options.name for this plugin before constructing the full deployment. A different name rejects configuration, preventing failure handling for this plugin from removing another registration.',
      '指定故障清理可以移除的那一个登记。构造完整部署前，必须设为当前插件的 options.name。名称不同会导致配置被拒绝，避免此插件的故障处理误删其他登记。'
    )
  },
  'registrationOwner.host': {
    summary: t(
      'Supplies the Host that actually installs this plugin. Failure cleanup invokes its unUse method to remove the named registration and apply the Host rules for dependent plugins. Pass that original Host; an object without unUse is rejected before process setup. The caller continues to own the Host.',
      '提供实际安装此插件的 Host。故障清理调用它的 unUse 方法，移除指定登记，并按 Host 规则处理依赖该登记的插件。应传入原 Host；没有 unUse 方法的对象会在建立进程连接前被拒绝。Host 仍由调用方持有。'
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
            side === 'local'
              ? 'This transport already delivers complete messages. Set the local codec to identity, which passes native message values through without converting them to bytes. A byte codec is rejected during configuration, before the transport is activated.'
              : 'Set the expected peer codec to identity as well, meaning the peer sends message values without byte encoding. A different peer codec cannot match this complete-message transport and is rejected during configuration.',
            side === 'local'
              ? '此传输已经直接交付完整消息。本端 codec 必须设为 identity，即原样传递原生消息值，不把它们转换成字节。配置字节编解码器会在传输启用前被拒绝。'
              : '预期对端 codec 也必须设为 identity，即对端原样发送消息值，不转换成字节。其他对端编码无法匹配这种完整消息传输，会在配置时被拒绝。'
          ),
          values: {
            identity: t(
              side === 'local'
                ? 'Sends each original message value unchanged. Choose identity for the local side because the underlying transport already preserves message boundaries.'
                : 'Requires the peer to send unchanged message values too. This matches the local format; a byte-encoded peer format would not match.',
              side === 'local'
                ? '原样发送每个消息值。底层传输已经区分每条消息的边界，因此本端使用 identity，不再额外编码为字节。'
                : '要求对端也原样发送消息值，使双方格式一致；对端若把消息编码为字节，就无法匹配。'
            )
          }
        }
      ],
      [
        `staticAgreement.${side}.capabilities`,
        {
          summary: t(
            side === 'local'
              ? 'Lists the communication capabilities this local endpoint declares, in their fixed order. Use the same entries and order in the expected peer profile. This complete-message path does not negotiate a different list during setup.'
              : 'Lists the capabilities expected from the peer. Every entry and its position must match the local list. If a capability is missing or differently ordered, this message-transport path cannot negotiate a correction.',
            side === 'local'
              ? '按固定顺序列出本端声明的通信能力。预期对端配置必须使用相同条目和顺序。这条完整消息传输路径不会在建立连接时另行协商一份列表。'
              : '列出预期对端提供的通信能力。每个条目及其位置必须与本端相同。缺少能力或顺序不同时，此消息传输路径不会通过协商自动修正。'
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
    'adapters/node-child-process': {
      summary: t(
        'Use this adapter when a Node parent must start a child process and communicate through standard input and output. `createNodeProcessLauncher` creates the launcher using Node’s child-process API; `openProcessStdioChannel` opens the child’s own channel for manual setup.\n\nImport this platform subpath because the root exposes the general Peer API rather than the launcher. For an already running local service, use the matching socket adapter.',
        '父进程运行于 `Node`，需要启动子进程并通过标准输入输出通信时，使用此适配器。`createNodeProcessLauncher` 基于 `Node` 的子进程接口创建启动器；手动配置子进程时，`openProcessStdioChannel` 打开子进程自身的通信通道。\n\n根入口提供通用对端接口，平台启动器从此子路径导入。若要连接已经运行的本机服务，使用对应的套接字适配器。'
      ),
      example: processSpawnExample('node-child-process', 'createNodeProcessLauncher')
    },
    'adapters/bun-spawn': {
      summary: t(
        'Use this adapter when a Bun parent must start a child process and communicate through standard input and output. `createBunProcessLauncher` creates the launcher using Bun’s Node-compatible child-process API; `openProcessStdioChannel` opens the child’s own channel for manual setup.\n\nImport this platform subpath because the root exposes the general Peer API rather than the launcher. For an already running local service, use the matching socket adapter.',
        '父进程运行于 `Bun`，需要启动子进程并通过标准输入输出通信时，使用此适配器。`createBunProcessLauncher` 基于 `Bun` 提供的 `Node` 兼容子进程接口创建启动器；手动配置子进程时，`openProcessStdioChannel` 打开子进程自身的通信通道。\n\n根入口提供通用对端接口，平台启动器从此子路径导入。若要连接已经运行的本机服务，使用对应的套接字适配器。'
      ),
      example: processSpawnExample('bun-spawn', 'createBunProcessLauncher')
    },
    'adapters/deno-command': {
      summary: t(
        'Use this adapter when a Deno parent must start a child process and communicate through standard input and output. `createDenoProcessLauncher` creates the launcher using `Deno.Command`; `openProcessStdioChannel` opens the child’s own channel for manual setup.\n\nImport this platform subpath because the root exposes the general Peer API rather than the launcher. Deno requires permission to run child processes.',
        '父进程运行于 `Deno`，需要启动子进程并通过标准输入输出通信时，使用此适配器。`createDenoProcessLauncher` 基于 `Deno.Command` 创建启动器；手动配置子进程时，`openProcessStdioChannel` 打开子进程自身的通信通道。\n\n根入口提供通用对端接口，平台启动器从此子路径导入。`Deno` 还需要获准运行子进程。'
      ),
      example: processSpawnExample('deno-command', 'createDenoProcessLauncher')
    },
    'adapters/node-socket': {
      summary: t(
        'Use this adapter when Node must connect to or listen for another process on the same machine. `dialProcessByteChannel` opens a connection, and `listenProcessByteChannel` creates a listener for local TCP or Unix sockets.\n\nImport this platform subpath for socket operations, which the root does not export. Windows named pipes are also supported; remote-machine addresses are rejected.',
        '`Node` 需要连接或监听同一台机器上的其他进程时，使用此适配器。`dialProcessByteChannel` 打开连接，`listenProcessByteChannel` 创建监听端，支持本机回环地址与 `Unix` 套接字。\n\n根入口不导出这些套接字操作，因此从此平台子路径导入。也支持 `Windows` 命名管道，但拒绝远程机器地址。'
      ),
      example: processSocketExample('node-socket', 'Node')
    },
    'adapters/bun-socket': {
      summary: t(
        'Use this adapter when Bun must connect to or listen for another process on the same machine. `dialProcessByteChannel` opens a connection, and `listenProcessByteChannel` creates a listener for local TCP or Unix sockets.\n\nImport this platform subpath for socket operations, which the root does not export. Windows named pipes are also supported; remote-machine addresses are rejected.',
        '`Bun` 需要连接或监听同一台机器上的其他进程时，使用此适配器。`dialProcessByteChannel` 打开连接，`listenProcessByteChannel` 创建监听端，支持本机回环地址与 `Unix` 套接字。\n\n根入口不导出这些套接字操作，因此从此平台子路径导入。也支持 `Windows` 命名管道，但拒绝远程机器地址。'
      ),
      example: processSocketExample('bun-socket', 'Bun')
    },
    'adapters/deno-socket': {
      summary: t(
        'Use this adapter when Deno must connect to or listen for another process on the same machine. `dialProcessByteChannel` opens a connection, and `listenProcessByteChannel` creates a listener for local TCP or Unix sockets.\n\nImport this platform subpath for socket operations, which the root does not export. Windows named pipes and remote-machine addresses are unsupported.',
        '`Deno` 需要连接或监听同一台机器上的其他进程时，使用此适配器。`dialProcessByteChannel` 打开连接，`listenProcessByteChannel` 创建监听端，支持本机回环地址与 `Unix` 套接字。\n\n根入口不导出这些套接字操作，因此从此平台子路径导入。不支持 `Windows` 命名管道或远程机器地址。'
      ),
      example: processSocketExample('deno-socket', 'Deno')
    },
    'adapters/electron-utility-process': {
      summary: t(
        'Use this adapter in Electron’s main process to start a utility process and exchange messages with it. `createElectronUtilityProcessLauncher` creates the launcher, whose process handle includes a message channel.\n\nImport this platform subpath because the root does not export the Electron launcher; the `electron` dependency must be available. This uses Electron messages rather than the standard-input byte channel provided by the other launchers.',
        '在 `Electron` 主进程中，需要启动工具进程并与其交换消息时，使用此适配器。`createElectronUtilityProcessLauncher` 创建启动器，返回的进程句柄带有消息通道。\n\n根入口不导出 `Electron` 启动器，因此从此平台子路径导入，并确保已安装 `electron`。它使用 `Electron` 消息通信，不使用其他启动器的标准输入字节通道。'
      ),
      example: electronExample
    },
    'adapters/windows-job': {
      summary: t(
        'This entry describes the current Windows Job launcher placeholder, so you can inspect its unsupported capabilities before choosing a launcher. `createWindowsJobProcessLauncher` returns a launcher whose `launch` always rejects without creating a process.\n\nThe root does not export this platform-specific factory. For working process startup, choose a supported launcher such as `adapters/node-child-process`; this entry currently provides no Windows Job resource enforcement.',
        '此入口提供尚未实现的 `Windows Job` 进程启动器，供选择启动方式前查看其不支持的能力。`createWindowsJobProcessLauncher` 返回的启动器在调用 `launch` 时总是拒绝，不会创建进程。\n\n根入口不导出这个平台工厂。需要实际启动进程时，应选择 `adapters/node-child-process` 等已支持的入口；这里目前不提供 `Windows Job` 的资源限制能力。'
      ),
      example: adapterSymbols.createWindowsJobProcessLauncher!.example!
    }
  },
  symbols: {
    createProcessPeer: {
      role: 'factory',
      optionDocs: processPeerOptionMembers,
      purpose: t(
        'Opens a Runtime Peer to another process. Choose exactly one source: `spawn` (start and own a child), `connect` (dial a running service) or `listen` (accept sessions). A child started by the library may omit the source to connect back. Resolves after the authenticated handshake.',
        '打开一个与另一个进程通信的 Runtime Peer。三种来源必须且只能选择一种：`spawn`（启动并拥有子进程）、`connect`（连接运行中的服务）或 `listen`（接受会话）。由本库启动的子进程可以省略来源以连回父进程。配合 `isProcessChild` 判断子进程入口；独立服务需要先建立监听再连接。认证握手完成后 resolve。'
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
        '创建把一个进程连接安装进 PluginHost 的插件，与子进程端的 `createProcessPeer` 配合使用；宿主持有该连接并获得 `host.process`。高级重载接受完整的 `IProcessPluginOptions` 远程插件部署。'
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
      example: selfSpawnExample
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
      example: registrationExample,
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
      example: socketExample
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
      example: socketExample
    },
    createProcessJsonRpcChannel: {
      role: 'operation',
      optionDocs: processJsonRpcDocs,
      purpose: t(
        'Bridges a byte channel to a JSON-RPC peer (Python, Go...) and returns a protocol channel.',
        '把字节通道桥接到实现 `migaia.hello`、`migaia.describe`、`migaia.invoke` 与 `migaia.cancel` 协议的其他语言对端，配合 `createProcessPeer` 使用。握手后返回协议通道；对端须实现分帧和认证，不能连接任意 JSON-RPC 服务。'
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
      example: jsonRpcExample
    },
    createProcessChannelClosedError: {
      role: 'operation',
      purpose: t(
        'Creates the native `PROCESS_CHANNEL_CLOSED` error for custom channels, keeping `cause`.',
        '为自定义通道创建原生的 `PROCESS_CHANNEL_CLOSED` 错误，并把原始原因保留在 `cause` 上。'
      ),
      params: { cause: t('Original reason, kept on `cause`.', '原始原因，保存在 `cause` 上。') },
      returns: t('The error, not thrown.', '创建好的错误对象，不会被抛出。'),
      example: processErrorExample
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
      example: objectChannelExample
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
      returns: t(
        'The held channel together with optional bootstrap bytes; none mode returns the same channel without reading a frame.',
        '返回所持有通道与可选启动帧字节；无启动帧模式原样返回该通道，不消费字节。'
      ),
      example: processStdioExample('bootstrap')
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
      example: descriptorExample
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
      returns: t(
        'An IProcessByteChannel. If writer acquisition fails, the acquired reader lock is released; the caller keeps its original writer. Native TypeError/stack remains intact under PROCESS_CHANNEL_CONNECT_FAILED.',
        '返回进程字节通道；写入端获取失败会释放已取得读取锁，原写入端仍归调用方；原生类型错误及堆栈保持，附加通道连接失败语义码。'
      ),
      example: processStdioExample('web', 'Deno')
    },
    createAdapterProcessLaunch: {
      role: 'operation',
      optionDocs: bootstrapOptionDocs,
      purpose: t(
        'Advanced: prepares bootstrap and Web Stream channel construction for a custom runtime launcher; native spawning remains the caller responsibility.',
        '高级用法：为自定义运行时启动器准备引导数据与流通道构造，原生进程仍由调用方创建、终止并等待。'
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
      returns: t(
        'A prepared operation exposing bootstrap, assertActive() and createWebChannel(); it has not spawned a native process.',
        '返回含引导数据、活动检查和流通道构造的准备对象，此时尚未创建原生进程。'
      ),
      example: webLaunchExample
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
      example: adapterPeerExample
    },
    createAdapterProcessPlugin: {
      role: 'factory',
      optionDocs: processPluginDocs,
      purpose: t(
        'Advanced: `createProcessPlugin` with a custom runtime I/O loader.',
        '高级用法：使用自定义运行时 I/O 加载器的 `createProcessPlugin`，用于尚未支持的运行时。'
      ),
      params: {
        options: t(
          'Either complete IProcessPluginOptions with deployment, or symmetric IRuntimeProcessPluginOptions with spawn/connect/listen and provide/expose.',
          '可选带部署字段的完整进程插件选项，或带启动、连接、监听及提供公开字段的对称运行时进程插件选项。'
        ),
        runtime: t(
          'Loader whose `load()` returns `{ processRuntimeIO }`.',
          '其 `load()` 返回 `{ processRuntimeIO }` 的加载器。'
        )
      },
      returns: t(
        'Full deployment returns IProcessPlugin, including its deployment controls; symmetric source returns the Core runtime plugin for the process slot and does not promise replace.',
        '完整部署返回含部署控制的进程插件；对称来源返回进程槽位的核心运行时插件，不承诺提供替换方法。'
      ),
      example: adapterPluginExample
    },
    PROCESS_HANDSHAKE_MAX_FRAME_BYTES: {
      role: 'constant',
      purpose: t(
        'Largest unauthenticated handshake frame accepted (65536 bytes); larger frames are rejected at the length header.',
        '可接受的未认证握手帧的最大长度（65536 字节）；更大的帧在读取长度头时即被拒绝。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_ENV: {
      role: 'constant',
      purpose: t(
        'Environment variable (`MIGAIA_RPC_RUNTIME_API_BOOTSTRAP`) that marks a library-launched child; sandbox and container wrappers must forward it.',
        '标记由本库启动的子进程的环境变量（`MIGAIA_RPC_RUNTIME_API_BOOTSTRAP`）；沙箱与容器包装器必须转发它。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_ENV_VERSION: {
      role: 'constant',
      purpose: t(
        'Value (`1`) of `PROCESS_RUNTIME_API_ENV` that selects the current bootstrap format.',
        '环境变量 `PROCESS_RUNTIME_API_ENV` 的取值（`1`），用于选择当前的启动数据格式。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_KIND: {
      role: 'constant',
      purpose: t(
        '`kind` of the bootstrap frame (`rpc-runtime-api-bootstrap`) a launcher writes before the handshake.',
        'launcher 在协议握手之前写入子进程的启动帧所携带的类型标识 `kind`（`rpc-runtime-api-bootstrap`）。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_VERSION: {
      role: 'constant',
      purpose: t(
        'Version (`1`) of the bootstrap frame accepted by launch and child.',
        '启动端与子进程端都必须接受的启动帧格式版本号（`1`）。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS: {
      role: 'constant',
      purpose: t(
        'How long a child waits for the bootstrap frame (10000 ms) before the normal handshake deadline starts.',
        '子进程等待启动帧的时长（10000 毫秒），之后才开始正常的握手截止计时。'
      ),
      example: bootstrapExample
    },
    PROCESS_RUNTIME_API_FINGERPRINT_PREFIX: {
      role: 'constant',
      purpose: t(
        'Prefix (`rpc-process-`) of launcher-owned launch identities shown in details instead of native PIDs.',
        'launcher 生成的启动身份前缀（`rpc-process-`），在运行详情中代替原生 PID 显示。'
      ),
      example: bootstrapExample
    },
    ProcessPluginWire: {
      role: 'constant',
      purpose: t(
        'Protocols a process connection can speak: `native` (this library) or `jsonrpc` (other languages).',
        '进程连接可以使用的协议：`native`（本库协议）或 `jsonrpc`（其它语言）。'
      ),
      example: wireExample
    },
    RPC_PROCESS_ERROR_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/rpc/process`) of errors owned by this package; call errors come from `@migaia/rpc/core`.',
        '本包自有错误的 `source` 值（`@migaia/rpc/process`）；超时、取消等调用层错误来自 `@migaia/rpc/core`。'
      ),
      example: processErrorExample
    },
    RpcProcessErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: processErrorExample
    },
    ...adapterSymbols
  },
  types: {
    RuntimeEventName: {
      summary: t(
        'Type-only union of supported runtime lifecycle event names. This package re-exports the type; use a literal such as exit when subscribing.',
        '仅类型导出的运行时生命周期事件名联合；本包不导出同名运行常量，订阅时可使用退出等事件字面量。'
      ),
      members: {},
      example: `import type { RuntimeEventName } from '@migaia/rpc-process'
const event: RuntimeEventName = 'exit'
console.log(event)`
    },
    ...runtimePairedTypes('process'),
    IRuntimeProcessPeerOptions: {
      summary: t(
        'Options of `createProcessPeer()`: one source plus authentication and the Core Peer options.',
        '`createProcessPeer()` 的选项：一种来源，加上认证设置与 Core Peer 的通用选项。'
      ),
      example: namedSocketExample,
      members: processPeerOptionMembers
    },
    IRuntimeProcessPluginOptions: {
      summary: t(
        'Options of `createProcessPlugin()` (simple form).',
        '`createProcessPlugin()` 简单形式所使用的选项。'
      ),
      example: pluginExample,
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
      example: peerExample,
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
            'Session secret; shorthand generates it once when the source is normalized and reuses it across supervised generations. A restart does not rotate it.',
            '会话密钥；简写来源规范化时随机生成一次，由监督代次复用，重启不会轮换。'
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
      example: legacyReplaceExample,
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
            'Full byte spawn requires explicit `native` or `jsonrpc`; message spawn omits wire. Only shorthand and full connect supply their own defaults.',
            '完整字节启动必须显式选择 `native` 或 `jsonrpc`；消息启动省略协议，简写及完整连接分别提供自己的默认规则。'
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
      example: socketExample,
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
      example: registrationExample,
      members: {
        sessionOptions: {
          summary: t(
            'Builds result-deduplication settings and call limits for one accepted session. Result deduplication lets retries of an identified operation reuse its stored outcome. Pass the session identity received by listenRegistrations; its listener example below shows how to obtain that identity.',
            '为一个已接纳会话生成结果去重配置和调用限制。结果去重让带同一操作标识的重试复用已保存结果。应传入 listenRegistrations 提供的会话身份；下方监听示例展示了如何取得它。'
          ),
          params: {
            identity: t(
              'Session identity from the accepted connection.',
              '来自已接受连接的会话身份。'
            )
          },
          returns: t('`{ idempotency, limits }`.', '`{ idempotency, limits }` 配置对象。')
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
          example: registrationListenerExample
        },
        attachRegistration: {
          summary: t(
            'Registers a supervised process with this failure-management object. The supervisor starts and restarts the process; this registration adds reporting and eventual removal if recovery fails. Supply the binding and cleanup owner shown in the complete usage example above.',
            '把由监督器管理的进程登记到此故障管理对象。监督器负责启动和重启进程；登记后增加故障报告，以及无法恢复时的最终移除处理。上方完整示例展示了需要传入的绑定和清理所有者。'
          ),
          params: {
            name: t('Registration name, the plugin `name`.', '登记名称，即插件的 `name`。'),
            binding: t('Ownership, supervisor and health mode.', '所有权、监督器与健康检查方式。'),
            liquidation: t('Who removes it when liquidated.', '被清算时由谁负责移除它。')
          },
          returns: t('An `IProcessRegistration`.', '一个登记对象 `IProcessRegistration`。')
        },
        callGuard: {
          summary: t(
            'Returns a check that can refuse remote calls when this registration is unhealthy or terminal, meaning it cannot recover under the current restart policy. Call guard.beforeDispatch() before each request, as shown above. Calls that bypass the guard do not receive this check.',
            '返回远程调用前的检查对象。登记不健康，或进入 terminal、无法按当前重启规则恢复时，它可以拒绝调用。应像上方示例一样，在每次请求前调用 guard.beforeDispatch()；绕过它的调用不会执行这项检查。'
          ),
          params: { name: t('Registration name.', '要守卫的登记名称。') },
          returns: t('A remote call guard.', '远程调用守卫对象。')
        },
        inspect: {
          summary: t(
            'Reads the current state of one registration by id. Use it when an application needs a point-in-time view without retaining the registration object. It returns undefined for an unknown id. The example above compares this view with registration.inspect().',
            '按 id 读取一个登记的当前状态。应用需要即时查看状态、又没有保留登记对象时使用。id 未找到会返回 undefined。上方示例把它与 registration.inspect() 的结果进行对照。'
          ),
          params: { id: t('Registration id.', '要查询的登记 id。') },
          returns: t(
            'An `IProcessResilienceSnapshot`, or `undefined`.',
            '一个快照 `IProcessResilienceSnapshot`；未知 id 时为 `undefined`。'
          )
        },
        onTerminal: {
          summary: t(
            'Subscribes to registrations entering terminal, the state where the current restart policy can no longer recover the process. The listener receives the registration snapshot so the application can respond. The returned function removes the subscription; call it during cleanup as shown above.',
            '订阅登记进入 terminal 的事件。该状态表示当前重启规则已无法恢复进程。监听器收到登记快照后，应用可以作出处理。返回的函数用于解除订阅，应像上方示例一样在清理时调用。'
          ),
          params: { listener: t('Receives the snapshot.', '接收登记快照的监听函数。') },
          returns: t('An unsubscribe function.', '取消订阅的函数。')
        },
        close: {
          summary: t(
            'Stops this failure-management object, closes listeners it owns and detaches its registrations. It does not own all resources involved in a connection: the accepting application still closes accepted endpoints and sessions, while the code that started execution still disposes its supervisor. The final cleanup block above shows these separate operations.',
            '停止当前故障管理对象，关闭它持有的监听并解除登记。连接涉及的资源并非全部由它持有：接收连接的应用仍要关闭已接纳端点和会话，启动执行单元的代码仍要释放监督器。上方最后的清理代码分别执行这些操作。'
          ),
          returns: t(
            'Resolves after owned governance resources close; it does not dispose caller-owned endpoints or supervisors.',
            '治理资源关闭后完成，不会代替调用方释放端点或监督器。'
          )
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
      example: stdioExample,
      members: byteChannelMembers
    },
    IProcessMessageChannel: {
      summary: t(
        'Message channel (Electron utility process).',
        '消息通道，用于与 Electron utility process 互相发送消息。'
      ),
      example: electronExample,
      members: {
        kind: {
          summary: t('Always `message`: a message channel.', '固定为 `message`，表示这是消息通道。')
        },
        send: {
          summary: t('Sends one structured message.', '向 utility process 发送一条结构化消息。'),
          params: { value: t('Message to send.', '要发送的消息对象。') },
          returns: t('Nothing or a Promise.', '无返回值或一个 Promise。'),
          example: electronExample
        },
        onMessage: {
          summary: t('Subscribes to incoming messages.', '订阅从对端接收到的消息。'),
          params: { listener: t('Receives each message.', '接收每条消息的监听函数。') },
          returns: t('A function that removes the listener.', '移除该监听的函数。'),
          example: electronExample
        },
        onClose: { ...(byteChannelMembers.onClose as IMemberDoc), example: electronExample },
        close: {
          ...(byteChannelMembers.close as IMemberDoc),
          summary: t(
            'Closes the logical message carrier; the native process remains with its original handle owner.',
            '关闭逻辑消息载体；原生进程仍由原始句柄所有者终止并等待。'
          ),
          returns: t(
            'The logical carrier is closed; this does not terminate the process.',
            '逻辑载体已关闭，不会因此终止原生进程。'
          ),
          example: electronExample
        }
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
          returns: t(
            'The cached close Promise; repeated calls return the same reference and completion.',
            '返回缓存的关闭承诺，重复调用共享同一引用及完成结果。'
          ),
          example: socketExample
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
          example: socketExample
        },
        close: {
          summary: t('Rejects and closes the connection.', '拒绝并关闭该待认证的连接。'),
          returns: t('Resolves when closed.', '关闭完成后 resolve。'),
          example: socketExample
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
      example: legacyReplaceExample,
      members: {
        replace: {
          summary: t(
            'Replaces the child process while the Host keeps running. Choose stop-then-start to stop the old child before starting its replacement, or start-then-switch to start the replacement before switching over. The complete deployment example above demonstrates replacement; inspect the returned strategy and outcome.',
            '在 Host 继续运行时替换子进程。stop-then-start 表示先停止旧子进程，再启动新进程；start-then-switch 表示先启动替代进程，再切换过去。上方完整部署示例展示了替换操作，调用后应检查返回的策略和结果。'
          ),
          params: { options: t('`{ spec?, strategy? }`.', '替换选项 `{ spec?, strategy? }`。') },
          returns: t(
            'The strategy used and its outcome or new plugin.',
            '采用的策略，以及替换结果或新插件。'
          )
        }
      }
    },
    IProcessPluginOptions: {
      summary: t(
        'Full options of the advanced `createProcessPlugin()` overload.',
        '高级 `createProcessPlugin()` 重载使用的完整选项。'
      ),
      example: legacyReplaceExample,
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
          summary: t(
            'Closes this dialled connection under its supervisor.',
            '通过所属监督器关闭此已拨号连接。'
          ),
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
          example: registrationExample
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
      example: descriptorExample,
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
      example: registrationExample,
      members: {
        restart: {
          summary: t('Restarts the registered unit.', '重启该登记对应的执行单元。'),
          returns: t('A ready outcome of the new generation.', '新代次的就绪结果。'),
          example: registrationExample
        },
        inspect: {
          summary: t('Reads the current resilience snapshot.', '读取该登记当前的治理快照。'),
          returns: t('The snapshot or `undefined`.', '快照对象或 `undefined`。'),
          example: registrationExample
        },
        close: {
          summary: t(
            'Detaches terminal diagnostics and the supervisor subscription. It does not close the Peer, terminate the process or dispose its supervisor.',
            '解除终态诊断与监督器订阅，不关闭对端连接、不终止进程，也不释放监督器；调用方仍须关闭连接并释放监督器。'
          ),
          returns: t(
            'Resolves after governance detachment; the original Peer and supervisor retain their owners.',
            '治理附加解除后完成，原对端连接与监督器仍由各自所有者释放。'
          ),
          example: registrationExample
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
      example: registrationListenerExample,
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
          example: registrationListenerExample
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
    ProcessPluginWire: {
      summary: t('Wire protocols of process connections.', '进程连接使用的线路协议。'),
      values: {
        native: t(
          '`native`: this library protocol with streams and cancellation. Process calls reject transfer lists, including empty lists; portable binary data is copied.',
          '`native`：本库协议，支持流与取消；进程调用拒绝转移列表，包括空列表，可移植二进制数据按复制处理。'
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
          '`PROCESS_CHANNEL_CONNECT_FAILED`: connecting to the other process, starting it, or setting up part of the channel failed. If the system call that starts the process or opens its streams throws, you get that same error object with its type, stack and fields intact. Its `source` becomes this package and its system `code` (such as `ENOENT`) becomes `PROCESS_CHANNEL_CONNECT_FAILED`, one stable value to check. An already wrapped failure keeps the original on `cause`.',
          '`PROCESS_CHANNEL_CONNECT_FAILED`：连接另一个进程、启动进程，或建立通道的某一部分时失败。如果是启动进程或打开其数据流的系统调用直接抛错，你拿到的仍是那个错误对象，类型、堆栈和其他字段都不变；只是 `source` 被设为本包，系统错误码 `code`（例如 `ENOENT`）被换成 `PROCESS_CHANNEL_CONNECT_FAILED`，方便用一个固定的值判断。如果错误原本已经被包装过，最初的错误仍保留在 `cause` 上。'
        ),
        listenFailed: t(
          '`PROCESS_CHANNEL_LISTEN_FAILED`: preparing to listen, or binding the listening address, failed. You receive the same system error object, with its type, stack and other fields unchanged; it only gains this package as `source` and `PROCESS_CHANNEL_LISTEN_FAILED` as `code`. Both the reported error and the rejected promise keep the original `cause` chain.',
          '`PROCESS_CHANNEL_LISTEN_FAILED`：准备监听或绑定监听地址时失败。你拿到的仍是原来的系统错误对象，类型、堆栈和其他字段都不变，只是多了 `source`（本包）和 `code`（`PROCESS_CHANNEL_LISTEN_FAILED`），可以据此判断错误来自哪里、属于哪一类。无论错误是被报告出去，还是作为 Promise 的拒绝原因返回，原来的 `cause` 链都保留。'
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
      install: pluginExample,
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
