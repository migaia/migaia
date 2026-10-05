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

/** Ordering and ordinary cancellation are genuinely selected on both original physical peers. */
const capabilities = [
  ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
  RpcCapability.generation,
  RpcCapability.group,
  RpcCapability.order,
  RpcCapability.deadline
]

it.each([
  ['request', 'signal'],
  ['request', 'deadline'],
  ['notify', 'signal'],
  ['notify', 'deadline'],
  ['group', 'signal'],
  ['group', 'deadline']
] as const)(
  '[A56][A59] started ordered %s retains its lease after %s until real business completion',
  async (mode, control) => {
    /** The actual asynchronous handler ignores cancellation until its business barrier opens. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Real handler order detects overlapping execution rather than only caller settlement. */
    const effects: string[] = []
    /** Only the original provider signal proves that the authenticated cancellation arrived. */
    let providerSignal: IRpcAbortSignal | undefined
    const fixture = await connected(
      {},
      {
        held: async (_payload: unknown, context: { signal: IRpcAbortSignal }) => {
          providerSignal = context.signal
          effects.push('started')
          await held
          effects.push('completed')
          if (mode === 'group') throw new RangeError(RuntimeApiFixtureText.businessRange)
          return 1
        },
        unused: () => {
          effects.push('unused')
          return 2
        },
        after: () => {
          effects.push('after')
          return 7
        },
        barrier: () => 9
      },
      capabilities,
      capabilities
    )
    /** The test reads the original admission owner; no substitute quota or FIFO is installed. */
    const providers = readEndpointOwner<ProviderAdmissionRegistry>(
      readRuntimePeerConnection(fixture.peers[1]).endpoint,
      'provider-admission'
    )!
    /** The caller's native reason retains identity even though remote cleanup remains outstanding. */
    const controller = new AbortController()
    const reason = new RangeError(RuntimeApiFixtureText.businessRange)
    /** The group uses the same executor and cannot invoke its cancelled unstarted suffix. */
    const options = {
      orderKey: 'held-business',
      ...(control === 'signal' ? { signal: controller.signal } : { timeoutMs: 80 })
    }
    const operation = (
      mode === 'group'
        ? fixture.peers[0].group([{ method: 'held' }, { method: 'unused' }], options)
        : fixture.peers[0][mode]('held', undefined, options)
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    /** A same-key follower must remain queued while another key can still make progress. */
    let follower: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => assert.deepEqual(effects, ['started']), { interval: 5 })
      if (control === 'signal') controller.abort(reason)
      await vi.waitFor(() => assert.equal(providerSignal!.aborted, true), { interval: 5 })
      const terminal = await operation
      if (mode !== 'notify') {
        assert.ok('error' in terminal)
        if (control === 'signal') {
          assert.equal(Reflect.get(terminal.error as object, 'code'), RpcCoreErrorCode.cancelled)
          assert.equal(Reflect.get(terminal.error as object, 'cause'), reason)
        } else
          assert.equal(
            Reflect.get(terminal.error as object, 'code'),
            RpcCoreErrorCode.deadlineExceeded
          )
      } else assert.ok('value' in terminal, '[A56] notify still settles at physical completion')
      assert.equal(
        providers.size,
        mode === 'group' ? 2 : 1,
        '[A59] cancellation cannot release running business capacity'
      )
      follower = fixture.peers[0].request('after', undefined, { orderKey: 'held-business' })
      void follower.catch(() => undefined)
      assert.equal(
        await fixture.peers[0].request('barrier', undefined, { orderKey: 'other-key' }),
        9
      )
      assert.deepEqual(
        effects,
        ['started'],
        '[A59] a cancelled handler still owns its same-key FIFO'
      )
      /** Caller receipt can precede the barrier's own post-response lease release. */
      await vi.waitFor(
        () =>
          assert.equal(
            providers.size,
            mode === 'group' ? 3 : 2,
            '[A59] waiting and running retain their original leases'
          ),
        { interval: 5 }
      )
      release()
      assert.equal(await follower, 7)
      await vi.waitFor(() => assert.equal(providers.size, 0), { interval: 5 })
      assert.deepEqual(effects, ['started', 'completed', 'after'])
    } finally {
      release()
      await operation
      await follower?.catch(() => undefined)
      await fixture.close()
    }
  }
)
