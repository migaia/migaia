import assert from 'node:assert/strict'
import schema from '../../schema/runtime-api.schema.json'
import { acceptsSchema, type ISchemaRule } from '../fixtures/schema-accepts.js'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../schema/vectors/runtime-api.json'
import { normalizeRuntimeEnvelope } from '../../src/contract/runtime-api/normalize.js'
import { prepareRpcBinary, restoreRpcBinary } from '../../src/contract/runtime-api/binary.js'
import { RpcBinaryStorage } from '../../src/contract/runtime-api/binary-constants.js'
import { normalizeRuntimePortable } from '../../src/contract/normalize.js'
import { normalizeStreamPayload } from '../../src/contract/v1/stream.js'
import { measurePortableStreamValue, RpcStreamLimit } from '../../src/contract/stream-constants.js'

/** Original task/route vectors supply the complete normative metadata rather than a fake endpoint. */
const envelope = (payload: unknown) => normalizeRuntimeEnvelope({ ...vectors.valid[0], payload })
/** A real full-backing digest proves that invisible bytes participate in native integrity. */
const digest = async (backing: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(backing)).digest('hex')

for (const kind of ['buffer', 'view'] as const) {
  it(`[A84][A87] ${kind} stream budget uses native slots and never invokes a byteLength shadow`, () => {
    /** Supported native objects retain their real slots despite unrelated own application fields. */
    const value = kind === 'buffer' ? new ArrayBuffer(2) : new Uint8Array(2)
    /** Any public property read is observed independently of the stream's returned value. */
    let reads = 0
    Object.defineProperty(value, 'byteLength', {
      get: () => {
        reads++
        return 0
      }
    })
    assert.equal(measurePortableStreamValue(value), 2)
    assert.equal(reads, 0)
    /**
     * The canonical sender-side stream budget must reject real oversize before a native frame
     * exists.
     */
    const oversized =
      kind === 'buffer'
        ? new ArrayBuffer(RpcStreamLimit.maxItemValueBytes + 1)
        : new Uint8Array(RpcStreamLimit.maxItemValueBytes + 1)
    Object.defineProperty(oversized, 'byteLength', { value: 0 })
    assert.throws(
      () =>
        normalizeStreamPayload(
          { event: 'item', seq: 0, value: oversized },
          normalizeRuntimePortable
        ),
      { code: 'INVALID_STREAM', violation: 'budget' }
    )
  })
}

it('[A84] inline tag-shaped business records and view boundaries restore without leaking outside bytes', async () => {
  /** Prefix and suffix are deliberately different from the visible view data. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  /** Collision shapes remain ordinary arrays/records because every business node is tagged. */
  const payload = {
    bytes: new Uint8Array(backing, 1, 2),
    shape: ['buffer', 0],
    object: { storage: 'native', backings: [] }
  }
  const prepared = await prepareRpcBinary(envelope(payload), RpcBinaryStorage.inline)
  assert.deepEqual(prepared.sidecars, [])
  const restored = await restoreRpcBinary(
    JSON.parse(JSON.stringify(prepared.manifest)),
    RpcBinaryStorage.inline
  )
  assert.ok('payload' in restored)
  const value = restored.payload as typeof payload
  assert.ok(value.bytes instanceof Uint8Array)
  assert.equal(value.bytes.byteOffset, 1)
  assert.deepEqual([...new Uint8Array(value.bytes.buffer)], [0, 1, 2])
  assert.deepEqual(JSON.parse(JSON.stringify(value.shape)), payload.shape)
  assert.deepEqual(JSON.parse(JSON.stringify(value.object)), payload.object)
})

it('[A84][A85] native refs preserve original complete backings and aliases without making a transfer copy', async () => {
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  const prepared = await prepareRpcBinary(
    envelope({
      buffer: backing,
      first: new Uint8Array(backing, 1, 2),
      second: new Uint8Array(backing, 2, 1)
    }),
    RpcBinaryStorage.native,
    1024,
    digest
  )
  assert.equal(prepared.sidecars.length, 1)
  assert.equal(
    prepared.sidecars[0],
    backing,
    '[A85] native preparation must retain the original transfer identity'
  )
  assert.equal(prepared.backingBytes, 4)
  assert.equal(prepared.manifest.backings[0]!.sha256, await digest(backing))
  const restored = await restoreRpcBinary(
    prepared.manifest,
    RpcBinaryStorage.native,
    prepared.sidecars,
    1024,
    digest
  )
  assert.ok('payload' in restored)
  const value = restored.payload as { buffer: ArrayBuffer; first: Uint8Array; second: Uint8Array }
  assert.equal(value.buffer, backing)
  assert.equal(value.first.buffer, value.second.buffer)
  assert.equal(value.first.byteOffset, 1)
  assert.deepEqual([...new Uint8Array(value.first.buffer)], [9, 1, 2, 8])
  new Uint8Array(backing)[0] = 7
  await assert.rejects(
    restoreRpcBinary(prepared.manifest, RpcBinaryStorage.native, prepared.sidecars, 1024, digest),
    { code: 'INVALID_ENVELOPE' }
  )
})

it('[A84][A87] full backing overflow and invalid business graphs fail before digest work', async () => {
  /** Counting invokes the real digest only when graph and complete budget admission succeed. */
  let hashes = 0
  const observedDigest = async (backing: ArrayBuffer) => {
    hashes++
    return digest(backing)
  }
  const backing = new ArrayBuffer(1025)
  await assert.rejects(
    prepareRpcBinary(
      envelope(new Uint8Array(backing, 100, 1)),
      RpcBinaryStorage.native,
      1024,
      observedDigest
    ),
    { code: 'INVALID_ENVELOPE' }
  )
  assert.equal(hashes, 0, '[A87] tiny visible views cannot evade the full-backing limit')
  for (const payload of [
    new Int32Array([1]),
    new SharedArrayBuffer(1),
    new Uint8Array(new SharedArrayBuffer(1))
  ])
    assert.throws(() => envelope(payload), { code: 'INVALID_ENVELOPE' })
  /** No accessor executes during the binary data graph admission. */
  let reads = 0
  const accessor = {
    get bytes() {
      reads++
      return new Uint8Array([1])
    }
  }
  assert.throws(() => envelope(accessor), { code: 'INVALID_ENVELOPE' })
  assert.equal(reads, 0)
})

it.each([
  ['unknown', ['unknown', 0]],
  ['unused-base64-bits', ['buffer', 'AB']],
  ['extra-tuple-field', ['null', 0]],
  [
    'duplicate-key',
    [
      'object',
      [
        ['a', ['null']],
        ['a', ['null']]
      ]
    ]
  ],
  [
    'unsorted-key',
    [
      'object',
      [
        ['b', ['null']],
        ['a', ['null']]
      ]
    ]
  ],
  ['oversize-offset', ['uint8array', 16 * 1024 * 1024, 'AQ']],
  ['inline-native-reference', ['buffer', 0]]
])(
  '[A84] inline decoder rejects %s before producing a semantic envelope',
  async (_name, payload) => {
    const prepared = await prepareRpcBinary(envelope(null), RpcBinaryStorage.inline)
    await assert.rejects(
      restoreRpcBinary(
        { ...prepared.manifest, envelope: { ...prepared.manifest.envelope, payload } },
        RpcBinaryStorage.inline
      ),
      { code: 'INVALID_ENVELOPE' }
    )
  }
)

it('[A84] binary graph normalization never executes an inherited array method', async () => {
  /** The supported dense own-data array may inherit methods, but the data codec must not call them. */
  const payload = [new Uint8Array([1])]
  /** A custom prototype exposes whether normalization escapes its admitted descriptor snapshot. */
  let reads = 0
  Object.setPrototypeOf(
    payload,
    Object.create(Array.prototype, {
      map: {
        get: () => {
          reads++
          return Array.prototype.map
        }
      }
    })
  )
  const prepared = await prepareRpcBinary(envelope(payload), RpcBinaryStorage.inline)
  const restored = await restoreRpcBinary(prepared.manifest, RpcBinaryStorage.inline)
  assert.equal(reads, 0, '[A84] only the owned array elements enter the portable graph')
  assert.ok('payload' in restored)
  assert.deepEqual([...(restored.payload as Uint8Array[])[0]!], [1])
})

it('[A84][A85] binary vectors match the shipped closed schema and canonical restoration', async () => {
  /** Original schema evaluator is reused; real sidecars are materialized solely from fixture bytes. */
  const root = schema as ISchemaRule & { $defs: Record<string, ISchemaRule> }
  for (const vector of vectors.binary.valid) {
    assert.equal(acceptsSchema(root, vector.value, root), true, vector.id)
    const sidecars = vector.sidecars.map((bytes) => new Uint8Array(bytes).buffer)
    const storage = vector.value.storage as RpcBinaryStorage
    const restored = await restoreRpcBinary(vector.value, storage, sidecars, undefined, digest)
    assert.equal(restored.profile, vectors.profile)
  }
  for (const vector of vectors.binary.invalid) {
    assert.equal(acceptsSchema(root, vector.value, root), vector.schemaAccepted, vector.id)
    const sidecars = vector.sidecars.map((bytes) => new Uint8Array(bytes).buffer)
    await assert.rejects(
      restoreRpcBinary(
        vector.value,
        vector.value.storage as RpcBinaryStorage,
        sidecars,
        undefined,
        digest
      ),
      { code: 'INVALID_ENVELOPE' }
    )
  }
})

it('[A84] inline Uint8Array restoration materializes one backing including its zero prefix', async () => {
  const value = normalizeRuntimeEnvelope({ ...vectors.valid[0], payload: new Uint8Array([1, 2]) })
  const prepared = await prepareRpcBinary(value, RpcBinaryStorage.inline)
  const manifest = {
    ...prepared.manifest,
    envelope: { ...prepared.manifest.envelope, payload: ['uint8array', 3, 'AQI'] }
  }
  /** Transparent constructor observation keeps the genuine native allocation and internal slots. */
  const NativeUint8Array = Uint8Array
  /** A direct ArrayBuffer allocation is the other standard way to materialize the same backing. */
  const NativeArrayBuffer = ArrayBuffer
  let allocations = 0
  vi.stubGlobal(
    'Uint8Array',
    new Proxy(NativeUint8Array, {
      construct: (target, args) => {
        if (typeof args[0] === 'number') allocations++
        return Reflect.construct(target, args)
      }
    })
  )
  vi.stubGlobal(
    'ArrayBuffer',
    new Proxy(NativeArrayBuffer, {
      construct: (target, args) => {
        if (typeof args[0] === 'number') allocations++
        return Reflect.construct(target, args)
      }
    })
  )
  try {
    const restored = await restoreRpcBinary(manifest, RpcBinaryStorage.inline)
    assert.equal(allocations, 1, '[A84] decode writes directly into the final backing')
    assert.ok('payload' in restored)
    const bytes = restored.payload as Uint8Array
    assert.equal(bytes.byteOffset, 3)
    assert.deepEqual([...new NativeUint8Array(bytes.buffer)], [0, 0, 0, 1, 2])
  } finally {
    vi.unstubAllGlobals()
  }
})
