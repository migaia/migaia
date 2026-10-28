import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import {
  createSerializeRegistry,
  type ISerializeChunk,
  type ISerializeParser,
  type ISerializePlugin
} from '../src/index.ts'

import { plugin } from './fixtures/registry.ts'

describe('构造 fail-fast + close/dispose', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scheduler 结构非法 → TypeError + INVALID_OPTION（参数错误，非 SerializeCodecError）', () => {
    try {
      createSerializeRegistry([plugin('a')], { scheduler: {} as never })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({ code: 'INVALID_OPTION', source: 'serialization' })
    }
  })

  it('encoder 缺失 → ENV_UNSUPPORTED（能力缺失，非 TypeError）', () => {
    vi.stubGlobal('TextEncoder', undefined)
    try {
      createSerializeRegistry([plugin('a')])
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'ENV_UNSUPPORTED', source: 'serialization' })
    }
  })

  it('注入 encoder/decoder 时不依赖宿主 Encoding API', () => {
    vi.stubGlobal('TextEncoder', undefined)
    vi.stubGlobal('TextDecoder', undefined)
    const registry = createSerializeRegistry([plugin('a')], {
      encoder: { encode: () => new Uint8Array() },
      decoder: { decode: () => '' }
    })
    expect(registry.has('a')).toBe(true)
  })

  it('close() 幂等且拒绝新请求，不释放 parser', () => {
    let disposed = false
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          disposed = true
        }
      })
    ])
    registry.close()
    registry.close()
    expect(() => registry.encode('x')).rejects.toThrow(/disposed/)
    expect(disposed).toBe(false)
  })

  /**
   * This one lifecycle proves construction-time capture survives later mutation and disposal.
   * Splitting its shared getter counters or receivers into separate cases would no longer prove
   * that the exact same registry never rereads the original options after construction.
   */
  it('registry options 构造期单读、捕获 receiver，后续 mutation 与 dispose 不再读 options', async () => {
    const manual = createManualScheduler()
    const schedulerOption = {} as Record<PropertyKey, unknown>
    const encoderOption = {} as Record<PropertyKey, unknown>
    const decoderOption = {} as Record<PropertyKey, unknown>
    const options = {} as Record<PropertyKey, unknown>
    const reads = new Map<PropertyKey, number>()
    const count = (key: PropertyKey): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1)
    }
    let schedulerReceiver = false
    let encoderReceiver = false
    let reportReceiver = false
    let timeoutReceiver = false
    let reportCalls = 0
    let timeoutCalls = 0
    let rejectPending: ((reason: unknown) => void) | undefined

    const schedulerNow = function (this: object): number {
      schedulerReceiver = this === schedulerOption
      return manual.now()
    }
    const schedulerSchedule = function (
      this: object,
      callback: () => void,
      delayMs: number
    ): { cancel(): void } {
      schedulerReceiver = schedulerReceiver && this === schedulerOption
      return manual.schedule(callback, delayMs)
    }
    Object.defineProperties(schedulerOption, {
      now: {
        configurable: true,
        get: () => {
          count('scheduler.now')
          return schedulerNow
        }
      },
      schedule: {
        configurable: true,
        get: () => {
          count('scheduler.schedule')
          return schedulerSchedule
        }
      }
    })

    const encoderMethod = function (this: object, input: string): Uint8Array {
      encoderReceiver = this === encoderOption
      return Uint8Array.from(input, (character) => character.charCodeAt(0))
    }
    Object.defineProperty(encoderOption, 'encode', {
      configurable: true,
      get: () => {
        count('encoder.encode')
        return encoderMethod
      }
    })
    Object.defineProperty(decoderOption, 'decode', {
      configurable: true,
      get: () => {
        count('decoder.decode')
        return function (this: object, input: Uint8Array): string {
          expect(this).toBe(decoderOption)
          return String.fromCharCode(...input)
        }
      }
    })

    const reportMethod = function (this: object): void {
      reportReceiver = this === options
      reportCalls += 1
    }
    const timeoutMethod = function (this: object): void {
      timeoutReceiver = this === options
      timeoutCalls += 1
    }
    Object.defineProperties(options, {
      scheduler: {
        configurable: true,
        get: () => {
          count('options.scheduler')
          return schedulerOption
        }
      },
      encoder: {
        configurable: true,
        get: () => {
          count('options.encoder')
          return encoderOption
        }
      },
      decoder: {
        configurable: true,
        get: () => {
          count('options.decoder')
          return decoderOption
        }
      },
      report: {
        configurable: true,
        get: () => {
          count('options.report')
          return reportMethod
        }
      },
      onDrainTimeout: {
        configurable: true,
        get: () => {
          count('options.onDrainTimeout')
          return timeoutMethod
        }
      },
      cleanup: {
        configurable: true,
        get: () => {
          count('options.cleanup')
          return { policy: 'throw' }
        }
      }
    })

    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (value) => {
            if (value === 'pending')
              return new Promise<ISerializeChunk>((_, reject) => {
                rejectPending = reject
              })
            return [
              ['text', 'x'],
              ['bytes', new Uint8Array([1])]
            ] as unknown as ISerializeChunk
          },
          decode: (chunk) => chunk
        })
      ],
      options as never
    )

    Object.defineProperties(schedulerOption, {
      now: { configurable: true, value: () => -1 },
      schedule: {
        configurable: true,
        value: () => {
          throw new Error('scheduler was reread')
        }
      }
    })
    Object.defineProperty(encoderOption, 'encode', {
      configurable: true,
      value: () => new Uint8Array([99])
    })
    Object.defineProperties(options, {
      report: {
        configurable: true,
        get: () => {
          throw new Error('report option was reread')
        }
      },
      onDrainTimeout: {
        configurable: true,
        get: () => {
          throw new Error('onDrainTimeout option was reread')
        }
      }
    })

    await expect(registry.encode('value')).resolves.toEqual(['bytes', new Uint8Array([120, 1])])
    const pending = registry.encode('pending').catch(() => undefined)
    const disposing = registry.dispose({ deadlineAt: 100 })
    manual.advance(100)
    await disposing
    rejectPending?.(new Error('late parser rejection'))
    await pending
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(reads.get('options.scheduler')).toBe(1)
    expect(reads.get('options.encoder')).toBe(1)
    expect(reads.get('options.decoder')).toBe(1)
    expect(reads.get('options.report')).toBe(1)
    expect(reads.get('options.onDrainTimeout')).toBe(1)
    expect(reads.get('options.cleanup')).toBe(1)
    expect(reads.get('scheduler.now')).toBe(1)
    expect(reads.get('scheduler.schedule')).toBe(1)
    expect(reads.get('encoder.encode')).toBe(1)
    expect(reads.get('decoder.decode')).toBe(1)
    expect(schedulerReceiver).toBe(true)
    expect(encoderReceiver).toBe(true)
    expect(reportReceiver).toBe(true)
    expect(timeoutReceiver).toBe(true)
    expect(reportCalls).toBe(1)
    expect(timeoutCalls).toBe(1)
  })

  it('hostile/invalid registry options fail fast as serialize INVALID_OPTION with cause', () => {
    const schedulerCause = new Error('scheduler option getter boom')
    const schedulerOptions = {
      get scheduler() {
        throw schedulerCause
      }
    }
    expect(() => createSerializeRegistry([plugin('a')], schedulerOptions as never)).toThrowError(
      expect.objectContaining({
        source: 'serialization',
        code: 'INVALID_OPTION',
        cause: schedulerCause
      })
    )

    const timeoutCause = new Error('timeout option getter boom')
    let parserDisposeCalls = 0
    const timeoutOptions = {
      get onDrainTimeout() {
        throw timeoutCause
      }
    }
    expect(() =>
      createSerializeRegistry(
        [
          plugin('a', {
            name: 'a',
            encode: (value) => ['text', String(value)],
            decode: (chunk) => chunk,
            dispose: () => {
              parserDisposeCalls += 1
            }
          })
        ],
        timeoutOptions as never
      )
    ).toThrowError(
      expect.objectContaining({
        source: 'serialization',
        code: 'INVALID_OPTION',
        cause: timeoutCause
      })
    )
    expect(parserDisposeCalls).toBe(0)

    for (const invalid of [
      { encoder: { encode: 1 } },
      { decoder: { decode: 1 } },
      { report: 'not-a-function' },
      { onDrainTimeout: 'not-a-function' }
    ]) {
      expect(() => createSerializeRegistry([plugin('a')], invalid as never)).toThrowError(
        expect.objectContaining({
          source: 'serialization',
          code: 'INVALID_OPTION'
        })
      )
    }
  })
})

describe('createSerializeRegistry：构造校验', () => {
  it('拒绝空插件数组', () => {
    expect(() => createSerializeRegistry([])).toThrow(RangeError)
  })

  it('拒绝重复的 type', () => {
    expect(() => createSerializeRegistry([plugin('a'), plugin('a')])).toThrow(
      /duplicate serialize plugin type/
    )
  })

  it('同一个 parser 绑定多个 type 时只释放一次', async () => {
    let disposeCount = 0
    const sharedParser: ISerializeParser = {
      name: 'shared',
      encode: (value) => ['value', value],
      decode: (chunk) => chunk[1],
      dispose: () => {
        disposeCount += 1
      }
    }
    const registry = createSerializeRegistry([plugin('a', sharedParser), plugin('b', sharedParser)])
    await registry.dispose()
    expect(disposeCount).toBe(1)
  })

  it('构造阶段只读取 plugin/parser 方法一次，并固定每个方法的 receiver', async () => {
    let typeReads = 0
    let parserReads = 0
    let encodeReads = 0
    let decodeReads = 0
    let disposeReads = 0
    let encodeReceiverMatched = false
    let decodeReceiverMatched = false
    let disposeReceiverMatched = false
    let firstDisposeCalls = 0
    let replacementDisposeCalls = 0
    const parser = { name: 'snapshot-parser' } as Record<PropertyKey, unknown>
    const encodeMethod = function (this: object, value: unknown): ISerializeChunk {
      encodeReceiverMatched = this === parser
      return ['text', String(value)]
    }
    const decodeMethod = function (this: object, chunk: ISerializeChunk): unknown {
      decodeReceiverMatched = this === parser
      return chunk[1]
    }
    const firstDispose = function (this: object): void {
      disposeReceiverMatched = this === parser
      firstDisposeCalls += 1
    }
    const replacementDispose = (): void => {
      replacementDisposeCalls += 1
    }
    Object.defineProperties(parser, {
      encode: {
        configurable: true,
        get: () => {
          encodeReads += 1
          return encodeMethod
        }
      },
      decode: {
        configurable: true,
        get: () => {
          decodeReads += 1
          return decodeMethod
        }
      },
      dispose: {
        configurable: true,
        get: () => {
          disposeReads += 1
          return firstDispose
        }
      }
    })
    const plugin = {} as Record<PropertyKey, unknown>
    Object.defineProperties(plugin, {
      type: {
        configurable: true,
        get: () => {
          typeReads += 1
          return 'snapshot'
        }
      },
      parser: {
        configurable: true,
        get: () => {
          parserReads += 1
          return parser
        }
      }
    })

    const registry = createSerializeRegistry([plugin as unknown as ISerializePlugin])
    Object.defineProperty(parser, 'dispose', {
      configurable: true,
      value: replacementDispose,
      writable: true
    })

    await expect(registry.encode('value')).resolves.toEqual(['text', 'value'])
    await expect(registry.decode(['text', 'decoded'])).resolves.toBe('decoded')
    await registry.dispose()

    expect(typeReads).toBe(1)
    expect(parserReads).toBe(1)
    expect(encodeReads).toBe(1)
    expect(decodeReads).toBe(1)
    expect(disposeReads).toBe(1)
    expect(encodeReceiverMatched).toBe(true)
    expect(decodeReceiverMatched).toBe(true)
    expect(disposeReceiverMatched).toBe(true)
    expect(firstDisposeCalls).toBe(1)
    expect(replacementDisposeCalls).toBe(0)
  })

  it('同一 parser 绑定多个 type 时方法 getter 也只读取一次', async () => {
    let encodeReads = 0
    let decodeReads = 0
    let disposeReads = 0
    let disposeCalls = 0
    const parser = { name: 'shared-snapshot' } as Record<PropertyKey, unknown>
    Object.defineProperties(parser, {
      encode: {
        configurable: true,
        get: () => {
          encodeReads += 1
          return (value: unknown): ISerializeChunk => ['text', String(value)]
        }
      },
      decode: {
        configurable: true,
        get: () => {
          decodeReads += 1
          return (chunk: ISerializeChunk): unknown => chunk[1]
        }
      },
      dispose: {
        configurable: true,
        get: () => {
          disposeReads += 1
          return (): void => {
            disposeCalls += 1
          }
        }
      }
    })
    const registry = createSerializeRegistry([
      plugin('a', parser as unknown as ISerializeParser),
      plugin('b', parser as unknown as ISerializeParser)
    ])

    await expect(registry.encode('value', { type: 'b' })).resolves.toEqual(['text', 'value'])
    await registry.dispose()

    expect(encodeReads).toBe(1)
    expect(decodeReads).toBe(1)
    expect(disposeReads).toBe(1)
    expect(disposeCalls).toBe(1)
  })

  it('拒绝不合法的 type 字符集（会写进 HTML 属性/存档头分隔字段）', () => {
    for (const bad of ['', 'A B', 'a|b', 'a"b', 'a>b', '-leading-dash']) {
      expect(() => createSerializeRegistry([plugin(bad)]), bad).toThrow(RangeError)
    }
  })

  it('primaryType 取第一个插件的 type，types 列出全部已注册 type', () => {
    const registry = createSerializeRegistry([plugin('a'), plugin('b')])
    expect(registry.primaryType).toBe('a')
    expect(registry.types).toEqual(['a', 'b'])
    expect(registry.has('a')).toBe(true)
    expect(registry.has('missing')).toBe(false)
  })

  it('重复 type 时在 own 之前就失败，不运行任何 parser disposer（校验先于 own）', () => {
    let firstDisposed = false
    const registry = () =>
      createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            firstDisposed = true
          }
        }),
        plugin('a') // 重复 type：校验先于 own，直接失败，不触碰第 1 个 parser 的 dispose
      ])
    expect(registry).toThrow(RangeError)
    expect(firstDisposed).toBe(false)
  })

  it('重复 type 直接抛 duplicate 错误，第一个 parser 的 dispose 从未运行（校验先于 own，无回滚路径）', () => {
    let disposerRan = false
    let caught: unknown
    try {
      createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            disposerRan = true
          }
        }),
        plugin('a') // 重复 type → 构造失败
      ])
      throw new Error('unreachable')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RangeError)
    expect((caught as Error).message).toContain('duplicate serialize plugin type')
    expect(disposerRan).toBe(false)
  })
})
