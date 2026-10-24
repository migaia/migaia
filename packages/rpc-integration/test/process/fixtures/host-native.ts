import { vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IProcessHandle } from '@migaia/supervision/process'
import { processPlugin } from '@migaia/rpc-plugin-process'
import type { IProcessPluginOptions } from '../../../../rpc-plugin-process/dist/process/plugin.js'
import { createNodeProcessLauncher } from '../../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { dialProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../../rpc-host/dist/remote/runtime-api/constants.js'
import {
  readRuntimeOutletConnection,
  type IRuntimeOutlet
} from '../../../../rpc-host/dist/remote/runtime-api/outlet.js'
import * as runtimePeerModule from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createProcessError } from '../../../../rpc-plugin-process/dist/process/error.js'
import { RpcProcessErrorCode } from '@migaia/rpc-plugin-process'
import {
  readRuntimeLaunchContext,
  withRuntimeLaunchContext
} from '../../../../rpc-host/dist/remote/runtime-api/launch-context.js'

/** One fixture contract remains input to retained foreign/registration schema assertions. */
export const nativeHostCatalog = JSON.parse(
  readFileSync(
    new URL(
      '../../../../rpc-plugin-process/test/process/fixtures/host-catalog.json',
      import.meta.url
    ),
    'utf8'
  )
)
/** Actual child code is shared by native stdio, borrowed Unix and reverse registration cases. */
export const nativeHostChildPath = fileURLToPath(
  new URL('./node-process-host.mjs', import.meta.url)
)
/** Private bootstrap input never enters reported process descriptors. */
export const nativeHostToken = 'host-fixture-secret'
/** Native Host commit is observed independently of its earlier directory response. */
const readyText = JSON.parse(
  readFileSync(
    new URL(
      '../../../../rpc-plugin-process/test/process/fixtures/host-ready.json',
      import.meta.url
    ),
    'utf8'
  )
) as { committed: string }
/** Keep the real constructor before any per-case spy observes its existing preparation seam. */
const createPeer = runtimePeerModule.createRuntimePeer
/** Test observations compose on the genuine kernel before native drain takes ownership. */
export type IEndpointObservation = (
  served: IRemoteServeEndpoint,
  channel: NonNullable<NonNullable<Parameters<typeof createPeer>[1]>['channel']>,
  signal: IAbortSignal
) => IRemoteServeEndpoint
/** Native installation adds the original process outlet to the same PluginHost instance. */
type INativeHost = PluginHost<Record<string, never>> & { readonly process?: IRuntimeOutlet }

/** Observe the existing prepared-resource hook without replacing native endpoint construction. */
export function observeNativeEndpoints(self: string, observer: IEndpointObservation): () => void {
  /** The original Peer receives every genuine resource and keeps its exact preparation Promise. */
  const spy = vi
    .spyOn(runtimePeerModule, 'createRuntimePeer')
    .mockImplementation((options, resources) => {
      if (options.self?.instanceId !== self || !resources?.channel || !resources.wrapEndpoint)
        return createPeer(options, resources)
      /**
       * Observe the genuine prepared kernel before native drain wraps it, matching the original
       * endpoint factory seam.
       */
      const prepare = resources.wrapEndpoint
      /** Actual channel and cancellation come from the existing Core preparation call. */
      const channel = resources.channel
      return createPeer(options, {
        ...resources,
        wrapEndpoint: (served) => prepare(observer(served, channel, resources.signal!))
      })
    })
  return () => spy.mockRestore()
}

/** Own actual native launch handles, stderr readiness and a genuine ordinary Host registration. */
class NativeHostFixture {
  /** Every launch contributes its exact OS identity and exit Promise to the assertions. */
  readonly handles: IProcessHandle[] = []
  /** Canonical process failures remain available without exposing private bootstrap values. */
  readonly reports: unknown[] = []
  /** Each physical launch owns its own commit barrier. */
  readonly #readiness = new Map<IProcessHandle, Promise<void>>()
  /** The underlying launcher retains original capability and bootstrap semantics. */
  readonly #launcher = createNodeProcessLauncher()
  /** Test endpoint observation is removed before this Host's final teardown. */
  #removeObservation: (() => void) | undefined
  /** The ordinary native Host owns installation, replacement and cleanup. */
  readonly host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  }) as INativeHost
  /** Full native source options remain cold until the actual Host installs them. */
  readonly options
  /** The same native definition is available for cases without altered deployment policy. */
  readonly plugin
  /** Build ordinary policy and raw source inputs without constructing a sibling Peer. */
  constructor(value: string, maxUnits: number) {
    this.options = {
      name: 'child',
      self: { name: 'host-parent', instanceId: 'host-parent' },
      report: this.#report,
      spawn: this.#spawn(value, maxUnits)
    } satisfies IProcessPluginOptions
    this.plugin = processPlugin(this.options)
  }
  /** Reuse the real prepared-resource seam for per-case scalar/drain observations. */
  observeEndpoint(observer: IEndpointObservation): void {
    this.#removeObservation?.()
    this.#removeObservation = observeNativeEndpoints('host-parent', observer)
  }
  /** Error collection does not change production error identity or settlement. */
  #report = (error: unknown): void => {
    this.reports.push(error)
  }
  /** Retain original native handshake, session labels and caller's scheduling policy. */
  #spawn(value: string, maxUnits: number) {
    return {
      kind: 'spawn' as const,
      channelKind: 'byte' as const,
      wire: 'native' as const,
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
        isolation: 'best-effort' as const,
        report: this.#report,
        budget: createUnitBudget({ kind: 'process', maxUnits, scheduler: systemScheduler }),
        spec: {
          command: process.execPath,
          args: [nativeHostChildPath],
          env: { inherit: [], set: { RPC_VALUE: value } },
          stdio: {
            stdin: 'channel' as const,
            stdout: 'channel' as const,
            stderr: 'drain' as const
          },
          bootstrap: { via: 'stdin' as const, payload: new TextEncoder().encode(nativeHostToken) }
        },
        launcher: { ...this.#launcher, launch: this.#launch }
      },
      rawChannel: async (handle: IProcessHandle) => {
        if (!('channel' in handle)) throw new Error('native fixture lacks channel')
        return handle.channel as NonNullable<
          Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>['channel']
        >
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
          report: this.#report
        })
      }
    } satisfies NonNullable<IProcessPluginOptions['spawn']>
  }
  /** Attach stderr before launching so a fast child cannot outrun its actual commit observer. */
  #launch: ReturnType<typeof createNodeProcessLauncher>['launch'] = async (spec, context) => {
    /** Bound marker suffix avoids rescanning an ever-growing stderr transcript. */
    let suffix = ''
    /** Native commit resolves once; the real exited Promise supplies the failure alternative. */
    let committed!: () => void
    /** This barrier belongs only to the exact returned handle. */
    const ready = new Promise<void>((resolve) => {
      committed = resolve
    })
    /** Output forwarding retains the canonical launcher's private bootstrap context. */
    const observed = {
      ...context,
      output: (...[stream, chunk]: Parameters<typeof context.output>) => {
        context.output(stream, chunk)
        if (stream !== 'stderr') return
        /** Only the marker boundary spans successive physical output chunks. */
        const pending = suffix + new TextDecoder().decode(chunk)
        if (pending.includes(readyText.committed)) committed()
        suffix = pending.slice(-readyText.committed.length)
      }
    }
    /** This opaque launch context remains the sole bootstrap authority. */
    const bootstrap = readRuntimeLaunchContext(context)

    /** The OS handle and its exact exit Promise remain unwrapped. */
    const handle = await (bootstrap
      ? withRuntimeLaunchContext(observed, bootstrap, () => this.#launcher.launch(spec, observed))
      : this.#launcher.launch(spec, observed))
    this.handles.push(handle)
    this.#readiness.set(handle, ready)
    return handle
  }
  /** Join actual child commit or reject on its real exit, without a business retry. */
  ready = (handle = this.handles.at(-1)!): Promise<void> =>
    Promise.race([
      this.#readiness.get(handle)!,
      handle.exited.then(() => {
        throw createProcessError(RpcProcessErrorCode.channelClosed)
      })
    ])
  /** Return the actual Host's stable disposal Promise on repeated close. */
  close = () => {
    this.#removeObservation?.()
    this.#removeObservation = undefined
    return this.host.dispose()
  }
}

/** Assemble real process bindings while retaining actual handles for PID and exit assertions. */
export function nativeHostFixture(value = 'initial', maxUnits = 2) {
  return new NativeHostFixture(value, maxUnits)
}

/** Open an independent borrowed native connection and expose its actual committed Peer resource. */
export async function nativeBorrowedPeer(address: string, token = nativeHostToken) {
  /** The native Host, rather than a copied Peer facade, owns this borrowed installation. */
  const host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  }) as INativeHost
  try {
    /** Independent borrowed clients keep distinct physical and directory identities on one listener. */
    const instanceId = crypto.randomUUID()
    /** The offer and runtime directory describe this same client, rather than a shared placeholder. */
    const self = { name: `host-parent-${instanceId}`, instanceId }
    /** Existing native dial/handshake owns this connection without a process launcher. */
    const target = {
      kind: 'connect' as const,
      address,
      token,
      dial: (target: string, signal: IAbortSignal) =>
        dialProcessByteChannel({ address: target, signal: signal as AbortSignal }),
      offer: createNativeProcessOffer({
        peer: { id: self.instanceId, runtime: 'node' },
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
    } satisfies import('../../../../rpc-plugin-process/dist/process/plugin/types.js').IConnectProcessPluginDeployment
    await host.use(
      processPlugin({
        name: 'borrowed',
        self,
        report: () => undefined,
        connect: { target }
      })
    )
    /** All business and unit facts come from this exact committed native Peer. */
    const peer = readRuntimeOutletConnection(host.process!, 'borrowed')!.peer
    return Object.freeze({ peer, close: () => host.dispose() })
  } catch (error) {
    await host.dispose()
    throw error
  }
}
