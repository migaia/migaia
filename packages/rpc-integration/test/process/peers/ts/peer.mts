import { prepareRuntimeProviderAssembly } from '../../../../../rpc-host/dist/remote/runtime-api/peer.js'
import {
  compileRuntimeMethods,
  type IRuntimeMethodEntry
} from '../../../../../rpc-host/dist/remote/runtime-api/catalog.js'
import { describeRemoteMethods } from '../../../../../rpc-host/dist/remote/serve-methods.js'
import { createRemoteLayerError } from '../../../../../rpc-host/dist/remote/error.js'
import { RpcRemoteLayerErrorCode } from '../../../../../rpc-host/dist/remote/error-code.js'
import { RemoteMethodName } from '../../../../../rpc-host/dist/remote/constants.js'
import { RuntimeApiMode } from '../../../../../rpc-host/dist/remote/runtime-api/constants.js'
import { PeerMethod, PeerText } from './text.js'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createProcessTransport } from '../../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../../rpc-plugin-process/dist/process/offer.js'
import { openProcessStdioChannel } from '../../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { type IRemoteChannel, type IRemoteContract } from '@migaia/rpc-host/plugin'
import {
  RpcCoreErrorCode,
  RPC_CORE_ERROR_SOURCE,
  type IRpcContext,
  type IRpcCoreErrorCode
} from '@migaia/rpc-host'
import { attachErrorIdentity } from '@migaia/utils/error'
import { serializeRpcError } from '@migaia/rpc-contract'
import { endpointFor } from './runtime.js'

/** Preserve this peer's historical wire diagnostics without constructing or minting Core errors. */
function peerDiagnosticError(code: IRpcCoreErrorCode, message: string, cause?: unknown): Error {
  /** The original native error and exact cause remain the transmitted graph's held objects. */
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = PeerText.rpcDiagnosticFamily
  return attachErrorIdentity(error, { source: RPC_CORE_ERROR_SOURCE, code })
}

/** CLI selects physical deployment; protocol and framing remain public package concerns. */
const { values } = parseArgs({
  options: {
    stdio: { type: 'boolean' },
    descendant: { type: 'boolean' },
    'peer-id': { type: 'string', default: 'caller' },
    role: { type: 'string', default: 'responder' },
    'listen-unix': { type: 'string' },
    'connect-unix': { type: 'string' },
    host: { type: 'boolean' },
    contract: { type: 'string' },
    'non-idempotent-request': { type: 'boolean' },
    bootstrap: { type: 'string', default: 'none' },
    'auth-fd': { type: 'string' },
    wire: { type: 'string', default: 'native' }
  }
})
/** Fixed status output omits payloads, exception messages and authentication material. */
const report = (error: unknown): void => {
  /** Only package code identifies a failed lifecycle operation. */
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN'
  process.stderr.write(`${PeerText.failurePrefix}${String(code)}\n`)
}
/** The vector owns the portable service description, shared with non-JS oracle cases. */
const declaredContract = JSON.parse(
  readFileSync(
    values.contract ??
      (process.env.RPC_PEERS_VECTOR_ROOT
        ? join(process.env.RPC_PEERS_VECTOR_ROOT, 'remote-contract.json')
        : new URL('../../../../schema/vectors/remote-contract.json', import.meta.url)),
    'utf8'
  )
).contracts[0].value as IRemoteContract
/** The real fixture declaration is conservative when exercising non-idempotent departure. */
const contract: IRemoteContract = values['non-idempotent-request']
  ? {
      ...declaredContract,
      features: {
        f: {
          methods: {
            ...declaredContract.features.f!.methods,
            request: { mode: 'request', idempotent: false }
          }
        }
      }
    }
  : declaredContract
/** Received one-way values are observed independently of outbound delivery promises. */
const received: unknown[] = []
/** Provider-observed cancellation reasons are independently queried after the caller settles. */
const aborts: unknown[] = []
/** Fixed foreign conformance business state, matching the other independent language peers. */
class PeerBusinessState {
  /** Foreign Host vectors install exactly their one declared fixture target, never a resolver. */
  #installed: boolean
  /** Revisions describe real fixture installation changes without a generic Host mutation layer. */
  #revision = 0
  /** Actual application methods are compiled and registered by the canonical runtime owner. */
  readonly provide = {
    p: {
      f: {
        request: (payload: unknown) => {
          this.#active()
          return (payload as unknown[])[0]
        },
        oneWay: (payload: unknown) => {
          this.#active()
          received.push((payload as unknown[])[0])
        },
        generator: (payload: unknown) => this.#generator(payload),
        asyncGenerator: (payload: unknown) => this.#asyncGenerator(payload)
      }
    }
  }

  /** Plugin vectors start installed; Host vectors require an explicit real wire use request. */
  constructor(hostProfile: boolean) {
    this.#installed = !hostProfile
  }

  /** Retain the original closed-provider boundary after explicit foreign target removal. */
  #active(): void {
    if (!this.#installed) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
  }

  /** Return only the one fixed target described by the published foreign conformance vector. */
  #entry() {
    return {
      name: contract.plugin,
      state: 'enabled',
      revision: this.#revision,
      features: Object.keys(contract.features)
    }
  }

  /** A foreign use request changes this fixture target only; no definition/catalog is accepted. */
  #use = (payload: unknown) => {
    if (!Array.isArray(payload) || payload[0] !== contract.plugin)
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    if (!this.#installed) {
      this.#installed = true
      this.#revision += 1
    }
    return this.#entry()
  }

  /** Explicit target removal preserves the foreign wire result and disables subsequent business. */
  #unUse = (payload: unknown) => {
    if (!Array.isArray(payload) || payload[0] !== contract.plugin)
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    if (this.#installed) {
      this.#installed = false
      this.#revision += 1
    }
    return { ok: true }
  }

  /** The safe foreign snapshot reports only this static fixture target's actual installation. */
  #inspect = () => ({ revision: this.#revision, plugins: this.#installed ? [this.#entry()] : [] });

  /** Stream values come from the same actual application state as scalar and notify methods. */
  *#generator(payload: unknown): Generator<unknown> {
    this.#active()
    const input = (payload as unknown[])[0]
    yield* Array.isArray(input) ? input : [input, input, input]
  }

  /** Async streams retain their original independent iterator and fixed fallback cardinality. */
  async *#asyncGenerator(payload: unknown): AsyncGenerator<unknown> {
    this.#active()
    const input = (payload as unknown[])[0]
    for (const item of Array.isArray(input) ? input : [input, input, input]) yield item
  }

  /** Add only the three published foreign control vectors to the actual compiled provider list. */
  methods(): readonly IRuntimeMethodEntry[] {
    const methods = [...compileRuntimeMethods(this.provide, contract)]
    if (values.host)
      for (const [name, method] of [
        [RemoteMethodName.hostUse, this.#use],
        [RemoteMethodName.hostUnUse, this.#unUse],
        [RemoteMethodName.hostInspect, this.#inspect]
      ] as const)
        methods.push({
          name,
          method,
          receiver: this,
          supportedModes: [RuntimeApiMode.request],
          declaration: { mode: 'request', idempotent: false }
        })
    return methods
  }
}

/** The foreign executable owns its one published application state across accepted connections. */
const business = new PeerBusinessState(values.host ?? false)
/** Each connection borrows this Host and owns its endpoint service. */
const services = new Set<ForeignPeerSession>()
/** Actual public service-port calls and settlements remain observable after EOF ends the wire. */
const cleanups: Array<{ calls: number; settled: number; providerAborts: number }> = []
/** Close intentions fence new peer-originated requests while admitted providers drain. */
let closing = false
/** Stdio fault actions run after the next physical response write, outside the protocol owner. */
let pendingFault: string | undefined

/** Execute one fixture fault only after the production byte write has settled. */
function afterPhysicalWrite(): void {
  if (!pendingFault) return
  const fault = pendingFault
  pendingFault = undefined
  if (fault === PeerMethod.crash) process.exit(17)
  if (fault === PeerMethod.pause) process.kill(process.pid, 'SIGSTOP')
  else
    for (;;) {
      /* Keep this process busy until its owner terminates it. */
    }
}

/** Serve an authenticated session through production remote dispatch and stream ownership. */
async function serve(channel: IRemoteChannel): Promise<void> {
  /** Endpoint owns the canonical request, control and stream state. */
  const runtime = await endpointFor(channel, 'ts-peer')
  runtime.endpoint.provide(PeerMethod.echo, (context) => context.success(context.data))
  runtime.endpoint.provide(PeerMethod.received, (context) =>
    context.success({ count: received.length, values: received })
  )
  runtime.endpoint.provide(PeerMethod.aborts, (context) => context.success(aborts))
  runtime.endpoint.provide(PeerMethod.trace, (context) => context.success(context.trace ?? null))
  /** Public success flushes before faulting the same process rather than a wrapper or simulator. */
  for (const method of [PeerMethod.busy, PeerMethod.pause, PeerMethod.crash])
    runtime.endpoint.provide(method, (context) => {
      pendingFault = method
      return context.success(PeerText.ack)
    })
  runtime.endpoint.provide(PeerMethod.error, () => {
    /** Two original errors stay reachable in the transmitted error graph. */
    const cause = peerDiagnosticError(RpcCoreErrorCode.internal, PeerText.cause)
    throw peerDiagnosticError(RpcCoreErrorCode.internal, PeerText.error, cause)
  })
  runtime.endpoint.provide(PeerMethod.wait, async (context: IRpcContext) => {
    await new Promise<void>((resolve) =>
      context.signal.addEventListener(
        'abort',
        () => {
          aborts.push(
            serializeRpcError(context.signal.reason, { report: ({ error }) => report(error) })
          )
          resolve()
        },
        { once: true }
      )
    )
    return context.success(context.signal.reason)
  })
  /** Core reports parsed close intentions after validating the received control payload. */
  runtime.endpoint.hooks.on((event) => {
    if (event.error !== undefined) report(event.error)
    if (event.name === 'control.close') closing = true
  })
  /** The same canonical provider/directory/stream owner serves the fixed foreign vector. */
  const assembly = prepareRuntimeProviderAssembly({
    methods: business.methods(),
    streams: channel.agreement.capabilities.includes('stream@1'),
    generations: false,
    supports: (_peerId, capability) => channel.agreement.capabilities.includes(capability),
    remoteNode: () => undefined,
    bindRemoteNode: () => undefined,
    describe: () =>
      describeRemoteMethods(
        [contract],
        { name: 'ts-peer', instanceId: 'ts-peer' },
        values.host ?? false
      )
  })
  assembly.install(runtime.endpoint as unknown as Parameters<typeof assembly.install>[0])
  /** Publish all actual providers before releasing the original native receive queue. */
  ;(channel as IRemoteChannel & { activateReceive?: () => void }).activateReceive?.()
  new ForeignPeerSession(channel, runtime)
}

/** One accepted physical session owns its original endpoint/channel cleanup receipt. */
class ForeignPeerSession {
  /** The admitted native channel is closed only after its actual endpoint releases. */
  #channel: IRemoteChannel
  /** The same canonical endpoint owns request, stream and pending-provider cancellation. */
  #runtime: Awaited<ReturnType<typeof endpointFor>>
  /** Passive original cleanup counts remain observable after native EOF. */
  #cleanup = { calls: 0, settled: 0, providerAborts: 0 }
  /** EOF and explicit shutdown share the original first cleanup Promise. */
  #closed: Promise<void> | undefined
  /** Native failure observation is removed before physical resource release. */
  #releaseFailure: () => void = () => undefined

  /** Observe only this already-admitted session without creating another provider owner. */
  constructor(channel: IRemoteChannel, runtime: Awaited<ReturnType<typeof endpointFor>>) {
    this.#channel = channel
    this.#runtime = runtime
    cleanups.push(this.#cleanup)
    services.add(this)
    this.#releaseFailure =
      channel.transport.onTransportError?.(() => {
        void this.close().catch(report)
      }) ?? this.#releaseFailure
  }

  /** Preserve original endpoint-before-channel order and leave cleanup counts exact on failures. */
  close = (): Promise<void> => {
    if (this.#closed) return this.#closed
    ;(0, this.#releaseFailure)()
    this.#closed = (async () => {
      try {
        this.#cleanup.calls += 1
        await this.#runtime.endpoint.dispose()
        this.#cleanup.settled += 1
        this.#cleanup.providerAborts = aborts.length
        await this.#channel.close()
      } finally {
        services.delete(this)
      }
    })()
    return this.#closed
  }
}

/** Run one actual public-API client exchange for ordered native interop pairs. */
async function initiate(channel: IRemoteChannel): Promise<void> {
  /** The public endpoint generates request IDs and routes. */
  const runtime = await endpointFor(channel, 'ts-peer')
  /** The initiator has installed its empty provider set before receiving replies. */
  ;(channel as IRemoteChannel & { activateReceive?: () => void }).activateReceive?.()
  try {
    /** Stable fixture payload compares value semantics across independent languages. */
    const payload = { echo: 'typescript', number: 1 }
    /** Public send returns a native response context with the peer's value. */
    const answer = await runtime.endpoint.send(channel.peerId, PeerMethod.echo, payload, {
      timeoutMs: 3000
    })
    if (JSON.stringify(answer) !== JSON.stringify(payload))
      throw peerDiagnosticError(RpcCoreErrorCode.internal, PeerText.mismatch)
    if (!closing) await runtime.endpoint.announceClose(channel.peerId, { drainMs: 0 })
    process.stderr.write(PeerText.result)
  } finally {
    await runtime.endpoint.dispose()
    await channel.close()
  }
}

/** Physical I/O enters through public process adapters before any provider exists. */
async function main(): Promise<void> {
  if (values.wire !== 'native') {
    process.stderr.write(PeerText.bridgeUnsupported)
    process.exitCode = 2
    return
  }
  /** One native proposal advertises exactly production-installed control and stream support. */
  const offer = createNativeProcessOffer({
    peer: { id: 'ts-peer', runtime: 'node' },
    stream: true,
    capabilities: ['runtime-api@1', 'abort@1', 'wire-error@1']
  })
  if (values['listen-unix']) {
    /** The inherited descriptor is fixture-owned; only the adapter performs authentication. */
    const token = values['auth-fd'] ? readFileSync(Number(values['auth-fd']), 'utf8') : undefined
    if (token === undefined) {
      process.stderr.write(PeerText.listenerUnsupported)
      process.exitCode = 2
      return
    }
    await listenProcessByteChannel({
      address: values['listen-unix'],
      serviceId: 'rpc-peer-ts',
      auth: {
        mode: 'required',
        verify(auth) {
          if (auth !== token)
            throw peerDiagnosticError(RpcCoreErrorCode.authenticationFailed, PeerText.authRejected)
          return 'peer-test'
        }
      },
      report,
      onConnection: async (pending) => {
        /** One unique identity attributes diagnostics without including credentials. */
        const identity = randomUUID()
        const admitted = await pending.accept({
          peerId: values['peer-id']!,
          offer,
          report,
          ipc: { connectionId: identity, sessionId: identity, log: () => undefined }
        })
        await serve(admitted.channel)
      }
    })
    process.stderr.write(`${PeerText.ready}${process.pid}\n`)
    return
  }
  /** Both stdio and dial use the canonical channel's own framed handshake. */
  const opened = values['connect-unix']
    ? { channel: await dialProcessByteChannel({ address: values['connect-unix'] }) }
    : await openProcessStdioChannel({ bootstrap: values.bootstrap === 'stdin' ? 'stdin' : 'none' })
  /** A bootstrap secret stays only in this closure and handshake auth field. */
  const token =
    'bootstrap' in opened && opened.bootstrap
      ? new TextDecoder().decode(opened.bootstrap)
      : undefined
  /** One signal tracks EOF while allowing service cleanup after the protocol stops. */
  const controller = new AbortController()
  opened.channel.onClose(() => controller.abort())
  process.stderr.write(`${PeerText.ready}${process.pid}\n`)
  const options = {
    peerId: values['peer-id']!,
    offer,
    report,
    signal: controller.signal,
    ipc: { connectionId: 'stdio', sessionId: 'stdio', log: () => undefined }
  }
  /** Preserve the bootstrap decoder's exact channel identity while observing its opaque writes. */
  const physicalWrite = opened.channel.write
  Object.assign(opened.channel, {
    write: async (chunk: Uint8Array) => {
      await physicalWrite(chunk)
      afterPhysicalWrite()
    }
  })
  const channel = await createProcessTransport(
    opened.channel,
    values.role === 'initiator'
      ? { ...options, role: 'initiator' }
      : {
          ...options,
          role: 'responder',
          auth:
            token === undefined
              ? { mode: 'none' }
              : {
                  mode: 'required',
                  verify(auth) {
                    if (auth !== token)
                      throw peerDiagnosticError(
                        RpcCoreErrorCode.authenticationFailed,
                        PeerText.authRejected
                      )
                  }
                }
        }
  )
  if (values.role === 'initiator') await initiate(channel)
  else {
    /** A real descendant has no inherited protocol pipes and is reaped on EOF. */
    const child = values.descendant ? spawn('/bin/sleep', ['600'], { stdio: 'ignore' }) : undefined
    const exited = child ? once(child, 'exit') : undefined
    try {
      await serve(channel)
      if (!controller.signal.aborted)
        await new Promise<void>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      for (const service of services) await service.close()
    } finally {
      child?.kill()
      await exited
    }
  }
  process.stderr.write(PeerText.cleanupPrefix + JSON.stringify(cleanups) + '\n')
}

main().catch((error: unknown) => {
  report(error)
  process.exitCode = 1
})
