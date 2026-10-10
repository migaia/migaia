import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../../rpc-integration/schema/vectors/runtime-api.json'
import { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import {
  prepareRpcBinary,
  restoreRpcBinary,
  type IRpcBinaryDataCodec
} from '@migaia/rpc-contract/binary'
import { RpcBinaryStorage } from '@migaia/rpc-contract/wire'
import { Buffer } from 'node:buffer'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { asCodecValue } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import { bindRpcFrameIngress } from '@migaia/rpc-contract/framing'
import { remoteProcessJsonCodec } from '../../dist/adapter-owned/process/pipeline.js'
import { remoteProcessStringFramer } from '@migaia/rpc-contract/framing'
import { proveFastComponents, readFastInlineEncoder } from '../../dist/core/internal/fast-path.js'
import {
  prepareOwnedBinaryJsonSnapshot,
  readOwnedJsonSnapshot,
  RpcOwnedBinaryAlphabet
} from '../../dist/core/internal/outbound-owned-codec.js'
import '../../dist/adapter-owned/process/node-byte-stream.js'
import type { IRpcSelectedComponents } from '../../dist/core/internal/endpoint-options.js'

/** Original task/route vectors supply the complete normative metadata rather than a fake endpoint. */
const envelope = (payload: unknown) => normalizeRuntimeEnvelope({ ...vectors.valid[0], payload })

/** A real full-backing digest proves that invisible bytes participate in native integrity. */
const digest = async (backing: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(backing)).digest('hex')

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
        new (class implements IRpcBinaryDataCodec {
          /** Hold the same actual process codec used by the original encoding assertion. */
          encode(value: unknown): unknown {
            return remoteProcessJsonCodec.encode(value)
          }
          /** Exact selected-components provenance supplies the unchanged native byte intrinsic. */
          readonly encodeInline = encodeInline
          /** This Core-owned data resource retains the original metadata and binary-root bounds. */
          captureJsonData(manifest: object, roots: ReadonlyMap<object, number>): unknown {
            return prepareOwnedBinaryJsonSnapshot(manifest, roots)
          }
        })()
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
    new (class implements IRpcBinaryDataCodec {
      /** Observe only the first native metadata capture at the original prehash point. */
      #prehashObserved = false
      /** Hold the original codec whose immutable JSON snapshot is under observation. */
      encode(value: unknown): unknown {
        return remoteProcessJsonCodec.encode(value)
      }
      /** Retain actual metadata and prove capture precedes every original native digest. */
      captureJsonData(
        manifest: object,
        roots: ReadonlyMap<object, number>,
        bytes: number
      ): unknown {
        const retained = prepareOwnedBinaryJsonSnapshot(manifest, roots)
        if (!this.#prehashObserved) {
          this.#prehashObserved = true
          beforeDigest++
          assert.equal(order.length, 0)
          assert.equal(bytes, 6)
          assert.ok(readOwnedJsonSnapshot(manifest))
        }
        return retained
      }
    })()
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
