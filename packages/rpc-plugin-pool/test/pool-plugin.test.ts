import { expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import type { IRpcHostMember } from '@migaia/rpc-host/plugin'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { coroutinePlugin, type ICoroutineTaskContext } from '@migaia/rpc-plugin-coroutines'
import * as pool from '../dist/index.js'
import { poolPlugin, observingPool, unusedTransport } from './pool-fixture.js'
import { repeatableConnect } from './connect-fixture.js'
import * as runtimeEndpoint from '../../rpc-host/dist/core/runtime-api-endpoint.js'

/** Follow original cause/aggregate links without changing any thrown object. */
function contains(error: unknown, expected: unknown): boolean {
  const pending = [error]
  const seen = new Set<unknown>()
  while (pending.length) {
    const current = pending.pop()
    if (current === expected) return true
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    pending.push(Reflect.get(current, 'cause'))
    /** Canonical secondary attachment also adds errors[] to the original extensible Error. */
    const errors = Reflect.get(current, 'errors')
    if (Array.isArray(errors)) pending.push(...errors)
  }
  return false
}

it('routes six calls once each through three real process members as scalar pool results', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, 'process-calls-'))
  const journal = join(directory, 'calls.txt')
  const members: IRpcHostMember[] = []
  const feature = poolPlugin({ size: 3 })
  const constructed = vi.spyOn(runtimeEndpoint, 'createRuntimeApiEndpoint')
  const host = await createRpcHost({
    plugins: [
      processPlugin({ spawn: new URL('./fixtures/process-child.mjs', import.meta.url) }),
      observingPool(feature, members)
    ]
  })
  let pids: number[] = []
  try {
    pids = (await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.request('pid', { journal, value }))
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
    expect(Object.keys(host.peers)).toEqual(['pool'])
    expect(constructed).toHaveBeenCalledTimes(1)
    expect(typeof (await host.send('pool', 'identity'))).toBe('number')
    await expect(host.send(members[0]!.id, 'identity')).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'TARGET_UNKNOWN'
    })
    expect(((await host.describe()) as unknown as { pool: unknown }).pool).toMatchObject({
      state: 'open',
      memberCount: 3,
      targetSize: 3
    })
  } finally {
    await host.close()
    constructed.mockRestore()
    for (const pid of new Set(pids))
      await vi.waitFor(() =>
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
      )
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('routes six calls once each through three real thread members and closes all native workers', async () => {
  const directory = await mkdtemp(join(import.meta.dirname, 'thread-calls-'))
  const journal = join(directory, 'calls.txt')
  const members: IRpcHostMember[] = []
  const terminate = vi.spyOn(Worker.prototype, 'terminate')
  const constructed = vi.spyOn(runtimeEndpoint, 'createRuntimeApiEndpoint')
  const feature = poolPlugin({ size: 3 })
  const host = await createRpcHost({
    plugins: [
      threadPlugin({ spawn: new URL('./fixtures/thread-child.mjs', import.meta.url) }),
      observingPool(feature, members)
    ]
  })
  try {
    const ids = (await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.request('pid', { journal, value }))
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
    expect(Object.keys(host.peers)).toEqual(['pool'])
    expect(constructed).toHaveBeenCalledTimes(1)
    expect(typeof (await host.send('pool', 'identity'))).toBe('number')
    await expect(host.send(members[0]!.id, 'identity')).rejects.toMatchObject({
      code: 'TARGET_UNKNOWN'
    })
  } finally {
    await host.close()
    expect(terminate).toHaveBeenCalledTimes(3)
    terminate.mockRestore()
    constructed.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('opens three genuine coroutine tasks and executes each scalar request only once', async () => {
  const contexts: ICoroutineTaskContext[] = []
  const calls: number[] = []
  const feature = poolPlugin({ size: 3 })
  const host = await createRpcHost({
    plugins: [
      coroutinePlugin({
        spawn: async (context) => {
          contexts.push(context)
          const id = contexts.length
          const child = await createRpcHost({
            plugins: [coroutinePlugin({ connectToParent: context.connect })],
            provide: {
              identity: () => id,
              pid: async (value: number) => {
                calls.push(value)
                await new Promise((resolve) => setTimeout(resolve, 20))
                return id
              }
            }
          })
          try {
            if (!context.signal.aborted)
              await new Promise<void>((resolve) =>
                context.signal.addEventListener('abort', () => resolve(), { once: true })
              )
          } finally {
            await child.close()
          }
        }
      }),
      feature
    ]
  })
  try {
    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, value) => host.request('pid', value))
    )
    expect(new Set(ids).size).toBe(3)
    expect(calls.toSorted()).toEqual([0, 1, 2, 3, 4, 5])
    expect(Object.keys(host.peers)).toEqual(['pool'])
    expect(typeof (await host.send('pool', 'identity'))).toBe('number')
  } finally {
    await host.close()
    expect(contexts).toHaveLength(3)
    expect(contexts.every((context) => context.signal.aborted)).toBe(true)
  }
})

it('keeps three repeatable connect members isolated when one accepted session is closed', async () => {
  const source = repeatableConnect()
  const members: IRpcHostMember[] = []
  const feature = poolPlugin({ size: 3 })
  const host = await createRpcHost({ plugins: [source.transport, observingPool(feature, members)] })
  try {
    expect(source.opens()).toBe(3)
    expect(members).toHaveLength(3)
    expect(Object.keys(host.peers)).toEqual(['pool'])
    expect(await host.send('pool', 'identity')).toEqual(expect.any(Number))
    await members[0]!.close()
    expect(await members[1]!.request('identity')).toBe(1)
    expect(await members[2]!.request('identity')).toBe(2)
    expect(source.closeOrder).toEqual([0])
  } finally {
    await host.close()
  }
})

it('rejects listen and connect-to-parent before opening any member source', async () => {
  for (const mode of ['listen', 'connect-to-parent'] as const) {
    const open = vi.fn(async (): Promise<never> => {
      throw new Error('unsupported source opened')
    })
    await expect(
      createRpcHost({ plugins: [unusedTransport(mode, open), poolPlugin({ size: 3 })] })
    ).rejects.toMatchObject({ source: 'rpc.pool', code: 'POOL_TRANSPORT_UNSUPPORTED' })
    expect(open).not.toHaveBeenCalled()
  }
})

it('publishes only its independent package allowlist without depending on concrete transports', () => {
  const root = new URL('../', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  expect(manifest.name).toBe('@migaia/rpc-plugin-pool')
  expect(Object.keys(pool).toSorted()).toEqual(
    [
      'RPC_POOL_ERROR_SOURCE',
      'RPC_POOL_PEER_ID',
      'RpcPoolErrorCode',
      'RpcPoolState',
      'poolPlugin'
    ].toSorted()
  )
  expect(Reflect.get(pool, 'RPC_POOL_PEER_ID')).toBe('pool')
  expect(pool.RPC_POOL_ERROR_SOURCE).toBe('rpc.pool')
  const forbidden = /@migaia\/rpc-(?:plugin-(?:process|thread|browser|coroutines)|process|threads)/
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }))
    expect(dependency).not.toMatch(forbidden)
  for (const entry of readdirSync(new URL('../src/', import.meta.url)))
    if (entry.endsWith('.ts'))
      expect(readFileSync(new URL(`src/${entry}`, root), 'utf8')).not.toMatch(forbidden)
  expect(poolPlugin({ size: 1 })).toBeDefined()
})

it('keeps controls bound to each real host while resize and closed-state calls stay isolated', async () => {
  const feature = poolPlugin({ size: 1 })
  const first = await createRpcHost({ plugins: [repeatableConnect().transport, feature] })
  const second = await createRpcHost({ plugins: [repeatableConnect().transport, feature] })
  const a = feature.controls(first)
  const b = feature.controls(second)
  try {
    expect(a).not.toBe(b)
    await a.resize(3)
    expect(a.stats()).toMatchObject({ targetSize: 3, memberCount: 3, state: 'open' })
    expect(b.stats()).toMatchObject({ targetSize: 1, memberCount: 1, state: 'open' })
    expect(((await first.describe()) as unknown as { pool: unknown }).pool).toEqual(a.stats())
    expect(() => feature.controls({} as IRpcHost<unknown>)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTIONS' })
    )
    const closing = a.close()
    expect(a.close()).toBe(closing)
    await closing
    expect(a.stats().state).toBe('closed')
    await expect(a.resize(2)).rejects.toMatchObject({ source: 'rpc.pool', code: 'POOL_CLOSED' })
    expect(await second.request('echo', 42)).toBe(42)
    expect(() => first.provide({ localAfterPoolClose: () => 1 })).not.toThrow()
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})

it('waits for complete parallel acquisition and preserves input-order primary with all cleanup causes', async () => {
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
  const primary = new Error('middle member failed')
  const cleanup = [
    new Error('first member close failed'),
    undefined,
    new Error('last member close failed')
  ]
  const source = repeatableConnect({
    beforeOpen: (index) => gates[index]!.promise,
    closeErrors: cleanup
  })
  const opening = createRpcHost({ plugins: [source.transport, poolPlugin({ size: 3 })] }).catch(
    (error) => error
  )
  await vi.waitFor(() => expect(source.opens()).toBe(3))
  gates[0]!.resolve()
  gates[1]!.reject(primary)
  await vi.waitFor(() => expect(source.remotes).toHaveLength(1))
  expect(source.closeOrder).toEqual([])
  gates[2]!.resolve()
  const failure = await opening
  expect(failure).toBe(primary)
  expect(source.closeOrder).toEqual([0, 2])
  expect(contains(failure, cleanup[0])).toBe(true)
  expect(contains(failure, cleanup[2])).toBe(true)
  const errors = [
    new Error('first input failed last in time'),
    new Error('middle input failed'),
    new Error('last input failed first in time')
  ]
  const failed = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
  const all = repeatableConnect({ beforeOpen: (index) => failed[index]!.promise })
  const result = createRpcHost({ plugins: [all.transport, poolPlugin({ size: 3 })] }).catch(
    (error) => error
  )
  await vi.waitFor(() => expect(all.opens()).toBe(3))
  failed[2]!.reject(errors[2])
  failed[1]!.reject(errors[1])
  failed[0]!.reject(errors[0])
  expect(await result).toBe(errors[0])
})

it('drains accepted work and a live stream with stable close promises and original cleanup errors', async () => {
  const held = Promise.withResolvers<number>()
  const finish = Promise.withResolvers<void>()
  const failures = [new Error('first close failure'), new Error('second close failure')]
  const source = repeatableConnect({
    closeErrors: failures,
    provide: () => ({
      hold: () => held.promise,
      values: async function* () {
        yield 1
        await finish.promise
        yield 2
      }
    })
  })
  const feature = poolPlugin({ size: 2 })
  const host = await createRpcHost({ plugins: [source.transport, feature] })
  const controls = feature.controls(host)
  const request = host.request('hold')
  const stream = host.stream('values') as AsyncIterableIterator<unknown>
  expect(await stream.next()).toEqual({ value: 1, done: false })
  const closing = controls.close()
  expect(controls.close()).toBe(closing)
  expect(controls.stats().state).toBe('closing')
  expect(source.closeOrder).toEqual([])
  await expect(host.request('hold')).rejects.toMatchObject({ code: 'POOL_CLOSED' })
  /** Host shutdown must join this same active pool drain before touching native sessions. */
  const hostClosing = host.close()
  expect(host.close()).toBe(hostClosing)
  const hostFailure = hostClosing.catch((error) => error)
  held.resolve(42)
  expect(await request).toBe(42)
  expect(source.closeOrder).toEqual([])
  finish.resolve()
  expect(await stream.next()).toEqual({ value: 2, done: false })
  expect(await stream.next()).toMatchObject({ done: true })
  const failure = await closing.catch((error) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect(failure).toMatchObject({ source: 'rpc.pool', code: 'CLOSE_FAILED' })
  for (const original of failures) expect(contains(failure, original)).toBe(true)
  expect(source.closeOrder).toEqual([0, 1])
  expect(controls.stats().state).toBe('closed')
  for (const original of failures) expect(contains(await hostFailure, original)).toBe(true)
})
