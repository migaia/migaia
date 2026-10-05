import { RpcControl } from '../../src/contract/wire-constants.js'
import { readManagedRuntimeRegistration } from '../../src/remote/runtime-api/managed-peer.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import type { IRuntimeEvent } from '../../src/remote/runtime-api/events.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'

it('[A48][A57] borrowed connections reject every native control and retain ordinary business', async () => {
  /** Two real local registrations own channels, not execution on the opposite side. */
  const hosts = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  /** This original memory source has no native handle or execution lease to upgrade. */
  const channels = runtimeSources()
  try {
    await Promise.all(
      hosts.map((host, index) =>
        host.use(
          createThreadPlugin({
            name: 'borrowed',
            connect: channels.sources[index]!,
            provide: { echo: (value: unknown) => value },
            report: () => undefined
          })
        )
      )
    )
    const outlet = hosts[0].thread! as unknown as { [key: string]: (...args: unknown[]) => unknown }
    for (const command of ['stop', 'kill', 'restart', 'replace']) {
      const result = await Promise.resolve()
        .then(() => outlet[command]!('borrowed'))
        .catch((error: unknown) => error)
      assert.equal(
        Reflect.get(result as object, 'code'),
        'CAPABILITY_CONFLICT',
        `[A48] ${command} cannot mutate a borrowed target`
      )
    }
    assert.equal(await hosts[0].thread!.request('borrowed', 'echo', 42), 42)
  } finally {
    for (const host of hosts) await host.dispose()
    channels.close()
  }
})

it('[A47][A48] owned Worker controls upgrade the original pending drain once and preserve restart outcomes', async () => {
  /** The original budget counts the native lease independently from facade command completion. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** Native launcher handles remain the sole exit and termination owners. */
  const launcher = createNodeThreadLauncher()
  /** Every actual launched Worker is retained for exact exit cleanup and replacement checks. */
  const handles: INodeThreadHandle[] = []
  /** Only the original beforeTerminate callback marks graceful entry. */
  let entered!: () => void
  /** The pending original drain must be interrupted without waiting for its one-second budget. */
  const draining = new Promise<void>((resolve) => {
    entered = resolve
  })
  /** Termination calls distinguish force upgrade from a queued second stop. */
  let terminated = 0
  /** Invalid configuration must never enter application drain. */
  let drains = 0
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(
      createThreadPlugin({
        provide: { parent: { started: () => entered() } },
        name: 'owned',
        report: () => undefined,
        spawn: {
          spec: { entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)) },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              const handle = await launcher.launch(...args)
              const terminate = handle.terminate
              /** Genuine close control physically leaves this exact Worker port before force. */
              const postMessage = handle.port.postMessage
              handle.port.postMessage = (message, transfer) => {
                const envelopes = Array.isArray(message) ? message : [message]
                if (
                  envelopes.some(
                    (frame) =>
                      frame &&
                      typeof frame === 'object' &&
                      Reflect.get(frame, 'kind') === 'variation' &&
                      (frame as { data?: { route?: { variation?: unknown } } }).data?.route
                        ?.variation === RpcControl.close
                  )
                )
                  drains += 1
                Reflect.apply(postMessage, handle.port, [message, transfer])
              }
              const tracked = {
                ...handle,
                terminate: () => {
                  terminated += 1
                  terminate()
                }
              }
              handles.push(tracked)
              return tracked
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: {
            stop: {
              drainTimeoutMs: 1000,
              exitTimeoutMs: 50,
              reapTimeoutMs: 1000
            }
          },
          report: () => undefined
        }
      })
    )
    const outlet = host.thread! as unknown as {
      stop(name: string, options?: unknown): Promise<void>
      kill(name: string): Promise<void>
      restart(name: string): Promise<{ generation: number }>
      replace(name: string, spec?: unknown): Promise<{ switched: boolean }>
    }
    assert.equal(typeof outlet.stop, 'function', '[A47] controls exist on the original outlet')
    for (const signal of ['SIGTERM', new AbortController().signal, undefined])
      assert.throws(() => outlet.stop('owned', { signal }), { code: 'INVALID_CONFIG' })
    for (const graceMs of [-1, NaN, Infinity])
      assert.throws(() => outlet.stop('owned', { graceMs }), { code: 'INVALID_CONFIG' })
    assert.equal(terminated, 0)
    assert.equal(drains, 0)
    /**
     * Native outcome generations come from the original controller, including its cancellation
     * tokens.
     */
    const supervisor = readManagedRuntimeRegistration(
      readRuntimeOutletConnection(host.thread, 'owned')!.peer
    )!.supervisor
    /** Actual supervision facts must flow through the committed outlet without synthetic exits. */
    const events: IRuntimeEvent[] = []
    for (const event of ['ready', 'exit', 'restart', 'degraded', 'liquidated'] as const)
      host.thread!.on(event, (value) => events.push(value))
    /** Genuine pending provider work prevents the ordinary close request from completing drain. */
    const request = host.thread!.request('owned', 'hold').catch((error: unknown) => error)
    await draining
    const stopped = outlet.stop('owned', { graceMs: 1000 })
    await vi.waitFor(
      () => assert.equal(drains, 1, '[A47] one original close announcement precedes native force'),
      { timeout: 500 }
    )
    const killed = outlet.kill('owned')
    assert.equal(killed, stopped, '[A47] force joins the original pending stop Promise')
    await killed
    await request
    assert.equal(terminated, 1, '[A47] the pending original drain receives one immediate force')
    assert.equal(budget.inUse, 0)
    assert.equal(events.filter((event) => event.type === 'exit').length, 1)
    assert.equal(
      events.find((event) => event.type === 'exit')!.code,
      (await handles[0]!.exited).code
    )
    /** Withdrawal from business must not hide the still-committed stopped registration. */
    const stoppedDetail = await host.thread!.get('owned')
    assert.ok('state' in stoppedDetail.unit)
    assert.equal(stoppedDetail.unit.state, 'stopped')
    assert.equal(
      (await host.thread!.list({ filter: { state: 'stopped', name: { exact: 'owned' } } }))
        .connections.length,
      1
    )
    assert.equal((await host.thread!.list({ filter: { state: 'ready' } })).connections.length, 0)
    const restarted = await outlet.restart('owned')
    assert.equal(restarted.generation, supervisor.generation)
    assert.equal(handles.length, 2)
    assert.equal(supervisor.inspect().restartCount, 1)
    assert.equal(events.filter((event) => event.type === 'restart').length, 1)
    assert.equal(events.find((event) => event.type === 'restart')!.count, 1)
    /** Native unit readiness precedes the original asynchronous RPC-generation publication. */
    await vi.waitFor(() => assert.ok(events.some((event) => event.type === 'ready')))
    assert.equal(events.find((event) => event.type === 'ready')!.generation, restarted.generation)
    assert.equal(
      events.find((event) => event.type === 'ready')!.instanceId,
      readRuntimeOutletConnection(host.thread, 'owned')!.instanceId
    )
    assert.equal(
      events.filter((event) => event.type === 'liquidated').length,
      0,
      '[A52] Worker exit/restart never fabricate an unavailable liquidation owner'
    )
    await outlet.kill('owned')
  } finally {
    await host.dispose()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
})
