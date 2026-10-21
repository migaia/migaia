import { describe, expect, it, vi } from 'vitest'
import {
  ConflictPolicy,
  assertTransactionCallback,
  compareStorageKeys,
  readTransactionConflictPolicy,
  snapshotCodec,
  snapshotOperationContext,
  snapshotStorageKey,
  snapshotSyncWriteOptions,
  type ICodec,
  type IStorageKey
} from '../src/index.js'

describe('public transaction admission', () => {
  it('validates callbacks without invoking them and codes non-callable input', () => {
    /** Admission must leave execution and transaction ownership with the backend. */
    const run = vi.fn(() => 42)
    assertTransactionCallback(run, 'memory')
    expect(run).not.toHaveBeenCalled()
    expect(run()).toBe(42)
    /** JavaScript callers may supply non-callable values before backend work starts. */
    for (const invalid of [undefined, null, 42, {}])
      expect(() => assertTransactionCallback(invalid, 'memory')).toThrow(
        expect.objectContaining({
          source: '@migaia/storage-contract',
          code: 'INVALID_ARGUMENT',
          cause: expect.any(TypeError)
        })
      )
  })

  it('snapshots default and explicit write policies and rejects invalid choices', () => {
    expect(readTransactionConflictPolicy(undefined, 'memory')).toBe(ConflictPolicy.conflict)
    expect(readTransactionConflictPolicy({}, 'memory')).toBe(ConflictPolicy.conflict)
    expect(readTransactionConflictPolicy({ conflictPolicy: 'conflict' }, 'indexeddb')).toBe(
      ConflictPolicy.conflict
    )
    expect(readTransactionConflictPolicy({ conflictPolicy: 'replace' }, 'indexeddb')).toBe(
      ConflictPolicy.replace
    )
    /** Unsupported write policies must fail before the backend chooses a conflict strategy. */
    for (const invalid of [null, [], { conflictPolicy: 'merge' }])
      expect(() => readTransactionConflictPolicy(invalid, 'memory')).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: expect.any(TypeError) })
      )
  })

  it('keeps a failed transaction policy accessor reachable as the original cause', () => {
    /** Application options may expose a property whose read fails before acquisition. */
    const cause = new Error('transaction policy unavailable')
    expect(() =>
      readTransactionConflictPolicy(
        {
          get conflictPolicy(): never {
            throw cause
          }
        },
        'memory'
      )
    ).toThrow(expect.objectContaining({ source: '@migaia/storage-contract', cause }))
  })
})

describe('public storage key snapshots and ordering', () => {
  it('detaches compound keys from subsequent caller mutation', () => {
    /** A compound IndexedDB key contains every mutable supported key kind. */
    const date = new Date(1234)
    /** Binary storage identity must not change while an asynchronous operation waits. */
    const bytes = new Uint8Array([1, 2])
    /** Nested arrays must be detached independently from their mutable leaves. */
    const nested: IStorageKey[] = [date, bytes.buffer]
    /** The caller retains and may mutate all original key objects. */
    const key: IStorageKey[] = ['record', 4, nested]
    /** The returned key is the public stable identity used by backend work. */
    const snapshot = snapshotStorageKey(key, 'indexeddb')
    date.setTime(9876)
    bytes.fill(9)
    nested.push('later')
    key.push('changed')
    expect(snapshot).toEqual(['record', 4, [new Date(1234), new Uint8Array([1, 2]).buffer]])
    expect(snapshot).not.toBe(key)
    expect(snapshotStorageKey('plain', 'memory')).toBe('plain')
    expect(snapshotStorageKey(42, 'indexeddb')).toBe(42)
  })

  it('orders valid key kinds consistently with IndexedDB ordering', () => {
    /** IndexedDB defines one order across all supported key categories. */
    const ordered: IStorageKey[] = [-1, new Date(0), 'record', new Uint8Array([0]).buffer, [0]]
    expect(ordered.toReversed().sort(compareStorageKeys)).toEqual(ordered)
    /** Every supported key kind has reflexive equality within the shared ordering. */
    for (const key of ordered) expect(compareStorageKeys(key, key)).toBe(0)
  })

  it('orders scalar, binary and compound keys by value and then prefix length', () => {
    /** Each pair describes an actual ordered range boundary, rather than internal state. */
    const pairs: ReadonlyArray<readonly [IStorageKey, IStorageKey]> = [
      [1, 2],
      [new Date(1), new Date(2)],
      ['a', 'b'],
      [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer],
      [new Uint8Array([1]).buffer, new Uint8Array([1, 0]).buffer],
      [[1], [2]],
      [[1], [1, 0]],
      [
        [1, ['a']],
        [1, ['b']]
      ]
    ]
    for (const [lower, upper] of pairs) {
      expect(Math.sign(compareStorageKeys(lower, upper))).toBe(-1)
      expect(Math.sign(compareStorageKeys(upper, lower))).toBe(1)
    }
  })
})

describe('public codec and operation snapshots', () => {
  it('captures each codec method once and retains the original implementation', async () => {
    /** Property reads are observable because routing must use one descriptor generation. */
    const reads = { name: 0, output: 0, encode: 0, decode: 0 }
    /** Real encoding/decoding operations make the captured function identity observable. */
    const encode = async (value: unknown) => JSON.stringify(value)
    /** A codec snapshot must keep this decoder even after the caller changes its descriptor. */
    const decode = async (raw: unknown) => JSON.parse(String(raw)) as unknown
    /** Applications may expose computed codec descriptors through ordinary accessors. */
    const codec: ICodec = {
      get name() {
        reads.name++
        return 'application-json'
      },
      get output() {
        reads.output++
        return 'text' as const
      },
      get encode() {
        reads.encode++
        return encode
      },
      get decode() {
        reads.decode++
        return decode
      }
    }
    /** The public descriptor is detached before capability routing and asynchronous use. */
    const snapshot = snapshotCodec(codec)
    Object.defineProperty(codec, 'encode', { value: async () => 'changed' })
    expect(snapshot.encode).toBe(encode)
    expect(snapshot.decode).toBe(decode)
    expect(await snapshot.decode(await snapshot.encode({ count: 2 }))).toEqual({ count: 2 })
    expect(reads).toEqual({ name: 1, output: 1, encode: 1, decode: 1 })
  })

  it('codes malformed codec descriptors and preserves accessor failures', () => {
    /** Invalid public descriptors must produce a contract error rather than native access errors. */
    for (const invalid of [null, [], {}, { name: ' ', output: 'text' }])
      expect(() => snapshotCodec(invalid)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: expect.any(TypeError) })
      )
    /** A failed public descriptor getter remains reachable without replacing the primary. */
    const cause = new Error('codec name unavailable')
    expect(() =>
      snapshotCodec({
        get name(): never {
          throw cause
        }
      })
    ).toThrow(expect.objectContaining({ source: '@migaia/storage-contract', cause }))
  })

  it('freezes operation context once while retaining cancellation and policy identity', () => {
    /** The original signal stays responsible for cancellation after snapshot admission. */
    const controller = new AbortController()
    /** The caller may later mutate options without changing already accepted work. */
    const options = {
      signal: controller.signal,
      timeoutMs: 0,
      pageSize: 4096,
      conflictPolicy: 'replace' as const
    }
    /** Layered backends share this same immutable context rather than rereading user getters. */
    const snapshot = snapshotOperationContext(options)
    options.timeoutMs = 20
    expect(snapshot).toEqual({
      signal: controller.signal,
      timeoutMs: 0,
      pageSize: 4096,
      conflictPolicy: 'replace'
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshotOperationContext(snapshot)).toBe(snapshot)
    expect(snapshotOperationContext(undefined)).toBeUndefined()
    expect(snapshotOperationContext({ conflictPolicy: 'conflict' })).toMatchObject({
      conflictPolicy: 'conflict'
    })
  })

  it('keeps synchronous writes free of timing options while accepting supported policies', () => {
    expect(snapshotSyncWriteOptions(undefined)).toEqual({ conflictPolicy: undefined })
    expect(snapshotSyncWriteOptions({ conflictPolicy: 'replace' })).toEqual({
      conflictPolicy: 'replace'
    })
    expect(snapshotSyncWriteOptions({ conflictPolicy: 'conflict' })).toEqual({
      conflictPolicy: 'conflict'
    })
    /** Synchronous channels cannot accept asynchronous cancellation or timeout work. */
    for (const invalid of [
      null,
      [],
      { signal: new AbortController().signal },
      { timeoutMs: 0 },
      { conflictPolicy: 'merge' }
    ])
      expect(() => snapshotSyncWriteOptions(invalid)).toThrow(
        expect.objectContaining({
          source: '@migaia/storage-contract',
          code: 'INVALID_ARGUMENT',
          cause: expect.any(TypeError)
        })
      )
  })
})
