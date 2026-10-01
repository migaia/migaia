import { vi } from 'vitest'
import { CapabilityLevel, StandardCapability, createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle } from '@migaia/supervision/process'
import type { IRpcEndpoint } from '../../../src/core/typing.js'
import type { IProcessHostOptions } from '../../../src/process/host/types.js'
import type { IRemoteHostCatalog } from '../../../src/remote/contract.js'
import { remoteHarness } from '../../remote/fixture.js'

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
    method === 'migaia.remote.describe'
      ? { schemaVersion: 1, catalog }
      : method === 'migaia.remote.host.inspect'
        ? { revision: 0, plugins: [] }
        : method === 'migaia.remote.host.unUse'
          ? { ok: true }
          : { name: 'p', state: 'enabled', revision: 1, features: ['f'] }
  )
  const options: IProcessHostOptions = {
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
