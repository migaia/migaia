import { describe, expect, it, vi } from 'vitest'
import { HookRegistry } from '../src/internal/hooks.js'
import type { IWebRpcHookEvent } from '../src/typing.js'

/** Creates the smallest valid hook event while keeping each trace label explicit. */
const event = (name: string): IWebRpcHookEvent => ({ name, at: 0, localId: 'local' })

describe('SWV2-T53 web-rpc event-subscriber traces', () => {
  it('preserves recursive nested hook order through HookRegistry', () => {
    const registry = new HookRegistry()
    const trace: string[] = []
    registry.add((value) => {
      trace.push(`first:${value.name}`)
      if (value.name === 'outer') registry.emit(event('nested'))
    })
    registry.add((value) => {
      trace.push(`second:${value.name}`)
    })

    registry.emit(event('outer'))

    expect(trace).toEqual(['first:outer', 'first:nested', 'second:nested', 'second:outer'])
  })

  it('keeps the dispatch snapshot across unsubscribe and re-add', () => {
    const registry = new HookRegistry()
    const trace: string[] = []
    let stopSecond = (): void => undefined
    registry.add(() => {
      trace.push('first')
      stopSecond()
      registry.add(() => {
        trace.push('added')
      })
    })
    stopSecond = registry.add(() => {
      trace.push('second')
    })

    registry.emit(event('outer'))

    expect(trace).toEqual(['first', 'second'])
  })

  it('contains sync throw and async rejection without truncating fanout', async () => {
    const registry = new HookRegistry()
    const syncFailure = new Error('sync hook failure')
    const asyncFailure = new Error('async hook failure')
    const reports: unknown[] = []
    const trace: string[] = []
    registry.add(() => {
      trace.push('sync-failure')
      throw syncFailure
    })
    registry.add(() => {
      trace.push('async-failure')
      return Promise.reject(asyncFailure)
    })
    registry.add(() => {
      trace.push('healthy')
    })

    registry.emit(event('outer'), (error, value) => reports.push([error, value.name]))
    await vi.waitFor(() => expect(reports).toHaveLength(2))

    expect(trace).toEqual(['sync-failure', 'async-failure', 'healthy'])
    expect(reports).toEqual([
      [syncFailure, 'outer'],
      [asyncFailure, 'outer']
    ])
  })
})
