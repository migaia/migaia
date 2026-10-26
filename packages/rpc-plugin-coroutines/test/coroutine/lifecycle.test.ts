import { describe, expect, it, vi } from 'vitest'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import type { IRpcMemberEvent } from '@migaia/rpc-host/sdk'
import { ordinaryHost, outlet, runtimeService } from './fixture.js'

describe('coroutine native lifecycle', () => {
  it('rejects invalid native member commands through their declared Promise boundary', async () => {
    /** The public namespace belongs to a real task and its accepted parent Session. */
    const host = ordinaryHost()
    /** The existing task fixture keeps native cleanup and generation ownership unchanged. */
    const task = runtimeService('command-errors', () => undefined)
    try {
      await host.use(coroutinePlugin({ name: 'c', spawn: task.task, report: () => undefined }))
      /** Every command must return a Promise even when target admission fails locally. */
      const commands = [
        () => outlet(host).members.stop(''),
        () => outlet(host).members.kill(''),
        () => outlet(host).members.restart(''),
        () => outlet(host).members.replace('')
      ]
      /** Capture sync throws separately so the regression checks all four real operations. */
      const observed = commands.map((command) => {
        try {
          return { synchronous: false, outcome: command().catch((error: unknown) => error) }
        } catch (error) {
          return { synchronous: true, outcome: Promise.resolve(error) }
        }
      })
      /** Existing error identity and text remain unchanged; only delivery obeys the public type. */
      const errors = await Promise.all(observed.map((entry) => entry.outcome))
      expect(observed.map((entry) => entry.synchronous)).toEqual([false, false, false, false])
      for (const error of errors)
        expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      expect(await outlet(host).request('service.read', 'still-serving')).toEqual([
        'command-errors',
        'still-serving'
      ])
    } finally {
      await host.dispose()
    }
  })

  it('restarts, stops, replaces and reports listener failure through the original outlet', async () => {
    /** Parent lifecycle remains the existing PluginHost owner. */
    const host = ordinaryHost()
    /** Every cleanup or terminal diagnostic stays inspectable. */
    const reports: unknown[] = []
    /** Distinct providers prove that replacement maps the new user task. */
    const first = runtimeService('first', (error) => reports.push(error))
    /** The second task must be wrapped again to receive its own ports and opaque connect. */
    const second = runtimeService('second', (error) => reports.push(error))
    /** Event order is compared with the thread family's native public sequence. */
    const events: IRpcMemberEvent[] = []
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
        outlet(host).members.on(type, (event) => events.push(event))
      outlet(host).members.on('ready', () => {
        throw listenerFailure
      })
      await outlet(host).members.restart('c')
      expect(events.slice(0, 3).map(({ type }) => type)).toEqual(['exit', 'restart', 'ready'])
      expect(reports).toContain(listenerFailure)
      await outlet(host).members.stop('c')
      expect((await outlet(host).members.restart('c')).state).toBe('ready')
      expect(await outlet(host).request('service.read', 'after-stop')).toEqual([
        'first',
        'after-stop'
      ])
      await expect(outlet(host).members.replace('c', { task: 1 } as never)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(await outlet(host).request('service.read', 'unchanged')).toEqual([
        'first',
        'unchanged'
      ])
      expect((await outlet(host).members.replace('c', { task: second.task })).kind).toBe('replaced')
      expect(second.contexts).toHaveLength(1)
      expect(first.contexts).toHaveLength(3)
      expect(await outlet(host).request('service.read', 'replacement')).toEqual([
        'second',
        'replacement'
      ])
      /** A raw task rejection drives the same supervised crash restart chain as native families. */
      second.finishes[0]!.reject(new Error('coroutine supervised crash'))
      await vi.waitFor(() => expect(second.contexts).toHaveLength(2))
      await vi.waitFor(async () =>
        expect(await outlet(host).request('service.read', 'crash-restart')).toEqual([
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
    }
  })

  it('never-restart crash keeps terminal state and original crash on report cause', async () => {
    /** The same-realm crash object remains reachable beneath supervision's terminal diagnostic. */
    const failure = new Error('coroutine never restart crash')
    /** Reports are actual supervision diagnostics, not fixture-generated substitutes. */
    const reports: unknown[] = []
    /** A genuine task connects before its raw completion is rejected. */
    const service = runtimeService('terminal', (error) => reports.push(error))
    /** The original Host keeps its registered unit query after the ready receipt leaves. */
    const host = ordinaryHost()
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
      expect(await outlet(host).members.get('c')).toMatchObject({ unit: { state: 'terminal' } })
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
