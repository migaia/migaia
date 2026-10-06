import { readFileSync } from 'node:fs'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../dist/process/offer.js'
import { serveRemotePlugin } from '../../../dist/remote/serve-plugin.js'
import { createProcessPlugin } from '../../../dist/process/index.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../dist/remote/runtime-api/constants.js'
import { RpcProcessErrorCode } from '../../../dist/process/error-code.js'
import { createProcessError } from '../../../dist/process/error.js'
import { createComposedEndpoint } from '../../../dist/core/composed.js'
import { createFirstPartyRoots } from '../../../dist/core/internal/first-party-roots.js'
import { createStreamFeature } from '../../../dist/core/features/stream.js'
import { codec } from '../../../dist/core/middleware/codec.js'
import { framer } from '../../../dist/core/middleware/framer.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { ping } from '../../../dist/core/middleware/ping.js'

/** One canonical catalog fixture is shared with the real stdio and Unix clients. */
const catalog = JSON.parse(readFileSync(new URL('./host-catalog.json', import.meta.url), 'utf8'))
/** The native caller observes true Host commit separately from early protocol directory readiness. */
const readyText = JSON.parse(readFileSync(new URL('./host-ready.json', import.meta.url), 'utf8'))
/** This target starts empty; every installed definition must come through the local resolver. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
/** Counters distinguish actual provider execution from cached results on another connection. */
let calls = 0
/** Resolver calls distinguish local authority from portable declarations. */
let resolutions = 0
/** Disposal counts prove remote unUse executes local cleanup exactly once. */
let disposals = 0
/** Portable configuration is retained only as fixture result data. */
let portableConfig = null
/** Held business requests let real connections exercise provider concurrency and drain. */
const held = new Set()
/** A stable trusted definition lets the canonical remote owner share one installation. */
const definition = definePlugin({
  name: 'p',
  features: {
    f: defineFeature(() => ({
      request: async (input) => {
        if (input === 'count') return { calls }
        if (input === 'delay') await new Promise((resolve) => setTimeout(resolve, 25))
        if (input === 'release-held') {
          for (const resume of held) resume()
          held.clear()
        }
        const invocation = ++calls
        if (input === 'hold') await new Promise((resolve) => held.add(resolve))
        return {
          pid: process.pid,
          value: process.env.RPC_VALUE ?? 'child',
          input,
          config: portableConfig,
          calls: invocation,
          resolutions,
          disposals
        }
      },
      generator: function* (input) {
        yield input
      }
    }))
  },
  install: (core) => {
    core.onDispose(() => {
      disposals += 1
    })
    return {}
  }
})
/** Errors preserve their canonical public text while bootstrap/token payloads remain private. */
const report = (error) => process.stderr.write(`${String(error)}\n`)
/** Both ingress modes use the same native offer and process session owner. */
const offer = createNativeProcessOffer({
  peer: { id: 'host-child', runtime: 'node' },
  stream: true,
  capabilities: RUNTIME_API_BASE_CAPABILITIES
})
/** A listener fixture runs independently of every borrowed client connection. */
const address = process.env.RPC_HOST_ADDRESS
/** Only an explicit socket supplies a listener; child stdio uses verified automatic bootstrap. */
const ingress = address
  ? {
      kind: 'listener',
      address,
      listen: (options) => listenProcessByteChannel({ ...options, serviceId: 'host-fixture' }),
      offer,
      verify(auth) {
        if (auth !== process.env.RPC_HOST_TOKEN && auth !== process.env.RPC_HOST_SECOND_TOKEN)
          throw createProcessError(RpcProcessErrorCode.authRejected)
        return auth === process.env.RPC_HOST_SECOND_TOKEN ? 'second-principal' : 'principal'
      },
      createConnectionContext: () => {
        const id = crypto.randomUUID()
        return {
          peerId: 'host-parent',
          ipc: { connectionId: id, sessionId: id, log: () => undefined }
        }
      }
    }
  : undefined

/**
 * Compose the actual core endpoint retained by reverse Plugin registration.
 *
 * @param {import('../../../dist/remote/types.js').IRemoteChannel} channel
 * @param {Parameters<
 *   import('../../../dist/process/plugin/types.js').IProcessServeEndpointFactory
 * >[2]} [session]
 * @returns {Promise<import('../../../dist/remote/types.js').IRemoteServeEndpoint>}
 */
async function createEndpoint(channel, session) {
  const roots = createFirstPartyRoots(new Set(['first-party-provider', 'first-party-control']))
  const endpoint = await createComposedEndpoint(
    {
      id: process.env.RPC_REGISTRATION_ADDRESS ? 'registration-peer' : 'host-child',
      scheduler: channel.scheduler,
      transport: channel.transport,
      ...(session ? { idempotency: session.idempotency, providerLimits: session.limits } : {}),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      ...roots,
      'first-party-stream': createStreamFeature(
        roots['first-party-outbound'],
        roots['first-party-provider']
      ),
      'channel-ipc-log': channel.features[0],
      'channel-ipc-gate': channel.features[1]
    }
  )
  return { endpoint, stream: endpoint.stream }
}

/** Reverse mode initiates once, then serves only its approved Plugin contract on that channel. */
if (process.env.RPC_REGISTRATION_ADDRESS) {
  await host.use(definition)
  const raw = await dialProcessByteChannel({ address: process.env.RPC_REGISTRATION_ADDRESS })
  const id = crypto.randomUUID()
  const channel = await createProcessTransport(raw, {
    role: 'initiator',
    offer: createNativeProcessOffer({
      peer: { id: 'registration-peer', runtime: 'node' },
      auth: process.env.RPC_HOST_TOKEN,
      stream: true
    }),
    peerId: 'registration-server',
    scheduler: systemScheduler,
    ipc: { connectionId: id, sessionId: id, log: () => undefined },
    report
  })
  const service = await serveRemotePlugin({
    host,
    contract: process.env.RPC_BAD_DESCRIPTION
      ? {
          ...catalog.p,
          features: { f: { methods: { request: { mode: 'request', idempotent: false } } } }
        }
      : catalog.p,
    endpoint: await createEndpoint(channel),
    report
  })
  channel.transport.onTransportError(() => {
    void service.close().then(
      () => process.exit(0),
      (error) => {
        report(error)
        process.exit(1)
      }
    )
  })
  process.stderr.write('registration-peer-ready\n')
} else {
  /** Both sources use the same trusted local resolver; executable definitions stay local. */
  await host.use(
    createProcessPlugin({
      name: address ? 'listener' : 'parent',
      host,
      ...(address ? { self: { name: 'host-child', instanceId: 'host-child' } } : {}),
      expose: ['host', 'p'],
      catalog,
      report,
      resolvePlugin: (_name, config) => {
        resolutions += 1
        if (process.env.RPC_RESOLVER_MODE === 'wrong-name')
          return definePlugin({ name: 'wrong', install: () => ({}) })
        if (process.env.RPC_RESOLVER_MODE === 'promise') return Promise.resolve(definition)
        if (process.env.RPC_RESOLVER_MODE === 'invalid') return null
        if (process.env.RPC_RESOLVER_MODE === 'throw')
          throw createProcessError(
            RpcProcessErrorCode.hostInvalidOption,
            createProcessError(RpcProcessErrorCode.channelClosed)
          )
        portableConfig = config ?? null
        return definition
      },
      ...(address ? { listen: ingress } : {})
    })
  )
  process.stderr.write(readyText.committed)
}
