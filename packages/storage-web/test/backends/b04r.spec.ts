import { describe, expect, it } from 'vitest'
import { isPlainObject } from '@migaia/utils/object'
import { utf8ByteLength } from '@migaia/utils/bytes'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'
import { memoryStorage } from '../../src/backends/memory.js'
import { safeJsonPayloadByteLength } from '../../src/utils/json.js'

/** B04R causal probes for the shared lifecycle and JSON-domain owners. */
describe('SWV4-B04R owner convergence', () => {
  it('keeps one controller lease across publication until disposal drains', async () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const changes: unknown[] = []
    const unsubscribe = controller.subscribe((change) => changes.push(change))
    const release = controller.beginMutation()
    const disposal = controller.dispose()

    expect(() => controller.beginMutation()).toThrowError('DISPOSED')
    controller.publish({ channel: 'value', kind: 'put', keys: ['during-commit'] })
    release()
    await disposal
    await Promise.resolve()
    expect(changes).toHaveLength(1)
    controller.publish({ channel: 'value', kind: 'put', keys: ['after-dispose'] })
    await Promise.resolve()
    expect(changes).toHaveLength(1)
    unsubscribe()
  })

  it('uses exact UTF-8 JSON size and fails closed for hostile serialization', () => {
    expect(safeJsonPayloadByteLength({ text: 'CJK-💡' })).toBe(
      utf8ByteLength(JSON.stringify({ text: 'CJK-💡' }))
    )
    expect(safeJsonPayloadByteLength(undefined)).toBe(0)

    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(safeJsonPayloadByteLength(cyclic)).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength(1n)).toBe(Number.MAX_SAFE_INTEGER)

    let getterReads = 0
    const hostile = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        getterReads += 1
        throw new Error('hostile getter')
      }
    })
    expect(safeJsonPayloadByteLength(hostile)).toBe(Number.MAX_SAFE_INTEGER)
    expect(getterReads).toBe(1)

    let toJsonReads = 0
    const toJsonValue = {
      toJSON: () => {
        toJsonReads += 1
        return { value: 'normalized' }
      }
    }
    expect(safeJsonPayloadByteLength(toJsonValue)).toBe(
      utf8ByteLength(JSON.stringify({ value: 'normalized' }))
    )
    expect(toJsonReads).toBe(1)

    let hostileToJsonReads = 0
    const hostileToJson = {
      toJSON: () => {
        hostileToJsonReads += 1
        throw new Error('hostile toJSON')
      }
    }
    expect(safeJsonPayloadByteLength(hostileToJson)).toBe(Number.MAX_SAFE_INTEGER)
    expect(hostileToJsonReads).toBe(1)

    const jsonValues: readonly unknown[] = [null, true, 42, 'text', [1, '二'], { nested: '💡' }]
    for (const jsonValue of jsonValues)
      expect(safeJsonPayloadByteLength(jsonValue)).toBe(utf8ByteLength(JSON.stringify(jsonValue)))

    const structuredCloneValues: readonly unknown[] = [
      new Map([['key', 'value']]),
      new Set(['value']),
      new ArrayBuffer(4),
      new Uint8Array([1, 2, 3])
    ]
    for (const structuredCloneValue of structuredCloneValues)
      expect(safeJsonPayloadByteLength(structuredCloneValue)).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength({ nested: new Map([['key', 'value']]) })).toBe(
      Number.MAX_SAFE_INTEGER
    )
    expect(safeJsonPayloadByteLength({ nested: new Set(['value']) })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength({ nested: new ArrayBuffer(4) })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength({ nested: new Uint8Array([1, 2, 3]) })).toBe(
      Number.MAX_SAFE_INTEGER
    )
    expect(safeJsonPayloadByteLength({ nested: undefined })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength([undefined])).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('reuses canonical plain-object admission and rejects custom prototypes', () => {
    expect(isPlainObject({ value: 1 })).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
    expect(isPlainObject(Object.create({ inherited: true }))).toBe(false)
    expect(isPlainObject([])).toBe(false)
  })
})
