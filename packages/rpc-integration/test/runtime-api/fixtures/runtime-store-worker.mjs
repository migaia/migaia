import { parentPort, workerData, threadId } from 'node:worker_threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { prepareRuntimePeerEndpoint } from '../../../../rpc-core/dist/remote/runtime-api/peer.js'
import { createRpcIdempotencyStore } from '@migaia/rpc-core'
import { createRuntimeProviderScope } from '@migaia/rpc-core/adapter'
import { readFileSync, appendFileSync } from 'node:fs'
import { RUNTIME_API_CAPABILITIES } from '../../../../rpc-core/dist/remote/runtime-api/constants.js'
import { createEventEmitterMessageResource } from '@migaia/rpc-core/adapter'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { readAdapterMessagePreparation } from '../../../../rpc-core/dist/runtime-adapter/message/resource.js'
import '@migaia/rpc-threads/adapters/node'

/** Only the actual native launcher supplies execution identity; fixture offers are explicit. */
const resource = createEventEmitterMessageResource(parentPort)
/** Core admits the actual native initial data once and retains its exact preparation identity. */
await resource.receiveInitial({ read: () => workerData, direction: 'inbound' })
/** Existing store/generation observations use the actual Core-held preparation, never copied fields. */
const preparation = readAdapterMessagePreparation(resource)
/** The initial metadata came from the same canonical parser used by the real adapter. */
const bootstrap = preparation.initial
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
/** The actual Core channel's inbound native preparation supplies its stable parent scope privately. */
const runtimeScope = external ? createRuntimeProviderScope(external) : undefined
/** The actual cold handoff supplies bootstrap ownership only after native acquisition. */
const resources = { generation: bootstrap.generation, bootstrap: preparation }
await createRuntimePeer(
  {
    self: bootstrap.self,
    /** Retain the original handoff, ACK and channel activation sequence. */
    connect: async () => {
      return resource.open({
        peerId: bootstrap.parent.instanceId,
        scheduler: systemScheduler,
        offer: capabilities,
        control: rpcMessageCapabilityControl
      })
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
                idempotency: runtimeScope.session(channel, {}).idempotency
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
