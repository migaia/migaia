import { describe, expect, it, vi } from 'vitest'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import type { IRuntimeEvent } from '@migaia/rpc-host/plugin'
import { BudgetRejection, createUnitBudget, SupervisorState } from '@migaia/supervision'
import type { ICoroutineHandle } from '@migaia/supervision/coroutine'
import { readManagedRuntimeHolder } from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import {
  coroutineFailure,
  coroutineService,
  coroutineTestHost
} from '../../../rpc-integration/test/runtime-api/fixtures/coroutine.js'

describe('coroutine runtime lifecycle', () => {
  it('restarts, stops, replaces and reports listener failure through the original outlet', async () => {
    /** Parent lifecycle remains the existing PluginHost owner. */
    const host = coroutineTestHost()
    /** Every cleanup or terminal diagnostic stays inspectable. */
    const reports: unknown[] = []
    /** Distinct providers prove that replacement maps the new user task. */
    const first = coroutineService('first', (error) => reports.push(error))
    /** The second task must be wrapped again to receive its own ports and opaque connect. */
    const second = coroutineService('second', (error) => reports.push(error))
    /** Event order is compared with the thread family's native public sequence. */
    const events: IRuntimeEvent[] = []
    /** Throwing observers must be reported while subsequent observers still run. */
    const listenerFailure = new Error('coroutine outlet listener failed')
    try {
      await host.use(
        coroutinePlugin({
          name: 'c',
          spawn: first.task,
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1 } },
          report: (error) => reports.push(error)
        })
      )
      for (const type of ['ready', 'exit', 'restart'] as const)
        host.coroutine!.on(type, (event) => events.push(event))
      host.coroutine!.on('ready', () => {
        throw listenerFailure
      })
      await host.coroutine!.restart('c')
      expect(events.slice(0, 3).map(({ type }) => type)).toEqual(['exit', 'restart', 'ready'])
      expect(reports).toContain(listenerFailure)
      await host.coroutine!.stop('c')
      expect((await host.coroutine!.restart('c')).state).toBe('ready')
      expect(await host.coroutine!.request('c', 'service.read', 'after-stop')).toEqual([
        'first',
        'after-stop'
      ])
      expect(() => host.coroutine!.replace('c', { task: 1 } as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(await host.coroutine!.request('c', 'service.read', 'unchanged')).toEqual([
        'first',
        'unchanged'
      ])
      expect((await host.coroutine!.replace('c', { task: second.task })).kind).toBe('replaced')
      expect(second.contexts).toHaveLength(1)
      expect(first.contexts).toHaveLength(3)
      expect(await host.coroutine!.request('c', 'service.read', 'replacement')).toEqual([
        'second',
        'replacement'
      ])
      /** A raw task rejection drives the same supervised crash restart chain as native families. */
      second.finishes[0]!.reject(new Error('coroutine supervised crash'))
      await vi.waitFor(() => expect(second.contexts).toHaveLength(2))
      await vi.waitFor(async () =>
        expect(await host.coroutine!.request('c', 'service.read', 'crash-restart')).toEqual([
          'second',
          'crash-restart'
        ])
      )
      expect(
        events.some(
          (event) =>
            event.type === 'exit' &&
            event.reason === 'crashed' &&
            event.error?.code === 'EXIT_UNEXPECTED'
        )
      ).toBe(true)
    } finally {
      await host.dispose()
      console.info('[coroutine lifecycle reports]', JSON.stringify(reports.map(coroutineFailure)))
    }
  })

  it.each([1, 2])(
    'late old settlement retains lease with maxUnits %i and cannot retire a newer generation',
    async (maxUnits) => {
      /** The two-unit case borrows a budget; the one-unit case exercises the actual family default. */
      const budget =
        maxUnits === 2
          ? createUnitBudget({ kind: 'coroutine', maxUnits, launchRate: false })
          : undefined
      /** Parent install uses the genuine public family and supervisor policy. */
      const host = coroutineTestHost()
      /** Expected abandonment/admission diagnostics are never swallowed. */
      const reports: unknown[] = []
      /** The old task deliberately ignores abort until this fixture settles it. */
      const old = coroutineService('old', (error) => reports.push(error), true)
      /** A successful replacement has an independently cooperative task and connection. */
      const fresh = coroutineService('new', (error) => reports.push(error))
      /** Late old exits must not be projected as an exit of the new generation. */
      const exits: IRuntimeEvent[] = []
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
        host.coroutine!.on('exit', (event) => exits.push(event))
        /** Existing supervision readiness exposes this exact old native handle before retirement. */
        const initial = await readManagedRuntimeHolder(
          readRuntimeOutletConnection(host.coroutine!, 'c')!.peer
        )!.registration.supervisor.whenReady()
        expect(initial.state).toBe('ready')
        /**
         * A native exit settles after child Host cleanup and wrapper port cleanup, unlike the
         * timer.
         */
        const oldUnit = (initial as { state: 'ready'; unit: ICoroutineHandle<MessagePort> }).unit
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
        const replacement = await host.coroutine!.replace('c', { task: fresh.task })
        if (maxUnits === 2) {
          expect(replacement.kind).toBe('replaced')
          expect(budget!.inUse).toBe(2)
          expect(await host.coroutine!.request('c', 'service.read', 'new')).toEqual(['new', 'new'])
        } else {
          expect(replacement).toMatchObject({ kind: 'rejected', reason: BudgetRejection.full })
          expect(fresh.contexts).toHaveLength(0)
        }
        await settle
        await oldUnit.exited
        // Native onExit queues the retained lease release on gone; join that existing reaction.
        await Promise.resolve()
        if (budget) await vi.waitFor(() => expect(budget.inUse).toBe(1))
        expect(exits.filter((event) => event.generation === 2)).toHaveLength(0)
        if (maxUnits === 2)
          expect(await host.coroutine!.get('c')).toMatchObject({
            unit: { state: SupervisorState.ready }
          })
        else {
          /** A ready restart after actual settlement proves the default lease is released. */
          expect((await host.coroutine!.restart('c')).state).toBe('ready')
          expect(await host.coroutine!.request('c', 'service.read', 'lease-released')).toEqual([
            'old',
            'lease-released'
          ])
        }
      } finally {
        old.finishes.forEach((finish) => finish.resolve())
        await host.dispose()
        budget?.close()
        console.info('[coroutine late reports]', JSON.stringify(reports.map(coroutineFailure)))
      }
    }
  )

  it('never-restart crash keeps terminal state and original crash on report cause', async () => {
    /** The same-realm crash object remains reachable beneath supervision's terminal diagnostic. */
    const failure = new Error('coroutine never restart crash')
    /** Reports are actual supervision diagnostics, not fixture-generated substitutes. */
    const reports: unknown[] = []
    /** A genuine task connects before its raw completion is rejected. */
    const service = coroutineService('terminal', (error) => reports.push(error))
    /** The original Host keeps its registered unit query after the ready receipt leaves. */
    const host = coroutineTestHost()
    try {
      await host.use(
        coroutinePlugin({
          name: 'c',
          spawn: service.task,
          supervisor: { restart: { mode: 'never' } },
          report: (error) => reports.push(error)
        })
      )
      service.finishes[0]!.reject(failure)
      await vi.waitFor(() =>
        expect(reports).toContainEqual(expect.objectContaining({ code: 'SUPERVISION_EXHAUSTED' }))
      )
      expect(await host.coroutine!.get('c')).toMatchObject({ unit: { state: 'terminal' } })
      /** The existing exit wrapper is between terminal error and the exact task error. */
      const terminal = reports.find(
        (error) => Reflect.get(error as object, 'code') === 'SUPERVISION_EXHAUSTED'
      ) as Error
      expect((terminal.cause as Error).cause).toBe(failure)
    } finally {
      await host.dispose()
    }
  })
})
