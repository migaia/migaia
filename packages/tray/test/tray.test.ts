import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { GraphReadinessState, type IGraphReadinessSnapshot } from '@migaia/capability'
import { CapabilityGraphErrorCode } from '@migaia/capability/graph'
import * as trayRoot from '@migaia/tray'
import {
  createTrayGraph,
  TrayErrorCode,
  type ITrayEntryDefinition,
  type ITrayKey
} from '../src/index.js'
import { attachTrayError, createTrayError, TRAY_SOURCE } from '../src/errors.js'

const key = (value: string) => value as ITrayKey
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('tray', () => {
  it('exports the static graph separately from the host manager', () => {
    expect(trayRoot).toHaveProperty('createTray', expect.any(Function))
    expect(trayRoot.createTray).not.toBe(trayRoot.createTrayGraph)
    expect(() => trayRoot.createTray([] as never)).toThrow(
      expect.objectContaining({ source: TRAY_SOURCE, code: TrayErrorCode.hostInvalid })
    )
    expect(trayRoot).toHaveProperty('createTrayGraph', expect.any(Function))
  })

  it('admits static entries and releases value before callback', async () => {
    const events: string[] = []
    const entry: ITrayEntryDefinition<unknown> = {
      key: key('value'),
      kind: 'value',
      start: () => ({
        value: 1,
        release: () => {
          events.push('release')
        }
      })
    }
    const tray = createTrayGraph([entry])
    await tray.ready()
    expect(tray.get(key('value'))).toBe(1)
    await tray.dispose()
    expect(events).toEqual(['release'])
    expect(() => tray.get(key('value'))).toThrow()
  })

  it('rejects duplicate entries', () => {
    const entry: ITrayEntryDefinition<unknown> = {
      key: key('same'),
      kind: 'value',
      start: () => ({ value: 1, release: () => undefined })
    }
    expect(() => createTrayGraph([entry, entry])).toThrow()
  })

  it.each([
    [
      'empty key',
      { key: key('   '), kind: 'value', start: () => ({ value: 1, release: () => undefined }) }
    ],
    [
      'invalid kind',
      {
        key: key('invalid-kind'),
        kind: 'other',
        start: () => ({ value: 1, release: () => undefined })
      }
    ],
    [
      'non-array requires',
      {
        key: key('invalid-requires'),
        kind: 'value',
        requires: key('provider'),
        start: () => ({ value: 1, release: () => undefined })
      }
    ]
  ])('rejects %s at admission with the Tray invalid-entry code', (_label, entry) => {
    expect(() => createTrayGraph([entry as never])).toThrow(
      expect.objectContaining({ code: TrayErrorCode.invalidEntry })
    )
  })

  it('rejects an unknown dependency before any start callback', () => {
    const start = vi.fn(() => ({ value: 1, release: () => undefined }))
    expect(() =>
      createTrayGraph([{ key: key('consumer'), kind: 'value', requires: [key('missing')], start }])
    ).toThrow(expect.objectContaining({ code: TrayErrorCode.invalidEntry }))
    expect(start).not.toHaveBeenCalled()
  })

  it('normalizes a hostile requires iterator at admission', () => {
    const requires = new Proxy([key('provider')], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('requires iterator failed')
        return Reflect.get(target, property, receiver)
      }
    })
    expect(() =>
      createTrayGraph([
        {
          key: key('hostile-requires'),
          kind: 'value',
          requires,
          start: () => ({ value: 1, release: () => undefined })
        }
      ])
    ).toThrow(expect.objectContaining({ code: TrayErrorCode.invalidEntry }))
  })

  it('rejects invalid start results through the Graph error boundary', async () => {
    const tray = createTrayGraph([
      { key: key('invalid-result'), kind: 'value', start: () => ({ value: 1 }) as never }
    ])
    await expect(tray.ready()).rejects.toMatchObject({ code: 'GRAPH_INVALID_NODE' })
  })

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

  it('covers every Tray error code with source, code, message, stack, and cause contract', () => {
    const causes = [undefined, 'primitive-cause']
    for (const code of Object.values(TrayErrorCode))
      for (const cause of causes) {
        const error = createTrayError(code, cause)
        expect(error).toMatchObject({ source: TRAY_SOURCE, code })
        expect(error.message).toBeTruthy()
        expect(error.stack).toBeTruthy()
        if (cause !== undefined) expect((error as Error & { cause?: unknown }).cause).toBe(cause)
      }
  })

  it('preserves native, frozen, and cross-realm-shaped thrown values deterministically', () => {
    const native = new TypeError('native')
    expect(attachTrayError(native, TrayErrorCode.gateReadFailed)).toBe(native)
    expect(native).toBeInstanceOf(TypeError)
    expect((native as Error & { code?: string }).code).toBe(TrayErrorCode.gateReadFailed)
    const frozen = Object.freeze(new Error('frozen'))
    expect(attachTrayError(frozen, TrayErrorCode.gateReadFailed).cause).toBe(frozen)
    /** Native foreign realm error, rather than an Error.prototype lookalike. */
    const crossRealmError = runInNewContext("new Error('cross realm')") as Error
    expect(attachTrayError(crossRealmError, TrayErrorCode.gateReadFailed)).toBe(crossRealmError)
    expect((crossRealmError as Error & { source?: string }).source).toBe(TRAY_SOURCE)
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('proxy trap')
        }
      }
    )
    expect(attachTrayError(proxy, TrayErrorCode.gateReadFailed).cause).toBe(proxy)
    const errorProxy = new Proxy(new Error('proxied'), {
      getPrototypeOf() {
        throw new Error('prototype trap')
      }
    })
    expect(attachTrayError(errorProxy, TrayErrorCode.gateReadFailed).cause).toBe(errorProxy)
  })

  it('keeps declared direct dependency reads isolated from transitive lookup', async () => {
    const providerKey = key('provider')
    const consumerKey = key('consumer')
    const tray = createTrayGraph([
      {
        key: providerKey,
        kind: 'value',
        start: () => ({ value: 7, release: () => undefined })
      },
      {
        key: consumerKey,
        kind: 'computed',
        requires: [providerKey],
        start: (context) => ({
          value: context.get<number>(providerKey) + 1,
          release: () => undefined
        })
      }
    ])
    await tray.ready()
    expect(tray.get<number>(consumerKey)).toBe(8)
    expect(() => tray.get(key('unknown'))).toThrow(
      expect.objectContaining({ code: TrayErrorCode.unknownEntry })
    )
  })

  it('keeps multiple Tray instances isolated', async () => {
    const first = createTrayGraph([
      { key: key('shared'), kind: 'value', start: () => ({ value: 1, release: () => undefined }) }
    ])
    const second = createTrayGraph([
      { key: key('shared'), kind: 'value', start: () => ({ value: 2, release: () => undefined }) }
    ])
    await Promise.all([first.ready(), second.ready()])
    expect(first.get<number>(key('shared'))).toBe(1)
    expect(second.get<number>(key('shared'))).toBe(2)
    await first.dispose()
    expect(second.get<number>(key('shared'))).toBe(2)
  })

  it('preserves Graph admission errors without Tray rewrapping', async () => {
    const tray = createTrayGraph([
      {
        key: key('a'),
        kind: 'value',
        requires: [key('b')],
        start: () => ({ value: 1, release: () => undefined })
      },
      {
        key: key('b'),
        kind: 'value',
        requires: [key('a')],
        start: () => ({ value: 2, release: () => undefined })
      }
    ])
    await expect(tray.ready()).rejects.toMatchObject({
      code: CapabilityGraphErrorCode.dependencyCycle
    })
  })

  it('assimilates a foreign start thenable once through Graph', async () => {
    let thenReads = 0
    const tray = createTrayGraph([
      {
        key: key('thenable'),
        kind: 'resource',
        start: () =>
          Object.defineProperty({}, 'th' + 'en', {
            get: () => {
              thenReads += 1
              return (resolve: (value: unknown) => void) =>
                resolve({ value: 3, release: () => undefined })
            }
          }) as never
      }
    ])
    await tray.ready()
    expect(thenReads).toBe(1)
    expect(tray.get<number>(key('thenable'))).toBe(3)
  })

  it('forwards auxiliary ownership to lifecycle without Tray timeout policy', async () => {
    const force = vi.fn()
    const tray = createTrayGraph([
      {
        key: key('owned'),
        kind: 'resource',
        start: (context) => {
          context.own({ resource: true }, { order: 4, force })
          return { value: 'ready', release: () => undefined }
        }
      }
    ])
    await tray.ready()
    await tray.dispose()
    expect(force).toHaveBeenCalledTimes(1)
  })

  it('forwards the complete auxiliary release descriptor without rewriting policy', async () => {
    const custom = vi.fn(() => undefined)
    const graceful = vi.fn(() => undefined)
    const force = vi.fn(() => undefined)
    const tray = createTrayGraph([
      {
        key: key('descriptor'),
        kind: 'resource',
        start: (context) => {
          context.own(
            { resource: true },
            { order: 7, custom, graceful, gracefulTimeoutMs: 23, force }
          )
          return { value: 'ready', release: () => undefined }
        }
      }
    ])
    await tray.ready()
    await tray.dispose()
    expect(custom).toHaveBeenCalledTimes(1)
    expect(graceful).not.toHaveBeenCalled()
    expect(force).not.toHaveBeenCalled()
  })

  it('keeps an unresolved same-realm release in quiescing state', async () => {
    const pending = deferred<void>()
    const tray = createTrayGraph([
      {
        key: key('never-settles'),
        kind: 'resource',
        start: () => ({ value: 1, release: () => pending.promise })
      }
    ])
    await tray.ready()
    const disposal = tray.dispose()
    await Promise.resolve()
    expect(tray.state).toBe('quiescing')
    expect(tray.error).toBeUndefined()
    pending.resolve()
    await disposal
    expect(tray.state).toBe('terminal')
  })

  it('does not expose values when a later entry fails startup', async () => {
    const goodKey = key('good')
    const badKey = key('bad')
    const tray = createTrayGraph([
      { key: goodKey, kind: 'value', start: () => ({ value: 1, release: () => undefined }) },
      {
        key: badKey,
        kind: 'value',
        start: () => {
          throw new Error('startup failed')
        }
      }
    ])
    await expect(tray.ready()).rejects.toThrow('startup failed')
    expect(() => tray.get<number>(goodKey)).toThrow(
      expect.objectContaining({ code: TrayErrorCode.unavailable })
    )
  })

  it('does not expose a late start result after dispose races startup', async () => {
    const result = deferred<unknown>()
    const tray = createTrayGraph([
      {
        key: key('late'),
        kind: 'resource',
        start: () => result.promise as never
      }
    ])
    const startup = tray.ready()
    const disposal = tray.dispose()
    result.resolve({ value: 9, release: () => undefined })
    await Promise.allSettled([startup, disposal])
    expect(() => tray.get<number>(key('late'))).toThrow(
      expect.objectContaining({ code: TrayErrorCode.unavailable })
    )
  })

  it('revokes value visibility before invoking the primary release callback', async () => {
    let tray!: ReturnType<typeof createTrayGraph>
    const visibleDuringRelease: boolean[] = []
    tray = createTrayGraph([
      {
        key: key('release-order'),
        kind: 'value',
        start: () => ({
          value: 1,
          release: () => {
            visibleDuringRelease.push(
              (() => {
                try {
                  tray.get<number>(key('release-order'))
                  return true
                } catch {
                  return false
                }
              })()
            )
          }
        })
      }
    ])
    await tray.ready()
    await tray.dispose()
    expect(visibleDuringRelease).toEqual([false])
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
