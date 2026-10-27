import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../schema/vectors/core-profile.json'
import {
  prepareRpcBinary,
  restoreRpcBinary,
  RpcBinaryStorage,
  RpcJsonCarrierCodec
} from '@migaia/rpc-host/sdk'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { Buffer } from 'node:buffer'

/** Original task/route vectors supply the complete normative metadata rather than a fake endpoint. */
const envelope = (payload: unknown): IRpcEnvelope =>
  ({
    ...vectors.valid.find(
      (value) => value.frame.kind === 'call' && value.frame.task?.mode === 'request'
    )!.frame,
    payload
  }) as IRpcEnvelope

/** A real full-backing digest proves that invisible bytes participate in native integrity. */
const digest = async (backing: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(backing)).digest('hex')

for (const size of [64 * 1024, 1024 * 1024]) {
  it(`${size} owned inline bytes encode natively once without a second business walk`, async () => {
    /** The actual SDK executes preparation and encoding; native process acquisition moves to C3. */
    const codec = new RpcJsonCarrierCodec()
    /** The caller lends its actual native byte intrinsic through the public codec option. */
    const encodeInline = (bytes: Uint8Array): string =>
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url')
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
      if (args[0] === 'base64url') nativeCalls++
      return Reflect.apply(original, this, args)
    })
    try {
      /** The original visitor reports its exact constructed roots without a second business walk. */
      const captures: Array<{ manifest: object; roots: ReadonlyMap<object, number> }> = []
      const prepared = await prepareRpcBinary(input, {
        storage: RpcBinaryStorage.inline,
        encoding: {
          encodeInline,
          capture(manifest, roots) {
            captures.push({ manifest, roots })
          }
        }
      })
      /** The callback observes the published manifest and its actual encoded business root. */
      assert.equal(captures.length, 1)
      assert.equal(captures[0]!.manifest, prepared.manifest)
      assert.ok('payload' in prepared.manifest.envelope)
      assert.ok(captures[0]!.roots.has(prepared.manifest.envelope.payload as object))
      /** Preserves admitted key order in the new canonical JSON codec, without legacy sorting. */
      const encoded = codec.encode(
        {
          message: prepared.manifest.envelope,
          manifest: prepared.manifest,
          sidecars: prepared.sidecars
        },
        { codec: 'json', nativeBinary: false, maxFrameBytes: 16 * 1024 * 1024 }
      ).data
      assert.equal(encoded, JSON.stringify(prepared.manifest))
      assert.equal(nativeCalls, 1, 'real native base64 once per binary leaf')
      assert.ok(Buffer.byteLength(encoded as string) <= 16 * 1024 * 1024)
      /** The shipped restore owner decides offset, zero-prefix, text and visible byte equality. */
      const restored = await restoreRpcBinary(JSON.parse(encoded as string), {
        storage: RpcBinaryStorage.inline
      })
      assert.ok('payload' in restored)
      const payload = restored.payload as { z: Uint8Array; a: string }
      assert.equal(payload.z.byteOffset, 2)
      assert.equal(payload.z.buffer.byteLength, size + 2)
      assert.deepEqual(new Uint8Array(payload.z.buffer, 0, 2), new Uint8Array(2))
      assert.deepEqual(payload.z, new Uint8Array(backing.buffer, 2, size))
      assert.equal(payload.a, '汉字\ud83d')
      assert.deepEqual(Object.keys(payload), ['z', 'a'])
    } finally {
      native.mockRestore()
    }
  })
}

it('private owned capture preserves public preparation shape and native digest order', async () => {
  /** Two actual backings distinguish sequential digest order from view alias handling. */
  const firstBytes = new Uint8Array(16_385)
  firstBytes.set([9, 1, 2, 8])
  /** Only integrity assertions use above-threshold complete native storage. */
  const first = firstBytes.buffer
  const secondBytes = new Uint8Array(16_386)
  secondBytes.set([3, 4])
  const second = secondBytes.buffer
  /** All preparation paths share the original admitted semantic source. */
  const input = envelope({ first, view: new Uint8Array(first, 1, 2), second })
  /** The same source without an internal capture retains the public result geometry. */
  const ordinary = await prepareRpcBinary(input, {
    storage: RpcBinaryStorage.native,
    digest,
    transferRequiresIntegrity: true
  })
  /** Only actual digest invocations enter this ordered record. */
  const order: ArrayBuffer[] = []
  /** Prehash must occur once before the first real digest starts. */
  let beforeDigest = 0
  /** Prehash callbacks must see the exact preceding capture, without v1 private snapshot stamps. */
  const captured: object[] = []
  const prepared = await prepareRpcBinary(input, {
    storage: RpcBinaryStorage.native,
    transferRequiresIntegrity: true,
    digest: async (backing) => {
      order.push(backing)
      return digest(backing)
    },
    encoding: {
      capture(manifest, roots) {
        assert.ok(roots.size > 0)
        captured.push(manifest)
      }
    },
    beforeDigest(manifest, bytes) {
      beforeDigest++
      assert.equal(order.length, 0)
      assert.equal(bytes, 32_771)
      assert.equal(captured.at(-1), manifest)
    }
  })
  assert.equal(beforeDigest, 1)
  assert.deepEqual(order, [first, second])
  assert.deepEqual(prepared, ordinary)
  assert.deepEqual(Object.keys(prepared), Object.keys(ordinary))
  assert.deepEqual(Object.keys(prepared.manifest), Object.keys(ordinary.manifest))
  assert.equal(Object.getPrototypeOf(prepared.manifest), Object.getPrototypeOf(ordinary.manifest))
  assert.equal(captured.at(-1), prepared.manifest)
  /** Native signer input keeps the original tuple mutability; only its sizing facts are retained. */
  assert.ok('payload' in prepared.manifest.envelope)
  assert.equal(Object.isFrozen(prepared.manifest.envelope.payload), false)
})
