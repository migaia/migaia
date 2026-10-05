import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createProcessListenerPeer } from '../../src/process/runtime-listener.js'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import { createProcessError } from '../../src/process/error.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  readRuntimePeerSessions,
  type IRuntimePeer
} from '../../src/remote/runtime-api/peer.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'

it.each(['rate', 'payload', 'fail-stop', 'queued-cancel', 'rollover'] as const)(
  '[A62][A63][A66] real native group %s preserves exact original quota ownership',
  async (policy) => {
    /** Fixture offers only the profile under test, independently of production default offers. */
    const capabilities = [
      /** D40 default request/stream deadlines are genuinely offered by both source owners. */
      RpcCapability.deadline,
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.group,
      RpcCapability.order,
      RpcCapability.cancelBeforeStart
    ]
    /** A fresh monotonic rate window excludes the genuine describe exchange from business setup. */
    let offset = 0
    /** Native deadlines retain the production timer while quota time can move to a fresh minute. */
    const scheduler = { ...systemScheduler, now: () => systemScheduler.now() + offset }
    /** Every observed failure remains available for diagnosis without suppressing assertions. */
    const failures: unknown[] = []
    /** The original governor owns rate/payload policy throughout this real listener lifetime. */
    const resilience = createProcessResilience({
      scheduler,
      report: (error) => failures.push(error),
      maxCallsPerMinute: policy === 'rate' ? 2 : policy === 'payload' ? 100 : 4,
      maxPayloadBytes: policy === 'payload' ? 128 : 4096,
      idleTimeoutMs: 600_000
    })
    /** The OS allocates a fresh loopback port for actual authentication and framing. */
    let address = ''
    /** Only business handlers contribute effects; the baseline request proves original quota. */
    const effects: string[] = []
    /** A running predecessor keeps cancellation in the final provider's queued phase. */
    let finish!: () => void
    /** This fixture releases its own business work without substituting the provider executor. */
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** Cleanup observes the original pending request even when an assertion fails. */
    let holding: Promise<unknown> | undefined
    /** This accepted endpoint uses the same original provider wrappers as native production. */
    const server = await createProcessListenerPeer(
      {
        self: { name: 'group-provider', instanceId: 'group-provider' },
        provide: {
          baseline: () => 42,
          first: () => {
            effects.push('first')
            return 1
          },
          second: () => {
            effects.push('second')
            if (policy === 'fail-stop')
              throw createProcessError(RpcProcessErrorCode.healthPingFailed)
            return 2
          },
          hold: async () => {
            effects.push('hold')
            await held
            return 3
          }
        },
        report: (error) => failures.push(error)
      },
      {
        kind: 'listener',
        address: 'tcp://127.0.0.1:0',
        scheduler,
        resilience,
        listen: async (options) => {
          /** The actual address belongs to this freshly bound listener. */
          const listener = await listenProcessByteChannel(options)
          address = listener.address
          return listener
        },
        verify: (auth) => {
          assert.equal(auth, 'group-admission-fixture')
          return 'verified-group-principal'
        },
        offer: createNativeProcessOffer({
          peer: { id: 'group-provider', runtime: 'node' },
          capabilities
        }),
        createConnectionContext: () => ({
          peerId: 'group-caller',
          ipc: {
            connectionId: 'group-connection',
            sessionId: 'group-session',
            log: () => undefined
          }
        })
      }
    )
    /** Only this actual connected Peer can send the tested physical group frame. */
    let client: IRuntimePeer | undefined
    try {
      client = await createRuntimePeer({
        self: { name: 'group-caller', instanceId: 'group-caller' },
        connect: async () => {
          /** Native transport negotiation owns authentication and the selected codec/framer. */
          const raw = await dialProcessByteChannel({ address })
          return createProcessTransport(raw, {
            role: 'initiator',
            offer: createNativeProcessOffer({
              peer: { id: 'group-caller', runtime: 'node' },
              auth: 'group-admission-fixture',
              capabilities
            }),
            peerId: 'group-provider',
            ipc: { connectionId: 'group-client', sessionId: 'group-client', log: () => undefined },
            report: (error) => failures.push(error)
          })
        },
        report: (error) => failures.push(error)
      })
      offset = 60_000
      assert.equal(await client.request('baseline'), 42)
      /** The accepted endpoint's actual lease owner proves queued admission and cleanup. */
      const accepted = readRuntimePeerSessions(server)![0]!
      /** Policy assertions inspect the production owner, never a fixture quota replacement. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(accepted).endpoint,
        EndpointOwnerKey.providerAdmission
      )!
      if (policy === 'queued-cancel' || policy === 'rollover') {
        holding = client.request('hold', undefined, { orderKey: 'queue' })
        void holding.catch(() => undefined)
        await vi.waitFor(() => assert.deepEqual(effects, ['hold']))
        /** Intent revokes only the queued group, leaving its started predecessor untouched. */
        const cancel = new AbortController()
        /** The final executor reserves both members behind the original running key lease. */
        const queued = client
          .group([{ method: 'first' }, { method: 'second' }], {
            orderKey: 'queue',
            cancel: 'before-start',
            signal: cancel.signal
          })
          .catch((error: unknown) => error)
        await vi.waitFor(() => assert.equal(admission.size, 3))
        if (policy === 'rollover') {
          offset = 120_000
          assert.equal(await client.request('baseline'), 42)
        }
        cancel.abort()
        assert.equal(Reflect.get((await queued) as object, 'code'), RpcCoreErrorCode.cancelled)
        await vi.waitFor(() => assert.equal(admission.size, 1))
        assert.deepEqual(effects, ['hold'], '[A66] cancelled members never enter native providers')
        for (let index = 0; index < (policy === 'rollover' ? 3 : 2); index += 1)
          assert.equal(await client.request('baseline'), 42)
        if (policy === 'rollover')
          await assert.rejects(client.request('baseline'), (error: unknown) => {
            /** Ordinary requests retain their existing INTERNAL wrapper and process cause. */
            const cause = Reflect.get(error as object, 'cause') as object
            return (
              Reflect.get(error as object, 'code') === RpcCoreErrorCode.internal &&
              Reflect.get(cause, 'source') === '@migaia/rpc/process' &&
              Reflect.get(cause, 'code') === RpcProcessErrorCode.connectionLimit
            )
          })
        finish()
        assert.equal(await holding, 3)
        return
      }
      if (policy === 'fail-stop') {
        /** Three credits commit, but failure means only two original guards execute. */
        const result = await client.group([
          { method: 'first' },
          { method: 'second' },
          { method: 'first' }
        ])
        assert.deepEqual(
          result.map((step) => step.state),
          ['success', 'failure', 'not-executed']
        )
        assert.deepEqual(effects, ['first', 'second'])
        await vi.waitFor(() => assert.equal(admission.size, 0))
        assert.equal(
          await client.request('baseline'),
          42,
          '[A63] unexecuted member credit is refunded'
        )
        return
      }
      /** Rate has one remaining slot; payload has a valid first member and oversized second. */
      const outcome = await client
        .group([
          { method: 'first', payload: 'small' },
          { method: 'second', payload: policy === 'payload' ? 'x'.repeat(512) : 'small' }
        ])
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error })
        )
      assert.deepEqual(effects, [], '[A62] refusal must precede every native provider side effect')
      assert.ok('error' in outcome, '[A62] whole-group admission failure rejects the group')
      assert.equal(
        Reflect.get(outcome.error as object, 'code'),
        RpcProcessErrorCode.connectionLimit
      )
      assert.equal(Reflect.get(outcome.error as object, 'source'), '@migaia/rpc/process')
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(await client.request('baseline'), 42, '[A63] rejected group consumes zero quota')
    } finally {
      finish()
      await client?.close()
      await server.close()
      await resilience.close()
      await holding?.catch(() => undefined)
    }
  }
)
