import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import * as serveOwner from '../../dist/process/plugin/serve.js'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'

import { socketProcess, command, stopProcess } from './plugin-control.js'

describe('native process transport plugin', () => {
  it.skipIf(process.platform === 'win32')(
    'drains scalar and both stream directions on their actual native session before listener retirement',
    async () => {
      /** Native acquisition still invokes the complete original Process session owner. */
      const serve = serveOwner.serveProcessSessions
      /** Native setup lends its original SDK context, including exact session lookup and drain. */
      let transport: IRpcTransportSetupContext | undefined
      /** Observe the real SDK return without replacing a handle, drain or business completion. */
      const serving = vi
        .spyOn(serveOwner, 'serveProcessSessions')
        .mockImplementation((ingress, context, options) => {
          transport = context
          return serve(ingress, context, options)
        })
      /** Independent business barriers make each native lifetime observable without a test timer. */
      const scalarStarted = deferred<void>()
      const scalarReleased = deferred<void>()
      const producerStarted = deferred<void>()
      const producerReleased = deferred<void>()
      const address = join(tmpdir(), `rpc-drain-${randomUUID()}.sock`)
      const token = randomUUID()
      const server = await createRpcHost({
        self: { name: 'drain-server', instanceId: randomUUID() },
        plugins: [processPlugin({ listen: address, token })],
        provide: {
          held: async () => {
            scalarStarted.resolve()
            await scalarReleased.promise
            return 7
          },
          heldSequence: async function* () {
            producerStarted.resolve()
            yield 1
            await producerReleased.promise
            yield 2
          }
        },
        report: () => undefined
      })
      const children: ChildProcess[] = []
      let scalar: Promise<unknown> | undefined
      let producer: Promise<unknown> | undefined
      let returned: Promise<IteratorResult<unknown>> | undefined
      let consumer: AsyncIterableIterator<unknown> | undefined
      let closing: Promise<void> | undefined
      try {
        const first = await socketProcess('connect', address, token, 'drain-a')
        children.push(first)
        const second = await socketProcess('connect', address, token, 'drain-b')
        children.push(second)
        /** The canonical address index selects the two original physical generation handles. */
        const firstDrain = transport!.lookup('drain-a')!.handle
        /** A second native source retains its own independent completion barrier. */
        const secondDrain = transport!.lookup('drain-b')!.handle
        expect(new Set([firstDrain, secondDrain]).size).toBe(2)
        scalar = command(first, 'request', 'held')
        void scalar.catch(() => undefined)
        await scalarStarted.promise
        producer = command(first, 'stream', 'heldSequence')
        void producer.catch(() => undefined)
        await producerStarted.promise
        const streams = server.process.stream('heldSequence') as {
          fulfilled: Record<string, AsyncIterableIterator<unknown>>
        }
        consumer = streams.fulfilled['["target","drain-a"]']!
        expect(await consumer.next()).toEqual({ value: 'drain-a', done: false })
        returned = consumer.next()
        void returned.catch(() => undefined)
        let firstFinished = false
        let secondFinished = false
        const firstClosing = transport!.drain(firstDrain, 10_000)
        void firstClosing.then(() => {
          firstFinished = true
        })
        void transport!.drain(secondDrain, 10_000).then(() => {
          secondFinished = true
        })
        await vi.waitFor(() => expect(secondFinished).toBe(true))
        expect(firstFinished).toBe(false)
        let hostFinished = false
        closing = server.close()
        void closing.then(() => {
          hostFinished = true
        })
        scalarReleased.resolve()
        await expect(scalar).resolves.toBe(7)
        expect(firstFinished).toBe(false)
        expect(hostFinished).toBe(false)
        producerReleased.resolve()
        await expect(producer).resolves.toEqual([1, 2])
        expect(firstFinished).toBe(false)
        expect(hostFinished).toBe(false)
        await command(first, 'release-stream')
        await expect(returned).resolves.toEqual({ value: first.pid, done: false })
        expect(await consumer.next()).toEqual({ value: undefined, done: true })
        await firstClosing
        await closing
        expect(firstFinished).toBe(true)
        expect(hostFinished).toBe(true)
      } finally {
        scalarReleased.resolve()
        producerReleased.resolve()
        for (const child of children) {
          if (child.connected) await command(child, 'release-stream').catch(() => undefined)
        }
        await consumer?.return?.().catch(() => undefined)
        await scalar?.catch(() => undefined)
        await producer?.catch(() => undefined)
        await returned?.catch(() => undefined)
        await closing?.catch(() => undefined)
        for (const child of children) await stopProcess(child)
        await server.close()
        serving.mockRestore()
      }
    },
    15_000
  )
})
