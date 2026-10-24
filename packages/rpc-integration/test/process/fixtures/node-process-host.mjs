import { RpcCapability } from '@migaia/rpc-contract'
import { readFileSync } from 'node:fs'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { createRuntimePeer } from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createRpcHost } from '@migaia/rpc-host'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../../rpc-host/dist/remote/runtime-api/constants.js'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import { createProcessError } from '../../../../rpc-plugin-process/dist/process/error.js'
import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createRuntimeFeatureRoots } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { createStreamFeature } from '../../../../rpc-host/dist/core/stream/index.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'

/** One canonical catalog fixture is shared with the real stdio and Unix clients. */
const catalog = JSON.parse(
  readFileSync(
    new URL(
      '../../../../rpc-plugin-process/test/process/fixtures/host-catalog.json',
      import.meta.url
    ),
    'utf8'
  )
)
/** The native caller observes true Host commit separately from early protocol directory readiness. */
const readyText = JSON.parse(
  readFileSync(
    new URL(
      '../../../../rpc-plugin-process/test/process/fixtures/host-ready.json',
      import.meta.url
    ),
    'utf8'
  )
)
/** Native business is registered locally before a physical transport is published. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})

/** Own real provider invocations independently of each authenticated connection's replay ledger. */
class HostBusiness {
  /** Invocation count distinguishes actual execution from a cached connection result. */
  #calls = 0
  /** Actual local application disposal is separate from any remote control protocol. */
  #disposals = 0
  /**
   * Held providers let real callers exercise admission and drain without synthetic endpoint work.
   *
   * @type {Set<() => void>}
   */
  #held = new Set()
  /**
   * Preserve actual PID/value, held-call and release behavior under the same scalar provider.
   *
   * @param {unknown} input Original wire payload or one-off fixture command.
   * @returns {Promise<
   *   | { calls: number }
   *   | { pid: number; value: string; input: unknown; calls: number; disposals: number }
   * >}
   */
  request = async (input) => {
    if (input === 'count') return { calls: this.#calls }
    if (input === 'delay') await new Promise((resolve) => setTimeout(resolve, 25))
    if (input === 'release-held') {
      for (const resume of this.#held) resume()
      this.#held.clear()
    }
    /** Increment at provider admission, before a deliberately held invocation suspends. */
    const invocation = ++this.#calls
    if (input === 'hold') await new Promise((resolve) => this.#held.add(resolve))
    return {
      pid: process.pid,
      value: process.env.RPC_VALUE ?? 'child',
      input,
      calls: invocation,
      disposals: this.#disposals
    }
  };
  /**
   * Streaming retains the caller payload through the actual wire generator path.
   *
   * @param {unknown} input Original wire payload retained by the stream oracle.
   * @returns {Generator<unknown, void, unknown>}
   */
  *generator(input) {
    yield input
  }
  /**
   * Count the original local application's real dispose callback once.
   *
   * @returns {void}
   */
  dispose() {
    this.#disposals += 1
  }
}
/** Every native session uses these same actual local application methods. */
const business = new HostBusiness()
/** Ordinary PluginHost installation owns application lifetime before native exposure. */
const definition = definePlugin({
  name: 'p',
  features: {
    f: defineFeature(() => ({
      request: business.request,
      generator: (input) => business.generator(input)
    }))
  },
  install: (core) => {
    core.onDispose(() => business.dispose())
    return {}
  }
})
/** Local registration never relies on the removed remote catalog resolver or host-use command. */
const [installed] = await host.use(definition)
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
 * @param {import('../../../../rpc-host/dist/remote/types.js').IRemoteChannel} channel
 * @param {Parameters<
 *   import('../../../../rpc-plugin-process/dist/process/plugin/types.js').IProcessServeEndpointFactory
 * >[2]} [session]
 * @returns {Promise<import('../../../../rpc-host/dist/remote/types.js').IRemoteServeEndpoint>}
 */
async function createEndpoint(channel, session) {
  /** Production owns the one outbound/provider graph; foreign control tests retain legacy streams. */
  const { roots, options } = createRuntimeFeatureRoots(
    {
      id: process.env.RPC_REGISTRATION_ADDRESS ? 'registration-peer' : 'host-child',
      scheduler: channel.scheduler,
      transport: channel.transport,
      features: channel.features,
      ...(session ? { idempotency: session.idempotency, providerLimits: session.limits } : {}),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    channel
  )
  /** Legacy foreign peers negotiate stream without the separate runtimeApi capability. */
  const endpoint = await createComposedEndpoint(options, {
    ...roots,
    'first-party-stream': createStreamFeature(
      roots['first-party-outbound'],
      roots['first-party-provider']
    )
  })
  return { endpoint, oneWay: endpoint, stream: endpoint.stream }
}

/** Reverse mode initiates once, then serves only its approved Plugin contract on that channel. */
if (process.env.RPC_REGISTRATION_ADDRESS) {
  const raw = await dialProcessByteChannel({ address: process.env.RPC_REGISTRATION_ADDRESS })
  const id = crypto.randomUUID()
  const channel = await createProcessTransport(raw, {
    role: 'initiator',
    offer: createNativeProcessOffer({
      peer: { id: 'registration-peer', runtime: 'node' },
      auth: process.env.RPC_HOST_TOKEN,
      stream: true,
      capabilities: [RpcCapability.runtimeApi]
    }),
    peerId: 'registration-server',
    scheduler: systemScheduler,
    ipc: { connectionId: id, sessionId: id, log: () => undefined },
    report
  })
  /** Reverse registration serves this actual local provider through the canonical runtime Peer. */
  const localFeature = installed.getFeature('f')
  /** A malformed description deliberately omits the original required generator. */
  const provide = {
    p: { f: process.env.RPC_BAD_DESCRIPTION ? { request: localFeature.request } : localFeature }
  }
  /** The real Peer owns its negotiated directory, endpoint and physical resource. */
  const peer = await createRuntimePeer(
    {
      self: { name: 'registration-peer', instanceId: 'registration-peer' },
      provide,
      contract: catalog.p,
      report
    },
    { channel, endpoint: await createEndpoint(channel) }
  )
  channel.transport.onTransportError(() => {
    void peer.close().then(
      () => process.exit(0),
      (error) => {
        report(error)
        process.exit(1)
      }
    )
  })
  process.stderr.write('registration-peer-ready\n')
} else {
  /** Preserve the fixed nested foreign business paths through the actual public Host provider. */
  await createRpcHost({
    /** A socket listener chooses its identity; automatic stdio adopts the original launch identity. */
    ...(address ? { self: { name: 'host-child', instanceId: 'host-child' } } : {}),
    provide: { p: { f: installed.getFeature('f') } },
    contract: catalog.p,
    report,
    plugins: [
      processPlugin({
        name: address ? 'listener' : 'parent',
        report,
        ...(address ? { listen: ingress } : { connectToParent: true })
      })
    ]
  })
  process.stderr.write(readyText.committed)
}
