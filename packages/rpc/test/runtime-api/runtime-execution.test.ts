import assert from 'node:assert/strict'
import { it } from 'vitest'
import { ProviderExecutor } from '../../src/core/internal/provider-executor.js'
import { ProviderRegistry } from '../../src/core/internal/provider.js'
import { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import { normalizeRuntimeEnvelope } from '../../src/contract/runtime-api/normalize.js'
import { createRpcIdempotencyStore } from '../../src/core/idempotency-store.js'
import type {
  IRpcRuntimeEnvelope,
  IRpcRuntimeGeneration
} from '../../src/contract/runtime-api/types.js'
import type { IRpcProviderController } from '../../src/core/internal/plugin-shared-keys.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'
import { RpcTimeoutError } from '../../src/core/errors.js'
import { serializeRpcError, deserializeRpcError } from '../../src/contract/error.js'

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
function owner(maxGlobal = 6, maxReplay = 16) {
  const registry = new ProviderRegistry()
  const admission = new ProviderAdmissionRegistry(maxGlobal, maxGlobal)
  const replay = new RequestReplayLedger(maxReplay, maxReplay)
  const controllers = new Map<string, IRpcProviderController>()
  const replies: IRpcRuntimeEnvelope[] = []
  const rejected: unknown[] = []
  const store = createRpcIdempotencyStore()
  const executor = new ProviderExecutor<string>({
    id: 'provider',
    registry,
    admission,
    controllers,
    idempotencyStore: store,
    peers: [],
    now: () => 0,
    timestamp: () => 0,
    setTimeout: () => {
      throw new Error('fixture has no deadline')
    },
    clearTimeout: () => undefined,
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
  return { registry, admission, replay, controllers, replies, rejected, executor, ports, store }
}

it('[A66] a serialized original deadline retains DEADLINE_EXCEEDED when it wins the final queued start decision', async () => {
  const harness = owner()
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  let effects = 0
  harness.registry.register('hold', async (context) => {
    await blocked
    return context.success(1)
  })
  harness.registry.register('queued', (context) => {
    effects++
    return context.success(2)
  })
  const first = harness.executor.executeRuntime(
    group('first', ['hold'], { orderKey: 'same', cancel: 'before-start' }),
    'peer',
    harness.ports
  )
  try {
    const queued = harness.executor.executeRuntime(
      group('queued', ['queued'], { orderKey: 'same', cancel: 'before-start' }),
      'peer',
      harness.ports
    )
    const restored = deserializeRpcError(
      serializeRpcError(new RpcTimeoutError(), {
        report: (failure) => {
          throw failure.error
        }
      })
    )
    ;[...harness.controllers.values()][1]!.cancelIntent!(restored)
    await queued
    const terminal = harness.replies.find((reply) => reply.id === 'queued')!
    assert.equal(terminal.kind, 'runtime-control')
    if (
      terminal.kind !== 'runtime-control' ||
      terminal.operation !== 'terminal' ||
      terminal.completion.ok
    )
      assert.fail('[A66] queued deadline must produce a failed terminal')
    assert.equal(
      terminal.completion.error.code,
      'DEADLINE_EXCEEDED',
      '[A66] crossing the wire cannot change deadline into caller cancellation'
    )
    assert.equal(terminal.completion.error.source, '@migaia/rpc/core')
    assert.equal(terminal.completion.error.stack, restored.stack)
    assert.equal(effects, 0)
  } finally {
    complete()
    await first
  }
})

it('[A59][A66] same provider/key queues across callers, other keys run, and final start defeats caller cancellation for the entire group', async () => {
  const harness = owner()
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  const effects: string[] = []
  let signal: IRpcAbortSignal | undefined
  harness.registry.register('hold', async (context) => {
    effects.push('hold')
    signal = context.signal
    assert.deepEqual(context.targetGeneration, harness.ports.generation)
    assert.deepEqual(context.callerGeneration, harness.ports.callerGeneration)
    await blocked
    return context.success(1)
  })
  harness.registry.register('after', (context) => {
    effects.push('after')
    return context.success(2)
  })
  harness.registry.register('other', (context) => {
    effects.push('other')
    return context.success(3)
  })
  assert.equal(typeof Reflect.get(harness.executor, 'executeRuntime'), 'function')
  const first = harness.executor.executeRuntime(
    group('first', ['hold', 'after'], { orderKey: 'same', cancel: 'before-start' }),
    'peer',
    harness.ports
  )
  const queued = harness.executor.executeRuntime(
    group('queued', ['after'], { orderKey: 'same', cancel: 'before-start' }),
    'another-peer',
    harness.ports
  )
  const other = harness.executor.executeRuntime(
    group('other', ['other'], { orderKey: 'different', cancel: 'before-start' }),
    'peer',
    harness.ports
  )
  assert.deepEqual(
    effects,
    ['hold', 'other'],
    '[A59] original key scope never partitions by caller'
  )
  assert.equal(harness.admission.size, 4)
  const controllers = [...harness.controllers.values()]
  controllers[0]!.cancelIntent!('started fixture intent')
  assert.equal(signal!.aborted, false, '[A66] start won; the original native signal stays live')
  controllers[1]!.cancelIntent!('queued fixture intent')
  await queued
  await other
  assert.deepEqual(effects, ['hold', 'other'], '[A66] queued cancel won; provider stays zero')
  complete()
  await first
  assert.deepEqual(
    effects,
    ['hold', 'other', 'after'],
    '[A66] later group members cannot be cancelled after group start'
  )
  assert.equal(harness.admission.size, 0)
  assert.equal(harness.controllers.size, 0)
})

it('[A63][A68][A69] an original pending keyed claim prevents duplicate execution and seals the complete group before terminal send', async () => {
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
  assert.equal(effects, 1, '[A63] pending original claim cannot run the first duplicate member')
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

it('[A62][A63] every group member shares one all-or-none replay reservation, including exact rollback after a competing quota refusal', () => {
  const replay = new RequestReplayLedger(3, 3)
  const reserve = Reflect.get(replay, 'reserveMany')
  assert.equal(
    typeof reserve,
    'function',
    '[A62] original replay owner reserves the complete group'
  )
  const owner = replay as RequestReplayLedger & {
    reserveMany(
      keys: readonly string[],
      peer: string,
      now: number
    ): { rollback(): void; release(now: number): void } | undefined
  }
  const first = owner.reserveMany(['a:0', 'a:1'], 'peer', 0)!
  assert.ok(first)
  assert.equal(replay.size, 2)
  assert.equal(owner.reserveMany(['b:0', 'b:1'], 'peer', 0), undefined)
  assert.equal(replay.size, 2)
  first.rollback()
  first.rollback()
  assert.equal(replay.size, 0, '[A63] quota refusal leaves no replay tombstone or half slot')
  const next = owner.reserveMany(['b:0', 'b:1'], 'peer', 0)!
  assert.ok(next)
  next.release(1)
  assert.equal(replay.activeSize, 0)
  assert.equal(replay.size, 2, '[A62] executed members retain original legacy replay protection')
})

it('[A62][A76] unknown or over-budget groups execute nothing; accepted groups preserve success then failure and mark later steps not-executed', async () => {
  const harness = owner(3)
  let effects = 0
  harness.registry.register('first', (context) => {
    effects++
    return context.success(42)
  })
  harness.registry.register('fail', () => {
    throw new RangeError('fixture business failure')
  })
  harness.registry.register('last', (context) => {
    effects++
    return context.success()
  })
  assert.equal(
    typeof Reflect.get(harness.executor, 'executeRuntime'),
    'function',
    '[A62] original final executor owns runtime group execution'
  )
  await harness.executor.executeRuntime(
    group('unknown', ['first', 'missing']),
    'peer',
    harness.ports
  )
  assert.equal(effects, 0)
  assert.equal(harness.admission.size, 0)
  assert.equal(harness.replay.size, 0)
  await harness.executor.executeRuntime(
    group('too-many', ['first', 'last', 'first', 'last']),
    'peer',
    harness.ports
  )
  assert.equal(effects, 0)
  assert.equal(harness.admission.size, 0)
  assert.equal(harness.replay.size, 0)
  await harness.executor.executeRuntime(
    group('accepted', ['first', 'fail', 'last']),
    'peer',
    harness.ports
  )
  assert.equal(effects, 1, '[A76] the successful first side effect is preserved, never rolled back')
  const terminal = harness.replies.at(-1) as Extract<IRpcRuntimeEnvelope, { operation: 'terminal' }>
  assert.equal(terminal.completion.ok, true)
  if (terminal.completion.ok) {
    const result = terminal.completion.result as {
      state: string
      result?: number
      error?: { name: string; stack: string }
    }[]
    assert.deepEqual(
      result.map((value) => value.state),
      ['success', 'failure', 'not-executed']
    )
    assert.equal(result[0]!.result, 42)
    assert.equal(result[1]!.error!.name, 'RangeError')
    assert.ok(result[1]!.error!.stack)
  }
  assert.equal(harness.admission.size, 0)
  assert.equal(harness.controllers.size, 0)
})
