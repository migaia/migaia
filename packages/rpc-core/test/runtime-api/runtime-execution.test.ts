import type { IAbortSignal } from '@migaia/utils/promise'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { ProviderExecutor } from '../../dist/core/internal/provider-executor.js'
import { ProviderRegistry } from '../../dist/core/internal/provider.js'
import { ProviderAdmissionRegistry } from '../../dist/core/internal/provider-admission.js'
import { RequestReplayLedger } from '../../dist/core/internal/request-replay-ledger.js'
import { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import { RpcRuntimeStreamPrefix, RpcRuntimeProfile } from '@migaia/rpc-contract/framing/v1'
import { RpcContractErrorCode } from '@migaia/rpc-contract'
import { createRpcIdempotencyStore } from '../../dist/core/idempotency-store.js'
import type { IRpcRuntimeEnvelope, IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type { IRpcProviderController } from '../../dist/core/internal/plugin-shared-keys.js'
import { RpcTimeoutError } from '../../dist/core/errors.js'
import { serializeRpcError } from '@migaia/rpc-contract'
import { deserializeRpcError } from '../../dist/core/internal/error-wire-metadata.js'
import {
  RpcCoreErrorCode,
  RPC_CORE_ERROR_SOURCE,
  createRpcTimeoutError,
  localRpcErrorCode
} from '../../dist/core/errors.js'
import { attachErrorIdentity } from '@migaia/utils/error'
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
      group('queued', ['queued'], { orderKey: 'same', cancel: 'before-start', timeoutMs: 5 }),
      'peer',
      harness.ports
    )
    /** Only the genuinely registered timer can originate this task's own deadline error. */
    const controller = [...harness.controllers.values()][1]!
    ;[...harness.timers][0]!()
    const restored = deserializeRpcError(
      serializeRpcError(controller.signal.reason, {
        report: (failure) => {
          throw failure.error
        }
      })
    )
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

/** These paths imitate ordinary caller construction, public tagging and public wire restoration. */
function forgedDeadline(kind: 'class' | 'constructor' | 'tag' | 'decode' | 'wire-deadline'): Error {
  if (kind === 'wire-deadline')
    return deserializeRpcError(
      serializeRpcError(createRpcTimeoutError(), {
        report: (failure) => {
          throw failure.error
        }
      })
    )
  if (kind === 'class') return new RpcTimeoutError()
  if (kind === 'constructor') {
    /** A genuinely returned Error exposes a constructor but no access to its owner mint record. */
    const Constructor = createRpcTimeoutError().constructor as typeof RpcTimeoutError
    return new Constructor()
  }
  /** Public wire properties remain diagnostic data in both paths. */
  const wire = {
    source: RPC_CORE_ERROR_SOURCE,
    code: RpcCoreErrorCode.deadlineExceeded,
    name: 'TimeoutError',
    message: 'adapter fixture',
    stack: 'adapter fixture stack'
  }
  if (kind === 'decode') return deserializeRpcError(wire)
  /** AttachErrorIdentity is the supported public primitive; Core's internal tag operation is absent. */
  const error = attachErrorIdentity(new Error(wire.message), {
    source: wire.source,
    code: wire.code
  })
  error.name = wire.name
  return error
}

it.each(['class', 'constructor', 'tag', 'decode', 'wire-deadline'] as const)(
  '[C5-E03] %s caller reason is presented as admitted deadline without minting or changing the queued cancellation decision',
  async (kind) => {
    /** The original FIFO holds the following task before its final start. */
    const harness = owner()
    /** Release only business work; all cancellation comes from the production controller. */
    let finish!: () => void
    /** A real predecessor keeps the provider queue occupied until cleanup. */
    const held = new Promise<void>((resolve) => {
      finish = resolve
    })
    /** Queued business must remain uninvoked after the true cancellation action. */
    let effects = 0
    harness.registry.register('hold', async (context) => {
      await held
      return context.success(1)
    })
    harness.registry.register('value', (context) => {
      effects++
      return context.success(2)
    })
    /** The first admitted task owns the queue. */
    const first = harness.executor.executeRuntime(
      group('hold', ['hold'], { orderKey: 'queue' }),
      'peer',
      harness.ports
    )
    try {
      /** The forged error is supplied as data to the real cancellation operation. */
      const reason = forgedDeadline(kind)
      /** This separate queued task has no timer that could create a genuine timeout. */
      const pending = harness.executor.executeRuntime(
        group('queued', ['value'], { orderKey: 'queue', cancel: 'before-start' }),
        'peer',
        harness.ports
      )
      ;[...harness.controllers.values()][1]!.cancelIntent!(reason)
      await pending
      /** Inspect the actual response after canonical grammar admission. */
      const terminal = harness.replies.find((reply) => reply.id === 'queued')!
      assert.ok(
        terminal.kind === 'runtime-control' &&
          terminal.operation === 'terminal' &&
          !terminal.completion.ok
      )
      if (
        terminal.kind !== 'runtime-control' ||
        terminal.operation !== 'terminal' ||
        terminal.completion.ok
      )
        assert.fail('failed terminal missing')
      assert.equal(terminal.completion.error.code, RpcCoreErrorCode.deadlineExceeded)
      assert.equal(terminal.completion.error.source, RPC_CORE_ERROR_SOURCE)
      assert.equal(terminal.completion.error.name, reason.name)
      assert.equal(terminal.completion.error.stack, reason.stack)
      assert.equal(localRpcErrorCode(reason), undefined)
      assert.equal(effects, 0)
      assert.equal(harness.timers.size, 0, 'reported deadline cannot install a local timeout')
    } finally {
      finish()
      await first
    }
  }
)

it.each(['class', 'constructor', 'tag', 'decode', 'wire-deadline'] as const)(
  '[C5-E04] %s admitted deadline label is presented on wire without performing provider cancellation',
  async (kind) => {
    /** One actual executor owns the real stream admission and failure response. */
    const harness = owner()
    /** No cancellation operation or deadline is installed in this call. */
    const reason = forgedDeadline(kind)
    /** The public provider error is thrown by the actual registered stream callback. */
    let calls = 0
    /** The original controller proves that terminal presentation did not invoke live cancellation. */
    let signal: IAbortSignal | undefined
    harness.registry.registerStream(`${RpcRuntimeStreamPrefix}value`, () => {
      calls++
      signal = [...harness.controllers.values()][0]!.signal
      throw reason
    })
    await harness.executor.executeRuntime(stream('failed-stream'), 'peer', harness.ports)
    /** The false timeout code is preserved as diagnostics while event remains business failure. */
    const terminal = harness.replies[0]!
    assert.ok(terminal.kind === 'runtime-control' && terminal.operation === 'stream')
    if (terminal.kind !== 'runtime-control' || terminal.operation !== 'stream')
      assert.fail('stream terminal missing')
    assert.equal(terminal.stream.event, 'cancelled')
    assert.equal(terminal.stream.error?.code, RpcCoreErrorCode.deadlineExceeded)
    assert.equal(calls, 1)
    assert.equal(signal!.aborted, false)
    assert.equal(harness.controllers.size, 0)
    assert.equal(harness.admission.size, 0)
    assert.equal(localRpcErrorCode(reason), undefined)
  }
)

it.each([RpcCoreErrorCode.cancelled, RpcCoreErrorCode.deadlineExceeded] as const)(
  '[C5-E05] genuine stored %s stream replay restores only wire cancellation after store cloning',
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

it('[C5-E06] a send adapter forged FRAME_LIMIT code cannot rewrite the original completed group replay outcome', async () => {
  /** No custom store is involved; the original memory owner must keep the real completed business. */
  const harness = owner()
  harness.registry.register('value', (context) => context.success(42))
  /** Public diagnostics imitate a Contract failure without its private owner reference. */
  const reason = attachErrorIdentity(new Error('adapter frame fixture'), {
    source: '@migaia/rpc/contract',
    code: RpcContractErrorCode.frameLimitExceeded
  })
  /** Refusal before preparation must not substitute a forged payload-invalid result in the store. */
  harness.ports.send = async () => {
    throw reason
  }
  await harness.executor.executeRuntime(
    group('completed', ['value'], { idempotencyKey: 'completed-key' }),
    'peer',
    harness.ports
  )
  /** The real admission-selected scope is used by the original store lookup. */
  const scope = JSON.stringify([RpcRuntimeProfile, 'provider', 'peer'])
  const retained = harness.store.lookup!(scope, 'completed-key', 0)
  assert.equal(retained.state, 'done')
  if (retained.state !== 'done' || retained.outcome === 'unavailable' || !retained.outcome.ok)
    assert.fail('completed outcome missing')
  /** Compare the retained business fields without changing its legitimate null-prototype shape. */
  const completion = Reflect.get(retained.outcome.data as object, 'completion') as {
    ok: boolean
    result: readonly { state: string; result: number }[]
  }
  assert.equal(completion.ok, true)
  assert.equal(completion.result.length, 1)
  assert.equal(completion.result[0].state, 'success')
  assert.equal(completion.result[0].result, 42)
})

it('[A59][A66] same provider/key queues across callers, other keys run, and final start defeats caller cancellation for the entire group', async () => {
  const harness = owner()
  let complete!: () => void
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  const effects: string[] = []
  let signal: IAbortSignal | undefined
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
