/** Reads actual owner tables after 10,000 real operations, without production diagnostics. */
import { execFileSync } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { Session as InspectorSession } from 'node:inspector/promises'
import type { Runtime } from 'node:inspector'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler, type IManualScheduler } from '@migaia/utils/testing'
import { RpcAbortError, RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import type { IRpcContext } from '@migaia/rpc-host'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'

import {
  defineFlowFeature,
  rpcFeaturesPlugin,
  defineTransportPlugin,
  RpcJsonCarrierCodec,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import { RpcHost } from '../../../rpc-host/dist/host/rpc-host.js'
import { RpcFlowProgram } from '../../../rpc-host/dist/sdk/flow-program.js'
import { RpcBatchFlow } from '../../../rpc-host/dist/features/batch/flow.js'
import { RpcLimitsFlow } from '../../../rpc-host/dist/features/limits/flow.js'
import { coreMemoryServer } from '../../../rpc-host/test/host/core-fixture.ts'
import { MemoryCarrier } from '../../../rpc-host/test/fixtures/core-carrier.ts'

/** Fixed business categories each execute 2,000 times, evenly split between both namespaces. */
const operationKinds = ['request', 'notify', 'stream', 'cancel', 'timeout'] as const
/** The test publishes only actual retained references to its own in-process inspector. */
const inspectorRoot = '__rpcA17ResourceOwners'
/** Reproduction uses the repository's shared measurement mutex and enforced final load ceiling. */
const reproduction =
  'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false rtk proxy node /Users/kaeo/workspack/migai/scripts/exclusive-window.mjs run --window rpc-a17 --end-load enforce --wait 2700 -- pnpm --filter @migaia/rpc-integration exec vitest run test/host/resource-residue.test.ts --coverage.enabled=false'
/** Full public classification is retained for every expected or unexpected failure. */
type IFailure = {
  ordinal: number
  kind: string
  namespace: string
  expected: boolean
  source: unknown
  code: unknown
  name: unknown
  reason: unknown
  message: string
}
/** The actual SDK roots retain the same production flow objects later inspected. */
type IRetainedOwners = { host: RpcHost; batch?: RpcBatchFlow; limits?: RpcLimitsFlow }
/** Counts distinguish actual work from necessary namespace and accepted-session lifetime state. */
type ICounts = Record<string, number>
/** Node's protocol runtime exposes private descriptors before the bundled declaration includes them. */
type IProperties = Runtime.GetPropertiesReturnType & {
  privateProperties?: readonly { name: string; value?: Runtime.RemoteObject }[]
}
/** One actual provider entry supplies both entry and real finally barriers for cancellation. */
type IHold = {
  entered: ReturnType<typeof deferred<void>>
  finished: ReturnType<typeof deferred<void>>
}

/** Provider effects and concurrency come from actual business execution, not client submissions. */
class ResidueBusiness {
  /** Every retained provider signal is checked for abort subscriptions after its real finally. */
  readonly signals: AbortSignal[] = []
  /** Actual provider entry counts exclude cancelled-before-entry calls. */
  readonly counts = { request: 0, notify: 0, stream: 0, hold: 0 }
  /** Actual active provider bodies witness concurrency independently from client pending counts. */
  active = 0
  /** Maximum is updated only on real provider entry. */
  maximum = 0
  /** Sequential mixed work gives one actual notification an explicit delivery barrier. */
  notice = deferred<void>()
  /** Only one controlled business hold exists at a time; it has no queue or execution wrapper. */
  #hold: IHold | undefined

  /** Arm a provider entry before submitting its actual cancellation or deadline call. */
  arm(): IHold {
    /** These barriers are test observation only; the provider signal owns its execution lifetime. */
    const hold = { entered: deferred<void>(), finished: deferred<void>() }
    this.#hold = hold
    return hold
  }
  /** Request results preserve the actual supplied scalar. */
  readonly echo = (value: number): number => {
    this.#enter('request')
    try {
      return value
    } finally {
      this.active -= 1
    }
  }
  /** Notify success includes real provider execution, beyond physical write acceptance. */
  readonly notify = (): void => {
    this.#enter('notify')
    try {
      this.notice.resolve()
    } finally {
      this.active -= 1
    }
  }
  /** A completely consumed genuine stream must release both production channel directions. */
  readonly values = (value: number) => this.#values(value)

  /** Iterator entry and finally count actual provider execution through full remote consumption. */
  async *#values(value: number) {
    this.#enter('stream')
    try {
      yield value
      yield value + 1
    } finally {
      this.active -= 1
    }
  }
  /** Count only real business entry, including synchronous bodies and active stream iteration. */
  #enter(kind: keyof ResidueBusiness['counts']): void {
    this.counts[kind] += 1
    this.active += 1
    this.maximum = Math.max(this.maximum, this.active)
  }
  /** The public registration supplies the real provider context and its actual abort signal. */
  readonly hold = async (_value: number, context: IRpcContext) => {
    /** Retain only the current business barriers; no private Dispatcher work is executed here. */
    const hold = this.#hold!
    this.#enter('hold')
    this.signals.push(context.signal as AbortSignal)
    /** Exactly this listener belongs to the business body and is always removed by its finally. */
    const aborted = deferred<void>()
    /** The same real signal handles already-aborted entry and later native cancel delivery. */
    const onAbort = (): void => aborted.resolve()
    context.signal.addEventListener('abort', onAbort, { once: true })
    hold.entered.resolve()
    try {
      if (!context.signal.aborted) await aborted.promise
      return context.failed('provider cancelled', 'CANCELLED')
    } finally {
      context.signal.removeEventListener('abort', onAbort)
      this.active -= 1
      this.#hold = undefined
      hold.finished.resolve()
    }
  }
}

/** One bounded test uses the native Inspector protocol solely to read actual private data. */
class ResidueInspector {
  /** This in-process debugging connection never opens a network inspector listener. */
  readonly #session = new InspectorSession()
  /** Original physical Session references remain inspectable after the real table removes them. */
  readonly #physical = new Map<string, readonly Runtime.RemoteObject[]>()

  /** The test's retained references stay alive until its final resource sample. */
  constructor(owners: Record<string, unknown>) {
    ;(globalThis as unknown as Record<string, unknown>)[inspectorRoot] = owners
    this.#session.connect()
  }
  /** Obtain the actual object reference rather than a JSON projection or claimed diagnostic. */
  async root(name: string): Promise<Runtime.RemoteObject> {
    /** Only fixed local test keys reach the inspector expression. */
    const result = await this.#session.post('Runtime.evaluate', {
      expression: `globalThis[${JSON.stringify(inspectorRoot)}][${JSON.stringify(name)}]`,
      objectGroup: 'rpc-a17',
      generatePreview: true
    })
    if (result.exceptionDetails || !result.result.objectId)
      throw new Error(`inspector cannot retain ${name}`)
    return result.result
  }
  /** Private descriptors are read by the engine; no owner method or private function is invoked. */
  async field(object: Runtime.RemoteObject, name: string): Promise<Runtime.RemoteObject> {
    /** Every traversed field must be visibly present; unavailable data never becomes a false zero. */
    const result: IProperties = await this.#session.post('Runtime.getProperties', {
      objectId: object.objectId!,
      ownProperties: true,
      generatePreview: true
    })
    /** Public data properties are needed only for the test's retained references and index records. */
    const descriptor = name.startsWith('#')
      ? result.privateProperties?.find((property) => property.name === name)
      : result.result.find((property) => property.name === name)
    if (!descriptor?.value) throw new Error(`inspector field unavailable: ${name}`)
    return descriptor.value
  }
  /** Engine Map/Set descriptions expose their actual size without an owner diagnostic seam. */
  size(object: Runtime.RemoteObject): number {
    /** Node supplies Map(n)/Set(n) on the exact built-in collection reference. */
    const match = /^(?:Map|Set)\((\d+)\)$/u.exec(object.description ?? '')
    if ((object.subtype !== 'map' && object.subtype !== 'set') || !match)
      throw new Error(`inspector collection unavailable: ${object.description}`)
    return Number(match[1])
  }
  /** Traverse a fixed actual private path and return its real collection size. */
  async count(owner: Runtime.RemoteObject, path: readonly string[]): Promise<number> {
    /** Traversal length is a fixed source-field path, independent from measured workload size. */
    let object = owner
    for (const field of path) object = await this.field(object, field)
    return this.size(object)
  }
  /** Count both real roots, their original calls/streams/providers and genuine optional owners. */
  async counts(): Promise<ICounts> {
    /** Output contains actual collection counts only; no inferred work or synthetic zero fields. */
    const counts: ICounts = {}
    for (const label of ['client', 'server']) {
      /** These are the retained real RpcHost, RpcBatchFlow and RpcLimitsFlow references. */
      const retained = await this.root(label)
      /** The same physical root owns all actual mandatory work tables. */
      const host = await this.field(retained, 'host')
      if (!this.#physical.has(label)) {
        /** The native Map snapshot only retains actual owner references; it never runs RPC work. */
        const sessions = await this.field(await this.field(host, '#sessions'), '#sessions')
        /** Preserve the exact physical instances before their original close removes table entries. */
        const array = await this.#session.post('Runtime.callFunctionOn', {
          objectId: sessions.objectId!,
          functionDeclaration: 'function () { return Array.from(this.values()) }',
          objectGroup: 'rpc-a17'
        })
        /** Dense native array indices contain only the original Session objects. */
        const entries = await this.#session.post('Runtime.getProperties', {
          objectId: array.result.objectId!,
          ownProperties: true
        })
        this.#physical.set(
          label,
          entries.result.filter((entry) => /^\d+$/u.test(entry.name)).map((entry) => entry.value!)
        )
      }
      for (const [index, session] of this.#physical.get(label)!.entries())
        counts[`${label}.Session.${index}.#keepaliveBytes`] = (
          await this.field(session, '#keepaliveBytes')
        ).value as number
      for (const [owner, fields] of [
        ['#calls', ['#records', '#bySource', '#invocations']],
        ['#streams', ['#consumers', '#producers', '#activeConsumers', '#activeProducers']],
        ['#providers', ['#incoming']]
      ] as const)
        for (const field of fields)
          counts[`${label}.${owner}.${field}`] = await this.count(host, [owner, field])
      counts[`${label}.#providers.#ordering.#ordered`] = await this.count(host, [
        '#providers',
        '#ordering',
        '#ordered'
      ])
      for (const field of [
        '#sessions',
        '#accepted',
        '#reserved',
        '#nativeGenerations',
        '#globalNames',
        '#namespaces'
      ])
        counts[`${label}.#sessions.${field}`] = await this.count(host, ['#sessions', field])
      counts[`${label}.#sessions.#draining.#records`] = await this.count(host, [
        '#sessions',
        '#draining',
        '#records'
      ])
      /** Standard built-in Map.get reads each original namespace index without invoking Host work. */
      const namespaces = await this.field(await this.field(host, '#sessions'), '#namespaces')
      for (const namespace of ['alpha', 'beta']) {
        /** This native Map query is read-only; the returned record is the original live index. */
        const index = await this.#session.post('Runtime.callFunctionOn', {
          objectId: namespaces.objectId!,
          functionDeclaration: 'function (name) { return this.get(name) }',
          arguments: [{ value: namespace }],
          objectGroup: 'rpc-a17',
          generatePreview: true
        })
        for (const field of ['peers', 'names', 'probing', 'pendingPeers', 'departed', 'waiting'])
          counts[`${label}.namespace.${namespace}.${field}`] = this.size(
            await this.field(index.result, field)
          )
      }
      /** These exact owners are constructed by genuine SDK setup and never simulated. */
      const batch = await this.field(retained, 'batch')
      counts[`${label}.batch.#lanes`] = await this.count(batch, ['#lanes'])
      /** Shared admission owns both namespace leases and per-peer occupancy. */
      const limits = await this.field(retained, 'limits')
      for (const field of ['#leases', '#peerCounts'])
        counts[`${label}.limits.#admission.${field}`] = await this.count(limits, [
          '#admission',
          field
        ])
      counts[`${label}.limits.#connections`] = await this.count(limits, ['#connections'])
    }
    return counts
  }
  /** Release only this test's inspector references after the final actual resource sample. */
  async close(): Promise<void> {
    await this.#session.post('Runtime.releaseObjectGroup', { objectGroup: 'rpc-a17' })
    this.#session.disconnect()
    delete (globalThis as unknown as Record<string, unknown>)[inspectorRoot]
  }
}

/** Keep the original native detach authority and accepted handle in one bounded cleanup receipt. */
function sourceDisposer(
  context: IRpcTransportSetupContext,
  connected: IRpcSessionHandle
): () => Promise<void> {
  return () => context.detach(connected)
}

/** Retain the existing package rejection reason without a nested callback or diagnostic owner. */
function rejectionObserver(rejections: unknown[]): (rejection: IRpcProviderRejection) => void {
  return (rejection) => {
    rejections.push(rejection)
  }
}

/** Every native listener receives an independent instance of the unchanged JSON codec. */
function createA17JsonCodec(): RpcJsonCarrierCodec {
  return new RpcJsonCarrierCodec()
}

/** One source pair implements only the actual native IO contract; Session owns every attach. */
function nativeSource(
  namespace: string,
  listener: ReturnType<typeof coreMemoryServer>,
  carriers: MemoryCarrier[],
  scheduler: IManualScheduler
) {
  return defineTransportPlugin({
    name: `a17-${namespace}-source`,
    namespace,
    closingWrites: true,
    features: { deadline: timeoutFeature({ ms: 1000, scheduler }) },
    open: async (context) => {
      /** Each physical endpoint uses the same real JSON codec as its listening native namespace. */
      const left = new MemoryCarrier(
        `a17-${namespace}-server`,
        undefined,
        new RpcJsonCarrierCodec(),
        false,
        true
      )
      /** The local endpoint retains the original receiver, controller and close implementation. */
      const right = new MemoryCarrier(
        `a17-${namespace}-client`,
        undefined,
        new RpcJsonCarrierCodec(),
        false,
        true
      )
      left.link(right)
      right.link(left)
      carriers.push(left, right)
      /** Both actual accepted handles own handshake readiness and later native cleanup. */
      const accepted = listener.accept(left)
      /** No alternate request facade, codec execution or flow runner is introduced. */
      const connected = context.attach(right)
      await Promise.all([accepted.ready, connected.ready])
      return { dispose: sourceDisposer(context, connected) }
    }
  })
}

/** Retain each complete production flow only at the normal SDK installation boundary. */
function optionalFlows(owners: IRetainedOwners, rejections: unknown[]) {
  /** The fixed observer borrows only its actual output collection. */
  const onRejected = rejectionObserver(rejections)
  return rpcFeaturesPlugin({
    features: {
      batch: defineFlowFeature({
        phase: 1000,
        name: 'a17-batch',
        setup: (context) => {
          owners.batch = new RpcBatchFlow(context.signal, false)
          return owners.batch.value
        }
      }),
      limits: defineFlowFeature({
        phase: 1001,
        name: 'a17-limits',
        setup: (context) => {
          owners.limits = new RpcLimitsFlow({ onRejected }, context)
          return owners.limits.value
        }
      })
    }
  })
}

/** Keep every failure's public fields and existing package reason channel with its exact sample. */
function classify(
  error: unknown,
  ordinal: number,
  kind: string,
  namespace: string,
  expected: boolean,
  reason: unknown
): IFailure {
  /** All workload inputs are fixed numeric fixtures; no credential or business payload is recorded. */
  const fields = error as { source?: unknown; code?: unknown; name?: unknown; message?: unknown }
  return {
    ordinal,
    kind,
    namespace,
    expected,
    source: fields?.source ?? null,
    code: fields?.code ?? null,
    name: fields?.name ?? null,
    reason: reason ?? null,
    message: typeof fields?.message === 'string' ? fields.message : String(error)
  }
}

/** Execute exactly one real operation; cancellation and timeout wait for actual provider entry. */
async function operate(
  host: Awaited<ReturnType<RpcHost['open']>>,
  business: ResidueBusiness,
  scheduler: IManualScheduler,
  ordinal: number,
  signals: AbortSignal[],
  failures: IFailure[]
): Promise<void> {
  /** Five categories and two namespaces alternate without skipping any business execution. */
  const kind = operationKinds[ordinal % operationKinds.length]!
  /** Odd category width makes each category visit both namespaces equally. */
  const namespace = ordinal % 2 === 0 ? 'alpha' : 'beta'
  /** Both namespaces are actual independently accepted physical sources on this one public Host. */
  const endpoint = host[namespace]
  if (kind === 'request')
    expect(await endpoint.send('a17-server', 'echo', ordinal, { timeout: false })).toBe(ordinal)
  else if (kind === 'notify') {
    business.notice = deferred<void>()
    await endpoint.notify('notice', ordinal, { targetId: 'a17-server', timeout: false })
    await business.notice.promise
  } else if (kind === 'stream') {
    /** Fully consuming the original remote iterator exercises both actual stream tables. */
    const values: unknown[] = []
    for await (const value of endpoint.stream('values', ordinal, {
      timeout: false
    }) as AsyncIterable<unknown>)
      values.push(value)
    expect(values).toEqual([ordinal, ordinal + 1])
  } else {
    /** The original provider entry and finally remain independent from caller Promise settlement. */
    const hold = business.arm()
    /** A native caller controller exists only for actual cancellation samples. */
    const caller = new AbortController()
    signals.push(caller.signal)
    /** Each expected rejection is observed before cancellation/deadline can fire. */
    const pending = endpoint
      .send(
        'a17-server',
        'hold',
        ordinal,
        kind === 'cancel' ? { signal: caller.signal, timeout: false } : {}
      )
      .then(
        () => {
          throw new Error('held provider unexpectedly resolved')
        },
        (error: unknown) => error
      )
    await hold.entered.promise
    /** This original native reason must remain the public local cancellation's exact cause. */
    const reason = new RangeError('caller cancelled after provider entry')
    if (kind === 'cancel') caller.abort(reason)
    else scheduler.advance(1000)
    /** The actual public result must retain its distinct expected native family and code. */
    const error = await pending
    failures.push(classify(error, ordinal, kind, namespace, true, null))
    expect(error).toBeInstanceOf(kind === 'cancel' ? RpcAbortError : RpcTimeoutError)
    expect(error).toMatchObject({
      source: 'rpc.endpoint',
      code: kind === 'cancel' ? 'CANCELLED' : 'DEADLINE_EXCEEDED'
    })
    if (kind === 'cancel') expect((error as Error).cause).toBe(reason)
    await hold.finished.promise
    expect(business.active).toBe(0)
  }
}

/** Acquire only the concrete fixture owners; business execution and residue checks remain separate. */
function createResidueFixture() {
  /** The existing timer owner supplies deterministic deadlines and truthful remaining timer count. */
  const scheduler = createManualScheduler()
  /**
   * Every default production timer uses the canonical manual scheduler; no second timer table
   * exists.
   */
  const scheduling = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((callback, ms) => scheduler.schedule(callback, ms))
  /** Only fixed fixture values enter business or diagnostic records. */
  const business = new ResidueBusiness()
  /** Background reports must remain visible, including any late shutdown failure. */
  const reports: unknown[] = []
  /** Existing quota observations classify any unexpected shared OVERLOADED branch. */
  const rejections: unknown[] = []
  /** Actual caller signals remain retained solely to inspect their listener counts after release. */
  const signals: AbortSignal[] = []
  /** Each expected/unexpected failure keeps every required public classification field. */
  const failures: IFailure[] = []
  /** The two original public outside signals witness Host listener removal after close. */
  const outside = [new AbortController(), new AbortController()]
  /** Actual physical references retain their real receiver/unsubscribe state after Session close. */
  const carriers: MemoryCarrier[] = []
  /** Both listeners use the canonical existing memory medium and real JSON codec. */
  const listeners = ['alpha', 'beta'].map((namespace) =>
    coreMemoryServer('a17-server', 'a17-server', namespace, {}, [], {
      create: createA17JsonCodec,
      nativeBinary: false,
      closingWrites: true
    })
  )
  /** Construct real RPC owners directly so Inspector can retain their actual private references. */
  const server: IRetainedOwners = {
    host: new RpcHost({
      self: { name: 'a17-server', instanceId: 'a17-server' },
      signal: outside[0]!.signal,
      report: (error) => reports.push(error),
      provide: {
        echo: business.echo,
        notice: business.notify,
        values: business.values,
        hold: business.hold
      }
    })
  }
  /** One real requesting Host owns two independent accepted namespace sources. */
  const client: IRetainedOwners = {
    host: new RpcHost({
      self: { name: 'a17-client', instanceId: 'a17-client' },
      signal: outside[1]!.signal,
      report: (error) => reports.push(error)
    })
  }
  /** Measurements describe this exact candidate, including concurrent test-only worktree changes. */
  const receipt: Record<string, unknown> = {
    date: new Date().toISOString(),
    head: execFileSync('rtk', ['git', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyWorktree: true,
    command: reproduction,
    observableFailures: {
      CANCELLED: 'native caller abort after provider entry',
      DEADLINE_EXCEEDED: 'complete timeout after provider entry',
      OVERLOADED: 'shared global/per-peer admission; existing onRejected reason retained'
    },
    failures,
    rejections,
    classificationPayloads: 'fixed numeric fixtures; messages contain no secrets',
    completed: 0,
    result: 'running'
  }
  /** Only this test's actual objects are reachable through its local in-process Inspector group. */
  const inspector = new ResidueInspector({ client, server })
  return {
    scheduler,
    scheduling,
    business,
    reports,
    rejections,
    signals,
    failures,
    outside,
    carriers,
    listeners,
    server,
    client,
    receipt,
    inspector
  }
}

it('drains actual work, flow, session, listener and timer owners after 10000 mixed operations', async () => {
  /** Explicit fixture context separates acquisition from the unchanged mixed-workload assertions. */
  const {
    scheduler,
    scheduling,
    business,
    reports,
    rejections,
    signals,
    failures,
    outside,
    carriers,
    listeners,
    server,
    client,
    receipt,
    inspector
  } = createResidueFixture()
  try {
    await server.host.open(
      new RpcFlowProgram([
        optionalFlows(server, rejections),
        ...listeners.map((listener) => listener.transport)
      ])
    )
    /** Opening both native sources commits to the same real Host and actual SessionTable. */
    const publicHost = await client.host.open(
      new RpcFlowProgram([
        optionalFlows(client, rejections),
        ...listeners.map((listener, index) =>
          nativeSource(index === 0 ? 'alpha' : 'beta', listener, carriers, scheduler)
        )
      ])
    )
    receipt.initial = await inspector.counts()
    for (let ordinal = 0; ordinal < 10000; ordinal++) {
      try {
        await operate(publicHost, business, scheduler, ordinal, signals, failures)
      } catch (error) {
        failures.push(
          classify(
            error,
            ordinal,
            operationKinds[ordinal % 5]!,
            ordinal % 2 === 0 ? 'alpha' : 'beta',
            false,
            rejections.at(-1)
          )
        )
        throw error
      }
      receipt.completed = ordinal + 1
    }
    expect(business.counts).toEqual({ request: 2000, notify: 2000, stream: 2000, hold: 4000 })
    expect(business.signals).toHaveLength(4000)
    expect(
      failures.filter((failure) => failure.expected && failure.kind === 'cancel')
    ).toHaveLength(2000)
    expect(
      failures.filter((failure) => failure.expected && failure.kind === 'timeout')
    ).toHaveLength(2000)
    /**
     * Final delivery may precede the original dispatch completion by a microtask; inspect that
     * owner.
     */
    await vi.waitFor(async () => {
      /** Accepted identity and configured namespace indexes intentionally live until close. */
      const counts = await inspector.counts()
      for (const [name, count] of Object.entries(counts))
        if (
          !name.includes('.#sessions.') &&
          !name.includes('.namespace.') &&
          !name.endsWith('.limits.#connections')
        )
          expect(count, name).toBe(0)
      receipt.beforeClose = counts
    })
    expect(scheduler.pendingCount).toBe(0)
    expect(rejections).toEqual([])
    expect(reports).toEqual([])
    receipt.actualProviderMaximum = business.maximum
    receipt.business = business.counts
    receipt.beforeCloseTimers = scheduler.pendingCount
    await Promise.all([client.host.close(), server.host.close()])
    /** Namespace registration records are bounded lifetime definitions, not active Session entries. */
    const final = await inspector.counts()
    for (const [name, count] of Object.entries(final))
      expect(count, name).toBe(name.endsWith('.#sessions.#namespaces') ? 2 : 0)
    /**
     * Count original live listener registrations rather than inferring them from successful
     * results.
     */
    const abortListeners = [
      ...signals,
      ...business.signals,
      ...outside.map((controller) => controller.signal)
    ].reduce((total, signal) => total + getEventListeners(signal, 'abort').length, 0)
    expect(abortListeners).toBe(0)
    for (const carrier of carriers) {
      expect(carrier.closed).toBe(true)
      expect(carrier.unsubscribed).toBe(1)
    }
    expect(carriers).toHaveLength(4)
    expect(scheduler.pendingCount).toBe(0)
    expect(reports).toEqual([])
    receipt.afterClose = final
    receipt.afterCloseAbortListeners = abortListeners
    receipt.actualCarrierUnsubscribed = carriers.map((carrier) => carrier.unsubscribed)
    receipt.afterCloseTimers = scheduler.pendingCount
    receipt.result = 'pass'
  } catch (error) {
    receipt.result = 'fail'
    receipt.failure = classify(
      error,
      Number(receipt.completed),
      'measurement',
      'host',
      false,
      rejections.at(-1)
    )
    throw error
  } finally {
    await Promise.allSettled([client.host.close(), server.host.close()])
    await inspector.close()
    scheduling.mockRestore()
  }
}, 120000)
