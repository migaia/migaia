import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createNodeProcessLauncher } from '../../../src/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../../src/process/offer.js'
import { createProcessHost } from '../../../src/process/host/client.js'
import type { IProcessHostOptions } from '../../../src/process/host/types.js'
import type { IRemoteHostCatalog } from '../../../src/remote/contract.js'
import { nativeEndpoint } from './native-runtime.js'
import type { IProcessHandle } from '@migaia/supervision/process'

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

/** Borrow an independent Node listener with the exact same endpoint and authenticated contract. */
export function nativeBorrowedHost(address: string, token = nativeHostToken) {
  return createProcessHost({
    catalog: nativeHostCatalog,
    report: () => undefined,
    endpointFactory: (channel) => nativeEndpoint(channel, 'host-parent'),
    deployment: {
      kind: 'connect',
      address,
      token,
      dial: (target, signal) =>
        dialProcessByteChannel({ address: target, signal: signal as AbortSignal }),
      offer: createNativeProcessOffer({
        peer: { id: 'host-parent', runtime: 'node' },
        auth: token,
        stream: true
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
