import type { IRemoteChannelResources } from '../../src/remote/types.js'
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { createHmac } from 'node:crypto'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { ping } from '../../src/core/middleware/ping.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import {
  runtimeSources,
  RuntimeApiFixtureText,
  RUNTIME_API_FIXTURE_BASE_CAPABILITIES
} from './fixture.js'

it('[A68][A69] a genuine response signing failure retains the completed keyed group', async () => {
  /** Both peers negotiate the actual group, result store and caller deadline owners. */
  const capabilities = [
    ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
    RpcCapability.generation,
    RpcCapability.group,
    RpcCapability.order,
    RpcCapability.outcome,
    RpcCapability.deadline
  ]
  /** The reference transport delivers real business frames without substituting a dispatcher. */
  const carrier = runtimeSources(capabilities, capabilities)
  /** Fail one actual provider signature only after both business steps have completed. */
  let refuse = false
  /** Retain the original native signing failure through the canonical auth wrapper. */
  const signFailure = new RangeError(RuntimeApiFixtureText.lateAuthentication)
  /**
   * Reports preserve the original authentication error classification rather than a fixture
   * failure.
   */
  const failures: unknown[] = []
  /** Count business effects at their canonical provider invocation boundary. */
  let effects = 0
  /** Public fixture material signs the complete real authentication binding on both peers. */
  const signature = (value: unknown) =>
    createHmac('sha256', 'group-terminal-public-fixture-key')
      .update(JSON.stringify(value))
      .digest('hex')
  /** Select the original endpoint composition, including its real auth and result store owners. */
  const factory = (id: string, provider: boolean) => async (channel: IRemoteChannelResources) => {
    const endpoint = createRuntimeApiEndpoint(
      {
        id,
        scheduler: channel.scheduler,
        transport: channel.transport,
        targetIds: [channel.peerId],
        middlewares: [
          codec(channel.pipeline.codec),
          framer(channel.pipeline.framer),
          connect({ transport: channel.transport }),
          abort(),
          timeout(),
          hooks({ onHookError: (error) => failures.push(error) }),
          ping(),
          authentication({
            sign: (value) => {
              if (provider && refuse && effects === 2) {
                refuse = false
                throw signFailure
              }
              return { value, signature: signature(value) }
            },
            verify: (value) => {
              const frame = value as { value: unknown; signature: string }
              assert.equal(frame.signature, signature(frame.value))
              return frame.value
            }
          })
        ]
      },
      channel
    )
    await endpoint.ready
    return {
      endpoint: endpoint as unknown as IRpcEndpoint,
      oneWay: endpoint,
      stream: endpoint.stream
    }
  }
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: 'terminal-caller', instanceId: 'terminal-caller' },
      connect: carrier.sources[0],
      endpointFactory: factory('terminal-caller', false),
      report: (error) => failures.push(error)
    }),
    createRuntimePeer({
      self: { name: 'terminal-provider', instanceId: 'terminal-provider' },
      provide: { value: () => ++effects },
      connect: carrier.sources[1],
      endpointFactory: factory('terminal-provider', true),
      report: (error) => failures.push(error)
    })
  ])
  try {
    refuse = true
    /** This deadline observes the lost reply; it does not cancel business execution. */
    await assert.rejects(
      peers[0]!.group([{ method: 'value' }, { method: 'value' }], {
        idempotencyKey: 'completed-without-reply',
        timeoutMs: 50
      }),
      { code: RpcCoreErrorCode.deadlineExceeded }
    )
    assert.equal(effects, 2)
    await vi.waitFor(() =>
      assert.ok(
        failures.some(
          (error) =>
            error !== null &&
            typeof error === 'object' &&
            Reflect.get(error, 'code') === RpcCoreErrorCode.authenticationFailed &&
            Reflect.get(error, 'cause') === signFailure
        ),
        '[A69] the original authentication owner rejected response preparation'
      )
    )
    const outcome = await peers[0]!.outcome('completed-without-reply')
    assert.equal(outcome.state, 'done', '[A68] failed response preparation cannot delete done')
    const repeated = await peers[0]!.group([{ method: 'value' }, { method: 'value' }], {
      idempotencyKey: 'completed-without-reply'
    })
    assert.deepEqual(
      repeated.map((step) => step.state),
      ['success', 'success']
    )
    assert.equal(effects, 2, '[A68] the same business key must never execute again')
  } finally {
    for (const peer of peers) await peer.close()
    carrier.close()
  }
})
