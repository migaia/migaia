import { vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { CapabilityLevel, StandardCapability, createUnitBudget } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { ProcessCapability, type IProcessHandle } from '@migaia/supervision/process'
import { processPlugin } from '@migaia/rpc-plugin-process'
import type { ISpawnProcessPluginDeployment } from '../../../../rpc-plugin-process/dist/process/plugin/types.js'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IRuntimeOutlet } from '../../../../rpc-host/dist/remote/runtime-api/outlet.js'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import type { IProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/types.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../../rpc-host/dist/remote/runtime-api/constants.js'
import { nativeBytePair } from './native-runtime.js'
import { observeNativeEndpoints, type IEndpointObservation } from './host-native.js'

/** One original fixture contract describes the actual locally registered business method. */
export const catalog = {
  p: {
    schemaVersion: 1,
    plugin: 'p',
    features: { f: { methods: { m: { mode: 'request', idempotent: false } } } }
  }
} as const
/** The neutral launcher retains the original isolation, termination, and stdin bootstrap guarantees. */
const capabilities = {
  [StandardCapability.termination]: CapabilityLevel.enforced,
  [StandardCapability.faultIsolation]: CapabilityLevel.enforced,
  [ProcessCapability.bootstrapStdin]: CapabilityLevel.enforced
}
/** Genuine native installation publishes the process outlet on the same ordinary Host. */
type IControlHost = PluginHost<Record<string, never>> & { readonly process?: IRuntimeOutlet }

/** Own neutral OS handles while real byte channels and canonical Peers carry every RPC frame. */
class ControlHostFixture {
  /** Supervisor transitions keep the original unadvanced deterministic clock. */
  readonly scheduler = createManualScheduler()
  /** Reports retain original failure objects for terminal and cleanup classification. */
  readonly report = vi.fn()
  /** Actual per-launch identity and exit promises remain separate across replacement. */
  readonly handles: IProcessHandle[] = []
  /** A test may settle real supervisor exit promises without faking channel events. */
  readonly crashes: ((status: { code: number; signal: null }) => void)[] = []
  /** Record every native termination without owning any exit Promise. */
  readonly terminate = vi.fn((_mode: string) => undefined)
  /** Publication assertions distinguish launcher entry from physical exit. */
  readonly order: string[] = []
  /** Each synthetic OS handle owns a distinct pair of actual byte ports. */
  readonly #ports = new WeakMap<
    IProcessHandle,
    readonly [IProcessByteChannel, IProcessByteChannel]
  >()
  /** The opposite raw end is consumed only by the real child handshake. */
  readonly #opposites = new WeakMap<IProcessByteChannel, IProcessByteChannel>()
  /** The test owns every actual in-process child Peer until cleanup. */
  readonly #children = new Set<Promise<IRuntimePeer>>()
  /** Extra case observation composes before native drain takes endpoint ownership. */
  #observation: IEndpointObservation | undefined
  /** The original module spy is removed when this fixture retires. */
  readonly #removeObservation: () => void
  /** Close callers share the complete Host plus actual child-resource retirement. */
  #closing: Promise<void> | undefined
  /** Every ordinary native install/replacement uses this one actual PluginHost. */
  readonly host = new PluginHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  }) as IControlHost
  /** A test may delay or reject a genuine scalar dispatch before forwarding it once. */
  readonly send = vi.fn(
    (
      _peer: string,
      _method: string,
      _payload: unknown,
      _options: unknown,
      forward: () => Promise<unknown>
    ) => forward()
  )
  /** Fake process launch still produces the original independently settleable exit promise. */
  readonly launch = vi.fn(async () => {
    /** Only this handle's exit resolver can complete its native supervision state. */
    let exit!: (value: { code: number; signal: null }) => void
    /** Stable monotonic fixture identity distinguishes every candidate generation. */
    const id = this.handles.length + 1
    /** Native channel resources remain genuine even though the OS process handle is controlled. */
    const ports = nativeBytePair()
    /** Process supervisor sees the same independent handle fields and terminate behavior. */
    const handle: IProcessHandle = {
      identity: { fingerprint: `owned-host-${id}` },
      exited: new Promise((resolve) => {
        exit = resolve
      }),
      terminate: (mode) => {
        this.terminate(mode)
        this.order.push(`exit:${id}`)
        exit({ code: 0, signal: null })
      }
    }
    this.crashes.push(exit)
    this.handles.push(handle)
    this.#ports.set(handle, ports)
    this.#opposites.set(ports[0], ports[1])
    this.order.push(`launch:${id}`)
    return handle
  })
  /** Existing lower-owner cases retain their actual full spawn deployment. */
  readonly options
  /** Native registration input is separate from lower binding construction input. */
  readonly runtimeOptions
  /** Cold reusable native definition remains unstarted until Host.use. */
  readonly plugin
  /** Initialize source policy and the existing prepared-resource observation seam. */
  constructor() {
    /** Actual native handshake roots advertise the same runtime capability family. */
    const offer = createNativeProcessOffer({
      peer: { id: 'parent', runtime: 'node' },
      stream: true,
      capabilities: RUNTIME_API_BASE_CAPABILITIES
    })
    /** No RPC endpoint or remote Host facade is supplied to this physical source. */
    const deployment: ISpawnProcessPluginDeployment = {
      kind: 'spawn',
      channelKind: 'byte',
      wire: 'native',
      token: 'neutral-native-token',
      offer,
      rawChannel: async (handle) => this.#ports.get(handle)![0],
      establish: this.#establish,
      supervision: {
        id: 'host-fixture',
        spec: {
          command: 'fixture',
          args: [],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'channel', stdout: 'ignore', stderr: 'ignore' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode('neutral-native-token') }
        },
        launcher: { capabilities, launch: this.launch },
        budget: createUnitBudget({ kind: 'process', maxUnits: 2, scheduler: this.scheduler }),
        scheduler: this.scheduler,
        report: this.report,
        health: { check: async () => undefined }
      }
    }
    this.options = { catalog, report: this.report, deployment }
    this.runtimeOptions = {
      name: 'child',
      self: { name: 'parent', instanceId: 'parent' },
      spawn: deployment,
      report: this.report
    }
    this.plugin = processPlugin(this.runtimeOptions)
    this.#removeObservation = observeNativeEndpoints('parent', this.#observe)
  }
  /** Delay or inspect genuine endpoint operations while retaining the original preparation owner. */
  observeEndpoint(observer: IEndpointObservation): void {
    this.#observation = observer
  }
  /** Record scalar dispatch on the exact native prepared session rather than a fake port. */
  #observe: IEndpointObservation = (served, ...args) => {
    /** The observed view retains native close/drain policy and the same underlying real kernel. */
    const observed: IRemoteServeEndpoint = {
      ...served,
      endpoint: Object.create(
        served.endpoint,
        Object.getOwnPropertyDescriptors({
          send: <T>(...input: Parameters<typeof served.endpoint.send>) =>
            this.send(...input, () => served.endpoint.send<T>(...input)) as Promise<T>
        })
      )
    }
    return this.#observation?.(observed, ...args) ?? observed
  }
  /** Borrow one real byte connection without granting process execution authority. */
  connectSource() {
    /** The same physical pair and handshake oracle serves this borrowed profile. */
    const ports = nativeBytePair()
    this.#opposites.set(ports[0], ports[1])
    return {
      kind: 'connect' as const,
      address: 'neutral-native-connection',
      token: 'neutral-native-token',
      dial: vi.fn(async () => ports[0]),
      offer: createNativeProcessOffer({
        peer: { id: 'parent', runtime: 'node' },
        stream: true,
        capabilities: RUNTIME_API_BASE_CAPABILITIES
      }),
      establish: this.#establish
    }
  }
  /** Run both original byte handshakes, then serve genuine local business through an actual Peer. */
  #establish: ISpawnProcessPluginDeployment['establish'] = async (raw, context) => {
    if (raw.kind !== 'byte') throw new Error('control fixture requires bytes')
    /** Parent and child use separate actual byte readers and independently negotiated transports. */
    const childRaw = this.#opposites.get(raw)!
    /** Real child preparation starts concurrently with parent acceptance, as a native process does. */
    const child = createProcessTransport(childRaw, {
      role: 'responder',
      auth: { mode: 'none' },
      offer: createNativeProcessOffer({
        peer: { id: 'peer', runtime: 'node' },
        stream: true,
        capabilities: RUNTIME_API_BASE_CAPABILITIES
      }),
      peerId: context.offer!.peer.id,
      scheduler: this.scheduler,
      ipc: {
        connectionId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        log: () => undefined
      },
      report: this.report
    }).then((channel) =>
      createRuntimePeer(
        {
          self: { name: 'peer', instanceId: 'peer' },
          provide: { p: { f: { m: () => ({ ok: true }) } } },
          contract: catalog.p,
          report: this.report
        },
        { channel }
      )
    )
    this.#children.add(child)
    void child.catch(this.report)
    return createProcessTransport(raw, {
      role: 'initiator',
      offer: context.offer!,
      peerId: 'peer',
      scheduler: context.scheduler,
      signal: context.signal as AbortSignal,
      ipc: { ...context.session, log: () => undefined },
      report: this.report
    })
  }
  /** Join every original owned resource once; repeated cleanup shares the exact same Promise. */
  close = (): Promise<void> =>
    (this.#closing ??= (async () => {
      this.#removeObservation()
      await this.host.dispose()
      /** Failed startup already cleaned its native resources and was reported at creation. */
      const children = await Promise.allSettled(this.#children)
      await Promise.all(
        children.flatMap((child) => (child.status === 'fulfilled' ? [child.value.close()] : []))
      )
    })())
}

/** Admission and shutdown retain controlled OS exits over real canonical native RPC channels. */
export function hostFixture() {
  return new ControlHostFixture()
}
/** The same source fixture installs directly into a genuine ordinary native Host. */
export function runtimeHostFixture() {
  /** Existing callers consume native install options rather than the lower binding policy bag. */
  const fixture = new ControlHostFixture()
  return {
    get options() {
      return fixture.runtimeOptions
    },
    get host() {
      return fixture.host
    },
    get plugin() {
      return fixture.plugin
    },
    get launch() {
      return fixture.launch
    },
    get terminate() {
      return fixture.terminate
    },
    get send() {
      return fixture.send
    },
    get scheduler() {
      return fixture.scheduler
    },
    get report() {
      return fixture.report
    },
    get handles() {
      return fixture.handles
    },
    get order() {
      return fixture.order
    },
    get crashes() {
      return fixture.crashes
    },
    observeEndpoint: (observer: IEndpointObservation) => fixture.observeEndpoint(observer),
    close: fixture.close
  }
}
