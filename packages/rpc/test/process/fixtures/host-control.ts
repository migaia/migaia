import { vi } from 'vitest'
import { CapabilityLevel, StandardCapability, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import type { IRpcEndpoint } from '../../../src/core/typing.js'
import type { ISpawnProcessPluginDeployment } from '../../../src/process/plugin/types.js'
import type { IRemoteHostCatalog } from '../../../src/remote/contract.js'
import { remoteHarness, remoteDescription } from '../../remote/fixture.js'
import { runtimeTestHost } from '../../runtime-api/fixture.js'
import { createProcessPlugin } from '../../../src/process/plugin/client.js'
import type { IRuntimeDynamicSurface } from '../../../src/remote/runtime-api/typing.js'
import type { IRemoteEndpointFactory } from '../../../src/remote/types.js'

/** The neutral control harness still validates a real catalog with no fabricated local Host state. */
export const catalog: IRemoteHostCatalog = {
  p: {
    schemaVersion: 1,
    plugin: 'p',
    features: { f: { methods: { m: { mode: 'request', idempotent: false } } } }
  }
}

/** The test launcher implements the two guarantees required by every process profile. */
const capabilities = {
  [StandardCapability.termination]: CapabilityLevel.enforced,
  [StandardCapability.faultIsolation]: CapabilityLevel.enforced
}

/** Admission and shutdown drive the actual process supervisor while recording neutral frames. */
export function hostFixture() {
  const upstream = remoteHarness()
  const scheduler = upstream.binding.scheduler
  const report = vi.fn()
  /** Each actual supervised candidate gets its own exit, so replacements cannot reuse a dead unit. */
  const handles: IProcessHandle[] = []
  /** Crash hooks settle the actual supervised exits without manufacturing terminal events. */
  const crashes: ((status: { code: number; signal: null }) => void)[] = []
  /** Aggregate termination counts do not own any particular handle's exit promise. */
  const terminate = vi.fn((_mode: string) => undefined)
  /** Launch order is observable separately from termination and spec identity. */
  const order: string[] = []
  const launch = vi.fn(async () => {
    let exit!: (value: { code: number; signal: null }) => void
    const id = handles.length + 1
    const handle: IProcessHandle = {
      identity: { fingerprint: `owned-host-${id}` },
      exited: new Promise((resolve) => {
        exit = resolve
      }),
      terminate(mode) {
        terminate(mode)
        order.push(`exit:${id}`)
        exit({ code: 0, signal: null })
      }
    }
    crashes.push(exit)
    handles.push(handle)
    order.push(`launch:${id}`)
    return handle
  })
  const send = vi.fn(async (_peer: string, method: string) =>
    method === 'migaia.remote.runtime.describe'
      ? remoteDescription(Object.values(catalog), 'peer', true)
      : method === 'migaia.remote.host.inspect'
        ? { revision: 0, plugins: [] }
        : method === 'migaia.remote.host.unUse'
          ? { ok: true }
          : { name: 'p', state: 'enabled', revision: 1, features: ['f'] }
  )
  /** These are retained lower owner inputs, not a deprecated public Host constructor contract. */
  const options: Readonly<{
    catalog: IRemoteHostCatalog
    report(error: unknown): void
    endpointFactory: IRemoteEndpointFactory
    deployment: ISpawnProcessPluginDeployment
  }> = {
    catalog,
    report,
    endpointFactory: async () => ({
      endpoint: {
        ...upstream.served.endpoint,
        send,
        dispose: upstream.served.endpoint.dispose
      } as IRpcEndpoint
    }),
    deployment: {
      kind: 'spawn',
      channelKind: 'message',
      rawChannel: async () => ({
        kind: 'message',
        send: () => undefined,
        onMessage: () => () => undefined,
        onClose: () => () => undefined,
        close: () => undefined
      }),
      establish: async () => upstream.channel,
      supervision: {
        id: 'host-fixture',
        spec: {
          command: 'fixture',
          args: [],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
        },
        launcher: { capabilities, launch },
        budget: createUnitBudget({ kind: 'process', maxUnits: 2, scheduler }),
        scheduler,
        report,
        health: { check: async () => undefined }
      }
    }
  }
  return { options, launch, terminate, send, upstream, scheduler, report, handles, order, crashes }
}

/** Retain the neutral platform ports while using a genuine symmetric PluginHost registration. */
export function runtimeHostFixture() {
  /** The original launcher, supervisor clock, exit promises and frame spies remain the oracle. */
  const fixture = hostFixture()
  /** This fixture always owns a spawn profile; it never invents a borrowed process identity. */
  const spawn = fixture.options.deployment
  if (spawn.kind !== 'spawn') throw new TypeError('control fixture requires spawn')
  /** Actual Host resource ownership and publication replace the retired directional facade. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Existing neutral roots supply stream/one-way ports; this endpoint records scalar dispatch. */
  const endpointFactory: IRemoteEndpointFactory = async (...args) => {
    /** The original mocked endpoint remains the single send/disposal observation boundary. */
    const served = await fixture.options.endpointFactory(...args)
    /** This neutral endpoint accepts provider registration without another provider implementation. */
    const endpoint: IRpcEndpoint = { ...served.endpoint, provide: () => endpoint }
    return { ...fixture.upstream.served, endpoint }
  }
  /** Only modern source fields reach the public factory; no old Host methods are recreated. */
  const options = {
    name: 'child',
    self: { name: 'parent', instanceId: 'parent' },
    spawn,
    endpointFactory,
    report: fixture.report
  }
  /** The actual lazy definition is installed explicitly by each migrated scenario. */
  const plugin = createProcessPlugin<IRuntimeDynamicSurface>(options)
  return { ...fixture, options, host, plugin, close: () => host.dispose() }
}
