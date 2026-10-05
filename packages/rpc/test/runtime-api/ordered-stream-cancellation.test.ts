import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import {
  connected,
  RuntimeApiFixtureText,
  RUNTIME_API_FIXTURE_BASE_CAPABILITIES
} from './fixture.js'

/** The genuine bilateral agreement supports ordering and ordinary cancellation independently. */
const capabilities = [
  ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.order,
  RpcCapability.deadline
]

it.each(['signal', 'deadline'] as const)(
  '[A56][A59] order-only stream %s settles locally before outstanding provider cleanup',
  async (control) => {
    /** A real async generator keeps its outstanding next and return queued on business work. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Actual handler progress distinguishes cancellation settlement from cleanup completion. */
    const effects: string[] = []
    /** Read the original provider signal rather than inferring cancellation from caller promises. */
    let providerSignal: IRpcAbortSignal | undefined
    const fixture = await connected(
      {},
      {
        values: async function* (_payload: unknown, context: { signal: IRpcAbortSignal }) {
          providerSignal = context.signal
          effects.push('started')
          try {
            await held
            yield 1
          } finally {
            effects.push('cleanup')
          }
        },
        after: () => {
          effects.push('after')
          return 7
        }
      },
      capabilities,
      capabilities
    )
    /** Ordering alone must preserve the original signal reason and full-scope deadline behavior. */
    const controller = new AbortController()
    const reason = new RangeError(RuntimeApiFixtureText.businessRange)
    const iterator = fixture.peers[0].stream('values', undefined, {
      orderKey: 'held-cleanup',
      ...(control === 'signal' ? { signal: controller.signal } : { timeoutMs: 80 })
    })
    /** Observe both outcomes immediately; failed assertions must not create late unhandled errors. */
    let settled = false
    const next = iterator.next().then(
      (value) => {
        settled = true
        return { value }
      },
      (error: unknown) => {
        settled = true
        return { error }
      }
    )
    /** Canonical provider and consumer Maps retain the actual lease and pending state. */
    const providers = readEndpointOwner<ProviderAdmissionRegistry>(
      readRuntimePeerConnection(fixture.peers[1]).endpoint,
      'provider-admission'
    )!
    const consumers = readEndpointOwner<Map<string, unknown>>(
      readRuntimePeerConnection(fixture.peers[0]).endpoint,
      'stream-consumer-registry'
    )!
    let follower: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => assert.deepEqual(effects, ['started']), { interval: 5 })
      if (control === 'signal') controller.abort(reason)
      await vi.waitFor(
        () => assert.equal(settled, true, '[A56] cancellation cannot wait for business cleanup'),
        { timeout: 250, interval: 5 }
      )
      const terminal = await next
      assert.ok('error' in terminal)
      if (control === 'signal') assert.equal(terminal.error, reason)
      else
        assert.equal(
          Reflect.get(terminal.error as object, 'code'),
          RpcCoreErrorCode.deadlineExceeded
        )
      assert.equal(consumers.size, 0)
      await vi.waitFor(() => assert.equal(providerSignal!.aborted, true), { interval: 5 })
      assert.equal(providers.size, 1, '[A59] local cancellation cannot release remote cleanup')
      follower = fixture.peers[0].request('after', undefined, { orderKey: 'held-cleanup' })
      void follower.catch(() => undefined)
      assert.deepEqual(effects, ['started'])
      release()
      assert.equal(await follower, 7)
      await vi.waitFor(() => assert.equal(providers.size, 0), { interval: 5 })
      assert.deepEqual(effects, ['started', 'cleanup', 'after'])
    } finally {
      release()
      await fixture.close()
      await next
      await follower?.catch(() => undefined)
    }
  }
)
