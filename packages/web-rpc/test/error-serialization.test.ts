import { describe, expect, it } from 'vitest'
import {
  deserializeError,
  reachError,
  serializeError,
  WebRpcErrorCode,
  WebRpcLifecycleError,
  WebRpcSerializationError,
  WEBRPC_SOURCE,
  type ISerializedError
} from '../src'
import { deserializeErrorFromRpc, serializeErrorForRpc } from '../src/error-serialization.js'

describe('cross-realm error serialization', () => {
  it('reaches cause, cleanupErrors and AggregateError entries (E-T3)', () => {
    const root = new Error('root')
    const cleanup = new Error('cleanup')
    const error = new WebRpcLifecycleError('lifecycle', root, [
      { resource: 'middleware', error: cleanup }
    ])
    const withCleanup = [...reachError(error)]
    expect(withCleanup.some((entry) => entry === root)).toBe(true)
    expect(withCleanup.some((entry) => entry === cleanup)).toBe(true)

    const first = new Error('first')
    const second = new Error('second')
    const aggregate = new AggregateError([first, second], 'aggregate')
    const wrapped = new WebRpcLifecycleError('lifecycle2', aggregate, [])
    const reached = [...reachError(wrapped)]
    expect(reached.some((entry) => entry === aggregate)).toBe(true)
    expect(reached.some((entry) => entry === first)).toBe(true)
    expect(reached.some((entry) => entry === second)).toBe(true)
  })

  it('round-trips (source, code, name, message, stack, causes) losslessly (E-T4)', () => {
    const root = new Error('root')
    const cleanup = new Error('cleanup')
    const error = new WebRpcLifecycleError('lifecycle failed', root, [
      { resource: 'middleware', error: cleanup }
    ])
    const serialized = serializeError(error)
    expect(serialized.source).toBe(WEBRPC_SOURCE)
    expect(serialized.code).toBe('ENDPOINT_DISPOSED')
    expect(serialized.name).toBe('WebRpcLifecycleError')
    expect(serialized.causes?.map((entry) => entry.message)).toEqual(['root', 'cleanup'])

    const restored = deserializeError(serialized)
    expect(restored.name).toBe('WebRpcLifecycleError')
    expect(restored.message).toBe('lifecycle failed')
    expect(restored.stack).toBe(serialized.stack)
    expect(serializeError(restored)).toEqual(serialized)
  })

  it('preserves an AbortError name so callers can still branch on it (E-T4)', () => {
    const abort = new DOMException('aborted', 'AbortError')
    const serialized = serializeError(abort)
    expect(serialized.name).toBe('AbortError')
    const restored = deserializeError(serialized)
    expect(restored.name).toBe('AbortError')
    expect(restored).toBeInstanceOf(DOMException)
  })

  it('restores native error constructors and AggregateError children', () => {
    for (const original of [new TypeError('type'), new RangeError('range')]) {
      const restored = deserializeError(serializeError(original))
      expect(restored.constructor).toBe(original.constructor)
      expect(restored.message).toBe(original.message)
    }
    const original = new AggregateError([new TypeError('first'), new RangeError('second')], 'many')
    const restored = deserializeError(serializeError(original))
    expect(restored).toBeInstanceOf(AggregateError)
    expect((restored as AggregateError).errors.map((entry) => entry.constructor.name)).toEqual([
      'TypeError',
      'RangeError'
    ])
    expect(serializeError(restored)).toEqual(serializeError(original))
  })

  it('rebuilds AggregateError child causes without duplicating flattened causes', () => {
    const child = Object.assign(new Error('child'), { cause: new Error('inner') })
    const serialized = serializeError(new AggregateError([child], 'agg'))

    expect(serialized.causes?.map((entry) => entry.message)).toEqual(['child', 'inner'])
    expect(serializeError(deserializeError(structuredClone(serialized)))).toEqual(serialized)
  })

  it('projects the legacy bounded graph to RPC without losing linear causes or AggregateError arity', () => {
    const leaf = new TypeError('leaf')
    const middle = new Error('middle', { cause: leaf })
    const aggregate = new AggregateError([middle, new RangeError('sibling')], 'aggregate')
    const root = new Error('root', { cause: aggregate })

    const wire = serializeErrorForRpc(root)
    const restored = deserializeErrorFromRpc(wire)

    expect(wire.cause?.name).toBe('AggregateError')
    expect(wire.cause?.errors).toHaveLength(2)
    expect([...reachError(restored)].map((entry) => (entry as Error).message)).toEqual(
      expect.arrayContaining(['root', 'aggregate', 'middle', 'leaf', 'sibling'])
    )
    expect((restored.cause as AggregateError).errors ?? []).toHaveLength(2)
    expect((restored.cause as AggregateError).errors[0]?.cause).toMatchObject({
      name: 'TypeError',
      message: leaf.message,
      stack: leaf.stack
    })
  })

  it('keeps AggregateError own cause separate from child cause graph', () => {
    const child = Object.assign(new Error('child'), { cause: new Error('inner') })
    const aggregate = Object.assign(new AggregateError([child], 'agg'), {
      cause: new Error('aggregate cause')
    })
    const serialized = serializeError(aggregate)
    const restored = deserializeError(structuredClone(serialized))

    expect((restored as AggregateError).errors[0]?.cause?.message).toBe('inner')
    expect((restored.cause as Error | undefined)?.message).toBe('aggregate cause')
    expect(serializeError(restored)).toEqual(serialized)
  })

  it('preserves aggregate child cleanup traversal order', () => {
    const child = Object.assign(new Error('child'), {
      cause: new Error('inner'),
      cleanupErrors: [{ resource: 'child', error: new Error('cleanup') }]
    })
    const serialized = serializeError(new AggregateError([child], 'agg'))
    const restored = deserializeError(structuredClone(serialized))

    expect(serialized.causes?.map((entry) => entry.message)).toEqual(['child', 'inner', 'cleanup'])
    expect(serializeError(restored).causes?.map((entry) => entry.message)).toEqual([
      'child',
      'inner',
      'cleanup'
    ])
    expect((restored as AggregateError).errors[0]?.cause?.message).toBe('inner')
  })

  it('terminates on a self-cyclic AggregateError.errors graph', () => {
    const aggregate = new AggregateError([], 'cycle')
    aggregate.errors.push(aggregate)

    const serialized = serializeError(aggregate)

    expect(serialized.errors).toHaveLength(1)
    expect(serialized.errors?.[0].errors).toEqual([])
  })

  it.each(['causes', 'errors'] as const)('rejects cyclic serialized %s graphs', (key) => {
    const serialized = {
      source: 'peer',
      code: 'REMOTE',
      name: 'Error',
      message: 'cycle'
    } as ISerializedError
    ;(serialized as Record<string, unknown>)[key] = [serialized]

    expect(() => deserializeError(serialized)).toThrowError(
      expect.objectContaining({ code: WebRpcErrorCode.payloadInvalid })
    )
  })

  it('rejects serialized graphs deeper than the safety budget', () => {
    let serialized: ISerializedError = {
      source: 'peer',
      code: 'REMOTE',
      name: 'Error',
      message: 'deep'
    }
    for (let index = 0; index < 65; index++) {
      serialized = {
        source: 'peer',
        code: 'REMOTE',
        name: 'Error',
        message: 'deep',
        causes: [serialized]
      }
    }

    expect(() => deserializeError(serialized)).toThrowError(
      expect.objectContaining({ code: WebRpcErrorCode.payloadInvalid })
    )
  })

  it('does not fabricate a receiver stack when serialized stack is absent', () => {
    const restored = deserializeError({
      source: 'peer',
      code: 'REMOTE',
      name: 'Error',
      message: 'no stack'
    })

    expect(restored.stack).toBeUndefined()
  })

  it('rejects a wide source graph with the existing bounded payload error', () => {
    const aggregate = new AggregateError(
      Array.from({ length: 5000 }, (_, index) => new Error(`child-${index}`)),
      'wide'
    )

    expect(() => serializeError(aggregate)).toThrowError(
      expect.objectContaining({
        code: WebRpcErrorCode.payloadInvalid,
        message: 'Serialized error graph exceeds safety limits or is malformed'
      })
    )
  })

  it('contains hostile aggregate discrimination traps in a coded boundary error', () => {
    const attackerError = new Error('getPrototypeOf trap')
    const hostile = new Proxy(new AggregateError([], 'hostile'), {
      getPrototypeOf() {
        throw attackerError
      }
    })

    expect(() => serializeError(hostile)).toThrowError(
      expect.objectContaining({
        constructor: WebRpcSerializationError,
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.payloadInvalid,
        cause: attackerError
      })
    )
  })

  it('contains native AggregateError.errors getter failures with the original cause', () => {
    const attackerError = new Error('errors getter trap')
    const hostile = new AggregateError([], 'hostile')
    Object.defineProperty(hostile, 'errors', {
      configurable: true,
      get() {
        throw attackerError
      }
    })

    expect(() => serializeError(hostile)).toThrowError(
      expect.objectContaining({
        constructor: WebRpcSerializationError,
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.payloadInvalid,
        cause: attackerError
      })
    )
  })

  it('contains revoked source cleanupErrors arrays with the original cause', () => {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()
    const hostile = new WebRpcLifecycleError('hostile cleanup', undefined, [])
    Object.defineProperty(hostile, 'cleanupErrors', { value: proxy })

    let thrown: unknown
    try {
      serializeError(hostile)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      constructor: WebRpcSerializationError,
      code: WebRpcErrorCode.payloadInvalid
    })
    expect((thrown as WebRpcSerializationError).cause).toBeInstanceOf(TypeError)
  })

  it.each(['causes', 'errors'] as const)(
    'contains revoked wire %s arrays with the original cause',
    (key) => {
      const { proxy, revoke } = Proxy.revocable([], {})
      revoke()
      const serialized = {
        source: 'peer',
        code: 'REMOTE',
        name: 'Error',
        message: 'hostile'
      } as Record<string, unknown>
      serialized[key] = proxy

      let thrown: unknown
      try {
        deserializeError(serialized as ISerializedError)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({
        constructor: WebRpcSerializationError,
        code: WebRpcErrorCode.payloadInvalid
      })
      expect((thrown as WebRpcSerializationError).cause).toBeInstanceOf(TypeError)
    }
  )

  it.each(['length', 'index'] as const)('contains revoked array %s traps', (trap) => {
    const attackerError = new Error(`revoked ${trap} trap`)
    const source: unknown[] = [new Error('child')]
    const hostile = new Proxy(source, {
      get(_target, property) {
        if ((trap === 'length' && property === 'length') || (trap === 'index' && property === '0'))
          throw attackerError
        return (source as unknown as Record<PropertyKey, unknown>)[property]
      }
    })
    const error = new WebRpcLifecycleError('hostile array', undefined, [])
    Object.defineProperty(error, 'cleanupErrors', { value: hostile })

    expect(() => serializeError(error)).toThrowError(
      expect.objectContaining({
        constructor: WebRpcSerializationError,
        code: WebRpcErrorCode.payloadInvalid,
        cause: attackerError
      })
    )
  })

  it('contains arbitrary proxy prototype traps with the same coded policy', () => {
    const attackerError = new Error('arbitrary getPrototypeOf trap')
    const hostile = new Proxy(
      { message: 'leaf' },
      {
        getPrototypeOf() {
          throw attackerError
        }
      }
    )

    expect(() => serializeError(hostile)).toThrowError(
      expect.objectContaining({
        constructor: WebRpcSerializationError,
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.payloadInvalid,
        cause: attackerError
      })
    )
  })

  it('snapshots hostile serialized causes exactly once before reconstruction', () => {
    let causesReads = 0
    const child: ISerializedError = {
      source: 'peer',
      code: 'REMOTE',
      name: 'Error',
      message: 'child'
    }
    const serialized = {
      source: 'peer',
      code: 'REMOTE',
      name: 'Error',
      message: 'root',
      get causes() {
        causesReads++
        return [child]
      }
    } as ISerializedError

    const restored = deserializeError(serialized)

    expect(causesReads).toBe(1)
    expect((restored.cause as Error | undefined)?.message).toBe('child')
  })
})
