import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { ConcurrencyPolicy } from '../../src/authoring/concurrency.js'
import { createStorageHost, definePlugin } from '../../src/index.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { MemoryOperation } from '../../src/backends/memory-constants.js'

describe('memory execution and the original concurrency budget', () => {
  it('keeps after-next and native failure handling around the actual root operation', async () => {
    const order: string[] = []
    let observed: unknown
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (
            input.operation !== MemoryOperation.set &&
            input.operation !== MemoryOperation.putRecord
          )
            return next(input)
          order.push('before')
          try {
            await next(input)
            order.push('after')
          } catch (error) {
            observed = error
            order.push('caught')
            throw error
          }
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin(), intervention] })
    const store = host.backend('memory')
    await store.set('shared', 'value')
    expect(order).toEqual(['before', 'after'])
    const failure = await store
      .putRecord({ invalid: true }, 'shared')
      .catch((error: unknown) => error)
    expect(failure).toBe(observed)
    expect(failure).toMatchObject({ code: 'DUPLICATE_KEY' })
    expect(order).toEqual(['before', 'after', 'before', 'caught'])
    expect(await store.get('shared')).toBe('value')
  })

  it('includes awaited intervention in the one root deadline and settles it before closing the budget', async () => {
    const entered = deferred<void>()
    const ready = deferred<void>()
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation === MemoryOperation.set) {
            entered.resolve()
            await ready.promise
          }
          await next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin(), intervention] })
    const store = host.backend('memory')
    const pending = store.set('late', 'value', { timeoutMs: 20 })
    await entered.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 35))
    ready.resolve()
    await expect(pending).rejects.toMatchObject({
      source: '@migaia/storage-contract',
      code: 'ABORTED'
    })
    expect(await store.get('late')).toBeNull()
  })

  it('reenters the original pipeline for each real transaction attempt after a commit conflict', async () => {
    let stages = 0
    const events: string[] = []
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation !== MemoryOperation.transaction) return next(input)
          const current = ++stages
          events.push(`enter:${current}`)
          try {
            await next(input)
            events.push(`committed:${current}`)
          } catch (error) {
            events.push((error as { code: string }).code)
            throw error
          } finally {
            events.push(`exit:${current}`)
          }
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin(), intervention] })
    const store = host.backend('memory')
    await store.putRecord({ value: 0 }, 'row')
    let callbacks = 0
    await store.transaction(
      async function (this: undefined, scope) {
        expect(this).toBeUndefined()
        expect(arguments).toHaveLength(1)
        const before = (await scope.getRecord('row')) as { value: number }
        if (++callbacks === 1)
          await store.putRecord({ value: 1 }, 'row', { conflictPolicy: 'replace' })
        await scope.putRecord({ value: before.value + 1 }, 'row', { conflictPolicy: 'replace' })
      },
      { concurrency: ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }) }
    )
    expect(callbacks).toBe(2)
    expect(stages).toBe(2)
    expect(events).toEqual([
      'enter:1',
      'WRITE_CONFLICT',
      'exit:1',
      'enter:2',
      'committed:2',
      'exit:2'
    ])
    expect(await store.getRecord('row')).toEqual({ value: 2 })
  })
})
