import { deferred } from '@migaia/utils/promise'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IUnitHandle, IUnitLauncher, IUnitProfile } from '@migaia/supervision'
import {
  createMemoryTransportPair,
  type IMemoryTransport
} from '../../dist/core/adapters/memory.js'
import {
  createEventEmitterMessageResource,
  ownAdapterMessageClose
} from '../../dist/runtime-adapter/message/resource.js'
import {
  createAdapterDeployment,
  type IAdapterDeploymentContext
} from '../../dist/runtime-adapter/deployment.js'
import { defineTransportPlugin } from '../../dist/plugin/index.js'
import { createRpcHost } from '../../dist/index.js'
import type { IRuntimePeerSourceResult } from '../../dist/remote/runtime-api/peer.js'
import type { IRpcHostOptions } from '../../dist/host/types.js'

/** Wrap the actual memory adapter as raw native-style messaging for canonical resource admission. */
export function holdMemoryChannel(transport: IMemoryTransport) {
  /** Raw listener receipts preserve exact callback removal and native memory error identity. */
  const removals = new Map<Function, () => void>()
  /** The resource performs its ordinary private qualification and cold receive capture. */
  const resource = createEventEmitterMessageResource({
    postMessage: (message, transfer) => transport.send(message, { transfer }),
    on(event, listener) {
      if (event === 'message')
        removals.set(
          listener,
          transport.subscribe((frame) => listener(frame.data))
        )
      else if (event === 'messageerror')
        removals.set(listener, transport.onTransportError!(listener))
    },
    off(_event, listener) {
      removals.get(listener)?.()
      removals.delete(listener)
    }
  })
  ownAdapterMessageClose(resource, { close: () => transport.close() })
  return (peerId: string, context: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult> =>
    resource.open({
      peerId,
      scheduler: systemScheduler,
      offer: context.capabilities,
      control: rpcMessageCapabilityControl,
      signal: context.signal,
      timeoutMs: context.connectTimeoutMs
    })
}

/** The listener retains its actual native accept callback, never an alternate peer/endpoint list. */
export function memoryServer(name: string, instanceId = name, connectTimeoutMs?: number) {
  /** Deployment installation publishes the listener operation only when the real hook runs. */
  let accept!: (channel: IRuntimePeerSourceResult) => Promise<unknown>
  /** Actual prepared identity comes from the new host, independently of its registration name. */
  let context!: IAdapterDeploymentContext
  /** Closing the listener prevents future physical sessions; held sessions stay host-owned. */
  let closed = false
  /** A listen deployment is cold and does not create an endpoint or complete peer. */
  const transport = defineTransportPlugin({
    name: `${name}-transport`,
    mode: 'listen',
    connect: connectTimeoutMs === undefined ? undefined : { timeoutMs: connectTimeoutMs },
    deployment: createAdapterDeployment({
      open: async () => {
        throw new Error('listener-only fixture')
      },
      listen: async (prepared, receive) => {
        context = prepared
        accept = receive
        return {
          close: () => {
            closed = true
          }
        }
      }
    })
  })
  /** A real native source pairs both existing resource handshakes without creating another caller. */
  const openPhysical = (prepared: IAdapterDeploymentContext) => {
    if (closed) throw new Error('fixture listener closed')
    const pair = createMemoryTransportPair()
    const serverChannel = holdMemoryChannel(pair[0])
    const clientChannel = holdMemoryChannel(pair[1])
    const accepted = deferred<void>()
    const serverOpening = serverChannel(prepared.self.instanceId, context)
    const channel = clientChannel(context.self.instanceId, prepared)
    void serverOpening.then(accept).then(() => accepted.resolve(), accepted.reject)
    return { pair, channel, accepted: accepted.promise }
  }
  return {
    transport,
    open(prepared: IAdapterDeploymentContext) {
      const opening = openPhysical(prepared)
      void opening.accepted.catch(prepared.report)
      return opening.channel
    },
    /** Join two existing listener hosts through their original raw channel and accept operations. */
    async link(remote: {
      open(prepared: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult>
    }): Promise<void> {
      /**
       * The remote opener owns physical negotiation; this listener admits the same resulting
       * source.
       */
      const channel = await remote.open(context)
      await accept(channel)
    },
    options: { self: { name, instanceId }, plugins: [transport], report: () => undefined },
    async connect(
      clientName: string,
      options: Omit<IRpcHostOptions, 'plugins' | 'self'> = {},
      clientId = clientName
    ) {
      /** Actual raw acquisition happens only in the installed transport hook. */
      let opening!: ReturnType<typeof openPhysical>
      const accepted = deferred<void>()
      /** The client's exact plugin definition delegates only raw channel opening. */
      const plugin = defineTransportPlugin({
        name: `${clientName}-transport`,
        mode: 'connect',
        deployment: createAdapterDeployment({
          open: async (prepared) => {
            opening = openPhysical(prepared)
            void opening.accepted.then(accepted.resolve, accepted.reject)
            return opening.channel
          }
        })
      })
      /** Native acceptance and the client exchange must progress concurrently on the same pair. */
      const opened = createRpcHost({
        ...options,
        self: { name: clientName, instanceId: clientId },
        plugins: [plugin],
        report: options.report ?? (() => undefined)
      })
      const [host] = await Promise.all([opened, accepted.promise])
      return { host, pair: opening.pair }
    }
  }
}

/** Original native-like unit exit facts remain inputs to the real supervisor. */
export type IManagedMemoryExit = Readonly<{ error?: unknown }>

/** One launched unit holds its real server Host and raw channel opener until actual termination. */
export type IManagedMemoryUnit = IUnitHandle<IManagedMemoryExit> &
  Readonly<{
    remote: Awaited<ReturnType<typeof createRpcHost>>
    source: ReturnType<typeof memoryServer>
    exit(value: IManagedMemoryExit): void
    finish(): void
  }>

/** Share the existing A12 raw-memory unit launcher without creating another supervisor owner. */
export function managedMemoryUnits(
  options: Readonly<{
    kind: string
    provide(ordinal: number, finished: Promise<void>): IRpcHostOptions['provide']
    contract?: IRpcHostOptions['contract']
    beforeLaunch?(ordinal: number): void | Promise<void>
  }>
) {
  /** Every launch retains its exact original unit so tests can observe real exit and cleanup. */
  const units: IManagedMemoryUnit[] = []
  /** Launching creates only the remote server; local channel admission stays deployment-owned. */
  const launcher: IUnitLauncher<string, IManagedMemoryUnit> = {
    capabilities: { termination: 'enforced', 'fault-isolation': 'enforced' },
    async launch() {
      /** Admission order gives each actual launch an independently observable identity. */
      const ordinal = units.length + 1
      await options.beforeLaunch?.(ordinal)
      /** The original listener creates raw physical channels only when the managed binding opens. */
      const source = memoryServer('remote', `remote-${ordinal}`)
      /** A true unit exit settles only after physical remote cleanup. */
      const exited = deferred<IManagedMemoryExit>()
      /** Existing pending provider work can finish when the native unit terminates. */
      const finish = deferred<void>()
      /**
       * Each native-like unit is its own real server Host, independent of the local managed
       * projection.
       */
      const remote = await createRpcHost({
        ...source.options,
        provide: options.provide(ordinal, finish.promise),
        contract: options.contract
      })
      /** Supervisor identity, exit and termination hooks retain the original launched resource. */
      const unit: IManagedMemoryUnit = {
        identity: { fingerprint: `${options.kind}-${ordinal}` },
        exited: exited.promise,
        exit: exited.resolve,
        finish: finish.resolve,
        source,
        remote
      }
      units.push(unit)
      return unit
    }
  }
  /** The existing supervisor releases leases only after this real server close settles its exit. */
  const profile: IUnitProfile<string, IManagedMemoryUnit, IManagedMemoryExit> = {
    kind: options.kind,
    gracefulTermination: false,
    requirements: () => ['termination'],
    validateSpec: () => undefined,
    terminate: (unit) => {
      unit.finish()
      void unit.remote.close().then(
        () => unit.exit({}),
        (error) => unit.exit({ error })
      )
    },
    classifyExit: (value) =>
      value.error === undefined ? { reason: 'exited' } : { reason: 'crashed', cause: value.error }
  }
  return { units, launcher, profile }
}
