import { RpcRuntimeGenerationKind } from '@migaia/rpc-contract/framing/v1'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { ISupervisor, ISupervisorEvent } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcEndpoint } from '../../dist/core/typing.js'
import type { IRpcTransport } from '../../dist/core/transport.js'
import { describeRemoteMethods } from '../../dist/remote/serve-methods.js'
import {
  createRemoteRuntimeRegistration,
  type IRemoteRuntimeRegistrationOptions
} from '../../dist/remote/proxy.js'
import { createRuntimePeer, readRuntimePeerEndpoint } from '../../dist/remote/runtime-api/peer.js'
import type { IRemoteContract } from '../../dist/remote/contract.js'
import type { IRemoteServeEndpoint } from '../../dist/remote/types.js'

/** One contract exercises each declared invocation mode. */
export const REMOTE_FIXTURE_CONTRACT: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: true },
        oneWay: { mode: 'one-way', idempotent: false },
        generator: { mode: 'generator', idempotent: false },
        asyncGenerator: { mode: 'async-generator', idempotent: false }
      }
    }
  }
}

/** Mock directories use the same installed route declarations as genuine legacy service assembly. */
export function remoteDescription(
  contracts: readonly IRemoteContract[] = [REMOTE_FIXTURE_CONTRACT],
  peerId = 'peer',
  host = false
) {
  return describeRemoteMethods(
    contracts,
    { name: host ? peerId : contracts[0]!.plugin, instanceId: peerId },
    host
  )
}

/** One neutral unit port fixture owns observable supervisor, channel and request state. */
class RemotePortHarness {
  /** All native and logical operations retain the same original manually driven clock. */
  readonly scheduler = createManualScheduler()
  /** Supervisor observers receive the original event synchronously in insertion order. */
  #listeners = new Set<(event: ISupervisorEvent<string>) => void>()
  /** Only the case's explicit generation transition advances this unit identity. */
  #generation = 1
  /** Preparation changes the same current supervisor phase observed by consumers. */
  #state: 'idle' | 'ready' = 'idle'
  /** These original call records prove acquisition and disposer order. */
  readonly calls: string[] = []
  /** Scalar records preserve the exact caller payload/options references. */
  readonly sends: { method: string; params: unknown; options: unknown }[] = []
  /** Original setup disposers remain callable and observable by their owning case. */
  readonly owned: (() => Promise<void>)[] = []
  /** This is the original borrowed supervisor projection, not another supervision implementation. */
  readonly supervisor: ISupervisor<string, unknown>
  /** Channel declarations preserve the original malformed/clock-mismatch fixture inputs. */
  readonly channel
  /** Endpoint hooks are the neutral test seam used by both actual registration owners. */
  readonly served: IRemoteServeEndpoint
  /** Binding ownership and raw acquisition remain independent from the registration under test. */
  readonly binding

  /** Create neutral ports in original order without starting a supervisor or opening a channel. */
  constructor(mismatchScheduler: boolean) {
    this.supervisor = Object.defineProperties(
      {
        state: undefined,
        generation: undefined,
        start: this.#start,
        whenReady: this.#whenReady,
        inspect: () => ({
          kind: 'fixture',
          state: this.#state,
          generation: this.#generation,
          failuresInWindow: 0,
          terminalEntries: 0,
          degraded: [],
          abandoned: 0
        }),
        subscribe: (listener: (event: ISupervisorEvent<string>) => void) => {
          this.#listeners.add(listener)
          return () => {
            this.#listeners.delete(listener)
          }
        },
        dispose: async () => {
          this.calls.push('supervisor.dispose')
        }
      },
      {
        state: { enumerable: true, configurable: true, get: () => this.#state },
        generation: { enumerable: true, configurable: true, get: () => this.#generation }
      }
    ) as unknown as ISupervisor<string, unknown>
    this.channel = {
      transport: {} as IRpcTransport,
      peerId: 'peer',
      scheduler: mismatchScheduler ? createManualScheduler() : this.scheduler,
      agreement: {
        source: 'static' as const,
        codec: 'identity',
        capabilities: ['runtime-api@1', 'batch@1', 'stream@1']
      },
      pipeline: { codec: {} as never, framer: {} as never },
      features: [],
      close: async () => {
        this.calls.push('channel.close')
      }
    }
    /** The canonical provider assembly may register its reserved methods on this neutral endpoint. */
    const endpoint = {
      provide: () => () => undefined,
      /** Record physical notify on the real endpoint port used by the canonical binding caller. */
      sendOneWay: async () => {
        this.calls.push('oneWay.send')
      },
      send: this.#send,
      dispose: async () => {
        this.calls.push('endpoint.dispose')
      }
    } as unknown as IRpcEndpoint
    this.served = {
      endpoint,
      oneWay: {
        sendOneWay: async () => {
          this.calls.push('oneWay.send')
        }
      },
      stream: {
        open: () => this.#stream(),
        provide: () => () => undefined,
        dispose: async () => {
          this.calls.push('stream.dispose')
        }
      }
    }
    this.binding = {
      ownership: 'borrowed' as const,
      supervisor: this.supervisor,
      scheduler: this.scheduler,
      openChannel: async () => {
        this.calls.push('channel.open')
        return this.channel
      }
    }
  }

  /** Prepare the actual callable owner over these original neutral endpoint and channel seams. */
  prepareRuntime: IRemoteRuntimeRegistrationOptions<string, unknown>['prepareRuntime'] = (
    channel,
    signal,
    sessionGeneration
  ) =>
    createRuntimePeer(
      {
        self: { name: 'fixture-client', instanceId: 'fixture-client' },
        endpointFactory: async () => {
          this.calls.push('endpoint.create')
          return this.served
        },
        report: (error) => {
          this.calls.push(`report:${String(error)}`)
        }
      },
      {
        channel: Object.fromEntries(
          Object.entries(channel).filter(([key]) => key !== 'close')
        ) as Omit<typeof channel, 'close'>,
        signal,
        generation: {
          kind: RpcRuntimeGenerationKind.session,
          value: sessionGeneration,
          providerId: 'fixture-client'
        }
      }
    )

  /** Native start publishes readiness before returning the original current unit/generation. */
  #start = async () => {
    this.#state = 'ready'
    return { state: 'ready' as const, generation: this.#generation, unit: 'unit' }
  }

  /** Readiness borrowing does not start another unit or mutate supervisor state. */
  #whenReady = async (_signal?: IAbortSignal) => ({
    state: 'ready' as const,
    generation: this.#generation,
    unit: 'unit'
  })

  /** Retain exact request records and the existing canonical directory fixture response. */
  #send = async (_peer: string, method: string, params: unknown, options: unknown) => {
    this.sends.push({ method, params, options })
    return method === 'migaia.remote.runtime.describe' ? remoteDescription() : 'result'
  }

  /** The original stream produces its one item lazily and records only actual iteration. */
  async *#stream(): AsyncIterableIterator<IRpcPortableValue> {
    this.calls.push('stream.open')
    yield 'item'
  }

  /** Preserve the old setup disposer receipt without introducing cleanup or wrapping its Promise. */
  own = (dispose: () => Promise<void>) => {
    this.owned.push(dispose)
  }

  /** The test alone advances supervisor generation; actual registration decides when to rebind. */
  nextGeneration = () => {
    this.#generation += 1
  }

  /** Deliver the original supervisor event to its current subscribers, preserving plain receivers. */
  emit = (event: ISupervisorEvent<string>) => {
    for (const listener of this.#listeners) listener(event)
  }
}

/** A test harness records the neutral boundary without constructing platform channels. */
export function remoteHarness(
  overrides: Partial<IRemoteRuntimeRegistrationOptions<string, unknown>> = {},
  mismatchScheduler = false
) {
  /** Neutral state belongs to one named owner before either canonical registration is constructed. */
  const ports = new RemotePortHarness(mismatchScheduler)
  /** The actual runtime registration retains its original generation, key and retry ownership. */
  const registration = createRemoteRuntimeRegistration({
    binding: ports.binding,
    prepareRuntime: ports.prepareRuntime,
    readRuntimeEndpoint: readRuntimePeerEndpoint,
    report: (error) => {
      ports.calls.push(`report:${String(error)}`)
    },
    ...overrides
  })
  return {
    registration,
    prepareRuntime: ports.prepareRuntime,
    served: ports.served,
    channel: ports.channel,
    calls: ports.calls,
    sends: ports.sends,
    owned: ports.owned,
    supervisor: ports.supervisor,
    binding: ports.binding,
    own: ports.own,
    nextGeneration: ports.nextGeneration,
    emit: ports.emit
  }
}
