import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createFullOneWayEndpoint } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import * as agreements from '../../src/core/internal/batch-frame.js'
import { RpcCapability, RpcBatchPhysical } from '../../src/contract/wire-constants.js'
import type { IRpcEnvelope } from '../../src/contract/index.js'
import { PendingRegistry } from '../../src/core/internal/pending.js'

it('[R14-A28] live receive agreement changes between two physical batches and late custom establishment registers', async () => {
  const [left, right] = createMemoryTransportPair()
  /** Hold only genuine provider replies to force a two-member physical frame. */
  const replies: IRpcEnvelope[] = []
  /** Count physical batch emissions independently from logical members. */
  const writes: unknown[] = []
  /** Keep every real receiver failure observable rather than swallowing it. */
  const failures: unknown[] = []
  /** Retain the source transport callback and restore it after this fixture. */
  const original = right.send
  /** Warm-up control is excluded from the two measured physical batches. */
  let armed = false
  /** Three first-frame members distinguish per-frame query owners from a per-member loop. */
  let width = 3
  right.send = (frame, options) => {
    /** Keep this local observation independent from the production operation owner. */
    const physical = frame as { kind?: string; envelopes?: IRpcEnvelope[] }
    /** Keep this local observation independent from the production operation owner. */
    const members =
      physical.kind === RpcBatchPhysical.kind ? physical.envelopes! : [frame as IRpcEnvelope]
    if (armed && members.every((member) => member.kind === 'response')) {
      replies.push(...members)
      if (replies.length === width) {
        /** Keep this local observation independent from the production operation owner. */
        const batch = { kind: RpcBatchPhysical.kind, envelopes: replies.splice(0) }
        writes.push(batch)
        return original(batch, options)
      }
      return
    }
    return original(frame, options)
  }
  /** Actual caller owns the two original request IDs and their pending entries. */
  const caller = await createFullOneWayEndpoint({
    id: 'r14-agreement-caller',
    transport: left,
    middlewares: [connect({ transport: left })]
  })
  /** Actual provider returns responses through the same production sender. */
  const provider = await createFullOneWayEndpoint({
    id: 'r14-agreement-provider',
    transport: right,
    provider: { echo: (context) => context.success(context.data) },
    middlewares: [connect({ transport: right })]
  })
  /** Own only this fixture diagnostic subscription until terminal cleanup. */
  const remove = caller.hooks.on((event) => {
    if (event.name === 'failure') failures.push(event.error)
  })
  /** Observe real private agreement queries without replacing their implementation. */
  const query = vi.spyOn(agreements, 'hasBatchAgreement')
  /** Actual pending registration identifies the caller's canonical request owner. */
  const registrations = vi.spyOn(PendingRegistry.prototype, 'set')
  /** Keep rejected response waiters observed until original close settles them. */
  const pending: Promise<unknown>[] = []
  try {
    assert.equal(await caller.send('r14-agreement-provider', 'echo', 'warm'), 'warm')
    /** The warm request binds this exact registry; no debug projection supplies its occupancy. */
    const registry = registrations.mock.contexts[0] as PendingRegistry<unknown>
    query.mockClear()
    armed = true
    /** A custom establisher publishes accepted batch capability after construction completes. */
    agreements.registerBatchAgreement(left, [RpcCapability.batch])
    assert.deepEqual(
      await Promise.all([
        caller.send('r14-agreement-provider', 'echo', 1),
        caller.send('r14-agreement-provider', 'echo', 2),
        caller.send('r14-agreement-provider', 'echo', 5)
      ]),
      [1, 2, 5],
      '[R14-A28] late agreement accepts first batch members'
    )
    assert.equal(writes.length, 1)
    /** Count physical size and receive lookups for the first complete frame. */
    const firstQueries = query.mock.calls.filter(([transport]) => transport === left).length
    assert.equal(
      firstQueries,
      2,
      '[R14-A28] first physical frame has physical-size and receive queries independent of three members'
    )
    assert.equal(registry.size, 0)
    agreements.registerBatchAgreement(left, [])
    width = 2
    query.mockClear()
    pending.push(
      caller.send('r14-agreement-provider', 'echo', 3).catch((error) => error),
      caller.send('r14-agreement-provider', 'echo', 4).catch((error) => error)
    )
    await vi.waitFor(() => assert.equal(writes.length, 2))
    await vi.waitFor(() =>
      assert.equal(query.mock.calls.filter(([transport]) => transport === left).length, 2)
    )
    await nextTurn()
    assert.equal(
      query.mock.calls.filter(([transport]) => transport === left).length,
      2,
      '[R14-A28] second physical frame rechecks current agreement'
    )
    assert.equal(
      registry.size,
      2,
      '[R14-A28] withdrawn agreement rejects batch before member settlement'
    )
    assert.deepEqual(
      failures,
      [],
      '[R14-A28] unsupported batch follows original unknown-kind disposition'
    )
    await caller.dispose()
    /** Close resolves the two still-pending original request failures once. */
    const terminal = await Promise.all(pending)
    assert.equal(
      terminal.every((value) => value instanceof Error),
      true
    )
    assert.equal(registry.size, 0)
  } finally {
    query.mockRestore()
    registrations.mockRestore()
    remove()
    await Promise.all([caller.dispose(), provider.dispose()])
    await Promise.all(pending)
    right.send = original
    left.close()
    right.close()
  }
})
