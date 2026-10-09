import type { IRemoteChannel } from '../../../src/remote/types.js'
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
import type { IRemoteHostCatalog } from '../../../src/remote/contract.js'
import type { IRemoteEndpointFactory } from '../../../src/remote/types.js'
import { nativeEndpoint } from './native-runtime.js'
import type { IProcessHandle } from '@migaia/supervision/process'
import {
  createProcessPlugin,
  type IRuntimeProcessPluginOptions
} from '../../../src/process/plugin/client.js'
import { runtimeTestHost } from '../../runtime-api/fixture.js'
import { createProcessError } from '../../../src/process/error.js'
import { RpcProcessErrorCode } from '../../../src/process/error-code.js'
import {
  readRuntimeLaunchContext,
  withRuntimeLaunchContext
} from '../../../src/remote/runtime-api/launch-context.js'

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
/** Actual child Host commit is independent of its earlier bidirectional directory response. */
const readyText = JSON.parse(
  readFileSync(new URL('./host-ready.json', import.meta.url), 'utf8')
) as { committed: string }

/** Assemble real process bindings while retaining actual handles for PID and exit assertions. */
export function nativeHostFixture(value = 'initial', maxUnits = 2) {
  const launcher = createNodeProcessLauncher()
  const handles: IProcessHandle[] = []
  const reports: unknown[] = []
  /** Each actual native launch owns one stderr readiness Promise, never a business retry. */
  const readiness = new Map<IProcessHandle, Promise<void>>()
  /** Retain the canonical two-argument factory type even though this native owner ignores signal. */
  const endpointFactory: IRemoteEndpointFactory = (channel) =>
    nativeEndpoint(channel, 'host-parent')
  /** Modern options directly retain the actual original native source and endpoint owner. */
  const options = {
    name: 'child',
    self: { name: 'host-parent', instanceId: 'host-parent' },
    report: (error) => {
      reports.push(error)
    },
    endpointFactory,
    spawn: {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token: nativeHostToken,
      offer: createNativeProcessOffer({
        peer: { id: 'host-parent', runtime: 'node' },
        auth: nativeHostToken,
        stream: true,
        capabilities: RUNTIME_API_BASE_CAPABILITIES
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
            /** Attach before launch so a fast child cannot publish before its caller subscribes. */
            let status = ''
            /** The child emits only after its real host.use transaction commits. */
            let committed!: () => void
            const ready = new Promise<void>((resolve) => {
              committed = resolve
            })
            /** The output observer must retain the exact private bootstrap from the original owner. */
            const observed = {
              ...context,
              output: (...[stream, chunk]: Parameters<typeof context.output>) => {
                context.output(stream, chunk)
                if (stream !== 'stderr') return
                status += new TextDecoder().decode(chunk)
                if (status.includes(readyText.committed)) committed()
              }
            }
            const bootstrap = readRuntimeLaunchContext(context)
            const handle = await (bootstrap
              ? withRuntimeLaunchContext(observed, bootstrap, () => launcher.launch(spec, observed))
              : launcher.launch(spec, observed))
            handles.push(handle)
            readiness.set(handle, ready)
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
  } satisfies IRuntimeProcessPluginOptions
  /** This real local Host owns the connection definition, never the remote target Host. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Factory construction remains lazy until the genuine Host installs this definition. */
  const plugin = createProcessPlugin<IRuntimeDynamicSurface>(options)
  return {
    options,
    handles,
    reports,
    host,
    plugin,
    /** Join exact native readiness or fail on its real exit; no polling or extra grace is added. */
    ready: (handle = handles.at(-1)!): Promise<void> =>
      Promise.race([
        readiness.get(handle)!,
        handle.exited.then(() => {
          throw createProcessError(RpcProcessErrorCode.channelClosed)
        })
      ]),
    close: () => host.dispose()
  }
}

/** Borrow an independent Node listener with the exact same endpoint and authenticated contract. */
export function nativeBorrowedPeer(address: string, token = nativeHostToken) {
  return createProcessPeer<IRuntimeDynamicSurface>({
    self: { name: 'host-parent', instanceId: 'host-parent' },
    report: () => undefined,
    endpointFactory: (channel) => nativeEndpoint(channel as IRemoteChannel, 'host-parent'),
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
