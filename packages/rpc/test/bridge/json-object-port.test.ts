import { describe, expect, it, vi } from 'vitest'
import { bridgeFixture, flush, request, peerFrame } from './fixture.js'
import { objectFixtureEndpoint, objectDeepValue } from './json-object-fixture.js'
import {
  jsonObjectCodec,
  materializeJsonSnapshot
} from '../../src/bridge/jsonrpc/object-pipeline.js'
import { remoteProcessJsonCodec } from '../../src/process/pipeline.js'
import { readJsonObjectPort } from '../../src/core/internal/json-object-port.js'
import { rpcProtocolV1, type IRpcEnvelope } from '../../src/contract/index.js'
import { defineFeature } from '../../src/core/feature.js'
import { authentication } from '../../src/core/middleware/authentication.js'

/** Capture the thrown instance without replacing its native type or cause graph. */
function thrown(operation: () => unknown): unknown {
  try {
    operation()
  } catch (error) {
    return error
  }
  throw new Error('fixture expected a failure')
}

describe('I21 C2 object port contracts', () => {
  it('[EQ2] counts physical conversions and rejects internal roundtrips in default and fallback', async () => {
    for (const fallback of [false, true]) {
      /** Ready channels keep hello and control JSON outside the business counter window. */
      const fixture = bridgeFixture()
      /** Only the fixture's synchronous outbound peer decode is excluded from production totals. */
      let fixtureJson = false
      const channel = await fixture.open({
        byte: {
          ...fixture.raw,
          write: (chunk) => {
            fixtureJson = true
            try {
              return fixture.raw.write(chunk)
            } finally {
              fixtureJson = false
            }
          }
        }
      })
      const endpoint = await objectFixtureEndpoint(channel, { fallback })
      /** Freeze peer bytes before spies; inbound production parse runs with fixtureJson false. */
      const responseBytes = peerFrame({ jsonrpc: '2.0', id: 'TASK:client:i21-0', result: [2] })
      /** Bound originals prevent the test's spy from recursively instrumenting itself. */
      const parse = JSON.parse
      const stringify = JSON.stringify
      /** Total production counts catch roundtrips of any valid subtree, including plain payloads. */
      const counts = {
        productionStringify: 0,
        productionParse: 0,
        physicalStringify: 0,
        physicalParse: 0,
        internalStringify: 0,
        internalParse: 0
      }
      const stringifySpy = vi
        .spyOn(JSON, 'stringify')
        .mockImplementation((value, replacer, space) => {
          if (!fixtureJson) counts.productionStringify++
          if (!fixtureJson && (value?.kind === 'request' || value?.kind === 'response'))
            counts.internalStringify++
          if (!fixtureJson && value?.jsonrpc === '2.0' && value?.method === 'migaia.invoke')
            counts.physicalStringify++
          return stringify(value, replacer as never, space)
        })
      const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
        if (!fixtureJson) counts.productionParse++
        if (!fixtureJson && text.includes('"kind"')) counts.internalParse++
        else if (!fixtureJson && text.includes('"result"')) counts.physicalParse++
        return parse(text, reviver)
      })
      try {
        const pending = endpoint.send('peer', 'p.f.request', [1], { timeoutMs: 100 })
        await flush()
        expect(fixture.messages.at(-1)!.id).toBe('TASK:client:i21-0')
        fixture.bytes(responseBytes)
        await expect(pending).resolves.toEqual([2])
        expect(counts).toEqual({
          // Two canonical safeTupleKey calls preserve existing identity bookkeeping in both paths.
          productionStringify: fallback ? 5 : 3,
          productionParse: fallback ? 3 : 1,
          physicalStringify: 1,
          physicalParse: 1,
          internalStringify: fallback ? 2 : 0,
          internalParse: fallback ? 2 : 0
        })
      } finally {
        stringifySpy.mockRestore()
        parseSpy.mockRestore()
        await endpoint.dispose()
        await channel.close()
      }
    }
  })

  it('[EQ1/EQ3] preserves materialization, getters, first error and original cause identity', () => {
    /** Getter observation begins in the same outer source-codec admission stage on either path. */
    let reads = 0
    const cause = new AggregateError([new RangeError('original')], 'original aggregate')
    const input = Object.defineProperty({}, 'data', {
      enumerable: true,
      get: () => {
        reads++
        throw cause
      }
    })
    expect(thrown(() => remoteProcessJsonCodec.encode(input))).toBe(cause)
    expect(reads).toBe(1)
    reads = 0
    expect(thrown(() => jsonObjectCodec.encode(input as IRpcEnvelope))).toBe(cause)
    expect(reads).toBe(1)
    expect((cause.errors[0] as Error).stack).toContain('RangeError: original')
    /** Input rejection keeps the canonical native error code/text at the same layer. */
    for (const value of [NaN, Infinity, undefined, new Date(0), new Map(), [undefined]]) {
      const publicError = thrown(() => remoteProcessJsonCodec.encode(value)) as Error
      const privateError = thrown(() =>
        jsonObjectCodec.encode(value as unknown as IRpcEnvelope)
      ) as Error
      expect(privateError).toBeInstanceOf(TypeError)
      expect(privateError).toMatchObject({
        name: publicError.name,
        message: publicError.message,
        source: (publicError as Error & { source: string }).source,
        code: (publicError as Error & { code: string }).code
      })
      expect(privateError.stack?.length).toBeGreaterThan(0)
    }
    /** Validated snapshots contain only data; copies reproduce JSON's key/prototype/alias rules. */
    const shared = Object.freeze({ z: -0, a: 2 })
    const snapshot = Object.freeze(
      Object.assign(Object.create(null), { '10': true, '2': false, z: shared, a: shared })
    )
    const protoSnapshot = Object.freeze(
      Object.defineProperty({}, '__proto__', { value: shared, enumerable: true })
    )
    const result = materializeJsonSnapshot(snapshot) as Record<string, Record<string, unknown>>
    expect(result).toEqual(JSON.parse(JSON.stringify(snapshot)))
    expect(Object.keys(result)).toEqual(['2', '10', 'z', 'a'])
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.is(result.z!.z, -0)).toBe(false)
    expect(result.z).not.toBe(result.a)
    expect(result.z).not.toBe(shared)
    const protoResult = materializeJsonSnapshot(protoSnapshot) as Record<string, unknown>
    expect(Object.getOwnPropertyDescriptor(protoResult, '__proto__')?.value).toEqual({ z: 0, a: 2 })
    expect(Object.getPrototypeOf(protoResult)).toBe(Object.prototype)
  })

  it.each([false, true])('[EQ2/M08] preserves legitimate reads (Proxy=%s)', (proxy) => {
    /** Each codec gets a fresh input so observed values depend only on its own access order. */
    const observe = (encode: (value: unknown) => unknown) => {
      /** Changing legal return values expose extra reads even when every value stays portable. */
      let nextValue = 0
      /** The original outer admission uses insertion order; portable projection sorts keys. */
      const reads: string[] = []
      /** User-visible access side effects must occur twice per key, never during materialization. */
      const read = (key: string): number => {
        reads.push(key)
        return ++nextValue
      }
      /** Both supported inputs enumerate z before a and return legal numbers on every read. */
      const input = proxy
        ? new Proxy(
            { z: 0, a: 0 },
            {
              get: (target, key, receiver) =>
                key === 'z' || key === 'a' ? read(key) : Reflect.get(target, key, receiver)
            }
          )
        : Object.defineProperties(
            {},
            {
              z: { enumerable: true, get: () => read('z') },
              a: { enumerable: true, get: () => read('a') }
            }
          )
      /** Encode first, then read only the returned data snapshot while retaining input counts. */
      const result = encode(input)
      return { reads, nextValue, result }
    }
    /** This unchanged public owner supplies the pre-C2 validation/projection baseline. */
    const baseline = observe((value) => JSON.parse(remoteProcessJsonCodec.encode(value) as string))
    expect(baseline).toEqual({
      reads: ['z', 'a', 'a', 'z'],
      nextValue: 4,
      result: { a: 3, z: 4 }
    })
    /** A second outer asCodecValue call changes both access order/count and retained values. */
    const candidate = observe((value) => jsonObjectCodec.encode(value as IRpcEnvelope))
    expect(candidate).toEqual(baseline)
  })

  it('[EQ1/EQ6] materializes a raw incoming negative zero before canonical core normalization', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const endpoint = await objectFixtureEndpoint(channel)
    try {
      const pending = endpoint.send('peer', 'p.f.request', [], { timeoutMs: 100 })
      await flush()
      const text = `{"jsonrpc":"2.0","id":${JSON.stringify(fixture.messages.at(-1)!.id)},"result":{"z":-0,"a":1}}`
      fixture.bytes(Buffer.from(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`))
      const result = (await pending) as Record<string, unknown>
      expect(Object.is(result.z, -0)).toBe(false)
      expect(Object.keys(result)).toEqual(['z', 'a'])
      expect(Object.getPrototypeOf(result)).toBeNull()
      expect(Object.isFrozen(result)).toBe(true)
    } finally {
      await endpoint.dispose()
      await channel.close()
    }
  })

  it('[EQ2/EQ6] keeps custom authentication, connect callbacks and unknown Features on string', async () => {
    for (const mode of ['authentication', 'connect', 'feature'] as const) {
      const fixture = bridgeFixture()
      const channel = await fixture.open()
      const observed: unknown[] = []
      const endpoint = await objectFixtureEndpoint(channel, {
        ...(mode === 'connect'
          ? {
              connect: {
                receiverSelector: (context) => {
                  observed.push(context)
                  return 'peer'
                }
              }
            }
          : {}),
        ...(mode === 'feature' ? { features: [defineFeature(() => Object.freeze({}))] } : {}),
        ...(mode === 'authentication'
          ? {
              middlewares: [
                authentication({
                  encodedType: 'string',
                  encrypt: (value) => {
                    observed.push(value)
                    return value
                  },
                  decrypt: (value) => {
                    observed.push(value)
                    return value
                  }
                })
              ]
            }
          : {})
      })
      const spy = vi.spyOn(JSON, 'stringify')
      try {
        const pending = endpoint.send('peer', 'p.f.request', [], { timeoutMs: 100 })
        await flush()
        fixture.deliver({ jsonrpc: '2.0', id: fixture.messages.at(-1)!.id, result: 'ok' })
        await expect(pending).resolves.toBe('ok')
        expect(spy.mock.calls.filter(([value]) => value?.kind === 'request')).toHaveLength(1)
        if (mode === 'authentication')
          expect(observed.map((value) => typeof value)).toEqual(['string', 'string'])
      } finally {
        spy.mockRestore()
        await endpoint.dispose()
        await channel.close()
      }
    }
  })

  it('[EQ2/EQ6] retains public send/subscribe, per-listener order and close capability release', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const port = readJsonObjectPort(
      channel.transport,
      rpcProtocolV1,
      channel.pipeline.codec,
      channel.pipeline.framer
    )!
    expect(port).toBeDefined()
    expect(
      readJsonObjectPort(
        { ...channel.transport },
        rpcProtocolV1,
        channel.pipeline.codec,
        channel.pipeline.framer
      )
    ).toBeUndefined()
    const order: string[] = []
    const privateValues: unknown[] = []
    channel.transport.subscribe((message) => {
      order.push('public')
      expect(typeof message.data).toBe('string')
    })
    const unsubscribe = port.subscribe((message) => {
      order.push('private')
      privateValues.push(message.data)
    })
    await port.send(port.codec.encode(request('mixed')), {})
    fixture.deliver({ jsonrpc: '2.0', id: 'mixed', result: { z: 1 } })
    expect(order).toEqual(['public', 'private'])
    expect(privateValues).toHaveLength(1)
    unsubscribe()
    await expect(channel.transport.send({})).rejects.toMatchObject({
      name: 'TypeError',
      code: 'JSONRPC_PROFILE_INVALID'
    })
    await expect(
      channel.transport.send(JSON.stringify(request('transfer')), { transfer: [{}] })
    ).rejects.toMatchObject({ code: 'JSONRPC_PROFILE_INVALID' })
    const closing = channel.close()
    expect(channel.close()).toBe(closing)
    await closing
    expect(
      readJsonObjectPort(
        channel.transport,
        rpcProtocolV1,
        channel.pipeline.codec,
        channel.pipeline.framer
      )
    ).toBeUndefined()
    expect(fixture.closes).toBe(1)
  })

  it('[EQ2/EQ5] rejects super-limit portable depth at the same normalization owner before writing', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const port = readJsonObjectPort(
      channel.transport,
      rpcProtocolV1,
      channel.pipeline.codec,
      channel.pipeline.framer
    )!
    const envelope = request('deep')
    const deep = { ...envelope, data: { ...envelope.data, payload: [objectDeepValue(65)] } }
    let publicError: unknown
    let privateError: unknown
    try {
      await channel.transport.send(remoteProcessJsonCodec.encode(deep))
    } catch (error) {
      publicError = error
    }
    try {
      await port.send(port.codec.encode(deep as IRpcEnvelope))
    } catch (error) {
      privateError = error
    }
    expect(publicError).toBeInstanceOf(TypeError)
    expect(privateError).toMatchObject({
      name: (publicError as Error).name,
      message: (publicError as Error).message,
      source: (publicError as { source: string }).source,
      code: (publicError as { code: string }).code
    })
    expect(fixture.messages).toHaveLength(1)
    await channel.close()
  })
})
