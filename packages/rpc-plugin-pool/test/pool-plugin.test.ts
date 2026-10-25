import { expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import * as pool from '../dist/index.js'
import { pool as poolFeature } from '../dist/index.js'
import { repeatableConnect } from './connect-fixture.js'

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

/** The original provider remains callable after its independent pool resource has closed. */
function localAfterPoolClose(): number {
  return 1
}
/** Genuine business generation waits on the original stream completion gate. */
async function* heldValues(finish: Promise<void>) {
  yield 1
  await finish
  yield 2
}
/** Actual provider state is explicit; no callback fake owns stream termination. */
function drainProviders(held: Promise<number>, finish: Promise<void>) {
  return { hold: () => held, values: () => heldValues(finish) }
}

it('keeps three repeatable connect members isolated when one accepted session is closed', async () => {
  const source = repeatableConnect()
  const feature = poolFeature({ size: 3 })
  const host = await createRpcHost({ plugins: [source.transport(feature)] })
  try {
    expect(source.opens()).toBe(3)
    expect(source.members).toHaveLength(3)
    expect(Object.keys(host.process.peers)).toEqual(['pool'])
    expect(await host.process.send('pool', 'identity')).toEqual(expect.any(Number))
    await source.members[0]!.close()
    expect(await host.process.send('pool', 'identity')).toBe(1)
    expect(await host.process.send('pool', 'identity')).toBe(2)
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
      createRpcHost({
        plugins: [
          defineTransportPlugin({
            name: mode,
            namespace: 'unsupported',
            open: async (context) => {
              const installed = await poolFeature({ size: 3 }).install({
                ...context,
                memberKind: 'process'
              })
              return { namespaceExtensions: installed.value, dispose: installed.dispose }
            }
          })
        ]
      })
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
      'pool'
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
  expect(poolFeature({ size: 1 })).toBeDefined()
})

it('keeps controls bound to each real host while resize and closed-state calls stay isolated', async () => {
  const feature = poolFeature({ size: 1 })
  const first = await createRpcHost({ plugins: [repeatableConnect().transport(feature)] })
  const second = await createRpcHost({ plugins: [repeatableConnect().transport(feature)] })
  const a = first.process.pool
  const b = second.process.pool
  try {
    expect(a).not.toBe(b)
    await a.resize(3)
    expect(a.stats()).toMatchObject({ targetSize: 3, memberCount: 3, state: 'open' })
    expect(b.stats()).toMatchObject({ targetSize: 1, memberCount: 1, state: 'open' })
    const closing = a.close()
    expect(a.close()).toBe(closing)
    await closing
    expect(a.stats().state).toBe('closed')
    await expect(a.resize(2)).rejects.toMatchObject({ source: 'rpc.pool', code: 'POOL_CLOSED' })
    expect(await second.process.send('pool', 'echo', 42)).toBe(42)
    expect(() => first.provide({ localAfterPoolClose })).not.toThrow()
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
  const opening = createRpcHost({ plugins: [source.transport(poolFeature({ size: 3 }))] }).catch(
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
  const result = createRpcHost({ plugins: [all.transport(poolFeature({ size: 3 }))] }).catch(
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
    provide: () => drainProviders(held.promise, finish.promise)
  })
  const feature = poolFeature({ size: 2 })
  const host = await createRpcHost({ plugins: [source.transport(feature)] })
  const controls = host.process.pool
  const request = host.process.send('pool', 'hold')
  const stream = host.process.stream('values') as AsyncIterableIterator<unknown>
  expect(await stream.next()).toEqual({ value: 1, done: false })
  const closing = controls.close()
  expect(controls.close()).toBe(closing)
  expect(controls.stats().state).toBe('closing')
  expect(source.closeOrder).toEqual([])
  await expect(host.process.send('pool', 'hold')).rejects.toMatchObject({ code: 'POOL_CLOSED' })
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

/** This original application stream waits for the real parent-side refusal before yielding. */
async function* closingParentValues(
  gates: Readonly<{ refused: Promise<void>; finish: Promise<void> }>,
  context: IRpcContext
) {
  context.dispatchTo({ id: context.senderId, method: 'late', data: 'after-close' })
  await gates.refused
  yield* heldValues(gates.finish)
}

/** Only business callbacks and explicit application gates cross into the existing remote provider. */
function closingParentProviders(
  gates: Readonly<{ refused: Promise<void>; finish: Promise<void> }>
) {
  return { values: (_data: unknown, context: IRpcContext) => closingParentValues(gates, context) }
}

it('drains a reserved stream when Root closes before native member selection resumes', async () => {
  /** The real provider remains active after its first value until this application gate releases it. */
  const finish = Promise.withResolvers<void>()
  /** A genuine parent report acknowledges that the reverse native notification reached admission. */
  const refused = Promise.withResolvers<void>()
  /** No local provider may acquire business side effects after Root.close seals admission. */
  let effects = 0
  /** Only the actual Root diagnostic boundary contributes this correlated refusal observation. */
  const reports: unknown[] = []
  /** Existing process-connect members and native byte IO receive the ordinary held generator. */
  const source = repeatableConnect({
    provide: () => closingParentProviders({ refused: refused.promise, finish: finish.promise })
  })
  /** One native member makes acquisition and its asynchronous selected-start boundary explicit. */
  const host = await createRpcHost({
    plugins: [source.transport(poolFeature({ size: 1 }))],
    provide: {
      late: () => {
        effects += 1
      }
    },
    report: (error) => {
      reports.push(error)
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === RpcCoreErrorCode.endpointDisposed
      )
        refused.resolve()
    }
  })
  /** The public lazy iterator enters original Pool.acquire before the immediate Root close. */
  const stream = host.process.stream('values') as AsyncIterableIterator<unknown>
  /** Original run awaits native readiness after reserving; no fixture can replace that handoff. */
  const first = stream.next()
  /** The existing iterator tail enters its actual pull before the test resumes this one microtask. */
  await Promise.resolve()
  expect(host.process.pool.stats().inFlight).toBe(1)
  /** Close seals new work while this already accepted stream retains its original native lifetime. */
  const closing = host.close()
  try {
    expect(host.close()).toBe(closing)
    await vi.waitFor(() =>
      expect(reports).toEqual([
        expect.objectContaining({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
      ])
    )
    expect(effects).toBe(0)
    expect(await first).toEqual({ value: 1, done: false })
    expect(source.closeOrder).toEqual([])
    finish.resolve()
    expect(await stream.next()).toEqual({ value: 2, done: false })
    expect(await stream.next()).toMatchObject({ done: true })
    await closing
    expect(source.closeOrder).toEqual([0])
  } finally {
    refused.resolve()
    finish.resolve()
    await stream.return?.()
    await closing
    await source.close()
  }
})
