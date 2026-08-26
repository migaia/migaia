import { describe, expect, it } from 'vitest'
import {
  collectStream,
  createSerializeRegistry,
  decodeStream,
  encodeStream,
  jsonPlugin,
  type ISerializeChunk
} from '../src/index.js'

const scheduler = {
  now: () => 0,
  schedule: (callback: () => void) => {
    callback()
    return { cancel() {} }
  }
}

const immediateYield = async (): Promise<void> => {}

describe('Round25 serialize boundaries', () => {
  it('SER-T25-01 rejects every malformed collectStream chunk as INVALID_CHUNK at its index', async () => {
    const malformed: readonly unknown[] = [
      null,
      [],
      ['text'],
      ['unknown', 'payload'],
      ['text', 1],
      ['bytes', 'payload']
    ]

    for (const chunk of malformed) {
      const error = await collectStream(
        (async function* (): AsyncGenerator<unknown> {
          yield ['bytes', new Uint8Array([1, 2])]
          yield chunk
        })() as never
      ).catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        source: '@migaia/serialize',
        code: 'INVALID_CHUNK',
        phase: 'encode',
        type: 'stream',
        context: 'stream',
        chunkIndex: 1,
        bytesConsumed: 2
      })
    }
  })

  it('SER-T25-02 rejects value chunks with INVALID_CHUNK at the value index', async () => {
    const error = await collectStream(
      (async function* (): AsyncGenerator<ISerializeChunk> {
        yield ['text', 'ok']
        yield ['value', { ignored: true }]
      })()
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_CHUNK',
      chunkIndex: 1,
      bytesConsumed: 0
    })
  })

  it('SER-T25-03 snapshots encode options once before slice or registry side effects', async () => {
    const reads = new Map<string, number>()
    const count = (key: string): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1)
    }
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    }
    const options = {
      get targetMs() {
        count('targetMs')
        return 8
      },
      get minItems() {
        count('minItems')
        return 1
      },
      get maxItems() {
        count('maxItems')
        return 1
      },
      get initialItems() {
        count('initialItems')
        return 1
      },
      get yieldTo() {
        count('yieldTo')
        return immediateYield
      },
      get signal() {
        count('signal')
        return signal
      },
      get scheduler() {
        count('scheduler')
        return scheduler
      },
      get type() {
        count('type')
        return 'json'
      },
      get context() {
        count('context')
        return 'round25'
      },
      get maxInFlight() {
        count('maxInFlight')
        return 1
      }
    }
    const encodeCalls: unknown[] = []
    const registry = createSerializeRegistry([
      {
        type: 'json',
        parser: {
          name: 'round25',
          encode(value) {
            encodeCalls.push(value)
            return ['text', JSON.stringify(value)] as const
          },
          decode: () => undefined
        }
      }
    ])

    const output: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry, [{ id: 1 }, { id: 2 }], options as never)) {
      output.push(chunk)
    }

    expect(output).toHaveLength(2)
    expect(encodeCalls).toHaveLength(2)
    for (const key of [
      'targetMs',
      'minItems',
      'maxItems',
      'initialItems',
      'yieldTo',
      'signal',
      'scheduler',
      'type',
      'context',
      'maxInFlight'
    ]) {
      expect(reads.get(key), key).toBe(1)
    }
    await registry.dispose()
  })

  it('SER-T25-04 snapshots decode options before touching the input iterator', async () => {
    let sourceReads = 0
    const options = {
      get type() {
        throw new Error('decode type getter failed')
      },
      get context() {
        sourceReads += 1
        return 'unexpected'
      },
      get signal() {
        sourceReads += 1
        return undefined
      }
    }
    const chunks = {
      get [Symbol.asyncIterator]() {
        sourceReads += 1
        throw new Error('source iterator must not be read')
      }
    }

    const error = await decodeStream(
      { primaryType: 'json' } as never,
      chunks as never,
      options as never
    )
      .next()
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause: expect.objectContaining({ message: 'decode type getter failed' })
    })
    expect(sourceReads).toBe(0)
  })

  it('SER-T25-05 keeps malformed encode options inside INVALID_OPTION before registry calls', async () => {
    let encodeCalls = 0
    const cause = new Error('encode scheduler getter failed')
    const registry = {
      primaryType: 'json',
      encode: async () => {
        encodeCalls += 1
        return ['text', 'unexpected'] as const
      }
    }
    const error = await encodeStream(registry as never, ['value'], {
      get scheduler() {
        throw cause
      }
    } as never)
      .next()
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ source: '@migaia/serialize', code: 'INVALID_OPTION', cause })
    expect(encodeCalls).toBe(0)
  })

  it('SER-T25-06 keeps valid decode stream behavior after option admission', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const reads = { type: 0, context: 0, signal: 0 }
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {}
    }
    const options = {
      get type() {
        reads.type += 1
        return 'json'
      },
      get context() {
        reads.context += 1
        return 'round25'
      },
      get signal() {
        reads.signal += 1
        return signal
      }
    }
    const values: unknown[] = []
    for await (const value of decodeStream(
      registry,
      [
        ['text', '1'],
        ['text', '2']
      ],
      options as never
    )) {
      values.push(value)
    }
    expect(values).toEqual([1, 2])
    expect(reads).toEqual({ type: 1, context: 1, signal: 1 })
    await registry.dispose()
  })
})
