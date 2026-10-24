import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRpcIdempotencyStore } from '../../../../rpc-host/dist/core/idempotency-store.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'
import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createStreamFeature } from '../../../../rpc-host/dist/core/stream/index.js'
import { createRuntimeFeatureRoots } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { prepareRuntimeProviderAssembly } from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import { compileRuntimeMethods } from '../../../../rpc-host/dist/remote/runtime-api/catalog.js'
import { describeRemoteMethods } from '../../../../rpc-host/dist/remote/serve-methods.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createProcessResilience } from '../../../../rpc-plugin-process/dist/process/resilience/index.js'
import { openProcessStdioChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { serveProcessSessions } from '../../../../rpc-plugin-process/dist/process/plugin/serve.js'

/** Bootstrap ownership starts before asynchronous Host installation, keeping the real pipe alive. */
const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
process.stderr.write('BOOTSTRAPPED\n')

/** This caller-owned temporary directory stores only test counters and completed outcomes. */
const directory = process.argv[2]
/** The tracked vector supplies the same contract used by the public client fixture. */
const contract = JSON.parse(
  readFileSync(new URL('../../../schema/vectors/remote-contract.json', import.meta.url), 'utf8')
).contracts[0].value
/** Authentication admits exactly one fixture principal; its public label contains no token. */
const principal = 'hf-authenticated-principal'
/** Authentication must succeed before any stable-scope endpoint can be constructed. */
let authenticated = false
/** The canonical ledger continues to own pending claims and settlement semantics. */
const canonical = createRpcIdempotencyStore()
/** Persistent completed outcomes keep the exact canonical scope and tuple key unchanged. */
const donePath = join(directory, 'done.json')
/** A separate counter is an independently observed business side effect. */
const countPath = join(directory, 'count.txt')
/** The fixture crashes only after the first completed outcome has been persisted. */
const crashPath = join(directory, 'crashed')
/** Completed-state backing implements the existing store boundary without another ledger. */
const store = {
  /**
   * @param {string} scope The authenticated public scope supplied by core.
   * @param {string} key The canonical method/key tuple supplied by core.
   * @param {number} now The canonical monotonic claim time.
   * @returns {import('@migaia/rpc/core').IRpcIdempotencyClaim} Existing done outcome or canonical
   *   claim.
   */
  claim(scope, key, now) {
    /** The fixture retains one completed benign outcome, not request parameters or credentials. */
    const done = existsSync(donePath) ? JSON.parse(readFileSync(donePath, 'utf8')) : undefined
    if (done?.scope === scope && done.key === key) return { status: 'done', outcome: done.outcome }
    /** Every new execution still claims through the package's canonical implementation. */
    const claim = canonical.claim(scope, key, now)
    if (claim.status !== 'claimed') return claim
    return {
      ...claim,
      /**
       * Persist the canonical completed outcome before a deliberate real crash.
       *
       * @param {import('@migaia/rpc/core').IRpcIdempotencyOutcome} outcome Benign fixture result.
       * @param {number} settledAt Canonical settlement timestamp.
       * @returns {void}
       */
      settle(outcome, settledAt) {
        claim.settle(outcome, settledAt)
        writeFileSync(donePath, JSON.stringify({ scope, key, outcome }), { mode: 0o600 })
        if (!existsSync(crashPath)) {
          writeFileSync(crashPath, '1', { mode: 0o600 })
          process.stderr.write('COMMITTED_BEFORE_CRASH\n')
          process.exit(17)
        }
      }
    }
  }
}
/** The fixed business object is compiled by the actual RuntimeHost provider owner. */
const provide = {
  p: {
    f: {
      /** Increment the independent side effect only when canonical provider execution occurs. */
      request() {
        const count = existsSync(countPath) ? Number(readFileSync(countPath, 'utf8')) : 0
        writeFileSync(countPath, String(count + 1), { mode: 0o600 })
        return 'committed'
      },
      oneWay() {},
      *generator() {
        yield 'fixture'
      },
      async *asyncGenerator() {
        yield 'fixture'
      }
    }
  }
}
process.stderr.write('INSTALLED\n')
const options = {
  report: (error) => process.stderr.write(`FIXTURE_ERROR ${String(error?.code ?? 'UNKNOWN')}\n`),
  ingress: {
    kind: 'child',
    channelKind: 'byte',
    openRaw: async () => {
      return { raw: opened.channel, bootstrap: opened.bootstrap }
    },
    createVerifier: (bootstrap) => {
      const expected = new TextDecoder().decode(bootstrap)
      return (actual) => {
        if (actual !== expected) throw new TypeError('fixture authentication rejected')
        authenticated = true
      }
    },
    establish: (raw, options) =>
      createProcessTransport(raw, {
        role: 'responder',
        peerId: 'caller',
        offer: createNativeProcessOffer({
          peer: { id: 'ts-peer', runtime: 'node' },
          stream: true,
          capabilities: ['abort@1', 'wire-error@1', 'runtime-api@1']
        }),
        auth: { mode: 'required', verify: options.verify },
        scheduler: options.scheduler,
        signal: options.signal,
        ipc: { ...options.session, log: () => undefined },
        report: () => undefined
      }),
    parentLoss: {
      exit: (code) => {
        process.exitCode = code
      }
    }
  },
  endpointFactory: async (channel, _signal, session) => {
    if (!authenticated) throw new TypeError('fixture principal not authenticated')
    /** Actual composition supplies the one shared outbound/provider owner and trusted policy. */
    const config = {
      id: 'ts-peer',
      transport: channel.transport,
      scheduler: channel.scheduler,
      idempotency: { store, scope: () => principal },
      providerLimits: session.limits,
      features: channel.features,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    }
    const { roots, options } = createRuntimeFeatureRoots(config, channel)
    /** Independent v1 peers use legacy streams over the same genuine outbound/provider owner. */
    roots['first-party-stream'] = createStreamFeature(
      roots['first-party-outbound'],
      roots['first-party-provider']
    )
    const endpoint = await createComposedEndpoint(options, roots)
    return { endpoint, stream: endpoint.stream }
  }
}
/** The original session manager supplies trusted identity, capacity and owned governor release. */
const resilience = createProcessResilience({ scheduler: systemScheduler, report: options.report })
await serveProcessSessions(
  options.ingress,
  options.endpointFactory,
  async ({ channel, endpoint }) => {
    /** Authentication and durable idempotency remain with the admitted native/Core owners. */
    const assembly = prepareRuntimeProviderAssembly({
      methods: compileRuntimeMethods(provide, contract),
      streams: channel.agreement.capabilities.includes('stream@1'),
      generations: false,
      supports: (_peerId, capability) => channel.agreement.capabilities.includes(capability),
      remoteNode: () => undefined,
      bindRemoteNode: () => undefined,
      describe: () =>
        describeRemoteMethods([contract], { name: 'ts-peer', instanceId: 'ts-peer' }, false)
    })
    assembly.install(endpoint.endpoint)
    return { close: () => endpoint.endpoint.dispose() }
  },
  resilience,
  options.report,
  undefined,
  systemScheduler,
  { release: () => resilience.close() }
).catch((error) => {
  process.stderr.write(`SETUP_FAILED ${String(error?.code ?? 'UNKNOWN')}\n`)
  process.exit(1)
})
process.stderr.write('READY\n')
