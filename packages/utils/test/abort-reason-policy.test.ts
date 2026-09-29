import { describe, expect, it } from 'vitest'
import { createAbortTimeoutSignal, raceWithAbort } from '../src/promise.js'
import { createManualScheduler } from '../src/scheduler.js'

/** A structural signal whose reason accessor throws once per attempted read. */
function hostileSignal(cause: unknown, initialAborted = false) {
  let aborted = initialAborted
  let listener: (() => void) | undefined
  let reads = 0
  const signal = {
    get aborted() {
      return aborted
    },
    get reason(): never {
      reads++
      throw cause
    },
    addEventListener: (_type: 'abort', callback: () => void) => {
      listener = callback
    },
    removeEventListener: () => {
      listener = undefined
    }
  }
  return {
    signal,
    get reads() {
      return reads
    },
    fire() {
      aborted = true
      listener?.()
    }
  }
}

describe('A3 utils abort reason policy', () => {
  it('uses a getter failure as the reason for event and pre-aborted races', async () => {
    const cause = new Error('reason getter')
    const later = hostileSignal(cause)
    const pending = raceWithAbort(() => new Promise<never>(() => undefined), {
      signal: later.signal
    })
    later.fire()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause })
    expect(later.reads).toBe(1)

    const early = hostileSignal(cause, true)
    await expect(
      raceWithAbort(() => new Promise<never>(() => undefined), { signal: early.signal })
    ).rejects.toMatchObject({ code: 'ABORTED', cause })
    expect(early.reads).toBe(2)
  })

  it('forwards the same getter failure through the composed timeout signal', () => {
    const cause = new Error('reason getter')
    const external = hostileSignal(cause)
    const composed = createAbortTimeoutSignal({
      signal: external.signal,
      timeoutMs: 100,
      scheduler: createManualScheduler()
    })
    external.fire()
    expect(composed.signal?.reason).toBe(cause)
    expect(external.reads).toBe(1)
    composed.dispose()
  })
})
