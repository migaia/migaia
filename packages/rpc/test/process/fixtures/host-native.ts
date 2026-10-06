import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createNodeProcessLauncher } from '../../../src/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../../src/process/offer.js'
import { createProcessPeer } from '../../../src/process/peer.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../src/remote/runtime-api/constants.js'
import type { IRuntimeDynamicSurface } from '../../../src/remote/runtime-api/typing.js'
import type { IProcessHostOptions } from '../../../src/process/host/types.js'
import type { IRemoteHostCatalog } from '../../../src/remote/contract.js'
import { nativeEndpoint } from './native-runtime.js'
import type { IProcessHandle } from '@migaia/supervision/process'
import {
  createProcessPlugin,
  type IRuntimeProcessPluginOptions
} from '../../../src/process/plugin/client.js'
import { runtimeTestHost } from '../../runtime-api/fixture.js'

/** The real peer's contract is frozen in one data fixture rather than duplicated per transport. */
export const nativeHostCatalog = JSON.parse(
  readFileSync(new URL('./host-catalog.json', import.meta.url), 'utf8')
) as IRemoteHostCatalog
/**
 * All real Host fixtures use the same executable and catalog; value distinguishes process
 * generations.
 */
export const nativeHostChildPath = fileURLToPath(
  new URL('./node-process-host.mjs', import.meta.url)
)
/** Bootstrap data is fixture input and never enters diagnostics or process descriptors. */
export const nativeHostToken = 'host-fixture-secret'

/** Assemble real process bindings while retaining actual handles for PID and exit assertions. */
export function nativeHostOptions(value = 'initial', maxUnits = 2) {
  const launcher = createNodeProcessLauncher()
  const handles: IProcessHandle[] = []
  const reports: unknown[] = []
  const options: IProcessHostOptions = {
    catalog: nativeHostCatalog,
    report: (error) => {
      reports.push(error)
    },
    endpointFactory: (channel) => nativeEndpoint(channel, 'host-parent'),
    deployment: {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token: nativeHostToken,
      offer: createNativeProcessOffer({
        peer: { id: 'host-parent', runtime: 'node' },
        auth: nativeHostToken,
        stream: true
      }),
      supervision: {
        id: 'native-host',
        scheduler: systemScheduler,
        isolation: 'best-effort',
        report: (error) => {
          reports.push(error)
        },
        budget: createUnitBudget({ kind: 'process', maxUnits, scheduler: systemScheduler }),
        spec: {
          command: process.execPath,
          args: [nativeHostChildPath],
          env: { inherit: [], set: { RPC_VALUE: value } },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(nativeHostToken) }
        },
        launcher: {
          ...launcher,
          async launch(spec, context) {
            const handle = await launcher.launch(spec, context)
            handles.push(handle)
            return handle
          }
        }
      },
      rawChannel: async (handle) => {
        if (!('channel' in handle)) throw new Error('native fixture lacks channel')
        return handle.channel as Awaited<
          ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>
        >['channel'] & {}
      },
      establish: (raw, context) => {
        if (raw.kind !== 'byte') throw new Error('native fixture requires byte channel')
        return createProcessTransport(raw, {
          role: 'initiator',
          offer: context.offer!,
          peerId: 'host-child',
          scheduler: context.scheduler,
          signal: context.signal as AbortSignal,
          ipc: { ...context.session, log: () => undefined },
          report: (error) => {
            reports.push(error)
          }
        })
      }
    }
  }
  return { options, handles, reports }
}

/** One actual local Host installs a symmetric connection and retains its original native handles. */
export function nativeHostFixture(value = 'initial', maxUnits = 2) {
  /** Reuse the original real launcher, byte authentication, spec, budget and PID observations. */
  const fixture = nativeHostOptions(value, maxUnits)
  /** This fixture owns its local Host; no remote control facade or lifecycle state is simulated. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The native fixture always supplies a spawn deployment; the type preserves the original union. */
  const deployment = fixture.options.deployment
  if (deployment.kind !== 'spawn') throw new TypeError('native fixture requires spawn')
  /** The explicit offer names the endpoint roots selected by this custom native composition. */
  const spawn = {
    ...deployment,
    offer: createNativeProcessOffer({
      peer: { id: 'host-parent', runtime: 'node' },
      auth: nativeHostToken,
      stream: true,
      capabilities: RUNTIME_API_BASE_CAPABILITIES
    })
  }
  /** The returned definition is the public factory's actual Plugin, installed by each assertion. */
  const options = {
    name: 'child',
    self: { name: 'host-parent', instanceId: 'host-parent' },
    spawn,
    endpointFactory: fixture.options.endpointFactory,
    report: fixture.options.report
  } satisfies IRuntimeProcessPluginOptions
  /** Factory construction remains lazy until the genuine Host installs this definition. */
  const plugin = createProcessPlugin<IRuntimeDynamicSurface>(options)
  return { ...fixture, options, host, plugin, close: () => host.dispose() }
}

/** Borrow an independent Node listener with the exact same endpoint and authenticated contract. */
export function nativeBorrowedPeer(address: string, token = nativeHostToken) {
  return createProcessPeer<IRuntimeDynamicSurface>({
    self: { name: 'host-parent', instanceId: 'host-parent' },
    report: () => undefined,
    endpointFactory: (channel) => nativeEndpoint(channel, 'host-parent'),
    connect: {
      kind: 'connect',
      address,
      token,
      dial: (target, signal) =>
        dialProcessByteChannel({ address: target, signal: signal as AbortSignal }),
      offer: createNativeProcessOffer({
        peer: { id: 'host-parent', runtime: 'node' },
        auth: token,
        stream: true,
        capabilities: RUNTIME_API_BASE_CAPABILITIES
      }),
      establish: (raw, context) => {
        if (raw.kind !== 'byte') throw new Error('native fixture requires bytes')
        return createProcessTransport(raw, {
          role: 'initiator',
          offer: context.offer!,
          peerId: 'host-child',
          scheduler: context.scheduler,
          signal: context.signal as AbortSignal,
          ipc: { ...context.session, log: () => undefined },
          report: () => undefined
        })
      }
    }
  })
}
