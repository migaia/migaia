import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { RpcError, RpcCoreErrorCode } from '../../dist/core/errors.js'
import { RpcCoreErrorText } from '../../dist/core/error-text.js'
import { runtimeSources } from './fixture.js'

it('canonical peers use binary, group, outcome and provider errors with honest memory metadata', async () => {
  const reports: unknown[] = []
  let effects = 0
  const pairOptions = {
    a: { provide: { twice: (value: number) => value * 2 } },
    b: {
      provide: {
        echo: (value: ArrayBuffer) => value,
        count: () => ++effects,
        fail: () => {
          throw new RpcError(
            RpcCoreErrorCode.capabilityUnsupported,
            RpcCoreErrorText.capabilityUnsupported
          )
        },
        values: async function* () {
          yield new Uint8Array([3])
        }
      }
    },
    report: (error: unknown) => reports.push(error)
  }
  /** Reuse the independently negotiated sources and actual canonical Peer constructors. */
  const pairChannel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
  const [a, b] = await Promise.all([
    createRuntimePeer({
      ...pairOptions.a,
      self: { name: 'a', instanceId: 'test-pair-a' },
      connect: pairChannel.sources[0],
      report: pairOptions.report
    }),
    createRuntimePeer({
      ...pairOptions.b,
      self: { name: 'b', instanceId: 'test-pair-b' },
      connect: pairChannel.sources[1],
      report: pairOptions.report
    })
  ])
  const pair = { a, b }
  try {
    assert.equal(await pair.b.request('twice', 2), 4)
    const backing = new Uint8Array([1, 2]).buffer
    const copied = await pair.a.request('echo', backing)
    assert.ok(copied instanceof ArrayBuffer)
    assert.notEqual(copied, backing)
    assert.deepEqual([...new Uint8Array(copied)], [1, 2])
    await assert.rejects(pair.a.request('echo', backing, { transfer: [backing] }), {
      code: RpcCoreErrorCode.capabilityUnsupported
    })
    assert.equal(backing.byteLength, 2, 'reference memory cannot pretend ownership transfer')
    const group = await pair.a.group([{ method: 'count' }, { method: 'count' }], {
      idempotencyKey: 'pair-group'
    })
    assert.deepEqual(
      group.map((step) => step.state),
      ['success', 'success']
    )
    assert.equal((await pair.a.outcome('pair-group')).state, 'done')
    await pair.a.group([{ method: 'count' }, { method: 'count' }], { idempotencyKey: 'pair-group' })
    assert.equal(effects, 2)
    await assert.rejects(pair.a.request('fail'), { code: RpcCoreErrorCode.capabilityUnsupported })
    const stream = pair.a.stream('values')
    assert.deepEqual((await stream.next()).value, new Uint8Array([3]))
    await stream.return!(undefined)
    assert.equal((await pair.a.describe()).connections[0]!.carrier, 'Memory')
  } finally {
    await Promise.all([pair.a.close(), pair.b.close()])
    pairChannel.close()
  }
})

it('canonical peers preserve original deadline, abort reason, close Promise and in-flight retirement', async () => {
  const reports: unknown[] = []
  /** The second actual handler invocation is the in-flight close observation. */
  let reached!: () => void
  const started = new Promise<void>((resolve) => {
    reached = resolve
  })
  let starts = 0
  const pairOptions = {
    a: { provide: {} },
    b: {
      provide: {
        hold: () => {
          if (++starts === 2) reached()
          return new Promise<void>(() => undefined)
        }
      }
    },
    report: (error: unknown) => reports.push(error)
  }
  /** Reuse the independently negotiated sources and actual canonical Peer constructors. */
  const pairChannel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
  const [a, b] = await Promise.all([
    createRuntimePeer({
      ...pairOptions.a,
      self: { name: 'a', instanceId: 'test-pair-a' },
      connect: pairChannel.sources[0],
      report: pairOptions.report
    }),
    createRuntimePeer({
      ...pairOptions.b,
      self: { name: 'b', instanceId: 'test-pair-b' },
      connect: pairChannel.sources[1],
      report: pairOptions.report
    })
  ])
  const pair = { a, b }
  try {
    await assert.rejects(pair.a.request('hold', undefined, { timeoutMs: 5 }), {
      code: RpcCoreErrorCode.deadlineExceeded
    })
    const controller = new AbortController()
    const reason = new Error('pair-abort-fixture')
    controller.abort(reason)
    const failure = await pair.a
      .request('hold', undefined, { signal: controller.signal })
      .catch((error: unknown) => error)
    assert.equal((failure as Error & { code: string }).code, RpcCoreErrorCode.cancelled)
    assert.equal((failure as Error).cause, reason)
    const active = pair.a.request('hold').catch((error: unknown) => error)
    await started
    const first = pair.a.close()
    assert.equal(pair.a.close(), first)
    await first
    assert.ok((await active) instanceof Error)
  } finally {
    await Promise.all([pair.a.close(), pair.b.close()])
    pairChannel.close()
  }
})
