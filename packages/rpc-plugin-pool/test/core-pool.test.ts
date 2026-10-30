/** Original Pool business oracles use the actual public native feature installation. */
import { expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineTaskContext } from '@migaia/rpc-plugin-coroutines'
import { pool } from '../dist/index.js'

/** One actual coroutine child owns application service state, independently of native media. */
class CoroutineService {
  /** Actual task ordinal identifies which genuine child executed this business method. */
  readonly #id: number
  /** Shared test observations count only provider entry. */
  readonly #calls: number[]
  /** The original public provider catalog receives actual business functions. */
  readonly value
  /** Capture immutable task identity without starting another native resource. */
  constructor(id: number, calls: number[]) {
    this.#id = id
    this.#calls = calls
    this.value = { identity: () => this.#id, pid: this.#pid }
  }
  /** Original native work stays active long enough to reserve all three actual members. */
  readonly #pid = async (value: number): Promise<number> => {
    this.#calls.push(value)
    await new Promise((resolve) => setTimeout(resolve, 20))
    return this.#id
  }
}
/** The genuine coroutine task retains only its own actual child Hosts and parent cancellation. */
class CoroutineWorkload {
  /** Actual contexts independently prove exactly three native acquisitions and final abort. */
  readonly contexts: ICoroutineTaskContext[] = []
  /** Business entry observations remain separate from scheduling/physical-write counts. */
  readonly calls: number[] = []
  /** Native cleanup retains the original task signal and actual child Host lifetime. */
  readonly task = async (context: ICoroutineTaskContext): Promise<void> => {
    this.contexts.push(context)
    const service = new CoroutineService(this.contexts.length, this.calls)
    const child = await createRpcHost({
      plugins: [coroutinePlugin({ connectToParent: context.connect })],
      provide: service.value
    })
    try {
      if (!context.signal.aborted) {
        const stopped = Promise.withResolvers<void>()
        context.signal.addEventListener('abort', () => stopped.resolve(), { once: true })
        await stopped.promise
      }
    } finally {
      await child.close()
    }
  }
}
/** The actual operating-system PID must be gone after public Host cleanup. */
function assertExited(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
}

it('opens three genuine coroutine tasks and executes each scalar request only once', async () => {
  const workload = new CoroutineWorkload()
  const contexts = workload.contexts
  const calls = workload.calls
  const host = await createRpcHost({
    plugins: [coroutinePlugin({ features: { workers: pool({ size: 3 }) }, spawn: workload.task })]
  })
  try {
    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.coroutine.send('pool', 'pid', value))
    )
    expect(new Set(ids).size).toBe(3)
    expect(calls.toSorted()).toEqual([0, 1, 2, 3, 4, 5])
    expect(Object.keys(host.coroutine.peers)).toEqual(['pool'])
    expect(typeof (await host.coroutine.send('pool', 'identity'))).toBe('number')
  } finally {
    await host.close()
    expect(contexts).toHaveLength(3)
    expect(contexts.every((context) => context.signal.aborted)).toBe(true)
  }
})

it('routes six calls once each through three real process members as scalar pool results', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, 'process-calls-'))
  const journal = join(directory, 'calls.txt')
  const feature = pool({ size: 3 })
  const host = await createRpcHost({
    plugins: [
      processPlugin({
        spawn: new URL('./fixtures/process-child.mjs', import.meta.url),
        features: { feature }
      })
    ]
  })
  let pids: number[] = []
  try {
    pids = (await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.process.send('pool', 'pid', { journal, value }))
    )) as number[]
    expect(pids.every((pid) => typeof pid === 'number')).toBe(true)
    expect(new Set(pids).size).toBe(3)
    expect((await readFile(journal, 'utf8')).trim().split('\n').sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5'
    ])
    expect(Object.keys(host.process.peers)).toEqual(['pool'])
    expect(typeof (await host.process.send('pool', 'identity'))).toBe('number')
    const overview = await host.process.members.list()
    const privateId = (overview.connections[0]!.identity as { instanceId: string }).instanceId
    await expect(host.process.send(privateId, 'identity')).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'TARGET_UNKNOWN'
    })
    expect(host.process.pool.stats()).toMatchObject({
      state: 'open',
      memberCount: 3,
      targetSize: 3
    })
  } finally {
    await host.close()
    for (const pid of new Set(pids)) await vi.waitFor(() => assertExited(pid))
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('routes six calls once each through three real thread members and closes all native workers', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, 'thread-calls-'))
  const journal = join(directory, 'calls.txt')
  const terminate = vi.spyOn(Worker.prototype, 'terminate')
  const feature = pool({ size: 3 })
  const host = await createRpcHost({
    plugins: [
      threadPlugin({
        spawn: new URL('./fixtures/thread-child.mjs', import.meta.url),
        features: { feature }
      })
    ]
  })
  try {
    const ids = (await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.thread.send('pool', 'pid', { journal, value }))
    )) as number[]
    expect(ids.every((id) => typeof id === 'number')).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect((await readFile(journal, 'utf8')).trim().split('\n').sort()).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5'
    ])
    expect(Object.keys(host.thread.peers)).toEqual(['pool'])
    expect(typeof (await host.thread.send('pool', 'identity'))).toBe('number')
    const overview = await host.thread.members.list()
    const privateId = (overview.connections[0]!.identity as { instanceId: string }).instanceId
    await expect(host.thread.send(privateId, 'identity')).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    })
  } finally {
    await host.close()
    expect(terminate).toHaveBeenCalledTimes(3)
    terminate.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
