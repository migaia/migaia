import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'

const memory = new WebAssembly.Memory({ initial: 1 })
const allocations = new Map<number, number>()
let nextId = 1
let nextPtr = 8
let failNextPointer = false

vi.mock('@migaia/wasm', () => ({
  default: async () => ({ memory }),
  alloc_bytes: (byteLength: number) => {
    const id = nextId++
    const ptr = nextPtr
    nextPtr += Math.max(8, (byteLength + 7) & ~7)
    allocations.set(id, ptr)
    // Native alloc_bytes returns zeroed owned storage, including when an address is reused.
    new Uint8Array(memory.buffer, ptr, byteLength).fill(0)
    return id
  },
  dealloc_bytes: (id: number) => allocations.delete(id),
  ptr_of: (id: number) => {
    if (failNextPointer) {
      failNextPointer = false
      return 0
    }
    return allocations.get(id) ?? 0
  }
}))

import { allocateSync, ensureWasm } from '../src/arena.js'
import { array } from '../src/array.js'
import { boolean } from '../src/boolean.js'
import { number } from '../src/number.js'
import { record } from '../src/record.js'
import { string } from '../src/string.js'
import { StoreWasmErrorCode } from '../src/error-code.js'

function source(dispose: () => void = () => undefined) {
  return {
    track: () => undefined,
    notify: () => undefined,
    observed: false,
    commit: <T>(write: () => T): T => write(),
    disposed: false,
    dispose
  }
}

function context(createSource: () => ReturnType<typeof source>) {
  return {
    runtime: createRuntime(),
    signal: new AbortController().signal,
    createSource
  }
}

describe('Round 7 transactional correction', () => {
  beforeEach(async () => {
    allocations.clear()
    nextId = 1
    nextPtr = 8
    failNextPointer = false
    await ensureWasm()
  })

  it('refreshes scalar and array views after growth while keeping snapshot copies isolated', async () => {
    const ctx = context(() => source())
    const numeric = await number().create(ctx)
    const flag = await boolean().create(ctx)
    const text = await string(32).create(ctx)
    const position = await record({ x: number() }).create(ctx)
    const items = await array(2).create(ctx)
    numeric.value = 11
    flag.value = true
    text.value = 'before'
    position.x = 13
    items.setAt(0, 17)
    const snapshot = items.view()
    snapshot[0] = 999
    memory.grow(1)
    expect([numeric.value, flag.value, text.value, position.x, items.at(0)]).toEqual([
      11,
      true,
      'before',
      13,
      17
    ])
    numeric.value = 19
    flag.value = false
    text.value = 'after'
    position.x = 23
    items.setAt(0, 29)
    expect([numeric.value, flag.value, text.value, position.x, items.at(0)]).toEqual([
      19,
      false,
      'after',
      23,
      29
    ])
    for (const field of [numeric, flag, text, position, items]) field.dispose()
  })

  it('refreshes a scalar view when the commit owner grows memory before writing', async () => {
    const ctx = context(() => ({
      ...source(),
      commit: <T>(write: () => T): T => {
        memory.grow(1)
        return write()
      }
    }))
    const numeric = await number().create(ctx)
    const flag = await boolean().create(ctx)
    const position = await record({ x: number() }).create(ctx)
    numeric.value = 19
    flag.value = true
    position.x = 23
    expect([numeric.value, flag.value, position.x]).toEqual([19, true, 23])
    for (const field of [numeric, flag, position]) field.dispose()
  })

  it('rolls back a newly allocated id when ptr_of returns no pointer', () => {
    failNextPointer = true
    expect(() => allocateSync(8)).toThrowError(
      expect.objectContaining({
        source: '@migaia/store-wasm',
        code: StoreWasmErrorCode.allocationFailed
      })
    )
    expect(allocations.size).toBe(0)
  })

  it('undoes every earlier bucket write when a later range commit fails', async () => {
    const failure = new Error('second bucket rejected')
    let commits = 0
    const field = await array(4, 2).create({
      runtime: createRuntime(),
      signal: new AbortController().signal,
      createSource: () => ({
        ...source(),
        commit<T>(write: () => T): T {
          commits++
          if (commits === 2) throw failure
          return write()
        }
      })
    })

    expect(() => field.setRange(0, 4, [1, 2, 3, 4])).toThrow(failure)
    expect(Array.from(field.view())).toEqual([0, 0, 0, 0])
    field.dispose()
  })

  it('makes every scalar field terminal after cleanup even when a source fails', async () => {
    const cleanupFailure = new Error('source cleanup failed')
    const fields = [
      await number().create(
        context(() =>
          source(() => {
            throw cleanupFailure
          })
        )
      ),
      await boolean().create(
        context(() =>
          source(() => {
            throw cleanupFailure
          })
        )
      ),
      await string(16).create(
        context(() =>
          source(() => {
            throw cleanupFailure
          })
        )
      )
    ]

    for (const field of fields) {
      expect(() => field.dispose()).toThrow(cleanupFailure)
      expect(field.disposed).toBe(true)
      expect(() => field.value).toThrowError(
        expect.objectContaining({ code: StoreWasmErrorCode.fieldDisposed })
      )
      expect(() => field.dispose()).not.toThrow()
    }

    const arrayField = await array(2).create(
      context(() =>
        source(() => {
          throw cleanupFailure
        })
      )
    )
    arrayField.at(0)
    expect(() => arrayField.dispose()).toThrow(cleanupFailure)
    expect(arrayField.disposed).toBe(true)
    expect(() => arrayField.at(0)).toThrowError(
      expect.objectContaining({ code: StoreWasmErrorCode.fieldDisposed })
    )

    const recordField = await record({ a: number() }).create(
      context(() =>
        source(() => {
          throw cleanupFailure
        })
      )
    )
    expect(() => recordField.dispose()).toThrow(cleanupFailure)
    expect(recordField.disposed).toBe(true)
    expect(() => recordField.a).toThrowError(
      expect.objectContaining({ code: StoreWasmErrorCode.fieldDisposed })
    )
  })
})
