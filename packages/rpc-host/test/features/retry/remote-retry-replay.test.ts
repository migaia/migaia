/** Source import: FeatureScope's source graph already owns this module's coverage entry. */
import { createRpcRetryExecution } from '../../../src/features/retry.ts'
import { createManualScheduler } from '@migaia/utils/testing'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import type {
  IRpcAttemptOptions,
  IRpcAvailableAttempt,
  IRetryFeatureOptions
} from '@migaia/rpc-contract/interfaces'
import { describe, expect, it, vi } from 'vitest'

/** One carrier generation whose departure and successor are driven explicitly by the test. */
class FakeGeneration implements IRpcAvailableAttempt {
  readonly carrierId: string
  readonly generation: number
  /** The retry owner's departure listener, set when it subscribes to this generation. */
  #leave: ((reason: unknown) => void) | undefined
  /** Successor resolution the test hands to whenReady; undefined keeps it pending. */
  readonly #next: Promise<IRpcAvailableAttempt> | undefined
  /** Count of unsubscribe calls, proving the leave listener is released. */
  unsubscribed = 0

  /** Capture identity and the optional successor promise. */
  constructor(carrierId: string, generation: number, next?: Promise<IRpcAvailableAttempt>) {
    this.carrierId = carrierId
    this.generation = generation
    this.#next = next
  }

  /** Store the single listener and return its release. */
  readonly onLeave = (listener: (reason: unknown) => void): (() => void) => {
    this.#leave = listener
    return () => {
      this.unsubscribed += 1
    }
  }

  /** Resolve to the configured successor, or stay pending until aborted. */
  readonly whenReady = (signal?: AbortSignal): Promise<IRpcAvailableAttempt> =>
    this.#next ??
    new Promise<IRpcAvailableAttempt>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason))
    })

  /** Simulate the carrier leaving with one reason. */
  depart(reason: unknown): void {
    this.#leave?.(reason)
  }
}

/** Mutable current-generation pointer read by the retry owner before each send. */
class FakeAvailability {
  /** The generation the transport currently reports, or undefined while disconnected. */
  value: IRpcAvailableAttempt | undefined

  /** Start from one known generation. */
  constructor(value: IRpcAvailableAttempt | undefined) {
    this.value = value
  }

  /** The retry owner's read port. */
  readonly current = (): IRpcAvailableAttempt | undefined => this.value
}

/** Build a run input with a fresh signal and the given availability and invoke callback. */
function attempt<T>(
  availability: FakeAvailability | undefined,
  invoke: (
    signal: AbortSignal,
    budget: number | undefined,
    options?: IRpcAttemptOptions
  ) => Promise<T>,
  extra: Readonly<{
    idempotent?: boolean
    remainingMs?: number
    signal?: AbortSignal
    key?: string
  }> = {}
) {
  return {
    signal: extra.signal ?? new AbortController().signal,
    remainingMs: extra.remainingMs,
    facts: {
      method: 'p.f.read',
      idempotent: extra.idempotent ?? true,
      idempotencyKey: extra.key,
      availability
    },
    invoke
  }
}

describe('retry execution option admission', () => {
  it.each([
    ['null', null],
    ['array', []],
    ['zero attempts', { attempts: 0 }],
    ['fractional attempts', { attempts: 1.5 }],
    ['negative backoff', { backoff: -1 }],
    ['non-finite backoff', { backoff: Number.NaN }]
  ])('rejects %s with INVALID_CONFIG', (_name, options) => {
    expect(() => createRpcRetryExecution(options as unknown as IRetryFeatureOptions)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })
})

describe('retry execution lifecycle', () => {
  it('rejects at once when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const invoke = vi.fn(async () => 1)
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(undefined, invoke, { signal: controller.signal })
    )
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('times out at once with a zero budget and after the scheduled deadline', async () => {
    const scheduler = createManualScheduler()
    const execution = createRpcRetryExecution({ scheduler, report: vi.fn() })
    await expect(
      execution.run(attempt(undefined, async () => 1, { remainingMs: 0 }))
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    const pending = execution.run(
      attempt(undefined, () => new Promise<number>(() => undefined), { remainingMs: 10 })
    )
    scheduler.advance(10)
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(scheduler.pendingCount).toBe(0)
  })

  it('rejects when the caller aborts while the send is in flight', async () => {
    const controller = new AbortController()
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(undefined, () => new Promise<number>(() => undefined), { signal: controller.signal })
    )
    controller.abort(new Error('stop'))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects a synchronous invoke failure without retrying', async () => {
    const failure = new Error('sync')
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(undefined, () => {
        throw failure
      })
    )
    await expect(result).rejects.toBe(failure)
  })

  it('passes a caller-supplied idempotency key to every send', async () => {
    const keys: (string | undefined)[] = []
    const result = await createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(
        undefined,
        async (_signal, _budget, options) => {
          keys.push(options?.idempotencyKey)
          return 'ok'
        },
        { key: 'caller-key' }
      )
    )
    expect(result).toBe('ok')
    expect(keys).toEqual(['caller-key'])
  })
})

describe('retry execution departure handling', () => {
  it('rejects an asynchronous invoke failure and ignores a departure after settling', async () => {
    const generation = new FakeGeneration('c', 1)
    const failure = new Error('async failure')
    const execution = createRpcRetryExecution({ report: vi.fn() })
    await expect(
      execution.run(attempt(new FakeAvailability(generation), () => Promise.reject(failure)))
    ).rejects.toBe(failure)
    await expect(
      execution.run(attempt(new FakeAvailability(generation), async () => 'done'))
    ).resolves.toBe('done')
    generation.depart(new Error('after settle'))
  })

  it('reports CLOSED when the generation leaves before the write starts', async () => {
    const generation = new FakeGeneration('c', 1)
    const reason = new Error('gone')
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(new FakeAvailability(generation), () => new Promise<number>(() => undefined))
    )
    generation.depart(reason)
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
    expect(generation.unsubscribed).toBe(1)
  })

  it('reports RESULT_UNKNOWN for a written non-idempotent call', async () => {
    const generation = new FakeGeneration('c', 1)
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(
        new FakeAvailability(generation),
        (_signal, _budget, options) => {
          options?.onWriteStart?.()
          return new Promise<number>(() => undefined)
        },
        { idempotent: false }
      )
    )
    generation.depart(new Error('gone'))
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
  })

  it.each([
    ['numeric backoff', 5],
    ['function backoff', () => 5],
    ['zero backoff', 0]
  ])(
    'replays an idempotent written call on the next generation with %s',
    async (_name, backoff) => {
      const scheduler = createManualScheduler()
      const second = new FakeGeneration('c', 2)
      const availability = new FakeAvailability(undefined)
      const first = new FakeGeneration('c', 1, Promise.resolve(second))
      availability.value = first
      /** Generations each send targeted, in order. */
      const targets: (number | undefined)[] = []
      const report = vi.fn()
      const result = createRpcRetryExecution({
        scheduler,
        backoff: backoff as IRetryFeatureOptions['backoff'],
        report
      }).run(
        attempt(availability, (_signal, _budget, options) => {
          targets.push(options?.expectedGeneration)
          options?.onWriteStart?.()
          if (targets.length === 1) return new Promise<string>(() => undefined)
          return Promise.resolve('replayed')
        })
      )
      availability.value = second
      first.depart(new Error('gone'))
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
      scheduler.advance(5)
      await expect(result).resolves.toBe('replayed')
      expect(targets).toEqual([1, 2])
      expect(report).not.toHaveBeenCalled()
    }
  )

  it('reports RESULT_UNKNOWN when the successor never becomes ready', async () => {
    const availability = new FakeAvailability(undefined)
    const first = new FakeGeneration('c', 1, Promise.reject(new Error('no successor')))
    availability.value = first
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(availability, (_signal, _budget, options) => {
        options?.onWriteStart?.()
        return new Promise<string>(() => undefined)
      })
    )
    first.depart(new Error('gone'))
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
  })

  it('rejects when the successor is not the transport current generation', async () => {
    const availability = new FakeAvailability(undefined)
    const stale = new FakeGeneration('other', 9)
    const first = new FakeGeneration('c', 1, Promise.resolve(stale))
    availability.value = first
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(availability, (_signal, _budget, options) => {
        options?.onWriteStart?.()
        return new Promise<string>(() => undefined)
      })
    )
    availability.value = new FakeGeneration('c', 2)
    first.depart(new Error('gone'))
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
  })

  it('rejects CLOSED when no generation is current at the first send', async () => {
    const availability = new FakeAvailability(undefined)
    const result = createRpcRetryExecution({ report: vi.fn() }).run(
      attempt(availability, async () => 'never')
    )
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.closed })
  })

  it('reports an unrelated late failure from a departed send but not its own departure', async () => {
    const generation = new FakeGeneration('c', 1)
    const reason = new Error('gone')
    const unrelated = new Error('late')
    const report = vi.fn()
    /** Rejections the test releases after the departure was observed. */
    const late: ((error: unknown) => void)[] = []
    const execution = createRpcRetryExecution({ attempts: 1, report })
    for (const error of [reason, unrelated]) {
      const result = execution.run(
        attempt(new FakeAvailability(generation), (_signal, _budget, options) => {
          options?.onWriteStart?.()
          return new Promise<string>((_resolve, reject) => late.push(reject))
        })
      )
      generation.depart(reason)
      await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
      late.pop()!(error)
      await Promise.resolve()
    }
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(unrelated)
  })
})
