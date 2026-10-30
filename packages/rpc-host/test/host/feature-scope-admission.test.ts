/** Cold call-policy admission, per-call overlays and link-policy record checks. */
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { retryFeature as publicRetryFeature } from '@migaia/rpc-host/features/retry'
/** Execution owners load from source, the same modules FeatureScope's source graph uses. */
import { retryFeature, createRpcRetryExecution } from '../../src/features/retry.ts'
import { timeoutFeature, createRpcTimeoutExecution } from '../../src/features/timeout.ts'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import { defineFlowFeature, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { defineFeature } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IRpcAttempt, IRpcAvailableAttempt } from '@migaia/rpc-contract/interfaces'
import { FeatureScope } from '../../src/feature/scope.ts'

/** Business success used by every attempt that should reach invoke. */
function resolveAttempt(): Promise<number> {
  return Promise.resolve(7)
}

/** A fresh attempt with no facts and no deadline. */
function bareAttempt(): IRpcAttempt<number> {
  return { signal: new AbortController().signal, invoke: resolveAttempt }
}

/** Outputs a native install would build for one record of call tokens. */
function outputsFor(record: Readonly<Record<string, object>>): Record<string, object> {
  /** Alias to installed execution owner, keyed exactly like core.features. */
  const outputs: Record<string, object> = {}
  for (const alias of Object.keys(record))
    outputs[alias] = alias.startsWith('t')
      ? createRpcTimeoutExecution({ ms: 1000 })
      : createRpcRetryExecution({ attempts: 1 })
  return outputs
}

/** Empty native transports acquire no resources while exercising genuine installation. */
function openEmptyTransport() {
  return { dispose: disposeEmptyTransport }
}

/** No resource was acquired by the empty transport. */
function disposeEmptyTransport(): void {}

describe('FeatureScope admission', () => {
  it('rejects a link policy record holding one call role twice', async () => {
    await expect(
      createRpcHost({
        self: { name: 'scope-admission', instanceId: 'scope-admission' },
        plugins: [
          linkPolicy({
            features: { r1: publicRetryFeature(), r2: publicRetryFeature({ attempts: 3 }) }
          }),
          defineTransportPlugin({
            name: 'scope-transport',
            namespace: 'local',
            features: {},
            open: openEmptyTransport
          })
        ]
      })
    ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.featureCombinationConflict))
  })

  it('rejects a duplicate call role inside one record', () => {
    const record = { r1: retryFeature(), r2: retryFeature() }
    expect(() => new FeatureScope().setDefaults(record, outputsFor(record))).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.featureCombinationConflict })
    )
  })

  it('rejects a call token whose installed output is missing', () => {
    expect(() => new FeatureScope().setDefaults({ r: retryFeature() }, {})).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it.each([
    ['timeout', { t1: timeoutFeature({ ms: 10 }) }, { t2: timeoutFeature({ ms: 20 }) }],
    ['retry', { r1: retryFeature() }, { r2: retryFeature() }]
  ])('rejects a second policy owning %s and releases defaults on disposal', (_role, a, b) => {
    const scope = new FeatureScope()
    const release = scope.setDefaults(a, outputsFor(a))
    expect(() => scope.setDefaults(b, outputsFor(b))).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.featureCombinationConflict })
    )
    release()
    scope.setDefaults(b, outputsFor(b))
  })

  it('registers and prepares namespaces with default empty records', () => {
    const scope = new FeatureScope()
    scope.register('a')
    scope.prepare('b')()
    expect(scope.resolve('a')).toEqual({})
    scope.unregister('a')
    scope.close()
  })

  it.each([
    ['null', null],
    ['array', []]
  ])('rejects %s per-call options', (_name, options) => {
    expect(() =>
      new FeatureScope().resolve('a', options as unknown as Parameters<FeatureScope['resolve']>[1])
    ).toThrow(expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig }))
  })

  it('builds per-call executions from plain options', async () => {
    const scope = new FeatureScope()
    const selected = scope.resolve('a', { retry: { attempts: 1 }, timeout: { ms: 1000 } })
    expect(typeof selected.retry === 'object' && typeof selected.timeout === 'object').toBe(true)
    expect(await scope.executeSelected(selected, bareAttempt())).toBe(7)
  })
})

describe('link policy record admission', () => {
  it('rejects a flow feature in a call-only record', () => {
    const flow = defineFlowFeature({ name: 'policy-flow', phase: 1, setup: () => ({}) })
    expect(() =>
      linkPolicy({
        features: { flow } as unknown as Record<string, ReturnType<typeof publicRetryFeature>>
      })
    ).toThrow()
  })

  it.each([
    ['array', []],
    ['null', null]
  ])('rejects an %s record', (_name, features) => {
    expect(() =>
      linkPolicy({
        features: features as unknown as Record<string, ReturnType<typeof publicRetryFeature>>
      })
    ).toThrow()
  })

  it('ignores symbol keys and rejects accessor entries', () => {
    const record: Record<PropertyKey, unknown> = { r: publicRetryFeature() }
    record[Symbol('hidden')] = publicRetryFeature()
    Object.defineProperty(record, 'lazy', { enumerable: true, get: () => publicRetryFeature() })
    expect(() =>
      linkPolicy({
        features: record as unknown as Record<string, ReturnType<typeof publicRetryFeature>>
      })
    ).toThrow()
  })

  it('rejects a plain plugin-host feature in a call-only record', () => {
    const helper = defineFeature(() => ({ value: 1 }))
    expect(() =>
      linkPolicy({
        features: { helper } as unknown as Record<string, ReturnType<typeof publicRetryFeature>>
      })
    ).toThrow()
  })
})

describe('call execution deadlines and failures', () => {
  it('expires a timeout execution at its own deadline', async () => {
    const scheduler = createManualScheduler()
    const result = createRpcTimeoutExecution({ ms: 10, scheduler }).run({
      signal: new AbortController().signal,
      remainingMs: 50,
      invoke: () => new Promise<number>(() => undefined)
    })
    scheduler.advance(10)
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('passes an asynchronous invoke failure through timeout execution', async () => {
    const failure = new Error('async')
    await expect(
      createRpcTimeoutExecution({ ms: 1000 }).run({
        signal: new AbortController().signal,
        invoke: () => Promise.reject(failure)
      })
    ).rejects.toBe(failure)
  })

  it('retries with a deadline budget and a numeric backoff without facts', async () => {
    const scheduler = createManualScheduler()
    /** Budgets each send received. */
    const budgets: (number | undefined)[] = []
    const value = await createRpcRetryExecution({ backoff: 3, scheduler }).run({
      signal: new AbortController().signal,
      remainingMs: 100,
      invoke: async (_signal, budget) => {
        budgets.push(budget)
        return 2
      }
    })
    expect(value).toBe(2)
    expect(budgets).toEqual([100])
    expect(() => createRpcRetryExecution({ backoff: Number.POSITIVE_INFINITY })).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it('replays on the next generation without a backoff and with an undefined leave reason', async () => {
    /** Departure listener of the first generation. */
    let leave: (reason: unknown) => void = () => undefined
    const second: IRpcAvailableAttempt = {
      carrierId: 'c',
      generation: 2,
      onLeave: () => () => undefined,
      whenReady: () => new Promise(() => undefined)
    }
    const first: IRpcAvailableAttempt = {
      carrierId: 'c',
      generation: 1,
      onLeave: (listener) => {
        leave = listener
        return () => undefined
      },
      whenReady: () => Promise.resolve(second)
    }
    /** Pointer the transport reports as current. */
    let current = first
    /** Sends observed in order. */
    let sends = 0
    const result = createRpcRetryExecution().run({
      signal: new AbortController().signal,
      facts: { method: 'm', idempotent: true, availability: { current: () => current } },
      invoke: (_signal, _budget, options) => {
        sends += 1
        options?.onWriteStart?.()
        return sends === 1 ? new Promise<number>(() => undefined) : Promise.resolve(9)
      }
    })
    current = second
    leave(undefined)
    await expect(result).resolves.toBe(9)
    expect(sends).toBe(2)
  })
})

describe('call execution defaults', () => {
  it('runs retry and timeout with default options and no facts', async () => {
    expect(await createRpcRetryExecution().run(bareAttempt())).toBe(7)
    expect(typeof retryFeature()).toBe('object')
    const deadline = { ...bareAttempt(), remainingMs: 500 }
    expect(await createRpcTimeoutExecution({ ms: 1000 }).run(deadline)).toBe(7)
  })

  it('generates an idempotency key with the default key factory', async () => {
    /** Keys each send carried. */
    const keys: (string | undefined)[] = []
    await createRpcRetryExecution({ backoff: () => 0 }).run({
      signal: new AbortController().signal,
      facts: { method: 'm', idempotent: true },
      invoke: async (_signal, _budget, options) => {
        keys.push(options?.idempotencyKey)
        return 1
      }
    })
    expect(typeof keys[0]).toBe('string')
  })

  it('reports an unsubscribe failure and ignores a late success after departure', async () => {
    const report = vi.fn()
    /** Departure listener captured from the subscription. */
    let leave: (reason: unknown) => void = () => undefined
    /** Late success released after the call already settled. */
    let resolveLate: (value: number) => void = () => undefined
    const available: IRpcAvailableAttempt = {
      carrierId: 'c',
      generation: 1,
      onLeave: (listener) => {
        leave = listener
        return () => {
          throw new Error('unsubscribe failed')
        }
      },
      whenReady: () => new Promise(() => undefined)
    }
    const result = createRpcRetryExecution({ attempts: 1, report }).run({
      signal: new AbortController().signal,
      facts: { method: 'm', idempotent: true, availability: { current: () => available } },
      invoke: (_signal, _budget, options) => {
        options?.onWriteStart?.()
        return new Promise<number>((resolve) => {
          resolveLate = resolve
        })
      }
    })
    leave(new Error('gone'))
    await expect(result).rejects.toMatchObject({ code: RpcRemoteLayerErrorCode.resultUnknown })
    resolveLate(1)
    await Promise.resolve()
    expect(report).toHaveBeenCalled()
  })

  it('maps a caller abort during timeout execution to an RPC abort', async () => {
    const controller = new AbortController()
    const result = createRpcTimeoutExecution({ ms: 1000 }).run({
      signal: controller.signal,
      invoke: () => new Promise<number>(() => undefined)
    })
    controller.abort(new Error('stop'))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects a synchronous invoke failure inside timeout execution', async () => {
    const failure = new Error('sync')
    await expect(
      createRpcTimeoutExecution({ ms: 1000 }).run({
        signal: new AbortController().signal,
        invoke: () => {
          throw failure
        }
      })
    ).rejects.toBe(failure)
  })
})

/** Search the native install wrapper's cause chain for the semantic RPC code. */
function hasCode(code: string): (error: unknown) => boolean {
  return (error) => findCode(error, code, 0)
}

/** Bounded cause/errors traversal; native wrappers keep the original reachable. */
function findCode(error: unknown, code: string, depth: number): boolean {
  if (depth > 8 || error === null || typeof error !== 'object') return false
  if ((error as { code?: unknown }).code === code) return true
  /** Aggregate members are searched before the single cause. */
  const members = (error as { errors?: unknown }).errors
  if (Array.isArray(members))
    for (const member of members) if (findCode(member, code, depth + 1)) return true
  return findCode((error as { cause?: unknown }).cause, code, depth + 1)
}
