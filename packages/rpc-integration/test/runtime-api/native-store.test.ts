import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCapability } from '@migaia/rpc-contract'
import {
  createRpcIdempotencyStore,
  type IRpcIdempotencyStore
} from '../../../rpc-host/dist/core/idempotency-store.js'

import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from '../../../rpc-host/test/runtime-api/fixture.js'

/** Actual native handshake offers exercise the new store port independently of unfinished defaults. */
const capabilities = [
  /** Default request/stream deadlines are genuinely offered by both source owners. */
  RpcCapability.deadline,
  ...RUNTIME_API_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.order,
  RpcCapability.outcome
]

it('authenticated reconnect retains the service store and replacement reads the same external namespace without sharing principals', async () => {
  /** The fixture external owner persists outside both independently created listener lifetimes. */
  const retained = createRpcIdempotencyStore()
  /** Its epoch denotes this actual shared owner; no listener is allowed to invent another one. */
  const external: IRpcIdempotencyStore = Object.freeze({
    claim: retained.claim,
    lookup: retained.lookup,
    readRuntimeFacts: () =>
      ({
        kind: 'external',
        epoch: 'actual-external-fixture',
        continuity: 'retained'
      }) as const
  })
  /** Real handler executions remain observable across socket reconnect and service replacement. */
  let executions = 0
  /** The original listener binds each fresh address and owns accepted native channels. */
  let address = ''
  /** Every report is preserved so expected isolation cannot hide unrelated transport failures. */
  const failures: unknown[] = []
  /** Each new governor owns its own old-profile prefix; only new-profile stable scope may persist. */
  const serve = async () => {
    const resilience = createProcessResilience({
      scheduler: systemScheduler,
      report: (error) => failures.push(error),
      idempotencyStore: external
    })
    const peer = await createRpcHost({
      self: { name: 'stable-service', instanceId: 'stable-service' },
      provide: { value: () => ++executions },
      report: (error) => failures.push(error),
      plugins: [
        processPlugin({
          listen: {
            kind: 'listener',
            address: 'tcp://127.0.0.1:0',
            resilience,
            listen: async (options) => {
              const listener = await listenProcessByteChannel(options)
              address = listener.address
              return listener
            },
            verify: (auth) => String(auth),
            offer: createNativeProcessOffer({
              peer: { id: 'stable-service', runtime: 'node' },
              capabilities
            }),
            createConnectionContext: () => ({
              peerId: 'stable-caller',
              ipc: { connectionId: 'native-store', sessionId: 'native-store', log: () => undefined }
            })
          }
        })
      ]
    })
    return {
      peer,
      close: async () => {
        await peer.close()
        await resilience.close()
      }
    }
  }
  /** Each genuine native connection owns a distinct Host identity, separate from its principal. */
  let sequence = 0
  /** Original authentication supplies a stable principal independently of changing physical sockets. */
  const connect = (principal: string) => {
    /** Reconnect continuity must derive from authentication, never a reused physical caller name. */
    const instanceId = `stable-caller-${++sequence}`
    return createRuntimePeer({
      self: { name: instanceId, instanceId },
      connect: async () =>
        createProcessTransport(await dialProcessByteChannel({ address }), {
          role: 'initiator',
          offer: createNativeProcessOffer({
            peer: { id: instanceId, runtime: 'node' },
            auth: principal,
            capabilities
          }),
          peerId: 'stable-service',
          ipc: {
            connectionId: instanceId,
            sessionId: instanceId,
            log: () => undefined
          },
          report: (error) => failures.push(error)
        }),
      report: (error) => failures.push(error)
    })
  }
  /** Cleanup follows actual source ownership, including assertion failures during replacement. */
  let service: Awaited<ReturnType<typeof serve>> | undefined
  let client: IRuntimePeer | undefined
  try {
    service = await serve()
    client = await connect('principal-one')
    assert.equal(
      await client.request('value', undefined, { orderKey: 'same', idempotencyKey: 'key' }),
      1
    )
    const first = await client.outcome('key')
    assert.equal(first.state, 'done')
    await client.close()
    client = await connect('principal-one')
    assert.deepEqual(
      await client.outcome('key'),
      first,
      'reconnect does not replace the execution store'
    )
    await client.close()
    await service.close()
    service = await serve()
    client = await connect('principal-one')
    assert.deepEqual(
      await client.outcome('key'),
      first,
      'an external result uses the stable provider namespace and authenticated principal'
    )
    assert.equal(
      await client.request('value', undefined, { orderKey: 'same', idempotencyKey: 'key' }),
      1
    )
    assert.equal(executions, 1)
    await client.close()
    client = await connect('principal-two')
    assert.equal(
      (await client.outcome('key')).state,
      'unknown',
      'another authenticated principal cannot observe result existence'
    )
    assert.equal(
      await client.request('value', undefined, { orderKey: 'same', idempotencyKey: 'key' }),
      2
    )
    assert.deepEqual(failures, [])
  } finally {
    await client?.close()
    await service?.close()
  }
})
