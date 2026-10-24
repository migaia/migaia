import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'

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
  /** The real native Host owns installation and rollback for this managed connection. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The committed outlet lends its genuine managed Peer and original iterator/call contracts. */
  const peer = await host
    .use(
      threadPlugin({
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
    )
    .then(() => readRuntimeOutletConnection(host.thread, RuntimePluginKey.thread)!.peer)
  return { peer, host, budget, started }
}

it('managed close immediately rejects all new public operations during native drain', async () => {
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
        'close admission is synchronous before drain'
      )
    assert.deepEqual(await outcome, [{ status: 'fulfilled', value: 'admitted' }])
    await closing
    assert.equal(active.budget.inUse, 0)
  } finally {
    await outcome
    await active.host.dispose()
  }
})

it('native drain preserves an already-started whole group through its terminal result', async () => {
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
      'the original group result must settle before native execution is released'
    )
    await closing
    assert.equal(active.budget.inUse, 0)
  } finally {
    await outcome
    await active.host.dispose()
  }
})

for (const mode of ['default', 'ordered', 'before-start'] as const) {
  it(`native drain retains started runtime stream lifetime (${mode})`, async () => {
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
        'native shutdown must preserve the admitted next item within the original drain budget'
      )
      assert.deepEqual(await iterator.next(), { done: true, value: 'terminal' })
      await closing
      assert.equal(active.budget.inUse, 0)
    } finally {
      await active.host.dispose()
    }
  })
}
