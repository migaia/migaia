/** Original middleware activation observations use one genuine native install transaction. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import type {
  IRpcCarrierReceiver,
  IRpcDispatchContext,
  IRpcDispatchOutcome
} from '@migaia/rpc-contract/interfaces'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from './core-fixture.js'

/** The actual native method is captured before any scoped observation replaces its lookup. */
const nativeSubscribe = MemoryCarrier.prototype.subscribe

/** Forward the exact receiver and native cleanup; only the original cleanup invocation is spied. */
function observeSubscription(this: MemoryCarrier, receiver: IRpcCarrierReceiver) {
  return vi.fn(Reflect.apply(nativeSubscribe, this, [receiver]))
}

/** This record contains only original native participants and bounded test observations. */
type IActivationInput = {
  server: ReturnType<typeof coreMemoryServer>
  client?: Awaited<ReturnType<ReturnType<typeof coreMemoryServer>['connect']>>
  enter: IDeferred<void>
  gate?: IDeferred<void>
  entered: boolean
  dispatches: number
}

/** The native Feature owns the real provider callback; no protocol or dispatch facade is added. */
function providerMethods(input: IActivationInput) {
  return {
    echo: (value: unknown) => {
      input.dispatches += 1
      return value
    }
  }
}

/** A normal native provider participates in the same original use transaction as its transport. */
function provider(input: IActivationInput) {
  return definePlugin({
    name: 'activation-provider',
    features: { api: defineFeature(() => providerMethods(input)) },
    install: () => ({})
  })
}

/** Acquire the real connection, then hold the last native participant before final batch commit. */
function finalParticipant(input: IActivationInput) {
  return definePlugin({
    name: 'activation-final-participant',
    install: async () => {
      input.client = await input.server.connect('activation-client')
      input.entered = true
      input.enter.resolve()
      await input.gate?.promise
      return {}
    }
  })
}

/** Observe actual incoming dispatch after its original continuation has entered the native gate. */
function dispatchObservation(entered: IDeferred<void>) {
  /** The existing flow hook only observes the genuine continuation; it never holds or replaces it. */
  const inbound = (
    _context: IRpcDispatchContext,
    next: () => Promise<IRpcDispatchOutcome>
  ): Promise<IRpcDispatchOutcome> => {
    const completion = next()
    entered.resolve()
    return completion
  }
  return defineFlowPlugin({
    name: 'activation-dispatch-observation',
    setup: () => ({ hooks: { dispatch: { inbound } } })
  })
}

it('C123 keeps native installation pending and business gated until final commit', async () => {
  /** Mutation deadlines are disabled only through the real native Host's public options. */
  const native = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The existing genuine listener keeps its original accepted-session and physical IO owner. */
  const input: IActivationInput = {
    server: coreMemoryServer(
      'native-activation',
      'native-activation',
      'memory',
      [],
      ['activation-provider.echo']
    ),
    enter: deferred<void>(),
    gate: deferred<void>(),
    entered: false,
    dispatches: 0
  }
  /** This scoped passthrough sees actual carrier receiver installation, including handshake ingress. */
  const subscription = vi
    .spyOn(MemoryCarrier.prototype, 'subscribe')
    .mockImplementation(observeSubscription)
  /** A genuine inbound flow notification proves the public call reached the original gate. */
  const dispatched = deferred<void>()
  /** Preserve the original distinction between entering activation and finishing installation. */
  let settled = false
  /** Observe rejection immediately while retaining the actual native transaction completion. */
  const installing = native
    .use(
      provider(input),
      dispatchObservation(dispatched),
      input.server.transport,
      finalParticipant(input)
    )
    .then((result) => {
      settled = true
      return result
    })
  void installing.catch(() => undefined)
  try {
    await Promise.race([input.enter.promise, installing])
    /** The genuine source has completed both ready handshakes, but the native batch is still held. */
    const carrier = input.client!.pair[0]
    expect(input.entered).toBe(true)
    expect(settled).toBe(false)
    // C123-A003/A004: old activation subscribe0/physical-send0 retire under BC2/BC3, without PASS.
    /** This new public witness is independent of the old fixture's physical-send counter. */
    const pending = input.client!.host.memory.request('activation-provider.echo', 'before-commit')
    void pending.catch(() => undefined)
    await Promise.race([dispatched.promise, pending])
    expect(input.dispatches).toBe(0)
    expect(settled).toBe(false)
    input.gate!.resolve()
    await installing
    expect(await pending).toBe('before-commit')
    expect(input.dispatches).toBe(1)
    expect(subscription.mock.contexts.filter((receiver) => receiver === carrier).length).toBe(1)
  } finally {
    input.gate!.resolve()
    await installing.catch(() => undefined)
    try {
      await Promise.all([native.dispose(), input.client?.host.close()])
    } finally {
      subscription.mockRestore()
    }
  }
})

it('C124 installs one actual native carrier receiver and keeps its subscription active', async () => {
  /** This is the actual native owner, not a reconstructed RPC activation port. */
  const native = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The same real final participant completes without a gate in the successful installation. */
  const input: IActivationInput = {
    server: coreMemoryServer(
      'native-activation',
      'native-activation',
      'memory',
      [],
      ['activation-provider.echo']
    ),
    enter: deferred<void>(),
    entered: false,
    dispatches: 0
  }
  /** Both native endpoints pass through the original method with their exact receiver objects. */
  const subscription = vi
    .spyOn(MemoryCarrier.prototype, 'subscribe')
    .mockImplementation(observeSubscription)
  try {
    await native.use(provider(input), input.server.transport, finalParticipant(input))
    /** Select this original native endpoint, never a copied Session view or public peer count. */
    const carrier = input.client!.pair[0]
    /** The original returned remover is observed without adding diagnostic fields to the carrier. */
    const position = subscription.mock.contexts.findIndex((receiver) => receiver === carrier)
    /** Active means the real subscription has not had its original cleanup invoked. */
    const remove = vi.mocked(subscription.mock.results[position]!.value)
    expect(subscription.mock.contexts.filter((receiver) => receiver === carrier).length).toBe(1)
    expect(1 - remove.mock.calls.length).toBe(1)
  } finally {
    try {
      await Promise.all([native.dispose(), input.client?.host.close()])
    } finally {
      subscription.mockRestore()
    }
  }
})
