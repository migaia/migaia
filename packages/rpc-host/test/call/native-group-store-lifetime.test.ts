/** Original group refusal and fail-stop replay use the installed native store and quota owners. */
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import {
  createRpcIdempotencyStore,
  idempotency,
  type IRpcIdempotencyStore,
  type IRpcOutcomeLookup
} from '@migaia/rpc-host/plugins/idempotency'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { deferred } from '@migaia/utils/promise'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'
import { coreMemoryServer } from '../host/core-fixture.js'
import { RuntimeApiFixtureText } from '../fixtures/runtime-api-text.js'

/** Acquire two real public Hosts with the same optional policy owners as the original group cases. */
async function connectGroupStore(
  provide: IRpcHostOptions['provide'],
  store?: IRpcIdempotencyStore
) {
  /** Every original diagnostic remains available; no error-filtering reporter is substituted. */
  const failures: unknown[] = []
  /** The genuine listener lends its actual Session attachment and original physical endpoints. */
  const server = coreMemoryServer('group-store-provider')
  /** Quotas and keyed execution are complete installed Features rather than a test-side registry. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [limits(), idempotency({ store }), server.transport],
    provide,
    report: (error) => failures.push(error)
  })
  try {
    /** Only dynamic fixture typing erases the genuine outcome extension's cold declared type. */
    const client = await server.connect('group-store-caller', {
      plugins: [idempotency()],
      report: (error) => failures.push(error)
    })
    /** This is the original published callable; no lookup or outcome state is fabricated. */
    const lookup = Reflect.get(client.host.memory, 'outcome') as IRpcOutcomeLookup
    return {
      host,
      client: client.host,
      lookup,
      failures,
      close: () => Promise.all([client.host.close(), host.close()])
    }
  } catch (primary) {
    await host.close()
    throw primary
  }
}

/** A passthrough acquisition observation borrows the actual installed registry, never a facade. */
function actualAdmission(observation: {
  readonly mock: { readonly contexts: readonly unknown[] }
}) {
  /** Only an original method receiver can supply this quota owner's live state. */
  const owner = observation.mock.contexts.find(
    (value): value is ProviderAdmissionRegistry => value instanceof ProviderAdmissionRegistry
  )
  assert(owner)
  return owner
}

/** Observe the original registry's entry state before delegating the exact atomic acquisition. */
function observeAdmission() {
  /** No independent quota is maintained; these are passive original owner counts at entry. */
  const before: number[] = []
  /** Preserve the original method receiver, arguments and return value without an adapter. */
  const acquire = ProviderAdmissionRegistry.prototype.acquireMany
  /** Only real dispatch enters this original installed registry operation. */
  const spy = vi
    .spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
    .mockImplementation(function (this: ProviderAdmissionRegistry, ...args) {
      before.push(this.size)
      return Reflect.apply(acquire, this, args)
    })
  return { spy, before }
}

// Full and fingerprint refusals never execute either original member.
it.each(['full', 'fingerprint'] as const)(
  'real group store %s refusal releases provisional leases and preserves the sealed key',
  async (refusal) => {
    /** Only actual application entry changes this original business count. */
    let effects = 0
    /** The supported public factory retains the exact original one-entry capacity. */
    const store = createRpcIdempotencyStore({ maxEntries: 1 })
    /** This observer delegates every admission to the genuine installed optional quota owner. */
    const admitting = observeAdmission()
    /** Both real methods retain the original distinct fingerprint and effect semantics. */
    const fixture = await connectGroupStore(
      { value: () => ++effects, other: () => ++effects },
      store
    )
    try {
      await fixture.client.memory.group([{ method: 'value' }, { method: 'value' }], {
        idempotencyKey: 'sealed-key'
      })
      /** Original physical invocation, rather than a replacement quota, supplies the live owner. */
      const admission = actualAdmission(admitting.spy)
      assert.equal(admitting.before[0], 0)
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(effects, 2)
      for (let index = 0; index < 2; index++) {
        await assert.rejects(
          fixture.client.memory.group([{ method: 'value' }, { method: 'other' }], {
            idempotencyKey: refusal === 'full' ? `refused-${index}` : 'sealed-key'
          }),
          { code: refusal === 'full' ? 'OVERLOADED' : 'CONTRACT_INVALID' }
        )
        await vi.waitFor(() => assert.equal(admission.size, 0))
        assert.equal(effects, 2, 'refused group executes no member')
      }
      /** This read reaches the same remote store rather than retaining a local completion cache. */
      const outcome = await fixture.lookup('sealed-key')
      assert('state' in outcome)
      assert.equal(outcome.state, 'done')
      /** Unkeyed work still reaches both original methods after repeated keyed refusals. */
      const next = await fixture.client.memory.group([{ method: 'value' }, { method: 'other' }])
      assert(Array.isArray(next))
      assert.deepEqual(
        next.map((step) => step.state),
        ['success', 'success']
      )
      assert.equal(effects, 4)
      assert.ok(fixture.failures.length >= 2, 'store refusal remains observable')
    } finally {
      await fixture.close()
      admitting.spy.mockRestore()
    }
  }
)

// Move the original failing member through all three positions.
it.each([0, 1, 2] as const)(
  'failed group member %i releases unused leases without executing its suffix',
  async (failureIndex) => {
    /** Original provider entry, including the failing member, determines this ordered trace. */
    const effects: string[] = []
    /** Live quota state belongs only to the installed limits Feature. */
    const admitting = observeAdmission()
    /** Genuine native dispatch alone chooses fail-stop behavior and return values. */
    const fixture = await connectGroupStore({
      value: () => {
        effects.push('value')
        return effects.length
      },
      fail: () => {
        effects.push('fail')
        throw new RangeError(RuntimeApiFixtureText.businessRange)
      }
    })
    try {
      /** Every original failure position uses the same three-member public group. */
      const steps = Array.from({ length: 3 }, (_, index) => ({
        method: index === failureIndex ? 'fail' : 'value'
      }))
      /** The actual provider execution determines this original complete result. */
      const result = await fixture.client.memory.group(steps)
      assert(Array.isArray(result))
      assert.deepEqual(
        result.map((step) => step.state),
        steps.map((_, index) =>
          index < failureIndex ? 'success' : index === failureIndex ? 'failure' : 'not-executed'
        )
      )
      /** The real quota owner has released both invoked and uninvoked member reservations. */
      const admission = actualAdmission(admitting.spy)
      assert.equal(admitting.before[0], 0)
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.deepEqual(effects, [...Array<string>(failureIndex).fill('value'), 'fail'])
      await fixture.client.memory.group([{ method: 'value' }, { method: 'value' }])
      await vi.waitFor(() => assert.equal(admission.size, 0))
    } finally {
      await fixture.close()
      admitting.spy.mockRestore()
    }
  }
)

// Actual pending and done claims never run an unused group suffix.
it.each(['done', 'pending'] as const)(
  'cached %s group completion preserves the fail-stop prefix without repeating business',
  async (cached) => {
    /** The original failing method is the sole writer of this business count. */
    let effects = 0
    /** Only the original provider can release its still-running native invocation. */
    const business = deferred<void>()
    /** An actual pending duplicate must reserve its original three member leases. */
    const admitting = observeAdmission()
    /** This supported store owns both original callers' claim and complete sealed outcome. */
    const fixture = await connectGroupStore({
      fail: async () => {
        effects++
        await business.promise
        throw new RangeError(RuntimeApiFixtureText.businessRange)
      },
      unused: () => ++effects
    })
    /** Finally joins every genuine operation even when a preserved assertion fails. */
    let running: Promise<unknown> | undefined
    try {
      /** Both callers retain precisely the same original body and business key. */
      const steps = [{ method: 'fail' }, { method: 'unused' }, { method: 'unused' }]
      /** This one real public operation owns the original store claim and provider effect. */
      const first = fixture.client.memory.group(steps, { idempotencyKey: 'cached-failure-prefix' })
      running = first
      void first.catch(() => undefined)
      await vi.waitFor(() => assert.equal(effects, 1))
      /** Passive method context supplies the actual provider's installed registry. */
      const admission = actualAdmission(admitting.spy)
      assert.equal(admitting.before[0], 0)
      if (cached === 'done') {
        business.resolve()
        await first
        await vi.waitFor(() => assert.equal(admission.size, 0))
      }
      /** Repetition reaches the real native pending/done branch without a fixture replay owner. */
      const repeated = fixture.client.memory.group(steps, {
        idempotencyKey: 'cached-failure-prefix'
      })
      running = Promise.all([first, repeated])
      void running.catch(() => undefined)
      if (cached === 'pending') await vi.waitFor(() => assert.equal(admission.size, 6))
      business.resolve()
      /** Both original callers independently receive the complete original fail-stop outcome. */
      const results = await Promise.all([first, repeated])
      for (const result of results) {
        assert(Array.isArray(result))
        assert.deepEqual(
          result.map((step) => step.state),
          ['failure', 'not-executed', 'not-executed']
        )
      }
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(effects, 1, 'cached group completion never repeats business')
    } finally {
      business.resolve()
      await fixture.close()
      await running?.catch(() => undefined)
      admitting.spy.mockRestore()
    }
  }
)
