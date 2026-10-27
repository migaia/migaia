/** Original provider cancellation observations use real caller signals and physical terminal writes. */
import { deferred } from '@migaia/utils/promise'
import type { IRpcContext } from '@migaia/rpc-host'
import { RpcWireKind, RpcWireProfile } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { assert, expect, it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** One real provider owns only its original business entry, abort observation and late result. */
class SignalTerminalProvider {
  /** Actual provider entry precedes caller cancellation in every receiving case. */
  readonly started = deferred<void>()
  /** The provider's actual signal event proves the physical cancellation arrived. */
  readonly aborted = deferred<void>()
  /** Business finally is independent from the caller's earlier local rejection. */
  readonly finished = deferred<void>()
  /** The same original provider signal remains available for the cross-Host isolation witness. */
  signal: IRpcContext['signal'] | undefined
  /** Only the actual remote signal listener increments this original business count. */
  observedAborts = 0
  /** A held business result permits the original late resolve/reject after cancellation. */
  readonly #result = deferred<unknown>()

  /** Keep real business pending until its actual signal aborts and the original late result settles. */
  readonly run = async (_payload: unknown, context: IRpcContext) => {
    this.signal = context.signal
    this.started.resolve()
    try {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            this.observedAborts += 1
            this.aborted.resolve()
            resolve()
          },
          { once: true }
        )
      })
      return context.success(await this.#result.promise)
    } finally {
      this.finished.resolve()
    }
  }

  /** Release the same original business result without changing provider cancellation state. */
  resolve(value: unknown): void {
    this.#result.resolve(value)
  }

  /** Reject the original business Promise with the exact failure object supplied by its caller. */
  reject(error: unknown): void {
    this.#result.reject(error)
  }
}

/** Preserve the original two zero-delay delivery turns before inspecting negative late-write facts. */
async function settleProviderDelivery(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

it('active repeated caller cancellation aborts the original provider exactly once', async () => {
  /** The same signal/business owner receives both original active and same-tick observations. */
  const provider = new SignalTerminalProvider()
  /** These are real public Hosts, original physical endpoints and the canonical provider catalog. */
  const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
  /** Repeated cancellation belongs to the caller's original native controller. */
  const controller = new AbortController()
  /** Observe rejection before either abort can settle the caller. */
  const pending = Promise.allSettled([
    fixture.a.memory.send('b', 'wait', null, { signal: controller.signal, timeout: false })
  ])
  try {
    await provider.started.promise
    controller.abort()
    controller.abort()
    await provider.aborted.promise
    provider.resolve('late')
    await provider.finished.promise
    await pending
    expect(provider.observedAborts).toBe(1)
    /** The same actual public cleanup owner retains the original repeated completion identity. */
    const hostDispose = fixture.b.close()
    expect(fixture.b.close()).toBe(hostDispose)
    await hostDispose
  } finally {
    controller.abort()
    provider.resolve('late')
    await pending
    await fixture.close()
  }
})

it('caller cancellation stays isolated between two independently installed provider Hosts', async () => {
  /** Independent real provider owners expose signal state instead of private controller Map sizes. */
  const firstProvider = new SignalTerminalProvider()
  /** The second actual business remains live when only the first caller aborts. */
  const secondProvider = new SignalTerminalProvider()
  /** Each fixture owns its genuine SessionTable and physical native connection. */
  const first = await connectedCoreHosts({}, { wait: firstProvider.run }, () => undefined)
  /** No private Peer, shared cancellation port or fabricated endpoint controls the other Host. */
  const second = await connectedCoreHosts({}, { wait: secondProvider.run }, () => undefined)
  /** The first signal authorizes cancellation only for its actual originating call. */
  const firstController = new AbortController()
  /** The other caller retains its independent native cancellation authority. */
  const secondController = new AbortController()
  /** Attach both real rejection handlers before issuing either cancellation. */
  const pending = Promise.allSettled([
    first.a.memory.send('b', 'wait', null, { signal: firstController.signal, timeout: false }),
    second.a.memory.send('b', 'wait', null, { signal: secondController.signal, timeout: false })
  ])
  try {
    await Promise.all([firstProvider.started.promise, secondProvider.started.promise])
    firstController.abort()
    await firstProvider.aborted.promise
    expect(secondProvider.signal?.aborted).toBe(false)
    secondController.abort()
    await secondProvider.aborted.promise
    firstProvider.resolve('r71-isolation-first')
    secondProvider.resolve('r71-isolation-second')
    await Promise.all([firstProvider.finished.promise, secondProvider.finished.promise])
    await pending
    expect(firstProvider.signal?.aborted).toBe(true)
    expect(secondProvider.signal?.aborted).toBe(true)
  } finally {
    firstController.abort()
    secondController.abort()
    firstProvider.resolve('r71-isolation-first')
    secondProvider.resolve('r71-isolation-second')
    await pending
    await Promise.all([first.close(), second.close()])
  }
})

it('caller cancellation late resolve emits only its CANCELLED terminal and no failure report', async () => {
  /** The original business ignores caller settlement until its actual remote abort arrives. */
  const provider = new SignalTerminalProvider()
  /** Reports retain their actual public error objects without a private command projection. */
  const reports: unknown[] = []
  /** Only the provider Host contributes to the original failure report count. */
  const fixture = await connectedCoreHosts(
    {},
    { wait: provider.run },
    () => undefined,
    undefined,
    (error) => reports.push(error)
  )
  /** The original caller cancels after genuine provider entry. */
  const controller = new AbortController()
  /** Rejection observation is installed before the physical cancellation is issued. */
  const pending = Promise.allSettled([
    fixture.a.memory.send('b', 'wait', null, { signal: controller.signal, timeout: false })
  ])
  try {
    await provider.started.promise
    /** The real physical call supplies its original correlation id. */
    const call = fixture.pair[0].written.find((frame) => frame.kind === RpcWireKind.call)
    assert(call?.kind === RpcWireKind.call)
    controller.abort()
    await provider.aborted.promise
    provider.resolve('late-success')
    await provider.finished.promise
    await pending
    await settleProviderDelivery()
    /** Retires the old zero-frame shape; no late business result may become the call result. */
    const terminals = fixture.pair[1].written.filter(
      (message) =>
        (message.kind === RpcWireKind.result || message.kind === RpcWireKind.error) &&
        message.id === call.id
    )
    expect(terminals).toHaveLength(1)
    /** This is the actual error terminal for the original call, not a successful late value. */
    const terminal = terminals[0]
    assert(terminal?.kind === RpcWireKind.error)
    expect(terminal).toMatchObject({
      profile: RpcWireProfile,
      kind: RpcWireKind.error,
      id: call.id,
      route: {
        senderId: call.route.receiverId,
        receiverId: call.route.senderId,
        targetId: call.route.senderId
      }
    })
    expect(terminal.task).toEqual(call.task)
    expect(terminal.error.nodes[terminal.error.root]?.code).toBe(RpcCoreErrorCode.cancelled)
    expect(terminals.filter((message) => message.kind === RpcWireKind.result)).toHaveLength(0)
    expect(reports).toHaveLength(0)
    /** Preserve the original repeated dispose completion on this same actual provider Host. */
    const hostDispose = fixture.b.close()
    expect(fixture.b.close()).toBe(hostDispose)
    await hostDispose
  } finally {
    controller.abort()
    provider.resolve('late-success')
    await pending
    await fixture.close()
  }
})

it('caller cancellation late reject reports the original error with only its CANCELLED terminal', async () => {
  /** Keep the original unmodified late failure object at the provider business boundary. */
  const latePrimary = new Error('r71 late rejection')
  /** The actual provider remains alive until the original late business failure is released. */
  const provider = new SignalTerminalProvider()
  /** The public report callback receives the actual failure, never an invented old command DTO. */
  const reports: unknown[] = []
  /** Caller and provider diagnostics remain isolated as in the original provider-only observation. */
  const fixture = await connectedCoreHosts(
    {},
    { wait: provider.run },
    () => undefined,
    undefined,
    (error) => reports.push(error)
  )
  /** Only this original caller controls its real in-flight cancellation. */
  const controller = new AbortController()
  /** Attach before cancelling so local settlement cannot become an unhandled fixture rejection. */
  const pending = Promise.allSettled([
    fixture.a.memory.send('b', 'wait', null, { signal: controller.signal, timeout: false })
  ])
  try {
    await provider.started.promise
    /** The original call id comes from the actual native write rather than a synthetic task. */
    const call = fixture.pair[0].written.find((frame) => frame.kind === RpcWireKind.call)
    assert(call?.kind === RpcWireKind.call)
    controller.abort()
    await provider.aborted.promise
    provider.reject(latePrimary)
    await provider.finished.promise
    await pending
    await settleProviderDelivery()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(latePrimary)
    /** The new-profile terminal must retain cancellation rather than the late business failure. */
    const terminals = fixture.pair[1].written.filter(
      (message) =>
        (message.kind === RpcWireKind.result || message.kind === RpcWireKind.error) &&
        message.id === call.id
    )
    expect(terminals).toHaveLength(1)
    /** Verify the exact original task/source association before accepting the cancellation code. */
    const terminal = terminals[0]
    assert(terminal?.kind === RpcWireKind.error)
    expect(terminal).toMatchObject({
      profile: RpcWireProfile,
      kind: RpcWireKind.error,
      id: call.id,
      route: {
        senderId: call.route.receiverId,
        receiverId: call.route.senderId,
        targetId: call.route.senderId
      }
    })
    expect(terminal.task).toEqual(call.task)
    expect(terminal.error.nodes[terminal.error.root]?.code).toBe(RpcCoreErrorCode.cancelled)
    expect(terminals.filter((message) => message.kind === RpcWireKind.result)).toHaveLength(0)
    /** The actual provider cleanup owns one stable completion after its business has failed. */
    const hostDispose = fixture.b.close()
    expect(fixture.b.close()).toBe(hostDispose)
    await hostDispose
  } finally {
    controller.abort()
    provider.resolve('unreachable')
    await pending
    await fixture.close()
  }
})

// / owner review M8: acknowledging this operation's abort is normal provider completion.
it('caller cancellation acknowledgment does not report the original provider signal reason', async () => {
  /** The same provider holds business completion until its actual remote signal aborts. */
  const provider = new SignalTerminalProvider()
  /** This report window belongs only to the real receiving Host. */
  const reports: unknown[] = []
  const fixture = await connectedCoreHosts(
    {},
    { wait: provider.run },
    () => undefined,
    undefined,
    (error) => reports.push(error)
  )
  const controller = new AbortController()
  const pending = Promise.allSettled([
    fixture.a.memory.send('b', 'wait', null, { signal: controller.signal, timeout: false })
  ])
  try {
    await provider.started.promise
    controller.abort(new Error('caller cancelled'))
    await provider.aborted.promise
    assert(provider.signal?.aborted)
    provider.reject(provider.signal.reason)
    await provider.finished.promise
    await pending
    await settleProviderDelivery()
    expect(reports).toEqual([])
    /** The actual cancellation still produces its sole correlated error terminal. */
    const terminals = fixture.pair[1].written.filter(
      (frame) => frame.kind === RpcWireKind.error || frame.kind === RpcWireKind.result
    )
    expect(terminals).toHaveLength(1)
    const terminal = terminals[0]
    assert(terminal?.kind === RpcWireKind.error)
    expect(terminal.error.nodes[terminal.error.root]?.code).toBe(RpcCoreErrorCode.cancelled)
  } finally {
    controller.abort()
    provider.resolve('unreachable')
    await pending
    await fixture.close()
  }
})
