import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { CONFIG_DELETE, ConfigOwner } from '../src/config.js'

/** Shared typed fixture shape. */
type IAppConfig = {
  server: { host: string; port: number }
  features: string[]
  debug: boolean
}

/** Creates a fresh typed fixture owner. */
const createOwner = (options?: ConstructorParameters<typeof ConfigOwner<IAppConfig>>[1]) =>
  new ConfigOwner<IAppConfig>(
    { server: { host: 'localhost', port: 80 }, features: ['a'], debug: false },
    options
  )

describe('ConfigOwner', () => {
  it('reads typed paths as readonly views', () => {
    /** Owner under test. */
    const owner = createOwner()
    /** Typed read of a nested number. */
    const port = owner.get('server.port')
    expectTypeOf(port).toEqualTypeOf<number | undefined>()
    expect(port).toBe(80)
    expect(owner.get(['server', 'host'])).toBe('localhost')
    expect(owner.getOr('server.port', 0)).toBe(80)
    expect(owner.has('debug')).toBe(true)
    expect(owner.read('server.port')).toEqual({ kind: 'value', value: 80 })
    expect(() => {
      ;(owner.view().server as { port: number }).port = 1
    }).toThrowError(expect.objectContaining({ code: 'CONFIG_READONLY' }))
  })

  it('distinguishes missing values through getOr, has and require', () => {
    /** Owner whose record contains an own undefined value. */
    const owner = new ConfigOwner<Record<string, unknown>>({ present: undefined })
    expect(owner.has('present')).toBe(true)
    expect(owner.getOr('present', 'fallback')).toBeUndefined()
    expect(owner.getOr('missing', 'fallback')).toBe('fallback')
    expect(() => owner.require('missing.deep')).toThrowError(
      expect.objectContaining({ code: 'CONFIG_VALUE_MISSING', source: '@migaia/utils' })
    )
  })

  it('chains writes with copy-on-write snapshots', () => {
    /** Owner under test. */
    const owner = createOwner()
    /** View captured before writes; it must keep showing the old snapshot. */
    const before = owner.view()
    owner
      .set('server.port', 8080)
      .set('cache.ttl' as never, 60 as never)
      .patch({ debug: true })
    expect(owner.get('server.port')).toBe(8080)
    expect(owner.get(['cache', 'ttl'])).toBe(60)
    expect(owner.get('debug')).toBe(true)
    expect(before.server.port).toBe(80)
    owner
      .delete('server.host')
      .delete('missing' as never)
      .set(['features', '1'], 'b')
    expect(owner.has('server.host')).toBe(false)
    expect(owner.get('features')).toEqual(['a', 'b'])
    owner.delete(['features', '0'])
    expect(owner.get('features')).toEqual(['b'])
    owner.patch({ debug: CONFIG_DELETE })
    expect(owner.has('debug')).toBe(false)
  })

  it('rejects writes through non-container intermediates and keeps the old snapshot', () => {
    /** Owner under test. */
    const owner = createOwner()
    expect(() => owner.set(['server', 'port', 'x'], 1)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PATH_INVALID' })
    )
    expect(() => owner.set(['features', 'x'], 1)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PATH_INVALID' })
    )
    expect(() => owner.set('__proto__.polluted' as never, 1 as never)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PATH_INVALID' })
    )
    expect(owner.get('server.port')).toBe(80)
  })

  it('combines sources and retypes the owner', () => {
    /** Owner that gains a cache section. */
    const owner = createOwner().combine({ cache: { ttl: 60 } }, new ConfigOwner({ debug: true }))
    expectTypeOf(owner.get('cache.ttl')).toEqualTypeOf<number | undefined>()
    expect(owner.get('cache.ttl')).toBe(60)
    expect(owner.get('debug')).toBe(true)
    expect(owner.get('server.port')).toBe(80)
    /** List form with explicit strategy. */
    owner.combine([{ features: ['b'] }], { strategies: { array: 'concat' } })
    expect(owner.get('features')).toEqual(['a', 'b'])
    /** Static merge creates a new owner. */
    const merged = ConfigOwner.merge({ a: 1 }, { b: 2 })
    expect(merged.toJSON()).toEqual({ a: 1, b: 2 })
  })

  it('validates every commit and rolls back rejected writes', () => {
    /** Validator rejecting privileged ports. */
    const validate = vi.fn((value: { readonly server: { readonly port: number } }) => {
      if (value.server.port < 1024 && value.server.port !== 80) throw new Error('port')
    })
    /** Owner under test. */
    const owner = createOwner({ validate })
    expect(validate).toHaveBeenCalledTimes(1)
    expect(() => owner.set('server.port', 22)).toThrowError(
      expect.objectContaining({
        code: 'CONFIG_VALIDATION_FAILED',
        cause: expect.objectContaining({ message: 'port' })
      })
    )
    expect(owner.get('server.port')).toBe(80)
    expect(() => new ConfigOwner({ a: 1 }, { validate: () => false })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_VALIDATION_FAILED' })
    )
  })

  it('batches writes into one validated commit and one notification', () => {
    /** Validator counting commits. */
    const validate = vi.fn()
    /** Owner under test. */
    const owner = createOwner({ validate })
    /** Root watcher. */
    const listener = vi.fn()
    owner.watch(listener)
    validate.mockClear()
    owner.batch((draft) =>
      draft
        .set('server.port', 1)
        .set('server.host', 'h')
        .batch((inner) => inner.patch({ debug: true }))
    )
    expect(validate).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(owner.get('server.host')).toBe('h')
    expect(() =>
      owner.batch((draft) => {
        draft.set('server.port', 2)
        throw new Error('abort batch')
      })
    ).toThrow('abort batch')
    expect(owner.get('server.port')).toBe(1)
  })

  it('notifies root and path watchers, reports listener failures and rejects reentrant writes', () => {
    /** Collected listener failures. */
    const report = vi.fn()
    /** Owner under test. */
    const owner = createOwner({ report })
    /** Path watcher. */
    const onPort = vi.fn()
    /** Root watcher that fails. */
    const failure = new Error('listener')
    owner.watch('server.port', onPort)
    owner.watch(() => {
      throw failure
    })
    /** Root watcher that tries to write. */
    const reentrant = vi.fn(() => owner.set('debug', true))
    const stop = owner.watch(reentrant)
    owner.set('debug', true)
    expect(onPort).not.toHaveBeenCalled()
    owner.set('server.port', 81)
    expect(onPort).toHaveBeenCalledWith(81, 80)
    expect(report).toHaveBeenCalledWith(failure)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'REENTRANT_CALL' }))
    stop()
    stop()
    reentrant.mockClear()
    owner.set('server.port', 82)
    expect(reentrant).not.toHaveBeenCalled()
  })

  it('resets, locks, clones, selects and diffs', () => {
    /** Owner under test. */
    const owner = createOwner()
    owner.set('server.port', 1).reset()
    expect(owner.get('server.port')).toBe(80)
    /** Independent clone. */
    const clone = owner.clone().set('debug', true)
    expect(owner.get('debug')).toBe(false)
    expect(owner.diff(clone)).toEqual([{ path: ['debug'], kind: 'changed' }])
    expect(owner.diff({ ...owner.toJSON(), extra: 1 })).toEqual([
      { path: ['extra'], kind: 'added' }
    ])
    expect(owner.equals(owner.toJSON())).toBe(true)
    /** Selected subtree owner. */
    const server = owner.select('server')
    expect(server.get('port')).toBe(80)
    expect(() => owner.select('debug')).toThrowError(
      expect.objectContaining({ code: 'CONFIG_UNSUPPORTED' })
    )
    owner.lock()
    expect(owner.locked).toBe(true)
    expect(() => owner.set('debug', true)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_READONLY' })
    )
  })

  it('serializes to JSON and rejects non-JSON runtime values', () => {
    /** Owner under test. */
    const owner = createOwner()
    expect(JSON.parse(owner.toString())).toEqual(owner.toJSON())
    expect(owner.toString(2)).toContain('\n')
    /** Rich-runtime owner with a Map. */
    const rich = new ConfigOwner({ map: new Map([[1, 2]]) }, { profile: 'richRuntime' })
    expect(() => rich.toJSON()).toThrowError(
      expect.objectContaining({ code: 'CONFIG_UNSUPPORTED' })
    )
  })

  it('parses JSON text through from()', () => {
    expect(ConfigOwner.from<{ port: number }>('{"port":80}').get('port')).toBe(80)
    expect(() => ConfigOwner.from('{bad')).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PARSE_FAILED', cause: expect.any(SyntaxError) })
    )
    expect(() => ConfigOwner.from(1 as never)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PARSE_FAILED' })
    )
    expect(() => ConfigOwner.from('[1]')).toThrowError(
      expect.objectContaining({ code: 'CONFIG_UNSUPPORTED' })
    )
  })

  it('loads asynchronous sources with typed errors for rejection, abort and timeout', async () => {
    expect((await ConfigOwner.fromAsync(Promise.resolve('{"a":1}'))).get('a')).toBe(1)
    expect((await ConfigOwner.fromAsync(Promise.resolve({ b: 2 }))).get('b')).toBe(2)
    /** Factory receives a signal. */
    const factory = vi.fn(({ signal }: { signal: { aborted: boolean } }) =>
      Promise.resolve({ aborted: signal.aborted })
    )
    expect((await ConfigOwner.fromAsync(factory)).get('aborted')).toBe(false)
    /** Source failure kept on cause. */
    const failure = new Error('network')
    await expect(ConfigOwner.fromAsync(Promise.reject(failure))).rejects.toMatchObject({
      code: 'CONFIG_SOURCE_FAILED',
      cause: failure
    })
    await expect(
      ConfigOwner.fromAsync(() => {
        throw failure
      })
    ).rejects.toMatchObject({ code: 'CONFIG_SOURCE_FAILED', cause: failure })
    await expect(ConfigOwner.fromAsync(Promise.resolve('{bad'))).rejects.toMatchObject({
      code: 'CONFIG_PARSE_FAILED'
    })
    /** Already aborted controller. */
    const controller = new AbortController()
    controller.abort('stop')
    await expect(
      ConfigOwner.fromAsync(new Promise(() => undefined), { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(
      ConfigOwner.fromAsync(new Promise(() => undefined), { timeoutMs: 1 })
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  })

  it('builds nested config from environment variables', () => {
    /** Owner from env-style keys. */
    const owner = ConfigOwner.fromEnv(
      {
        APP__DB__PORT: '5432',
        APP__DB__HOST: 'db',
        APP__NAME: 'x',
        OTHER: 'skip',
        APP__EMPTY: undefined
      },
      {
        prefix: 'APP__',
        key: (segment) => segment.toLowerCase(),
        coerce: (raw, path) => (path.at(-1) === 'port' ? Number(raw) : raw)
      }
    )
    expect(owner.toJSON()).toEqual({ db: { port: 5432, host: 'db' }, name: 'x' })
    expect(() => ConfigOwner.fromEnv({ A: '1', A__B: '2' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_CONFLICT' })
    )
    expect(() => ConfigOwner.fromEnv({ A____B: '1' })).toThrowError(
      expect.objectContaining({ code: 'CONFIG_PATH_INVALID' })
    )
  })

  it('keeps state private and the prototype frozen', () => {
    /** Owner under test. */
    const owner = createOwner()
    expect(Object.keys(owner)).toEqual([])
    expect(Object.isFrozen(ConfigOwner.prototype)).toBe(true)
    expect(() => {
      ;(owner as unknown as { set: unknown }).set = () => owner
    }).toThrow(TypeError)
    expect(ConfigOwner.is(owner)).toBe(true)
    expect(ConfigOwner.is(Object.create(ConfigOwner.prototype))).toBe(false)
  })
})
