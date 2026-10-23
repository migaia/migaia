import { describe, expect, it } from 'vitest'
import { TrayErrorCode } from '../../src/error-code.js'
import { defineTrayHost, readHost } from '../../src/hosts/define-host.js'
import { defineRoutingPolicy } from '../../src/hosts/routing-policy.js'
import { toWire } from '../../src/hosts/portable.js'

/** Empty business installation keeps definition tests independent of runtime startup. */
const plugins = () => [] as const

describe('instance definitions', () => {
  it('accepts and freezes the three runtime definitions without running plugins', () => {
    for (const definition of [
      { name: 'co', plugins, exposes: [] },
      { name: 'th', runtime: 'thread', entry: 'thread.mjs', plugins, exposes: [] },
      { name: 'pr', runtime: 'process', entry: 'process.mjs', plugins, exposes: [] }
    ] as const) {
      /** Only the definition boundary runs; no unit is created. */
      const host = defineTrayHost(definition)
      expect(Object.isFrozen(host)).toBe(true)
      expect(Object.isFrozen(host.exposes)).toBe(true)
      expect(host.runtime).toBe('runtime' in definition ? definition.runtime : 'coroutine')
      expect(readHost(host)).toBe(host)
      expect(() => readHost({ ...host })).toThrowError(
        expect.objectContaining({ code: TrayErrorCode.hostInvalid })
      )
    }
  })

  it.each([
    { runtime: 'bad' },
    { runtime: null },
    { entry: 'coroutine.mjs' },
    { runtime: 'thread' },
    { runtime: 'process', entry: 'process.mjs', limits: { heapBytes: 1 } },
    { runtime: 'thread', entry: 'thread.mjs', sandbox: { name: 'env', wrap: (x: unknown) => x } },
    { plugins: 1 },
    { exposes: ['node.svc', 'node.svc'] },
    { routing: [{ name: 'forged' }] }
  ])('rejects invalid host input %# with the Tray classification', (override) => {
    expect(() =>
      defineTrayHost({ name: 'bad', plugins, exposes: [], ...override } as never)
    ).toThrowError(expect.objectContaining({ source: 'tray', code: TrayErrorCode.hostInvalid }))
  })

  it.each(['trayChild', 'trayClient', 'trayRelay'])('rejects reserved expose %s', (name) => {
    expect(() =>
      defineTrayHost({ name: 'bad', plugins, exposes: [`${name}.svc`] } as never)
    ).toThrowError(expect.objectContaining({ code: TrayErrorCode.reservedName }))
  })

  it('rejects accessors without executing them and snapshots the policy tuple', () => {
    /** A getter must never run while a definition is admitted. */
    let reads = 0
    expect(() =>
      defineTrayHost({
        name: 'bad',
        plugins,
        exposes: [],
        get runtime() {
          reads++
          return 'coroutine'
        }
      } as never)
    ).toThrowError(expect.objectContaining({ code: TrayErrorCode.hostInvalid }))
    expect(reads).toBe(0)
    /** Array fields obey the same no-accessor admission rule as the top-level DSL. */
    const exposes = ['node.svc']
    Object.defineProperty(exposes, 0, {
      get: () => {
        reads++
        return 'node.svc'
      }
    })
    expect(() => defineTrayHost({ name: 'bad', plugins, exposes } as never)).toThrowError(
      expect.objectContaining({ code: TrayErrorCode.hostInvalid })
    )
    expect(reads).toBe(0)
    /** A trusted policy retains its identity in an owned, frozen tuple. */
    const policy = defineRoutingPolicy('custom', () => 'a')
    /** Mutable caller tuple must not remain the host's tuple. */
    const routing = [policy]
    /** DSL takes a snapshot while keeping the policy's private authority. */
    const host = defineTrayHost({ name: 'co', plugins, exposes: [], routing })
    routing.length = 0
    expect(host.routing).toEqual([policy])
    expect(Object.isFrozen(host.routing)).toBe(true)
  })

  it.each(['roundRobin', 'leastInFlight', 'name', 'constructor', 'a-b', 'Upper'])(
    'rejects invalid routing namespace name %s',
    (name) => {
      expect(() => defineRoutingPolicy(name, () => 'a')).toThrowError(
        expect.objectContaining({ code: TrayErrorCode.routingInvalid })
      )
    }
  )

  it('preserves native binary and rejects object undefined through the portable owner', () => {
    /** Native binary must remain binary before rpc selects its transport encoding. */
    const bytes = new Uint8Array([1, 2])
    expect(toWire({ bytes })).toEqual({ bytes })
    expect(toWire(undefined)).toBeUndefined()
    expect(() => toWire({ value: undefined })).toThrowError(
      expect.objectContaining({ code: TrayErrorCode.valueNotPortable, cause: expect.any(Error) })
    )
  })
})
