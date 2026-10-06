import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc/contract'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createProcessResilience,
  createNativeProcessOffer,
  createProcessTransport
} from '@migaia/rpc/process'
import { listenProcessByteChannel } from '@migaia/rpc/process/adapters/node-socket'
import { openProcessStdioChannel } from '@migaia/rpc/process/adapters/node-child-process'
import {
  serveProcessSessions,
  createProcessSessionService
} from '../../../dist/process/plugin/serve.js'
import { createProcessInstanceFallback } from '../../../dist/process/resilience/fallback.js'
import { createComposedEndpoint } from '@migaia/rpc/core/composed'
import { codec, framer, abort, connect, ping, RpcTimeoutError } from '@migaia/rpc/core'
import { createCanonicalChunkFeature, createStreamFeature } from '@migaia/rpc/core/stream'
import { createOutboundFeature } from '@migaia/rpc/core/features/outbound'
import { createProviderFeature } from '@migaia/rpc/core/features/provider'
import { createDiscoveryFeature } from '@migaia/rpc/core/features/discovery'
import { createControlFeature } from '@migaia/rpc/core/features/control'
import { createOneWayFeature } from '@migaia/rpc/core/features/one-way'

/** The published vector owns every business method and mode used by this fixture. */
const contract = JSON.parse(
  readFileSync(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** CLI arguments carry mode and rendezvous location, never authentication material. */
const [mode, address] = process.argv.slice(2)
/** Provider receipts remain in this actual child PID and expose no credential values. */
const state = {
  executions: 0,
  contexts: [],
  aborts: [],
  replacements: 0,
  revision: 0,
  frames: [],
  reports: []
}
/** A single callback is owned by the production fallback subscription. */
let health
/** Physical sessions and target instances receive different monotonically increasing identities. */
let sequence = 0
/** Bootstrap mode reads its secret through the public stdio owner. */
const opened = mode === 'stderr' ? await openProcessStdioChannel({ bootstrap: 'stdin' }) : undefined
/** Socket authentication is inherited through a private descriptor, never argv or environment. */
const credentials = opened
  ? { alice: new TextDecoder().decode(opened.bootstrap) }
  : JSON.parse(readFileSync(3, 'utf8'))
/** This explicit governor changes only the connection capacity under the flood experiment. */
const resilience =
  mode === 'flood'
    ? createProcessResilience({ scheduler: systemScheduler, report, maxConnections: 2 })
    : undefined
/** The shared target is an actual PluginHost; per-connection targets use the same definition. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})

/** Reports contain only native semantic codes; failure text cannot echo authentication values. */
function report(error) {
  state.reports.push({
    inspected: inspect(error, { depth: null, showHidden: true }),
    wire: serializeRpcError(error, { report: () => undefined })
  })
  process.stderr.write(`ISOLATION_REPORT:${String(error?.code ?? 'UNKNOWN')}\n`)
}

/** Build a public canonical graph with the exact session policy supplied by production serve. */
async function endpointFactory(channel, _signal, session) {
  /** All control, provider and stream roots share the same outbound and chunk owners. */
  const chunk = createCanonicalChunkFeature()
  /** The outbound owner routes responses and cancellations independently per physical session. */
  const outbound = createOutboundFeature(chunk)
  /** Provider dispatch uses the core's idempotency and replay owners. */
  const provider = createProviderFeature(outbound)
  /** Discovery is the public contract-description owner. */
  const discovery = createDiscoveryFeature(outbound)
  /** IPC middleware remains supplied by the authenticated process channel. */
  const endpoint = await createComposedEndpoint(
    {
      id: 'ts-peer',
      scheduler: channel.scheduler,
      transport: channel.transport,
      idempotency: session.idempotency,
      providerLimits: session.limits,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': provider,
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(outbound, discovery),
      'first-party-one-way': createOneWayFeature(outbound),
      'first-party-stream': createStreamFeature(outbound, provider, {
        capability: { supports: () => channel.agreement.capabilities.includes('stream@1') }
      }),
      ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature]))
    }
  )
  /** The canonical transport emits decoded envelopes; this observer records only message metadata. */
  channel.transport.subscribe(({ data }) => {
    /** Received metadata demonstrates equal request IDs crossing independent connections. */
    const frame = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
    state.frames.push({
      sessionId: session.identity.sessionId,
      kind: frame.kind,
      id: frame.id ?? null
    })
  })
  return { endpoint, stream: endpoint.stream, oneWay: endpoint }
}

/** Produce a real target definition; invocation context comes from production remote dispatch. */
function target() {
  /** Each replacement has an observable feature revision in the same child PID. */
  const revision = state.revision
  return definePlugin({
    name: 'p',
    install: () => ({}),
    features: {
      f: defineFeature(() => ({
        async request(input, context) {
          if (input === 'stats') return { ...state, pid: process.pid }
          if (input?.[0] === 'health') {
            queueMicrotask(() =>
              health?.({
                targetName: 'p',
                connectionId: input[1],
                reason: new Error('explicit fixture health event')
              })
            )
            return true
          }
          if (input === 'stderr') {
            /** Separate writes deliberately split every potential six-character token window. */
            for (const part of credentials.alice.match(/.{1,3}/g)) {
              process.stderr.write(part)
              await new Promise((resolve) => setTimeout(resolve, 5))
            }
            return true
          }
          state.executions += 1
          state.contexts.push({ method: 'request', ...context.session })
          if (input?.[0] === 'wait') {
            await new Promise((resolve) =>
              context.signal.addEventListener(
                'abort',
                () => {
                  state.aborts.push({
                    label: input[1],
                    ...context.session,
                    code: context.signal.reason?.code ?? null,
                    message: context.signal.reason?.message ?? null,
                    localTimeout: context.signal.reason instanceof RpcTimeoutError
                  })
                  resolve()
                },
                { once: true }
              )
            )
          }
          return { input, execution: state.executions, revision, session: context.session }
        },
        oneWay(input, context) {
          state.contexts.push({ method: 'oneWay', input, ...context.session })
        },
        *generator(input, context) {
          state.contexts.push({ method: 'generator', ...context.session })
          yield { input, session: context.session }
        },
        async *asyncGenerator(input, context) {
          state.contexts.push({ method: 'asyncGenerator', ...context.session })
          yield { input, session: context.session }
        }
      }))
    }
  })
}

await host.use(target())
/** Production serve owns handshake admission, connection scope, provider limits and fallback. */
const options = {
  host,
  contract,
  instanceMode: mode === 'per-connection' ? 'per-connection' : 'shared',
  resilience,
  endpointFactory,
  report,
  createSharedTarget: () => {
    state.replacements += 1
    state.revision += 1
    return target()
  },
  onInstanceUnhealthy: (listener) => {
    health = listener
    return () => {
      health = undefined
    }
  },
  createSessionHost: async () => {
    /** Each physical connection receives an independently owned target Host. */
    const owned = new PluginHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await owned.use(target())
    return owned
  },
  ingress: opened
    ? {
        kind: 'child',
        channelKind: 'byte',
        parentLoss: { exit: () => process.exit(0) },
        openRaw: async () => ({ raw: opened.channel, bootstrap: opened.bootstrap }),
        createVerifier: () => (auth) => {
          if (auth !== credentials.alice) throw new Error('fixture authentication rejected')
        },
        establish: (raw, context) =>
          createProcessTransport(raw, {
            role: 'responder',
            peerId: 'caller',
            scheduler: context.scheduler,
            offer: createNativeProcessOffer({
              peer: { id: 'ts-peer', runtime: 'node' },
              stream: true,
              capabilities: ['runtime-api@1']
            }),
            auth: { mode: 'required', verify: context.verify },
            ipc: { ...context.session, log: () => undefined },
            report
          })
      }
    : {
        kind: 'listener',
        address,
        listen: listenProcessByteChannel,
        offer: createNativeProcessOffer({
          peer: { id: 'ts-peer', runtime: 'node' },
          stream: true,
          capabilities: ['runtime-api@1']
        }),
        verify: (auth) => {
          if (auth === credentials.alice) return 'alice'
          if (auth === credentials.bob) return 'bob'
          throw new Error(String(auth))
        },
        createConnectionContext: () => ({
          peerId: 'caller',
          ipc: {
            connectionId: `connection-${++sequence}`,
            sessionId: `session-${sequence}`,
            processId: String(process.pid),
            log: () => undefined
          }
        })
      }
}
/** Original recovery and target selectors are shared with retained advanced service consumers. */
const fallback = createProcessInstanceFallback({
  mode: options.instanceMode,
  targetName: contract.plugin,
  host,
  createSharedTarget: options.createSharedTarget,
  onInstanceUnhealthy: options.onInstanceUnhealthy,
  report
})
/** Only a default governor is service-owned; the flood governor remains caller-owned. */
const governor = resilience ?? createProcessResilience({ scheduler: systemScheduler, report })
const service = await serveProcessSessions(
  options.ingress,
  endpointFactory,
  createProcessSessionService(options),
  governor,
  report,
  fallback,
  systemScheduler,
  resilience ? undefined : { release: () => governor.close() }
)
/** Fixed readiness output is the only startup receipt; no token or fabricated trace appears. */
process.stderr.write(`ISOLATION_READY:${process.pid}\n`)
/** Fixture shutdown closes production session and governor owners before its target Host. */
process.on('SIGTERM', async () => {
  await service.close()
  await resilience?.close()
  await host.dispose()
  process.exit(0)
})
