import { deferred } from '@migaia/utils/promise'
import { RpcWireKind, RpcWireProfile } from '@migaia/rpc-contract/protocol'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import type { IRpcContext } from '@migaia/rpc-host'
import { describe, expect, it, vi } from 'vitest'
import { throwingSignal } from '../fixtures/throwing-signal.ts'
import { connectedCoreHosts } from '../host/core-fixture.ts'

/** Only real provider entry and finally affect the observable business activity count. */
class CancellationProvider {
  /** Entry proves an active provider exists before an in-flight cancellation is issued. */
  readonly started = deferred<void>()
  /** The original provider signal supplies the remotely restored cancellation reason. */
  readonly aborted = deferred<unknown>()
  /** Business finally proves cancellation released the actual running operation. */
  readonly finished = deferred<void>()
  /** No private Dispatcher/controller registry is read by this public oracle. */
  #active = 0

  /** Retain the original zero-active assertion at the business execution boundary. */
  get active(): number {
    return this.#active
  }

  /** Already-aborted entry and later cancellation converge through one business finally. */
  readonly run = async (_payload: unknown, context: IRpcContext) => {
    this.#active += 1
    this.started.resolve()
    try {
      if (!context.signal.aborted)
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      this.aborted.resolve(context.signal.reason)
      return context.failed('aborted', 'CANCELLED')
    } finally {
      this.#active -= 1
      this.finished.resolve()
    }
  }
}

describe('public request cancellation through the canonical CallTable', () => {
  it('notifies the remote and leaves zero active providers after a complete timeout expires', async () => {
    /** The provider, original memory carrier pair and public namespaces are genuine owners. */
    const provider = new CancellationProvider()
    /** Reporting does not participate in the correlated caller failure channel. */
    const fixture = await connectedCoreHosts({}, { hang: provider.run }, () => undefined)
    try {
      /** A full executing instance replaces the retired numeric per-call timeout configuration. */
      const pending = fixture.a.memory.send('b', 'hang', null, {
        timeout: timeoutFeature({ ms: 40 })
      })
      /** Observe rejection before waiting for actual entry so no rejection becomes detached. */
      const settled = pending.then(
        () => 'resolved',
        (error: { readonly code?: string }) => error.code
      )
      await provider.started.promise
      /** The original public deadline code remains unchanged. */
      const result = await settled
      expect(result).toBe('DEADLINE_EXCEEDED')
      await provider.finished.promise
      expect(provider.active).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('leaves zero active providers after a local signal.abort() fired synchronously right after send()', async () => {
    /** Synchronous cancellation may prevent entry or cancel the same actual provider operation. */
    const provider = new CancellationProvider()
    /** No middleware or old endpoint construction is retained. */
    const fixture = await connectedCoreHosts({}, { hang: provider.run }, () => undefined)
    try {
      /** The caller withdraws immediately after receiving its original invocation Promise. */
      const controller = new AbortController()
      /** Deferred native preparation must recheck this real cancellation before handoff. */
      const pending = fixture.a.memory.send('b', 'hang', null, { signal: controller.signal })
      controller.abort()
      /** Preserve the original public result rather than accepting physical-close failure. */
      const result = await pending.then(
        () => 'resolved',
        (error: Error & { readonly code?: string }) => {
          expect(error).toMatchObject({ name: 'AbortError' })
          expect(error.cause).toBe(controller.signal.reason)
          return error.code
        }
      )
      expect(result).toBe('CANCELLED')
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(provider.active).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('rejects a pre-aborted caller with CANCELLED and the getter failure as cause', async () => {
    /** A connected source makes failure attributable to caller cancellation, not target lookup. */
    const fixture = await connectedCoreHosts({}, { wait: () => 'late' }, () => undefined)
    /** The throwing property is read only by the actual production cancellation owner. */
    const failure = new Error('reason getter')
    /** This original controlled signal is already aborted before the public call begins. */
    const source = throwingSignal(failure, true)
    try {
      /** Retain the actual rejected native object for the original cause assertion. */
      let rejection: unknown
      try {
        await fixture.a.memory.send('b', 'wait', null, { signal: source.signal })
      } catch (error) {
        rejection = error
      }
      expect(rejection).toMatchObject({ name: 'AbortError', code: 'CANCELLED', cause: failure })
      expect(source.reads()).toBe(1)
    } finally {
      await fixture.close()
    }
  })

  it('settles event abort once and sends one remote cancellation', async () => {
    /** A live business invocation proves the cancellation crosses the physical carrier. */
    const provider = new CancellationProvider()
    /** The fixture exposes its existing actual writes, never a second transport wrapper. */
    const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
    /** Reading reason reenters the same abort event before throwing this exact original error. */
    const failure = new Error('event reason getter')
    /** The callback is deliberately reentrant; production must claim first abort before reading. */
    let source: ReturnType<typeof throwingSignal>
    source = throwingSignal(failure, false, () => source.fire())
    try {
      /** Only the complete feature override false disables an inherited timeout policy. */
      const result = fixture.a.memory.send('b', 'wait', null, {
        signal: source.signal,
        timeout: false
      })
      /** Observe the original invocation before the synchronous event is fired. */
      const settled = Promise.allSettled([result])
      await provider.started.promise
      source.fire()
      /** Preserve original native name/code/cause and its one reason read. */
      const rejection = (await settled)[0]
      expect(rejection?.status === 'rejected' ? rejection.reason : undefined).toMatchObject({
        name: 'AbortError',
        code: 'CANCELLED',
        cause: failure
      })
      expect(source.reads()).toBe(1)
      await vi.waitFor(() => {
        expect(
          fixture.pair[0].written.filter((frame) => frame.kind === RpcWireKind.cancel)
        ).toHaveLength(1)
      })
      /** Gives cancellation its own canonical kind, retaining the original single frame. */
      const cancellations = fixture.pair[0].written.filter(
        (frame) => frame.kind === RpcWireKind.cancel
      )
      expect(cancellations).toHaveLength(1)
      expect(cancellations[0]).toMatchObject({ kind: RpcWireKind.cancel })
      await provider.finished.promise
    } finally {
      await fixture.close()
    }
  })

  it('sends a cancel frame and preserves a native RangeError on the provider', async () => {
    /** The provider observes the actual serialized and restored caller cancellation reason. */
    const provider = new CancellationProvider()
    /** Every frame travels through the fixture's original codec and native receiver. */
    const fixture = await connectedCoreHosts({}, { slow: provider.run }, () => undefined)
    try {
      /** Cancellation occurs only after actual provider execution starts. */
      const controller = new AbortController()
      /** No numeric timeout or old endpoint entry remains in this business path. */
      const result = fixture.a.memory.send('b', 'slow', null, {
        signal: controller.signal,
        timeout: false
      })
      /** Attach the original code assertion before producing its terminal. */
      const rejected = expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
      await provider.started.promise
      controller.abort(new RangeError('stop'))
      await rejected
      /** The actual provider signal exposes the original native wire class and public message. */
      const reason = await provider.aborted.promise
      expect(reason).toBeInstanceOf(RangeError)
      expect(reason).toMatchObject({ message: 'stop' })
      /** The physical cancel must retain the original call id under the single envelope grammar. */
      const cancellation = fixture.pair[0].written.find(
        (frame) => frame.kind === RpcWireKind.cancel
      )
      expect(cancellation).toMatchObject({ kind: RpcWireKind.cancel, profile: RpcWireProfile })
      expect(cancellation?.id).toBe(
        fixture.pair[0].written.find((frame) => frame.kind === RpcWireKind.call)?.id
      )
    } finally {
      await fixture.close()
    }
  })
})

/** This original application operation remains pending until its real provider signal aborts. */
class VerifiedAbortProvider {
  /** Actual provider entry supplies the original started-before-abort business barrier. */
  started = false
  /** Only the original native abort listener sets this observable business result. */
  aborted = false
  /** The original business Promise resolves with its provider failure after cancellation. */
  readonly #completion = deferred<unknown>()
  /** The admitted provider context belongs only to this one active business invocation. */
  #context: IRpcContext | undefined

  /** Publish entry and subscribe before returning the original held business Promise. */
  readonly run = (_payload: unknown, context: IRpcContext) => {
    this.#context = context
    this.started = true
    context.signal.addEventListener('abort', this.#abort, { once: true })
    return this.#completion.promise
  }

  /** Preserve the original failed value and release the borrowed context at actual abort. */
  readonly #abort = () => {
    this.aborted = true
    /** Keep the exact original provider receiver while settling its one business operation. */
    const context = this.#context!
    this.#context = undefined
    this.#completion.resolve(context.failed('cancelled', 'CANCELLED'))
  }
}

it('preserves started-before-abort and the original cancelled provider result through public namespaces', async () => {
  /** These booleans belong to the actual original provider, never a synthetic controller table. */
  const provider = new VerifiedAbortProvider()
  /** The original memory pair connects the two independently owned public Hosts. */
  const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
  try {
    /** A plain no-argument abort retains the original native cancellation input. */
    const controller = new AbortController()
    /** Complete false replaces only the retired numeric timeout option. */
    const pending = fixture.a.memory.send('b', 'wait', null, {
      signal: controller.signal,
      timeout: false
    })
    await vi.waitFor(() => expect(provider.started).toBe(true))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    await vi.waitFor(() => expect(provider.aborted).toBe(true))
  } finally {
    await fixture.close()
  }
})

it('preserves hostile caller listener failure cause and cleanup before any business write', async () => {
  /** Real readiness keeps target admission separate from the original caller listener failure. */
  const fixture = await connectedCoreHosts({}, { wait: () => 'unreached' }, () => undefined)
  /** The same original method throws while acquiring its abort subscription. */
  const original = new Error('hostile addEventListener')
  /** Even a partially failed registration must attempt this original remover once. */
  const remove = vi.fn()
  /** Structural signals are supported without DOM branding; this input is never pre-aborted. */
  const signal = {
    aborted: false,
    addEventListener: () => {
      throw original
    },
    removeEventListener: remove
  }
  try {
    /** Both genuine handshakes have completed; only this new public call's writes are counted. */
    const businessWriteStart = fixture.pair[0].written.length
    await expect(
      fixture.a.memory.send('b', 'wait', null, { signal, timeout: false })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', cause: original })
    expect(remove).toHaveBeenCalledOnce()
    expect(fixture.pair[0].written.slice(businessWriteStart)).toHaveLength(0)
  } finally {
    await fixture.close()
  }
})

// Retain only the original invalidData provider-reason branch here.
it('aborts the actual provider with invalid cancellation data and reports one protocol failure', async () => {
  /** Only the actual running provider's signal can settle this original cancellation barrier. */
  const provider = new CancellationProvider()
  /** Provider-side diagnostics are distinct from caller retirement and its ordinary report sink. */
  const reports: unknown[] = []
  /** Original native carriers, Session admission and public provider dispatch remain unchanged. */
  const fixture = await connectedCoreHosts(
    {},
    { slow: provider.run },
    () => undefined,
    undefined,
    (error) => reports.push(error)
  )
  try {
    /** The original call stays active until a genuine incoming cancellation or retirement aborts it. */
    const pending = fixture.a.memory.send('b', 'slow', null, { timeout: false })
    void pending.catch(() => undefined)
    await provider.started.promise
    /** Borrow the real admitted call once; no fixture parser or replacement request is created. */
    const call = fixture.pair[0].written.find((frame) => frame.kind === RpcWireKind.call)
    expect(call?.kind).toBe(RpcWireKind.call)
    /** The malformed portable bytes and every original error scalar remain literal peer input. */
    const reasonGraph = {
      root: 0,
      nodes: [
        {
          source: 'peer',
          code: 'STOP',
          name: 'Error',
          message: 'stop',
          stack: 'peer-stack',
          data: { $rpc: 'bytes', base64url: '!' }
        }
      ]
    }
    /** Raw native delivery reaches the sole real codec without a serializer repairing bad data. */
    await fixture.pair[0].write({
      kind: 'message',
      data: {
        profile: RpcWireProfile,
        kind: RpcWireKind.cancel,
        id: call!.id,
        task: call!.task,
        route: call!.route,
        reason: reasonGraph
      }
    })
    /** Keep each original error oracle even when another one exposes the first real regression. */
    const reason = await provider.aborted.promise
    expect.soft(reason).toBeInstanceOf(TypeError)
    expect.soft(reason).toMatchObject({ code: 'INVALID_WIRE_ERROR', violation: 'dataPortable' })
    expect.soft((reason as { readonly cause?: unknown } | undefined)?.cause).toMatchObject({
      code: 'INVALID_ENVELOPE'
    })
    /** Only real configured provider diagnostics count; a visible cancel frame cannot pass this. */
    await vi.waitFor(() =>
      expect(
        reports.filter(
          (error) =>
            error !== null &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'PROTOCOL_INVALID'
        )
      ).toHaveLength(1)
    )
  } finally {
    await fixture.close()
  }
})

/** Reuse both original malformed tree records without introducing a graph-depth acceptance rule. */
function originalLegacyCancellationReasons() {
  /** The exact original base plus seventy wrappers is retained as peer input, never flattened. */
  let deep: Record<string, unknown> = {
    source: 'peer',
    code: 'STOP',
    name: 'Error',
    message: 'stop',
    stack: 'peer-stack'
  }
  for (let index = 0; index < 70; index += 1)
    deep = {
      source: 'peer',
      code: 'STOP',
      name: 'Error',
      message: 'stop',
      stack: 'peer-stack',
      cause: deep
    }
  /** This is the unchanged original legacy bytes marker, not a repaired portable value. */
  const invalidData = {
    source: 'peer',
    code: 'STOP',
    name: 'Error',
    message: 'stop',
    stack: 'peer-stack',
    data: { $rpc: 'bytes', base64url: '!' }
  }
  return [
    ['70-wrapper', deep],
    ['invalidData', invalidData]
  ] as const
}

/** Count only the actual provider's configured public protocol diagnostic. */
function protocolFailureCount(reports: readonly unknown[]): number {
  /** A single traversal leaves report order and original failure objects untouched. */
  let count = 0
  for (const error of reports)
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'PROTOCOL_INVALID'
    )
      count += 1
  return count
}

// Original raw reason identity survives the current graph-shape refusal.
it.each(originalLegacyCancellationReasons())(
  'preserves the original raw %s cancellation reason as the malformed provider cause',
  async (_variant, payload) => {
    /** The actual entered provider, not a synthetic controller, observes the rejected reason. */
    const provider = new CancellationProvider()
    /** The provider's configured report callback is separate from caller terminal diagnostics. */
    const reports: unknown[] = []
    /** Identity media retains original raw references until the canonical receiving grammar. */
    const fixture = await connectedCoreHosts(
      {},
      { slow: provider.run },
      () => undefined,
      undefined,
      (error) => reports.push(error)
    )
    try {
      /** This real public request remains pending until original native cancellation or retirement. */
      const pending = fixture.a.memory.send('b', 'slow', null, { timeout: false })
      void pending.catch(() => undefined)
      await provider.started.promise
      /** Borrow the already-written real task and route without parsing or replacing its call. */
      const call = fixture.pair[0].written.find((frame) => frame.kind === RpcWireKind.call)
      expect(call?.kind).toBe(RpcWireKind.call)
      /** One raw native write exposes the original malformed reason to the sole current decoder. */
      await fixture.pair[0].write({
        kind: 'message',
        data: {
          profile: RpcWireProfile,
          kind: RpcWireKind.cancel,
          id: call!.id,
          task: call!.task,
          route: call!.route,
          reason: payload
        }
      })
      /** Both original malformed variants must still abort through the same native TypeError. */
      const reason = await provider.aborted.promise
      expect.soft(reason).toBeInstanceOf(TypeError)
      expect.soft(reason).toMatchObject({ code: 'INVALID_WIRE_ERROR' })
      expect.soft((reason as Error | undefined)?.cause).toBe(payload)
      await vi.waitFor(() => expect(protocolFailureCount(reports)).toBe(1))
    } finally {
      await fixture.close()
    }
  }
)
