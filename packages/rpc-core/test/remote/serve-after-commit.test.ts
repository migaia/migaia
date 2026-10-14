import type { IAbortSignal } from '@migaia/utils/promise'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode
} from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { RpcCapability } from '@migaia/rpc-contract'
import { describe, expect, it } from 'vitest'
import { createRpcAbortError, RpcCoreErrorCode } from '../../dist/core/errors.js'
import {
  attachProviderPreflight,
  readProviderPreflight
} from '../../dist/core/internal/provider.js'
import * as catalog from '../../dist/remote/runtime-api/catalog.js'
import { RuntimePluginKey } from '../../dist/remote/runtime-api/constants.js'
import { createRuntimePlugin } from '../../dist/remote/runtime-api/plugin.js'
import { createRuntimePeer, type IRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES, runtimeSources } from '../runtime-api/fixture.js'

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

/**
 * A genuine runtime plugin pauses after Peer preparation while its entire Host batch is
 * uncommitted.
 */
async function installBarrier(rollback = false) {
  /** Feature and runtime registrations share one candidate batch and one commit decision. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The canonical memory-source fixture joins actual bilateral Peer capabilities. */
  const capabilities = [...RUNTIME_API_FIXTURE_BASE_CAPABILITIES, RpcCapability.deadline]
  /** Both source offers retain the existing provider-side deadline capability. */
  const channel = runtimeSources(capabilities, capabilities)
  /** Runtime installation cannot finish until the acceptance case releases this barrier. */
  const release = deferred<void>()
  /** Both Peers must be prepared before the caller can exercise the paused install. */
  const prepared = deferred<IRuntimePeer>()
  /** Admission observation uses the existing preflight side table, not a production test seam. */
  const admissionWaiters: { count: number; resolve(): void }[] = []
  /** Three first-party calls must reach their existing provider registration before commit. */
  const arrivals: string[] = []
  /** Provider reports distinguish one-way failure from caller send completion. */
  const reports: unknown[] = []
  /** Each real provider wait exposes its rejection and original context signal. */
  const gateWaits: { method: string; signal: IAbortSignal; error?: unknown }[] = []
  /** An independent observer records lifecycle gate refusal when transport-close wins on the wire. */
  let rollbackGate: Promise<{ value: void } | { error: unknown }> | undefined
  /** Invocation counts prove that exposed business methods remain unavailable before commit. */
  const calls = { request: 0, notify: 0, stream: 0 }
  /** Notify completion is observed independently of its caller's one-way send completion. */
  const notified = deferred<void>()
  /** A cold Feature snapshot belongs to this candidate registration, reproducing F20 exactly. */
  const business = definePlugin({
    name: 'business',
    features: {
      methods: defineFeature(() => ({
        /** Request returns its original portable payload after one business invocation. */
        request(payload: unknown) {
          calls.request += 1
          return payload
        },
        /** Notify exposes its invocation independently of a response-free caller. */
        notify() {
          calls.notify += 1
          notified.resolve()
        },
        /** Stream construction and first pull run through the original iterable registration. */
        *stream() {
          calls.stream += 1
          yield 1
          yield 2
          yield 3
          return 4
        }
      }))
    },
    install: () => ({})
  })
  /** This test's resource uses the existing Host shared-slot owner and original runtime key. */
  const family = Object.freeze({})
  /** Only the existing injection boundary delays install; channel and provider owners stay genuine. */
  const runtime = createRuntimePlugin(
    {
      name: 'connection',
      self: { name: 'provider', instanceId: 'provider-1' },
      expose: ['business'],
      connect: channel.sources[1],
      report: (error) => reports.push(error)
    },
    {
      key: 'thread',
      acquire: (integration, create) =>
        integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)
    },
    async (options) => {
      for (const entry of catalog.compileRuntimeMethods(options.provide)) {
        if (entry.kind === 'forward') continue
        /** Keep the real availability guard while observing its actual admission boundary. */
        const preflight = readProviderPreflight(entry.method)
        attachProviderPreflight(entry.method, (route) => {
          arrivals.push(entry.name)
          for (const waiter of admissionWaiters)
            if (arrivals.length >= waiter.count) waiter.resolve()
          preflight?.(route)
        })
        /** Reflective access keeps this same A1 oracle runnable before the side table exists. */
        const readGate = Reflect.get(catalog, 'readCommitGate') as
          | ((method: Function) => IObservedCommitGate | undefined)
          | undefined
        /** The compiled local method keeps its actual gate; this fixture observes that gate only. */
        const gate = readGate?.(entry.method)
        if (gate) {
          /** The rollback observer has no caller cancellation so it proves the gate's own cause. */
          if (rollback && rollbackGate === undefined)
            rollbackGate = observe(gate.wait(new AbortController().signal))
          /** Replace only private metadata with a transparent waiter observation. */
          const attachGate = Reflect.get(catalog, 'attachCommitGate') as (
            method: Function,
            gate: IObservedCommitGate
          ) => Function
          attachGate(entry.method, {
            isOpen: () => gate.isOpen(),
            wait: (signal) => {
              /** Record every provider-owned signal before delegating to the real install gate. */
              const observation = { method: entry.name, signal } as {
                method: string
                signal: IAbortSignal
                error?: unknown
              }
              gateWaits.push(observation)
              return gate.wait(signal).catch((error: unknown) => {
                observation.error = error
                throw error
              })
            }
          })
        }
      }
      /** Complete the actual Peer before pausing its enclosing PluginHost install. */
      const peer = await createRuntimePeer(options)
      prepared.resolve(peer)
      await release.promise
      return peer
    }
  )
  /** Installing both registrations together makes readCurrent reject before commit on old main. */
  const installFailure = new Error('serve-after-commit install failure')
  /** A later member fails the same batch after the prepared runtime owns its cleanup callbacks. */
  const tail = definePlugin({
    name: 'tail',
    install: () => {
      if (rollback) throw installFailure
      return {}
    }
  })
  /** The existing variadic batch API preserves atomic registration commit and rollback. */
  const installing = host.use(business, runtime, tail)
  void installing.catch(() => undefined)
  /** The caller receives the genuine accepted directory while the target Host stays uncommitted. */
  const caller = await createRuntimePeer({
    self: { name: 'caller', instanceId: 'caller-1' },
    connect: channel.sources[0],
    report: (error) => reports.push(error)
  })
  /** Retain prepared target ownership so an assertion failure still closes both physical ends. */
  const provider = await prepared.promise
  return {
    caller,
    calls,
    arrivals,
    reports,
    gateWaits,
    installFailure,
    rollbackGate,
    /** Admission barriers count actual preflight visits, with no timer or fixture dispatch. */
    waitForArrivals(count: number): Promise<void> {
      if (arrivals.length >= count) return Promise.resolve()
      return new Promise((resolve) => admissionWaiters.push({ count, resolve }))
    },
    notified: notified.promise,
    installing,
    release: () => release.resolve(),
    /** Always release the paused install before draining its canonical resource owners. */
    async close() {
      release.resolve()
      await installing.catch(() => undefined)
      await caller.close()
      await provider.close()
      await host.dispose()
      channel.close()
    }
  }
}

describe('runtime exposed methods serve after commit', () => {
  it('[A1] holds request, notify and stream until the installing Host batch commits', async () => {
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
          '[serve-commit A1 red]',
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

  it('[A2] refuses all held calls when the prepared install batch rolls back', async () => {
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
          source: '@migaia/rpc/core',
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
        '[serve-commit A2 rollback]',
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
    '[A3] never invokes held request or stream after caller %s, then admits fresh calls',
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
