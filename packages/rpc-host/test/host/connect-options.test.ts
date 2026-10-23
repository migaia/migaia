import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createSupervisor,
  createUnitBudget,
  type IUnitHandle,
  type IUnitLauncher,
  type IUnitProfile
} from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRpcHost } from '../../dist/index.js'
import {
  defineByteAdapter,
  defineMessageAdapter,
  defineTransportPlugin,
  defineFeaturePlugin
} from '../../dist/plugin/index.js'
import type { IAdapterEventEmitterMessagePort } from '../../dist/runtime-adapter/message/types.js'
import {
  createAdapterDeployment,
  readAdapterDeployment
} from '../../dist/runtime-adapter/deployment.js'
import type { IRemoteBinding, IRemoteChannel, IRemoteRetryPort } from '../../dist/remote/types.js'
import { memoryServer, managedMemoryUnits, type IManagedMemoryUnit } from './fixture.js'
import type { IRuntimeByteIO } from '../../dist/runtime-adapter/byte/types.js'

describe('RPC host transport connection options', () => {
  it.each(['deployment', 'managed'] as const)(
    'retains the original key factory and retry port from %s configuration',
    async (configuration) => {
      /** The supplied function must generate the logical key exactly once for a genuine call. */
      const keyFactory = vi.fn(() => `retained-key-${configuration}`)
      /** The original callable owner alone invokes this exact configured retry operation. */
      const dispatch = vi.fn<IRemoteRetryPort['dispatch']>((input) =>
        input.sendOnce({ expectedGeneration: input.generation, key: input.key })
      )
      /** An actual caller-owned port passes the selected generation and unchanged logical key. */
      const retryPort = Object.freeze({ dispatch })
      /** Provider call count proves that configuration forwarding does not duplicate execution. */
      const business = vi.fn((value: unknown) => value)
      /** The existing raw launcher and supervisor own the real remote resource and its teardown. */
      const { launcher, profile } = managedMemoryUnits({
        kind: 'host-call-policy',
        provide: () => ({ api: { value: business } }),
        contract: {
          schemaVersion: 1,
          plugin: 'api',
          features: { shape: { methods: { value: { mode: 'request', idempotent: true } } } }
        }
      })
      /** Only the original native supervisor owns generations, leases and stop. */
      const supervisor = createSupervisor({
        id: `call-policy-${configuration}`,
        spec: 'remote',
        launcher,
        profile,
        budget: createUnitBudget({ kind: 'host-call-policy', maxUnits: 1, launchRate: false }),
        report: () => undefined,
        restart: { mode: 'never' }
      })
      /** Both existing configuration locations describe one canonical binding, not another facade. */
      const transport = defineTransportPlugin({
        name: `call-policy-${configuration}`,
        mode: 'spawn',
        deployment: createAdapterDeployment({
          runtimeOptions: configuration === 'deployment' ? { keyFactory, retryPort } : undefined,
          open: async () => {
            throw new Error('managed deployment must not open directly')
          },
          managed: async (prepared) => ({
            ...(configuration === 'managed' ? { keyFactory, retryPort } : {}),
            binding: {
              ownership: 'owned',
              supervisor,
              scheduler: systemScheduler,
              openChannel: (unit: IManagedMemoryUnit, signal: AbortSignal) =>
                unit.source.open({ ...prepared, signal })
            } as IRemoteBinding<unknown, unknown>
          })
        })
      })
      /** The public entry owns the one shared endpoint over this real managed source. */
      const host = await createRpcHost({ plugins: [transport], report: () => undefined })
      try {
        expect(await host.request('api.value', 42)).toBe(42)
        expect(keyFactory).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch.mock.calls[0]![0]).toMatchObject({
          method: 'api.value',
          idempotent: true,
          key: `retained-key-${configuration}`
        })
        expect(business).toHaveBeenCalledTimes(1)
      } finally {
        await host.close()
      }
    }
  )
  it.each([undefined, 'silent-peer'])(
    'applies the SDK budget to a real message source with peerId %s',
    async (peerId) => {
      /** One manual monotonic clock observes the existing resource timer without wall-clock guesses. */
      const scheduler = createManualScheduler()
      /**
       * Native callbacks remain silent, so neither identity nor ACK can be synthesized by a
       * fixture.
       */
      const events = new EventEmitter()
      /** The real first control write proves the native hook reached its bounded source owner. */
      const written = deferred<void>()
      /** This raw port has no accepted channel fields or authority supplied by the caller. */
      const port: IAdapterEventEmitterMessagePort = {
        postMessage: () => {
          written.resolve()
        },
        on: (event, listener) => {
          events.on(event, listener)
        },
        off: (event, listener) => {
          events.off(event, listener)
        }
      }
      /** Adapter definition captures raw I/O only; the SDK owns the shared connection option. */
      const adapter = defineMessageAdapter<IAdapterEventEmitterMessagePort>({
        open: (input) => input
      })
      /** Its true native plugin delegates to the same deployment used by production adapters. */
      const transport = defineTransportPlugin({
        name: 'silent',
        mode: 'connect',
        connect: { timeoutMs: 50 },
        deployment: adapter.deployment({ connect: port, peerId, scheduler })
      })
      /** Observe the construction rejection before advancing its original source timer. */
      const opening = createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        plugins: [transport],
        report: () => undefined
      })
      const failed = expect(opening).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      await written.promise
      await Promise.resolve()
      expect(scheduler.pendingCount).toBe(1)
      scheduler.advance(49)
      expect(events.listenerCount('message')).toBe(1)
      scheduler.advance(1)
      await failed
      expect(events.listenerCount('message')).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }
  )

  it('maps the same SDK budget to the existing byte handshake timeout and physical rollback', async () => {
    /** The byte handshake keeps its actual scheduler and already existing timeout error identity. */
    const scheduler = createManualScheduler()
    /** The physical write confirms the native hello starts before timeout advancement. */
    const written = deferred<void>()
    /** Cleanup remains a native operation owned by the source receipt. */
    const close = vi.fn()
    /** A silent byte carrier exposes no handshake response or accepted agreement. */
    const byte: IRuntimeByteIO = {
      kind: 'byte',
      write: async () => {
        written.resolve()
      },
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close
    }
    /** The generic byte adapter reuses the canonical byte source instead of assembling a Peer. */
    const adapter = defineByteAdapter<IRuntimeByteIO>({ open: (input) => input })
    /** Only this shared SDK option sets the physical handshake budget. */
    const transport = defineTransportPlugin({
      name: 'silent-byte',
      mode: 'connect',
      connect: { timeoutMs: 50 },
      deployment: adapter.deployment({ connect: byte, peerId: 'remote', scheduler })
    })
    /** Native installation failure remains the original byte deadline error at the public host. */
    const opening = createRpcHost({
      self: { name: 'local', instanceId: 'local-byte' },
      plugins: [transport],
      report: () => undefined
    })
    const failed = expect(opening).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await written.promise
    await Promise.resolve()
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(50)
    await failed
    expect(close).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('keeps one host and feature installation through the original supervisor restart', async () => {
    /** Real unit admission and original restart policy own all generation and delay decisions. */
    const budget = createUnitBudget({ kind: 'host-memory', maxUnits: 1, launchRate: false })
    /** The second launch is held before readiness so calls during reconnect are observable. */
    const nextLaunch = deferred<void>()
    /** The first provider start proves the failing request reached actual business code. */
    const entered = deferred<void>()
    /** Reported failures remain available with original source/code/cause instead of being dropped. */
    const reports: unknown[] = []
    /** This shared raw launcher is also used by the three-member single-endpoint acceptance. */
    const { units, launcher, profile } = managedMemoryUnits({
      kind: 'host-memory',
      beforeLaunch: (ordinal) => (ordinal > 1 ? nextLaunch.promise : undefined),
      provide: (ordinal, finished) => ({
        value: () => ordinal,
        pending: async () => {
          entered.resolve()
          await finished
          return ordinal
        },
        async *values() {
          yield ordinal
          yield ordinal + 1
        }
      })
    })
    /** This is the canonical existing supervisor; the host must reuse its managed registration. */
    const supervisor = createSupervisor({
      id: 'host-memory',
      spec: 'remote',
      launcher,
      profile,
      budget,
      report: (error) => reports.push(error),
      restart: { mode: 'on-failure', initialDelayMs: 0, maxDelayMs: 0 }
    })
    /** Cold recipe publishes an actual supervisor binding, without constructing an old managed Peer. */
    const transport = defineTransportPlugin({
      name: 'supervised',
      mode: 'spawn',
      connect: { timeoutMs: 100 },
      deployment: createAdapterDeployment({
        open: async () => {
          throw new Error('managed deployment must not open directly')
        },
        managed: async (prepared) => ({
          binding: {
            ownership: 'owned',
            supervisor,
            scheduler: systemScheduler,
            openChannel: (unit: IManagedMemoryUnit, signal: AbortSignal) =>
              unit.source.open({ ...prepared, signal })
          } as IRemoteBinding<unknown, unknown>
        })
      })
    })
    /** A real feature hook stays installed while accepted generation directories change. */
    const cleanup = vi.fn()
    const setup = vi.fn()
    const accepted: string[] = []
    const feature = defineFeaturePlugin({
      name: 'lifetime',
      setup(context) {
        setup()
        context.onDispose(cleanup)
        context.onDispose(
          context.directories.onAccepted((directory) => accepted.push(directory.self.instanceId))
        )
        for (const directory of context.directories.current())
          accepted.push(directory.self.instanceId)
      }
    })
    const host = await createRpcHost({
      self: { name: 'local', instanceId: 'managed-local' },
      plugins: [transport, feature],
      report: (error) => reports.push(error)
    })
    /** Events come from the original registration and supervisor, with no synthesized test facts. */
    const ready = deferred<void>()
    const exits: unknown[] = []
    const readiness: unknown[] = []
    const stopReady = host.on('ready', (event) => {
      readiness.push(event)
      ready.resolve()
    })
    const stopExit = host.on('exit', (event) => exits.push(event))
    try {
      expect(await host.request('value')).toBe(1)
      const held = host.peers.remote.value as () => Promise<unknown>
      const stream = host.stream('values') as AsyncIterableIterator<unknown>
      expect(await stream.next()).toEqual({ value: 1, done: false })
      const pending = host.request('pending').catch((error) => error)
      await entered.promise
      const crashed = new Error('actual supervised unit crash')
      await units[0]!.remote.close()
      units[0]!.exit({ error: crashed })
      units[0]!.finish()
      await vi.waitFor(() => expect(supervisor.generation).toBe(2))
      await expect(host.request('value')).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
      expect(await pending).toMatchObject({
        source: 'rpc.endpoint',
        code: 'TRANSPORT'
      })
      nextLaunch.resolve()
      await ready.promise
      expect(await host.request('value')).toBe(2)
      expect(await host.send('remote', 'value')).toBe(2)
      await expect(held()).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      const recovered = host.stream('values') as AsyncIterableIterator<unknown>
      expect(await recovered.next()).toEqual({ value: 2, done: false })
      await recovered.return?.()
      expect(readiness).toHaveLength(1)
      expect(exits).toHaveLength(1)
      expect(accepted).toEqual(['remote-1', 'remote-2'])
      expect(setup).toHaveBeenCalledTimes(1)
      expect(cleanup).not.toHaveBeenCalled()
    } finally {
      nextLaunch.resolve()
      for (const unit of units) unit.finish()
      stopReady()
      stopExit()
      await host.close()
      budget.close()
    }
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(supervisor.state).toBe('disposed')
    expect(budget.inUse).toBe(0)
    expect(units).toHaveLength(2)
  })

  it('applies the SDK handshake budget again when an original managed generation reconnects', async () => {
    /** A real listener provides the accepted first generation and stays independently owned. */
    const server = memoryServer('remote', 'reconnect-remote')
    const remote = await createRpcHost({ ...server.options, provide: { value: () => 1 } })
    /** The next raw source emits control traffic but deliberately supplies no ACK. */
    const events = new EventEmitter()
    const written = deferred<void>()
    const port: IAdapterEventEmitterMessagePort = {
      postMessage: () => {
        written.resolve()
      },
      on: (event, listener) => {
        events.on(event, listener)
      },
      off: (event, listener) => {
        events.off(event, listener)
      }
    }
    const silent = readAdapterDeployment(
      defineMessageAdapter<IAdapterEventEmitterMessagePort>({ open: (input) => input }).deployment({
        connect: port,
        peerId: 'reconnect-remote'
      })
    )!
    /** Each native memory unit owns one original channel and fulfills exit after releasing it. */
    type IUnit = IUnitHandle<void> & { exit(): void; channel?: IRemoteChannel }
    const units: IUnit[] = []
    const budget = createUnitBudget({ kind: 'reconnect-memory', maxUnits: 1, launchRate: false })
    const launcher: IUnitLauncher<string, IUnit> = {
      capabilities: { termination: 'enforced', 'fault-isolation': 'enforced' },
      launch: async () => {
        const exited = deferred<void>()
        const unit = {
          identity: { fingerprint: `reconnect-${units.length}` },
          exited: exited.promise,
          exit: exited.resolve
        }
        units.push(unit)
        return unit
      }
    }
    const profile: IUnitProfile<string, IUnit, void> = {
      kind: 'reconnect-memory',
      gracefulTermination: false,
      requirements: () => ['termination'],
      validateSpec: () => undefined,
      terminate: (unit) => {
        void Promise.resolve(unit.channel?.close()).then(unit.exit)
      },
      classifyExit: () => ({ reason: 'crashed' })
    }
    /** Reports expose the original failed source preparation without a second readiness state. */
    const failed = deferred<unknown>()
    const reports: unknown[] = []
    const report = (error: unknown) => {
      reports.push(error)
      if ((error as { code?: string })?.code === 'REMOTE_START_FAILED') failed.resolve(error)
    }
    const supervisor = createSupervisor({
      id: 'reconnect-memory',
      spec: 'remote',
      launcher,
      profile,
      budget,
      report,
      restart: { mode: 'always', initialDelayMs: 0, maxDelayMs: 0 }
    })
    const transport = defineTransportPlugin({
      name: 'managed-budget',
      mode: 'connect',
      connect: { timeoutMs: 35 },
      deployment: createAdapterDeployment({
        open: async () => {
          throw new Error('managed-only fixture')
        },
        managed: async (context) => ({
          binding: {
            ownership: 'owned',
            supervisor,
            scheduler: systemScheduler,
            openChannel: async (unit: IUnit, signal: AbortSignal) => {
              const source = units.indexOf(unit) === 0 ? server : silent
              const channel = await source.open({ ...context, signal })
              unit.channel = channel
              return channel
            }
          } as IRemoteBinding<unknown, unknown>
        })
      })
    })
    const host = await createRpcHost({
      self: { name: 'local', instanceId: 'reconnect-local' },
      plugins: [transport],
      report
    })
    const recovered = vi.fn()
    host.on('ready', recovered)
    try {
      expect(await host.request('value')).toBe(1)
      await units[0]!.channel!.close()
      units[0]!.exit()
      await written.promise
      await expect(failed.promise).resolves.toMatchObject({
        code: 'REMOTE_START_FAILED',
        cause: { source: 'rpc.endpoint', code: 'INVALID_CONFIG' }
      })
      expect(events.listenerCount('message')).toBe(0)
      expect(units).toHaveLength(2)
      expect(recovered).not.toHaveBeenCalled()
      await expect(host.request('value')).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
    } finally {
      await host.close()
      await remote.close()
      budget.close()
    }
    expect(supervisor.state).toBe('disposed')
    expect(budget.inUse).toBe(0)
    expect(units).toHaveLength(2)
  })
})
