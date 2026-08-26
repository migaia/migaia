import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '../src/index.js'
import { ResourceErrorCode } from '../src/error-code.js'

describe('Round24 R-T01 Resource option admission', () => {
  it('snapshots every public option once before ownership, listeners, or fetch', () => {
    const runtime = createRuntime()
    const reads = new Map<string, number>()
    const count = (name: string): void => {
      reads.set(name, (reads.get(name) ?? 0) + 1)
    }
    const fetcher = vi.fn(() => 'value')
    const scheduler = {
      now: () => 0,
      schedule: () => ({ cancel: () => undefined })
    }
    const options = {
      get debugName() {
        count('debugName')
        return 'round24'
      },
      get ttl() {
        count('ttl')
        return 10
      },
      get autoStart() {
        count('autoStart')
        return false
      },
      get staleWhileRevalidate() {
        count('staleWhileRevalidate')
        return true
      },
      get retry() {
        count('retry')
        return 1
      },
      get retryDelay() {
        count('retryDelay')
        return 2
      },
      get keepAlive() {
        count('keepAlive')
        return true
      },
      get initialSnapshot() {
        count('initialSnapshot')
        return undefined
      },
      get scheduler() {
        count('scheduler')
        return scheduler
      }
    }

    const resource = new Resource(fetcher, runtime, options)

    expect([...reads.entries()]).toEqual([
      ['debugName', 1],
      ['ttl', 1],
      ['autoStart', 1],
      ['staleWhileRevalidate', 1],
      ['retry', 1],
      ['retryDelay', 1],
      ['keepAlive', 1],
      ['initialSnapshot', 1],
      ['scheduler', 1]
    ])
    expect(fetcher).not.toHaveBeenCalled()
    resource.dispose()
  })

  it('rejects a hostile option getter before runtime ownership or fetch side effects', () => {
    const runtime = createRuntime()
    const cause = new Error('retry getter failed')
    const fetcher = vi.fn(() => 'unexpected')
    const options = {
      get retry(): number {
        throw cause
      }
    }

    expect(() => new Resource(fetcher, runtime, options)).toThrowError(
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.invalidOption,
        cause
      })
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    'ttl',
    'retry',
    'retryDelay',
    'staleWhileRevalidate',
    'keepAlive',
    'scheduler'
  ] as const)('wraps hostile %s option getters before admission', (property) => {
    const runtime = createRuntime()
    const cause = new Error(`${property} getter failed`)
    const fetcher = vi.fn(() => 'unexpected')
    const options = {} as Record<string, unknown>
    Object.defineProperty(options, property, {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    expect(() => new Resource(fetcher, runtime, options)).toThrowError(
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.invalidOption,
        cause
      })
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects an invalid option value before ownership or fetch side effects', () => {
    const runtime = createRuntime()
    const fetcher = vi.fn(() => 'unexpected')

    expect(
      () =>
        new Resource(fetcher, runtime, {
          autoStart: false,
          staleWhileRevalidate: 'yes' as never
        })
    ).toThrowError(
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.invalidOption
      })
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
