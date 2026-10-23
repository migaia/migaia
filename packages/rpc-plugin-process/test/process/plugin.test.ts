import { walkErrorCauses } from '@migaia/utils/error'
import { PluginHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { defineFeaturePlugin, type IRpcHostMember } from '@migaia/rpc-host/plugin'
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import * as drainOwner from '../../../rpc-host/dist/remote/internal/binding-drain.js'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, type IProcessPluginOptions } from '@migaia/rpc-plugin-process'

/** Native execution loads the new public child entry, which explicitly claims its parent source. */
const child = new URL('./fixtures/host-plugin-child.ts', import.meta.url)

/** Collect the one actual stream without changing its cancellation or producer lifetime. */
async function collect(iterator: AsyncIterableIterator<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of iterator) values.push(value)
  return values
}

/** Forked fixtures own their independent native processes and use IPC only as an observation port. */
async function socketProcess(
  mode: 'listen' | 'connect',
  target: string,
  token: string,
  name: string
): Promise<ChildProcess> {
  const child = fork(
    fileURLToPath(new URL('./fixtures/host-plugin-socket.ts', import.meta.url)),
    [mode, target, token, name],
    {
      execArgv: [],
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    }
  )
  return new Promise((resolve, reject) => {
    const stop = () => {
      child.off('message', message)
      child.off('exit', exit)
      child.off('error', failure)
    }
    const failure = (error: unknown) => {
      stop()
      reject(error)
    }
    const exit = (code: number | null) => failure(new Error(`fixture exited before ready: ${code}`))
    const message = (value: unknown) => {
      const event = value as { event?: string; error?: unknown }
      if (event.event === 'ready') {
        stop()
        resolve(child)
      } else if (event.event === 'failed') {
        stop()
        reject(event.error)
      }
    }
    child.on('message', message)
    child.once('exit', exit)
    child.once('error', failure)
  })
}

/** A diagnostic command is correlated once; no business work is implemented by this IPC helper. */
let commandId = 0
async function command(
  child: ChildProcess,
  operation: string,
  method?: string,
  payload?: unknown
): Promise<any> {
  const id = ++commandId
  return new Promise((resolve, reject) => {
    const receive = (value: unknown) => {
      const response = value as { id?: number; result?: unknown; error?: unknown }
      if (response.id !== id) return
      child.off('message', receive)
      if (response.error) reject(response.error)
      else resolve(response.result)
    }
    child.on('message', receive)
    child.send({ id, operation, method, payload }, (error) => {
      if (error) {
        child.off('message', receive)
        reject(error)
      }
    })
  })
}

/** Cleanup resumes stopped fixtures before terminating them and observes actual native exit. */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform !== 'win32') child.kill('SIGCONT')
  child.kill('SIGKILL')
  await exited
}

describe('native process transport plugin', () => {
  it('rejects invalid source combinations synchronously before any native opening', () => {
    const sources = [
      { spawn: true },
      { connect: { target: 'unused' } },
      { listen: 'unused' },
      { connectToParent: true }
    ]
    const invalid: unknown[] = [{}, { connectToParent: false }, { connectToParent: true }]
    for (let first = 0; first < sources.length; first++)
      for (let second = first + 1; second < sources.length; second++)
        invalid.push({ ...sources[first], ...sources[second] })
    for (const options of invalid)
      expect(() => processPlugin(options as IProcessPluginOptions)).toThrow(
        expect.objectContaining({
          source: 'rpc.endpoint',
          code: 'INVALID_CONFIG'
        })
      )
    expect(() => processPlugin({ spawn: child, connect: { timeoutMs: 500 } })).not.toThrow()
    expect(() => processPlugin({ connect: { target: 'unused', timeoutMs: 500 } })).not.toThrow()
  })

  it('uses the same host endpoint for real spawn and parent bidirectional request and stream', async () => {
    const host = await createRpcHost({
      self: { name: 'parent', instanceId: 'parent' },
      plugins: [processPlugin({ spawn: child, connect: { timeoutMs: 1000 } })],
      provide: {
        parentEcho: (value: number) => value * 2,
        parentSequence: async function* () {
          yield 3
          yield 4
        }
      },
      report: () => undefined
    })
    let pid = 0
    try {
      expect(await host.request('echo', 21)).toBe(21)
      expect(await host.request('reverse', 21)).toBe(42)
      expect(await collect(host.stream('sequence') as AsyncIterableIterator<unknown>)).toEqual([
        1, 2
      ])
      expect(await collect(host.stream('reverseStream') as AsyncIterableIterator<unknown>)).toEqual(
        [3, 4]
      )
      pid = (await host.request('pid')) as number
      expect(pid).not.toBe(process.pid)
    } finally {
      await host.close()
    }
    expect(() => process.kill(pid, 0)).toThrow()
  }, 15_000)

  it.skipIf(process.platform === 'win32')(
    'serves two real client processes bidirectionally and reclaims killed or stopped duplicate names',
    async () => {
      const address = join(tmpdir(), `rpc-native-${randomUUID()}.sock`)
      const token = randomUUID()
      const server = await createRpcHost({
        self: { name: 'server', instanceId: randomUUID() },
        plugins: [processPlugin({ listen: address, token, connect: { timeoutMs: 200 } })],
        provide: { echo: (value: unknown) => value },
        report: () => undefined
      })
      const children: ChildProcess[] = []
      try {
        const first = await socketProcess('connect', address, token, 'client-a')
        children.push(first)
        const second = await socketProcess('connect', address, token, 'client-b')
        children.push(second)
        expect(
          await Promise.all([
            command(first, 'request', 'echo', 21),
            command(second, 'request', 'echo', 42)
          ])
        ).toEqual([21, 42])
        expect(await server.request('count')).toEqual({
          fulfilled: { '["target","client-a"]': 0, '["target","client-b"]': 0 },
          rejected: {}
        })
        expect(await server.send('client-a', 'touch', 7)).toMatchObject({
          name: 'client-a',
          count: 1,
          value: 7
        })
        expect(await server.send('client-b', 'count')).toBe(0)
        const streams = server.stream('sequence') as {
          fulfilled: Record<string, AsyncIterableIterator<unknown>>
        }
        expect(await collect(streams.fulfilled['["target","client-a"]']!)).toEqual([
          'client-a',
          first.pid
        ])
        expect(await collect(streams.fulfilled['["target","client-b"]']!)).toEqual([
          'client-b',
          second.pid
        ])
        expect(
          await Promise.all([
            server.send('client-b', 'touch', 9),
            command(second, 'request', 'echo', 18)
          ])
        ).toMatchObject([{ name: 'client-b', count: 1, value: 9 }, 18])
        const duplicate = await socketProcess('connect', address, token, 'client-a').then(
          (child) => {
            children.push(child)
            return undefined
          },
          (error: unknown) => error
        )
        expect(duplicate, JSON.stringify(duplicate)).toMatchObject({
          code: 'HOST_PEER_NAME_DUPLICATE'
        })
        await stopProcess(first)
        const afterKill = await socketProcess('connect', address, token, 'client-a')
        children.push(afterKill)
        expect(await server.send('client-a', 'pid')).toBe(afterKill.pid)
        afterKill.kill('SIGSTOP')
        const replacement = await socketProcess('connect', address, token, 'client-a')
        children.push(replacement)
        expect(await server.send('client-a', 'pid')).toBe(replacement.pid)
        await command(second, 'close')
        expect(await server.send('client-a', 'pid')).toBe(replacement.pid)
      } finally {
        for (const child of children) await stopProcess(child)
        await server.close()
      }
    },
    20_000
  )

  it.skipIf(process.platform === 'win32')(
    'drains scalar and both stream directions on their actual native session before listener retirement',
    async () => {
      /** The spy observes the original drain owners; every counter and settlement stays canonical. */
      const drains = vi.spyOn(drainOwner, 'createRemoteBindingDrain')
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
        expect(drains).toHaveBeenCalledTimes(2)
        const firstDrain = drains.mock.results[0]!.value
        const secondDrain = drains.mock.results[1]!.value
        scalar = command(first, 'request', 'held')
        void scalar.catch(() => undefined)
        await scalarStarted.promise
        producer = command(first, 'stream', 'heldSequence')
        void producer.catch(() => undefined)
        await producerStarted.promise
        const streams = server.stream('heldSequence') as {
          fulfilled: Record<string, AsyncIterableIterator<unknown>>
        }
        consumer = streams.fulfilled['["target","drain-a"]']!
        expect(await consumer.next()).toEqual({ value: 'drain-a', done: false })
        returned = consumer.next()
        void returned.catch(() => undefined)
        let firstFinished = false
        let secondFinished = false
        const firstClosing = firstDrain.drainCurrent()
        void firstClosing.then(() => {
          firstFinished = true
        })
        void secondDrain.drainCurrent().then(() => {
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
        drains.mockRestore()
      }
    },
    15_000
  )

  it('recovers an owned killed process through the original supervisor on the same host', async () => {
    const host = await createRpcHost({
      plugins: [
        processPlugin({
          spawn: child,
          supervision: { restart: { mode: 'on-failure', initialDelayMs: 100, maxDelayMs: 100 } }
        })
      ],
      provide: {
        parentEcho: (value: number) => value * 2,
        parentSequence: async function* () {
          yield 3
        }
      },
      report: () => undefined
    })
    const exit = deferred<void>()
    const ready = deferred<void>()
    const stopExit = host.on('exit', () => exit.resolve())
    const stopReady = host.on('ready', () => ready.resolve())
    try {
      const pid = (await host.request('pid')) as number
      process.kill(pid, 'SIGKILL')
      await exit.promise
      await expect(host.request('pid')).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
      await ready.promise
      const replacement = (await host.request('pid')) as number
      expect(replacement).not.toBe(pid)
      expect(await host.request('echo', 42)).toBe(42)
    } finally {
      stopExit()
      stopReady()
      await host.close()
    }
  }, 15_000)

  it.skipIf(process.platform === 'win32')(
    'recovers the same socket client host after a real service restart and refuses a wrong token once',
    async () => {
      const address = join(tmpdir(), `rpc-reconnect-${randomUUID()}.sock`)
      const token = randomUUID()
      const processes: ChildProcess[] = []
      const service = await socketProcess('listen', address, token, 'server')
      processes.push(service)
      const host = await createRpcHost({
        plugins: [
          processPlugin({
            connect: { target: address },
            token,
            supervision: {
              restart: { mode: 'always', initialDelayMs: 50, maxDelayMs: 50, maxRestarts: 50 }
            }
          })
        ],
        report: () => undefined
      })
      const ready = deferred<void>()
      const stopReady = host.on('ready', () => ready.resolve())
      try {
        expect(await host.request('pid')).toBe(service.pid)
        const serviceExit = once(service, 'exit')
        await command(service, 'close')
        await serviceExit
        const replacement = await socketProcess('listen', address, token, 'server')
        processes.push(replacement)
        await ready.promise
        expect(await host.request('pid')).toBe(replacement.pid)
        expect(await host.request('echo', 42)).toBe(42)
        const before = await command(replacement, 'stats')
        const rejected = await createRpcHost({
          plugins: [
            processPlugin({ connect: { target: address, timeoutMs: 500 }, token: 'wrong-token' })
          ],
          report: () => undefined
        }).catch((error: unknown) => error)
        const chain = walkErrorCauses(rejected).map((link) => {
          const error = link as { source?: string; code?: string; name?: string; message?: string }
          return {
            source: error?.source,
            code: error?.code,
            name: error?.name,
            message: error?.message
          }
        })
        expect(rejected).toMatchObject({ code: 'REMOTE_START_FAILED' })
        expect(chain, JSON.stringify(chain)).toContainEqual(
          expect.objectContaining({ code: 'PROCESS_CHANNEL_AUTH_REJECTED' })
        )
        expect((await command(replacement, 'stats')).verified - before.verified).toBe(1)
      } finally {
        stopReady()
        await host.close()
        for (const process of processes) await stopProcess(process)
      }
    },
    20_000
  )

  it.skipIf(process.platform === 'win32')(
    'opens the same spawn definition three times and a connect definition as two isolated sessions',
    async () => {
      const members: IRpcHostMember[] = []
      const transport = processPlugin({ spawn: child })
      const assembler = defineFeaturePlugin({
        name: 'three-native-members',
        async assemble(context) {
          for (let count = 0; count < 3; count++) members.push(await context.openMember())
          return members[0]!
        }
      })
      const host = await createRpcHost({ plugins: [transport, assembler], report: () => undefined })
      const pids: number[] = []
      try {
        for (const member of members) pids.push((await member.request('pid')) as number)
        expect(new Set(pids).size).toBe(3)
      } finally {
        await host.close()
      }
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
      const address = join(tmpdir(), `rpc-repeat-${randomUUID()}.sock`)
      const token = randomUUID()
      const server = await createRpcHost({
        plugins: [processPlugin({ listen: address, token })],
        provide: { echo: (value: unknown) => value },
        report: () => undefined
      })
      const clientPlugin = processPlugin({ connect: { target: address }, token })
      const first = await createRpcHost({
        self: { name: 'first', instanceId: randomUUID() },
        plugins: [clientPlugin],
        report: () => undefined
      })
      const second = await createRpcHost({
        self: { name: 'second', instanceId: randomUUID() },
        plugins: [clientPlugin],
        report: () => undefined
      })
      try {
        expect(await first.request('echo', 21)).toBe(21)
        expect(await second.request('echo', 42)).toBe(42)
        await first.close()
        expect(await second.request('echo', 7)).toBe(7)
      } finally {
        await first.close()
        await second.close()
        await server.close()
      }
    },
    15_000
  )

  it('installs the same native plugin on an ordinary Host with name and exposed feature calls', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const app = definePlugin({
      name: 'app',
      features: { math: defineFeature(() => ({ double: (value: number) => value * 2 })) },
      install: () => ({})
    })
    const transport = processPlugin({ name: 'native-worker', expose: ['app.double'], spawn: child })
    await host.use(app, transport)
    const outlet = Reflect.get(host, 'process') as {
      request(name: string, method: string, payload?: unknown): Promise<unknown>
    }
    const pid = (await outlet.request('native-worker', 'pid')) as number
    try {
      expect(await outlet.request('native-worker', 'echo', 21)).toBe(21)
      expect(await outlet.request('native-worker', 'exposed', 21)).toBe(42)
      expect(await host.unUse('native-worker')).toMatchObject({ ok: true })
      expect(() => process.kill(pid, 0)).toThrow()
      await host.dispose()
    } finally {
      await host.dispose()
    }
  }, 15_000)
})
