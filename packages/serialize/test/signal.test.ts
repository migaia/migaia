import { describe, expect, it, vi } from 'vitest'
import { createSerializeRegistry } from '../src/index.js'
import { composeSerializeSignal } from '../src/signal.js'
import type { ISerializeAbortSignal } from '../src/types.js'

describe('composeSerializeSignal registration races', () => {
  it('disposes caller and closing registrations in strict reverse install order exactly once', () => {
    const removalOrder: string[] = []
    const caller: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {
        removalOrder.push('caller')
      }
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {
        removalOrder.push('closing')
      }
    }

    const composed = composeSerializeSignal(caller, closing, () => {})
    composed.dispose()
    composed.dispose()

    expect(removalOrder).toEqual(['closing', 'caller'])
  })

  it('rechecks a structural signal aborted during addEventListener without callback replay', () => {
    const reason = new Error('caller stopped during registration')
    let aborted = false
    let removeCalls = 0
    const caller: ISerializeAbortSignal = {
      get aborted() {
        return aborted
      },
      get reason() {
        return reason
      },
      addEventListener() {
        aborted = true
      },
      removeEventListener() {
        removeCalls++
      }
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    }

    const composed = composeSerializeSignal(caller, closing, () => {})

    expect(composed.signal.aborted).toBe(true)
    expect(composed.signal.reason).toBe(reason)
    expect(removeCalls).toBe(1)
    composed.dispose()
    expect(removeCalls).toBe(1)
  })

  it('rolls back first listener when second registration throws', () => {
    const registrationFailure = new Error('closing listener rejected')
    const removalOrder: string[] = []
    const caller: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {
        removalOrder.push('caller')
      }
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {
        throw registrationFailure
      },
      removeEventListener() {
        removalOrder.push('closing')
      }
    }

    let error: unknown
    try {
      composeSerializeSignal(caller, closing, () => {})
    } catch (cause) {
      error = cause
    }

    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause: registrationFailure
    })
    expect((error as { cause?: unknown }).cause).toBe(registrationFailure)
    expect((error as { errors?: unknown }).errors).toBeUndefined()
    expect(removalOrder).toEqual(['closing', 'caller'])
  })

  it('turns first registration failure into a tagged rejection without starting parser work', async () => {
    const registrationFailure = new Error('caller listener rejected')
    let encodeCalls = 0
    let removeCalls = 0
    const caller: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {
        throw registrationFailure
      },
      removeEventListener() {
        removeCalls++
      }
    }
    const registry = createSerializeRegistry([
      {
        type: 'a',
        parser: {
          name: 'a',
          encode: () => {
            encodeCalls++
            return ['text', 'unexpected'] as const
          },
          decode: (chunk) => chunk
        }
      }
    ])

    let error: unknown
    try {
      await registry.encode('x', { signal: caller })
    } catch (cause) {
      error = cause
    }

    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause: registrationFailure
    })
    expect(encodeCalls).toBe(0)
    expect(removeCalls).toBe(1)
  })

  it('contains listener-removal failures and reports each only once', () => {
    const callerRemovalFailure = new Error('caller removal failed')
    const closingRemovalFailure = new Error('closing removal failed')
    const reported: unknown[] = []
    const removalOrder: string[] = []
    const caller: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {
        removalOrder.push('caller')
        throw callerRemovalFailure
      }
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {
        removalOrder.push('closing')
        throw closingRemovalFailure
      }
    }

    const composed = composeSerializeSignal(caller, closing, (error) => reported.push(error))

    expect(() => composed.dispose()).not.toThrow()
    expect(() => composed.dispose()).not.toThrow()
    expect(removalOrder).toEqual(['closing', 'caller'])
    expect(reported).toEqual([closingRemovalFailure, callerRemovalFailure])
  })

  it('reports abort listener failures without replacing the primary cancellation', () => {
    const listenerFailure = new Error('abort listener failed')
    const abortReason = new Error('caller stopped')
    const reported: unknown[] = []
    const listeners = new Set<() => void>()
    class FakeAbortController {
      readonly signal = {
        aborted: false,
        reason: undefined as unknown,
        addEventListener: (_type: 'abort', listener: () => void): void => {
          listeners.add(listener)
        },
        removeEventListener: (_type: 'abort', listener: () => void): void => {
          listeners.delete(listener)
        }
      }

      abort(reason?: unknown): void {
        if (this.signal.aborted) return
        this.signal.aborted = true
        this.signal.reason = reason
        for (const listener of listeners) listener()
      }
    }
    vi.stubGlobal('AbortController', FakeAbortController)
    try {
      let callerListener: (() => void) | undefined
      const caller: ISerializeAbortSignal = {
        aborted: false,
        reason: abortReason,
        addEventListener(_type, listener) {
          callerListener = listener
        },
        removeEventListener() {}
      }
      const closing: ISerializeAbortSignal = {
        aborted: false,
        reason: undefined,
        addEventListener() {},
        removeEventListener() {}
      }

      const composed = composeSerializeSignal(caller, closing, (error) => reported.push(error))
      composed.signal.addEventListener('abort', () => {
        throw listenerFailure
      })
      callerListener?.()

      expect(composed.signal.aborted).toBe(true)
      expect(composed.signal.reason).toBe(abortReason)
      expect(reported).toEqual([listenerFailure])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('invokes caller listener methods with the original receiver', () => {
    let aborted = false
    let reason: unknown = 'first reason'
    let callerListener: (() => void) | undefined
    let addReads = 0
    let removeReads = 0
    let addReceiverMatched = false
    let removeReceiverMatched = false
    let removeCalls = 0
    const caller = {} as Record<PropertyKey, unknown>
    const addMethod = function (this: object, _type: 'abort', listener: () => void): void {
      addReceiverMatched = this === caller
      callerListener = listener
    }
    const removeMethod = function (this: object): void {
      removeReceiverMatched = this === caller
      removeCalls += 1
    }
    Object.defineProperties(caller, {
      aborted: {
        configurable: true,
        get: () => aborted
      },
      reason: {
        configurable: true,
        get: () => reason
      },
      addEventListener: {
        configurable: true,
        get: () => {
          addReads += 1
          return addMethod
        }
      },
      removeEventListener: {
        configurable: true,
        get: () => {
          removeReads += 1
          return removeMethod
        }
      }
    })
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    }

    const composed = composeSerializeSignal(
      caller as unknown as ISerializeAbortSignal,
      closing,
      () => {}
    )
    aborted = true
    reason = 'second reason'
    callerListener?.()

    expect(composed.signal.reason).toBe('second reason')
    expect(addReads).toBe(2)
    expect(removeReads).toBe(2)
    expect(addReceiverMatched).toBe(true)
    expect(removeReceiverMatched).toBe(true)
    composed.dispose()
    expect(removeCalls).toBe(1)
  })

  it('turns a hostile reason accessor into an INVALID_OPTION abort without throwing', () => {
    const cause = new Error('reason getter failed')
    let callerListener: (() => void) | undefined
    let removeCalls = 0
    const caller: ISerializeAbortSignal = {
      aborted: false,
      get reason() {
        throw cause
      },
      addEventListener(_type, listener) {
        callerListener = listener
      },
      removeEventListener() {
        removeCalls += 1
      }
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    }
    const composed = composeSerializeSignal(caller, closing, () => {})

    expect(() => callerListener?.()).not.toThrow()
    expect(composed.signal.reason).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause
    })
    expect(removeCalls).toBe(1)
  })
})
