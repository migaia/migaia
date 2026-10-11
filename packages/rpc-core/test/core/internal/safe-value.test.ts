import { runInNewContext } from 'node:vm'
import { isUint8Array as canonicalIsUint8Array } from '@migaia/utils/bytes'
import { createSafeRecord as canonicalCreateSafeRecord } from '@migaia/utils/object'
import { isSafeIntegerValue as canonicalIsSafeIntegerValue } from '@migaia/utils/value'
import { describe, expect, it } from 'vitest'
import {
  createSafeRecord,
  fanoutDeliveryKey,
  isUint8Array,
  isSafeIntegerValue,
  tupleKey
} from '../../../dist/core/internal/safe-value.js'
import { safeRead, safeString } from '../../../dist/core/internal/safe-value.js'

describe('safe-value utilities', () => {
  it('contains hostile property getters', () => {
    const failure = new Error('getter')
    const reported: unknown[] = []
    const hostile = new Proxy(
      {},
      {
        get() {
          throw failure
        }
      }
    )
    expect(
      safeRead(hostile, 'value', (failure) => {
        reported.push(failure)
        return undefined
      })
    ).toBeUndefined()
    expect(reported).toEqual([{ key: 'value', error: failure }])
  })

  it('accepts only safe integer values', () => {
    expect(isSafeIntegerValue).toBe(canonicalIsSafeIntegerValue)
    expect(isSafeIntegerValue(0)).toBe(true)
    expect(isSafeIntegerValue(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isSafeIntegerValue(Number.NaN)).toBe(false)
    expect(isSafeIntegerValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isSafeIntegerValue(1.5)).toBe(false)
  })

  it('contains hostile string conversion and preserves tuple boundaries', () => {
    const reports: unknown[] = []
    const hostile = {
      toString: () => {
        throw new Error('stringify')
      }
    }
    expect(safeString('stable')).toBe('stable')
    expect(
      safeString(hostile, 'fallback', ({ error }) => {
        reports.push(error)
        return undefined
      })
    ).toBe('fallback')
    expect(reports).toHaveLength(1)
    expect(tupleKey('a|b', 'c')).not.toBe(tupleKey('a', 'b|c'))
  })

  it('returns a null-prototype dictionary for attacker-controlled keys', () => {
    expect(createSafeRecord).toBe(canonicalCreateSafeRecord)
    const record = createSafeRecord<number>()
    record['__proto__'] = 1
    expect(Object.getPrototypeOf(record)).toBeNull()
    expect(Object.hasOwn(record, '__proto__')).toBe(true)
  })

  it('keeps inherited getter receivers and performs no has or descriptor trap', () => {
    /** Each trap is observable at this untrusted property boundary. */
    const operations: string[] = []
    /** A prototype getter exercises inherited reads without a descriptor snapshot. */
    const prototype = {
      get value() {
        expect(this).toBe(proxy)
        return 3
      }
    }
    /** The proxy exposes any additional lookup operation introduced by convergence. */
    const proxy = new Proxy(Object.create(prototype) as object, {
      get(target, key, originalReceiver) {
        operations.push('get')
        return Reflect.get(target, key, originalReceiver)
      },
      has() {
        operations.push('has')
        return true
      },
      getOwnPropertyDescriptor() {
        operations.push('descriptor')
        return undefined
      },
      ownKeys() {
        operations.push('keys')
        return []
      }
    })
    expect(safeRead(proxy, 'value')).toBe(3)
    expect(operations).toEqual(['get'])
  })

  it('reuses the canonical intrinsic brand across realms and subclasses', () => {
    const foreignBytes = runInNewContext('new Uint8Array([1])') as Uint8Array
    class ByteSubclass extends Uint8Array {}
    const hostileBytes = new Uint8Array([1])
    let constructorReads = 0
    Object.defineProperty(hostileBytes, 'constructor', {
      get: () => {
        constructorReads += 1
        throw new Error('constructor getter must not run')
      }
    })

    expect(isUint8Array).toBe(canonicalIsUint8Array)
    expect(isUint8Array(new Uint8Array([1]))).toBe(true)
    expect(isUint8Array(foreignBytes)).toBe(true)
    expect(isUint8Array(new ByteSubclass(1))).toBe(true)
    expect(isUint8Array(hostileBytes)).toBe(true)
    expect(constructorReads).toBe(0)
    expect(isUint8Array(new Uint16Array([1]))).toBe(false)
    expect(isUint8Array(new DataView(new ArrayBuffer(1)))).toBe(false)
    expect(isUint8Array(null)).toBe(false)
  })

  it('tags anonymous and receiver-pinned fanout deliveries distinctly', () => {
    expect(fanoutDeliveryKey('target')).toBe('["target","target"]')
    expect(fanoutDeliveryKey('target', 'receiver')).toBe('["receiver","target","receiver"]')
  })
})
