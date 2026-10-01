import { PeerMethod, PeerText } from './text.js'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createProcessTransport, createNativeProcessOffer } from '@migaia/rpc/process'
import { openProcessStdioChannel } from '@migaia/rpc/process/adapters/node-child-process'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '@migaia/rpc/process/adapters/node-socket'
import {
  serveRemotePlugin,
  serveRemoteHost,
  type IRemoteChannel,
  type IRemoteContract
} from '@migaia/rpc/remote'
import { RpcError, RpcCoreErrorCode, type IRpcContext } from '@migaia/rpc/core'
import { serializeRpcError } from '@migaia/rpc/contract'
import { endpointFor } from './runtime.js'

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
const contract = JSON.parse(
  readFileSync(
    process.env.RPC_PEERS_VECTOR_ROOT
      ? join(process.env.RPC_PEERS_VECTOR_ROOT, 'remote-contract.json')
      : new URL('../../../../schema/vectors/remote-contract.json', import.meta.url),
    'utf8'
  )
).contracts[0].value as IRemoteContract
/** Received one-way values are observed independently of outbound delivery promises. */
const received: unknown[] = []
/** Provider-observed cancellation reasons are independently queried after the caller settles. */
const aborts: unknown[] = []
/** The real PluginHost owns business Feature installation and disposal. */
const host = new PluginHost<Record<string, never>>({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
/** One local definition is resolved by name; no executable definition crosses the channel. */
const definition = definePlugin({
  name: contract.plugin,
  features: {
    f: defineFeature(() => ({
      request: (input: unknown) => input,
      oneWay: (input: unknown) => {
        received.push(input)
      },
      generator: function* (input: unknown) {
        yield* Array.isArray(input) ? input : [input, input, input]
      },
      asyncGenerator: async function* (input: unknown) {
        for (const item of Array.isArray(input) ? input : [input, input, input]) yield item
      }
    }))
  },
  install: () => ({})
})
/** Each connection borrows this Host and owns its endpoint service. */
const services = new Set<{ close(): Promise<void> }>()
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
    const cause = new RpcError(RpcCoreErrorCode.internal, PeerText.cause)
    throw new RpcError(RpcCoreErrorCode.internal, PeerText.error, cause)
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
  /** Host profile exposes catalog control; Plugin profile describes the already installed target. */
  const publicService = values.host
    ? await serveRemoteHost({
        host,
        catalog: { [contract.plugin]: contract },
        resolvePlugin: () => definition,
        endpoint: runtime,
        report
      })
    : await serveRemotePlugin({ host, contract, endpoint: runtime, report })
  /** Observation delegates the exact public close promise; it does not replace its ownership. */
  const cleanup = { calls: 0, settled: 0, providerAborts: 0 }
  cleanups.push(cleanup)
  const service = {
    close: async () => {
      cleanup.calls++
      await publicService.close()
      cleanup.settled++
      cleanup.providerAborts = aborts.length
    }
  }
  /** One close promise fences EOF and explicit shutdown against repeated disposal. */
  let closed: Promise<void> | undefined
  /** Subscription belongs to this connection and is released before closing its channel. */
  let releaseFailure = (): void => undefined
  /** Session ownership ends after the remote service and its channel have both released. */
  const owned = {
    close: (): Promise<void> => {
      if (closed) return closed
      releaseFailure()
      closed = (async () => {
        try {
          await service.close()
          await channel.close()
        } finally {
          services.delete(owned)
        }
      })()
      return closed
    }
  }
  services.add(owned)
  releaseFailure =
    channel.transport.onTransportError?.(() => {
      void owned.close().catch(report)
    }) ?? releaseFailure
}

/** Run one actual public-API client exchange for ordered native interop pairs. */
async function initiate(channel: IRemoteChannel): Promise<void> {
  /** The public endpoint generates request IDs and routes. */
  const runtime = await endpointFor(channel, 'ts-peer')
  try {
    /** Stable fixture payload compares value semantics across independent languages. */
    const payload = { echo: 'typescript', number: 1 }
    /** Public send returns a native response context with the peer's value. */
    const answer = await runtime.endpoint.send(channel.peerId, PeerMethod.echo, payload, {
      timeoutMs: 3000
    })
    if (JSON.stringify(answer) !== JSON.stringify(payload))
      throw new RpcError(RpcCoreErrorCode.internal, PeerText.mismatch)
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
  if (!values.host) await host.use(definition)
  /** One native proposal advertises exactly production-installed control and stream support. */
  const offer = createNativeProcessOffer({
    peer: { id: 'ts-peer', runtime: 'node' },
    stream: true,
    capabilities: ['abort@1', 'wire-error@1']
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
            throw new RpcError(RpcCoreErrorCode.authenticationFailed, PeerText.authRejected)
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
                      throw new RpcError(
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
  await host.dispose()
  process.stderr.write(PeerText.cleanupPrefix + JSON.stringify(cleanups) + '\n')
}

main().catch((error: unknown) => {
  report(error)
  process.exitCode = 1
})
