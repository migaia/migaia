import { describe, expect, it, vi } from 'vitest'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import type { IRpcMemberEvent } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { BudgetRejection, createUnitBudget, SupervisorState } from '@migaia/supervision'
import { connectionOf } from '../../dist/coroutine-task.js'
import { ordinaryHost, outlet, runtimeService } from './fixture.ts'

describe('coroutine runtime lifecycle', () => {
  it.each([1, 2])(
    'late old settlement retains lease with maxUnits %i and cannot retire a newer generation',
    async (maxUnits) => {
      /** The two-unit case borrows a budget; the one-unit case exercises the actual family default. */
      const budget =
        maxUnits === 2
          ? createUnitBudget({ kind: 'coroutine', maxUnits, launchRate: false })
          : undefined
      /** Parent install uses the genuine public family and supervisor policy. */
      const host = ordinaryHost()
      /** Expected abandonment/admission diagnostics are never swallowed. */
      const reports: unknown[] = []
      /** The old task deliberately ignores abort until this fixture settles it. */
      const old = runtimeService('old', (error) => reports.push(error), true)
      /** A successful replacement has an independently cooperative task and connection. */
      const fresh = runtimeService('new', (error) => reports.push(error))
      /** Late old exits must not be projected as an exit of the new generation. */
      const exits: IRpcMemberEvent[] = []
      try {
        await host.use(
          coroutinePlugin({
            name: 'c',
            spawn: old.task,
            supervisor: {
              budget,
              stop: { drainTimeoutMs: 10, reapTimeoutMs: 50 },
              restart: { mode: 'never' }
            },
            report: (error) => reports.push(error)
          })
        )
        outlet(host).members.on('exit', (event) => exits.push(event))
        /** Public native query proves the actual original unit reached readiness. */
        expect(await outlet(host).members.get('c')).toMatchObject({ unit: { state: 'ready' } })
        /** The old genuine physical port closes only after task finally and wrapper cleanup. */
        const port = connectionOf(old.contexts[0]!.connect).port
        /** Node delivers the native close event after the task-settlement Promise reactions. */
        const departed = deferred<void>()
        const closed = () => departed.resolve()
        port.addEventListener('close', closed)
        /** Settlement is 200 ms after actual abort, so graceful drain cannot consume the interval. */
        const settle = new Promise<void>((resolve) =>
          old.contexts[0]!.signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                old.finishes[0]!.resolve()
                resolve()
              }, 200)
            },
            { once: true }
          )
        )
        /** The original supervisor owns the replacement admission result. */
        const replacement = await outlet(host).members.replace('c', { task: fresh.task })
        if (maxUnits === 2) {
          expect(replacement.kind).toBe('replaced')
          expect(budget!.inUse).toBe(2)
          expect(await outlet(host).request('service.read', 'new')).toEqual(['new', 'new'])
        } else {
          expect(replacement).toMatchObject({ kind: 'rejected', reason: BudgetRejection.full })
          expect(fresh.contexts).toHaveLength(0)
        }
        await settle
        await departed.promise
        port.removeEventListener('close', closed)
        // Native onExit queues the retained lease release on gone; join that existing reaction.
        await Promise.resolve()
        if (budget) await vi.waitFor(() => expect(budget.inUse).toBe(1))
        expect(exits.filter((event) => event.generation === 2)).toHaveLength(0)
        if (maxUnits === 2)
          expect(await outlet(host).members.get('c')).toMatchObject({
            unit: { state: SupervisorState.ready }
          })
        else {
          /** A ready restart after actual settlement proves the default lease is released. */
          expect((await outlet(host).members.restart('c')).state).toBe('ready')
          expect(await outlet(host).request('service.read', 'lease-released')).toEqual([
            'old',
            'lease-released'
          ])
        }
      } finally {
        old.finishes.forEach((finish) => finish.resolve())
        await host.dispose()
        budget?.close()
      }
    }
  )
})
