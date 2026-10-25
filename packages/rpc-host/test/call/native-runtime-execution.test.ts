/** Original completed-group retention survives failure at the genuine native terminal write. */
import { createRpcHost } from '@migaia/rpc-host'
import { createRpcIdempotencyStore, idempotency } from '@migaia/rpc-host/features/idempotency'
import { RpcContractErrorCode, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcWireProfile, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { attachErrorIdentity } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

// RPC-TEST-3CA7BB5939FE-C005: all original retained-completion predicates remain unchanged.
it('a send adapter forged FRAME_LIMIT code cannot rewrite the original completed group replay outcome', async () => {
  /** The actual optional feature receives this original injectable memory store. */
  const store = createRpcIdempotencyStore()
  /** Real diagnostics retain the original native write failure and its cause identity. */
  const reports: unknown[] = []
  /** The authentic public provider supplies the same logical provider scope as the original test. */
  const server = coreMemoryServer('provider')
  /** This real provider alone creates the original completed business value42. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency({ store, scope: () => 'peer' }), ...server.options.plugins],
    report: (error) => reports.push(error),
    provide: { value: (_payload, context) => context.success(42) }
  })
  /** The actual accepted caller invokes a group through its existing public namespace. */
  const client = await server.connect('caller')
  /** Publicly attached diagnostics cannot impersonate the contract owner's native failure. */
  const reason = attachErrorIdentity(new Error('adapter frame fixture'), {
    source: 'rpc.contract',
    code: RpcContractErrorCode.frameLimitExceeded
  })
  /** One explicit IO context borrows the genuine physical writer and records its refusal. */
  const terminal = {
    write: client.pair[0].write,
    reason,
    attempted: deferred<void>()
  }
  /** Only the original group terminal is refused; handshake and native cleanup keep real IO. */
  const failure = vi.spyOn(client.pair[0], 'write').mockImplementation((frame, options) => {
    /** The original identity medium already carries semantic metadata; no observer parser runs. */
    const message = frame.data as IRpcSemanticFrame
    if (message.kind === 'result' && message.task.mode === 'group') {
      terminal.attempted.resolve()
      return Promise.reject(terminal.reason)
    }
    return terminal.write(frame, options)
  })
  /** The missing physical reply keeps its original caller Promise pending until genuine close. */
  const pending = client.host.memory
    .group([{ method: 'value' }], { idempotencyKey: 'completed-key' })
    .catch((error: unknown) => error)
  try {
    await terminal.attempted.promise
    /** The actual response owner must finish reporting its failed write before retention is read. */
    await vi.waitFor(() =>
      expect(reports).toContainEqual(
        expect.objectContaining({ code: RpcCoreErrorCode.transport, cause: reason })
      )
    )
    /** Only the profile spelling changes; the real installed scope callback chooses the same peer. */
    const scope = JSON.stringify([RpcWireProfile, 'provider', 'peer'])
    /** Inspect the same authentic store after original business completion and terminal refusal. */
    const retained = store.lookup!(scope, 'completed-key', performance.now())
    assert.equal(retained.state, 'done')
    if (retained.state !== 'done' || retained.outcome === 'unavailable' || !retained.outcome.ok)
      assert.fail('completed outcome missing')
    /** Preserve the original null-prototype-compatible retained completion inspection. */
    const completion = Reflect.get(retained.outcome.data as object, 'completion') as {
      ok: boolean
      result: readonly { state: string; result: number }[]
    }
    assert.equal(completion.ok, true)
    assert.equal(completion.result.length, 1)
    assert.equal(completion.result[0]!.state, 'success')
    assert.equal(completion.result[0]!.result, 42)
  } finally {
    failure.mockRestore()
    await Promise.all([client.host.close(), host.close()])
    await pending
  }
})
