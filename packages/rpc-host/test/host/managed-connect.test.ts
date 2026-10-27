/** Original managed connection business assertions run through real native SDK generations. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  createSupervisor,
  createUnitBudget,
  SupervisorEventType,
  type IUnitHandle,
  type IUnitLauncher,
  type IUnitProfile
} from '@migaia/supervision'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import { coreMemoryServer } from './core-fixture.js'
import {
  managedMemoryTransport,
  nativeManagedMemoryUnits,
  openManagedMemoryCarrier,
  silentManagedMemoryCarrier
} from './managed-memory-fixture.js'

/** Original providers retain their genuine unit's completion gate and ordinal values. */
function restartProviders(ordinal: number, finished: Promise<void>, entered: () => void) {
  return {
    value: () => ordinal,
    pending: async () => {
      entered()
      await finished
      return ordinal
    },
    async *values() {
      yield ordinal
      yield ordinal + 1
    }
  }
}

/** Namespace selector returns the original D4 empty null-prototype maps after real departure. */
function expectNoNativeTargets(result: unknown): void {
  expect(result).toStrictEqual({ fulfilled: Object.create(null), rejected: Object.create(null) })
}

// Retain all 18 original business nodes.
it('keeps one host and feature installation through the original supervisor restart', async () => {
  /** The original budget and native restart policy remain the sole generation authority. */
  const budget = createUnitBudget({ kind: 'host-memory', maxUnits: 1, launchRate: false })
  /** Hold the actual second native acquisition before its Session can become ready. */
  const nextLaunch = deferred<void>()
  /** Actual provider entry proves the pending request reached the first real remote Host. */
  const entered = deferred<void>()
  /** Native and SDK failures preserve their original identity and diagnostic chain. */
  const reports: unknown[] = []
  /** The migrated original launcher owns both remote Hosts and native exit receipts. */
  const { units, launcher, profile } = nativeManagedMemoryUnits({
    kind: 'host-memory',
    beforeLaunch: (ordinal) => (ordinal > 1 ? nextLaunch.promise : undefined),
    provide: (ordinal, finished) => restartProviders(ordinal, finished, entered.resolve)
  })
  /** Reuse the original Supervisor rather than inventing a fixture readiness generation. */
  const supervisor = createSupervisor({
    id: 'host-memory',
    spec: 'remote',
    launcher,
    profile,
    budget,
    report: (error) => reports.push(error),
    restart: { mode: 'on-failure', initialDelayMs: 0, maxDelayMs: 0 }
  })
  /** These callbacks observe only genuinely accepted Sessions from the one SDK registration. */
  const accepted: string[] = []
  /** The original ready subscription begins after initial native installation completes. */
  const ready = deferred<void>()
  /** Native exit and accepted-ready events retain the original post-install observation window. */
  const exits: unknown[] = []
  /** Accepted replacement count must not include the first installation's ready callback. */
  const readiness: unknown[] = []
  /** This test observer boundary has no authority over generation or Session publication. */
  let observing = false
  /** Reuse one diagnostic callback at acquisition without a nested forwarding closure. */
  const report = (error: unknown) => {
    reports.push(error)
  }
  /** The concrete native install delegates all generation behavior to the existing SDK owner. */
  const transport = managedMemoryTransport({
    name: 'supervised',
    handshakeTimeoutMs: 100,
    binding: {
      ownership: 'owned',
      supervisor,
      openCarrier: (unit) => openManagedMemoryCarrier(unit.source, report)
    },
    report: (error) => reports.push(error),
    onReady: (view) => {
      accepted.push(view.peerId)
      if (observing) {
        readiness.push(view)
        ready.resolve()
      }
    },
    onNative: (event) => {
      if (observing && event.type === SupervisorEventType.exit) exits.push(event)
    }
  })
  /** One genuine flow installation owns its cleanup across native member replacements. */
  const cleanup = vi.fn()
  /** Setup count must remain one while the actual remote generation changes. */
  const setup = vi.fn()
  /** Changes the cold hook shape; the original setup/dispose business stays unchanged. */
  const feature = defineFlowPlugin({
    name: 'lifetime',
    setup() {
      setup()
      return { hooks: {}, dispose: cleanup }
    }
  })
  /** Flow metadata is installed before the first actual physical Session starts. */
  const host = await createRpcHost({
    self: { name: 'local', instanceId: 'managed-local' },
    plugins: [feature, transport],
    report: (error) => reports.push(error)
  })
  observing = true
  try {
    expect(await host.memory.request('value')).toBe(1)
    /** Hold the canonical callable from the original accepted view, not a synthetic peer. */
    const held = host.memory.peers.remote.value as () => Promise<unknown>
    /** The original stream retains the first actual physical generation. */
    const stream = host.memory.stream('values') as AsyncIterableIterator<unknown>
    expect(await stream.next()).toEqual({ value: 1, done: false })
    /** Observe original physical departure without leaving an unhandled rejection. */
    const pending = host.memory.request('pending').catch((error: unknown) => error)
    await entered.promise
    /** Native supervision receives the same original crash object. */
    const crashed = new Error('actual supervised unit crash')
    await units[0]!.remote.close()
    units[0]!.exit({ error: crashed })
    units[0]!.finish()
    await vi.waitFor(() => expect(supervisor.generation).toBe(2))
    // Removes the retained single-Peer call surface; zero namespace targets use D4.
    expectNoNativeTargets(await host.memory.request('value'))
    /** A request in flight when its unit crashes has an unknown remote result. */
    expect(await pending).toMatchObject({ source: 'rpc.remote', code: 'REMOTE_RESULT_UNKNOWN' })
    nextLaunch.resolve()
    await ready.promise
    expect(await host.memory.request('value')).toBe(2)
    expect(await host.memory.send('remote', 'value')).toBe(2)
    await expect(held()).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
    /** A recovered stream must use the newly accepted real provider. */
    const recovered = host.memory.stream('values') as AsyncIterableIterator<unknown>
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
    observing = false
    await host.close()
    budget.close()
  }
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(supervisor.state).toBe('disposed')
  expect(budget.inUse).toBe(0)
  expect(units).toHaveLength(2)
})

// Retain all nine original business nodes.
it('applies the SDK handshake budget again when an original managed generation reconnects', async () => {
  /** An independent real listener supplies the first generation's successful handshake. */
  const server = coreMemoryServer('remote', 'reconnect-remote')
  /** The remote Host owns its original provider and accepted physical endpoint. */
  const remote = await createRpcHost({ ...server.options, provide: { value: () => 1 } })
  /** The second real raw source remains silent and cannot manufacture a handshake response. */
  const events = new EventEmitter()
  /** The actual native send operation signals that the new handshake has started. */
  const written = deferred<void>()
  /** A native unit retains its actual acquired carrier for original termination/exit ordering. */
  type IUnit = IUnitHandle<void> & { exit(): void; channel?: IRpcCarrier }
  /** These are real launcher acquisitions, never accepted ordinal projections. */
  const units: IUnit[] = []
  /** The original budget admits exactly one active native unit. */
  const budget = createUnitBudget({ kind: 'reconnect-memory', maxUnits: 1, launchRate: false })
  /** Same-process units advertise termination only, without an OS fault-isolation claim. */
  const launcher: IUnitLauncher<string, IUnit> = {
    capabilities: { termination: 'enforced' },
    launch: async () => {
      /** The original unit fulfills exit only after its native carrier is released. */
      const exited = deferred<void>()
      /** Preserve the original native fingerprint sequence. */
      const unit = {
        identity: { fingerprint: `reconnect-${units.length}` },
        exited: exited.promise,
        exit: exited.resolve
      }
      units.push(unit)
      return unit
    }
  }
  /** Native stop closes the original carrier before the Supervisor observes exit. */
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
  /** Observe the SDK's original failed acquisition report, without a second ready state. */
  const failed = deferred<unknown>()
  /** Reports retain the original error chain for the public source failure assertion. */
  const reports: unknown[] = []
  /** This callback records actual SDK diagnostics and preserves their object identity. */
  const report = (error: unknown) => {
    reports.push(error)
    if ((error as { code?: string })?.code === 'REMOTE_START_FAILED') failed.resolve(error)
  }
  /** The existing Supervisor alone decides restart and unit resource ownership. */
  const supervisor = createSupervisor({
    id: 'reconnect-memory',
    spec: 'remote',
    launcher,
    profile,
    budget,
    report,
    restart: { mode: 'always', initialDelayMs: 0, maxDelayMs: 0 }
  })
  /** The original recovery observer begins after the first genuine Session is ready. */
  const recovered = vi.fn()
  /** Test-side subscription timing cannot publish readiness or affect native generations. */
  let observing = false
  /** Each acquired carrier is attached once by the SDK and receives the same 35 ms budget. */
  const transport = managedMemoryTransport({
    name: 'managed-budget',
    handshakeTimeoutMs: 35,
    binding: {
      ownership: 'owned',
      supervisor,
      openCarrier: async (unit) => {
        /** First acquisition uses native MessagePorts; later raw IO supplies no response. */
        const source =
          units.indexOf(unit) === 0
            ? await openManagedMemoryCarrier(server, report)
            : silentManagedMemoryCarrier(events, written.resolve, report)
        unit.channel = source.carrier
        return source
      }
    },
    report,
    onReady: () => {
      if (observing) recovered()
    }
  })
  /** One real Host owns the managed native transport and its public namespace. */
  const host = await createRpcHost({
    self: { name: 'local', instanceId: 'reconnect-local' },
    plugins: [transport],
    report
  })
  observing = true
  try {
    expect(await host.memory.request('value')).toBe(1)
    await units[0]!.channel!.close()
    units[0]!.exit()
    await written.promise
    await expect(failed.promise).resolves.toMatchObject({
      code: 'REMOTE_START_FAILED',
      /** The silent replacement fails at its own handshake budget. */
      cause: { source: 'rpc.endpoint', code: 'DEADLINE_EXCEEDED' }
    })
    expect(events.listenerCount('message')).toBe(0)
    expect(units).toHaveLength(2)
    expect(recovered).not.toHaveBeenCalled()
    // The same approved zero-target selection applies after failed replacement.
    expectNoNativeTargets(await host.memory.request('value'))
  } finally {
    observing = false
    await host.close()
    await remote.close()
    budget.close()
  }
  expect(supervisor.state).toBe('disposed')
  expect(budget.inUse).toBe(0)
  expect(units).toHaveLength(2)
})
