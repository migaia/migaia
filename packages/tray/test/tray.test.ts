import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityGraphErrorCode } from '@migaia/capability/graph'
import * as trayRoot from '@migaia/tray'
import { createTrayGraph, TrayErrorCode, type ITrayEntryDefinition } from '../src/index.ts'
import { attachTrayError, createTrayError, TRAY_SOURCE } from '../src/errors.ts'
import { key, deferred } from './tray-helper.ts'

describe('tray', () => {
  it('source domains keeps the public tray error and source export aligned', () => {
    /** Capture the actual admission error emitted by the published root entry. */
    let received: unknown
    try {
      trayRoot.createTray([] as never)
    } catch (error) {
      received = error
    }
    expect(received, 'SOURCE_DOMAIN_TRAY_SOURCE').toMatchObject({
      source: 'tray',
      code: trayRoot.TrayErrorCode.hostInvalid
    })
    expect(Reflect.get(received as object, 'source')).toBe(trayRoot.TRAY_SOURCE)
    expect(Reflect.get(received as object, 'source')).toBe(TRAY_SOURCE)
  })

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
})

describe('tray', () => {
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
