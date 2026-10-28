import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.ts'

describe('reactive foundation', () => {
  it('propagates signal changes through computed and effect', () => {
    const runtime = createRuntime()
    const source = runtime.signal(1)
    const derived = runtime.computed(() => source.value * 2)
    const values: number[] = []
    const effect = runtime.effect(() => {
      values.push(derived.value)
    })

    expect(derived.value).toBe(2)
    source.value = 3
    runtime.flush()
    expect(values).toEqual([2, 6])

    effect.dispose()
    derived.dispose()
    source.dispose()
  })
})
