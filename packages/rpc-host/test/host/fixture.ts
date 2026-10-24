import { deferred } from '@migaia/utils/promise'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IUnitHandle, IUnitLauncher, IUnitProfile } from '@migaia/supervision'
import { createMemoryTransportPair, type IMemoryTransport } from '../fixtures/memory-transport.js'
import {
  createEventEmitterMessageResource,
  ownAdapterMessageClose
} from '../../dist/runtime-adapter/message/resource.js'
import {
  createAdapterDeployment,
  type IAdapterDeploymentContext,
  type IAdapterDeploymentRecipe
} from '../../dist/runtime-adapter/deployment.js'
import { defineTransportPlugin } from '../../dist/plugin/index.js'
import { createRpcHost, defaultRpcReporter } from '../../dist/index.js'
import type { IRuntimePeerSourceResult } from '../../dist/remote/runtime-api/peer.js'
import type { IRpcHost, IRpcHostOptions } from '../../dist/host/types.js'

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

/** One real listener owns its native accept callback and admitted physical context. */
class MemoryServer {
  /** Each client connection owns only its original physical opening receipt and accept join. */
  static readonly #Connection = class {
    /** The real listener remains the sole physical open and native accept owner. */
    readonly #server: MemoryServer
    /** Exact physical pair is published only by this client's actual native hook. */
    #opening: ReturnType<MemoryServer['openPhysical']> | undefined
    /** Join this same server acceptance with the concurrently opening client Host. */
    readonly #accepted = deferred<void>()
    /** Capture only the original listener; no channel or Peer is opened here. */
    constructor(server: MemoryServer) {
      this.#server = server
    }
    /** The actual installed client source alone acquires and publishes its original physical pair. */
    readonly #open = async (
      prepared: IAdapterDeploymentContext
    ): Promise<IRuntimePeerSourceResult> => {
      this.#opening = this.#server.openPhysical(prepared)
      void this.#opening.accepted.then(this.#accepted.resolve, this.#accepted.reject)
      return this.#opening.channel
    }
    /** Open both original sides concurrently and return the exact client Host and raw pair. */
    async connect(
      clientName: string,
      options: Omit<IRpcHostOptions, 'plugins' | 'self'>,
      clientId: string
    ) {
      /** This cold definition delegates only raw opening to the actual original listener. */
      const plugin = defineTransportPlugin({
        name: `${clientName}-transport`,
        mode: 'connect',
        deployment: createAdapterDeployment({ open: this.#open })
      })
      /** Native acceptance and the real client exchange progress concurrently on this same pair. */
      const opened = createRpcHost({
        ...options,
        self: { name: clientName, instanceId: clientId },
        plugins: [plugin],
        report: options.report ?? (() => undefined)
      })
      const [host] = await Promise.all([opened, this.#accepted.promise])
      return { host, pair: this.#opening!.pair }
    }
  }
  /** Deployment installation supplies the one actual native session admission callback. */
  #accept!: (channel: IRuntimePeerSourceResult) => Promise<unknown>
  /** Prepared identity and cancellation remain owned by this exact listener Host. */
  #context!: IAdapterDeploymentContext
  /** Closing only the listener prevents future physical sessions; accepted sessions stay Host-owned. */
  #closed = false
  /** Preserve the original plain fixture shape, own-method order and cold transport definition. */
  readonly value
  /** Build the original cold native listener without acquiring a channel or complete Peer. */
  constructor(name: string, instanceId: string, connectTimeoutMs?: number) {
    /** The real transport hook is the sole point that receives native context and accept authority. */
    const transport = defineTransportPlugin({
      name: `${name}-transport`,
      mode: 'listen',
      connect: connectTimeoutMs === undefined ? undefined : { timeoutMs: connectTimeoutMs },
      deployment: createAdapterDeployment({
        open: async () => {
          throw new Error('listener-only fixture')
        },
        listen: this.#listen
      })
    })
    this.value = {
      transport,
      open: this.#open,
      link: this.#link,
      options: { self: { name, instanceId }, plugins: [transport], report: () => undefined },
      connect: this.#connect
    }
  }
  /** Capture the actual native hook inputs once when the listener installation runs. */
  readonly #listen: NonNullable<IAdapterDeploymentRecipe['listen']> = async (prepared, receive) => {
    this.#context = prepared
    this.#accept = receive
    return { close: this.#closeListener }
  }
  /** Retire only future listener acquisition; native accepted sessions keep their original owners. */
  readonly #closeListener = (): void => {
    this.#closed = true
  }
  /** Pair the two existing raw resource handshakes without creating another caller or endpoint. */
  openPhysical(prepared: IAdapterDeploymentContext) {
    if (this.#closed) throw new Error('fixture listener closed')
    /** Both original memory transports retain their native send/close and probe behavior. */
    const pair = createMemoryTransportPair()
    /** Canonical qualification captures each original cold receive side independently. */
    const serverChannel = holdMemoryChannel(pair[0])
    /** The opposite canonical raw side belongs only to this connecting client. */
    const clientChannel = holdMemoryChannel(pair[1])
    /** This exact completion joins original server acceptance with the client startup. */
    const accepted = deferred<void>()
    /** Start the server handshake before its paired client handshake, as in the original fixture. */
    const serverOpening = serverChannel(prepared.self.instanceId, this.#context)
    /** Only this original physical channel is delivered to the client transport hook. */
    const channel = clientChannel(this.#context.self.instanceId, prepared)
    void serverOpening.then(this.#accept).then(() => accepted.resolve(), accepted.reject)
    return { pair, channel, accepted: accepted.promise }
  }
  /** A borrowed native opener reports rejected acceptance without replacing the original channel. */
  readonly #open = (prepared: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult> => {
    /** Original listener authority owns acquisition and its independent acceptance completion. */
    const opening = this.openPhysical(prepared)
    void opening.accepted.catch(prepared.report)
    return opening.channel
  }
  /** Join two existing listener Hosts through only their original raw open and accept operations. */
  readonly #link = async (remote: {
    open(prepared: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult>
  }): Promise<void> => {
    /** Remote acquisition owns physical negotiation before this listener accepts that same result. */
    const channel = await remote.open(this.#context)
    await this.#accept(channel)
  }
  /**
   * Every connecting client gets its own original physical receipt and no shared mutable factory
   * locals.
   */
  readonly #connect = (
    clientName: string,
    options: Omit<IRpcHostOptions, 'plugins' | 'self'> = {},
    clientId = clientName
  ) => new MemoryServer.#Connection(this).connect(clientName, options, clientId)
}

/** Construct the original listener fixture surface while keeping its actual state on one owner. */
export function memoryServer(name: string, instanceId = name, connectTimeoutMs?: number) {
  return new MemoryServer(name, instanceId, connectTimeoutMs).value
}

/**
 * Pair current public hosts through the existing raw listener fixture, with no private Peer
 * assembly.
 */
export async function connectedHosts<A = unknown, B = unknown>(options: {
  a: Omit<IRpcHostOptions, 'plugins'>
  b: Omit<IRpcHostOptions, 'plugins'>
}): Promise<{ a: IRpcHost<B>; b: IRpcHost<A> }> {
  /** The server keeps the same listener/physical-session owner used by the facade tests. */
  const source = memoryServer(options.b.self?.name ?? 'b', options.b.self?.instanceId ?? 'b')
  /** Only the public entry creates the server's one endpoint and native Host lifetime. */
  const b = await createRpcHost({ ...source.options, ...options.b })
  try {
    const { host: a } = await source.connect(
      options.a.self?.name ?? 'a',
      options.a,
      options.a.self?.instanceId ?? 'a'
    )
    return { a: a as unknown as IRpcHost<B>, b: b as unknown as IRpcHost<A> }
  } catch (primary) {
    try {
      await b.close()
    } catch (cleanup) {
      ;(options.b.report ?? defaultRpcReporter)(cleanup)
    }
    throw primary
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
