import { describe, expect, it, vi } from 'vitest'
import { GraphReadinessState, type IGraphReadinessSnapshot } from '@migaia/capability'
import { createTrayGraph, TrayErrorCode } from '../src/index.ts'
import { TRAY_SOURCE } from '../src/errors.ts'
import { key } from './tray-helper.ts'

describe('tray', () => {
  it('keeps get unavailable before readiness', () => {
    const tray = createTrayGraph([
      { key: key('pending'), kind: 'value', start: () => ({ value: 1, release: () => undefined }) }
    ])
    expect(() => tray.get(key('pending'))).toThrow(
      expect.objectContaining({ code: TrayErrorCode.unavailable })
    )
  })

  it('fails closed for an invalid readiness state without starting Graph', async () => {
    const start = vi.fn(() => ({ value: 1, release: () => undefined }))
    const tray = createTrayGraph([
      {
        key: key('invalid-readiness'),
        kind: 'value',
        readiness: { state: 'starting' as never, error: undefined },
        start
      }
    ])
    await expect(tray.ready()).rejects.toMatchObject({ code: TrayErrorCode.invalidEntry })
    expect(start).not.toHaveBeenCalled()
  })

  it('does not read error after invalid readiness state', async () => {
    let errorReads = 0
    const tray = createTrayGraph([
      {
        key: key('invalid-order'),
        kind: 'value',
        readiness: {
          state: 'starting' as never,
          get error() {
            errorReads += 1
            throw new Error('error getter should not run')
          }
        },
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    await expect(tray.ready()).rejects.toMatchObject({ code: TrayErrorCode.invalidEntry })
    expect(errorReads).toBe(0)
  })

  it('projects gate failure locally without starting Graph', async () => {
    const error = new Error('blocked')
    const tray = createTrayGraph([
      {
        key: key('blocked'),
        kind: 'value',
        readiness: { state: 'blocked', error },
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    await expect(tray.ready()).rejects.toBe(error)
    expect(tray.state).toBe('failed')
    expect(tray.error).toBe(error)
  })

  it.each([0, false, ''])(
    'treats a falsey readiness error %s as a real gate failure',
    async (error) => {
      const start = vi.fn(() => ({ value: 1, release: () => undefined }))
      const tray = createTrayGraph([
        { key: key('falsey-gate'), kind: 'value', readiness: { state: 'failed', error }, start }
      ])
      await expect(tray.ready()).rejects.toBe(error)
      expect(tray.state).toBe('failed')
      expect(start).not.toHaveBeenCalled()
    }
  )

  it('preserves native readiness getter error identity and type', async () => {
    const error = new TypeError('hostile')
    const tray = createTrayGraph([
      {
        key: key('hostile'),
        kind: 'value',
        readiness: {
          get state(): never {
            throw error
          },
          error: undefined
        },
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    await expect(tray.ready()).rejects.toBe(error)
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error & { code?: string }).code).toBe(TrayErrorCode.gateReadFailed)
  })

  it.each([
    ['primitive', 17],
    [
      'proxy',
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('prototype trap')
          },
          has() {
            throw new Error('has trap')
          }
        }
      )
    ]
  ] as const)(
    'caches the coded gate rejection and retains hostile %s as its cause',
    async (_label, thrown) => {
      const tray = createTrayGraph([
        {
          key: key('hostile-gate'),
          kind: 'value',
          readiness: {
            get state(): never {
              throw thrown
            },
            error: undefined
          },
          start: () => ({ value: 1, release: () => undefined })
        }
      ])
      const first = tray.ready()
      const second = tray.ready()
      expect(second).toBe(first)
      await expect(first).rejects.toMatchObject({
        source: TRAY_SOURCE,
        code: TrayErrorCode.gateReadFailed
      })
      await expect(first).rejects.toSatisfy((received: Error) => received.cause === thrown)
    }
  )

  it('does not reread admitted key when exposing keys', () => {
    let reads = 0
    const entry = {
      get key() {
        reads += 1
        return key('stable')
      },
      kind: 'value' as const,
      start: () => ({ value: 1, release: () => undefined })
    }
    const tray = createTrayGraph([entry])
    expect(reads).toBe(1)
    expect(tray.keys).toEqual([key('stable')])
    expect(reads).toBe(1)
  })

  it('projects Graph after gate failure and never rereads readiness on dispose/ready', async () => {
    let stateReads = 0
    const tray = createTrayGraph([
      {
        key: key('blocked'),
        kind: 'value',
        readiness: {
          get state() {
            stateReads += 1
            return 'blocked' as const
          },
          error: new Error('blocked')
        },
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    const firstGate = tray.ready()
    await expect(firstGate).rejects.toThrow()
    const dispose = tray.dispose()
    expect(['quiescing', 'terminal']).toContain(tray.state)
    expect(tray.error).toBeUndefined()
    await dispose
    const handedOff = tray.ready()
    expect(handedOff).not.toBe(firstGate)
    await expect(handedOff).rejects.toThrow()
    expect(stateReads).toBe(1)
  })

  it('preserves Graph ready and dispose Promise identity after gate success', async () => {
    const readiness = { state: 'ready' as const, error: undefined }
    const tray = createTrayGraph([
      {
        key: key('promise-identity'),
        kind: 'value',
        readiness,
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    const firstReady = tray.ready()
    expect(tray.ready()).toBe(firstReady)
    await firstReady
    const firstDispose = tray.dispose()
    expect(tray.dispose()).toBe(firstDispose)
    await firstDispose
  })

  it('does not reread or react to readiness changes after the startup snapshot', async () => {
    const readiness: { state: 'ready' | 'failed'; error: unknown } = {
      state: 'ready',
      error: undefined
    }
    const tray = createTrayGraph([
      {
        key: key('frozen-readiness'),
        kind: 'value',
        readiness,
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    await tray.ready()
    readiness.state = 'failed'
    readiness.error = new Error('late failure')
    expect(tray.state).toBe('ready')
    expect(tray.get<number>(key('frozen-readiness'))).toBe(1)
  })

  it('cold dispose prevents readiness access and projects one Graph handoff', async () => {
    let reads = 0
    const tray = createTrayGraph([
      {
        key: key('cold'),
        kind: 'value',
        readiness: {
          get state() {
            reads += 1
            return 'blocked' as const
          },
          error: new Error('blocked')
        },
        start: () => ({ value: 1, release: () => undefined })
      }
    ])
    await tray.dispose()
    await expect(tray.ready()).rejects.toThrow()
    expect(reads).toBe(0)
  })
})

it('reacquires a blocked provider snapshot without rereading other admitted metadata', async () => {
  /** Providers publish immutable facts; the entry getter obtains the current one. */
  let snapshot: IGraphReadinessSnapshot = Object.freeze({
    state: GraphReadinessState.blocked,
    error: new Error('provider unavailable')
  })
  /** Initial admission and the blocked retry each read this property once. */
  let reads = 0
  /** Key admission is fixed even when readiness is retried. */
  let keyReads = 0
  /** Startup remains exactly once after all external gates accept. */
  const start = vi.fn(() => ({ value: 9, release: () => undefined }))
  /** The public factory owns the unchanged static graph throughout recovery. */
  const tray = createTrayGraph([
    {
      get key() {
        keyReads++
        return key('retry')
      },
      kind: 'value',
      get readiness() {
        reads++
        return snapshot
      },
      start
    }
  ])
  await expect(tray.ready()).rejects.toBe(snapshot.error)
  expect(start).not.toHaveBeenCalled()
  snapshot = Object.freeze({ state: GraphReadinessState.ready, error: undefined })
  /** Successful startup retains the same Promise for every later caller. */
  const accepted = tray.ready()
  await accepted
  expect(tray.ready()).toBe(accepted)
  expect(tray.get(key('retry'))).toBe(9)
  expect(reads).toBe(2)
  expect(keyReads).toBe(1)
  expect(start).toHaveBeenCalledTimes(1)
  expect(tray.error).toBeUndefined()
  await tray.dispose()
})

it.each([false, true])('caches failed readiness after blocked=%s', async (blocked) => {
  /** A failed fact stays terminal even if its producer subsequently publishes ready. */
  const error = new Error('provider failed')
  /** Only blocked admits a later fact; failed keeps its first rejection identity. */
  let snapshot: IGraphReadinessSnapshot = {
    state: blocked ? GraphReadinessState.blocked : GraphReadinessState.failed,
    error
  }
  /** Rejected cached facts must not reacquire external state. */
  let reads = 0
  /** The entry must never start through a failed gate. */
  const start = vi.fn(() => ({ value: 1, release: () => undefined }))
  /** Readiness is the only dynamic definition field. */
  const tray = createTrayGraph([
    {
      key: key('failed'),
      kind: 'value',
      get readiness() {
        reads++
        return snapshot
      },
      start
    }
  ])
  if (blocked) {
    await expect(tray.ready()).rejects.toBe(error)
    snapshot = { state: GraphReadinessState.failed, error }
  }
  /** This rejected Promise remains the permanent cached result. */
  const failed = tray.ready()
  await expect(failed).rejects.toBe(error)
  snapshot = { state: GraphReadinessState.ready, error: undefined }
  expect(tray.ready()).toBe(failed)
  expect(reads).toBe(blocked ? 2 : 1)
  expect(start).not.toHaveBeenCalled()
  await tray.dispose()
})

it.each(['getter', 'shape'] as const)(
  'retains refreshed %s failures without another retry',
  async (mode) => {
    /** Original native getter failure stays reachable as the same object. */
    const error = new TypeError('provider getter failed')
    /** The initial admitted fact is valid; the explicit retry tests the new boundary. */
    let refresh = false
    /** Invalid retries must be cached rather than repeatedly executing provider code. */
    let reads = 0
    /** Startup cannot acquire a resource after a failed refreshed boundary. */
    const start = vi.fn(() => ({ value: 1, release: () => undefined }))
    /** The test drives only the public readiness entry. */
    const tray = createTrayGraph([
      {
        key: key('refresh-error'),
        kind: 'value',
        start,
        get readiness(): IGraphReadinessSnapshot {
          reads++
          if (!refresh) return { state: GraphReadinessState.blocked, error }
          if (mode === 'getter') throw error
          return 17 as never
        }
      }
    ])
    await expect(tray.ready()).rejects.toBe(error)
    refresh = true
    /** Source getter failures and invalid refreshed shapes both become stable failed results. */
    const failed = tray.ready()
    if (mode === 'getter') {
      await expect(failed).rejects.toBe(error)
      expect(error).toMatchObject({ code: TrayErrorCode.gateReadFailed })
    } else await expect(failed).rejects.toMatchObject({ code: TrayErrorCode.invalidEntry })
    expect(tray.ready()).toBe(failed)
    expect(reads).toBe(2)
    expect(start).not.toHaveBeenCalled()
    await tray.dispose()
  }
)
