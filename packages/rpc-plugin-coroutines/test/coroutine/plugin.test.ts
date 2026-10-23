import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineFeaturePlugin, type IRpcHostMember } from '@migaia/rpc-host/plugin'
import { systemScheduler } from '@migaia/utils/scheduler'
import { coroutinePlugin, type ICoroutineConnect } from '../../dist/index.js'
import { readManagedRuntimeHolder } from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { service, ordinaryHost, outlet, values } from './fixture.js'

describe('coroutine transport plugin', () => {
  it('uses explicit task handles for bidirectional request notify stream and cancellation', async () => {
    const reports: unknown[] = []
    const child = service('child', (error) => reports.push(error))
    const notes: unknown[] = []
    const cancellation = { entered: 0, cancelled: 0 }
    const parent = await createRpcHost({
      plugins: [coroutinePlugin({ spawn: child.task })],
      report: (error) => reports.push(error),
      provide: {
        parentRead: (value: unknown) => ['parent', value],
        parentNotice: (value: unknown) => {
          notes.push(value)
        },
        parentValues: async function* () {
          yield 'parent'
          yield 2
        },
        parentWait: (_value: unknown, context: IRpcContext) =>
          new Promise<void>((_resolve, reject) => {
            cancellation.entered += 1
            const cancel = () => {
              cancellation.cancelled += 1
              reject(context.signal.reason)
            }
            if (context.signal.aborted) cancel()
            else context.signal.addEventListener('abort', cancel, { once: true })
          })
      }
    })
    try {
      await vi.waitFor(() => expect(child.children).toHaveLength(1))
      const reverse = child.children[0]!
      expect(await parent.request('read', 4)).toEqual(['child', 1, 4])
      expect(await reverse.request('parentRead', 5)).toEqual(['parent', 5])
      await parent.notify('notice', 'forward')
      await reverse.notify('parentNotice', 'reverse')
      await vi.waitFor(() => {
        expect(child.notices).toEqual(['forward'])
        expect(notes).toEqual(['reverse'])
      })
      expect(await values(parent.stream('values') as AsyncIterable<unknown>)).toEqual(['child', 1])
      expect(await values(reverse.stream('parentValues') as AsyncIterable<unknown>)).toEqual([
        'parent',
        2
      ])
      const forwardAbort = new AbortController()
      const reverseAbort = new AbortController()
      const forward = parent
        .request('wait', undefined, { signal: forwardAbort.signal })
        .catch((error) => error)
      const backward = reverse
        .request('parentWait', undefined, { signal: reverseAbort.signal })
        .catch((error) => error)
      await vi.waitFor(() => {
        expect(child.cancellation.entered).toBe(1)
        expect(cancellation.entered).toBe(1)
      })
      forwardAbort.abort()
      reverseAbort.abort()
      expect(await forward).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
      expect(await backward).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
      await vi.waitFor(() => {
        expect(child.cancellation.cancelled).toBe(1)
        expect(cancellation.cancelled).toBe(1)
      })
    } finally {
      await parent.close()
    }
  })

  it('retains the original cooperative signal and heartbeat through stop restart and task replacement', async () => {
    const reports: unknown[] = []
    const first = service('first', (error) => reports.push(error))
    const second = service('second', (error) => reports.push(error))
    const host = ordinaryHost()
    try {
      await host.use(
        coroutinePlugin({
          name: 'worker',
          spawn: first.task,
          report: (error) => reports.push(error)
        })
      )
      const runtime = outlet(host)
      const holder = readManagedRuntimeHolder(readRuntimeOutletConnection(runtime, 'worker')!.peer)!
      const ready = await holder.registration.supervisor.whenReady()
      expect(ready.state).toBe('ready')
      if (ready.state !== 'ready') return
      const unit = ready.unit as { readonly lastHeartbeatAt: number }
      const context = first.contexts[0]!
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.connect)).toBe(true)
      expect(Object.keys(context.connect)).toEqual([])
      const before = unit.lastHeartbeatAt
      await vi.waitFor(() => expect(systemScheduler.now()).toBeGreaterThan(before))
      context.heartbeat()
      expect(unit.lastHeartbeatAt).toBeGreaterThan(before)
      await runtime.stop('worker')
      expect(context.signal.aborted).toBe(true)
      expect(first.finished).toContain(context.connect)
      expect((await runtime.restart('worker')).state).toBe('ready')
      expect(first.contexts[1]!.signal).not.toBe(context.signal)
      expect(first.contexts[1]!.connect).not.toBe(context.connect)
      expect(() => runtime.replace('worker', { task: 1 } as never)).toThrowError(
        expect.objectContaining({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      )
      expect(await runtime.request('worker', 'read', 6)).toEqual(['first', 2, 6])
      expect((await runtime.replace('worker', { task: second.task })).kind).toBe('replaced')
      expect(await runtime.request('worker', 'read', 7)).toEqual(['second', 1, 7])
      expect(second.contexts[0]!.connect).not.toBe(first.contexts[1]!.connect)
    } finally {
      await host.dispose()
    }
  })

  it('opens one cold spawn definition twice as independent private members on one host', async () => {
    const reports: unknown[] = []
    const child = service('member', (error) => reports.push(error))
    const members: IRpcHostMember[] = []
    const transport = coroutinePlugin({ spawn: child.task })
    const assembler = defineFeaturePlugin({
      name: 'two-coroutine-members',
      async assemble(context) {
        members.push(await context.openMember(), await context.openMember())
        return members[0]!
      }
    })
    expect(child.contexts).toHaveLength(0)
    const host = await createRpcHost({
      plugins: [transport, assembler],
      report: (error) => reports.push(error)
    })
    try {
      expect(child.contexts).toHaveLength(2)
      expect(child.contexts[0]!.connect).not.toBe(child.contexts[1]!.connect)
      expect(new Set(members.map((member) => member.id)).size).toBe(2)
      expect(await members[0]!.request('read', 1)).toEqual(['member', 1, 1])
      expect(await members[1]!.request('read', 2)).toEqual(['member', 2, 2])
      await members[0]!.close()
      expect(await members[1]!.request('read', 3)).toEqual(['member', 2, 3])
    } finally {
      await host.close()
      expect(child.contexts.every((context) => context.signal.aborted)).toBe(true)
    }
  })

  it('rejects missing conflicting or noncallable task sources synchronously in the coroutine domain', () => {
    for (const options of [
      {},
      { spawn: () => undefined, connectToParent: {} },
      { spawn: 'x' },
      { connectToParent: true }
    ]) {
      expect(() => coroutinePlugin(options as never)).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          source: 'rpc.transport.coroutine',
          code: 'COROUTINE_SOURCE_INVALID'
        })
      )
    }
  })

  it('rejects forged copied and prototype-derived parent handles before opening a source', async () => {
    const child = service('token', () => undefined)
    const parent = await createRpcHost({
      plugins: [coroutinePlugin({ spawn: child.task })],
      report: () => undefined
    })
    try {
      const real = child.contexts[0]!.connect
      for (const forged of [{}, { ...real }, Object.create(real)]) {
        expect(() =>
          coroutinePlugin({ connectToParent: forged as ICoroutineConnect })
        ).toThrowError(
          expect.objectContaining({
            name: 'TypeError',
            source: 'rpc.transport.coroutine',
            code: 'COROUTINE_SOURCE_INVALID'
          })
        )
      }
      expect(await parent.request('read', 8)).toEqual(['token', 1, 8])
    } finally {
      await parent.close()
    }
  })

  it('installs the same final plugin in RPC and ordinary Hosts with name expose and unuse cleanup', async () => {
    const child = service('shared-definition', () => undefined)
    const transport = coroutinePlugin({
      name: 'worker',
      spawn: child.task,
      expose: ['math.double']
    })
    const rpc = await createRpcHost({
      plugins: [transport],
      provide: { math: { double: (value: number) => value * 2 } },
      report: () => undefined
    })
    const host = ordinaryHost()
    const app = definePlugin({
      name: 'math',
      features: { value: defineFeature(() => ({ double: (value: number) => value * 2 })) },
      install: () => ({})
    })
    try {
      await host.use(app, transport)
      expect(child.contexts).toHaveLength(2)
      expect(await child.children[0]!.request('math.double', 20)).toBe(40)
      expect(await child.children[1]!.request('math.double', 21)).toBe(42)
      expect(await outlet(host).request('worker', 'read', 9)).toEqual(['shared-definition', 2, 9])
      expect(await host.unUse('worker')).toMatchObject({ ok: true })
      expect(child.contexts[1]!.signal.aborted).toBe(true)
      expect(
        child.finished.filter((connect) => connect === child.contexts[1]!.connect)
      ).toHaveLength(1)
      expect(await rpc.request('read', 10)).toEqual(['shared-definition', 1, 10])
    } finally {
      await host.dispose()
      await rpc.close()
    }
  })

  it('uses the same replacement token and reporter owners when task and native cleanup both fail', async () => {
    const reports: unknown[] = []
    const failure = new Error('replacement coroutine task failed')
    const cleanup = new Error('replacement coroutine native close failed')
    const natives: MessageChannel[] = []
    const first = service('first', (error) => reports.push(error))
    const second = service('replacement', (error) => reports.push(error))
    const host = ordinaryHost()
    /** Every constructor result contains genuine native ports; only one native close is observed. */
    vi.stubGlobal(
      'MessageChannel',
      class {
        readonly port1: MessagePort
        readonly port2: MessagePort
        constructor() {
          const native = new MessageChannel()
          natives.push(native)
          this.port1 = native.port1 as unknown as MessagePort
          this.port2 = native.port2 as unknown as MessagePort
          if (natives.length === 2) {
            const original = native.port1.close
            vi.spyOn(native.port1, 'close').mockImplementation(() => {
              Reflect.apply(original, native.port1, [])
              throw cleanup
            })
          }
        }
      }
    )
    try {
      await host.use(
        coroutinePlugin({
          name: 'worker',
          spawn: first.task,
          report: (error) => reports.push(error),
          supervisor: { restart: { mode: 'never' } }
        })
      )
      const runtime = outlet(host)
      expect((await runtime.replace('worker', { task: second.task })).kind).toBe('replaced')
      expect(await runtime.request('worker', 'read', 11)).toEqual(['replacement', 1, 11])
      second.finishes[0]!.reject(failure)
      await vi.waitFor(() =>
        expect(reports).toContainEqual(expect.objectContaining({ code: 'SUPERVISION_EXHAUSTED' }))
      )
      expect(reports).toContain(cleanup)
      const terminal = reports.find(
        (error) =>
          error &&
          typeof error === 'object' &&
          Reflect.get(error, 'code') === 'SUPERVISION_EXHAUSTED'
      ) as Error
      expect((terminal.cause as Error).cause).toBe(failure)
      expect(await runtime.get('worker')).toMatchObject({ unit: { state: 'terminal' } })
    } finally {
      await host.dispose()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      for (const native of natives) {
        native.port1.close()
        native.port2.close()
      }
    }
  })
})
