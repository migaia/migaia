import type { IAbortSignal } from '@migaia/utils/promise'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode
} from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createRpcAbortError, RpcCoreErrorCode } from '../../dist/core/errors.js'
import {
  attachProviderPreflight,
  readProviderPreflight
} from '../../dist/core/internal/provider.js'
import * as catalog from '../../dist/remote/runtime-api/catalog.js'
import { RuntimePluginKey } from '../../dist/remote/runtime-api/constants.js'
import * as runtimePlugin from '../../dist/remote/runtime-api/plugin.js'
import { defineTransportPlugin } from '../../dist/plugin/define.js'
import {
  createAdapterDeployment,
  type IAdapterDeploymentContext
} from '../../dist/runtime-adapter/deployment.js'
import { createRpcHost } from '../../dist/index.js'
import type { IRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { holdMemoryChannel } from '../host/fixture.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

/** The private side table is optional only for the required unmodified-main red run. */
type IObservedCommitGate = Readonly<{
  isOpen(): boolean
  wait(signal: IAbortSignal): Promise<void>
}>

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

/** Own one genuine uncommitted Host batch and the physical caller that exercises its gate. */
class ServeCommitBarrier {
  /** Feature and runtime registrations share one native batch commit decision. */
  #host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Physical resource ownership starts before either side negotiates its actual capability offer. */
  #transports = createMemoryTransportPair()
  /** Provider receive capture uses the existing native-style acceptance fixture. */
  #providerSource = holdMemoryChannel(this.#transports[1])
  /** Caller receive capture independently owns its side of the same raw channel. */
  #callerSource = holdMemoryChannel(this.#transports[0])
  /** The acceptance case controls only the existing native installation's commit boundary. */
  #release = deferred<void>()
  /** Readiness observes completed transport preparation before business calls begin. */
  #prepared = deferred<void>()
  /** Both borrowed fixture resources must start capture before either real ACK can arrive. */
  #sourceReady = deferred<void>()
  /** This fixture has exactly two physical ends, fixed by createMemoryTransportPair's tuple. */
  #sourceArrivals = 0
  /** Waiters observe the count of real provider preflight visits. */
  #admissionWaiters: { count: number; resolve(): void }[] = []
  /** The actual compiler's method names record original admission order. */
  #arrivals: string[] = []
  /** One-way failures retain their original reporting channel. */
  #reports: unknown[] = []
  /** Each actual gate wait keeps its original provider signal and rejection. */
  #gateWaits: { method: string; signal: IAbortSignal; error?: unknown }[] = []
  /** A caller-independent gate wait proves rollback's lifecycle cause. */
  #rollbackGate: Promise<{ value: void } | { error: unknown }> | undefined
  /** Original method invocation counts distinguish admission from execution. */
  #calls = { request: 0, notify: 0, stream: 0 }
  /** Notification execution is independent of physical one-way send completion. */
  #notified = deferred<void>()
  /** The later failing registration preserves the original installation cause identity. */
  #installFailure = new Error('serve-after-commit install failure')
  /** One test mode chooses commit or native rollback after preparation. */
  #rollback: boolean
  /** The caller retains one actual public Host with a single direct target. */
  #caller!: IRuntimePeer
  /** Cleanup joins the exact original native batch Promise. */
  #installing!: Promise<unknown>
  /** Transparent compiler observation is restored by the same physical fixture owner. */
  #observation: { mockRestore(): void } | undefined
  /** The original compiler remains the only producer of provider method objects. */
  #expose = runtimePlugin.exposedProvide

  /** Capture the scenario decision without opening or publishing a connection. */
  constructor(rollback: boolean) {
    this.#rollback = rollback
  }

  /** Build the cold application Feature; every callback reads this scenario's explicit owner. */
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

  /** Keep construction, yields and terminal value in the original business iterator. */
  *#stream() {
    this.#calls.stream += 1
    yield 1
    yield 2
    yield 3
    return 4
  }

  /** Observe actual exposure admission without replacing method identities or availability checks. */
  #observeProvide = (...args: Parameters<typeof runtimePlugin.exposedProvide>) => {
    /** Invoke the original compiler without introducing a receiver. */
    const expose = this.#expose
    /** This remains the canonical compiler's exact method tree. */
    const provide = expose(...args)
    for (const entry of catalog.compileRuntimeMethods(provide)) {
      if (entry.kind === 'forward') continue
      /** The real availability guard stays ahead of the original preflight behavior. */
      const preflight = readProviderPreflight(entry.method)
      attachProviderPreflight(entry.method, (route) => {
        this.#arrivals.push(entry.name)
        for (const waiter of this.#admissionWaiters)
          if (this.#arrivals.length >= waiter.count) waiter.resolve()
        preflight?.(route)
      })
      /** Reflective access retains compatibility with the required original-main red oracle. */
      const readGate = Reflect.get(catalog, 'readCommitGate') as
        | ((method: Function) => IObservedCommitGate | undefined)
        | undefined
      /** Only existing canonical gate metadata is observed. */
      const gate = readGate?.(entry.method)
      if (gate) this.#observeGate(entry.name, entry.method, gate)
    }
    return provide
  }

  /** Preserve the exact install gate while recording its signal and refusal. */
  #observeGate(name: string, method: Function, gate: IObservedCommitGate): void {
    if (this.#rollback && this.#rollbackGate === undefined)
      this.#rollbackGate = observe(gate.wait(new AbortController().signal))
    /** The existing metadata attachment replaces only the transparent observation object. */
    const attachGate = Reflect.get(catalog, 'attachCommitGate') as (
      method: Function,
      gate: IObservedCommitGate
    ) => Function
    attachGate(method, {
      isOpen: () => gate.isOpen(),
      wait: (signal) => {
        /** The original context signal and eventual rejection stay together. */
        const observation: { method: string; signal: IAbortSignal; error?: unknown } = {
          method: name,
          signal
        }
        this.#gateWaits.push(observation)
        return gate.wait(signal).catch((error: unknown) => {
          observation.error = error
          throw error
        })
      }
    })
  }

  /** Create the actual native transport and pause only after its endpoint preparation completes. */
  #runtime() {
    /** The existing shared-slot owner recognizes this real physical family. */
    const family = Object.freeze({})
    /** The canonical deployment owns opening and closing the captured raw source. */
    const transport = defineTransportPlugin({
      name: 'connection',
      mode: 'connect',
      expose: ['business'],
      deployment: createAdapterDeployment({
        runtimeKey: RuntimePluginKey.thread,
        runtimeFamily: family,
        runtimeOptions: {
          self: { name: 'provider', instanceId: 'provider-1' },
          report: (error) => this.#reports.push(error)
        },
        open: (context) => this.#openSource(this.#providerSource, 'caller-1', context)
      })
    })
    return definePlugin({
      ...transport,
      install: async (core) => {
        /** The genuine install result remains withheld until the same batch can commit. */
        const installed = await transport.install(core)
        this.#prepared.resolve()
        await this.#release.promise
        return installed
      }
    })
  }

  /** Join the two actual raw openings so ordinary Host setup cannot lose the first native ACK. */
  async #openSource(
    open: ReturnType<typeof holdMemoryChannel>,
    peerId: string,
    context: IAdapterDeploymentContext
  ) {
    this.#sourceArrivals += 1
    if (this.#sourceArrivals === 2) this.#sourceReady.resolve()
    await this.#sourceReady.promise
    return open(peerId, context)
  }

  /** Open both genuine Host owners and return observations only after native preparation. */
  async open() {
    this.#observation = vi
      .spyOn(runtimePlugin, 'exposedProvide')
      .mockImplementation(this.#observeProvide)
    /** The later native member fails only after the runtime owns its actual cleanup receipts. */
    const tail = definePlugin({
      name: 'tail',
      install: () => {
        if (this.#rollback) throw this.#installFailure
        return {}
      }
    })
    this.#installing = this.#host.use(this.#business(), this.#runtime(), tail)
    void this.#installing.catch(() => undefined)
    this.#caller = (await createRpcHost({
      self: { name: 'caller', instanceId: 'caller-1' },
      plugins: [
        defineTransportPlugin({
          name: 'caller-connection',
          mode: 'connect',
          deployment: createAdapterDeployment({
            open: (context) => this.#openSource(this.#callerSource, 'provider-1', context)
          })
        })
      ],
      report: (error) => this.#reports.push(error)
    })) as unknown as IRuntimePeer
    await this.#prepared.promise
    return {
      caller: this.#caller,
      calls: this.#calls,
      arrivals: this.#arrivals,
      reports: this.#reports,
      gateWaits: this.#gateWaits,
      installFailure: this.#installFailure,
      rollbackGate: this.#rollbackGate,
      notified: this.#notified.promise,
      installing: this.#installing,
      waitForArrivals: (count: number) => this.#waitForArrivals(count),
      release: () => this.#release.resolve(),
      close: () => this.#close()
    }
  }

  /** Count actual preflight visits without a fixture timer or a parallel dispatch path. */
  #waitForArrivals(count: number): Promise<void> {
    if (this.#arrivals.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#admissionWaiters.push({ count, resolve }))
  }

  /** Release the original batch before draining both actual Host and physical resource owners. */
  async #close(): Promise<void> {
    this.#release.resolve()
    await this.#installing.catch(() => undefined)
    await this.#caller.close()
    await this.#host.dispose()
    this.#transports[0].close()
    this.#observation?.mockRestore()
  }
}

/** Open one bounded acceptance scenario through its explicit fixture owner. */
function installBarrier(rollback = false) {
  return new ServeCommitBarrier(rollback).open()
}

describe('runtime exposed methods serve after commit', () => {
  it('holds request, notify and stream until the installing Host batch commits', async () => {
    /** A real paused Host install makes arrival timing deterministic for all three call kinds. */
    const fixture = await installBarrier()
    /** Request and stream outcomes are handled before the original guard can reject either one. */
    const request = observe(fixture.caller.request('business.request', 'committed'))
    /** Notify's caller completion proves only physical send completion. */
    const notify = fixture.caller.notify('business.notify')
    /** A first pull sends the actual stream-open call before commit. */
    const iterator = fixture.caller.stream('business.stream')
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
    const request = observe(fixture.caller.request('business.request', 'rolled-back'))
    /** Notify remains one-way even though its target later reports a gate refusal. */
    const notify = fixture.caller.notify('business.notify')
    /** First pull admits the real stream before the batch's rollback decision. */
    const iterator = fixture.caller.stream('business.stream')
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
      /** Deadline expiry uses the existing positive timeout option, with no fixture timer. */
      const options = interruption === 'abort' ? { signal: controller.signal } : { timeoutMs: 20 }
      /** Handle caller failure immediately while waiting for actual provider admission. */
      const request = observe(fixture.caller.request('business.request', interruption, options))
      /** First pull admits the stream's own signal-aware gate branch. */
      const iterator = fixture.caller.stream('business.stream', interruption, options)
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
        expect(await fixture.caller.request('business.request', 'fresh')).toBe('fresh')
        /** A fresh generator proves stream registration remains usable after held interruption. */
        const fresh: unknown[] = []
        for await (const value of fixture.caller.stream('business.stream')) fresh.push(value)
        expect(fresh).toEqual([1, 2, 3])
        expect(fixture.calls).toEqual({ request: 1, notify: 0, stream: 1 })
      } finally {
        await fixture.close()
        await Promise.all([request, stream])
      }
    }
  )
})
