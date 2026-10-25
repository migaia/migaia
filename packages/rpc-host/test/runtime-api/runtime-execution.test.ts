import assert from 'node:assert/strict'
import { it } from 'vitest'
import { ProviderExecutor } from '../../dist/core/internal/provider-executor.js'
import { ProviderRegistry } from '../../dist/core/internal/provider.js'
import { ProviderAdmissionRegistry } from '../../dist/core/internal/provider-admission.js'
import { RequestReplayLedger } from '../../dist/core/internal/request-replay-ledger.js'
import { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import { RpcRuntimeStreamPrefix } from '@migaia/rpc-contract/framing/v1'
import { createRpcIdempotencyStore } from '../../dist/core/idempotency-store.js'
import type { IRpcRuntimeEnvelope, IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcProviderController } from '../../dist/core/internal/plugin-shared-keys.js'
import { deserializeRpcError } from '../../dist/host/error-wire-metadata.js'
import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { localRpcErrorCode } from '../../dist/host/error-owner.js'
import type { IRpcIdempotencyStore } from '../../dist/core/idempotency-store.js'

/** Test content is admitted by the genuine grammar before the original executor sees it. */
function group(id: string, methods: readonly string[], options: object = {}): IRpcRuntimeEnvelope {
  return normalizeRuntimeEnvelope({
    profile: 'migaia.rpc.runtime-api/1',
    kind: 'runtime-group',
    id,
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      targetId: 'provider',
      receiverId: 'provider',
      sentAt: 0
    },
    task: {
      mode: 'group',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'restart', value: 0, providerId: 'provider' }
    },
    steps: methods.map((method) => ({ method })),
    options
  })
}

/**
 * A planned method is asserted on the existing class; importing new production modules is
 * unnecessary.
 */
type IRuntimeExecutor = ProviderExecutor<string> & {
  executeRuntime(
    envelope: IRpcRuntimeEnvelope,
    peer: string,
    ports: {
      generation: IRpcRuntimeGeneration
      callerGeneration: IRpcRuntimeGeneration
      replay: RequestReplayLedger
      send(envelope: IRpcRuntimeEnvelope, onPrepared?: () => Promise<void>): Promise<void>
    }
  ): Promise<void>
}

/** All business/quota/replay/store/controller behavior comes from the original production owners. */
function owner(
  maxGlobal = 6,
  maxReplay = 16,
  store: IRpcIdempotencyStore = createRpcIdempotencyStore()
) {
  const registry = new ProviderRegistry()
  const admission = new ProviderAdmissionRegistry(maxGlobal, maxGlobal)
  const replay = new RequestReplayLedger(maxReplay, maxReplay)
  const controllers = new Map<string, IRpcProviderController>()
  const replies: IRpcRuntimeEnvelope[] = []
  const rejected: unknown[] = []
  /** The actual executor timer port records its own deadline callback without wall-clock races. */
  const timers = new Set<() => void>()
  const executor = new ProviderExecutor<string>({
    id: 'provider',
    registry,
    admission,
    controllers,
    idempotencyStore: store,
    peers: [],
    now: () => 0,
    timestamp: () => 0,
    setTimeout: (task) => {
      timers.add(task)
      return {
        clear: () => {
          timers.delete(task)
        }
      }
    },
    clearTimeout: (timer) => {
      timer.clear()
    },
    send: async () => undefined,
    dispatch: () => undefined,
    validate: () => undefined,
    emitFailure: () => undefined,
    onRejected: (value) => {
      rejected.push(value)
    }
  }) as IRuntimeExecutor
  const ports = {
    generation: { kind: 'restart', value: 0, providerId: 'provider' } as const,
    callerGeneration: { kind: 'session', value: 0, providerId: 'caller' } as const,
    replay,
    send: async (envelope: IRpcRuntimeEnvelope, onPrepared?: () => Promise<void>) => {
      await onPrepared?.()
      replies.push(normalizeRuntimeEnvelope(envelope))
    }
  }
  return {
    registry,
    admission,
    replay,
    controllers,
    replies,
    rejected,
    executor,
    ports,
    store,
    timers
  }
}

/** The accepted public grammar supplies this task's actual stream mode and final provider method. */
function stream(id: string, options: object = {}): IRpcRuntimeEnvelope {
  /** All fixtures share the same authentic caller/provider generation selected by the harness. */
  const base = group(id, ['value'])
  return normalizeRuntimeEnvelope({
    profile: base.profile,
    kind: 'runtime-call',
    id,
    route: base.route,
    task: { ...base.task, mode: 'stream', method: 'value' },
    options
  })
}

it.each([RpcCoreErrorCode.cancelled, RpcCoreErrorCode.deadlineExceeded] as const)(
  'genuine stored %s stream replay restores only wire cancellation after store cloning',
  async (code) => {
    /** The actual store persists original owner-set outcomes; its adapter returns fresh snapshots. */
    const originalStore = createRpcIdempotencyStore()
    /** Copying models an ordinary custom store boundary without inventing another claim owner. */
    const store: IRpcIdempotencyStore = {
      claim: (scope, key, now, fingerprint) => {
        const claim = originalStore.claim(scope, key, now, fingerprint)
        return claim.status === 'done'
          ? { status: 'done', outcome: structuredClone(claim.outcome) }
          : claim.status === 'pending'
            ? {
                status: 'pending',
                outcome: claim.outcome.then((outcome) => structuredClone(outcome))
              }
            : claim
      },
      lookup: (scope, key, now) => structuredClone(originalStore.lookup!(scope, key, now))
    }
    /** The production executor receives the store through its existing capability. */
    const harness = owner(6, 16, store)
    /** Hold a real predecessor so the initial stream cancels before provider construction. */
    let finish!: () => void
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** No initial or replayed cancellation may construct the business iterator. */
    let effects = 0
    harness.registry.register('hold', async (context) => {
      await held
      return context.success(1)
    })
    harness.registry.register('value', (context) => context.success(3))
    harness.registry.registerStream(`${RpcRuntimeStreamPrefix}value`, () => {
      effects++
      throw new Error('cached business must not run')
    })
    const first = harness.executor.executeRuntime(
      group('hold', ['hold'], { orderKey: 'queue' }),
      'peer',
      harness.ports
    )
    try {
      /** Only the real timer supplies a deadline; ordinary cancellation is a real controller intent. */
      const options = {
        orderKey: 'queue',
        idempotencyKey: 'stream-key',
        cancel: 'before-start',
        ...(code === RpcCoreErrorCode.deadlineExceeded ? { timeoutMs: 5 } : {})
      }
      const initial = harness.executor.executeRuntime(
        stream('initial', options),
        'peer',
        harness.ports
      )
      const controller = [...harness.controllers.values()][1]!
      if (code === RpcCoreErrorCode.deadlineExceeded) {
        ;[...harness.timers][0]!()
      } else controller.cancelIntent!()
      await initial
      /** The completed result, not a live error identity, comes back from the held store. */
      const cached = harness.executor.executeRuntime(
        stream('cached', {
          orderKey: 'queue',
          idempotencyKey: 'stream-key',
          cancel: 'before-start'
        }),
        'peer',
        harness.ports
      )
      const replayController = [...harness.controllers.values()][1]!
      /** Reading the native signal proves replay did not call cancellation on this new operation. */
      const signal = replayController.signal
      finish()
      await first
      await cached
      const terminal = harness.replies.find((reply) => reply.id === 'cached')!
      assert.ok(terminal.kind === 'runtime-control' && terminal.operation === 'stream')
      if (terminal.kind !== 'runtime-control' || terminal.operation !== 'stream')
        assert.fail('replayed terminal missing')
      assert.equal(terminal.stream.event, 'cancelled')
      assert.equal(terminal.stream.error?.source, RPC_CORE_ERROR_SOURCE)
      assert.equal(terminal.stream.error?.code, code)
      assert.equal(signal.aborted, false, 'cache presentation cannot cancel the new operation')
      assert.equal(localRpcErrorCode(deserializeRpcError(terminal.stream.error)), undefined)
      assert.equal(effects, 0)
      assert.equal(harness.controllers.size, 0)
      assert.equal(harness.admission.size, 0)
      /** The same provider generation remains usable after replay presentation. */
      await harness.executor.executeRuntime(group('after-cache', ['value']), 'peer', harness.ports)
      assert.ok(harness.replies.some((reply) => reply.id === 'after-cache'))
    } finally {
      finish()
      await first
    }
  }
)

it('an original pending keyed claim prevents duplicate execution and seals the complete group before terminal send', async () => {
  const harness = owner()
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  let effects = 0
  harness.registry.register('hold', async (context) => {
    effects++
    await blocked
    return context.success(42)
  })
  assert.equal(typeof Reflect.get(harness.executor, 'executeRuntime'), 'function')
  const first = harness.executor.executeRuntime(
    group('first', ['hold'], { idempotencyKey: 'key' }),
    'peer',
    harness.ports
  )
  const second = harness.executor.executeRuntime(
    group('second', ['hold'], { idempotencyKey: 'key' }),
    'peer',
    harness.ports
  )
  assert.equal(effects, 1, 'pending original claim cannot run the first duplicate member')
  assert.equal(harness.admission.size, 2)
  const scope = JSON.stringify(['migaia.rpc.runtime-api/1', 'provider', 'peer'])
  assert.deepEqual(harness.store.lookup!(scope, 'key', 0), { state: 'pending' })
  complete()
  await Promise.all([first, second])
  assert.equal(effects, 1)
  const retained = harness.store.lookup!(scope, 'key', 0)
  assert.equal(retained.state, 'done')
  assert.equal(harness.replies.length, 2)
  assert.equal(harness.admission.size, 0)
  assert.equal(harness.controllers.size, 0)
})
