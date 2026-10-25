/** Retained execution business uses actual public namespaces and the existing native carrier. */
import { createRpcHost } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import limits from '@migaia/rpc-host/plugins/limits'
import { RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  deserializeRpcWireError,
  serializeRpcWireError,
  type IRpcSemanticFrame,
  type IRpcStepOutcome
} from '@migaia/rpc-contract/protocol'
import { attachErrorIdentity } from '@migaia/utils/error'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** Public construction/restoration preserves diagnostic labels without an owner mint record. */
function callerDeadline(kind: 'class' | 'constructor' | 'tag' | 'decode' | 'wire-deadline'): Error {
  if (kind === 'class') return new RpcTimeoutError()
  if (kind === 'constructor') {
    /** The ordinary exposed constructor supplies no private timeout decision authority. */
    const Constructor = new RpcTimeoutError().constructor as typeof RpcTimeoutError
    return new Constructor()
  }
  if (kind === 'decode')
    return deserializeRpcWireError({
      root: 0,
      nodes: [
        {
          source: RPC_ENDPOINT_ERROR_SOURCE,
          code: RpcCoreErrorCode.deadlineExceeded,
          name: 'TimeoutError',
          message: 'adapter fixture',
          stack: 'adapter fixture stack'
        }
      ]
    })
  if (kind === 'wire-deadline')
    return deserializeRpcWireError(
      serializeRpcWireError(new RpcTimeoutError(), {
        report: (failure) => {
          throw failure.error
        }
      })
    )
  /** This is the original supported public diagnostic tagging primitive, not a Host factory. */
  const error = attachErrorIdentity(new Error('adapter fixture'), {
    source: RPC_ENDPOINT_ERROR_SOURCE,
    code: RpcCoreErrorCode.deadlineExceeded
  })
  error.name = 'TimeoutError'
  return error
}

// C001: inspect the actual remote terminal, not the caller's independently settled timeout.
it('a queued public group preserves its original deadline code across the physical reply', async () => {
  /** The predecessor retains the original FIFO until its real business completion. */
  const release = deferred<void>()
  /** Provider entry establishes that the queued call cannot win the same original key. */
  const entered = deferred<void>()
  /** Only the queued application method changes this original zero-effect observation. */
  let effects = 0
  /** The actual identity medium exposes the original serialized server reply without parsing twice. */
  const terminal = deferred<Extract<IRpcSemanticFrame, { kind: 'error' }>>()
  /** Both calls use the same accepted provider and actual namespace. */
  const server = coreMemoryServer('provider')
  /** The original hold and queued methods are real public providers. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      hold: async (_value, context) => {
        entered.resolve()
        await release.promise
        return context.success(1)
      },
      queued: (_value, context) => {
        effects += 1
        return context.success(2)
      }
    }
  })
  /** Original caller identity is admitted by the canonical bilateral handshake. */
  const client = await server.connect('caller')
  /** Pass through the sole physical write and observe only the queued group's actual error reply. */
  const write = client.pair[0].write
  /** The unchanged codec/receiver still performs the actual downstream admission and delivery. */
  const observation = vi
    .spyOn(client.pair[0], 'write')
    .mockImplementation(async (frame, options) => {
      await write(frame, options)
      /** This native memory medium already exposes semantic data as its original write argument. */
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === 'error' && message.task.mode === 'group') terminal.resolve(message)
    })
  /** Observe caller settlement separately from the remote error response. */
  const first = Promise.allSettled([
    client.host.memory.group([{ method: 'hold' }], {
      orderKey: 'same',
      cancel: 'before-start',
      timeout: false
    })
  ])
  try {
    await entered.promise
    /** The original5ms deadline is a complete feature; no executor timer callback is injected. */
    const queued = Promise.allSettled([
      client.host.memory.group([{ method: 'queued' }], {
        orderKey: 'same',
        cancel: 'before-start',
        timeout: timeout({ ms: 5 })
      })
    ])
    /** Only the real correlated remote terminal supplies this original error-code expectation. */
    const response = await terminal.promise
    /** Flat error restoration is the actual new protocol's single public diagnostic operation. */
    const failure = deserializeRpcWireError(response.error)
    expect(failure).toMatchObject({
      code: RpcCoreErrorCode.deadlineExceeded,
      source: 'rpc.endpoint'
    })
    expect(effects).toBe(0)
    await queued
  } finally {
    release.resolve()
    await first
    observation.mockRestore()
    await Promise.all([client.host.close(), host.close()])
  }
})

// C003: only the removed runtime-control/cancelled wire spelling and private tables retire.
it.each(['class', 'constructor', 'tag', 'decode', 'wire-deadline'] as const)(
  '%s provider stream failure preserves its deadline label without aborting the provider signal',
  async (kind) => {
    /** This original caller-constructible value is thrown by real provider business. */
    const reason = callerDeadline(kind)
    /** Only the registered stream method changes the original call count. */
    let calls = 0
    /** Keep the actual original signal beyond context expiry for the non-abort assertion. */
    let signal: IAbortSignal | undefined
    /** The supported namespace stream reaches the genuine provider/stream owners. */
    const server = coreMemoryServer('provider')
    /** There is no caller cancellation or deadline feature on this business failure. */
    const host = await createRpcHost({
      ...server.options,
      provide: {
        value: (_value, context) => {
          calls += 1
          signal = context.signal
          throw reason
        }
      }
    })
    /** The actual bilateral connection has no synthetic producer/controller port. */
    const client = await server.connect('caller')
    try {
      /** Starting the public iterator invokes exactly the original stream method. */
      const iterator = client.host.memory.stream('value') as AsyncIterableIterator<unknown>
      await expect(iterator.next()).rejects.toMatchObject({
        code: RpcCoreErrorCode.deadlineExceeded
      })
      expect(calls).toBe(1)
      expect(signal!.aborted).toBe(false)
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
)

// C006: actual different callers share the provider FIFO; no admission/Controller Map is exposed.
it('public groups retain cross-caller FIFO and final-start cancellation for the whole group', async () => {
  /** The real first provider alone holds its original group prefix. */
  const release = deferred<void>()
  /** Application entry establishes the predecessor's true final-start decision. */
  const entered = deferred<void>()
  /** The original second member proves that cancellation cannot stop a started group suffix. */
  const completed = deferred<void>()
  /** Preserve the original side-effect order, independent from physical or pending-call counts. */
  const effects: string[] = []
  /** The provider's original native signal remains observable after its caller cancels. */
  let signal: IAbortSignal | undefined
  /** Both actual callers enter the same provider registration and root-owned orderKey FIFO. */
  const server = coreMemoryServer('provider')
  /** Barriers are ordinary side-effect-free providers on the same real ingress chain. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      hold: async (_value, context) => {
        effects.push('hold')
        signal = context.signal
        entered.resolve()
        await release.promise
        return context.success(1)
      },
      after: (_value, context) => {
        effects.push('after')
        completed.resolve()
        return context.success(2)
      },
      other: (_value, context) => {
        effects.push('other')
        return context.success(3)
      },
      barrier: (value, context) => context.success(value)
    }
  })
  /** Each caller has its own genuinely admitted source identity. */
  const firstClient = await server.connect('peer')
  /** A different caller must not partition the original provider order key. */
  const secondClient = await server.connect('another-peer')
  /** Caller controls remain ordinary AbortControllers rather than injected provider controllers. */
  const firstController = new AbortController()
  /** Only this real caller can cancel its separately queued original group. */
  const queuedController = new AbortController()
  /** Observe local cancellation without replacing the provider's independent real completion. */
  const first = Promise.allSettled([
    firstClient.host.memory.group([{ method: 'hold' }, { method: 'after' }], {
      orderKey: 'same',
      cancel: 'before-start',
      signal: firstController.signal,
      timeout: false
    })
  ])
  try {
    await entered.promise
    /** This group genuinely arrives through the second physical source before its barrier. */
    const queued = Promise.allSettled([
      secondClient.host.memory.group([{ method: 'after' }], {
        orderKey: 'same',
        cancel: 'before-start',
        signal: queuedController.signal,
        timeout: false
      })
    ])
    await secondClient.host.memory.send('provider', 'barrier', 'queued-arrived')
    await firstClient.host.memory.group([{ method: 'other' }], {
      orderKey: 'different',
      cancel: 'before-start',
      timeout: false
    })
    expect(effects).toEqual(['hold', 'other'])
    firstController.abort('started fixture intent')
    await firstClient.host.memory.send('provider', 'barrier', 'started-cancel-arrived')
    expect(signal!.aborted).toBe(false)
    queuedController.abort('queued fixture intent')
    await queued
    await secondClient.host.memory.send('provider', 'barrier', 'queued-cancel-arrived')
    expect(effects).toEqual(['hold', 'other'])
    release.resolve()
    await completed.promise
    await first
    expect(effects).toEqual(['hold', 'other', 'after'])
  } finally {
    firstController.abort()
    queuedController.abort()
    release.resolve()
    await first
    await Promise.all([firstClient.host.close(), secondClient.host.close(), host.close()])
  }
})

// C009: the original explicit capacity3 is supplied by the actual optional limits plugin.
it('public groups reject unknown or over-budget work and retain the original fail-stop prefix', async () => {
  /** Only successful original first/last application methods change this side-effect count. */
  let effects = 0
  /** The actual provider registration publishes all three original method names. */
  const server = coreMemoryServer('provider')
  /** Complete limits installation owns the original whole-group concurrency capacity. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [limits({ maxGlobal: 3, maxPerPeer: 3 }), ...server.options.plugins],
    provide: {
      first: (_value, context) => {
        effects += 1
        return context.success(42)
      },
      fail: () => {
        throw new RangeError('fixture business failure')
      },
      last: (_value, context) => {
        effects += 1
        return context.success()
      }
    }
  })
  /** The original caller uses the actual public group API and accepted method directory. */
  const client = await server.connect('caller')
  try {
    await expect(
      client.host.memory.group([{ method: 'first' }, { method: 'missing' }])
    ).rejects.toBeDefined()
    expect(effects).toBe(0)
    await expect(
      client.host.memory.group([
        { method: 'first' },
        { method: 'last' },
        { method: 'first' },
        { method: 'last' }
      ])
    ).rejects.toBeDefined()
    expect(effects).toBe(0)
    /** Public completion returns the same ordered original success/failure/unexecuted results. */
    const result = (await client.host.memory.group([
      { method: 'first' },
      { method: 'fail' },
      { method: 'last' }
    ])) as readonly IRpcStepOutcome[]
    expect(effects).toBe(1)
    expect(result.map((value) => value.state)).toEqual(['success', 'failure', 'not-executed'])
    expect(result[0]?.state === 'success' ? result[0].result : undefined).toBe(42)
    /** The pure new wire graph restores the actual original native RangeError and stack. */
    const failure = result[1]
    assert(failure?.state === 'failure')
    /** Restoration preserves the original native family rather than substituting a generic Error. */
    const error = deserializeRpcWireError(failure.error)
    expect(error.name).toBe('RangeError')
    expect(error.stack).toBeTruthy()
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
