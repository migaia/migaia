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
    const field = await array(number(), 4, 2).create({
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

    const arrayField = await array(number(), 2).create(
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
