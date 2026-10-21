import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.js'
import {
  createTrackedObserver,
  type ITrackedObserverBinding
} from '../src/runtime/observer-binding.js'
import type { IObserver } from '../src/runtime/types.js'

/** Custom observer callbacks can reconnect graph edges even while scheduler batch depth is positive. */
describe('notification snapshot reuse', () => {
  it('keeps entry membership during markDirty and invalidates the cache after reconnection', () => {
    const runtime = createRuntime()
    const signal = runtime.signal(0)
    const sequence: string[] = []
    let first: ITrackedObserverBinding
    let second: ITrackedObserverBinding
    let late: ITrackedObserverBinding
    let changed = false
    /** All three observers expose only the binding-owned readonly metadata. */
    const make = (label: string, mutate?: () => void): ITrackedObserverBinding => {
      let binding: ITrackedObserverBinding
      const observer: IObserver = {
        runtime,
        disposed: false,
        get deps() {
          return binding.deps
        },
        get depVersions() {
          return binding.depVersions
        },
        markDirty() {
          sequence.push(label)
          mutate?.()
        },
        onDependencyDisconnected() {}
      }
      binding = createTrackedObserver(observer)
      return binding
    }
    first = make('first', () => {
      if (changed) return
      changed = true
      second.clear()
      late.runTracked(() => signal.value)
    })
    second = make('second')
    late = make('late')
    first.runTracked(() => signal.value)
    second.runTracked(() => signal.value)
    signal.value = 1
    expect(sequence).toEqual(['first', 'second'])
    sequence.length = 0
    signal.value = 2
    expect(sequence).toEqual(['first', 'late'])
    sequence.length = 0
    signal.value = 3
    expect(sequence).toEqual(['first', 'late'])
    first.clear()
    late.clear()
    signal.dispose()
  })
})
