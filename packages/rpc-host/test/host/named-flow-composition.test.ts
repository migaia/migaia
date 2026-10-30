import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcLifecycleError } from '@migaia/rpc-host/contract'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { chunkFeature } from '@migaia/rpc-host/plugins/chunk'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import {
  defineFlowFeature,
  RpcFlowLayer,
  RpcFlowPoint,
  RpcJsonCarrierCodec,
  type IRpcFlowFeature
} from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from './core-fixture.ts'
import { RuntimeApiFixtureText } from '../fixtures/runtime-api-text.ts'

/** Each real host receives independent authentication and chunk installations. */
function compositionFeatures() {
  return {
    authentication: authFeature({
      encodedType: 'string',
      sign: (value) => value,
      verify: (value) => value
    }),
    chunks: chunkFeature({ chunkBytes: 4096, maxMessageBytes: 64 * 1024 })
  }
}

/** Keep all three genuine transformations installed on both actual public host owners. */
async function composition(
  provide: Parameters<typeof createRpcHost>[0]['provide'],
  plaintextFeatures: readonly IRpcFlowFeature[] = [],
  wireFeatures: readonly IRpcFlowFeature[] = []
) {
  /** Physical string output exercises actual batching while long strings still use real chunks. */
  const server = coreMemoryServer('composition-server', 'composition-server', 'memory', {}, [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Provider errors remain on the actual business diagnostic outlet. */
  const reports: unknown[] = []
  /** The real public root owns native installation, Session, dispatch and close. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      rpcFeaturesPlugin({ features: { ...compositionFeatures(), batching: batchFeature() } }),
      server.transport
    ],
    report: (error) => reports.push(error),
    provide
  })
  try {
    /** These extra genuine stages observe real suffix composition without replacing execution. */
    const client = await server.connect('composition-client', {
      plugins: [
        rpcFeaturesPlugin({
          features: {
            ...compositionFeatures(),
            batching: batchFeature(),
            ...Object.fromEntries(
              plaintextFeatures.map((feature, index) => [`plaintext${index}`, feature])
            ),
            ...Object.fromEntries(wireFeatures.map((feature, index) => [`wire${index}`, feature]))
          }
        })
      ],
      report: (error) => reports.push(error)
    })
    return { host, client, reports }
  } catch (error) {
    await host.close()
    throw error
  }
}

/** A synchronous native prefix witnesses the selected logical sends entering the genuine batch lane. */
function admissionWitness(expected = 3) {
  /** The first held write and queued members make batching independent of scheduler timing. */
  const entered = deferred<void>()
  /** Count only whole message submissions; chunk fragments have their own extension frames. */
  let count = 0
  /** This is a real flow definition using the production named-stage authoring boundary. */
  const plugin = defineFlowFeature({
    phase: 1000,
    name: 'composition-admission-witness',
    setup: () => ({
      stages: {
        [RpcFlowPoint.frameOutbound]: (payload, next) => {
          /** Short messages synchronously enter the genuine Chunk/Batch suffix before this count. */
          const traversal = next(payload)
          if (payload.frame.kind === 'message' && ++count === expected) entered.resolve()
          return traversal
        }
      }
    })
  })
  return {
    plugin,
    entered: entered.promise,
    /** Exclude the completed chunk workload before witnessing the three held-write submissions. */
    reset() {
      count = 0
    }
  }
}

it('public auth chunk and batch composition preserves provider rejection and independent requests', async () => {
  /** Both native error families and stacks must survive the real serialized business failure. */
  const cause = new TypeError('composition provider cause')
  /** This actual provider failure must not replace a sibling request's successful result. */
  const original = new RangeError('composition provider failure', { cause })
  /** The barrier proves both independent members reached the existing batching owner. */
  const witness = admissionWitness()
  /** Calls record actual provider effects, rather than client in-flight counts. */
  const calls: string[] = []
  /** Genuine public providers retain their original business result and failure. */
  const f = await composition(
    {
      echo: (value: string) => {
        calls.push(value)
        return value
      },
      fail: () => {
        throw original
      }
    },
    [witness.plugin]
  )
  /** Observe actual native frame writes, preserving their original implementation. */
  const writing = vi.spyOn(f.client.pair[1], 'write')
  try {
    /** This long value forces real negotiated chunk production before the batching scenario. */
    const large = 'x'.repeat(12_000)
    expect(await f.client.host.memory.send('composition-server', 'echo', large)).toBe(large)
    expect(
      writing.mock.calls.filter(
        ([frame]) => frame.kind === 'extension' && frame.extension === 'chunk@1'
      ).length
    ).toBeGreaterThan(1)
    writing.mockClear()
    witness.reset()
    f.client.pair[1].holdWrites()
    /** A real native write supplies backpressure; no private queue or runner is inserted. */
    const first = f.client.host.memory.send('composition-server', 'echo', 'busy')
    await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1))
    /** Observe rejection before releasing the actual physical write gate. */
    const failure = f.client.host.memory
      .send('composition-server', 'fail')
      .catch((error: unknown) => error)
    /** Independent correlation remains executable despite the first provider's refusal. */
    const survivor = f.client.host.memory.send('composition-server', 'echo', 'survivor')
    await witness.entered
    f.client.pair[1].releaseWrites()
    expect(await first).toBe('busy')
    expect(await survivor).toBe('survivor')
    /** The actual public boundary restores the complete original native error graph. */
    const error = await failure
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({
      source: 'rpc.endpoint',
      code: 'INTERNAL',
      message: original.message,
      stack: original.stack
    })
    expect((error as Error).cause).toBeInstanceOf(TypeError)
    expect((error as Error).cause).toMatchObject({ message: cause.message, stack: cause.stack })
    expect(f.reports).toContain(original)
    expect(f.reports.filter((error) => error === original)).toHaveLength(1)
    expect(calls).toEqual([large, 'busy', 'survivor'])
    expect(
      writing.mock.calls.some(
        ([frame]) => frame.kind === 'extension' && frame.extension === 'batch@1'
      )
    ).toBe(true)
  } finally {
    f.client.pair[1].releaseWrites()
    writing.mockRestore()
    await Promise.all([f.client.host.close(), f.host.close()])
  }
})

it('public close settles the original call and rejects its real carrier-owned held write', async () => {
  /** A real native physical write, rather than an unrelated terminal Promise, is held. */
  const f = await composition({ echo: (value: unknown) => value })
  /** The original write Promise is observed directly while Session remains its real caller. */
  const writing = vi.spyOn(f.client.pair[1], 'write')
  try {
    f.client.pair[1].holdWrites()
    /** Public cancellation/close ownership is already installed before the physical write begins. */
    const pending = f.client.host.memory
      .send('composition-server', 'echo', 'held')
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1))
    /** Physical close owns this pending carrier result and rejects it through its real controller. */
    const physical = writing.mock.results[0]!.value as Promise<void>
    /** Host close must not need a manual release of the physical write fixture. */
    const closing = f.client.host.close()
    /** Actual public close preserves its native lifecycle family before late physical settlement. */
    const failure = await pending
    expect(failure).toBeInstanceOf(RpcLifecycleError)
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    await expect(physical).rejects.toMatchObject({ cause: failure })
    await closing
    expect(f.client.pair[1].closed).toBe(true)
  } finally {
    f.client.pair[1].releaseWrites()
    writing.mockRestore()
    await Promise.all([f.client.host.close(), f.host.close()])
  }
})

it('public late batch cancellation keeps CANCELLED cause while the surviving member completes', async () => {
  /** Physical backpressure deterministically places two actual calls in the batch queue. */
  const witness = admissionWitness()
  /** The suffix is entered only by the genuine aggregate emitted by the installed batch plugin. */
  const aggregate = deferred<void>()
  /** Releasing this native suffix allows the original write-start membership guard to run. */
  const release = deferred<void>()
  /** No substitute continuation is used; native next owns the actual downstream branch. */
  const delayed = defineFlowFeature({
    phase: 1001,
    name: 'composition-held-batch-suffix',
    setup: () => ({
      stages: {
        [RpcFlowPoint.frameOutbound]: {
          layer: RpcFlowLayer.wire,
          stage: async (payload, next) => {
            if (payload.frame.kind === 'extension' && payload.frame.extension === 'batch@1') {
              aggregate.resolve()
              await release.promise
            }
            await next(payload)
          }
        }
      }
    })
  })
  /** Only the real provider records whether a cancelled member reached business. */
  const calls: string[] = []
  /** The same three optional algorithms remain installed on both real owners. */
  const f = await composition(
    {
      echo: (value: string) => {
        calls.push(value)
        return value
      }
    },
    [witness.plugin],
    [delayed]
  )
  /** Observe real native acceptance rather than a local queue admission. */
  const writing = vi.spyOn(f.client.pair[1], 'write')
  try {
    f.client.pair[1].holdWrites()
    /** A first actual write is the only cause of the existing batch backpressure. */
    const first = f.client.host.memory.send('composition-server', 'echo', 'busy')
    await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1))
    /** Caller cancellation remains independent from the physical source's live lifetime. */
    const caller = new AbortController()
    /** Observe the original public rejection before issuing the caller's native abort. */
    const cancelled = f.client.host.memory
      .send('composition-server', 'echo', 'cancelled', { signal: caller.signal })
      .catch((error: unknown) => error)
    /** This independent member must still reach the unchanged actual business provider. */
    const survivor = f.client.host.memory.send('composition-server', 'echo', 'survivor')
    await witness.entered
    f.client.pair[1].releaseWrites()
    await aggregate.promise
    /** This exact original object must remain the public local cancellation cause. */
    const reason = new RangeError('composition caller abort')
    caller.abort(reason)
    /** Public first settlement is checked before the held downstream branch can finish. */
    const failure = await cancelled
    expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED', cause: reason })
    expect((failure as Error).cause).toBe(reason)
    release.resolve()
    await expect(first).resolves.toBe('busy')
    await expect(survivor).resolves.toBe('survivor')
    expect(calls).toEqual(['busy', 'survivor'])
  } finally {
    release.resolve()
    f.client.pair[1].releaseWrites()
    writing.mockRestore()
    await expect(Promise.all([f.client.host.close(), f.host.close()])).resolves.toHaveLength(2)
  }
})

it('a cancelled one-way item leaves the canonical send queue without a frame or retry', async () => {
  /** Two original logical notifications must enter the genuine installed batch lane. */
  const witness = admissionWitness(2)
  /** Reuse the real public owner and physical carrier; no fixture queue handles notifications. */
  const f = await composition({ ready: () => 'ready' }, [witness.plugin])
  /** The original physical write implementation remains the only handoff and drain owner. */
  const writing = vi.spyOn(f.client.pair[1], 'write')
  try {
    f.client.pair[1].holdWrites()
    /** The first accepted notification holds the actual physical writer without a result waiter. */
    const first = f.client.host.memory.notify('ready', null)
    await vi.waitFor(() => expect(writing).toHaveBeenCalledTimes(1))
    /** Only the queued notification owns this original cancellation reason. */
    const reason = new Error(RuntimeApiFixtureText.queuedAbort)
    /** Its lifetime remains independent from the live first physical write. */
    const controller = new AbortController()
    /** Observe settlement before cancelling the already queued original notification. */
    const cancelled = Promise.allSettled([
      f.client.host.memory.notify('ready', null, { signal: controller.signal })
    ])
    await witness.entered
    controller.abort(reason)
    /** Cancellation must complete before the held native write is released. */
    const [result] = await cancelled
    expect(result?.status, 'queued cancellation is local and immediate').toBe('rejected')
    if (result?.status === 'rejected') {
      expect(result.reason.code).toBe('CANCELLED')
      expect(result.reason.cause).toBe(reason)
    }
    f.client.pair[1].releaseWrites()
    await first
    await f.client.host.memory.notify('ready', null)
    expect(
      writing.mock.calls.length,
      'only the original and explicit later sends reach the carrier'
    ).toBe(2)
  } finally {
    f.client.pair[1].releaseWrites()
    writing.mockRestore()
    await Promise.all([f.client.host.close(), f.host.close()])
  }
})
