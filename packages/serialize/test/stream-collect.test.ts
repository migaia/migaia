import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SerializeCodecError,
  chunkToText,
  collectStream,
  createSerializeRegistry,
  decodeStream,
  encodeStream,
  jsonPlugin,
  type ISerializeChunk
} from '../src/index.ts'

import { rows, immediateYield, scheduler } from './fixtures/stream.ts'

describe('decodeStream 与 collectStream', () => {
  it('round-trips a stream slice by slice', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry, rows(500), {
      initialItems: 100,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      chunks.push(chunk)
    }

    const restored: { id: number }[] = []
    for await (const slice of decodeStream(registry, chunks)) {
      restored.push(...(slice as { id: number }[]))
    }
    expect(restored).toHaveLength(500)
    expect(restored[499].id).toBe(499)
    await registry.dispose()
  })

  it('reports which chunk failed to decode', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = [
      ['text', '[{"id":1}]'],
      ['text', '{ broken']
    ]
    const run = async () => {
      for await (const _value of decodeStream(registry, chunks)) {
        void _value
      }
    }
    const error = await run().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SerializeCodecError)
    expect((error as SerializeCodecError).chunkIndex).toBe(1)
    await registry.dispose()
  })

  it('merges a stream back into one chunk when a full blob is required', async () => {
    const encoder = new TextEncoder()
    async function* mixed(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'AB']
      yield ['bytes', encoder.encode('CD')]
      yield ['text', 'EF']
    }
    expect(chunkToText(await collectStream(mixed(), encoder), new TextDecoder())).toBe('ABCDEF')

    async function* textOnly(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'a']
      yield ['text', 'b']
    }
    expect(await collectStream(textOnly())).toEqual(['text', 'ab'])

    async function* empty(): AsyncGenerator<ISerializeChunk> {}
    expect(await collectStream(empty())).toEqual(['text', ''])
  })

  it('captures one encoder accessor and preserves its receiver', async () => {
    let getterReads = 0
    let receiver: unknown
    const encoder = {
      get encode() {
        getterReads += 1
        return function (this: unknown, input: string): Uint8Array {
          // oxlint-disable-next-line typescript/no-this-alias
          receiver = this
          return new TextEncoder().encode(input)
        }
      }
    }
    async function* mixed(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'A']
      yield ['bytes', new Uint8Array([66])]
    }

    expect(chunkToText(await collectStream(mixed(), encoder), new TextDecoder())).toBe('AB')
    expect(getterReads).toBe(1)
    expect(receiver).toBe(encoder)
  })

  it('keeps stream protocol calls on captured receivers without forwarding helpers', () => {
    /** Collection owns seven direct protocol invocations after the responsibility split. */
    const source = readFileSync(new URL('../src/stream-collection.ts', import.meta.url), 'utf8')
    /** Scheduling owns five receiver-preserving capability calls. */
    const schedulerSource = readFileSync(
      new URL('../src/stream-scheduler.ts', import.meta.url),
      'utf8'
    )
    /** Ignore formatting only; every target, receiver and argument remains an exact assertion. */
    const compactSource = source.replace(/\s/g, '')
    /** Scheduler assertions retain all five original host receiver boundaries. */
    const compactScheduler = schedulerSource.replace(/\s/g, '')
    expect(source).toContain('Captured encoder receiver boundary')
    expect(source).not.toContain('invokeCollectEncoderWithReceiver')
    expect(source.match(/Reflect\.apply/g)).toHaveLength(7)
    expect(schedulerSource.match(/Reflect\.apply/g)).toHaveLength(5)
    expect((source + schedulerSource).match(/Reflect\.apply/g)).toHaveLength(12)
    expect(compactSource).toContain(
      'Reflect.apply(methodasISerializeInvokable<Uint8Array>,receiver,[input])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(asyncFactoryasISerializeInvokable<AsyncIterator<ISerializeChunk>>,candidateasobject,[])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(nextasISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,sourceIteratorasobject,[])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(closeasISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,sourceIteratorasobject,[])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(syncFactoryasISerializeInvokable<Iterator<ISerializeChunk>>,candidateasobject,[])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(nextasISerializeInvokable<IteratorResult<ISerializeChunk>>,sourceIteratorasobject,[])'
    )
    expect(compactSource).toContain(
      'Reflect.apply(closeasISerializeInvokable<IteratorResult<ISerializeChunk>>,sourceIteratorasobject,[])'
    )
    expect(compactScheduler).toContain('Reflect.apply(this.#cancel,this.#receiver,[])')
    expect(compactScheduler).toContain('Reflect.apply(this.#now,this.#receiver,[])')
    expect(compactScheduler).toContain(
      'Reflect.apply(this.#schedule,this.#receiver,[callback,delayMs])'
    )
    expect(compactScheduler).toContain(
      "Reflect.apply(this.#addAbortListener,signal,['abort',this.#onAbort,{once:true}])"
    )
    expect(compactScheduler).toContain(
      "Reflect.apply(this.#removeAbortListener,this.#signal,['abort',this.#onAbort])"
    )
  })

  it('refuses to merge a value chunk into a wire stream', async () => {
    async function* withValue(): AsyncGenerator<ISerializeChunk> {
      yield ['value', { a: 1 }]
    }
    await expect(collectStream(withValue())).rejects.toThrow('cannot collect a value chunk')
  })

  it('wraps hostile async and sync iterator protocol failures for decode and collect', async () => {
    type IProtocolScenario = {
      readonly name: string
      readonly cause: Error
      readonly make: () => unknown
      readonly cleanupCalls: { value: number }
      readonly expectedCleanup: number
    }
    const scenarios: IProtocolScenario[] = []
    const addGetterScenario = (
      name: string,
      key: typeof Symbol.asyncIterator | typeof Symbol.iterator
    ) => {
      const cause = new Error(`${name} getter failed`)
      const cleanupCalls = { value: 0 }
      scenarios.push({
        name,
        cause,
        cleanupCalls,
        expectedCleanup: 0,
        make: () => {
          const source: Record<PropertyKey, unknown> = {}
          Object.defineProperty(source, key, {
            get: () => {
              throw cause
            }
          })
          return source
        }
      })
    }

    addGetterScenario('async iterator', Symbol.asyncIterator)
    addGetterScenario('sync iterator', Symbol.iterator)
    for (const name of ['next', 'done', 'value', 'thenable'] as const) {
      const kinds =
        name === 'thenable' ? [Symbol.asyncIterator] : [Symbol.asyncIterator, Symbol.iterator]
      for (const kind of kinds) {
        const cause = new Error(
          `${name}-${kind === Symbol.asyncIterator ? 'async' : 'sync'} failed`
        )
        const cleanupCalls = { value: 0 }
        scenarios.push({
          name: `${name}-${kind === Symbol.asyncIterator ? 'async' : 'sync'}`,
          cause,
          cleanupCalls,
          expectedCleanup: kind === Symbol.asyncIterator ? 1 : 2,
          make: () => ({
            [kind]() {
              return {
                next: () => {
                  if (name === 'next') throw cause
                  if (name === 'done')
                    return {
                      get done() {
                        throw cause
                      }
                    }
                  if (name === 'value')
                    return {
                      done: false,
                      get value() {
                        throw cause
                      }
                    }
                  return {
                    // oxlint-disable-next-line unicorn/no-thenable -- hostile protocol fixture.
                    then: () => {
                      throw cause
                    }
                  }
                },
                return: () => {
                  cleanupCalls.value += 1
                  return { done: true, value: undefined }
                }
              }
            }
          })
        })
      }
    }

    for (const scenario of scenarios) {
      const decodeRegistry = createSerializeRegistry([jsonPlugin()])
      const decodeError = await decodeStream(decodeRegistry, scenario.make() as never, {
        type: 'json',
        context: 'hostile-protocol'
      })
        .next()
        .catch((error: unknown) => error)
      expect(decodeError, scenario.name).toBeInstanceOf(SerializeCodecError)
      expect((decodeError as { readonly cause?: unknown }).cause, scenario.name).toBe(
        scenario.cause
      )
      expect(decodeError, scenario.name).toMatchObject({
        source: 'serialization',
        code: 'DECODE_FAILED',
        phase: 'decode',
        type: 'json',
        context: 'hostile-protocol',
        chunkIndex: 0,
        cause: scenario.cause
      })
      await decodeRegistry.dispose()

      const collectError = await collectStream(scenario.make() as never).catch(
        (error: unknown) => error
      )
      expect(collectError, scenario.name).toBeInstanceOf(SerializeCodecError)
      expect(collectError, scenario.name).toMatchObject({
        source: 'serialization',
        code: 'ENCODE_FAILED',
        phase: 'encode',
        type: 'stream',
        context: 'stream',
        chunkIndex: 0,
        cause: scenario.cause
      })
      expect(scenario.cleanupCalls.value, scenario.name).toBe(scenario.expectedCleanup)
    }
  })
})
