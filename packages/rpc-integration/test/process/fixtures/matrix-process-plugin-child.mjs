/** Serve real process sessions and expose lifecycle markers and file gates for the native oracle. */
import { access } from 'node:fs/promises'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { openProcessStdioChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { listenProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { serveProcessSessions } from '../../../../rpc-plugin-process/dist/process/plugin/serve.js'
import { createProcessResilience } from '../../../../rpc-plugin-process/dist/process/resilience/index.js'
import { createRuntimePeer } from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import { createRuntimeFeatureRoots } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { RemoteMethodName } from '../../../../rpc-host/dist/remote/constants.js'
import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createStreamFeature } from '../../../../rpc-host/dist/core/stream/index.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'

/**
 * Fixture messages go to drained stderr; stdout remains exclusively native RPC.
 *
 * @param {string} value Lifecycle marker without protocol payloads.
 * @returns {void}
 */
function mark(value) {
  process.stderr.write(`matrix:${value}\n`)
}

/**
 * A file gate creates an exact supported startup interleaving without changing wire messages.
 *
 * @param {string | undefined} path Local gate file opened by the parent test.
 * @returns {Promise<void>}
 */
async function gate(path) {
  if (!path) return
  for (;;) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

/** Pending methods observe cancellation through the actual process invocation signal. */
let serving
/** Both physical deployment modes expose the same real provider methods. */
const business = {
  request: async ([value], invocation) => {
    if (value === 'pending') {
      mark('request-entered')
      await new Promise((resolve) =>
        invocation.signal.addEventListener('abort', resolve, { once: true })
      )
      mark('request-aborted')
      return 'cancelled'
    }
    if (value === 'exit') setTimeout(() => process.exit(9), 5)
    if (value === 'stderr') mark('ready-stderr')
    if (value === 'explicit-close')
      setTimeout(async () => {
        await serving.close()
        mark('explicit-closed')
      }, 5)
    return `${process.env.RPC_VALUE ?? 'child'}:${value}`
  },
  generator: async function* ([value], invocation) {
    mark(`stream-entered:${value}`)
    try {
      yield `${value}:1`
      yield `${value}:2`
      await new Promise((resolve) =>
        invocation.signal.addEventListener('abort', resolve, { once: true })
      )
    } finally {
      mark(`stream-aborted:${value}`)
    }
  }
}

/** A manual clock belongs only to the parent-loss fixture branch. */
const clock = process.env.RPC_PARENT_LOSS ? createManualScheduler() : undefined
/** Schedule observation identifies the guard's configured grace deadline in the real child. */
const scheduler = clock
  ? {
      ...clock,
      schedule: (task, delay) => {
        if (delay === 100) mark('grace-scheduled')
        return clock.schedule(task, delay)
      }
    }
  : undefined
/** Bootstrap arrives on the private stdin prefix in both spawn and external-listener modes. */
mark('before-bootstrap')
/** Bootstrap and raw channel are opened through the production stdio adapter. */
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
/** The responder compares bootstrap bytes without publishing them in fixture diagnostics. */
const token = new TextDecoder().decode(opened.bootstrap)

/**
 * Build the endpoint before serve installs its describe provider; gates wrap its exact handler.
 *
 * @param {object} channel Negotiated native process channel.
 * @returns {Promise<object>} Dedicated endpoint and stream owner.
 */
async function endpointFactory(channel) {
  /** Reuse the actual runtime root construction without another preset or selection factory. */
  const config = {
    id: 'child',
    transport: channel.transport,
    features: channel.features,
    middlewares: [
      codec(channel.pipeline.codec),
      framer(channel.pipeline.framer),
      abort(),
      connect({ transport: channel.transport }),
      ping()
    ]
  }
  /** This foreign stream oracle intentionally retains the original unfiltered stream owner. */
  const prepared = createRuntimeFeatureRoots(config, channel)
  prepared.roots['first-party-stream'] = createStreamFeature(
    prepared.roots['first-party-outbound'],
    prepared.roots['first-party-provider']
  )
  /** Each session retains its original physical pipeline and independent kernel. */
  const endpoint = await createComposedEndpoint(prepared.options, prepared.roots)
  return { endpoint: new MatrixEndpoint(endpoint).value, oneWay: endpoint, stream: endpoint.stream }
}

/** Observe the original endpoint without granting an additional runtime or cleanup authority. */
class MatrixEndpoint {
  /** @type {import('@migaia/rpc-host').IRpcEndpoint} Actual canonical resource owner. */
  #endpoint
  /** @type {Promise<void> | undefined} Shared cleanup joins one disposal and emits its marker once. */
  #closing
  /**
   * @type {import('@migaia/rpc-host').IRpcEndpoint} Original projection ancestry retains private
   *   attachments.
   */
  value
  /**
   * Capture the genuine endpoint and expose transparent provider/disposal observations.
   *
   * @param {import('@migaia/rpc-host').IRpcEndpoint} endpoint Original composed resource.
   */
  constructor(endpoint) {
    this.#endpoint = endpoint
    this.value = Object.freeze(
      Object.defineProperties(Object.create(endpoint), {
        provide: { value: (method, handler) => this.#provide(method, handler) },
        dispose: { value: () => this.#dispose() }
      })
    )
  }
  /**
   * Delay the actual describe handler at the existing gate.
   *
   * @param {string} method Original registration name.
   * @param {import('@migaia/rpc-host').IRpcProvider} handler Original provider callback.
   * @returns {import('@migaia/rpc-host').IRpcEndpoint} Original fluent endpoint.
   */
  #provide(method, handler) {
    return (0, this.#endpoint.provide)(method, async (context) => {
      if (method === RemoteMethodName.runtimeDescribe) {
        mark('describe-entered')
        await gate(process.env.RPC_DESCRIBE_GATE)
      }
      return handler(context)
    })
  }
  /** @returns {Promise<void>} Exact first disposal shared by Peer and session cleanup. */
  #dispose() {
    return (this.#closing ??= this.#closeOnce())
  }
  /** @returns {Promise<void>} Original disposal, deliberately pending in the parent-loss fault. */
  async #closeOnce() {
    mark('endpoint-dispose')
    if (process.env.RPC_PARENT_LOSS === 'hung') await new Promise(() => {})
    await this.#endpoint.dispose()
  }
}

/**
 * Bind the original byte session to its actual provider/directory owner.
 *
 * @param {import('../../../../rpc-plugin-process/dist/process/plugin/serve.js').IProcessReadySession} session
 *   Original accepted resources.
 * @returns {Promise<{ close(): Promise<void> }>} Actual Peer cleanup with the original marker.
 * @throws {Error} Original provider/directory construction failure.
 */
async function prepareService({ channel, endpoint }) {
  /** The original Peer preserves method contexts and owns its canonical endpoint cleanup. */
  const peer = await createRuntimePeer(
    {
      self: { name: 'child', instanceId: 'child' },
      provide: { p: { f: business } },
      report: (error) => mark(`report:${error.code}`)
    },
    { channel, endpoint }
  )
  if (process.env.RPC_SERVICE_GATE) {
    mark('service-prepared')
    await gate(process.env.RPC_SERVICE_GATE)
  }
  return {
    close: () => {
      mark('service-close')
      return peer.close()
    }
  }
}

/** One responder port delays the actual hello handling until the parent opens the gate. */
const ingress = process.env.RPC_SOCKET
  ? {
      kind: 'listener',
      address: process.env.RPC_SOCKET,
      listen: listenProcessByteChannel,
      verify: (actual) => {
        if (actual !== token) throw new Error('fixture auth rejected')
        return 'fixture-principal'
      },
      offer: createNativeProcessOffer({
        peer: { id: 'child', runtime: 'node' },
        stream: true,
        capabilities: ['runtime-api@1']
      }),
      createConnectionContext: () => {
        const id = crypto.randomUUID()
        return { peerId: 'parent', ipc: { connectionId: id, sessionId: id, log: () => undefined } }
      }
    }
  : {
      kind: 'child',
      channelKind: 'byte',
      openRaw: async () => ({
        raw: {
          ...opened.channel,
          onClose: (listener) =>
            opened.channel.onClose((reason) => {
              mark('parent-lost')
              listener(reason)
            })
        },
        bootstrap: opened.bootstrap
      }),
      createVerifier: () => (actual) => {
        if (actual !== token) throw new Error('fixture auth rejected')
      },
      establish: async (raw, context) => {
        mark('before-handshake')
        await gate(process.env.RPC_HANDSHAKE_GATE)
        return createProcessTransport(opened.channel, {
          role: 'responder',
          offer: createNativeProcessOffer({
            peer: { id: 'child', runtime: 'node' },
            stream: true,
            capabilities: ['runtime-api@1']
          }),
          auth: { mode: 'required', verify: context.verify },
          peerId: 'parent',
          scheduler: context.scheduler,
          signal: context.signal,
          ipc: { ...context.session, log: () => undefined },
          report: (error) => mark(`report:${error.code}`)
        })
      },
      parentLoss: {
        graceMs: 100,
        exit: (code) => {
          mark(`exit:${code}`)
          if (!scheduler) process.exit(code)
        }
      }
    }

/**
 * Drive the original manual grace deadline independently of service preparation or rollback.
 *
 * @param {ReturnType<typeof createManualScheduler>} clock Original child-owned manual scheduler.
 * @returns {Promise<void>} Settles after both parent-owned control gates have opened.
 */
async function advanceParentLossClock(clock) {
  await gate(process.env.RPC_CLOCK_GATE)
  clock.advance(99)
  mark('clock:99')
  await gate(process.env.RPC_CLOCK_FINAL_GATE)
  clock.advance(1)
  mark('clock:100')
}

if (scheduler) {
  /**
   * The real Node child drives the existing internal scheduler parameter, without a public API
   * extension.
   */
  const resilience = createProcessResilience({
    scheduler: scheduler ?? systemScheduler,
    report: (error) => mark(`report:${error.code}`)
  })
  void advanceParentLossClock(scheduler)
  serving = await serveProcessSessions(
    ingress,
    endpointFactory,
    prepareService,
    resilience,
    (error) => mark(`report:${error.code}`),
    undefined,
    scheduler
  )
} else {
  /** The original session owner retains child bootstrap, listener authentication and rollback. */
  const resilience = createProcessResilience({
    scheduler: scheduler ?? systemScheduler,
    report: (error) => mark(`report:${error.code}`)
  })
  serving = await serveProcessSessions(
    ingress,
    endpointFactory,
    prepareService,
    resilience,
    (error) => mark(`report:${error.code}`),
    undefined,
    scheduler ?? systemScheduler,
    { release: () => resilience.close() }
  )
}
mark('serving-ready')
