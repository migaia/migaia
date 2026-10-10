import { parentPort, workerData, threadId } from 'node:worker_threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint
} from '../../../dist/remote/runtime-api/peer.js'
import { createRpcIdempotencyStore } from '../../../dist/core/idempotency-store.js'
import { retainRuntimeIdempotencyScope } from '../../../dist/core/internal/provider.js'
import { readFileSync, appendFileSync } from 'node:fs'
import { RUNTIME_API_CAPABILITIES } from '../../../dist/remote/runtime-api/constants.js'
import {
  readThreadRuntimeBootstrap,
  intersectThreadCapabilities
} from '../../../dist/threads/bootstrap.js'
import { createNodeThreadBootstrapHandoff } from '../../../dist/threads/receive-handoff.js'
import { createNodeThreadChannel } from '../../../dist/threads/channel.js'
import { ThreadBootstrap, THREAD_RUNTIME_API_VERSION } from '../../../dist/threads/constants.js'
import { bindNativeReplayTransport } from '../../../dist/core/internal/native-replay.js'
import '../../../dist/threads/adapters/node.js'

/** Only the actual native launcher supplies execution identity; fixture offers are explicit. */
const bootstrap = readThreadRuntimeBootstrap(workerData)
/** New-profile fixture labels do not change production default declarations. */
const capabilities = RUNTIME_API_CAPABILITIES
/** This isolate owns both its actual default store and its actual business execution count. */
let executions = 0
/** An optional fixture-owned journal survives actual isolate death outside the default store. */
const journal = workerData.data?.journal
/** Rehydrate the canonical store from complete settled records rather than duplicating its ledger. */
const retained = journal ? createRpcIdempotencyStore() : undefined
if (journal) {
  for (const line of readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line)
    const claim = retained.claim(entry.scope, entry.key, entry.now, entry.fingerprint)
    if (claim.status === 'claimed') claim.settle(entry.outcome, entry.now)
  }
}
/** The external fixture owner reports its own stable epoch and persists the original full outcome. */
const external = journal
  ? {
      claim(scope, key, now, fingerprint) {
        const claim = retained.claim(scope, key, now, fingerprint)
        if (claim.status !== 'claimed') return claim
        return {
          ...claim,
          settle(outcome, settledAt) {
            appendFileSync(
              journal,
              JSON.stringify({ scope, key, fingerprint, outcome, now: settledAt }) + '\n'
            )
            claim.settle(outcome, settledAt)
          }
        }
      },
      lookup: retained.lookup,
      readRuntimeFacts: () => ({
        kind: 'external',
        epoch: 'actual-worker-external-journal',
        continuity: 'retained'
      })
    }
  : undefined
/** The actual cold handoff supplies bootstrap ownership only after native acquisition. */
const resources = { generation: bootstrap.generation, bootstrap: undefined }
await createRuntimePeer(
  {
    self: bootstrap.self,
    /** Retain the original handoff, ACK and channel activation sequence. */
    connect: async () => {
      const handoff = createNodeThreadBootstrapHandoff(parentPort)
      resources.bootstrap = handoff
      parentPort.postMessage({
        kind: ThreadBootstrap.runtimeAcknowledged,
        version: THREAD_RUNTIME_API_VERSION,
        capabilities
      })
      const channel = createNodeThreadChannel(
        handoff.port,
        bootstrap.parent.instanceId,
        {
          scheduler: systemScheduler,
          capabilities: intersectThreadCapabilities(capabilities, bootstrap.capabilities)
        },
        handoff
      )
      bindNativeReplayTransport(parentPort, channel.transport)
      return channel
    },
    provide: { value: () => ({ executions: ++executions, threadId }) },
    ...(external
      ? {
          endpointFactory: (channel, signal) =>
            prepareRuntimePeerEndpoint(
              { self: bootstrap.self, report: () => undefined },
              channel,
              signal,
              {
                idempotency: {
                  store: external,
                  /** The original trusted native bootstrap proves this exact stable direct parent. */
                  scope: retainRuntimeIdempotencyScope(
                    () => bootstrap.parent.instanceId,
                    bootstrap.parent.instanceId
                  )
                }
              }
            )
        }
      : {}),
    /** Failure classification contains no bootstrap, caller input or native secret. */
    report: (error) =>
      process.stderr.write(`${error?.source ?? 'fixture'}:${error?.code ?? 'unknown'}\n`)
  },
  resources
)
