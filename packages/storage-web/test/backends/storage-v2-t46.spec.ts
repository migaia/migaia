import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { memoryStorage } from '../../src/backends/memory.js'
import { indexedDb } from '../../src/backends/indexed-db.js'

/** Creates an isolated fake IndexedDB store for each post-commit failure case. */
const freshIndexedDb = () =>
  indexedDb({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `storage-v2-t46-${Math.random().toString(36).slice(2)}`
  })

describe('storage-web T46 post-commit failure policy', () => {
  it('resolves a committed write after synchronous listener failure and continues fanout', async () => {
    const store = memoryStorage()
    const listenerFailure = new Error('synchronous listener failure')
    const trace: string[] = []
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
    })
    try {
      store.subscribeChanges(() => {
        trace.push('first')
        throw listenerFailure
      })
      store.subscribeChanges(() => {
        trace.push('second')
      })

      await expect(store.set('sync-throw', 'committed')).resolves.toBeUndefined()
      await expect(store.get('sync-throw')).resolves.toBe('committed')
      expect(trace).toEqual(['first', 'second'])
      expect(diagnostics[0]?.[1]).toMatchObject({ errors: [listenerFailure] })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('resolves a committed write after late listener rejection and reports the rejection', async () => {
    const store = memoryStorage()
    const listenerFailure = new Error('late listener failure')
    const trace: string[] = []
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
    })
    try {
      store.subscribeChanges(() => Promise.reject(listenerFailure))
      store.subscribeChanges(() => {
        trace.push('second')
      })

      await expect(store.set('late-reject', 'committed')).resolves.toBeUndefined()
      await expect(store.get('late-reject')).resolves.toBe('committed')
      expect(trace).toEqual(['second'])
      await vi.waitFor(() => expect(diagnostics[0]?.[1]).toBe(listenerFailure))
    } finally {
      consoleError.mockRestore()
    }
  })

  it('resolves a committed write when the diagnostic reporter fails', async () => {
    const store = memoryStorage()
    const listenerFailure = new Error('listener failure')
    const reporterFailure = new Error('reporter failure')
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
      if (diagnostics.length === 1) throw reporterFailure
    })
    try {
      store.subscribeChanges(() => {
        throw listenerFailure
      })

      await expect(store.set('reporter-failure', 'committed')).resolves.toBeUndefined()
      await expect(store.get('reporter-failure')).resolves.toBe('committed')
      expect(diagnostics[0]?.[1]).toMatchObject({ errors: [listenerFailure] })
      expect(diagnostics[1]?.[1]).toBe(reporterFailure)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('resolves a committed write when both reporter and terminal fallback fail', async () => {
    const store = memoryStorage()
    const listenerFailure = new Error('listener failure before terminal fallback')
    const reporterFailure = new Error('reporter and terminal fallback failure')
    let reportAttempts = 0
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      reportAttempts += 1
      throw reporterFailure
    })
    try {
      store.subscribeChanges(() => {
        throw listenerFailure
      })

      await expect(store.set('terminal-reporter-failure', 'committed')).resolves.toBeUndefined()
      await expect(store.get('terminal-reporter-failure')).resolves.toBe('committed')
      expect(reportAttempts).toBe(2)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('SWV2-T46 observes a hostile thenable returned by the diagnostic reporter', async () => {
    const store = memoryStorage()
    const listenerFailure = new Error('listener failure before reporter thenable')
    const reporterFailure = new Error('reporter then getter failure')
    const diagnostics: unknown[][] = []
    let thenReads = 0
    const hostileReporterValue = Object.create(null)
    const promiseResolutionProperty = ['t', 'hen'].join('')
    Object.defineProperty(hostileReporterValue, promiseResolutionProperty, {
      get: () => {
        thenReads += 1
        throw reporterFailure
      }
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
      if (diagnostics.length === 1) return hostileReporterValue
    })
    try {
      store.subscribeChanges(() => {
        throw listenerFailure
      })
      await expect(store.set('reporter-thenable', 'committed')).resolves.toBeUndefined()
      await expect(store.get('reporter-thenable')).resolves.toBe('committed')
      await vi.waitFor(() => expect(diagnostics).toHaveLength(2))
      expect(thenReads).toBe(1)
      expect(diagnostics[1]?.[1]).toBe(reporterFailure)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('SWV2-T46 preserves IndexedDB commit results across all post-commit failures', async () => {
    const syncFailure = new Error('indexed synchronous listener failure')
    const lateFailure = new Error('indexed late listener failure')
    const cases = [
      {
        key: 'indexed-sync-throw',
        register(store: ReturnType<typeof freshIndexedDb>, trace: string[]) {
          store.subscribeChanges(() => {
            trace.push('first')
            throw syncFailure
          })
          store.subscribeChanges(() => {
            trace.push('second')
          })
        }
      },
      {
        key: 'indexed-late-reject',
        register(store: ReturnType<typeof freshIndexedDb>, trace: string[]) {
          store.subscribeChanges(() => Promise.reject(lateFailure))
          store.subscribeChanges(() => {
            trace.push('second')
          })
        }
      }
    ]
    for (const testCase of cases) {
      const store = freshIndexedDb()
      const trace: string[] = []
      const diagnostics: unknown[][] = []
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        diagnostics.push(args)
      })
      try {
        testCase.register(store, trace)
        await expect(store.set(testCase.key, 'committed')).resolves.toBeUndefined()
        await expect(store.get(testCase.key)).resolves.toBe('committed')
        expect(trace).toContain('second')
        await vi.waitFor(() => expect(diagnostics.length).toBeGreaterThan(0))
      } finally {
        consoleError.mockRestore()
        await store.dispose()
      }
    }

    const store = freshIndexedDb()
    const listenerFailure = new Error('indexed listener failure')
    const reporterFailure = new Error('indexed reporter failure')
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
      if (diagnostics.length === 1) throw reporterFailure
    })
    try {
      store.subscribeChanges(() => {
        throw listenerFailure
      })
      await expect(store.set('indexed-reporter-failure', 'committed')).resolves.toBeUndefined()
      await expect(store.get('indexed-reporter-failure')).resolves.toBe('committed')
      expect(diagnostics.length).toBeGreaterThanOrEqual(2)
    } finally {
      consoleError.mockRestore()
      await store.dispose()
    }
  })
})
