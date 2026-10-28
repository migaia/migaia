import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import {
  normalizeRpcFrame,
  normalizeRpcStream,
  normalizeRpcPortable,
  measurePortableStreamValue,
  RpcStreamLimit,
  type IRpcEnvelope,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { prepareRpcBinary, restoreRpcBinary, RpcBinaryStorage } from '../../dist/sdk/wire/binary.js'
import vectors from './binary-vectors.json'
import { header } from '../../../rpc-contract/test/fixtures/core-profile.ts'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { BinaryShape, RPC_BINARY_MAX_BYTES } from '../../dist/sdk/wire/binary-shape.js'

it('actual JSON codec never measures ordinary request, notify or result slots', async () => {
  /** The real executing media codec performs both outbound and inbound admission. */
  const codec = new RpcJsonCarrierCodec()
  /** Inline media uses the same capture walk without a native digest or manufactured transfer. */
  const context = { codec: 'json', nativeBinary: false, maxFrameBytes: RPC_BINARY_MAX_BYTES }
  /** A bounded root is the actual accounting entry; scalar no-op gates are not counted as walks. */
  const measurement = vi.spyOn(BinaryShape.prototype, 'beginSemantic')
  try {
    for (const mode of ['request', 'notify', 'result'] as const) {
      /** Existing metadata fixtures supply real task/route domains to the canonical codec. */
      const frame = normalizeRpcFrame(
        mode === 'result'
          ? { ...header(), kind: 'result', result: { text: 'small' } }
          : { ...header(mode), options: {}, payload: { text: 'small' } }
      )
      const prepared = await codec.prepare(frame, context)
      const encoded = codec.encode(prepared, context)
      await codec.restore(codec.decode(encoded, context), context)
    }
    assert.equal(measurement.mock.calls.length, 0)
  } finally {
    measurement.mockRestore()
  }
})

it('actual binary stream item measures once in prepare and once in restore', async () => {
  /** The actual inline manifest carries a byte view through both original codec stages. */
  const codec = new RpcJsonCarrierCodec()
  /** Original inline capability facts are shared by both executing codec stages. */
  const context = { codec: 'json', nativeBinary: false, maxFrameBytes: RPC_BINARY_MAX_BYTES }
  /** This is valid unadmitted fixture input; no earlier normalize call adds another measurement. */
  const frame = {
    ...header('stream'),
    kind: 'stream',
    stream: { event: 'item', seq: 0, value: new Uint8Array([1, 2]) }
  } as IRpcEnvelope
  /** Root scopes are counted on the existing shape owner while original methods still execute. */
  const measurement = vi.spyOn(BinaryShape.prototype, 'beginSemantic')
  try {
    /** The real prepare operation must open exactly one bounded stream-root scope. */
    const prepared = await codec.prepare(frame, context)
    assert.equal(measurement.mock.calls.length, 1)
    measurement.mockClear()
    /** Actual restore decodes the original prepared native view in one separate root scope. */
    const restored = await codec.restore(
      codec.decode(codec.encode(prepared, context), context),
      context
    )
    assert.equal(measurement.mock.calls.length, 1)
    assert.ok(restored.kind === 'stream')
    assert.deepEqual(restored.stream.value, new Uint8Array([1, 2]))
  } finally {
    measurement.mockRestore()
  }
})

it('receiver codec retains INVALID_ENVELOPE for an oversized item', async () => {
  /** A real decoded JSON frame reaches the default stream fallback without a binary manifest. */
  const codec = new RpcJsonCarrierCodec()
  /** These are the actual media facts used by the ordinary physical JSON carrier. */
  const context = { codec: 'json', nativeBinary: false, maxFrameBytes: RPC_BINARY_MAX_BYTES }
  /** A quoted value exceeds the fixed sixteen-KiB semantic stream ceiling by one byte. */
  const decoded = codec.decode(
    {
      kind: 'message',
      data: JSON.stringify({
        ...header('stream'),
        kind: 'stream',
        stream: { event: 'item', seq: 0, value: 'x'.repeat(16383) }
      })
    },
    context
  )
  await assert.rejects(codec.restore(decoded, context), {
    code: 'INVALID_ENVELOPE',
    pointer: '/stream',
    violation: 'budget'
  })
  /** The actual tagged restore boundary must retain the same diagnostic through its cause wrapper. */
  const input = normalizeRpcFrame({
    ...header('stream'),
    kind: 'stream',
    stream: { event: 'item', seq: 0, value: 'small' }
  })
  assert.ok(input.kind === 'stream')
  /** An admitted small original value supplies a real manifest before the oversize wire mutation. */
  const prepared = await prepareRpcBinary(input, { storage: RpcBinaryStorage.inline })
  await assert.rejects(
    restoreRpcBinary(
      {
        ...prepared.manifest,
        envelope: {
          ...prepared.manifest.envelope,
          stream: { event: 'item', seq: 0, value: ['string', 'x'.repeat(16383)] }
        }
      },
      { storage: RpcBinaryStorage.inline }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/stream', violation: 'budget' }
  )
})

it('SDK manifest and backing metadata ignore unknowns but validate known fields', async () => {
  /** Unsigned native bytes reach both fixed metadata validators without requiring a digest. */
  const bytes = new Uint8Array([1, 2]).buffer
  /** The sole real capture creates both original metadata records before unknown fields are added. */
  const prepared = await prepareRpcBinary(envelope(bytes), {
    storage: RpcBinaryStorage.native,
    digest
  })
  assert.equal(prepared.manifest.backings[0]!.sha256, undefined)
  /** Only metadata gains unknown fields; portable business data keeps its original strict policy. */
  const manifest = {
    ...prepared.manifest,
    extraOne: true,
    extraTwo: 2,
    backings: prepared.manifest.backings.map((backing) => ({
      ...backing,
      extraOne: true,
      extraTwo: 2
    }))
  }
  /** Restoring the same native sidecar proves unknown metadata does not affect the known result. */
  const restored = await restoreRpcBinary(manifest, {
    storage: RpcBinaryStorage.native,
    sidecars: prepared.sidecars,
    digest
  })
  assert.ok('payload' in restored)
  assert.equal(restored.payload, bytes)
  /** An actual unsigned native row is accepted above, but cannot satisfy trusted signed integrity. */
  await assert.rejects(
    restoreRpcBinary(manifest, {
      storage: RpcBinaryStorage.native,
      sidecars: prepared.sidecars,
      digest,
      transferRequiresIntegrity: true
    }),
    { code: 'INVALID_ENVELOPE' }
  )
  /** Missing profile stays a genuine known-field error despite extra metadata. */
  const missingManifest: Record<string, unknown> = { ...manifest }
  delete missingManifest.profile
  await assert.rejects(
    restoreRpcBinary(missingManifest, {
      storage: RpcBinaryStorage.native,
      sidecars: prepared.sidecars,
      digest
    }),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/profile' }
  )
  await assert.rejects(
    restoreRpcBinary(
      { ...manifest, profile: 1 },
      { storage: RpcBinaryStorage.native, sidecars: prepared.sidecars, digest }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/profile' }
  )
  /** Backing byte length is independently required and must remain a nonnegative safe integer. */
  const missingBacking: Record<string, unknown> = { ...manifest.backings[0] }
  delete missingBacking.byteLength
  await assert.rejects(
    restoreRpcBinary(
      { ...manifest, backings: [missingBacking] },
      { storage: RpcBinaryStorage.native, sidecars: prepared.sidecars, digest }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/0/byteLength' }
  )
  await assert.rejects(
    restoreRpcBinary(
      { ...manifest, backings: [{ ...manifest.backings[0], byteLength: '2' }] },
      { storage: RpcBinaryStorage.native, sidecars: prepared.sidecars, digest }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/0/byteLength' }
  )
  /** Present undefined is malformed active metadata, rather than an omitted inline or SHA field. */
  await assert.rejects(
    restoreRpcBinary(
      { ...manifest, backings: [{ ...manifest.backings[0], data: undefined }] },
      { storage: RpcBinaryStorage.native, sidecars: prepared.sidecars, digest }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/0/data' }
  )
  await assert.rejects(
    restoreRpcBinary(
      { ...manifest, backings: [{ ...manifest.backings[0], sha256: undefined }] },
      { storage: RpcBinaryStorage.native, sidecars: prepared.sidecars, digest }
    ),
    { code: 'INVALID_ENVELOPE', pointer: '/manifest/0/sha256' }
  )
})

it('actual codec ignores operation-only fields outside their known variants', async () => {
  /** One actual media codec uses the same semantic admission as ordinary physical traffic. */
  const codec = new RpcJsonCarrierCodec()
  /** No binary ownership or transfer capability is fabricated by these extra metadata fields. */
  const context = { codec: 'json', nativeBinary: false, maxFrameBytes: RPC_BINARY_MAX_BYTES }
  /** Extra task/value fields stay outside control/open's actual portable slots. */
  const frames = [
    { ...header(), kind: 'control', operation: 'ping', task: { ignored: true } },
    {
      ...header('stream'),
      kind: 'stream',
      stream: { event: 'open', seq: 0, value: { ignored: true } }
    }
  ] as unknown as IRpcSemanticFrame[]
  for (const frame of frames) {
    /** Codec output may own a shallow replacement without freezing the caller's original metadata. */
    const prepared = await codec.prepare(frame, context)
    assert.equal(Object.isFrozen(frame), false)
    const restored = await codec.restore(
      codec.decode(codec.encode(prepared, context), context),
      context
    )
    assert.deepEqual(restored, frame)
  }
})

/** The actual public parser supplies complete new-profile metadata before codec execution. */
const envelope = (payload: unknown): IRpcEnvelope => {
  const value = normalizeRpcFrame({ ...header(), options: {}, payload })
  assert.ok('task' in value)
  return value
}
/** Whole-backing SHA-256 preserves the original invisible-byte integrity oracle. */
const digest = async (backing: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(backing)).digest('hex')

it('cold binary preparation captures inline bytes and starts the first native digest synchronously', async () => {
  /** The internal lazy seam is the same preparation function used by actual outbound owners. */
  /** Hidden bytes distinguish the captured visible slice from a whole-backing copy. */
  const inline = new Uint8Array([9, 1, 2, 8])
  /** This first operation begins cold loading only after the original synchronous byte slice. */
  const pendingInline = prepareRpcBinary(envelope(new Uint8Array(inline.buffer, 1, 2)), {
    storage: RpcBinaryStorage.inline
  })
  inline.fill(7)
  /** Separate native backings expose the original sequential digest order. */
  const first = new ArrayBuffer(16_385)
  const second = new ArrayBuffer(16_386)
  /** The first digest is deliberately held while the codec module finishes loading. */
  let releaseFirst!: (value: string) => void
  /** Actual digest calls establish ordering independently of prepared manifest equality. */
  const order: ArrayBuffer[] = []
  /** The prehash callback must run exactly once before any native digest call. */
  let before = 0
  /** This operation shares only module loading; captured backings remain operation-local. */
  const pendingNative = prepareRpcBinary(envelope({ first, second }), {
    storage: RpcBinaryStorage.native,
    transferRequiresIntegrity: true,
    digest: (backing) => {
      order.push(backing)
      return backing === first
        ? new Promise<string>((resolve) => {
            releaseFirst = resolve
          })
        : digest(backing)
    },
    beforeDigest: () => {
      before++
      assert.equal(order.length, 0)
    }
  })
  assert.equal(before, 1)
  assert.deepEqual(order, [first])
  /** A cold asynchronous codec handoff must not reread the caller's mutated inline bytes. */
  const capturedInline = await pendingInline
  const restored = await restoreRpcBinary(capturedInline.manifest, {
    storage: RpcBinaryStorage.inline
  })
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

for (const kind of ['buffer', 'view'] as const) {
  it(`${kind} stream budget uses native slots and never invokes a byteLength shadow`, () => {
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
        normalizeRpcStream(
          { event: 'item', seq: 0, value: oversized },
          undefined,
          normalizeRpcPortable
        ),
      { code: 'INVALID_ENVELOPE' }
    )
  })
}

it('inline tag-shaped business records and view boundaries restore without leaking outside bytes', async () => {
  /** Prefix and suffix are deliberately different from the visible view data. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  /** Collision shapes remain ordinary arrays/records because every business node is tagged. */
  const payload = {
    bytes: new Uint8Array(backing, 1, 2),
    shape: ['buffer', 0],
    object: { storage: 'native', backings: [] }
  }
  const prepared = await prepareRpcBinary(envelope(payload), { storage: RpcBinaryStorage.inline })
  assert.deepEqual(prepared.sidecars, [])
  const restored = await restoreRpcBinary(JSON.parse(JSON.stringify(prepared.manifest)), {
    storage: RpcBinaryStorage.inline
  })
  assert.ok('payload' in restored)
  const value = restored.payload as typeof payload
  assert.ok(value.bytes instanceof Uint8Array)
  assert.equal(value.bytes.byteOffset, 1)
  assert.deepEqual([...new Uint8Array(value.bytes.buffer)], [0, 1, 2])
  assert.deepEqual(JSON.parse(JSON.stringify(value.shape)), payload.shape)
  assert.deepEqual(JSON.parse(JSON.stringify(value.object)), payload.object)
})

it('native refs preserve original complete backings and aliases without making a transfer copy', async () => {
  /** Whole signed storage above the inline boundary keeps the original native identity oracle. */
  const bytes = new Uint8Array(16_385)
  bytes.set([9, 1, 2, 8])
  const backing = bytes.buffer
  const prepared = await prepareRpcBinary(
    envelope({
      buffer: backing,
      first: new Uint8Array(backing, 1, 2),
      second: new Uint8Array(backing, 2, 1)
    }),
    { storage: RpcBinaryStorage.native, limit: 32_768, digest, transferRequiresIntegrity: true }
  )
  assert.equal(prepared.sidecars.length, 1)
  assert.equal(
    prepared.sidecars[0],
    backing,
    'native preparation must retain the original transfer identity'
  )
  assert.equal(prepared.backingBytes, 16_385)
  assert.equal(prepared.manifest.backings[0]!.sha256, await digest(backing))
  const restored = await restoreRpcBinary(prepared.manifest, {
    storage: RpcBinaryStorage.native,
    sidecars: prepared.sidecars,
    limit: 32_768,
    digest,
    transferRequiresIntegrity: true
  })
  assert.ok('payload' in restored)
  const value = restored.payload as { buffer: ArrayBuffer; first: Uint8Array; second: Uint8Array }
  assert.equal(value.buffer, backing)
  assert.equal(value.first.buffer, value.second.buffer)
  assert.equal(value.first.byteOffset, 1)
  assert.equal(value.first.buffer.byteLength, 16_385)
  assert.deepEqual([...new Uint8Array(value.first.buffer, 0, 4)], [9, 1, 2, 8])
  new Uint8Array(backing)[0] = 7
  await assert.rejects(
    restoreRpcBinary(prepared.manifest, {
      storage: RpcBinaryStorage.native,
      sidecars: prepared.sidecars,
      limit: 32_768,
      digest,
      transferRequiresIntegrity: true
    }),
    { code: 'INVALID_ENVELOPE' }
  )
})

it('full backing overflow and invalid business graphs fail before digest work', async () => {
  /** Counting invokes the real digest only when graph and complete budget admission succeed. */
  let hashes = 0
  const observedDigest = async (backing: ArrayBuffer) => {
    hashes++
    return digest(backing)
  }
  const backing = new ArrayBuffer(16_385)
  await assert.rejects(
    prepareRpcBinary(envelope(new Uint8Array(backing, 100, 1)), {
      storage: RpcBinaryStorage.native,
      limit: 16_384,
      transferRequiresIntegrity: true,
      digest: observedDigest
    }),
    { code: 'INVALID_ENVELOPE' }
  )
  assert.equal(hashes, 0, 'tiny visible views cannot evade the full-backing limit')
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
  ['oversize-offset', ['uint8array', 16 * 1024 * 1024, 'AQ']],
  ['inline-native-reference', ['buffer', 0]]
])('inline decoder rejects %s before producing a semantic envelope', async (_name, payload) => {
  const prepared = await prepareRpcBinary(envelope(null), { storage: RpcBinaryStorage.inline })
  await assert.rejects(
    restoreRpcBinary(
      { ...prepared.manifest, envelope: { ...prepared.manifest.envelope, payload } },
      { storage: RpcBinaryStorage.inline }
    ),
    { code: 'INVALID_ENVELOPE' }
  )
})

it('binary graph normalization never executes an inherited array method', async () => {
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
  const prepared = await prepareRpcBinary(envelope(payload), { storage: RpcBinaryStorage.inline })
  const restored = await restoreRpcBinary(prepared.manifest, { storage: RpcBinaryStorage.inline })
  assert.equal(reads, 0, 'only the owned array elements enter the portable graph')
  assert.ok('payload' in restored)
  assert.deepEqual([...(restored.payload as Uint8Array[])[0]!], [1])
})

it('binary tuple/backing vectors preserve canonical restoration through the sole profile', async () => {
  /** Original tuple/backing vectors now carry the sole profile's complete semantic metadata. */
  for (const vector of vectors.valid) {
    const sidecars = vector.sidecars.map((bytes) => new Uint8Array(bytes).buffer)
    const storage = vector.value.storage as RpcBinaryStorage
    const restored = await restoreRpcBinary(vector.value, {
      storage: storage,
      sidecars: sidecars,
      digest: digest,
      transferRequiresIntegrity:
        'transferRequiresIntegrity' in vector ? vector.transferRequiresIntegrity : undefined
    })
    assert.equal(restored.profile, vectors.profile)
  }
  for (const vector of vectors.invalid) {
    const sidecars = vector.sidecars.map((bytes) => new Uint8Array(bytes).buffer)
    await assert.rejects(
      restoreRpcBinary(vector.value, {
        storage: vector.value.storage as RpcBinaryStorage,
        sidecars: sidecars,
        digest: digest,
        transferRequiresIntegrity:
          'transferRequiresIntegrity' in vector ? vector.transferRequiresIntegrity : undefined
      }),
      { code: 'INVALID_ENVELOPE' }
    )
  }
})

it('inline Uint8Array restoration materializes one backing including its zero prefix', async () => {
  const value = envelope(new Uint8Array([1, 2]))
  const prepared = await prepareRpcBinary(value, { storage: RpcBinaryStorage.inline })
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
    const restored = await restoreRpcBinary(manifest, { storage: RpcBinaryStorage.inline })
    assert.equal(allocations, 1, 'decode writes directly into the final backing')
    assert.ok('payload' in restored)
    const bytes = restored.payload as Uint8Array
    assert.equal(bytes.byteOffset, 3)
    assert.deepEqual([...new NativeUint8Array(bytes.buffer)], [0, 0, 0, 1, 2])
  } finally {
    vi.unstubAllGlobals()
  }
})
