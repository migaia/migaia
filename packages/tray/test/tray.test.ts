import { describe, expect, it, vi } from 'vitest'
import { CapabilityGraphErrorCode } from '@migaia/capability/graph'
import {
  createTray,
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
    const tray = createTray([entry])
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
    expect(() => createTray([entry, entry])).toThrow()
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
    expect(() => createTray([entry as never])).toThrow(
      expect.objectContaining({ code: TrayErrorCode.invalidEntry })
    )
  })

  it('rejects an unknown dependency before any start callback', () => {
    const start = vi.fn(() => ({ value: 1, release: () => undefined }))
    expect(() =>
      createTray([{ key: key('consumer'), kind: 'value', requires: [key('missing')], start }])
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
      createTray([
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
    const tray = createTray([
      { key: key('invalid-result'), kind: 'value', start: () => ({ value: 1 }) as never }
    ])
    await expect(tray.ready()).rejects.toMatchObject({ code: 'GRAPH_INVALID_NODE' })
  })

  it('keeps get unavailable before readiness', () => {
    const tray = createTray([
      { key: key('pending'), kind: 'value', start: () => ({ value: 1, release: () => undefined }) }
    ])
    expect(() => tray.get(key('pending'))).toThrow(
      expect.objectContaining({ code: TrayErrorCode.unavailable })
    )
  })

  it('fails closed for an invalid readiness state without starting Graph', async () => {
    const start = vi.fn(() => ({ value: 1, release: () => undefined }))
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
      const tray = createTray([
        { key: key('falsey-gate'), kind: 'value', readiness: { state: 'failed', error }, start }
      ])
      await expect(tray.ready()).rejects.toBe(error)
      expect(tray.state).toBe('failed')
      expect(start).not.toHaveBeenCalled()
    }
  )

  it('preserves native readiness getter error identity and type', async () => {
    const error = new TypeError('hostile')
    const tray = createTray([
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
    'caches actual gate rejection for hostile %s without replacing it',
    async (_label, thrown) => {
      const tray = createTray([
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
      await expect(first).rejects.toSatisfy((received: unknown) =>
        typeof thrown === 'object' && thrown !== null
          ? received === thrown
          : (received as Error & { cause?: unknown }).cause === thrown
      )
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
    const tray = createTray([entry])
    expect(reads).toBe(1)
    expect(tray.keys).toEqual([key('stable')])
    expect(reads).toBe(1)
  })

  it('projects Graph after gate failure and never rereads readiness on dispose/ready', async () => {
    let stateReads = 0
    const tray = createTray([
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
    await expect(tray.ready()).rejects.toThrow()
    const firstGate = tray.ready()
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
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    expect(attachTrayError(frozen, TrayErrorCode.gateReadFailed)).toBe(frozen)
    const crossRealmError = Object.create(Error.prototype) as Error & {
      name: string
      message: string
    }
    crossRealmError.name = 'Error'
    crossRealmError.message = 'cross realm'
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
    expect(attachTrayError(proxy, TrayErrorCode.gateReadFailed)).toBe(proxy)
    const errorProxy = new Proxy(new Error('proxied'), {
      getPrototypeOf() {
        throw new Error('prototype trap')
      }
    })
    expect(attachTrayError(errorProxy, TrayErrorCode.gateReadFailed)).toBe(errorProxy)
  })

  it('keeps declared direct dependency reads isolated from transitive lookup', async () => {
    const providerKey = key('provider')
    const consumerKey = key('consumer')
    const tray = createTray([
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
    const first = createTray([
      { key: key('shared'), kind: 'value', start: () => ({ value: 1, release: () => undefined }) }
    ])
    const second = createTray([
      { key: key('shared'), kind: 'value', start: () => ({ value: 2, release: () => undefined }) }
    ])
    await Promise.all([first.ready(), second.ready()])
    expect(first.get<number>(key('shared'))).toBe(1)
    expect(second.get<number>(key('shared'))).toBe(2)
    await first.dispose()
    expect(second.get<number>(key('shared'))).toBe(2)
  })

  it('preserves Graph admission errors without Tray rewrapping', async () => {
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    const tray = createTray([
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
    let tray!: ReturnType<typeof createTray>
    const visibleDuringRelease: boolean[] = []
    tray = createTray([
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
