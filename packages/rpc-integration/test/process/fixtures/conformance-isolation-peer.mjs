import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  ERROR_SOURCE,
  RpcProcessErrorCode
} from '../../../../rpc-plugin-process/dist/process/error-code.js'
import { RpcProcessErrorText } from '../../../../rpc-plugin-process/dist/process/error-text.js'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessResilience } from '../../../../rpc-plugin-process/dist/process/resilience/index.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { listenProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { openProcessStdioChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { serveProcessSessions } from '../../../../rpc-plugin-process/dist/process/plugin/serve.js'
import { createRuntimePeer } from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import { createProcessInstanceFallback } from '../../../../rpc-plugin-process/dist/process/resilience/fallback.js'
import { createRuntimeEndpointComposition } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'
import { isRpcTimeoutError } from '@migaia/rpc-host'
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
/** Control callbacks never enter the portable business receipt containing provider counters. */
const control = { health: undefined, sequence: 0 }
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
  /** Reuse the genuine runtime physical installation with this exact session's native policy. */
  const { installing } = createRuntimeEndpointComposition(
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
      ],
      features: channel.features
    },
    channel
  )
  const endpoint = await installing
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

/** One real PluginHost owns each target instance; providers borrow only its installed outputs. */
class IsolationTarget {
  /** Actual native replacement/disposal stays with this original PluginHost. */
  host = new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
  /** Output is captured only when the real Feature install occurs, never from a candidate DTO. */
  #output
  /** Return the currently installed business object after native Feature construction. */
  get output() {
    return this.#output
  }
  /** Build one actual target definition with the revision captured for that generation. */
  definition() {
    const revision = state.revision
    return definePlugin({
      name: 'p',
      install: () => ({}),
      features: {
        f: defineFeature(() => {
          const output = {
            async request(input, context) {
              if (input === 'stats') return { ...state, pid: process.pid }
              if (input?.[0] === 'health') {
                queueMicrotask(() =>
                  control.health?.({
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
                        localTimeout: isRpcTimeoutError(context.signal.reason)
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
          }
          this.#output = output
          return output
        })
      }
    })
  }
  /** Install the original target before any session can register business methods. */
  async start() {
    await this.host.use(this.definition())
  }
}

/** Shared mode deliberately keeps the same target Host across independent physical sessions. */
const sharedTarget = new IsolationTarget()
await sharedTarget.start()
/** The original Host is also the canonical instance fallback replacement authority. */
const host = sharedTarget.host

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
    return sharedTarget.definition()
  },
  onInstanceUnhealthy: (listener) => {
    control.health = listener
    return () => {
      control.health = undefined
    }
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
            connectionId: `connection-${++control.sequence}`,
            sessionId: `session-${control.sequence}`,
            processId: String(process.pid),
            log: () => undefined
          }
        })
      }
}
/**
 * Register this fixture's application payloads on the actual accepted native Peer.
 *
 * @param {import('../../../../rpc-plugin-process/dist/process/plugin/serve.js').IProcessReadySession} session
 *   Genuine native accepted resource.
 * @returns {Promise<{ close(): Promise<void> }>} Original Peer and optional target cleanup
 *   transaction.
 * @throws {unknown} Original construction failure; rollback failures are reported independently.
 */
async function serveSession({ channel, endpoint, identity, signal }) {
  const owned = mode === 'per-connection' ? new IsolationTarget() : undefined
  if (owned) await owned.start()
  const feature = (owned ?? sharedTarget).output
  /** Session identity is lent by the actual process governor, never reconstructed from peer names. */
  const context = (actual) => ({ session: identity, signal: actual.signal })
  let peer
  try {
    peer = await createRuntimePeer(
      {
        self: { name: 'ts-peer', instanceId: 'ts-peer' },
        contract,
        report,
        provide: {
          p: {
            f: {
              request: (params, actual) => feature.request(params[0], context(actual)),
              oneWay: (params, actual) => feature.oneWay(params[0], context(actual)),
              generator: (params, actual) => feature.generator(params[0], context(actual)),
              asyncGenerator: (params, actual) => feature.asyncGenerator(params[0], context(actual))
            }
          }
        }
      },
      { channel, endpoint, signal }
    )
  } catch (primary) {
    if (owned) {
      try {
        await owned.host.dispose()
      } catch (cleanup) {
        report(cleanup)
      }
    }
    throw primary
  }
  return {
    close: async () => {
      const errors = []
      try {
        await peer.close()
      } catch (error) {
        errors.push(error)
      }
      if (owned) {
        try {
          await owned.host.dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
          source: ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
    }
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
  serveSession,
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
