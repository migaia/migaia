/** Original relative-deadline oracles cross genuine namespaces, timeout features and native IO. */
import { createRpcHost } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { linkPolicy } from '@migaia/rpc-host/plugins'
import { defineFlowFeature, RpcFlowPoint } from '@migaia/rpc-host/sdk'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

/** Borrow the existing native timer/clock backends; each real Host still owns its own timers. */
class DeadlineClock {
  /** Manual time drives the original100/30/70 and99/100 boundaries without real waiting. */
  readonly scheduler = createManualScheduler()
  /** Provider/Session timers retain their genuine scheduled callbacks and cancellation receipts. */
  readonly #timers = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((run, delay) => this.scheduler.schedule(run, delay))
  /** ProviderContext and CallTable observe the same monotonic time through their original backend. */
  readonly #now = vi.spyOn(performance, 'now').mockImplementation(() => this.scheduler.now())
  /** The original diagnostic timestamp is independent from elapsed deadline accounting. */
  readonly #wall = vi.spyOn(systemWallClock, 'timestamp').mockReturnValue(0)

  /** Restore only these borrowed backends after every genuine Host has completed cleanup. */
  close(): void {
    this.#wall.mockRestore()
    this.#now.mockRestore()
    this.#timers.mockRestore()
  }
}

/** Delay real receiver resolution at the current dispatch/Forwarder boundary, not a removed port. */
class ReceiverResolution {
  /** Actual relay dispatch establishes that its original inherited deadline has begun. */
  readonly entered = deferred<void>()
  /** Release lets the original native continuation resolve the receiver and construct its frame. */
  readonly released = deferred<void>()
  /** The existing fixed dispatch group lends this exact stage to the real relay invocation. */
  readonly feature = defineFlowFeature({
    name: 'deadline-receiver-resolution',
    setup: () => ({
      stages: {
        [RpcFlowPoint.dispatchInbound]: async (payload, next) => {
          if (payload.context.envelope.task.method === 'provider.check') {
            this.entered.resolve()
            await this.released.promise
          }
          await next(payload)
        }
      }
    })
  })
}

/** Preserve elapsed receiver-resolution budget through the current genuine Forwarder. */
async function subtractReceiverResolutionDelay(): Promise<void> {
  /** Only the current real clock backend replaces the removed private clock-injection port. */
  const clock = new DeadlineClock()
  /** A relay supplies the actual asynchronous receiver-resolution boundary before forwarding. */
  const resolution = new ReceiverResolution()
  /** This one genuine namespace accepts both real physical connections. */
  const server = coreMemoryServer('relay')
  /** The complete native Feature precedes transport startup through the ordinary public factory. */
  const relay = await createRpcHost({
    ...server.options,
    plugins: [resolution.feature, server.transport]
  })
  /** The real provider stays pending until the original deadline oracle has completed. */
  const finished = deferred<null>()
  /** This independently accepted peer is selected by the genuine relay Forwarder. */
  const provider = await server.connect('provider', {
    provide: { check: () => finished.promise }
  })
  /** The provider is present in the original directory before the client captures its ready view. */
  const client = await server.connect('client')
  /** The original client must receive the relay's real forwarded capability before starting100ms. */
  await vi.waitFor(() => {
    /** Namespace.accepted publishes qualified methods as ordinary own-data capability groups. */
    const offered = Object.getOwnPropertyDescriptor(
      client.host.memory.peers.relay ?? {},
      'provider'
    )?.value
    expect(Object.getOwnPropertyDescriptor(offered ?? {}, 'check')?.value).toBeTypeOf('function')
  })
  /** Observe rejection immediately so advancing the genuine timer cannot create an unhandled error. */
  const pending = client.host.memory.send('relay', 'provider.check', null, {
    timeout: timeout({ ms: 100, scheduler: clock.scheduler })
  })
  void pending.catch(() => undefined)
  try {
    await resolution.entered.promise
    clock.scheduler.advance(30)
    resolution.released.resolve()
    await vi.waitFor(() => expect(firstCall(provider.pair[0].written)).toBeDefined())
    /** Changes only request/timeoutMs field spelling; the same70ms budget and0 stamp remain. */
    const sent = firstCall(provider.pair[0].written)
    expect(sent).toMatchObject({ kind: 'call', route: { remainingMs: 70, sentAt: 0 } })
    clock.scheduler.advance(70)
    await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    resolution.released.resolve()
    finished.resolve(null)
    await Promise.all([client.host.close(), provider.host.close(), relay.close()])
    clock.close()
  }
}

/** Preserve disabled timeout and the real provider timer cleanup after settlement. */
async function omitDisabledDeadline(): Promise<void> {
  /** Provider timers use their original scheduler owner while the timeout feature has its own clock. */
  const clock = new DeadlineClock()
  /** This separate original caller clock retains disabled-deadline independence. */
  const clientScheduler = createManualScheduler()
  /** The actual provider context lends the same native signal after successful settlement. */
  let providerSignal: IAbortSignal | undefined
  /** This ordinary public transport exposes the original check method. */
  const server = coreMemoryServer('provider')
  /** Real native installation creates the provider Session and timer owner. */
  const provider = await createRpcHost({
    ...server.options,
    provide: {
      check: (_value, context) => {
        providerSignal = context.signal
        return context.success(context.signal.aborted)
      }
    }
  })
  /** Moves the original timeout default into an installed complete link-policy feature. */
  const client = await server.connect('client', {
    plugins: [linkPolicy({ features: [timeout({ ms: 100, scheduler: clientScheduler })] })]
  })
  try {
    expect(await client.host.memory.send('provider', 'check', null, { timeout: false })).toBe(false)
    /** Actual original carrier writes contain no private endpoint projection or second codec pass. */
    const disabled = firstCall(client.pair[1].written)
    expect(disabled?.kind).toBe('call')
    if (disabled?.kind !== 'call') return
    expect(disabled.route.remainingMs).toBeUndefined()
    clock.scheduler.advance(1_000_000)
    clientScheduler.advance(1_000_000)
    expect(providerSignal?.aborted).toBe(false)
    /** A completed provider must release its real deadline timer before a later call is admitted. */
    const baseline = clock.scheduler.pendingCount
    expect(
      await client.host.memory.send('provider', 'check', null, {
        timeout: timeout({ ms: 100, scheduler: clientScheduler })
      })
    ).toBe(false)
    await vi.waitFor(() => expect(clock.scheduler.pendingCount).toBe(baseline))
  } finally {
    await client.host.close()
    await provider.close()
    clock.close()
  }
}

/** An already exhausted wire deadline rejects before entering the original provider. */
async function rejectInjectedZeroDeadline(): Promise<void> {
  /** Only the original native physical writer injects the already-expired valid new-profile frame. */
  const server = coreMemoryServer('provider')
  /** The first successful call calibrates admission; the exhausted second call must not enter. */
  let calls = 0
  /** Both calls enter through the genuine namespace/provider owner with no private execution port. */
  const provider = await createRpcHost({
    ...server.options,
    provide: {
      check: (_value, context) => {
        calls += 1
        return context.success(null)
      }
    }
  })
  /** Capture the actual current call tuple and accepted physical identity through original IO. */
  const client = await server.connect('client')
  try {
    await client.host.memory.send('provider', 'check', null)
    /** Rewrites the original request kind to call without changing its zero-deadline stimulus. */
    const request = firstCall(client.pair[1].written)
    expect(request?.kind).toBe('call')
    if (request?.kind !== 'call') return
    await client.pair[1].write({
      kind: 'message',
      data: { ...request, id: 'zero-deadline', route: { ...request.route, remainingMs: 0 } }
    })
    /** Wait for real dispatch settlement so a changed provider-admission rule fails without hanging. */
    await vi.waitFor(() => expect(providerSignalTerminal(client.pair[0].written)).toBeDefined())
    expect(calls).toBe(1)
    /** The original physical response proves deadline refusal, not a missing or delayed call. */
    const terminal = providerSignalTerminal(client.pair[0].written)
    expect(terminal?.kind).toBe('error')
    if (terminal?.kind !== 'error') expect.unreachable('missing actual deadline refusal')
    expect(terminal.error.nodes[terminal.error.root]).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    await client.host.close()
    await provider.close()
  }
}

/** Prove the real provider deadline independently from physical cancel delivery. */
async function abortAtMonotonicDeadline(): Promise<void> {
  /** The same native scheduler backend drives both existing100ms timers deterministically. */
  const clock = new DeadlineClock()
  /** Native provider entry proves the deadline belongs to running application work. */
  const providerStarted = deferred<void>()
  /** Release real uncooperative business work after the deadline/cancellation assertions. */
  const finished = deferred<null>()
  /** The signal is lent by the actual provider context, rather than constructed by this fixture. */
  let providerSignal: IAbortSignal | undefined
  /** This transport installs no extension capabilities or feature executor. */
  const server = coreMemoryServer('provider')
  /** The actual provider owns its local monotonic deadline independently from caller cancellation. */
  const provider = await createRpcHost({
    ...server.options,
    provide: {
      hang: (_value, context) => {
        providerSignal = context.signal
        providerStarted.resolve()
        return finished.promise
      }
    }
  })
  /** The originating complete timeout owns exactly its real client deadline. */
  const client = await server.connect('client')
  /** Hold the original physical writer so only cancel delivery is absent, never provider timers. */
  const write = client.pair[1].write
  /** Makes cancel a core frame; dropping it at real IO preserves the old absent-control vector. */
  const cancel = vi.spyOn(client.pair[1], 'write').mockImplementation((frame, options) => {
    if ((frame.data as { kind?: string }).kind === 'cancel') return Promise.resolve()
    return write(frame, options)
  })
  /** Observe the originating result before any actual deadline callback runs. */
  const result = client.host.memory.send('provider', 'hang', null, {
    timeout: timeout({ ms: 100, scheduler: clock.scheduler })
  })
  void result.catch(() => undefined)
  try {
    await providerStarted.promise
    /** Changes the wire fields, preserving the original100ms budget and diagnostic timestamp. */
    const requestFrame = firstCall(client.pair[1].written)
    expect(requestFrame).toMatchObject({ kind: 'call', route: { remainingMs: 100, sentAt: 0 } })
    clock.scheduler.advance(99)
    expect(providerSignal?.aborted).toBe(false)
    clock.scheduler.advance(1)
    expect(providerSignal?.aborted).toBe(true)
    expect(providerSignal?.reason).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await expect(result).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    finished.resolve(null)
    await client.host.close()
    await provider.close()
    cancel.mockRestore()
    clock.close()
  }
}

describe('provider relative deadline', () => {
  it(
    'subtracts receiver resolution delay from the outbound wire budget',
    subtractReceiverResolutionDelay
  )
  it('omits disabled deadlines and clears a settled provider timer', omitDisabledDeadline)
  it('rejects an injected zero deadline before entering the provider', rejectInjectedZeroDeadline)
  it(
    'aborts at the monotonic deadline even without the abort control capability',
    abortAtMonotonicDeadline
  )
})

/** The injected correlation's actual result/error proves provider admission has finished. */
function providerSignalTerminal(
  frames: readonly IRpcSemanticFrame[]
): IRpcSemanticFrame | undefined {
  return frames.find(
    (frame) => (frame.kind === 'result' || frame.kind === 'error') && frame.id === 'zero-deadline'
  )
}

/** Read only the real current call frame; the existing carrier remains the sole capture owner. */
function firstCall(frames: readonly IRpcSemanticFrame[]) {
  return frames.find((frame) => frame.kind === 'call')
}
