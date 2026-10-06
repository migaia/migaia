import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'

/** The same actual native child used by generation and shutdown acceptance holds its provider. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

/** Original owned binding and supervisor remain the only native lifecycle and drain owners. */
async function fixture() {
  /** The provider's reverse message proves genuine entry before close begins. */
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  const peer = await createThreadPeer<IRuntimeDynamicSurface>({
    self: { name: 'shutdown-parent', instanceId: 'shutdown-parent' },
    provide: { parent: { started: () => entered(), echo: () => 42 } },
    report: () => undefined,
    spawn: {
      spec: { entry, name: 'shutdown-child' },
      launcher: createNodeThreadLauncher(),
      budget,
      scheduler: systemScheduler,
      channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
      report: () => undefined
    }
  })
  return { peer, budget, started }
}

it('[A3][A9][R14] managed close immediately rejects all new public operations during native drain', async () => {
  const active = await fixture()
  /** This actual admitted call holds the endpoint alive while the public admission must close. */
  const pending = active.peer.request('drainGroup', 'admitted')
  const outcome = Promise.allSettled([pending])
  try {
    await active.started
    const closing = active.peer.close()
    assert.equal(active.peer.close(), closing)
    for (const invoke of [
      () => active.peer.request('delay', 1),
      () => active.peer.notify('service.data.read', 'fresh'),
      () => active.peer.stream('delayedValues', 1),
      () => active.peer.group([{ method: 'delay', payload: 1 }]),
      () => active.peer.outcome('closed-key')
    ])
      assert.throws(
        invoke,
        { code: 'REMOTE_CLOSED' },
        '[R14] close admission is synchronous before drain'
      )
    assert.deepEqual(await outcome, [{ status: 'fulfilled', value: 'admitted' }])
    await closing
    assert.equal(active.budget.inUse, 0)
  } finally {
    await outcome
    await active.peer.close()
  }
})

it('[A3][A9][A68] native drain preserves an already-started whole group through its terminal result', async () => {
  const active = await fixture()
  /** A group goes through runtime outbound directly; no separately tracked parent request exists. */
  const pending = active.peer.group([{ method: 'drainGroup', payload: 'complete' }])
  const outcome = Promise.allSettled([pending])
  try {
    await active.started
    const closing = active.peer.close()
    assert.equal(active.peer.close(), closing)
    assert.deepEqual(
      await outcome,
      [{ status: 'fulfilled', value: [{ state: 'success', result: 'complete' }] }],
      '[A68] the original group result must settle before native execution is released'
    )
    await closing
    assert.equal(active.budget.inUse, 0)
  } finally {
    await outcome
    await active.peer.close()
  }
})

for (const mode of ['default', 'ordered', 'before-start'] as const) {
  it(`[A3][A9][A69] native drain retains started runtime stream lifetime (${mode})`, async () => {
    const active = await fixture()
    /**
     * All modes use the original iterator; default bilateral binary capability also selects runtime
     * open.
     */
    const iterator = active.peer.stream(
      'drainValues',
      undefined,
      mode === 'default'
        ? undefined
        : mode === 'ordered'
          ? { orderKey: 'drain' }
          : { cancel: 'before-start' }
    )
    let pending: PromiseSettledResult<IteratorResult<unknown>>[] | undefined
    try {
      assert.deepEqual(await iterator.next(), { done: false, value: 'first' })
      /** No scalar request or local inbound provider can mask a missing stream drain lease. */
      const pulling = Promise.allSettled([iterator.next()])
      const closing = active.peer.close()
      assert.equal(active.peer.close(), closing)
      pending = await pulling
      assert.deepEqual(
        pending,
        [{ status: 'fulfilled', value: { done: false, value: 'second' } }],
        '[A69] native shutdown must preserve the admitted next item within the original drain budget'
      )
      assert.deepEqual(await iterator.next(), { done: true, value: 'terminal' })
      await closing
      assert.equal(active.budget.inUse, 0)
    } finally {
      await active.peer.close()
    }
  })
}
