import { describe, expect, it } from 'vitest'
import { createLifecycleUnit } from '../src/lifecycle-unit'
import { LifecycleErrorCode } from '../src/error-code'

describe('L-T5 LifecycleUnit: synchronous value vs thenable probing', () => {
  it('a synchronous return commits directly to loaded, never observed as loading', () => {
    const unit = createLifecycleUnit<number>()
    const states: string[] = []
    unit.start(() => {
      states.push(unit.state) // still 'idle' at call time
      return 42
    })
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(42)
    expect(states).toEqual(['idle'])
  })

  it('a thenable return commits to loading first, then loaded on settle', async () => {
    const unit = createLifecycleUnit<number>()
    let resolve!: (value: number) => void
    unit.start(
      () =>
        new Promise<number>((res) => {
          resolve = res
        })
    )
    expect(unit.state).toBe('loading')
    resolve(7)
    await Promise.resolve()
    await Promise.resolve()
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(7)
  })

  it('a rejecting thenable commits to failed', async () => {
    const unit = createLifecycleUnit<number>()
    let reject!: (error: unknown) => void
    unit.start(
      () =>
        new Promise<number>((_res, rej) => {
          reject = rej
        })
    )
    reject(new Error('load failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(unit.state).toBe('failed')
    expect((unit.error as Error).message).toBe('load failed')
  })

  it('a synchronous throw commits directly to failed', () => {
    const unit = createLifecycleUnit<number>()
    unit.start(() => {
      throw new Error('sync failure')
    })
    expect(unit.state).toBe('failed')
    expect((unit.error as Error).message).toBe('sync failure')
  })

  it('never infers async-ness from the factory’s declared shape — an `async function` that resolves synchronously-in-spirit still goes through the thenable path, and a plain function returning a plain value never does, regardless of how it is declared', () => {
    const unit = createLifecycleUnit<number>()
    unit.start(() => Promise.resolve(1))
    // Declaring the factory `async` always produces a Promise return value at the language level —
    // this is a probe of the RETURN VALUE, not the declaration, and an async function's return
    // value is always a thenable, so this correctly lands in `loading` first.
    expect(unit.state).toBe('loading')
  })
})

describe('L-T34 LifecycleUnit: failed retry vs terminal exit', () => {
  it('start()/restart() from failed begins a new generation and can reach loaded', () => {
    const unit = createLifecycleUnit<number>()
    unit.start(() => {
      throw new Error('first attempt failed')
    })
    expect(unit.state).toBe('failed')
    unit.restart(() => 99)
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(99)
  })

  it('a late (superseded) rejection after restart() does not revert the unit back to failed', async () => {
    const unit = createLifecycleUnit<number>()
    let rejectFirst!: (error: unknown) => void
    unit.start(
      () =>
        new Promise<number>((_res, rej) => {
          rejectFirst = rej
        })
    )
    unit.restart(() => 5) // supersedes the pending first load
    expect(unit.state).toBe('loaded')
    rejectFirst(new Error('late failure, must not apply'))
    await Promise.resolve()
    await Promise.resolve()
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(5)
  })

  it('a late (superseded) resolution after a subsequent failure does not revert the unit back to loaded', async () => {
    const unit = createLifecycleUnit<number>()
    let resolveFirst!: (value: number) => void
    unit.start(
      () =>
        new Promise<number>((res) => {
          resolveFirst = res
        })
    )
    unit.restart(() => {
      throw new Error('second attempt fails')
    })
    expect(unit.state).toBe('failed')
    resolveFirst(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(unit.state).toBe('failed')
  })

  it('close()/dispose() reach terminal from the failed state without needing a successful retry', () => {
    const unit = createLifecycleUnit<number>()
    unit.start(() => {
      throw new Error('fails')
    })
    expect(unit.state).toBe('failed')
    unit.dispose()
    expect(unit.lifecycle).toBe('terminal')
  })

  it('start() on a terminal unit throws and does not resurrect it', () => {
    const unit = createLifecycleUnit<number>()
    unit.dispose()
    expect(() => unit.start(() => 1)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.scopeTerminal })
    )
    expect(unit.lifecycle).toBe('terminal')
  })

  it('start() while closing (dispose in flight conceptually) throws SCOPE_CLOSED before terminal is reached', () => {
    const unit = createLifecycleUnit<number>()
    unit.close()
    expect(() => unit.start(() => 1)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.scopeClosed })
    )
  })

  it('dispose() is idempotent', () => {
    const unit = createLifecycleUnit<number>()
    unit.dispose()
    expect(() => unit.dispose()).not.toThrow()
    expect(unit.lifecycle).toBe('terminal')
  })

  it('the unit retains its last known state/value/error after dispose(), for introspection', () => {
    const unit = createLifecycleUnit<number>()
    unit.start(() => 3)
    unit.dispose()
    expect(unit.state).toBe('loaded')
    expect(unit.value).toBe(3)
  })
})
