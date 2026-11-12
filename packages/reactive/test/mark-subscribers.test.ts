import { expect, it } from 'vitest'
import { markSubscribers } from '../src/runtime/subscriber-graph.ts'

/** Subscriber whose markDirty records its name and then throws. */
function failing(name: string, failure: Error, marked: string[]) {
  return {
    markDirty() {
      marked.push(name)
      throw failure
    }
  }
}

it('marks every subscriber and rethrows the first markDirty failure with later ones attached', () => {
  const first = new Error('first')
  const second = new Error('second')
  const marked: string[] = []
  const observable = { subs: new Set([failing('a', first, marked), failing('b', second, marked)]) }
  let thrown: unknown
  try {
    markSubscribers(observable as never)
  } catch (error) {
    thrown = error
  }
  expect(marked).toEqual(['a', 'b'])
  expect(thrown).toBe(first)
  expect((thrown as { errors?: unknown[] }).errors).toContain(second)
})

it('rethrows a single markDirty failure unchanged', () => {
  const only = new Error('only')
  const marked: string[] = []
  expect(() => markSubscribers({ subs: new Set([failing('a', only, marked)]) } as never)).toThrow(
    only
  )
})
