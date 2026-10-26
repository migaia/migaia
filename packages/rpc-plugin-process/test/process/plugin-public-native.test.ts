/** Original native Process public oracles use the same real child and current namespace API. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import * as nativeSupervision from '@migaia/supervision/process'
import type { ChildProcess } from 'node:child_process'
import { socketProcess, command, stopProcess, collect } from './plugin-control.js'
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  processPlugin,
  RPC_PROCESS_ERROR_SOURCE,
  type IProcessPluginOptions
} from '@migaia/rpc-plugin-process'

/** The unchanged native child owns its actual parent bootstrap and business provider. */
const child = new URL('./fixtures/host-plugin-child.ts', import.meta.url)

/** The ordinary native Feature exposes this original business function through its whitelist. */
function double(value: number): number {
  return value * 2
}

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
    expect(await host.process.request('echo', 21)).toBe(21)
    expect(await host.process.request('reverse', 21)).toBe(42)
    expect(
      await collect(host.process.stream('sequence') as AsyncIterableIterator<unknown>)
    ).toEqual([1, 2])
    expect(
      await collect(host.process.stream('reverseStream') as AsyncIterableIterator<unknown>)
    ).toEqual([3, 4])
    pid = (await host.process.request('pid')) as number
    expect(pid).not.toBe(process.pid)
  } finally {
    await host.close()
  }
  expect(() => process.kill(pid, 0)).toThrow()
}, 15_000)

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
  const stopExit = host.process.members.on('exit', () => exit.resolve())
  const stopReady = host.process.members.on('ready', () => ready.resolve())
  try {
    const pid = (await host.process.request('pid')) as number
    process.kill(pid, 'SIGKILL')
    await exit.promise
    /** Before the replacement is ready the departed member rejects with its departure reason. */
    await expect(host.process.request('pid')).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' })
    await ready.promise
    const replacement = (await host.process.request('pid')) as number
    expect(replacement).not.toBe(pid)
    expect(await host.process.request('echo', 42)).toBe(42)
  } finally {
    stopExit()
    stopReady()
    await host.close()
  }
}, 15_000)

it('retains the real terminal Process error for an explicitly addressed retired native source', async () => {
  /** Observe the original native supervisor, without substituting its start/exit/terminal policy. */
  const create = nativeSupervision.createProcessSupervisor
  /** This actual native snapshot supplies the same original terminal error used by the source. */
  let supervisor: ReturnType<typeof create> | undefined
  /** Public construction still receives the complete original native supervisor unchanged. */
  const factory = vi
    .spyOn(nativeSupervision, 'createProcessSupervisor')
    .mockImplementation((options) => {
      /** The observer returns the same original native supervisor without changing its policy. */
      const value = create(options)
      supervisor = value
      return value
    })
  /** Final cleanup needs only the actual public close operation, preserving namespace inference. */
  let cleanup: { close(): Promise<void> } | undefined
  /** The source publishes terminal after recording its original native admission error. */
  let remove: () => void = () => undefined
  try {
    /** A real exit with a zero restart budget enters the source's actual terminal event. */
    const host = await createRpcHost({
      plugins: [
        processPlugin({
          spawn: child,
          supervision: {
            restart: { mode: 'on-failure', maxRestarts: 0 },
            terminalPolicy: { mode: 'stay' }
          }
        })
      ],
      report: () => undefined
    })
    cleanup = host
    /** Address the original accepted native name, rather than broadcast to zero retired targets. */
    const name = Object.keys(host.process.peers)[0]!
    /** This PID comes from the real child provider before it is killed. */
    const pid = (await host.process.send(name, 'pid')) as number
    /** Observe existing safe native events; no test changes readiness or generates a terminal state. */
    const terminal = deferred<void>()
    remove = host.process.members.on('terminal', () => terminal.resolve())
    process.kill(pid, 'SIGKILL')
    await terminal.promise
    /** The original local native admission failure retains the actual supervisor's terminal cause. */
    const failure = await host.process.send(name, 'pid').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      source: RPC_PROCESS_ERROR_SOURCE,
      code: 'PROCESS_TERMINAL_CALL'
    })
    expect((failure as Error).cause).toBe(supervisor!.inspect().terminalError)
  } finally {
    remove()
    try {
      await cleanup?.close()
    } finally {
      factory.mockRestore()
    }
  }
}, 15_000)

it('installs the same native plugin on an ordinary Host with name and exposed feature calls', async () => {
  /** Lazy pipeline authority reads this case's own native host only at installation. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['process']
  )
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  const app = definePlugin({
    name: 'app',
    features: { math: defineFeature(() => ({ double })) },
    install: () => ({})
  })
  const transport = processPlugin({ name: 'native-worker', expose: ['app.double'], spawn: child })
  await host.use(app, transport)
  const outlet = Reflect.get(host, 'process') as {
    send(name: string, method: string, payload?: unknown): Promise<unknown>
  }
  const pid = (await outlet.send('native-worker', 'pid')) as number
  try {
    expect(await outlet.send('native-worker', 'echo', 21)).toBe(21)
    expect(await outlet.send('native-worker', 'exposed', 21)).toBe(42)
    expect(await host.unUse('native-worker')).toMatchObject({ ok: true })
    expect(() => process.kill(pid, 0)).toThrow()
    await host.dispose()
  } finally {
    await host.dispose()
  }
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
      expect(await server.process.request('count')).toEqual({
        fulfilled: { '["target","client-a"]': 0, '["target","client-b"]': 0 },
        rejected: {}
      })
      expect(await server.process.send('client-a', 'touch', 7)).toMatchObject({
        name: 'client-a',
        count: 1,
        value: 7
      })
      expect(await server.process.send('client-b', 'count')).toBe(0)
      const streams = server.process.stream('sequence') as {
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
          server.process.send('client-b', 'touch', 9),
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
      expect(await server.process.send('client-a', 'pid')).toBe(afterKill.pid)
      afterKill.kill('SIGSTOP')
      const replacement = await socketProcess('connect', address, token, 'client-a')
      children.push(replacement)
      expect(await server.process.send('client-a', 'pid')).toBe(replacement.pid)
      await command(second, 'close')
      expect(await server.process.send('client-a', 'pid')).toBe(replacement.pid)
    } finally {
      for (const child of children) await stopProcess(child)
      await server.close()
    }
  },
  20_000
)

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
    const stopReady = host.process.members.on('ready', () => ready.resolve())
    try {
      expect(await host.process.request('pid')).toBe(service.pid)
      const serviceExit = once(service, 'exit')
      await command(service, 'close')
      await serviceExit
      const replacement = await socketProcess('listen', address, token, 'server')
      processes.push(replacement)
      await ready.promise
      expect(await host.process.request('pid')).toBe(replacement.pid)
      expect(await host.process.request('echo', 42)).toBe(42)
      const before = await command<{ verified: number }>(replacement, 'stats')
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
      expect(
        (await command<{ verified: number }>(replacement, 'stats')).verified - before.verified
      ).toBe(1)
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
    /**
     * Original three-spawn PID uniqueness/reap assertions are received by the actual Pool Process
     * oracle (core-pool.test.ts); only deleted assemble wrapper is retired.
     */
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
      expect(await first.process.request('echo', 21)).toBe(21)
      expect(await second.process.request('echo', 42)).toBe(42)
      await first.close()
      expect(await second.process.request('echo', 7)).toBe(7)
    } finally {
      await first.close()
      await second.close()
      await server.close()
    }
  },
  15_000
)
