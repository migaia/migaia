import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { threadProtocolDefinition as createThreadPlugin } from './fixtures/thread-protocol.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import type { IRuntimeEvent } from '../../../rpc-host/dist/remote/runtime-api/events.js'
import {
  RuntimeQueryClock,
  RuntimeQueryReason,
  type RuntimeEventName
} from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { coroutineFailure, coroutineService, coroutineTestHost } from './fixtures/coroutine.js'

/** Real Worker entry establishes the first connection and throws before the second connects. */
const entry = fileURLToPath(new URL('./fixtures/terminal-worker.ts', import.meta.url))

for (const family of ['thread', 'coroutine'] as const) {
  it(`${family} emits terminal after a crash and failed second launch`, async () => {
    /** Host retains the registered unit after its physical generation becomes unavailable. */
    const host = coroutineTestHost()
    /** Reports preserve native supervision failures separately from projected safe events. */
    const reports: unknown[] = []
    /** The timeline retains immutable public lifecycle events in actual delivery order. */
    const events: IRuntimeEvent[] = []
    /** Native handles permit a genuine first-generation crash and independent cleanup. */
    const handles: Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>>[] = []
    /** Relaunch count is recorded at the original task or launcher entry only. */
    let launches = 0
    /** One local error deterministically crashes the already ready coroutine task. */
    const crash = new Error('r6 terminal coroutine first generation crash')
    /** A distinct cause rejects the second task before child connection construction. */
    const relaunch = new Error('r6 terminal coroutine second generation fails')
    /** Existing child Host fixture owns the first task's genuine connection and disposal. */
    const service = coroutineService('terminal', (error) => reports.push(error))
    /** Missing public terminal vocabulary is retained as exact red evidence, after real crash. */
    let subscriptionFailure: unknown
    try {
      if (family === 'thread') {
        /** Native construction and channel readiness remain with their canonical platform owners. */
        const launcher = createNodeThreadLauncher()
        await host.use(
          createThreadPlugin({
            name: 'terminal-unit',
            report: (error) => reports.push(error),
            spawn: {
              spec: { entry, name: 'terminal-child' },
              budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
              scheduler: systemScheduler,
              launcher: {
                ...launcher,
                launch: async (spec, context) => {
                  launches += 1
                  /** Attempt data reaches the actual entry without replacing the native launcher. */
                  const handle = await launcher.launch(
                    { ...spec, data: { sequence: launches } },
                    context
                  )
                  handles.push(handle)
                  if (launches === 2) {
                    /**
                     * This caller-selected launcher waits for the original native startup result.
                     * Native construction readiness precedes RPC readiness; the second entry must
                     * actually exit with its error before this launcher reports failed startup.
                     */
                    const status = await handle.exited
                    assert.ok(status.error)
                    throw status.error
                  }
                  return handle
                }
              },
              channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
              supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
              report: (error) => reports.push(error)
            }
          })
        )
      } else {
        await host.use(
          coroutinePlugin({
            name: 'terminal-unit',
            report: (error) => reports.push(error),
            supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
            spawn: (context) => {
              launches += 1
              if (launches === 2) return Promise.reject(relaunch)
              return service.task(context)
            }
          })
        )
      }
      /** Subscriptions observe original native events, never fabricated terminal receipts. */
      const outlet = host[family]!
      outlet.on('exit', (event) => events.push(event))
      outlet.on('restart', (event) => events.push(event))
      try {
        outlet.on('terminal' as RuntimeEventName, (event) => events.push(event))
      } catch (error) {
        subscriptionFailure = error
      }
      if (family === 'thread') {
        handles[0]!.terminate()
        await handles[0]!.exited
      } else service.finishes[0]!.reject(crash)
      await vi.waitFor(
        () =>
          assert.ok(
            reports.some(
              (error) =>
                error !== null &&
                typeof error === 'object' &&
                Reflect.get(error, 'code') === 'SUPERVISION_EXHAUSTED'
            )
          ),
        { timeout: 5000 }
      )
      assert.equal(launches, 2, 'the original supervisor actually attempted the failed relaunch')
      assert.equal(
        subscriptionFailure,
        undefined,
        `terminal subscription is public: ${JSON.stringify(coroutineFailure(subscriptionFailure))}`
      )
      /**
       * Terminal is one safe observation after the real crash, even when a failed Worker also
       * exits.
       */
      const terminal = events.filter((event) => event.type === ('terminal' as RuntimeEventName))
      assert.equal(terminal.length, 1, `missing terminal after exit: ${JSON.stringify(events)}`)
      assert.equal(terminal[0]!.name, 'terminal-unit')
      assert.deepEqual(terminal[0]!.error, {
        source: 'supervision',
        code: 'SUPERVISION_EXHAUSTED'
      })
      assert.equal(
        terminal[0]!.generation,
        2,
        'terminal names the last attempted generation, not the retired ready generation'
      )
      assert.deepEqual(
        terminal[0]!.instanceId,
        { status: 'unavailable', reason: RuntimeQueryReason.owner },
        'an unconnected failed attempt cannot inherit an old RPC identity'
      )
      assert.deepEqual(terminal[0]!.timestamp, {
        status: 'unavailable',
        reason: RuntimeQueryReason.owner
      })
      assert.equal(terminal[0]!.clock, RuntimeQueryClock.scheduler)
      assert.ok(Object.isFrozen(terminal[0]!), 'terminal projection is an immutable public record')
      /** Failed preparation emits no successful restart event between crash and terminal. */
      const crashIndex = events.findIndex(
        (event) => event.type === 'exit' && event.reason === 'crashed'
      )
      assert.ok(crashIndex >= 0)
      assert.ok(events.indexOf(terminal[0]!) > crashIndex)
      assert.equal(
        events
          .slice(crashIndex + 1, events.indexOf(terminal[0]!))
          .filter((event) => event.type === 'restart').length,
        0
      )
    } finally {
      await host.dispose()
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
  }, 15000)
}
