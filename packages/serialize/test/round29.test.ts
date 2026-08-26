import { describe, expect, it } from 'vitest'
import {
  SerializeCodecError,
  collectStream,
  createSerializeRegistry,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeParser,
  type ITextEncoder
} from '../src/index.js'
import { composeSerializeSignal } from '../src/signal.js'

const plugin = (output: ISerializeChunk | readonly ISerializeChunk[]) => ({
  type: 'round29',
  parser: {
    name: 'round29',
    encode: () => output,
    decode: (chunk: ISerializeChunk) => chunk
  } satisfies ISerializeParser
})

const mixedOutput = (): readonly ISerializeChunk[] => [
  ['bytes', new Uint8Array([1, 2])],
  ['text', 'tail']
]

describe('Round29 serialize boundaries', () => {
  it('SER-T29-01 uses pre-aborted snapshot state without rereading raw aborted', async () => {
    const reason = new Error('pre-aborted')
    let abortedReads = 0
    const signal = {} as Record<PropertyKey, unknown>
    Object.defineProperties(signal, {
      aborted: {
        get: () => {
          abortedReads += 1
          if (abortedReads === 1) return true
          throw new Error('aborted getter reread')
        }
      },
      reason: { value: reason },
      addEventListener: { value: () => {} },
      removeEventListener: { value: () => {} }
    })
    const registry = createSerializeRegistry([plugin(['text', 'ignored'] as const)])

    const error = await registry
      .encode('value', { signal: signal as unknown as ISerializeAbortSignal })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'ABORTED',
      cause: reason
    })
    expect((error as { readonly cause?: unknown }).cause).toBe(reason)
    expect(abortedReads).toBe(1)
  })

  it('SER-T29-02 preserves registration recheck while wrapping a hostile second aborted read', async () => {
    const getterCause = new Error('dynamic aborted getter failed')
    let getterReads = 0
    const hostileSignal = {} as Record<PropertyKey, unknown>
    Object.defineProperties(hostileSignal, {
      aborted: {
        get: () => {
          getterReads += 1
          if (getterReads === 1) return false
          throw getterCause
        }
      },
      addEventListener: { value: () => {} },
      removeEventListener: { value: () => {} }
    })
    const hostileRegistry = createSerializeRegistry([plugin(['text', 'unused'] as const)])
    const hostileError = await hostileRegistry
      .encode('value', { signal: hostileSignal as unknown as ISerializeAbortSignal })
      .catch((caught: unknown) => caught)

    expect(hostileError).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause: getterCause
    })
    expect(getterReads).toBe(2)

    const reason = new Error('registration race')
    let aborted = false
    let abortedReads = 0
    let removeCalls = 0
    const caller: ISerializeAbortSignal = {
      get aborted() {
        abortedReads += 1
        if (abortedReads > 3) throw new Error('aborted getter escaped')
        return aborted
      },
      reason,
      addEventListener() {
        aborted = true
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

    expect(composed.signal.aborted).toBe(true)
    expect(composed.signal.reason).toBe(reason)
    expect(removeCalls).toBe(1)
    expect(abortedReads).toBe(3)
  })

  it('SER-T29-03 maps registry encoder call failure with receiver, index, progress, and cause', async () => {
    const cause = new Error('encoder call failed')
    const encoder = {
      prefix: 'receiver',
      encode(this: { prefix: string }, _input: string): Uint8Array {
        expect(this.prefix).toBe('receiver')
        throw cause
      }
    } as ITextEncoder & { readonly prefix: string }
    const registry = createSerializeRegistry([plugin(mixedOutput())], { encoder })

    const error = await registry.encode('value').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'ENCODE_FAILED',
      type: 'round29',
      chunkIndex: 1,
      bytesConsumed: 2,
      cause
    })
    expect((error as { readonly cause?: unknown }).cause).toBe(cause)
  })

  it('SER-T29-04 maps registry encoder hostile return to INVALID_CHUNK without partial output', async () => {
    const hostileReturn = { byteLength: 99 }
    const encoder = {
      encode: () => hostileReturn as never
    } satisfies ITextEncoder
    const registry = createSerializeRegistry([plugin(mixedOutput())], { encoder })

    const error = await registry.encode('value').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_CHUNK',
      chunkIndex: 1,
      bytesConsumed: 2,
      cause: hostileReturn
    })
    expect((error as { readonly cause?: unknown }).cause).toBe(hostileReturn)
  })

  it('SER-T29-05 maps registry encoder method getter failure to INVALID_OPTION', () => {
    const cause = new Error('registry encoder method getter failed')
    const encoder = {} as Record<PropertyKey, unknown>
    Object.defineProperty(encoder, 'encode', {
      get: () => throwError(cause)
    })

    expect(() =>
      createSerializeRegistry([plugin(['text', 'unused'] as const)], {
        encoder: encoder as ITextEncoder
      })
    ).toThrowError(
      expect.objectContaining({
        source: '@migaia/serialize',
        code: 'INVALID_OPTION',
        cause
      })
    )
  })

  it('SER-T29-06 maps collectStream encoder getter, call, and hostile return failures', async () => {
    type IEncoderFailureScenario = {
      readonly name: string
      readonly cause: unknown
      readonly makeEncoder: (cause: unknown) => ITextEncoder
      readonly code: 'ENCODE_FAILED' | 'INVALID_CHUNK'
    }
    const scenarios = [
      {
        name: 'getter',
        cause: new Error('encoder method getter failed'),
        makeEncoder: (cause: unknown) => {
          const encoder = {} as Record<PropertyKey, unknown>
          Object.defineProperty(encoder, 'encode', {
            get: () => throwError(cause as Error)
          })
          return encoder as ITextEncoder
        },
        code: 'ENCODE_FAILED'
      },
      {
        name: 'call',
        cause: new Error('encoder call failed'),
        makeEncoder: (cause: unknown) =>
          ({
            encode(this: { encode: unknown }): never {
              expect(this.encode).toBeTypeOf('function')
              return throwError(cause as Error)
            }
          }) as ITextEncoder,
        code: 'ENCODE_FAILED'
      },
      {
        name: 'return',
        cause: { byteLength: 12 },
        makeEncoder: (cause: unknown) => ({ encode: () => cause as never }) as ITextEncoder,
        code: 'INVALID_CHUNK'
      }
    ] satisfies readonly IEncoderFailureScenario[]

    for (const scenario of scenarios) {
      const error = await collectStream(
        (async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['bytes', new Uint8Array([7, 8])]
          yield ['text', 'tail']
        })(),
        scenario.makeEncoder(scenario.cause)
      ).catch((caught: unknown) => caught)

      expect(error, scenario.name).toBeInstanceOf(SerializeCodecError)
      expect(error, scenario.name).toMatchObject({
        source: '@migaia/serialize',
        code: scenario.code,
        type: 'stream',
        phase: 'encode',
        context: 'stream',
        chunkIndex: 1,
        bytesConsumed: 2,
        cause: scenario.cause
      })
    }
  })

  it('SER-T29-07 preserves valid encoder receiver and output in mixed collection', async () => {
    const encoder = {
      prefix: 'ok',
      encode(this: { prefix: string }, input: string): Uint8Array {
        expect(this.prefix).toBe('ok')
        return new TextEncoder().encode(input)
      }
    } as ITextEncoder & { readonly prefix: string }
    const result = await collectStream(
      (async function* (): AsyncGenerator<ISerializeChunk> {
        yield ['text', 'head']
        yield ['bytes', new Uint8Array([1])]
        yield ['text', 'tail']
      })(),
      encoder
    )

    expect(result).toEqual([
      'bytes',
      new Uint8Array([...new TextEncoder().encode('head'), 1, ...new TextEncoder().encode('tail')])
    ])
  })
})

const throwError = <T>(error: Error): T => {
  throw error
}
