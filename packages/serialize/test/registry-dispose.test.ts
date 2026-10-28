import { describe, expect, it } from 'vitest'
import { type IScheduler } from '@migaia/utils/scheduler'
import { createSerializeRegistry, type ISerializeChunk } from '../src/index.ts'

import { plugin } from './fixtures/registry.ts'

describe('dispose：释放语义', () => {
  it('重复 dispose 是幂等的', async () => {
    const registry = createSerializeRegistry([plugin('a')])
    await registry.dispose()
    await expect(registry.dispose()).resolves.toBeUndefined()
  })

  it('deadlineAt 为 NaN/Infinity 时拒绝（输入门禁）', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const registry = createSerializeRegistry([plugin('a')])
      await expect(registry.dispose({ deadlineAt: bad })).rejects.toMatchObject({
        code: 'INVALID_OPTION',
        source: 'serialization'
      })
    }
  })

  it('非法 deadlineAt 不毒化后续合法 dispose，parser 仍 exactly-once 释放', async () => {
    let disposeCount = 0
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (value) => ['text', String(value)],
        decode: (chunk) => chunk,
        dispose: () => {
          disposeCount += 1
        }
      })
    ])

    await expect(registry.dispose({ deadlineAt: Number.NaN })).rejects.toMatchObject({
      code: 'INVALID_OPTION',
      source: 'serialization'
    })
    await expect(registry.dispose()).resolves.toBeUndefined()
    await expect(registry.dispose()).resolves.toBeUndefined()
    expect(disposeCount).toBe(1)
  })

  it('dispose 后 encode/decode 拒绝，且不再是可重试的瞬时错误', async () => {
    const registry = createSerializeRegistry([plugin('a')])
    await registry.dispose()
    await expect(registry.encode('x')).rejects.toThrow(/serialize registry is disposed/)
    await expect(registry.decode(['text', 'x'])).rejects.toThrow(/serialize registry is disposed/)
  })

  it('单个 parser dispose 失败时直接透传该错误', async () => {
    const boom = new Error('boom')
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          throw boom
        }
      })
    ])
    await expect(registry.dispose()).rejects.toBe(boom)
  })

  it('多个 parser dispose 失败时聚合成 AggregateError，且每个 parser 都被尝试释放', async () => {
    const firstFailure = new Error('first')
    const secondFailure = new Error('second')
    const disposeOrder: string[] = []
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          disposeOrder.push('a')
          throw firstFailure
        }
      }),
      plugin('b', {
        name: 'b',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          disposeOrder.push('b')
          throw secondFailure
        }
      })
    ])
    await expect(registry.dispose()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError)
      expect(disposeOrder).toEqual(['b', 'a'])
      expect((error as AggregateError).errors).toEqual([secondFailure, firstFailure])
      expect((error as AggregateError).cause).toBeUndefined()
      return true
    })
  })
})

describe('deadline failure never skips parser cleanup', () => {
  it('scheduler.now getter failure is wrapped at admission and owns no parser yet', () => {
    const getterFailure = new Error('now getter failure')
    let parserDisposeCalls = 0
    const scheduler = {
      get now(): () => number {
        throw getterFailure
      },
      schedule: () => ({ cancel: () => {} })
    }

    try {
      createSerializeRegistry(
        [
          plugin('a', {
            name: 'a',
            encode: (value) => ['text', String(value)],
            decode: (chunk) => chunk,
            dispose: () => {
              parserDisposeCalls += 1
            }
          })
        ],
        { scheduler }
      )
      throw new Error('expected scheduler admission failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_OPTION', source: 'serialization' })
      expect((error as Error & { cause?: Error }).cause).toMatchObject({ cause: getterFailure })
    }
    expect(parserDisposeCalls).toBe(0)
  })

  it('scheduler.now call failure remains primary, cleanup runs once, and dispose promise is stable', async () => {
    const nowFailure = new Error('now call failure')
    let parserDisposeCalls = 0
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            parserDisposeCalls += 1
          }
        })
      ],
      {
        scheduler: {
          now: (): number => {
            throw nowFailure
          },
          schedule: () => ({ cancel: () => {} })
        }
      }
    )

    const first = registry.dispose({ deadlineAt: 10 })
    const second = registry.dispose({ deadlineAt: 20 })
    expect(second).toBe(first)
    await expect(first).rejects.toBe(nowFailure)
    expect(parserDisposeCalls).toBe(1)
    await expect(registry.encode('x')).rejects.toThrow(/serialize registry is disposed/)
  })

  it('scheduler.schedule throw still disposes parser exactly once', async () => {
    const scheduleFailure = new Error('schedule failure')
    let parserDisposeCalls = 0
    const scheduler: IScheduler = {
      now: (): number => 0,
      schedule: () => {
        throw scheduleFailure
      }
    }
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            parserDisposeCalls += 1
          }
        })
      ],
      { scheduler }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toBe(scheduleFailure)
    expect(parserDisposeCalls).toBe(1)
  })

  it('invalid scheduler task still disposes parser exactly once', async () => {
    let parserDisposeCalls = 0
    const scheduler: IScheduler = {
      now: (): number => 0,
      schedule: () => ({}) as never
    }
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            parserDisposeCalls += 1
          }
        })
      ],
      { scheduler }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toBeInstanceOf(Error)
    expect(parserDisposeCalls).toBe(1)
  })

  it('scheduler task cancel getter throw still disposes parser exactly once', async () => {
    let parserDisposeCalls = 0
    const scheduler: IScheduler = {
      now: (): number => 0,
      schedule: () =>
        ({
          get cancel() {
            throw new Error('cancel getter failure')
          }
        }) as never
    }
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            parserDisposeCalls += 1
          }
        })
      ],
      { scheduler }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toBeInstanceOf(Error)
    expect(parserDisposeCalls).toBe(1)
  })

  it('synchronous deadline callback still cancels returned task and disposes parser', async () => {
    let cancelCalls = 0
    let parserDisposeCalls = 0
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            parserDisposeCalls += 1
          }
        })
      ],
      {
        scheduler: {
          now: () => 0,
          schedule: (callback: () => void) => {
            callback()
            return {
              cancel: () => {
                cancelCalls += 1
              }
            }
          }
        }
      }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).resolves.toBeUndefined()
    expect(cancelCalls).toBe(1)
    expect(parserDisposeCalls).toBe(1)
  })

  it('cancel call failure remains primary while parser cleanup failure stays reachable under throw policy', async () => {
    const cancelFailure = new Error('cancel failure')
    const cleanupFailure = new Error('parser cleanup failure')
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            throw cleanupFailure
          }
        })
      ],
      {
        scheduler: {
          now: () => 0,
          schedule: () => ({
            cancel: () => {
              throw cancelFailure
            }
          })
        }
      }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBe(cancelFailure)
      expect((error as { errors?: readonly unknown[] }).errors).toEqual([cleanupFailure])
      return true
    })
  })

  it('schedule failure stays primary while report policy observes cleanup failure and contains reporter throw', async () => {
    const scheduleFailure = new Error('schedule failure')
    const cleanupFailure = new Error('parser cleanup failure')
    const reported: unknown[] = []
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => ['text', String(value)],
          decode: (chunk) => chunk,
          dispose: () => {
            throw cleanupFailure
          }
        })
      ],
      {
        scheduler: {
          now: () => 0,
          schedule: () => {
            throw scheduleFailure
          }
        },
        cleanup: {
          policy: 'report',
          report: (diagnostic) => {
            reported.push(diagnostic)
            throw new Error('cleanup reporter failure')
          }
        }
      }
    )

    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toBe(scheduleFailure)
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({ kind: 'cleanup-error', error: cleanupFailure })
  })

  it('deadline primary plus detached parser rejection stays observed without unhandled rejection', async () => {
    const scheduleFailure = new Error('schedule failure')
    let rejectParser: ((error: unknown) => void) | undefined
    const reported: unknown[] = []
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: () =>
            new Promise<ISerializeChunk>((_, reject) => {
              rejectParser = reject
            }),
          decode: (chunk) => chunk
        })
      ],
      {
        scheduler: {
          now: (): number => 0,
          schedule: () => {
            throw scheduleFailure
          }
        },
        report: (error) => {
          reported.push(error)
        }
      }
    )

    const pending = registry.encode('x')
    await expect(registry.dispose({ deadlineAt: 10 })).rejects.toBe(scheduleFailure)
    rejectParser?.(new Error('late parser rejection'))
    await expect(pending).rejects.toThrow(/aborted/)
    await Promise.resolve()
    expect(
      reported.some((error) => (error as Error).message.includes('late parser rejection'))
    ).toBe(true)
  })
})
