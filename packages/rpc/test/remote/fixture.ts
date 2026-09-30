import type { IAbortSignal } from '@migaia/lifecycle'
import type { ISupervisor, ISupervisorEvent } from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/scheduler'
import type { IRpcPortableValue } from '../../src/contract/types.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import { createRemoteRegistration } from '../../src/remote/proxy.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IRemoteProxyOptions, IRemoteServeEndpoint } from '../../src/remote/types.js'

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

/** A test harness records the neutral boundary without constructing platform channels. */
export function remoteHarness(
  overrides: Partial<IRemoteProxyOptions<string, unknown>> = {},
  mismatchScheduler = false
) {
  const scheduler = createManualScheduler()
  /** Events are delivered synchronously, matching the supervisor subscription contract. */
  const listeners = new Set<(event: ISupervisorEvent<string>) => void>()
  /** Last ready generation, advanced by the test when it switches units. */
  let generation = 1
  /** Mutable state is confined to the test supervisor port. */
  let state: 'idle' | 'ready' = 'idle'
  /** Every outbound call and cleanup is recorded for ordering assertions. */
  const calls: string[] = []
  /** Core send options are recorded independently from the method payload. */
  const sends: { method: string; params: unknown; options: unknown }[] = []
  /** Ownership callbacks model the PluginHost setup disposer stack. */
  const owned: (() => Promise<void>)[] = []
  const supervisor = {
    get state() {
      return state
    },
    get generation() {
      return generation
    },
    async start() {
      state = 'ready'
      return { state: 'ready', generation, unit: 'unit' } as const
    },
    async whenReady(_signal?: IAbortSignal) {
      return { state: 'ready', generation, unit: 'unit' } as const
    },
    inspect() {
      return {
        kind: 'fixture',
        state,
        generation,
        failuresInWindow: 0,
        terminalEntries: 0,
        degraded: [],
        abandoned: 0
      }
    },
    subscribe(listener: (event: ISupervisorEvent<string>) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async dispose() {
      calls.push('supervisor.dispose')
    }
  } as unknown as ISupervisor<string, unknown>
  const channel = {
    transport: {} as IRpcTransport,
    peerId: 'peer',
    scheduler: mismatchScheduler ? createManualScheduler() : scheduler,
    agreement: { source: 'static' as const, codec: 'identity', capabilities: ['stream@1'] },
    pipeline: { codec: {} as never, framer: {} as never },
    features: [],
    async close() {
      calls.push('channel.close')
    }
  }
  const endpoint = {
    async send(_peer: string, method: string, params: unknown, options: unknown) {
      sends.push({ method, params, options })
      return method === 'migaia.remote.describe' ? REMOTE_FIXTURE_CONTRACT : 'result'
    },
    async dispose() {
      calls.push('endpoint.dispose')
    }
  } as unknown as IRpcEndpoint
  const served: IRemoteServeEndpoint = {
    endpoint,
    oneWay: {
      async sendOneWay() {
        calls.push('oneWay.send')
      }
    },
    stream: {
      async *open(): AsyncIterableIterator<IRpcPortableValue> {
        calls.push('stream.open')
        yield 'item'
      },
      provide: () => () => undefined,
      async dispose() {
        calls.push('stream.dispose')
      }
    }
  }
  const binding = {
    ownership: 'borrowed' as const,
    supervisor,
    scheduler,
    async openChannel() {
      calls.push('channel.open')
      return channel
    }
  }
  const registration = createRemoteRegistration({
    contract: REMOTE_FIXTURE_CONTRACT,
    binding,
    async endpointFactory() {
      calls.push('endpoint.create')
      return served
    },
    report(error) {
      calls.push(`report:${String(error)}`)
    },
    ...overrides
  })
  return {
    registration,
    calls,
    sends,
    owned,
    supervisor,
    binding,
    own: (dispose: () => Promise<void>) => {
      owned.push(dispose)
    },
    nextGeneration() {
      generation += 1
    },
    emit(event: ISupervisorEvent<string>) {
      for (const listener of listeners) listener(event)
    }
  }
}
