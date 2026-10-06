import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { it, vi } from 'vitest'
import * as memory from '../../src/core/adapters/memory.js'
import { createPeerPair } from '../../src/testing/index.js'
import { RpcError, RpcCoreErrorCode } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { connected } from './fixture.js'

it('[A92] pair snapshots the second-side configuration before acquiring the original carrier', async () => {
  /** The spy observes the real carrier factory and never substitutes a fake transport. */
  const allocation = vi.spyOn(memory, 'createMemoryTransportPair')
  /** Construction must retain this exact primary configuration failure. */
  const primary = new Error('pair-second-config-fixture')
  /** This ordinary configuration field throws before either canonical Peer should start. */
  const second = Object.defineProperty({}, 'provide', {
    enumerable: true,
    get: () => {
      throw primary
    }
  }) as { provide: Record<string, never> }
  try {
    await assert.rejects(
      createPeerPair({ a: { provide: {} }, b: second, report: () => undefined }),
      (error) => error === primary
    )
    assert.equal(
      allocation.mock.calls.length,
      0,
      '[A92] no carrier or first Peer exists on config failure'
    )
  } finally {
    /** RED evidence still closes an actually allocated pair without taking ownership of other work. */
    for (const result of allocation.mock.results)
      if (result.type === 'return') result.value[0].close()
    allocation.mockRestore()
  }
})

it('[A89][A94] testing pair exports the canonical callable owner instead of a separate dispatcher', async () => {
  /** Actual production roots establish the business baseline before testing export admission. */
  const baseline = await connected({}, { echo: (value: unknown) => value })
  try {
    assert.equal(await baseline.peers[0].request('echo', 1), 1)
  } finally {
    await baseline.close()
  }
  const metadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(
    metadata.exports['./testing']?.default,
    './dist/testing/index.js',
    '[A94] the explicit testing-only subpath must be packed'
  )
  assert.equal(
    existsSync(new URL('../../src/testing/index.ts', import.meta.url)),
    true,
    '[A89] the canonical helper owns that single export'
  )
})

it('[A89][A90][A91] pair uses canonical binary, group, outcome and provider errors with honest memory metadata', async () => {
  const reports: unknown[] = []
  let effects = 0
  const pair = await createPeerPair({
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
    report: (error) => reports.push(error)
  })
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
    assert.equal(backing.byteLength, 2, '[A91] reference memory cannot pretend ownership transfer')
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
  }
})

it('[A89][A92] pair preserves original deadline, abort reason, close Promise and in-flight retirement', async () => {
  const reports: unknown[] = []
  /** The second actual handler invocation is the in-flight close observation. */
  let reached!: () => void
  const started = new Promise<void>((resolve) => {
    reached = resolve
  })
  let starts = 0
  const pair = await createPeerPair({
    a: { provide: {} },
    b: {
      provide: {
        hold: () => {
          if (++starts === 2) reached()
          return new Promise<void>(() => undefined)
        }
      }
    },
    report: (error) => reports.push(error)
  })
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
  }
})

it('[A92] a second-side canonical compilation failure rolls back the original pair without leaking the first', async () => {
  let reads = 0
  const invalid = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: () => {
      reads++
      return () => 1
    }
  })
  await assert.rejects(
    createPeerPair({
      a: { provide: { echo: (value: number) => value } },
      b: { provide: invalid },
      report: () => undefined
    }),
    { code: RpcCoreErrorCode.invalidConfig }
  )
  assert.equal(reads, 0)
})
