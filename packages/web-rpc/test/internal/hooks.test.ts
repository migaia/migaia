import { describe, expect, it } from 'vitest'
import { HookRegistry } from '../../src/internal/hooks'

describe('HookRegistry', () => {
  it('ES-T47 preserves Set dedupe and stale disposer identity', () => {
    const registry = new HookRegistry()
    const calls: string[] = []
    const hook = (event: { name: string }) => {
      calls.push(event.name)
    }
    registry.add(hook)
    const duplicateStop = registry.add(hook)

    registry.emit({ name: 'first', at: 0, localId: 'a' })
    duplicateStop()
    registry.emit({ name: 'second', at: 0, localId: 'b' })

    expect(calls).toEqual(['first'])
    expect(registry.size).toBe(0)
  })

  it('ES-T18 isolates thenable and diagnostic failures', async () => {
    const diagnostics: unknown[] = []
    let thenCalls = 0
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable
      then: (_resolve: () => void, reject: (error: unknown) => void) => {
        thenCalls += 1
        reject('bad')
      }
    }
    const registry = new HookRegistry()
    registry.add(() => thenable as never)
    registry.emit({ name: 'test', at: 0, localId: 'a' }, (error) => {
      diagnostics.push(error)
      throw new Error('diagnostic failed')
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(thenCalls).toBe(1)
    expect(diagnostics).toEqual(['bad'])
  })
})
