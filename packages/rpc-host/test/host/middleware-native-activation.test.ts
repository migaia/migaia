/** Original middleware activation observations use one genuine native install transaction. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import type { IRpcCarrierReceiver } from '@migaia/rpc-contract/interfaces'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
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

it('C123 keeps native installation pending and business gated until final commit', async () => {
  /** Declaration and genuine native execution authority use the same public SDK boundary. */
  const rpc = rpcHostPipelines(
    () => native,
    (name) => native.pipeline(name),
    ['memory']
  )
  /** Mutation deadlines are disabled only through the real native Host's public options. */
  const native = defineHost({
    ...rpc,
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
  /** Preserve the original distinction between entering activation and finishing installation. */
  let settled = false
  /** Observe rejection immediately while retaining the actual native transaction completion. */
  const installing = native
    .use(provider(input), input.server.transport, finalParticipant(input))
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
    /** Cold native stages publish at commit; real carrier ingress proves the pending gate first. */
    await vi.waitFor(() =>
      expect(input.client!.pair[1].written.some((frame) => frame.kind === 'call')).toBe(true)
    )
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
  /** Lazy owner capture does not access this handle before its native construction completes. */
  const rpc = rpcHostPipelines(
    () => native,
    (name) => native.pipeline(name),
    ['memory']
  )
  /** This is the actual native owner, not a reconstructed RPC activation port. */
  const native = defineHost({
    ...rpc,
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

// RPC-TEST-CD50052EF4A5-C003/C004: retain real subscription counts without an activation facade.
it.each(['commit', 'rollback'] as const)(
  'transaction %s keeps the preceding observer unsubscribed and preserves actual acquisition counts',
  async (outcome) => {
    /** One actual native owner carries both the observer and the genuine transport definition. */
    const rpc = rpcHostPipelines(
      () => native,
      (name) => native.pipeline(name),
      ['memory']
    )
    /** Native installation remains the only transaction and cleanup authority. */
    const native = defineHost({
      ...rpc,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** The existing real final participant connects the original physical endpoints on success. */
    const input: IActivationInput = {
      server: coreMemoryServer('transaction-subscription'),
      enter: deferred<void>(),
      entered: false,
      dispatches: 0
    }
    /** This passthrough records only actual MemoryCarrier receiver acquisition. */
    const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
    /** Earlier setup records the actual count before native installation reaches its transport. */
    const observation = {
      before: -1,
      primary: new Error('transaction before native subscription')
    }
    /** The real preceding install hook reads the physical count without opening a carrier. */
    const observer = definePlugin({
      name: 'transaction-subscription-observer',
      install() {
        observation.before = subscribed.mock.calls.length
        return {}
      }
    })
    /** A failed earlier native hook must leave the original cold transport untouched. */
    const later =
      outcome === 'rollback'
        ? [
            definePlugin({
              name: 'transaction-subscription-failure',
              install() {
                throw observation.primary
              }
            })
          ]
        : []
    try {
      /** Observe the genuine transaction result; no legacy installing/activation Promise exists. */
      const failure = await native
        .use(observer, ...later, input.server.transport, finalParticipant(input))
        .then(
          () => undefined,
          (error: unknown) => error
        )
      expect(observation.before).toBe(0)
      if (outcome === 'commit') {
        expect(failure).toBeUndefined()
        /** Select only this original endpoint, excluding its opposite real receiving Host. */
        const carrier = input.client!.pair[0]
        expect(subscribed.mock.contexts.filter((receiver) => receiver === carrier).length).toBe(1)
      } else {
        expect((failure as Error).cause).toBe(observation.primary)
        expect(subscribed.mock.calls.length).toBe(0)
      }
    } finally {
      try {
        await Promise.all([native.dispose(), input.client?.host.close()])
      } finally {
        subscribed.mockRestore()
      }
    }
  }
)
