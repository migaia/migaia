/** Original member lifecycle business runs on actual SDK generations, Sessions and native ports. */
import { assert, expect, it, vi, type MockInstance } from 'vitest'
import {
  createSupervisor,
  createUnitBudget,
  SupervisorEventType,
  type ISupervisor
} from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { UtilsAbortError } from '@migaia/utils/error'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import {
  createRpcHost,
  type IRpcHost,
  type IRpcHostOptions,
  type IRpcNamespace
} from '@migaia/rpc-host'
import {
  defineFlowFeature,
  defineTransportPlugin,
  RpcMemberGeneration,
  RpcFlowPoint,
  type IRpcFlowStage,
  type IRpcMemberSource,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrier,
  IRpcConnectionContext,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { retry } from '@migaia/rpc-host/features/retry'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { SessionTable } from '../../dist/session/table.js'
import { CallTable } from '../../dist/call/table.js'
import {
  nativeManagedMemoryUnits,
  openManagedMemoryCarrier,
  type IManagedMemoryUnit
} from '../host/managed-memory-fixture.js'

/** Every observation delegates to the original acquired carrier close and keeps its exact result. */
type ICarrierReceipt = Readonly<{
  source: IRpcMemberSource
  originalClose: IRpcCarrier['close']
  close: MockInstance<IRpcCarrier['close']>
}>

/** Cold recipes configure existing real owners; no test-side call or generation port is added. */
type INativeMemberFixtureOptions = Readonly<{
  provide?: Parameters<typeof nativeManagedMemoryUnits>[0]['provide']
  contract?: IRpcHostOptions['contract']
  features?: readonly unknown[]
  restart?: Parameters<typeof createSupervisor>[0]['restart']
  maxUnits?: number
  ready?: (unit: IManagedMemoryUnit, signal: IAbortSignal) => Promise<void>
}>

/** Only genuine owners and passive acquisition/cleanup receipts belong to this bounded fixture. */
class NativeMemberFixture {
  /** Original native and late-observer operations share the same manually driven clock. */
  readonly scheduler = createManualScheduler()
  /** The actual budget owns each admitted unit rather than the test inventing generation state. */
  readonly budget
  /** Existing actual native launch/profile implementation owns remote Hosts and MessagePorts. */
  readonly native
  /** The actual Supervisor alone chooses unit generation numbers and terminal events. */
  readonly supervisor: ISupervisor<IManagedMemoryUnit, string>
  /** Unfiltered original diagnostic values remain available for identity/error-graph assertions. */
  readonly reports: unknown[]
  /** These are original acquisition receipts, not a replacement transport or registry. */
  readonly carriers: ICarrierReceipt[] = []
  /** Accepted handles are borrowed only from the SDK's genuine onReady callback. */
  readonly handles: IRpcSessionHandle[] = []
  /** Passthrough spies observe actual table operations, qualified by exact carrier/handle identity. */
  readonly attach = vi.spyOn(SessionTable.prototype, 'attach')
  /** The actual native context still owns every detach and its original shared close Promise. */
  readonly detach = vi.spyOn(SessionTable.prototype, 'detach')
  /** Cases may hold or fail this supported native acquisition boundary after real IO is acquired. */
  prepareSource?: (
    source: IRpcMemberSource,
    ordinal: number
  ) => IRpcMemberSource | Promise<IRpcMemberSource>
  /** One installed public Host supplies the genuine native context and SessionTable. */
  #host: Pick<IRpcHost, 'close'> | undefined
  /** The published namespace is borrowed directly from the actual public Host. */
  #namespace: IRpcNamespace | undefined
  /** This is the actual public SDK owner, with no registration/invoke/events facade. */
  #member: RpcMemberGeneration<IManagedMemoryUnit, string> | undefined
  /** Native installation uses a distinct fixed identity per case. */
  readonly #name: string
  /** Optional native/feature recipes are retained only for genuine cold construction. */
  readonly #options: INativeMemberFixtureOptions

  /** Construct only cold native recipes; no Host, Session or accepted generation exists yet. */
  constructor(name: string, reports: unknown[] = [], options: INativeMemberFixtureOptions = {}) {
    this.#name = name
    this.#options = options
    this.reports = reports
    this.budget = createUnitBudget({
      kind: name,
      maxUnits: options.maxUnits ?? 1,
      launchRate: false,
      scheduler: this.scheduler
    })
    this.native = nativeManagedMemoryUnits({
      kind: name,
      provide: options.provide ?? (() => ({ value: () => 'result' })),
      contract: options.contract
    })
    this.supervisor = createSupervisor({
      id: name,
      spec: 'remote',
      launcher: this.native.launcher,
      profile: this.native.profile,
      budget: this.budget,
      scheduler: this.scheduler,
      report: this.report,
      restart: options.restart ?? { mode: 'never' },
      ready: options.ready
    })
  }

  /** Install the original native context before explicitly opening its actual member lifecycle. */
  async start(): Promise<void> {
    /** Retain the original root and its actual namespace without manufacturing an invocation API. */
    const host = await createRpcHost({
      self: { name: this.#name, instanceId: this.#name },
      plugins: [
        defineTransportPlugin({
          name: this.#name,
          namespace: 'memory',
          features: this.#options.features,
          open: this.#install
        })
      ],
      report: this.report
    })
    this.#host = host
    this.#namespace = host.memory
  }

  /** Read the same SDK instance that the genuine native installation owns and disposes. */
  get member(): RpcMemberGeneration<IManagedMemoryUnit, string> {
    assert(this.#member)
    return this.#member
  }

  /** Calls execute on the real namespace, while the SDK member supplies lifecycle only. */
  get namespace(): IRpcNamespace {
    assert(this.#namespace)
    return this.#namespace
  }

  /** Keep the original reporter receiver and exact diagnostic values. */
  readonly report = (error: unknown): void => {
    this.reports.push(error)
  }

  /** A listener-style native installation can attach its real member after cold namespace commit. */
  readonly #install = (context: IRpcTransportSetupContext) => {
    /** No test-side lifecycle generation, wait queue, or resource group is created. */
    const member = new RpcMemberGeneration({
      context,
      binding: {
        ownership: 'borrowed',
        supervisor: this.supervisor,
        scheduler: this.scheduler,
        openCarrier: this.#acquire
      },
      signal: context.signal,
      report: this.report,
      onReady: (_view, _generation, _unit, handle) => this.handles.push(handle)
    })
    this.#member = member
    return { dispose: () => member.close() }
  }

  /** Acquire the existing real MessagePort pair and delegate all attach/readiness to the SDK. */
  readonly #acquire = async (
    unit: IManagedMemoryUnit,
    _signal: IAbortSignal,
    ordinal: number
  ): Promise<IRpcMemberSource> => {
    /** Existing native fixture accepts only the opposite endpoint before returning this local one. */
    const source = await openManagedMemoryCarrier(unit.source, this.report)
    /** A passthrough spy preserves the carrier method's original receiver and Promise. */
    const originalClose = source.carrier.close
    /** Fault injection remains on that same acquired resource, never a surrogate channel. */
    const close = vi.spyOn(source.carrier, 'close')
    this.carriers.push({ source, originalClose, close })
    return this.prepareSource ? this.prepareSource(source, ordinal) : source
  }

  /** Count only this member's actual Session detach receipts, excluding unrelated remote tables. */
  sessionCleanupCount(): number {
    /** One temporary lookup set keeps passive counting linear in the actual observed operations. */
    const handles = new Set(this.handles)
    return this.detach.mock.calls.filter(([handle]) =>
      typeof handle === 'string' ? false : handles.has(handle)
    ).length
  }

  /** Repeated close invocations must share one real physical operation per acquired carrier. */
  physicalCleanupCount(): number {
    /** Distinct original Promise identities count physical cleanup, not repeated idempotent calls. */
    let count = 0
    for (const { close } of this.carriers) {
      /** Every observed result still belongs to the original carrier implementation. */
      const completions = new Set<unknown>()
      for (const result of close.mock.results)
        if (result.type === 'return') completions.add(result.value)
      count += completions.size
    }
    return count
  }

  /** Finally release the actual SDK, Host, native units and borrowed budget; retain cleanup errors. */
  async cleanup(): Promise<void> {
    for (const unit of this.native.units) unit.finish()
    /** These are original owner Promises, not a second cleanup transaction or wrapper lifecycle. */
    const results = await Promise.allSettled([
      this.#member?.close(),
      this.#host?.close(),
      this.supervisor.dispose(),
      ...this.native.units.map((unit) => unit.remote.close())
    ])
    for (const result of results) if (result.status === 'rejected') this.report(result.reason)
    this.budget.close()
    this.scheduler.advance(0)
    for (const { close } of this.carriers) close.mockRestore()
    this.attach.mockRestore()
    this.detach.mockRestore()
  }
}

// RPC-TEST-19CE78390954-C007: late acquired physical resources close before actual local attach.
it('closes a real carrier returned after member release before Session attachment', async () => {
  /** Only the original acquired source delivery is held. */
  const acquired = deferred<void>()
  /** Releasing the native result cannot fabricate a Session or accepted generation. */
  const deliver = deferred<void>()
  /** Actual SDK/native ownership remains independent from this one input gate. */
  const fixture = new NativeMemberFixture('proxy-late-carrier')
  fixture.prepareSource = async (source) => {
    acquired.resolve()
    await deliver.promise
    return source
  }
  try {
    await fixture.start()
    /** The original SDK opening Promise, rather than Root startup, owns this preparation result. */
    const pending = fixture.member.open()
    /** Observe its expected failure before releasing the genuine late native acquisition. */
    const rejected = expect(pending).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    await acquired.promise
    /** Every joiner observes the same actual member resource-release Promise. */
    const closing = fixture.member.close()
    expect(fixture.member.close()).toBe(closing)
    await closing
    deliver.resolve()
    await rejected
    expect(fixture.carriers[0]!.close).toHaveBeenCalledTimes(1)
    expect(
      fixture.attach.mock.calls.some(
        ([, carrier]) => carrier === fixture.carriers[0]!.source.carrier
      )
    ).toBe(false)
  } finally {
    deliver.resolve()
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C010: initial and replacement use the one genuine SDK resource owner.
it('shares actual member preparation and closes both accepted Session and carrier generations', async () => {
  /** Original reports remain unfiltered through both genuine native generations. */
  const fixture = new NativeMemberFixture('proxy-shared-member')
  try {
    await fixture.start()
    await fixture.member.open()
    /** Native exit itself is the only source of this original leave observation. */
    const left = deferred<unknown>()
    fixture.member.onLeave(1, left.resolve)
    fixture.native.units[0]!.exit({})
    await left.promise
    await fixture.member.whenClosed(1)
    await fixture.supervisor.restart()
    await fixture.member.rebind()
    /** Final release retains its original shared Promise identity. */
    const closing = fixture.member.close()
    expect(fixture.member.close()).toBe(closing)
    await closing
    expect(fixture.reports).toEqual([])
    expect(fixture.sessionCleanupCount()).toBe(2)
    expect(fixture.physicalCleanupCount()).toBe(2)
  } finally {
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C011: original2 callback slots are a separate NoPASS shape component.
it('retains the actual departing candidate until physical cleanup finishes across six generations', async () => {
  /** The original acquired carrier cleanup, rather than a synthetic endpoint, is held. */
  const closing = deferred<void>()
  /** Only the case completes this same original physical-release callback. */
  const finish = deferred<void>()
  /** Genuine generations continue to own actual MessagePorts and SessionTable handles. */
  const fixture = new NativeMemberFixture('proxy-retained-member')
  fixture.prepareSource = (source, ordinal) => {
    if (ordinal === 0) {
      /** One injected asynchronous native callback preserves the real close after the original gate. */
      const receipt = fixture.carriers[0]!
      receipt.close.mockImplementationOnce(async (reason) => {
        closing.resolve()
        await finish.promise
        await Reflect.apply(receipt.originalClose, source.carrier, [reason])
      })
    }
    return source
  }
  try {
    await fixture.start()
    await fixture.member.open()
    /** Native attempt generations are authoritative and need not match the unit acquisition count. */
    const firstGeneration = fixture.member.current().generation
    expect(fixture.member.retainedResourceCount()).toBe(1)
    fixture.native.units[0]!.exit({})
    await closing.promise
    expect(fixture.member.retainedResourceCount()).toBe(1)
    finish.resolve()
    await fixture.member.whenClosed(firstGeneration)
    await Promise.resolve()
    expect(fixture.member.retainedResourceCount()).toBe(0)
    for (let ordinal = 2; ordinal <= 6; ordinal++) {
      await fixture.supervisor.restart()
      await fixture.member.rebind()
      expect(fixture.member.retainedResourceCount()).toBe(1)
      if (ordinal === 6) break
      /** Explicit restart supersedes and begins native attempts; its generation may skip ordinals. */
      const generation = fixture.member.current().generation
      /** Real leave delivery precedes joining that generation's actual native cleanup. */
      const left = deferred<unknown>()
      fixture.member.onLeave(generation, left.resolve)
      fixture.native.units[ordinal - 1]!.exit({})
      await left.promise
      await fixture.member.whenClosed(generation)
      await Promise.resolve()
    }
    await fixture.member.close()
    expect(fixture.member.retainedResourceCount()).toBe(0)
  } finally {
    finish.resolve()
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C012 / A35: only the most recent departed generation retains its reason.
it('retains only the latest native leave reason and closes older generation observers without causes', async () => {
  /** Each lower-level unit failure must remain the actual Supervisor exit error's original cause. */
  const reasons = Array.from({ length: 5 }, (_, index) => new Error(`exit ${index + 1}`))
  /** The same manually driven native clock owns every late observer. */
  const fixture = new NativeMemberFixture('proxy-member-reasons')
  /** These passive receipts retain the exact event.error objects consumed by the SDK listener. */
  const nativeReasons: { generation: number; reason: unknown }[] = []
  /** Observe the genuine native event boundary; never unwrap its classified error or emit events. */
  const stopExitObservation = fixture.supervisor.subscribe((event) => {
    if (event.type === SupervisorEventType.exit)
      nativeReasons.push({ generation: event.generation, reason: event.error })
  })
  try {
    await fixture.start()
    for (const [index, reason] of reasons.entries()) {
      if (index === 0) await fixture.member.open()
      else {
        await fixture.supervisor.restart()
        await fixture.member.rebind()
      }
      /** The accepted native attempt identity, not the acquisition index, qualifies this observer. */
      const generation = fixture.member.current().generation
      /** Actual source departure, not an emitted test event, determines the generation result. */
      const left = deferred<unknown>()
      fixture.member.onLeave(generation, left.resolve)
      fixture.native.units[index]!.exit({ error: reason })
      expect(await left.promise).toBe(nativeReasons[index]!.reason)
      expect(nativeReasons[index]!.generation).toBe(generation)
      expect((nativeReasons[index]!.reason as Error).cause).toBe(reason)
      await fixture.member.whenClosed(generation)
    }
    expect(nativeReasons).toHaveLength(reasons.length)
    for (const [index, { generation, reason }] of nativeReasons.entries()) {
      /** Late observations use the same native clock without keeping every historical error alive. */
      const waiting = deferred<unknown>()
      fixture.member.onLeave(generation, waiting.resolve)
      fixture.scheduler.advance(0)
      if (index === nativeReasons.length - 1) expect(await waiting.promise).toBe(reason)
      else {
        expect(await waiting.promise).toMatchObject({
          code: RpcRemoteLayerErrorCode.closed,
          detail: { generation }
        })
        expect(await waiting.promise).not.toHaveProperty('cause')
      }
    }
    await fixture.member.close()
    /** A released member returns its actual closed result rather than a historical native error. */
    const afterRelease = deferred<unknown>()
    fixture.member.onLeave(nativeReasons[0]!.generation, afterRelease.resolve)
    fixture.scheduler.advance(0)
    expect(await afterRelease.promise).toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect(await afterRelease.promise).not.toBe(nativeReasons[0]!.reason)
  } finally {
    stopExitObservation()
    await fixture.cleanup()
  }
})

// A35: a failed newer native candidate cannot retire the still-serving accepted generation.
it('preserves the older active generation after a newer native replacement fails', async () => {
  /** This failure belongs to the real second native unit, while its predecessor remains ready. */
  const replacementFailure = new Error('replacement failed')
  /** A real start-then-switch replacement temporarily needs both original budget slots. */
  const fixture = new NativeMemberFixture('proxy-active-member-reason', [], {
    maxUnits: 2,
    ready: async (unit) => {
      if (unit === fixture.native.units[0]) return
      unit.exit({ error: replacementFailure })
      await unit.exited
      throw replacementFailure
    }
  })
  try {
    await fixture.start()
    /** A borrowed supervisor may already serve an older unit before the SDK opens its Session. */
    const started = await fixture.supervisor.start()
    assert(started.state === 'ready')
    const generation = started.generation
    await expect(
      fixture.supervisor.replace({ strategy: 'start-then-switch' })
    ).resolves.toMatchObject({
      kind: 'failed'
    })
    await fixture.member.open()
    /** An already accepted Session survives a second genuinely failed replacement as well. */
    await expect(
      fixture.supervisor.replace({ strategy: 'start-then-switch' })
    ).resolves.toMatchObject({ kind: 'failed' })
    expect(fixture.supervisor.generation).toBeGreaterThan(generation)
    expect(fixture.member.current()).toMatchObject({ generation, active: true })
    /** Registering after that failure must still observe the original unit's actual later exit. */
    const left = vi.fn()
    fixture.member.onLeave(generation, left)
    fixture.scheduler.advance(0)
    expect(left).not.toHaveBeenCalled()
    await expect(fixture.namespace.send('remote', 'value', null)).resolves.toBe('result')
    fixture.native.units[0]!.exit({})
    await fixture.member.whenClosed(generation)
    expect(left).toHaveBeenCalledTimes(1)
  } finally {
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C014: terminal comes from the actual native restart policy.
it('rejects actual terminal and released readiness without reviving an old native generation', async () => {
  /** Existing never-restart policy enters terminal on the genuine first failed unit. */
  const fixture = new NativeMemberFixture('proxy-terminal-member')
  try {
    await fixture.start()
    /** This waiter exists before native launch and never asks the SDK to fabricate a Session. */
    const waiting = fixture.member.whenReady(0)
    /** Preserve the exact original terminal error-code/detail predicate. */
    const rejected = expect(waiting).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.startFailed,
      detail: { state: 'terminal' }
    })
    await fixture.supervisor.start()
    fixture.native.units[0]!.exit({ error: new Error('budget exhausted') })
    await rejected
    await fixture.member.close()
    await expect(fixture.member.whenReady(0)).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed
    })
  } finally {
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C015: raw original leaves and rollback order remain canonical SDK output.
it('preserves native aggregate release errors and exact primary rollback error order', async () => {
  /** Original unfiltered reports span both real release and failed replacement. */
  const reports: unknown[] = []
  /** This raw native failure must survive the original aggregate without being reconstructed. */
  const releaseFailure = new Error('release failed')
  /** Initial release owns one genuine accepted Session and actual carrier. */
  const first = new NativeMemberFixture('proxy-release-failure', reports)
  first.prepareSource = (source) => {
    /** Physical IO is released before its original native failure crosses the supported boundary. */
    const receipt = first.carriers[0]!
    receipt.close.mockImplementationOnce(async (reason) => {
      await Reflect.apply(receipt.originalClose, source.carrier, [reason])
      throw releaseFailure
    })
    return source
  }
  try {
    await first.start()
    await first.member.open()
    /** Only the genuine resource owner may create the public aggregate. */
    const released = await first.member.close().catch((error: unknown) => error)
    expect(released).toBeInstanceOf(AggregateError)
    expect(released).toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect((released as AggregateError).errors).toContain(releaseFailure)
  } finally {
    await first.cleanup()
  }
  /** Supported source-context acquisition fails after the same actual candidate cleanup is owned. */
  const primary = new Error('replacement failed')
  /** The acquired replacement carrier supplies its independent original rollback failure. */
  const rollbackFailure = new Error('rollback failed')
  /** A fresh actual member avoids retargeting the released original registration. */
  const second = new NativeMemberFixture('proxy-rollback-failure', reports)
  second.prepareSource = (source, ordinal) => {
    if (ordinal !== 1) return source
    /** The acquired native carrier remains the exact rollback resource. */
    const receipt = second.carriers[1]!
    receipt.close.mockImplementationOnce(async (reason) => {
      await Reflect.apply(receipt.originalClose, source.carrier, [reason])
      throw rollbackFailure
    })
    return {
      ...source,
      get connectionContext(): IRpcConnectionContext {
        throw primary
      }
    }
  }
  try {
    await second.start()
    await second.member.open()
    /** The real Supervisor produces departure before the original explicit rebind joins. */
    const left = deferred<unknown>()
    second.member.onLeave(1, left.resolve)
    second.native.units[0]!.exit({})
    await left.promise
    await second.member.whenClosed(1)
    await second.supervisor.restart()
    await expect(second.member.rebind()).rejects.toBe(primary)
    /** Find the actual SDK report; public codes are never used to construct a trusted error. */
    const rollback = reports.find(
      (error) =>
        error instanceof AggregateError &&
        (error as AggregateError & { code?: string }).code === RpcRemoteLayerErrorCode.startFailed
    ) as AggregateError | undefined
    expect(rollback?.errors).toEqual([primary, rollbackFailure])
  } finally {
    await second.cleanup()
  }
})

/** One real handshake stage holds admission; it does not replace Session readiness or its handle. */
class NativeHandshakeGate {
  /** Cases can first accept one real Session before holding its replacement handshake. */
  hold = true
  /** The actual installed inbound handshake stage signals entry before its original continuation. */
  readonly entered = deferred<void>()
  /** A case releases this one input gate without completing a counterfeit Session. */
  readonly resume = deferred<void>()
  /** Genuine native Feature construction uses the same grouped pipeline as application features. */
  readonly feature = defineFlowFeature({
    name: 'proxy-native-handshake-gate',
    setup: () => ({ stages: { [RpcFlowPoint.handshakeInbound]: this.#wait } })
  })

  /** Hold only the chosen real handshake, without replacing its original continuation. */
  readonly #wait: IRpcFlowStage<typeof RpcFlowPoint.handshakeInbound> = async (payload, next) => {
    if (this.hold) {
      this.entered.resolve()
      await this.resume.promise
    }
    await next(payload)
  }
}

// RPC-TEST-19CE78390954-C002: R8 removes the automatic default; explicit retry owns the same replay.
it('replays a written idempotent public request through the complete retry feature', async () => {
  /** The first real provider invocation remains unsettled until after its native generation leaves. */
  const first = deferred<string>()
  /** Real provider entry proves that the request crossed its original physical carrier. */
  const entered = deferred<void>()
  /** Only the replacement generation's original recorded request window is counted. */
  const replacementRequest = vi.fn(() => 'result')
  /** Native, Host and origin retry diagnostics retain one unfiltered original report window. */
  const reports: unknown[] = []
  /** A genuine policy may await explicit replacement without immediately entering terminal. */
  const fixture = new NativeMemberFixture('proxy-public-retry', reports, {
    restart: { mode: 'always', initialDelayMs: 0, maxDelayMs: 0 },
    contract: {
      schemaVersion: 1,
      plugin: 'p',
      features: { f: { methods: { request: { mode: 'request', idempotent: true } } } }
    },
    provide: (ordinal) => ({
      p: {
        f: {
          request:
            ordinal === 1
              ? () => {
                  entered.resolve()
                  return first.promise
                }
              : replacementRequest
        }
      }
    })
  })
  try {
    await fixture.start()
    await fixture.member.open()
    /** The actual selected origin feature alone may wait and replay after native departure. */
    const result = fixture.namespace.send('remote', 'p.f.request', [], {
      retry: retry({ scheduler: fixture.scheduler, report: fixture.report })
    })
    await entered.promise
    /** The original synchronous exit preceded replacement; join that same real native event here. */
    const departed = deferred<unknown>()
    fixture.member.onLeave(fixture.member.current().generation, departed.resolve)
    fixture.native.units[0]!.exit({ error: new Error('gone') })
    await departed.promise
    await fixture.supervisor.restart()
    await fixture.member.rebind()
    await expect(result).resolves.toBe('result')
    expect(replacementRequest).toHaveBeenCalledTimes(1)
    /** The departed attempt's canonical unknown-result rejection is normal retry settlement. */
    expect(reports).toEqual([])
    first.reject(new Error('late failure'))
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    expect(reports).toEqual([])
  } finally {
    first.resolve('result')
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C003: preserve the original release trigger and unknown-result code.
it('settles a physically written public request when its actual member is released', async () => {
  /** Real request dispatch supplies the physical-write checkpoint without a synthetic sent flag. */
  const entered = deferred<void>()
  /** This is original provider work, independent from the caller's canonical reply record. */
  const finish = deferred<string>()
  /** Explicit member release must be distinguished from a manufactured native crash. */
  const fixture = new NativeMemberFixture('proxy-written-release', [], {
    provide: () => ({
      p: {
        f: {
          request: () => {
            entered.resolve()
            return finish.promise
          }
        }
      }
    })
  })
  try {
    await fixture.start()
    await fixture.member.open()
    /** Observe the same actual public rejection, retaining the old unknown-result oracle. */
    const result = fixture.namespace
      .send('remote', 'p.f.request', [])
      .catch((error: unknown) => error)
    await entered.promise
    /** The real resource holder owns release; native departure is not substituted for this input. */
    const released = fixture.member.close()
    expect(await result).toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
    await released
  } finally {
    finish.resolve('result')
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C004: public publication/rebind and the actual held callable stay distinct.
it('publishes real ready generations and fences an actual held callable across native rebind', async () => {
  /** The original business values and payloads belong to each real provider invocation. */
  const request = vi.fn((_payload: IRpcPortableValue | undefined) => 'result')
  /** The same namespace survives replacement while its accepted capability objects do not. */
  const fixture = new NativeMemberFixture('proxy-public-rebind', [], {
    provide: () => ({ p: { f: { request } } })
  })
  try {
    await fixture.start()
    await fixture.member.open()
    /** Native authority supplies the first accepted generation, not a second test counter. */
    const first = fixture.member.current().generation
    expect(first).toBe(1)
    /** Reflection reads only the existing public nested capability tree. */
    const namespace = fixture.namespace
    /** The currently published peer object belongs to the first actual accepted Session. */
    const peer = namespace.peers.remote!
    /** The original plugin group and Feature group are public directory projections. */
    const plugin = Reflect.get(peer, 'p')
    /** The real method group is never replaced by a compatibility invocation facade. */
    const feature = Reflect.get(plugin, 'f')
    /** Keep this exact original callable after the display name is accepted again. */
    const held: (payload: IRpcPortableValue) => Promise<unknown> = Reflect.get(feature, 'request')
    await expect(held(['first'])).resolves.toBe('result')
    /** Passive leave receipts preserve exact once and ordering before real Session detach. */
    const leaves: string[] = []
    /** This observation records only how many actual Session disposals have begun at leave time. */
    let detachesAtLeave = -1
    fixture.member.onLeave(first, () => {
      leaves.push('leave')
      detachesAtLeave = fixture.sessionCleanupCount()
    })
    fixture.native.units[0]!.exit({ error: new Error('gone') })
    await fixture.member.whenClosed(first)
    expect(leaves).toEqual(['leave'])
    expect(detachesAtLeave).toBe(0)
    expect(fixture.member.current()).toEqual({ generation: first, active: false })
    /** Only real accepted later readiness may authorize a newly obtained public callable. */
    const ready = fixture.member.whenReady(first)
    /** Explicit native restart supplies its actual possibly non-contiguous attempt generation. */
    const outcome = await fixture.supervisor.restart()
    assert(outcome.state === 'ready')
    await fixture.member.rebind()
    await expect(ready).resolves.toBe(outcome.generation)
    expect(outcome.generation).toBeGreaterThan(first)
    expect(fixture.namespace).toBe(namespace)
    await expect(namespace.send('remote', 'p.f.request', ['second'])).resolves.toBe('result')
    /** R20/BC11 item24 preserves the held-generation fence; readiness alone cannot prove it. */
    await expect(held(['closed'])).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
    expect(request.mock.calls.map(([payload]) => payload)).toEqual([['first'], ['second']])
    await fixture.member.close()
    expect(fixture.sessionCleanupCount()).toBe(2)
    expect(fixture.physicalCleanupCount()).toBe(2)
  } finally {
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C006: actual handshake replaces only the removed describe stimulus.
it('rejects native departure during a real handshake and closes its actual candidate', async () => {
  /** The genuine inbound handshake remains pending when native departure occurs. */
  const gate = new NativeHandshakeGate()
  /** A nonterminal native policy preserves the original pending readiness until explicit release. */
  const fixture = new NativeMemberFixture('proxy-departed-native-handshake', [], {
    features: [gate.feature],
    restart: { mode: 'always', initialDelayMs: 0, maxDelayMs: 0 }
  })
  try {
    await fixture.start()
    /** Actual accepted readiness cannot be fabricated by the test or the native launch outcome. */
    const ready = fixture.member.whenReady(0)
    /** Final original resource release must settle this waiter with the same closed code. */
    const releasedReady = expect(ready).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed
    })
    /** The actual SDK initial preparation owns acquisition, attach, ready failure and rollback. */
    const pending = fixture.member.open()
    /** Preserve the original code/detail oracle even if the new canonical phase exposes a defect. */
    const rejected = expect(pending).rejects.toMatchObject({
      code: RpcRemoteLayerErrorCode.closed,
      detail: { generation: 1 }
    })
    await gate.entered.promise
    fixture.native.units[0]!.exit({ error: new Error('gone') })
    gate.resume.resolve()
    await rejected
    expect(fixture.member.current().active).toBe(false)
    /** Find the genuine failed Session by the exact acquired local carrier identity. */
    const attachedAt = fixture.attach.mock.calls.findIndex(
      ([, carrier]) => carrier === fixture.carriers[0]!.source.carrier
    )
    /** The actual original attach result remains observable even when onReady never publishes it. */
    const candidate = fixture.attach.mock.results[attachedAt]!.value as IRpcSessionHandle
    expect(fixture.detach.mock.calls.some(([handle]) => handle === candidate)).toBe(true)
    expect(fixture.carriers[0]!.close).toHaveBeenCalled()
    await fixture.member.close()
    await releasedReady
  } finally {
    gate.resume.resolve()
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C008 / A37: each caller can abandon only its own shared rebind wait.
it('keeps shared native rebind alive when its first caller cancels only its own wait', async () => {
  /** Only the first caller receives cancellation; its original reason remains reachable. */
  const controller = new AbortController()
  const reason = new Error('setup cancelled')
  /** A real installed handshake stage delays only its original continuation. */
  const gate = new NativeHandshakeGate()
  gate.hold = false
  /** The original accepted Session enables the real native observation/reconciliation loop. */
  const fixture = new NativeMemberFixture('proxy-late-native-setup', [], {
    features: [gate.feature]
  })
  try {
    await fixture.start()
    await fixture.member.open()
    const previous = fixture.member.current().generation
    gate.hold = true
    fixture.native.units[0]!.exit({})
    await fixture.member.whenClosed(previous)
    const restarted = await fixture.supervisor.restart()
    assert(restarted.state === 'ready')
    /** Two public callers and the queued native reconcile share one actual acquired candidate. */
    const first = fixture.member.rebind(controller.signal).catch((error: unknown) => error)
    const second = fixture.member.rebind().then(
      (generation) => ({ generation }),
      (error: unknown) => ({ error })
    )
    await gate.entered.promise
    fixture.scheduler.advance(0)
    controller.abort(reason)
    gate.resume.resolve()
    expect(await second).toEqual({ generation: restarted.generation })
    /** Canonical cancellation retains this caller's exact original reason, not an equal copy. */
    const cancellation = await first
    assert(cancellation instanceof UtilsAbortError)
    expect(cancellation.cause).toBe(reason)
    expect(fixture.member.current()).toMatchObject({
      active: true,
      generation: restarted.generation
    })
    await expect(fixture.namespace.send('remote', 'value', null)).resolves.toBe('result')
    expect(fixture.carriers).toHaveLength(2)
    expect(fixture.member.retainedResourceCount()).toBe(1)
    expect(fixture.physicalCleanupCount()).toBe(1)
    expect(fixture.reports).toEqual([])
  } finally {
    gate.resume.resolve()
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C009-A002/A003: old unavailable REMOTE_CLOSED atom remains pending.
it('keeps unavailable public work off the wire and reports the original native leave listener error', async () => {
  /** This actual listener error is retained without stringifying it at the reporting boundary. */
  const failure = new Error('listener')
  /** The genuine namespace exists before any native unit or Session has been acquired. */
  const fixture = new NativeMemberFixture('proxy-native-listener-error')
  try {
    await fixture.start()
    /** Observe, but do not relabel, the unsupported old synchronous REMOTE_CLOSED guard result. */
    const unavailable = await fixture.namespace
      .send('remote', 'value', [])
      .catch((error: unknown) => error)
    expect(unavailable).toBeInstanceOf(Error)
    expect(fixture.carriers).toHaveLength(0)
    await fixture.member.open()
    /** Actual SDK listener isolation owns this failure and continues its normal native cleanup. */
    fixture.member.onLeave(fixture.member.current().generation, () => {
      throw failure
    })
    fixture.native.units[0]!.exit({})
    await fixture.member.whenClosed(fixture.supervisor.generation)
    expect(fixture.reports.some((error) => String(error).includes('Error: listener'))).toBe(true)
    expect(fixture.reports).toContain(failure)
  } finally {
    await fixture.cleanup()
  }
})

// RPC-TEST-19CE78390954-C013: real complete timeout features replace removed private options DTOs.
it('caps public scalar and stream deadlines while one notify creates no scalar request record', async () => {
  /**
   * Remote notification entry is the actual business completion checkpoint, not a local write
   * guess.
   */
  const notified = deferred<void>()
  /** The real one-way provider owns its original invocation count. */
  const oneWay = vi.fn(() => notified.resolve())
  /** Real native declaration supplies the execution wall cap outside optional call policies. */
  const fixture = new NativeMemberFixture('proxy-native-call-cap', [], {
    provide: () => ({
      p: {
        f: {
          request: () => 'result',
          async *generator() {
            yield 'item'
          },
          oneWay
        }
      }
    })
  })
  fixture.prepareSource = (source) => ({
    ...source,
    localSourceFacts: {
      ...source.localSourceFacts,
      callTimeoutCap: timeout({ ms: 50, scheduler: fixture.scheduler })
    }
  })
  /** Passthrough scheduler observation records actual armed policy budgets, not a parallel limiter. */
  const scheduled = vi.spyOn(fixture.scheduler, 'schedule')
  /** The canonical call entry distinguishes physical notify from scalar request admission. */
  const invoked = vi.spyOn(CallTable.prototype, 'invoke')
  try {
    await fixture.start()
    await fixture.member.open()
    scheduled.mockClear()
    await fixture.namespace.send('remote', 'p.f.request', [], {
      timeout: timeout({ ms: 90, scheduler: fixture.scheduler })
    })
    expect(scheduled.mock.calls.map(([, ms]) => ms)).toEqual([50, 50])
    scheduled.mockClear()
    await fixture.namespace.send('remote', 'p.f.request', [], {
      timeout: timeout({ ms: 20, scheduler: fixture.scheduler })
    })
    expect(scheduled.mock.calls.map(([, ms]) => ms)).toEqual([50, 20])
    scheduled.mockClear()
    /** The actual public lazy iterator runs through the original stream owner and timeout policies. */
    const stream = fixture.namespace.streamTo('remote', 'p.f.generator', [], {
      timeout: timeout({ ms: 90, scheduler: fixture.scheduler })
    })
    try {
      expect(await stream.next()).toEqual({ value: 'item', done: false })
      expect(scheduled.mock.calls.map(([, ms]) => ms)).toEqual([50, 50])
    } finally {
      await stream.return?.()
    }
    /** Count the original scalar calls before one actual public notification is admitted. */
    const beforeOneWay = invoked.mock.calls.filter(
      ([, command]) => command.mode === 'request'
    ).length
    scheduled.mockClear()
    await fixture.namespace.notify('p.f.oneWay', [], { targetId: 'remote' })
    await notified.promise
    expect(scheduled.mock.calls.map(([, ms]) => ms)).toEqual([50])
    expect(oneWay).toHaveBeenCalledTimes(1)
    expect(invoked.mock.calls.filter(([, command]) => command.mode === 'request')).toHaveLength(
      beforeOneWay
    )
    expect(invoked.mock.calls.filter(([, command]) => command.mode === 'notify')).toHaveLength(1)
  } finally {
    scheduled.mockRestore()
    invoked.mockRestore()
    await fixture.cleanup()
  }
})
