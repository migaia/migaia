/** Native installation commit, rollback and cancellation retain the original business oracles. */
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode
} from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createRpcAbortError } from '../../dist/host/error-owner.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import * as catalog from '../../dist/dispatch/catalog.js'
import * as exposure from '../../dist/dispatch/exposure.js'
import type { IProviderCommitGate } from '../../dist/dispatch/types.js'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { coreMemoryServer } from '../host/core-fixture.js'

/** The existing connection owns the exact public Host rather than a per-session Peer facade. */
type IConnectedHost = Awaited<ReturnType<ReturnType<typeof coreMemoryServer>['connect']>>['host']

/** Preserve complete local and wire error classification in the acceptance evidence. */
function classify(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return { value: String(error) }
  return {
    name: Reflect.get(error, 'name'),
    source: Reflect.get(error, 'source'),
    code: Reflect.get(error, 'code'),
    reason: Reflect.get(error, 'reason'),
    message: Reflect.get(error, 'message'),
    cause:
      Reflect.get(error, 'cause') === undefined ? undefined : classify(Reflect.get(error, 'cause'))
  }
}

/** Observe rejection immediately so pre-commit failures cannot become unhandled rejections. */
function observe<T>(operation: Promise<T>) {
  return operation.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )
}

/** Own one genuine uncommitted native batch and its existing physical caller fixture. */
class ServeCommitBarrier {
  /** Feature and SDK transport registrations share the original native commit decision. */
  readonly #host = new PluginHost<Record<string, never>>({
    identity: { name: 'provider' },
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The canonical memory listener lends actual SDK attach and bilateral Session negotiation. */
  readonly #server = coreMemoryServer('provider', 'provider-1', 'memory', [], ['business'])
  /** Only the native installation's existing continuation is held by this acceptance fixture. */
  readonly #release = deferred<void>()
  /** This receipt means the actual SDK transport install has returned its original resources. */
  readonly #prepared = deferred<void>()
  /** Waiters borrow the true number of original native gate waits, never synthetic arrivals. */
  readonly #admissionWaiters: { count: number; resolve(): void }[] = []
  /** Actual visits to the one native gate retain admission count without replacing its identity. */
  readonly #arrivals: string[] = []
  /** Caller report and the ordinary native owner's actual default reporter retain original errors. */
  readonly #reports: unknown[] = []
  /** A caller-independent wait on the original native gate proves the real rollback cause. */
  #rollbackGate: Promise<{ value: void } | { error: unknown }> | undefined
  /** Business entry counts remain independent from admission and one-way physical completion. */
  readonly #calls = { request: 0, notify: 0, stream: 0 }
  /** Genuine notification business completion is independent from caller write settlement. */
  readonly #notified = deferred<void>()
  /** The later native registration preserves this exact installation primary on rollback. */
  readonly #installFailure = new Error('serve-after-commit install failure')
  /** One test scenario selects commit or native rollback after actual preparation. */
  readonly #rollback: boolean
  /** One introduced lookup regression uses an actual accepted downstream business peer. */
  readonly #forwarded: boolean
  /** The caller is the real Host returned by the canonical memory fixture. */
  #caller: IConnectedHost | undefined
  /** The real business peer is independently closed through its original public Host. */
  #downstream: IConnectedHost | undefined
  /** Cleanup always joins the exact original native use batch. */
  #installing: Promise<unknown> | undefined
  /** Canonical compiler observation is restored by this same test owner. */
  #observation: { mockRestore(): void } | undefined
  /** The ordinary RPC owner's existing public default sink is observed without replacing policy. */
  #reportObservation: { mockRestore(): void } | undefined
  /** All selected entries borrow one observed original gate after their callable is compiled. */
  #forwardGateObservation: { mockRestore(): void } | undefined
  /** The unchanged canonical exposure compiler remains the only method producer. */
  readonly #expose = exposure.exposedProvide

  /** Capture only the scenario decision before any native registration is opened. */
  constructor(rollback: boolean, forwarded: boolean) {
    this.#rollback = rollback
    this.#forwarded = forwarded
  }

  /** Build the actual application Feature without direct provider registration or early commit. */
  #business() {
    return definePlugin({
      name: 'business',
      features: {
        methods: defineFeature(() => ({
          request: (payload: unknown) => {
            this.#calls.request += 1
            return payload
          },
          notify: () => {
            this.#calls.notify += 1
            this.#notified.resolve()
          },
          stream: () => this.#stream()
        }))
      },
      install: () => ({})
    })
  }

  /** Construction, yields and terminal value remain the original business generator. */
  *#stream() {
    this.#calls.stream += 1
    yield 1
    yield 2
    yield 3
    return 4
  }

  /** Observe the actual captured gate without replacing method identity or native availability. */
  readonly #observeProvide = (...args: Parameters<typeof exposure.exposedProvide>) => {
    /** Only the original exposure compiler produces this exact method graph. */
    const provide = this.#expose(...args)
    for (const entry of catalog.compileProviderMethods(provide).values()) {
      if (entry.kind === 'forward') {
        this.#observeGate(args[2])
        continue
      }
      /** This is the installer's genuine metadata, not a fixture-created commit gate. */
      const gate = catalog.readProviderCommitGate(entry.method)
      if (gate) this.#observeGate(gate)
    }
    return provide
  }

  /** Preserve the exact gate while observing genuine pre-commit invocation waits. */
  #observeGate(gate: IProviderCommitGate): void {
    if (this.#rollback && this.#rollbackGate === undefined)
      this.#rollbackGate = observe(gate.wait(new AbortController().signal))
    if (this.#forwardGateObservation) return
    /** The existing native gate retains its original wait callback and Promise implementation. */
    const observation = { owner: this, wait: gate.wait }
    this.#forwardGateObservation = vi.spyOn(gate, 'wait').mockImplementation((signal) => {
      observation.owner.#recordArrival('native-install')
      return observation.wait(signal)
    })
  }

  /** Native gate visits share one observation count without another execution or admission path. */
  #recordArrival(name: string): void {
    this.#arrivals.push(name)
    for (const waiter of this.#admissionWaiters)
      if (this.#arrivals.length >= waiter.count) waiter.resolve()
  }

  /** Connect one genuine business peer before preparing a separate native forwarding candidate. */
  async #openBusinessPeer(): Promise<void> {
    /** This committed namespace owns the real accepted downstream Session and its native index. */
    const back = coreMemoryServer('provider', 'provider-back', 'back')
    await this.#host.use(back.transport)
    /** Only the actual downstream callback increments execution for the forwarding regression. */
    const connected = await back.connect(
      'business',
      {
        provide: {
          request: (payload: unknown) => {
            this.#calls.request += 1
            return payload
          }
        },
        report: (error) => this.#reports.push(error)
      },
      'business-1'
    )
    this.#downstream = connected.host
  }

  /** Hold only the original SDK install result before the actual native batch may commit. */
  #runtime() {
    /** Canonical memory admission supplies all real carrier and handshake behavior. */
    const transport = this.#server.transport
    return definePlugin({
      ...transport,
      install: async (core) => {
        /** Original native resources are already acquired before this continuation is withheld. */
        const installed = await transport.install!(core)
        this.#prepared.resolve()
        await this.#release.promise
        return installed
      }
    })
  }

  /** Open the real listener batch before connecting its actual public caller. */
  async open() {
    this.#observation = vi
      .spyOn(exposure, 'exposedProvide')
      .mockImplementation(this.#observeProvide)
    this.#reportObservation = vi.spyOn(console, 'error').mockImplementation((error: unknown) => {
      this.#reports.push(error)
    })
    if (this.#forwarded) await this.#openBusinessPeer()
    /** A later genuine native registration selects rollback only after transport preparation. */
    const tail = definePlugin({
      name: 'tail',
      install: () => {
        if (this.#rollback) throw this.#installFailure
        return {}
      }
    })
    this.#installing = this.#host.use(
      ...(this.#forwarded ? [] : [this.#business()]),
      this.#runtime(),
      tail
    )
    void this.#installing.catch(() => undefined)
    await this.#prepared.promise
    /** The existing fixture owns both original MemoryCarrier endpoints and their ready receipts. */
    const connected = await this.#server.connect(
      'caller',
      { report: (error) => this.#reports.push(error) },
      'caller-1'
    )
    this.#caller = connected.host
    return {
      caller: this.#caller,
      calls: this.#calls,
      arrivals: this.#arrivals,
      reports: this.#reports,
      installFailure: this.#installFailure,
      rollbackGate: this.#rollbackGate,
      notified: this.#notified.promise,
      installing: this.#installing,
      waitForArrivals: (count: number) => this.#waitForArrivals(count),
      release: () => this.#release.resolve(),
      close: () => this.#close()
    }
  }

  /** Join true admission visits without a fixture timer or a parallel dispatch path. */
  #waitForArrivals(count: number): Promise<void> {
    if (this.#arrivals.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#admissionWaiters.push({ count, resolve }))
  }

  /** Release the original batch before draining the actual caller, native owner and observations. */
  async #close(): Promise<void> {
    this.#release.resolve()
    try {
      await this.#installing?.catch(() => undefined)
      await this.#caller?.close()
      await this.#downstream?.close()
      await this.#host.dispose()
    } finally {
      this.#observation?.mockRestore()
      this.#reportObservation?.mockRestore()
      this.#forwardGateObservation?.mockRestore()
    }
  }
}

/** Open one bounded original acceptance scenario through its explicit fixture owner. */
function installBarrier(rollback = false, forwarded = false) {
  return new ServeCommitBarrier(rollback, forwarded).open()
}

describe('runtime exposed methods serve after commit', () => {
  it('holds request, notify and stream until the installing Host batch commits', async () => {
    /** A real paused Host install makes arrival timing deterministic for all three call kinds. */
    const fixture = await installBarrier()
    /** Request and stream outcomes are handled before the original guard can reject either one. */
    const request = observe(fixture.caller.memory.request('business.request', 'committed'))
    /** Notify's caller completion proves only physical send completion. */
    const notify = fixture.caller.memory.notify('business.notify')
    /** A first pull sends the actual stream-open call before commit. */
    const iterator = fixture.caller.memory.stream(
      'business.stream'
    ) as AsyncIterableIterator<unknown>
    /** Capture the whole iterable to reject a Promise-returning stream registration. */
    const stream = observe(
      (async () => {
        /** Every value comes from the business generator rather than a fixture dispatcher. */
        const values: unknown[] = []
        while (true) {
          /** The terminal value belongs to the business iterator and must survive the held wrapper. */
          const next = await iterator.next()
          if (next.done) return { values, terminal: next.value }
          values.push(next.value)
        }
      })()
    )
    try {
      await notify
      await fixture.waitForArrivals(3)
      expect(fixture.arrivals).toHaveLength(3)
      expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
      fixture.release()
      await fixture.installing
      /** Main's red outcome is recorded with its complete semantic classification. */
      const requestResult = await request
      /** Stream guard failures carry the same registration-revoked root on original main. */
      const streamResult = await stream
      if ('error' in requestResult || 'error' in streamResult)
        console.info(
          '[serve-commit red]',
          JSON.stringify({
            request: 'error' in requestResult ? classify(requestResult.error) : requestResult,
            stream: 'error' in streamResult ? classify(streamResult.error) : streamResult,
            reports: fixture.reports.map(classify)
          })
        )
      expect(requestResult).toEqual({ value: 'committed' })
      expect(streamResult).toEqual({ value: { values: [1, 2, 3], terminal: 4 } })
      await fixture.notified
      expect(fixture.calls).toEqual({ request: 1, notify: 1, stream: 1 })
    } finally {
      await fixture.close()
      await Promise.all([request, stream])
    }
  })

  it('refuses all held calls when the prepared install batch rolls back', async () => {
    /** A later install failure rolls back the same genuine prepared runtime registration. */
    const fixture = await installBarrier(true)
    /** Caller outcomes are recorded immediately because rollback may close their transport first. */
    const request = observe(fixture.caller.memory.request('business.request', 'rolled-back'))
    /** Notify remains one-way even though its target later reports a gate refusal. */
    const notify = fixture.caller.memory.notify('business.notify')
    /** First pull admits the real stream before the batch's rollback decision. */
    const iterator = fixture.caller.memory.stream(
      'business.stream'
    ) as AsyncIterableIterator<unknown>
    /** A stream refusal belongs to its consumer rather than an invented notify response. */
    const stream = observe(iterator.next())
    try {
      await expect(notify).resolves.toBeUndefined()
      await fixture.waitForArrivals(3)
      expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
      fixture.release()
      /** Host failure retains the separate original install error on its own cause chain. */
      const installation = await observe(fixture.installing)
      expect(installation).toHaveProperty('error')
      if ('error' in installation)
        expect((installation.error as Error).cause).toBe(fixture.installFailure)
      /** The lifecycle refusal must be the gate's exact TARGET_UNKNOWN and Host abort reason. */
      const gateResult = await fixture.rollbackGate
      expect(gateResult).toHaveProperty('error')
      if (gateResult && 'error' in gateResult) {
        expect(gateResult.error).toMatchObject({
          source: 'rpc.endpoint',
          code: RpcCoreErrorCode.targetUnknown
        })
        /** Rollback's lifecycle reason is a real PluginHostError, independent of the install cause. */
        const lifecycleReason = (gateResult.error as Error).cause
        expect(lifecycleReason).toBeInstanceOf(PluginHostError)
        expect(lifecycleReason).toMatchObject({ code: PluginHostErrorCode.hostDisposing })
        expect(lifecycleReason).not.toBe(fixture.installFailure)
      }
      /** The accepted caller alternatives are target refusal or the existing close classification. */
      const requestResult = await request
      /** Stream may lose its error response to the same rollback transport close. */
      const streamResult = await stream
      console.info(
        '[serve-commit rollback]',
        JSON.stringify({
          request: 'error' in requestResult ? classify(requestResult.error) : requestResult,
          stream: 'error' in streamResult ? classify(streamResult.error) : streamResult,
          gate: gateResult && 'error' in gateResult ? classify(gateResult.error) : gateResult,
          reports: fixture.reports.map(classify)
        })
      )
      expect(requestResult).toHaveProperty('error')
      expect(streamResult).toHaveProperty('error')
      for (const result of [requestResult, streamResult]) {
        if ('error' in result)
          expect([RpcCoreErrorCode.targetUnknown, RpcCoreErrorCode.transport]).toContain(
            Reflect.get(result.error as object, 'code')
          )
      }
      expect(
        fixture.reports.some(
          (error) =>
            error !== null &&
            typeof error === 'object' &&
            Reflect.get(error, 'code') === RpcCoreErrorCode.targetUnknown
        )
      ).toBe(true)
      expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
    } finally {
      await fixture.close()
      await Promise.all([request, stream])
    }
  })

  it.each(['abort', 'deadline'] as const)(
    'never invokes held request or stream after caller %s, then admits fresh calls',
    async (interruption) => {
      /** Both provider owners remain behind one genuine uncommitted Host batch. */
      const fixture = await installBarrier()
      /** Shared caller cancellation reaches each operation's original provider context signal. */
      const controller = new AbortController()
      /** Existing stream cancellation preserves the caller's exact reason rather than replacing it. */
      const cancellation = createRpcAbortError()
      /** Deadline expiry uses the complete timeout feature, with no fixture timer. */
      const options =
        interruption === 'abort' ? { signal: controller.signal } : { timeout: timeout({ ms: 20 }) }
      /** Handle caller failure immediately while waiting for actual provider admission. */
      const request = observe(
        fixture.caller.memory.request('business.request', interruption, options)
      )
      /** First pull admits the stream's own signal-aware gate branch. */
      const iterator = fixture.caller.memory.stream(
        'business.stream',
        interruption,
        options
      ) as AsyncIterableIterator<unknown>
      /** Stream and scalar outcomes are independent cancellations, even under one caller signal. */
      const stream = observe(iterator.next())
      try {
        await fixture.waitForArrivals(2)
        expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
        if (interruption === 'abort') controller.abort(cancellation)
        /** Caller classification remains its existing cancellation or timeout contract. */
        const expectedCode =
          interruption === 'abort' ? RpcCoreErrorCode.cancelled : RpcCoreErrorCode.deadlineExceeded
        expect(await request).toMatchObject({ error: { code: expectedCode } })
        /** Both call kinds keep CANCELLED while stream additionally retains exact reason identity. */
        const streamResult = await stream
        expect(streamResult).toMatchObject({ error: { code: expectedCode } })
        if (interruption === 'abort' && 'error' in streamResult)
          expect(streamResult.error).toBe(cancellation)
        fixture.release()
        await fixture.installing
        /** Interrupted methods stay uninvoked when the shared install gate eventually opens. */
        expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
        expect(await fixture.caller.memory.request('business.request', 'fresh')).toBe('fresh')
        /** A fresh generator proves stream registration remains usable after held interruption. */
        const fresh: unknown[] = []
        for await (const value of fixture.caller.memory.stream(
          'business.stream'
        ) as AsyncIterableIterator<unknown>)
          fresh.push(value)
        expect(fresh).toEqual([1, 2, 3])
        expect(fixture.calls).toEqual({ request: 1, notify: 0, stream: 1 })
      } finally {
        await fixture.close()
        await Promise.all([request, stream])
      }
    }
  )

  it('holds an actual forwarded native candidate until its installing batch commits', async () => {
    /** RPC-C6-SERVE-FORWARD-CANDIDATE-001 uses the same native install barrier and genuine IO. */
    const fixture = await installBarrier(false, true)
    /** The pending candidate must retain its actual native gate even after callable compilation. */
    const request = observe(fixture.caller.memory.request('business.request', 'forward-committed'))
    try {
      await fixture.waitForArrivals(1)
      expect(fixture.calls).toEqual({ request: 0, notify: 0, stream: 0 })
      fixture.release()
      await fixture.installing
      expect(await request).toEqual({ value: 'forward-committed' })
      expect(fixture.calls).toEqual({ request: 1, notify: 0, stream: 0 })
    } finally {
      await fixture.close()
      await request
    }
  })
})
