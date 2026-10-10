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
import { Buffer } from 'node:buffer'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { asCodecValue } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '../../src/contract/index.js'
import { bindRpcFrameIngress } from '../../src/contract/framing/reassembler.js'
import { remoteProcessJsonCodec } from '../../src/process/pipeline.js'
import { remoteProcessStringFramer } from '../../src/process/string-framer.js'
import { proveFastComponents, readFastInlineEncoder } from '../../src/core/internal/fast-path.js'
import {
  prepareOwnedBinaryJsonSnapshot,
  readOwnedJsonSnapshot,
  RpcOwnedBinaryAlphabet
} from '../../src/core/internal/outbound-owned-codec.js'
import '../../src/process/adapters/node-byte-stream.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'

/** Original task/route vectors supply the complete normative metadata rather than a fake endpoint. */
const envelope = (payload: unknown) => normalizeRuntimeEnvelope({ ...vectors.valid[0], payload })
/** A real full-backing digest proves that invisible bytes participate in native integrity. */
const digest = async (backing: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(backing)).digest('hex')

it('[C6-L1][A27][A21] cold binary preparation captures inline bytes and starts the first native digest synchronously', async () => {
  /** The internal lazy seam is the same preparation function used by actual outbound owners. */
  const { prepareRpcBinaryLazy } = await import('../../src/contract/runtime-api/binary-lazy.js')
  /** Hidden bytes distinguish the captured visible slice from a whole-backing copy. */
  const inline = new Uint8Array([9, 1, 2, 8])
  /** This first operation begins cold loading only after the original synchronous byte slice. */
  const pendingInline = prepareRpcBinaryLazy(
    envelope(new Uint8Array(inline.buffer, 1, 2)),
    RpcBinaryStorage.inline
  )
  inline.fill(7)
  /** Separate native backings expose the original sequential digest order. */
  const first = new Uint8Array([3, 4]).buffer
  const second = new Uint8Array([5, 6]).buffer
  /** The first digest is deliberately held while the codec module finishes loading. */
  let releaseFirst!: (value: string) => void
  /** Actual digest calls establish ordering independently of prepared manifest equality. */
  const order: ArrayBuffer[] = []
  /** The prehash callback must run exactly once before any native digest call. */
  let before = 0
  /** This operation shares only module loading; captured backings remain operation-local. */
  const pendingNative = prepareRpcBinaryLazy(
    envelope({ first, second }),
    RpcBinaryStorage.native,
    undefined,
    (backing) => {
      order.push(backing)
      return backing === first
        ? new Promise<string>((resolve) => {
            releaseFirst = resolve
          })
        : digest(backing)
    },
    () => {
      before++
      assert.equal(order.length, 0)
    }
  )
  assert.equal(before, 1)
  assert.deepEqual(order, [first])
  /** A cold asynchronous codec handoff must not reread the caller's mutated inline bytes. */
  const capturedInline = await pendingInline
  const restored = await restoreRpcBinary(capturedInline.manifest, RpcBinaryStorage.inline)
  assert.ok('payload' in restored)
  assert.deepEqual(restored.payload, new Uint8Array(new Uint8Array([0, 1, 2]).buffer, 1, 2))
  assert.deepEqual(order, [first])
  releaseFirst(await digest(first))
  /** Later hashes start only after the original first digest settles. */
  const prepared = await pendingNative
  assert.deepEqual(order, [first, second])
  assert.equal(before, 1)
  assert.equal(prepared.sidecars[0], first)
  assert.equal(prepared.sidecars[1], second)
})

for (const size of [64 * 1024, 1024 * 1024]) {
  it(`[A61][A21] ${size} owned inline bytes encode natively once without a second business walk`, async () => {
    /** The same real codec/framer identities select the encoder held by the Node byte adapter. */
    const components: IRpcSelectedComponents = {
      protocol: rpcProtocolV1,
      codec: remoteProcessJsonCodec as IRpcSelectedComponents['codec'],
      framer: remoteProcessStringFramer,
      ingressPrepare: bindRpcFrameIngress(remoteProcessStringFramer.accept),
      shadowed: []
    }
    proveFastComponents(
      components,
      rpcProtocolV1,
      remoteProcessJsonCodec,
      remoteProcessStringFramer
    )
    /** The callable comes from actual adapter admission, not a fixture reimplementation. */
    const encodeInline = readFastInlineEncoder(components)
    assert.ok(encodeInline)
    /** Hidden prefix/suffix bytes distinguish inline view semantics from native whole backings. */
    const backing = new Uint8Array(size + 4).fill(7)
    backing[0] = 91
    backing[backing.length - 1] = 92
    /** One genuine view enters the original closed portable normalization. */
    const input = envelope({ z: new Uint8Array(backing.buffer, 2, size), a: '汉字\ud83d' })
    /** Count the real native encoder independently of byte equality and the owner proof. */
    let nativeCalls = 0
    /** Delegation preserves the native Buffer method and its exact receiver. */
    const original = Buffer.prototype.toString
    /** Only the actual binary alphabet is counted; test output and other encodings are excluded. */
    const native = vi.spyOn(Buffer.prototype, 'toString').mockImplementation(function (
      this: Buffer,
      ...args: unknown[]
    ) {
      if (args[0] === RpcOwnedBinaryAlphabet) nativeCalls++
      return Reflect.apply(original, this, args)
    })
    try {
      /** The original prepare visitor emits both the tags and their root construction bounds. */
      const prepared = await prepareRpcBinary(
        input,
        RpcBinaryStorage.inline,
        undefined,
        undefined,
        undefined,
        {
          encodeInline,
          capture: prepareOwnedBinaryJsonSnapshot
        }
      )
      /** Reusing the exact tag root proves metadata preparation did not copy the business graph. */
      const retained = readOwnedJsonSnapshot(prepared.manifest)
      assert.ok(retained)
      const json = retained.value as typeof prepared.manifest
      assert.ok('payload' in prepared.manifest.envelope && 'payload' in json.envelope)
      assert.equal(
        json.envelope.payload,
        prepared.manifest.envelope.payload,
        '[A61] same encoded business root'
      )
      /** Compare the actual process codec against the unchanged source JSON codec's wire order. */
      const encoded = remoteProcessJsonCodec.encode(prepared.manifest)
      assert.equal(encoded, defineJsonCodec({ version: 1 }).encode(asCodecValue(prepared.manifest)))
      assert.equal(nativeCalls, 1, '[A61] real native base64 once per binary leaf')
      assert.ok(Buffer.byteLength(encoded as string) <= retained.byteUpperBound)
      /** The shipped restore owner decides offset, zero-prefix, text and visible byte equality. */
      const restored = await restoreRpcBinary(
        JSON.parse(encoded as string),
        RpcBinaryStorage.inline
      )
      assert.ok('payload' in restored)
      const payload = restored.payload as { z: Uint8Array; a: string }
      assert.equal(payload.z.byteOffset, 2)
      assert.equal(payload.z.buffer.byteLength, size + 2)
      assert.deepEqual(new Uint8Array(payload.z.buffer, 0, 2), new Uint8Array(2))
      assert.deepEqual(payload.z, new Uint8Array(backing.buffer, 2, size))
      assert.equal(payload.a, '汉字\ud83d')
    } finally {
      native.mockRestore()
    }
  })
}

it('[A61][A21] private owned capture preserves public preparation shape and native digest order', async () => {
  /** Two actual backings distinguish sequential digest order from view alias handling. */
  const first = new Uint8Array([9, 1, 2, 8]).buffer
  const second = new Uint8Array([3, 4]).buffer
  /** All preparation paths share the original admitted semantic source. */
  const input = envelope({ first, view: new Uint8Array(first, 1, 2), second })
  /** The same source without an internal capture retains the public result geometry. */
  const ordinary = await prepareRpcBinary(input, RpcBinaryStorage.native, undefined, digest)
  /** Only actual digest invocations enter this ordered record. */
  const order: ArrayBuffer[] = []
  /** Prehash must occur once before the first real digest starts. */
  let beforeDigest = 0
  const prepared = await prepareRpcBinary(
    input,
    RpcBinaryStorage.native,
    undefined,
    async (backing) => {
      order.push(backing)
      return digest(backing)
    },
    (manifest, bytes) => {
      beforeDigest++
      assert.equal(order.length, 0)
      assert.equal(bytes, 6)
      assert.ok(readOwnedJsonSnapshot(manifest))
    },
    { capture: prepareOwnedBinaryJsonSnapshot }
  )
  assert.equal(beforeDigest, 1)
  assert.deepEqual(order, [first, second])
  assert.deepEqual(prepared, ordinary)
  assert.deepEqual(Object.keys(prepared), Object.keys(ordinary))
  assert.deepEqual(Object.keys(prepared.manifest), Object.keys(ordinary.manifest))
  assert.equal(Object.getPrototypeOf(prepared.manifest), Object.getPrototypeOf(ordinary.manifest))
  assert.equal(readOwnedJsonSnapshot(ordinary.manifest), undefined)
  /** Native signer input keeps the original tuple mutability; only its sizing facts are retained. */
  assert.ok('payload' in prepared.manifest.envelope)
  assert.equal(Object.isFrozen(prepared.manifest.envelope.payload), false)
})

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
