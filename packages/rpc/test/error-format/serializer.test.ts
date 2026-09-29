import { describe, expect, it } from 'vitest'
import {
  normalizeRpcSerializedError,
  reachRpcError,
  RpcWireErrorFallback,
  serializeRpcError
} from '../../src/contract/index.js'

/** Count one linked edge without relying on a native error subclass. */
function chainLength(root: { readonly cause?: unknown } | undefined): number {
  let count = 0
  let current: unknown = root
  while (current && typeof current === 'object') {
    count += 1
    current = (current as { readonly cause?: unknown }).cause
  }
  return count
}

describe('wire error serializer', () => {
  it('keeps cause, ordered aggregate children, and cleanup children distinct', () => {
    const primary = new Error('root', { cause: new TypeError('cause') }) as Error & {
      cleanupErrors?: readonly { resource: string; error: Error }[]
      errors?: readonly Error[]
    }
    primary.errors = [new RangeError('a'), new SyntaxError('b')]
    primary.cleanupErrors = [{ resource: 'r', error: new Error('cleanup') }]
    const reports: unknown[] = []
    const wire = serializeRpcError(primary, {
      report: (failure) => {
        reports.push(failure)
      }
    })
    expect(wire.cause?.message).toBe('cause')
    expect(wire.errors?.map((child) => child.message)).toEqual(['a', 'b', 'cleanup'])
    expect(reports).toEqual([])
    expect(Object.isFrozen(wire)).toBe(true)
    expect(Object.isFrozen(wire.errors)).toBe(true)
    expect(Object.isFrozen(wire.errors?.[0])).toBe(true)
    expect(normalizeRpcSerializedError(wire)).toEqual(wire)
  })

  it('truncates cause and errors paths at their JSON nesting limits', () => {
    let cause: Error = new Error('last')
    for (let index = 0; index < 59; index += 1) cause = new Error('next', { cause })
    const wire = serializeRpcError(cause, { report: () => {} })
    expect(chainLength(wire)).toBe(48)
    let terminal: typeof wire = wire
    while (terminal.cause) terminal = terminal.cause
    expect(terminal.truncated).toBe(true)
    let errors: Error = new Error('last')
    for (let index = 0; index < 31; index += 1) {
      const parent = new Error('next') as Error & { errors?: readonly Error[] }
      parent.errors = [errors]
      errors = parent
    }
    let errorsWire = serializeRpcError(errors, { report: () => {} })
    let count = 1
    while (errorsWire.errors) {
      count += 1
      errorsWire = errorsWire.errors[0]!
    }
    expect(count).toBe(24)
    expect(errorsWire.truncated).toBe(true)
    expect(Object.hasOwn(errorsWire, 'errors')).toBe(false)
  })

  it('enforces node count, cycle omission, and shared-subtree duplication', () => {
    const wide = new Error('wide') as Error & { errors?: Error[] }
    wide.errors = Array.from({ length: 1100 }, (_, index) => {
      const child = new Error(String(index))
      child.stack = 'x'
      return child
    })
    const wire = serializeRpcError(wide, { report: () => {} })
    expect(wire.errors).toHaveLength(1023)
    expect(wire.truncated).toBe(true)
    const cyclic = new Error('cycle') as Error & { cause?: unknown }
    cyclic.cause = cyclic
    const cycleWire = serializeRpcError(cyclic, { report: () => {} })
    expect(cycleWire.cause).toBeUndefined()
    expect(cycleWire.truncated).toBe(true)
    const shared = new Error('shared')
    const root = new Error('root', { cause: shared }) as Error & { errors?: Error[] }
    root.errors = [shared]
    const sharedWire = serializeRpcError(root, { report: () => {} })
    expect(sharedWire.cause).toEqual(sharedWire.errors?.[0])
    expect(sharedWire.cause).not.toBe(sharedWire.errors?.[0])
  })

  it('omits deep or over-budget data and reports only failed projections', () => {
    let deep: unknown = 'x'
    for (let index = 0; index < 60; index += 1) deep = [deep]
    const root = new Error('root') as Error & { data?: unknown }
    root.data = deep
    const failures: unknown[] = []
    const projected = serializeRpcError(root, {
      report: (failure) => {
        failures.push(failure)
      }
    })
    expect(projected.data).toBeUndefined()
    expect(projected.truncated).toBe(true)
    expect(failures).toMatchObject([{ field: 'data', error: { code: 'INVALID_ENVELOPE' } }])
    root.data = 'x'.repeat(65_537)
    const reduced = serializeRpcError(root, {
      report: (failure) => {
        failures.push(failure)
      }
    })
    expect(reduced.data).toBeUndefined()
    expect(reduced.truncated).toBe(true)
    expect(failures).toHaveLength(1)
  })

  it('truncates text on scalar boundaries and admits only the fitting child prefix', () => {
    const long = new Error('long')
    long.stack = '😀'.repeat(20_000)
    const wire = serializeRpcError(long, { report: () => {} })
    expect(new TextEncoder().encode(wire.stack).length).toBe(65_536)
    expect(wire.truncated).toBe(true)
    const siblings = new Error('root') as Error & { errors?: Error[] }
    siblings.errors = Array.from({ length: 20 }, () => {
      const child = new Error('x'.repeat(65_536))
      child.stack = 'y'.repeat(65_536)
      return child
    })
    const projected = serializeRpcError(siblings, { report: () => {} })
    expect(projected.errors).toHaveLength(7)
    expect(projected.truncated).toBe(true)
    expect(normalizeRpcSerializedError(projected)).toEqual(projected)
  })

  it('uses portable data for non-Error values without invoking stringifiers', () => {
    let stringified = 0
    const plain = {
      reason: 1,
      toString() {
        stringified += 1
        return 'unused'
      }
    }
    const reports: unknown[] = []
    const wire = serializeRpcError(plain, {
      report: (failure) => {
        reports.push(failure)
      }
    })
    expect(wire.message).toBe(RpcWireErrorFallback.nonErrorMessage)
    expect(wire.data).toBeUndefined()
    expect(wire.truncated).toBe(true)
    expect(stringified).toBe(0)
    expect(reports).toMatchObject([{ field: 'data' }])
    expect(serializeRpcError('text', { report: () => {} }).data).toBeUndefined()
    expect(serializeRpcError(null, { report: () => {} }).data).toBeNull()
    expect(serializeRpcError(undefined, { report: () => {} }).data).toBeUndefined()
    expect(serializeRpcError(2, { report: () => {} }).data).toBe(2)
  })

  it('reads hostile fields once, reports their exact thrown values, and preserves reentrancy', () => {
    const failure = new Error('getter')
    let reads = 0
    const reports: unknown[] = []
    const hostile = {
      get name(): never {
        reads += 1
        throw failure
      },
      get message() {
        serializeRpcError('inner', { report: () => {} })
        return 'outer'
      },
      stack: 'Error: outer',
      value: 1
    }
    const wire = serializeRpcError(hostile, {
      report: (item) => {
        reports.push(item)
      }
    })
    expect(reads).toBe(1)
    expect(wire.name).toBe('Error')
    expect(wire.data).toMatchObject({ message: 'outer', stack: 'Error: outer', value: 1 })
    expect(reports).toMatchObject([{ field: 'name', error: failure }])
    expect(() =>
      serializeRpcError(hostile, {
        report: () => {
          throw failure
        }
      })
    ).toThrow(failure)
  })

  it('reaches all distinct objects beyond the old depth limit and visits cleanup errors', () => {
    let deep: Error = new Error('last')
    const last = deep
    for (let index = 0; index < 60; index += 1) deep = new Error('next', { cause: deep })
    const root = deep as Error & { cleanupErrors?: readonly { error: Error }[] }
    const cleanup = new Error('cleanup')
    root.cleanupErrors = [{ error: cleanup }]
    const reached = [...reachRpcError(root, { report: () => {} })]
    expect(reached).toHaveLength(62)
    expect(reached).toContain(last)
    expect(reached).toContain(cleanup)
  })
})
