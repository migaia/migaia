/** Original member lifecycle business runs on actual SDK generations, Sessions and native ports. */
import { assert, expect, it, vi, type MockInstance } from 'vitest'
import {
  createSupervisor,
  createUnitBudget,
  SupervisorEventType,
  type ISupervisor
} from '@migaia/supervision'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  defineTransportPlugin,
  RpcMemberGeneration,
  type IRpcMemberSource,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrier,
  IRpcConnectionContext,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { SessionTable } from '../../dist/session/table.js'
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
  /** This is the actual public SDK owner, with no registration/invoke/events facade. */
  #member: RpcMemberGeneration<IManagedMemoryUnit, string> | undefined
  /** Native installation uses a distinct fixed identity per case. */
  readonly #name: string

  /** Construct only cold native recipes; no Host, Session or accepted generation exists yet. */
  constructor(name: string, reports: unknown[] = []) {
    this.#name = name
    this.reports = reports
    this.budget = createUnitBudget({
      kind: name,
      maxUnits: 1,
      launchRate: false,
      scheduler: this.scheduler
    })
    this.native = nativeManagedMemoryUnits({
      kind: name,
      provide: () => ({ value: () => 'result' })
    })
    this.supervisor = createSupervisor({
      id: name,
      spec: 'remote',
      launcher: this.native.launcher,
      profile: this.native.profile,
      budget: this.budget,
      scheduler: this.scheduler,
      report: this.report,
      restart: { mode: 'never' }
    })
  }

  /** Install the original native context before explicitly opening its actual member lifecycle. */
  async start(): Promise<void> {
    this.#host = await createRpcHost({
      self: { name: this.#name, instanceId: this.#name },
      plugins: [
        defineTransportPlugin({
          name: this.#name,
          namespace: 'memory',
          open: this.#install
        })
      ],
      report: this.report
    })
  }

  /** Read the same SDK instance that the genuine native installation owns and disposes. */
  get member(): RpcMemberGeneration<IManagedMemoryUnit, string> {
    assert(this.#member)
    return this.#member
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

// RPC-TEST-19CE78390954-C012: exact late reason identities replace only the removed debug counter.
it('retains five actual native leave reasons by identity until final member release', async () => {
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
    for (const { generation, reason } of nativeReasons) {
      /** The genuine SDK stores the historical reason and defers notification on its native clock. */
      const waiting = deferred<unknown>()
      fixture.member.onLeave(generation, waiting.resolve)
      fixture.scheduler.advance(0)
      expect(await waiting.promise).toBe(reason)
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
