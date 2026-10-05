import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { connected } from './fixture.js'

/** Source offers exercise each actual keyed mode without advertising unfinished production ports. */
const capabilities = [
  /** D40 default request/stream deadlines are genuinely offered by both source owners. */
  RpcCapability.deadline,
  ...RUNTIME_API_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.order,
  RpcCapability.group,
  RpcCapability.cancelBeforeStart,
  RpcCapability.outcome
]

it.each(['request', 'group', 'notify', 'stream'] as const)(
  '[A68][A69] admitted queued %s is pending in the original store and seals cancellation before terminal',
  async (mode) => {
    /** Only actual business invocation contributes execution; queued construction must remain zero. */
    let effects = 0
    /** The genuine predecessor owns the shared key before the tested member is admitted. */
    let started = false
    /** Fixture releases original business work without bypassing provider lifecycle. */
    let finish!: () => void
    /** Holding this provider preserves the actual canonical key queue and its admission lease. */
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** The same endpoint owns scalar, group, notify and generator routes under real handshake facts. */
    const fixture = await connected(
      {},
      {
        hold: async () => {
          started = true
          await held
          return 1
        },
        value: () => {
          effects += 1
          return 42
        },
        values: () => {
          effects += 1
          return (async function* () {
            yield 1
            return 42
          })()
        }
      },
      capabilities,
      capabilities
    )
    /** The original pending request remains observed on assertion failure and cleanup. */
    const holding = fixture.peers[0].request('hold', undefined, { orderKey: 'queue' })
    void holding.catch(() => undefined)
    /** Only this queued task receives cancellation intent. */
    const cancel = new AbortController()
    /** One actual logical key has a complete body fingerprint and mode-specific final outcome. */
    const options = {
      orderKey: 'queue',
      cancel: 'before-start' as const,
      signal: cancel.signal,
      idempotencyKey: 'queued-key'
    }
    /** Capture the genuine operation's terminal without leaving an unhandled notification or pull. */
    let operation: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => assert.equal(started, true))
      operation = (
        mode === 'request'
          ? fixture.peers[0].request('value', undefined, options)
          : mode === 'group'
            ? fixture.peers[0].group([{ method: 'value' }], options)
            : mode === 'notify'
              ? fixture.peers[0].notify('value', undefined, options)
              : fixture.peers[0].stream('values', undefined, options).next()
      ).catch((error: unknown) => error)
      /** This real original owner proves business admission, independently of store query results. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(fixture.peers[1]).endpoint,
        EndpointOwnerKey.providerAdmission
      )!
      await vi.waitFor(() => assert.equal(admission.size, 2))
      assert.equal(effects, 0)
      assert.equal(
        (await fixture.peers[0].outcome('queued-key')).state,
        'pending',
        '[A68] accepted waiting work cannot disappear from the key lifetime'
      )
      cancel.abort()
      if (mode !== 'notify')
        assert.equal(Reflect.get((await operation) as object, 'code'), RpcCoreErrorCode.cancelled)
      else
        assert.equal(
          await operation,
          undefined,
          '[A67] notification Promise remains physical-send completion'
        )
      await vi.waitFor(async () =>
        assert.equal((await fixture.peers[0].outcome('queued-key')).state, 'done')
      )
      /** Cancellation becomes a complete sealed fact before its real terminal is observed. */
      const outcome = await fixture.peers[0].outcome('queued-key')
      if (outcome.state !== 'done') assert.fail('[A69] cancelled admitted key must be sealed')
      assert.equal(outcome.outcome.mode, mode)
      assert.equal(outcome.outcome.completion.ok, false)
      if (outcome.outcome.completion.ok) assert.fail('[A69] cancellation cannot fabricate success')
      assert.equal(outcome.outcome.completion.error.code, RpcCoreErrorCode.cancelled)
      assert.equal(effects, 0)
      await vi.waitFor(() => assert.equal(admission.size, 1))
      finish()
      assert.equal(await holding, 1)
    } finally {
      finish()
      await fixture.close()
      await holding.catch(() => undefined)
      await operation
    }
  }
)
