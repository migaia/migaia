/** Actual feature and native Host clocks replace the removed kernel/time-port configuration. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync, Visitor } from 'oxc-parser'
import { expect, it, vi } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { connectedCoreHosts, coreMemoryServer } from '../host/core-fixture.ts'

it('injects manual time into a real public RPC attempt deadline', async () => {
  /** The complete feature owns its original monotonic scheduler and timer receipt. */
  const scheduler = createManualScheduler()
  /** Actual provider entry separates clock progression from native handshake setup. */
  const entered = deferred<void>()
  /** Final cleanup releases the original business Promise even after the caller has timed out. */
  const finish = deferred<void>()
  /** Genuine public provider execution remains active until its original native completion. */
  const peers = await connectedCoreHosts(
    {},
    {
      echo: async () => {
        entered.resolve()
        await finish.promise
        return 'done'
      }
    }
  )
  try {
    /** Only this one actual attempt uses the explicitly supplied feature clock. */
    const pending = peers.a.memory.send('b', 'echo', null, {
      timeout: timeout({ ms: 50, scheduler, report: () => undefined })
    })
    /** Observe the original failure before any timer fires. */
    const result = pending.catch((error: unknown) => error)
    await entered.promise
    scheduler.advance(49)
    /** A deadline may not settle before the final millisecond of the original budget. */
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    scheduler.advance(1)
    expect(await result).toBeInstanceOf(RpcTimeoutError)
  } finally {
    finish.resolve()
    await peers.close()
  }
  expect(scheduler.pendingCount).toBe(0)
})

it('times out construction through the original native Host injected scheduler', async () => {
  /** The sole native Host owns the same actual mutation clock as ordinary plugins. */
  const scheduler = createManualScheduler()
  /** There is no RPC kernel or timeout translation layer around native installation. */
  const host = defineHost({
    host: { scheduler, execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: false } }
  })
  /** The real install hook intentionally never completes its setup work. */
  const stall = definePlugin({
    name: 'scheduler-stall',
    install: () => new Promise<Record<string, never>>(() => undefined)
  })
  /** Native operation timeout retains its original public error code. */
  const result = host.use(stall).catch((error: unknown) => error)
  for (let turn = 0; turn < 40 && scheduler.pendingCount === 0; turn++) await Promise.resolve()
  expect(scheduler.pendingCount).toBeGreaterThan(0)
  scheduler.advance(100)
  /** The original code oracle still executes after actual native timeout cleanup. */
  const failure = await result
  expect(scheduler.pendingCount).toBe(0)
  try {
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: { code: 'MUTATION_EXECUTION_TIMEOUT' }
    })
  } finally {
    await host.dispose()
  }
})

it('retains the supplied native scheduler clock without freezing the caller object', async () => {
  /** Only this real native constructor chooses the manual clock. */
  const scheduler = createManualScheduler()
  scheduler.advance(42)
  /** Native setup observes its actual attempt clock and deadline. */
  const observed: number[] = []
  /** The real Host borrows the unchanged supplied object. */
  const host = defineHost({
    host: { scheduler, execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: false } }
  })
  /** A genuine plugin setup reads the actual native operation's clock. */
  const plugin = definePlugin({
    name: 'clock-reader',
    setup(context) {
      observed.push(context.operation.now())
      return {}
    },
    install() {
      return {}
    }
  })
  try {
    await host.use(plugin)
    expect(observed).toEqual([42])
    expect(Object.isFrozen(scheduler)).toBe(false)
  } finally {
    await host.dispose()
  }
  expect(scheduler.pendingCount).toBe(0)
})

it('timestamps failed responses and expires installed replay policy using manual time', async () => {
  /** Monotonic policy time stays independent from the original diagnostic wall timestamp. */
  const scheduler = createManualScheduler()
  /** The current policy reads the native monotonic capability; no fake store claim is injected. */
  const monotonic = vi.spyOn(performance, 'now').mockImplementation(() => scheduler.now())
  /** The existing wall-clock backend supplies the pinned original response timestamp. */
  const wall = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_042)
  /**
   * Optional replay belongs to the actual idempotency plugin rather than the removed default
   * kernel.
   */
  const server = coreMemoryServer('scheduler-server')
  /** Original provider execution count remains independent from replay responses. */
  const business = vi.fn((_payload, context) =>
    context.failed('expected failure', 'EXPECTED_FAILURE')
  )
  /** A real accepted contract grants only this genuine idempotent operation. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency(), server.transport],
    provide: { api: { fail: business } },
    contract: {
      schemaVersion: 1,
      plugin: 'api',
      features: { shape: { methods: { fail: { mode: 'request', idempotent: true } } } }
    }
  })
  /** Both actual public Hosts complete their real handshakes before manual policy time advances. */
  const client = await server.connect('scheduler-client')
  try {
    scheduler.advance(42)
    await expect(
      client.host.memory.send('scheduler-server', 'api.fail', null, {
        idempotencyKey: 'original-replay'
      })
    ).rejects.toBeDefined()
    expect(business).toHaveBeenCalledTimes(1)
    /** Only one original physical business call is emitted before any replay. */
    const requests = client.pair[1].written.filter((frame) => frame.kind === 'call')
    expect(requests).toHaveLength(1)
    /** Actual physical result/error frames retain the original diagnostic wall time. */
    const responses = client.pair[0].written.filter((frame) => frame.kind === 'error')
    expect(responses[0]!.route.sentAt).toBe(1_700_000_000_042)
    await expect(
      client.host.memory.send('scheduler-server', 'api.fail', null, {
        idempotencyKey: 'original-replay'
      })
    ).rejects.toBeDefined()
    expect(business).toHaveBeenCalledTimes(1)
    scheduler.advance(310_001)
    await expect(
      client.host.memory.send('scheduler-server', 'api.fail', null, {
        idempotencyKey: 'original-replay'
      })
    ).rejects.toBeDefined()
    expect(business).toHaveBeenCalledTimes(2)
  } finally {
    await Promise.all([client.host.close(), host.close()])
    monotonic.mockRestore()
    wall.mockRestore()
  }
  expect(scheduler.pendingCount).toBe(0)
})

it('leaves no global Date or retired timer owners in migrated original core execution owners', () => {
  /** Only these direct old core execution descendants inherit the original static boundary. */
  const owners = [
    'dispatch/invocation.ts',
    'dispatch/context.ts',
    'call/table.ts',
    'call/record.ts',
    'call/invocation.ts',
    'stream/consumer.ts',
    'stream/producer.ts'
  ]
  // These seven fixed paths map old provider-executor/client/stream owners; SDK/Session were outside old core.
  for (const owner of owners) {
    /** The old runtime-api assembly/default kernel path is separately retired in the local ledger. */
    const path = join(import.meta.dirname, '../../src', owner)
    new Visitor({
      Identifier(node) {
        expect(node.name, path).not.toMatch(
          /^(Date|createRuntimeTimer|waitWithSignal|ControlTaskRegistry)$/u
        )
      }
    }).visit(parseSync(path, readFileSync(path, 'utf8')).program)
  }
})

it('retains very long attempt deadlines', async () => {
  /** This clock proves the original >32-bit budget remains pending after only one second. */
  const scheduler = createManualScheduler()
  /** Completion remains the actual native operation, independent from the feature's timer. */
  const finish = deferred<string>()
  /** Only a real complete timeout feature owns this timer and original call Promise. */
  const feature = timeout({ ms: 2_147_483_648, scheduler, report: () => undefined })
  /** The existing feature boundary directly consumes its genuine attempt execution port. */
  const pending = feature.run({
    signal: new AbortController().signal,
    invoke: () => finish.promise
  })
  /** Original settlement must not wrap the long deadline down to a short timer. */
  let settled = false
  void pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  scheduler.advance(1000)
  await Promise.resolve()
  expect(settled).toBe(false)
  finish.resolve('done')
  await pending
  expect(scheduler.pendingCount).toBe(0)
})
