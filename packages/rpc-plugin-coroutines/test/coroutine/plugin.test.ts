import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { service, ordinaryHost, outlet, values } from './fixture.ts'

describe('coroutine transport plugin', () => {
  it('uses explicit task handles for bidirectional request notify stream and cancellation', async () => {
    /** Errors reported by either host, asserted empty at the end. */
    const reports: unknown[] = []
    /** Child service fixture that records its task contexts and notices. */
    const child = service('child', (error) => reports.push(error))
    /** Notices the parent receives from the child. */
    const notes: unknown[] = []
    /** Counts parent-side cancellable waits entered and cancelled. */
    const cancellation = { entered: 0, cancelled: 0 }
    /** Parent RPC host that spawns the child coroutine task. */
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
            /** Rejects the pending wait with the abort reason once. */
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
      /** Child-side host that calls back into the parent. */
      const reverse = child.children[0]!
      expect(await parent.coroutine.request('read', 4)).toEqual(['child', 1, 4])
      expect(await reverse.coroutine.request('parentRead', 5)).toEqual(['parent', 5])
      await parent.coroutine.notify('notice', 'forward')
      await reverse.coroutine.notify('parentNotice', 'reverse')
      await vi.waitFor(() => {
        expect(child.notices).toEqual(['forward'])
        expect(notes).toEqual(['reverse'])
      })
      expect(await values(parent.coroutine.stream('values'))).toEqual(['child', 1])
      expect(await values(reverse.coroutine.stream('parentValues'))).toEqual(['parent', 2])
      /** Aborts the parent-to-child wait. */
      const forwardAbort = new AbortController()
      /** Aborts the child-to-parent wait. */
      const reverseAbort = new AbortController()
      /** Settled outcome of the cancelled parent-to-child request. */
      const forward = parent.coroutine
        .request('wait', undefined, { signal: forwardAbort.signal })
        .catch((error) => error)
      /** Settled outcome of the cancelled child-to-parent request. */
      const backward = reverse.coroutine
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
    /** Errors reported across restart and replacement. */
    const reports: unknown[] = []
    /** Service fixture for the original task. */
    const first = service('first', (error) => reports.push(error))
    /** Service fixture for the replacement task. */
    const second = service('second', (error) => reports.push(error))
    /** Ordinary plugin host that installs the coroutine plugin. */
    const host = ordinaryHost()
    try {
      await host.use(
        coroutinePlugin({
          name: 'worker',
          spawn: first.task,
          report: (error) => reports.push(error)
        })
      )
      /** Coroutine namespace with its member extensions. */
      const runtime = outlet(host)
      expect(await runtime.members.get('worker')).toMatchObject({ unit: { state: 'ready' } })
      /** Task context handed to the first task. */
      const context = first.contexts[0]!
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.connect)).toBe(true)
      expect(Object.keys(context.connect)).toEqual([])
      await runtime.members.stop('worker')
      expect(context.signal.aborted).toBe(true)
      expect(first.finished).toContain(context.connect)
      expect((await runtime.members.restart('worker')).state).toBe('ready')
      expect(first.contexts[1]!.signal).not.toBe(context.signal)
      expect(first.contexts[1]!.connect).not.toBe(context.connect)
      await expect(runtime.members.replace('worker', { task: 1 } as never)).rejects.toThrowError(
        expect.objectContaining({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      )
      expect(await runtime.request('read', 6)).toEqual(['first', 2, 6])
      expect((await runtime.members.replace('worker', { task: second.task })).kind).toBe('replaced')
      expect(await runtime.request('read', 7)).toEqual(['second', 1, 7])
      expect(second.contexts[0]!.connect).not.toBe(first.contexts[1]!.connect)
    } finally {
      await host.dispose()
    }
  })

  it('opens one cold spawn definition twice as independent native installations', async () => {
    /** One cold definition must acquire no native work until genuine installation. */
    const reports: unknown[] = []
    /** Child service fixture shared by both installations. */
    const child = service('member', (error) => reports.push(error))
    /** One cold plugin definition installed twice. */
    const transport = coroutinePlugin({ spawn: child.task })
    expect(child.contexts).toHaveLength(0)
    /** First RPC host installation. */
    const first = await createRpcHost({
      plugins: [transport],
      report: (error) => reports.push(error)
    })
    /** Second RPC host installation. */
    const second = await createRpcHost({
      plugins: [transport],
      report: (error) => reports.push(error)
    })
    try {
      expect(child.contexts).toHaveLength(2)
      expect(child.contexts[0]!.connect).not.toBe(child.contexts[1]!.connect)
      /** Parent readiness may precede the child's Host construction callback publication. */
      await vi.waitFor(() => expect(child.children).toHaveLength(2))
      expect(
        new Set([child.children[0]!.self.instanceId, child.children[1]!.self.instanceId]).size
      ).toBe(2)
      expect(await first.coroutine.request('read', 1)).toEqual(['member', 1, 1])
      expect(await second.coroutine.request('read', 2)).toEqual(['member', 2, 2])
      await first.close()
      expect(await second.coroutine.request('read', 3)).toEqual(['member', 2, 3])
    } finally {
      await first.close()
      await second.close()
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
    /** Child service fixture that provides the real parent handle. */
    const child = service('token', () => undefined)
    /** Parent RPC host that owns the real handle. */
    const parent = await createRpcHost({
      plugins: [coroutinePlugin({ spawn: child.task })],
      report: () => undefined
    })
    try {
      /** Genuine parent handle that forged copies imitate. */
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
      expect(await parent.coroutine.request('read', 8)).toEqual(['token', 1, 8])
    } finally {
      await parent.close()
    }
  })

  it('installs the same final plugin in RPC and ordinary Hosts with name expose and unuse cleanup', async () => {
    /** Child service fixture shared by the RPC and ordinary hosts. */
    const child = service('shared-definition', () => undefined)
    /** One final plugin definition installed into both hosts. */
    const transport = coroutinePlugin({
      name: 'worker',
      spawn: child.task,
      expose: ['math.double']
    })
    /** RPC host installation of the shared plugin. */
    const rpc = await createRpcHost({
      plugins: [transport],
      provide: { math: { double: (value: number) => value * 2 } },
      report: () => undefined
    })
    /** Ordinary host installation of the shared plugin. */
    const host = ordinaryHost()
    /** Plugin that provides the exposed math feature on the ordinary host. */
    const app = definePlugin({
      name: 'math',
      features: { value: defineFeature(() => ({ double: (value: number) => value * 2 })) },
      install: () => ({})
    })
    try {
      await host.use(app, transport)
      expect(child.contexts).toHaveLength(2)
      expect(await child.children[0]!.coroutine.request('math.double', 20)).toBe(40)
      expect(await child.children[1]!.coroutine.request('math.double', 21)).toBe(42)
      expect(await outlet(host).request('read', 9)).toEqual(['shared-definition', 2, 9])
      expect(await host.unUse(transport.name)).toMatchObject({ ok: true })
      expect(child.contexts[1]!.signal.aborted).toBe(true)
      expect(
        child.finished.filter((connect) => connect === child.contexts[1]!.connect)
      ).toHaveLength(1)
      expect(await rpc.coroutine.request('read', 10)).toEqual(['shared-definition', 1, 10])
    } finally {
      await host.dispose()
      await rpc.close()
    }
  })

  it('uses the same replacement token and reporter owners when task and native cleanup both fail', async () => {
    /** Errors reported by task and native cleanup failures. */
    const reports: unknown[] = []
    /** Failure of the replacement task. */
    const failure = new Error('replacement coroutine task failed')
    /** Failure thrown by the observed native port close. */
    const cleanup = new Error('replacement coroutine native close failed')
    /** Every MessageChannel the stubbed constructor creates. */
    const natives: MessageChannel[] = []
    /** Service fixture for the original task. */
    const first = service('first', (error) => reports.push(error))
    /** Service fixture for the replacement task. */
    const second = service('replacement', (error) => reports.push(error))
    /** Ordinary plugin host that installs the coroutine plugin. */
    const host = ordinaryHost()
    /** Every constructor result contains genuine native ports; only one native close is observed. */
    vi.stubGlobal(
      'MessageChannel',
      class {
        readonly port1: MessagePort
        readonly port2: MessagePort
        constructor() {
          /** Real native channel behind the stub. */
          const native = new MessageChannel()
          natives.push(native)
          this.port1 = native.port1 as unknown as MessagePort
          this.port2 = native.port2 as unknown as MessagePort
          if (natives.length === 2) {
            /** Native close kept so the spy still closes the port. */
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
      /** Coroutine namespace with its member extensions. */
      const runtime = outlet(host)
      expect((await runtime.members.replace('worker', { task: second.task })).kind).toBe('replaced')
      expect(await runtime.request('read', 11)).toEqual(['replacement', 1, 11])
      second.finishes[0]!.reject(failure)
      await vi.waitFor(() =>
        expect(reports).toContainEqual(expect.objectContaining({ code: 'SUPERVISION_EXHAUSTED' }))
      )
      expect(reports).toContain(cleanup)
      /** Terminal supervision report raised after the replacement fails. */
      const terminal = reports.find(
        (error) =>
          error &&
          typeof error === 'object' &&
          Reflect.get(error, 'code') === 'SUPERVISION_EXHAUSTED'
      ) as Error
      expect((terminal.cause as Error).cause).toBe(failure)
      expect(await runtime.members.get('worker')).toMatchObject({ unit: { state: 'terminal' } })
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
