import { access } from 'node:fs/promises'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { openProcessStdioChannel } from '../../../dist/process/adapters/node-child-process.js'
import { listenProcessByteChannel } from '../../../dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import {
  createServeProcessPlugin,
  serveProcessSessions
} from '../../../dist/process/plugin/serve.js'
import { createProcessResilience } from '../../../dist/process/resilience/index.js'
import { serveRemotePlugin } from '../../../dist/remote/serve-plugin.js'
import { createComposedEndpoint } from '../../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../dist/core/features/canonical-chunk.js'
import { createControlFeature } from '../../../dist/core/features/control.js'
import { createDiscoveryFeature } from '../../../dist/core/features/discovery.js'
import { createOutboundFeature } from '../../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../../dist/core/features/provider.js'
import { createStreamFeature } from '../../../dist/core/features/stream.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { ping } from '../../../dist/core/middleware/ping.js'

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

/** Both deployment modes expose the same business methods and actual async stream. */
const contract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: false },
        generator: { mode: 'async-generator', idempotent: false }
      }
    }
  }
}
/** Fixture Host owns only its business provider, never the parent test's PluginHost. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
/** Pending methods observe cancellation through the real process invocation signal. */
let serving
await host.use(
  definePlugin({
    name: 'p',
    features: {
      f: defineFeature(() => ({
        request: async (value, invocation) => {
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
        generator: async function* (value, invocation) {
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
      }))
    },
    install: () => ({})
  })
)

/**
 * Each channel receives fresh stream roots; no provider or stream state crosses sessions.
 *
 * @returns {object} Canonical endpoint feature roots.
 */
function roots() {
  /** The endpoint owns canonical chunk state for this session. */
  const chunk = createCanonicalChunkFeature()
  /** Outbound shares only the endpoint chunk state. */
  const outbound = createOutboundFeature(chunk)
  /** Discovery reuses the endpoint outbound owner. */
  const discovery = createDiscoveryFeature(outbound)
  /** Control reuses this endpoint discovery and outbound owners. */
  const control = createControlFeature(outbound, discovery)
  /** Provider lifetime is scoped to this endpoint. */
  const provider = createProviderFeature(outbound)
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-discovery': discovery,
    'first-party-control': control,
    'first-party-provider': provider,
    'first-party-stream': createStreamFeature(outbound, provider)
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
  /** One negotiated process channel owns this composed endpoint. */
  const endpoint = await createComposedEndpoint(
    {
      id: 'child',
      transport: channel.transport,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    { ...roots(), 'channel-ipc-log': channel.features[0], 'channel-ipc-gate': channel.features[1] }
  )
  /** The canonical registration port is preserved while the describe gate observes it. */
  const provide = endpoint.provide
  /** Canonical disposal remains the single endpoint cleanup owner. */
  const dispose = endpoint.dispose
  /** Preserve the canonical projection ancestry that owns the authenticated v2 identity. */
  const observed = Object.create(endpoint)
  Object.defineProperties(observed, {
    provide: {
      value: (method, handler) =>
        provide(method, async (context) => {
          if (method === 'migaia.remote.runtime.describe') {
            mark('describe-entered')
            await gate(process.env.RPC_DESCRIBE_GATE)
          }
          return handler(context)
        })
    },
    dispose: {
      value: async () => {
        mark('endpoint-dispose')
        if (process.env.RPC_PARENT_LOSS === 'hung') await new Promise(() => {})
        return dispose()
      }
    }
  })
  return { endpoint: Object.freeze(observed), stream: endpoint.stream }
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

if (scheduler) {
  /**
   * The real Node child drives the existing internal scheduler parameter, without a public API
   * extension.
   */
  const resilience = createProcessResilience({
    scheduler,
    report: (error) => mark(`report:${error.code}`)
  })
  serving = await serveProcessSessions(
    ingress,
    endpointFactory,
    async ({ endpoint }) => {
      /** Observe the canonical service close port separately from endpoint disposal. */
      const service = await serveRemotePlugin({
        host,
        contract,
        endpoint,
        report: (error) => mark(`report:${error.code}`),
        invocationContext: (context) => ({ signal: context.signal })
      })
      return {
        ...service,
        close: () => {
          mark('service-close')
          return service.close()
        }
      }
    },
    resilience,
    (error) => mark(`report:${error.code}`),
    undefined,
    scheduler
  )
  /** EOF starts shutdown; the local control gate advances exactly the original grace deadline. */
  void (async () => {
    await gate(process.env.RPC_CLOCK_GATE)
    scheduler.advance(99)
    mark('clock:99')
    await gate(process.env.RPC_CLOCK_FINAL_GATE)
    scheduler.advance(1)
    mark('clock:100')
  })()
} else {
  serving = await createServeProcessPlugin({
    host,
    contract,
    ingress,
    endpointFactory,
    createSharedTarget: async () => undefined,
    onInstanceUnhealthy: () => () => undefined,
    report: (error) => mark(`report:${error.code}`)
  })
}
mark('serving-ready')
