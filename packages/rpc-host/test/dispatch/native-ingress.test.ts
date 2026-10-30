import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Original ingress rejection and late-verification business assertions use genuine native Sessions. */
import { createRpcHost } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/plugins/auth'
import limits from '@migaia/rpc-host/plugins/limits'
import {
  defineFlowFeature,
  RpcFlowLayer,
  RpcFlowPoint,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcWireKind } from '@migaia/rpc-contract/protocol'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'
import { SessionTable } from '../../dist/session/table.js'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'

/** One configured verifier suspension borrows the original transform input without parsing it. */
type IIngressVerification = {
  started: boolean
  entered: IDeferred<unknown>
  release: IDeferred<void>
}

/** Application-owned verification gates never restore frames or dispatch business themselves. */
class IngressVerifier {
  /** Only the next actual verification borrows this explicitly armed application gate. */
  #pending: IIngressVerification | undefined
  /** Only armed application verifications contribute to this actual concurrent callback count. */
  active = 0
  /** The original callback records its highest real simultaneous gate occupancy. */
  maximum = 0

  /** Arm after a real barrier reply, so startup directory traffic cannot consume the gate. */
  hold(): IIngressVerification {
    /** The original callback retains the opaque input until its own application gate settles. */
    const pending = { started: false, entered: deferred<unknown>(), release: deferred<void>() }
    this.#pending = pending
    return pending
  }

  /** Pass through ordinary signatures; held signatures keep their original value and rejection. */
  readonly verify = (value: unknown): unknown | Promise<unknown> => {
    /** Each gate is consumed once by the actual configured auth callback. */
    const pending = this.#pending
    this.#pending = undefined
    if (!pending) return value
    pending.started = true
    this.active += 1
    this.maximum = Math.max(this.maximum, this.active)
    pending.entered.resolve(value)
    return pending.release.promise
      .then(() => value)
      .finally(() => {
        this.active -= 1
      })
  }
}

it('rejecting ingress verification releases the next call; close prevents a late verifier from dispatching', async () => {
  /** Only the real provider records business execution; physical writes alone cannot add entries. */
  const delivered: unknown[] = []
  /** Authentication reports retain their real native wrapper and original verifier cause. */
  const failures: unknown[] = []
  /** The configured application verifier supplies the original asynchronous protection boundary. */
  const verifier = new IngressVerifier()
  /** The existing listener owns the accepted Session and native lifecycle handle. */
  const server = coreMemoryServer('provider')
  /** The public host installs actual Auth and an actual provider without injecting dispatcher ports. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      rpcFeaturesPlugin({
        features: { feature0: auth({ sign: (value) => value, verify: verifier.verify }) }
      }),
      ...server.options.plugins
    ],
    report: (error) => failures.push(error),
    provide: {
      barrier: (value, context) => context.success(value),
      echo: (value, context) => {
        delivered.push(value)
        return context.success(value)
      }
    }
  })
  /** This original client completes both genuine handshakes through the same native pair. */
  const client = await server.connect('caller', {
    plugins: [
      rpcFeaturesPlugin({
        features: { feature0: auth({ sign: (value) => value, verify: (value) => value }) }
      })
    ]
  })
  /** A finally release must never leave a configured verification callback retaining native leases. */
  const gates: IIngressVerification[] = []
  /** Original public request promises remain observed until actual source retirement settles them. */
  const outcomes: Promise<unknown>[] = []
  /** A passthrough spy observes real physical submission, without reading protected metadata. */
  const writes = vi.spyOn(client.pair[1], 'write')
  try {
    /** A real round trip joins preceding directory work in both original physical receive tails. */
    await client.host.memory.send('provider', 'barrier', 'before-verification')
    /** This actual accepted handle remains authoritative after its public lookup retires. */
    const accepted = server.lookup('caller')
    assert(accepted)
    /** The rejected first input keeps the exact original application error on the reported chain. */
    const rejected = verifier.hold()
    gates.push(rejected)
    writes.mockClear()
    outcomes.push(
      client.host.memory.send('provider', 'echo', 'rejected').catch((error: unknown) => error)
    )
    await rejected.entered.promise
    /** The second actual request keeps its ordinary request task and genuine caller generation. */
    const ready = client.host.memory.send('provider', 'echo', 'ready')
    outcomes.push(ready.catch((error: unknown) => error))
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toEqual([])
    /** The actual Auth owner reports this rejection and lets the Session's next physical slot run. */
    const original = new Error('fixture verification rejected')
    rejected.release.reject(original)
    await expect(ready).resolves.toBe('ready')
    await vi.waitFor(() => expect(delivered).toEqual(['ready']))
    expect(failures).toContainEqual(
      expect.objectContaining({
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.authenticationFailed,
        cause: original
      })
    )
    /** A later configured verifier is suspended before its payload can reach the real provider. */
    const late = verifier.hold()
    gates.push(late)
    outcomes.push(
      client.host.memory.send('provider', 'echo', 'late').catch((error: unknown) => error)
    )
    await late.entered.promise
    /** Original Session close physically retires the source, then joins its admitted receive tail. */
    const closing = accepted.handle.close()
    expect(accepted.handle.close()).toBe(closing)
    await vi.waitFor(() => expect(client.pair[0].closed).toBe(true))
    late.release.resolve()
    await closing
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toEqual(['ready'])
  } finally {
    for (const gate of gates) gate.release.resolve()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all(outcomes)
    writes.mockRestore()
  }
})

it('authenticates two business arrivals concurrently, bypasses their ordered delivery with a genuine ping, then delivers in arrival order', async () => {
  /** The real provider owns this original ordered delivery observation. */
  const delivered: unknown[] = []
  /** The original routing oracle observes authenticated messages before actual business admission. */
  const arrivals: unknown[] = []
  /** The genuine wire-layer stage records order without admitting or executing another operation. */
  const observeArrival: IRpcFlowStage<'dispatchInbound'> = (payload, next) => {
    if (
      payload.context.envelope.kind === RpcWireKind.call &&
      payload.context.envelope.task.method === 'echo'
    )
      arrivals.push(payload.context.envelope.payload)
    return next(payload)
  }
  /** Native inbound ordering puts this actual observation before the builtin quota stage. */
  const arrivalWitness = defineFlowFeature({
    phase: 1000,
    name: 'ingress-arrival-order',
    setup: () => ({
      stages: {
        [RpcFlowPoint.dispatchInbound]: { layer: RpcFlowLayer.wire, stage: observeArrival }
      }
    })
  })
  /** Genuine native Auth supplies every held verification input. */
  const verifier = new IngressVerifier()
  /** Existing native diagnostics remain visible without an alternate failure channel. */
  const failures: unknown[] = []
  /** Default passthrough retains the actual table/handle used by the SDK connection. */
  const attached = vi.spyOn(SessionTable.prototype, 'attach')
  /** Physical candidates must not acquire actual business admission while authentication is held. */
  const admitted = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
  /** The original listener fixture owns the same real accepted Session as ordinary public calls. */
  const server = coreMemoryServer('provider')
  /** No test-side handler or ingress parser can deliver one of these real public requests. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      rpcFeaturesPlugin({
        features: {
          arrivalWitness,
          feature0: auth({ sign: (value) => value, verify: verifier.verify }),
          feature1: limits({ maxGlobal: 1, maxPerPeer: 1 })
        }
      }),
      ...server.options.plugins
    ],
    report: (error) => failures.push(error),
    provide: {
      barrier: (value) => value,
      echo: (value) => {
        delivered.push(value)
        return value
      }
    }
  })
  /** The opposite public Host uses independent original Auth and the same linked carrier pair. */
  const client = await server.connect('caller', {
    plugins: [
      rpcFeaturesPlugin({
        features: { feature0: auth({ sign: (value) => value, verify: (value) => value }) }
      })
    ]
  })
  /** Finally releases only these two finite application-owned verification inputs. */
  const gates: IIngressVerification[] = []
  /** Original public promises stay observed even when a parallel-entry assertion fails first. */
  const outcomes: Promise<unknown>[] = []
  try {
    await client.host.memory.send('provider', 'barrier')
    /** The completed barrier exposes only the already-installed registry's real instance. */
    const admission = admitted.mock.contexts.at(-1)
    assert(admission instanceof ProviderAdmissionRegistry)
    admitted.mockClear()
    /** Find the original client attachment by its actual physical identity, without another index. */
    const index = attached.mock.calls.findIndex(([, carrier]) => carrier === client.pair[1])
    /** This is the genuine table instance on which the original SDK attach executed. */
    const callerTable = attached.mock.contexts[index]
    assert(callerTable instanceof SessionTable)
    /** The original return receipt supplies the one real Session-owned ping correlation. */
    const handle = attached.mock.results[index]
    assert(handle?.type === 'return')
    /** The first actual business verifier remains suspended throughout the control exchange. */
    const first = verifier.hold()
    gates.push(first)
    const firstCall = client.host.memory.send('provider', 'echo', 'first')
    outcomes.push(firstCall.catch((error: unknown) => error))
    await first.entered.promise
    /** A second real opaque arrival must begin verification before the first one settles. */
    const second = verifier.hold()
    gates.push(second)
    const secondCall = client.host.memory.send('provider', 'echo', 'second')
    /**
     * Real full-provider admission adds this supported refusal beyond the original route-only
     * oracle.
     */
    const secondRejected = expect(secondCall).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.overloaded
    })
    outcomes.push(secondRejected.catch((error: unknown) => error))
    await vi.waitFor(() => expect(second.started).toBe(true))
    second.release.resolve()
    await vi.waitFor(() => expect(verifier.active).toBe(1))
    expect(delivered).toEqual([])
    expect(arrivals).toEqual([])
    expect(admission.size).toBe(0)
    expect(admitted).not.toHaveBeenCalled()
    /** This third verified input is a real protected control, with no pre-authentication inspection. */
    await callerTable.ping(handle.value, { timeoutMs: 1000 })
    expect(delivered).toEqual([])
    expect(arrivals).toEqual([])
    expect(first.started).toBe(true)
    expect(verifier.active).toBe(1)
    expect(admission.size).toBe(0)
    expect(admitted).not.toHaveBeenCalled()
    first.release.resolve()
    await expect(firstCall).resolves.toBe('first')
    await secondRejected
    expect(arrivals).toEqual(['first', 'second'])
    expect(delivered).toEqual(['first'])
    expect(failures).toEqual([
      expect.objectContaining({ source: 'rpc.endpoint', code: RpcCoreErrorCode.overloaded })
    ])
  } finally {
    for (const gate of gates) gate.release.resolve()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all(outcomes)
    attached.mockRestore()
    admitted.mockRestore()
  }
})

it('bounds opaque ingress verification at three and releases the fourth without reordering business delivery', async () => {
  /** Actual provider entry is independent from physical delivery and verification starts. */
  const delivered: unknown[] = []
  /** Only real configured Auth callbacks can occupy these finite application gates. */
  const verifier = new IngressVerifier()
  /** The public listener creates no substitute receiver or queue owner. */
  const server = coreMemoryServer('provider')
  /** The genuine receiving Auth and provider share the original native Session. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      rpcFeaturesPlugin({
        features: { feature0: auth({ sign: (value) => value, verify: verifier.verify }) }
      }),
      ...server.options.plugins
    ],
    provide: {
      barrier: (value) => value,
      echo: (value) => {
        delivered.push(value)
        return value
      }
    }
  })
  /** Each actual public request crosses the original linked carrier and sole codec. */
  const client = await server.connect('caller', {
    plugins: [
      rpcFeaturesPlugin({
        features: { feature0: auth({ sign: (value) => value, verify: (value) => value }) }
      })
    ]
  })
  /** Finally settles at most four original application-held inputs, never generated traffic. */
  const gates: IIngressVerification[] = []
  /** Caller promises remain observed until the real Sessions release them. */
  const calls: Promise<unknown>[] = []
  /** A default spy observes actual physical submissions without examining protected values. */
  const writes = vi.spyOn(client.pair[1], 'write')
  try {
    await client.host.memory.send('provider', 'barrier')
    writes.mockClear()
    for (const value of ['first', 'second', 'third']) {
      /** Each gate is armed only after the previous real verifier has entered. */
      const gate = verifier.hold()
      gates.push(gate)
      calls.push(
        client.host.memory.send('provider', 'echo', value).catch((error: unknown) => error)
      )
      await vi.waitFor(() => expect(gate.started).toBe(true))
    }
    expect(verifier.active).toBe(3)
    /** Physical arrival four waits for one of the same three verification slots. */
    const fourth = verifier.hold()
    gates.push(fourth)
    calls.push(
      client.host.memory.send('provider', 'echo', 'fourth').catch((error: unknown) => error)
    )
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(4))
    await Promise.resolve()
    await Promise.resolve()
    expect(fourth.started).toBe(false)
    expect(verifier.maximum).toBe(3)
    expect(delivered).toEqual([])
    gates[0]!.release.resolve()
    await vi.waitFor(() => expect(fourth.started).toBe(true))
    expect(verifier.maximum).toBe(3)
    /** Completion order differs deliberately from the original arrival sequence. */
    fourth.release.resolve()
    gates[2]!.release.resolve()
    gates[1]!.release.resolve()
    expect(await Promise.all(calls)).toEqual(['first', 'second', 'third', 'fourth'])
    expect(delivered).toEqual(['first', 'second', 'third', 'fourth'])
  } finally {
    for (const gate of gates) gate.release.resolve()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all(calls)
    writes.mockRestore()
  }
})
