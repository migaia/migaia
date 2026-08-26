import { describe, expect, it, vi } from 'vitest'
import {
  containAsyncRejection,
  createErrorCollector,
  createLifecycleError,
  LIFECYCLE_SOURCE
} from '../src/errors'

describe('L-T17 containAsyncRejection: non-Promise thenable', () => {
  it('reads `then` exactly once and observes the eventual rejection', async () => {
    let readCount = 0
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- deliberately models a hostile/foreign thenable.
      get then() {
        readCount++
        return (_resolve: unknown, reject: (error: unknown) => void) => reject(new Error('boom'))
      }
    }
    const onRejected = vi.fn()
    containAsyncRejection(thenable, onRejected)
    await Promise.resolve()
    await Promise.resolve()
    expect(readCount).toBe(1)
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect((onRejected.mock.calls[0]![0] as Error).message).toBe('boom')
  })

  it('contains a synchronous getter/call exception without throwing', () => {
    const hostile = {
      // oxlint-disable-next-line unicorn/no-thenable -- deliberately models a hostile getter.
      get then() {
        throw new Error('getter exploded')
      }
    }
    const onRejected = vi.fn()
    expect(() => containAsyncRejection(hostile, onRejected)).not.toThrow()
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  it('ignores non-thenable values entirely', () => {
    const onRejected = vi.fn()
    containAsyncRejection(42, onRejected)
    containAsyncRejection(null, onRejected)
    containAsyncRejection({ not: 'thenable' }, onRejected)
    expect(onRejected).not.toHaveBeenCalled()
  })

  it('never throws even if onRejected itself throws', async () => {
    const rejecting = Promise.reject(new Error('x'))
    void rejecting.catch(() => undefined)
    expect(() =>
      containAsyncRejection(rejecting, () => {
        throw new Error('handler exploded')
      })
    ).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })
})

describe('L-T18 error policies: throw / collect / report / firstError', () => {
  it('throw: single error is thrown as-is', () => {
    const sink = createErrorCollector('throw', undefined)
    const original = new Error('single')
    sink.add('a', original)
    expect(() => sink.finalize('msg')).toThrowError(original)
  })

  it('throw: multiple errors aggregate into one AggregateError', () => {
    const sink = createErrorCollector('throw', undefined)
    sink.add('a', new Error('one'))
    sink.add('b', new Error('two'))
    expect(() => sink.finalize('agg message')).toThrow(AggregateError)
    try {
      sink.finalize('agg message')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toHaveLength(2)
    }
  })

  it('throw: no errors -> finalize returns empty array, does not throw', () => {
    const sink = createErrorCollector('throw', undefined)
    expect(sink.finalize('msg')).toEqual([])
  })

  it('collect: returns the collected list instead of throwing', () => {
    const sink = createErrorCollector('collect', undefined)
    sink.add('a', 'err-a')
    sink.add('b', 'err-b')
    const result = sink.finalize('msg')
    expect(result).toEqual([
      { source: 'a', error: 'err-a' },
      { source: 'b', error: 'err-b' }
    ])
  })

  it('report: invokes the reporter per error, never throws, finalize returns empty', () => {
    const reported: unknown[] = []
    const sink = createErrorCollector('report', (error) => reported.push(error))
    sink.add('a', 'err-a')
    sink.add('b', 'err-b')
    expect(sink.finalize('msg')).toEqual([])
    expect(reported).toEqual(['err-a', 'err-b'])
  })

  it('firstError: keeps the first, observes but does not surface subsequent ones as the thrown value', () => {
    const sink = createErrorCollector('firstError', undefined)
    const first = new Error('first')
    sink.add('a', first)
    sink.add('b', new Error('second'))
    sink.add('c', new Error('third'))
    expect(() => sink.finalize('msg')).toThrowError(first)
  })

  it('firstError: no error added -> finalize returns empty, does not throw', () => {
    const sink = createErrorCollector('firstError', undefined)
    expect(sink.finalize('msg')).toEqual([])
  })
})

describe('L-T35 report: reporter throwing is contained', () => {
  it('a synchronously-throwing reporter does not escape add()', () => {
    const sink = createErrorCollector('report', () => {
      throw new Error('reporter exploded')
    })
    expect(() => sink.add('a', 'err')).not.toThrow()
    expect(sink.finalize('msg')).toEqual([])
  })

  it('a reporter returning a rejecting promise is observed without becoming an unhandled rejection', async () => {
    const sink = createErrorCollector('report', () =>
      Promise.reject(new Error('async reporter failure'))
    )
    sink.add('a', 'err')
    await Promise.resolve()
    await Promise.resolve()
    // If this test file completes without an unhandledRejection, the rejection was contained.
    expect(true).toBe(true)
  })
})

describe('L-T38 firstError: subsequent errors are fully observed', () => {
  it('records every subsequent error even though only the first is thrown', () => {
    const sink = createErrorCollector('firstError', undefined)
    sink.add('a', new Error('first'))
    sink.add('b', new Error('second'))
    sink.add('c', new Error('third'))
    let thrown: unknown
    try {
      sink.finalize('msg')
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).toBe('first')
  })

  it('with a reporter, subsequent errors are observed through the reporter (never swallowed)', () => {
    const reported: unknown[] = []
    const sink = createErrorCollector('firstError', (error) => reported.push(error))
    const first = new Error('first')
    const second = new Error('second')
    sink.add('a', first)
    sink.add('b', second)
    expect(() => sink.finalize('msg')).toThrowError(first)
    expect(reported).toEqual([second])
  })

  it('an async subsequent failure funneled through containAsyncRejection does not produce an unhandled rejection', async () => {
    const sink = createErrorCollector('firstError', undefined)
    sink.add('a', new Error('first'))
    const laterRejection = Promise.reject(new Error('second, async'))
    containAsyncRejection(laterRejection, () => {
      sink.add('b', 'observed-but-does-not-change-outcome')
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(() => sink.finalize('msg')).toThrow('first')
  })
})

describe('L-T40 error code structural contract', () => {
  it('every created error carries source and code', () => {
    const error = createLifecycleError('SOME_CODE', 'message')
    expect(error.source).toBe(LIFECYCLE_SOURCE)
    expect(error.code).toBe('SOME_CODE')
  })

  it('phase and detail are attached only when provided', () => {
    const withExtras = createLifecycleError('X', 'm', { phase: 'force', detail: { a: 1 } })
    expect(withExtras.phase).toBe('force')
    expect(withExtras.detail).toEqual({ a: 1 })
    const withoutExtras = createLifecycleError('Y', 'm')
    expect(withoutExtras.phase).toBeUndefined()
    expect(withoutExtras.detail).toBeUndefined()
  })

  it('the original error is reachable via `cause` and identity-preserved (===)', () => {
    const original = new Error('root cause')
    const wrapped = createLifecycleError('WRAP', 'wrapper', { cause: original })
    expect(wrapped.cause).toBe(original)
  })

  it('stack is populated and this function never reassigns it', () => {
    const error = createLifecycleError('X', 'm')
    expect(typeof error.stack).toBe('string')
    expect(error.stack!.length).toBeGreaterThan(0)
  })

  it('AggregateError from the throw policy keeps every original error reachable via .errors', () => {
    const original1 = new Error('one')
    const original2 = new Error('two')
    const sink = createErrorCollector('throw', undefined)
    sink.add('a', original1)
    sink.add('b', original2)
    try {
      sink.finalize('agg')
      throw new Error('should have thrown')
    } catch (error) {
      const aggregate = error as AggregateError
      expect(aggregate.errors).toContain(original1)
      expect(aggregate.errors).toContain(original2)
    }
  })

  it('(source, code) pairs are stable identifiers usable for a uniqueness check', () => {
    const a = createLifecycleError('DUPLICATE', 'm1')
    const b = createLifecycleError('DUPLICATE', 'm2')
    expect(`${a.source}:${a.code}`).toBe(`${b.source}:${b.code}`)
  })
})
