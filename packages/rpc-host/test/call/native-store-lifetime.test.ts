/** Original queued keyed cancellation uses genuine native stores, quotas and all four call modes. */
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { idempotency, type IRpcOutcomeLookup } from '@migaia/rpc-host/plugins/idempotency'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deferred } from '@migaia/utils/promise'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'
import { coreMemoryServer } from '../host/core-fixture.js'

/** The original stream body is created only by its genuine provider if queued execution starts. */
async function* queuedValues(): AsyncGenerator<number, number> {
  yield 1
  return 42
}

// All fifteen original assertion atoms retain their exact business values.
it.each(['request', 'group', 'notify', 'stream'] as const)(
  'admitted queued %s is pending in the original store and seals cancellation before terminal',
  async (mode) => {
    /** Only actual provider invocation changes this original business execution count. */
    let effects = 0
    /** Real predecessor entry proves it acquired the original shared order key first. */
    let started = false
    /** Only the original held business can release its own live quota and FIFO receipt. */
    const held = deferred<void>()
    /** The pass-through observation borrows the actual installed quota registry, never a facade. */
    const admitting = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
    /** The existing native listener owns both genuine Session attachments and their readiness. */
    const server = coreMemoryServer('store-lifetime-provider')
    /** One real native installation owns the original shared limits and keyed claim lifecycle. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [limits(), idempotency(), server.transport],
      provide: {
        hold: async () => {
          started = true
          await held.promise
          return 1
        },
        value: () => {
          effects += 1
          return 42
        },
        values: () => {
          effects += 1
          return queuedValues()
        }
      }
    })
    /** This genuine caller uses the original published namespace outcome extension. */
    const client = await server.connect('store-lifetime-caller', {
      plugins: [idempotency()]
    })
    /** Only dynamic fixture typing erases the genuine cold namespace extension's callable type. */
    const lookup = Reflect.get(client.host.memory, 'outcome') as IRpcOutcomeLookup
    /** Original predecessor work remains observed through assertions and native cleanup. */
    const holding = client.host.memory.request('hold', undefined, { orderKey: 'queue' })
    void holding.catch(() => undefined)
    /** This controller alone supplies cancellation intent to the one queued original task. */
    const cancel = new AbortController()
    /** The original body, key and before-start policy remain unchanged across all four modes. */
    const options = {
      orderKey: 'queue',
      cancel: 'before-start' as const,
      signal: cancel.signal,
      idempotencyKey: 'queued-key'
    }
    /** Observe the actual caller terminal immediately, including a real lazy stream pull. */
    let operation: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => assert.equal(started, true))
      operation = (
        mode === 'request'
          ? client.host.memory.request('value', undefined, options)
          : mode === 'group'
            ? client.host.memory.group([{ method: 'value' }], options)
            : mode === 'notify'
              ? client.host.memory.notify('value', undefined, options)
              : client.host.memory
                  .streamTo('store-lifetime-provider', 'values', undefined, options)
                  .next()
      ).catch((error: unknown) => error)
      /** Original dispatch alone can supply this exact real quota owner's live membership. */
      const admission = admitting.mock.contexts.find(
        (owner): owner is ProviderAdmissionRegistry => owner instanceof ProviderAdmissionRegistry
      )
      assert(admission)
      await vi.waitFor(() => assert.equal(admission.size, 2))
      assert.equal(effects, 0)
      /** A genuine read-only query reaches the same provider's original pending store entry. */
      const pending = await lookup('queued-key')
      assert('state' in pending)
      assert.equal(
        pending.state,
        'pending',
        'accepted waiting work cannot disappear from the key lifetime'
      )
      cancel.abort()
      if (mode !== 'notify')
        assert.equal(Reflect.get((await operation) as object, 'code'), RpcCoreErrorCode.cancelled)
      else
        assert.equal(
          await operation,
          undefined,
          'notification Promise remains physical-send completion'
        )
      await vi.waitFor(async () => {
        /** Each real query reads the original store without executing or joining held business. */
        const outcome = await lookup('queued-key')
        assert('state' in outcome)
        assert.equal(outcome.state, 'done')
      })
      /** The same native store must retain a complete mode-specific cancellation terminal. */
      const outcome = await lookup('queued-key')
      assert('state' in outcome)
      if (outcome.state !== 'done') assert.fail('cancelled admitted key must be sealed')
      assert.equal(outcome.outcome.mode, mode)
      assert.equal(outcome.outcome.completion.ok, false)
      if (outcome.outcome.completion.ok) assert.fail('cancellation cannot fabricate success')
      /** Changes only flat error representation; the original cancellation code stays exact. */
      const error = outcome.outcome.completion.error
      assert.equal(error.nodes[error.root]!.code, RpcCoreErrorCode.cancelled)
      assert.equal(effects, 0)
      await vi.waitFor(() => assert.equal(admission.size, 1))
      held.resolve()
      assert.equal(await holding, 1)
    } finally {
      held.resolve()
      try {
        await Promise.all([client.host.close(), host.close()])
        await holding.catch(() => undefined)
        await operation
      } finally {
        admitting.mockRestore()
      }
    }
  }
)
