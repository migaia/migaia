import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type { IRpcSemanticFrame, IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { header } from '../../../rpc-contract/test/fixtures/core-profile.js'
import { prepareRpcBinary, RpcBinaryStorage } from '../../dist/sdk/wire/binary.js'
import { utf8ByteLength } from '@migaia/utils/bytes'

it('captures ordinary and binary values without stringifying their scalars, keys or metadata', async () => {
  /** Exact encoded bytes define a supported in-budget message independently of the capture estimate. */
  const frame = {
    ...header(),
    options: {},
    payload: { '保留🙂': ['"\\\n', false, null, 1e100] }
  } as IRpcSemanticFrame
  /** The final real JSON spelling includes escapes, Unicode, metadata and short number literals. */
  const maxFrameBytes = utf8ByteLength(JSON.stringify(frame))
  /** The actual public codec performs its ordinary capture and its separate binary leaf capture. */
  const codec = new RpcJsonCarrierCodec()
  /** Observe the original global serializer while preserving every original return and exception. */
  const stringify = vi.spyOn(JSON, 'stringify')
  /** Capture results are retained only for ordinary business assertions after restoring the spy. */
  let prepared: Awaited<ReturnType<RpcJsonCarrierCodec['prepare']>>
  /** Only prepare calls are counted; the final encode remains the sole real serialization owner. */
  let calls: number
  try {
    prepared = await codec.prepare(frame, { codec: 'json', nativeBinary: false, maxFrameBytes })
    await codec.prepare(
      { ...header(), options: {}, payload: new Uint8Array([1, 2]) } as IRpcSemanticFrame,
      { codec: 'json', nativeBinary: false, maxFrameBytes: 1024 }
    )
    calls = stringify.mock.calls.length
  } finally {
    stringify.mockRestore()
  }
  assert.equal(calls, 0, 'capture performs no scalar, key, binary-tag or metadata serialization')
  assert.equal(prepared.manifest, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.message)), frame)
})

it('checks actual encoded UTF-8 length after a lower-bound capture admits escaped and Unicode input', async () => {
  /** An all-escaped string has a small lower bound but a larger actual JSON representation. */
  const frame = {
    ...header(),
    options: {},
    payload: { text: '\n'.repeat(128) + '保留🙂'.repeat(32) }
  } as IRpcSemanticFrame
  /** The same actual codec retains its one encoding execution after preparation. */
  const codec = new RpcJsonCarrierCodec()
  /** This valid whole frame fits exactly when its real UTF-8 bytes are admitted. */
  const bytes = utf8ByteLength(JSON.stringify(frame))
  /** Both contexts exceed the cheap graph lower bound but differ at the actual byte boundary. */
  const context = { codec: 'json', nativeBinary: false, maxFrameBytes: bytes }
  const prepared = await codec.prepare(frame, context)
  assert.equal(utf8ByteLength(codec.encode(prepared, context).data as string), bytes)
  assert.throws(() => codec.encode(prepared, { ...context, maxFrameBytes: bytes - 1 }), {
    source: 'rpc.contract',
    code: 'FRAME_LIMIT_EXCEEDED'
  })
})

it('rejects depth64 repeated references during capture within the frame byte budget', async () => {
  /** The actual public media codec owns capture before encoding or any physical write. */
  const codec = new RpcJsonCarrierCodec()
  /** Getter visits bound the original traversal without permitting exponential pre-fix work. */
  let visits = 0
  /** A finite sentinel makes the original defect fail with its wrong diagnostic. */
  const sentinel = new Error('capture exceeded fixture visit allowance')
  /** Each of sixty-four levels repeats the same child, retaining ordinary JSON alias semantics. */
  let payload: unknown = 'leaf'
  for (let depth = 0; depth < 64; depth++) {
    /** This level captures its child independently from later fixture construction. */
    const child = payload
    payload = {
      get left() {
        if (++visits > 4096) throw sentinel
        return child
      },
      get right() {
        if (++visits > 4096) throw sentinel
        return child
      }
    }
  }
  /** The supported request metadata leaves only the portable slot intentionally unadmitted. */
  const frame = { ...header(), options: {}, payload } as IRpcSemanticFrame
  await assert.rejects(
    codec.prepare(frame, { codec: 'json', nativeBinary: false, maxFrameBytes: 1024 }),
    { code: 'FRAME_LIMIT_EXCEEDED' }
  )
  assert.ok(visits < 4096, 'byte admission terminates before the fixture visit guard')
  /** Small repeated references keep their independently expanded JSON output and getter order. */
  const shared = { text: '保留🙂' }
  const small = await codec.prepare(
    { ...header(), options: {}, payload: { left: shared, right: shared } } as IRpcSemanticFrame,
    { codec: 'json', nativeBinary: false, maxFrameBytes: 1024 }
  )
  assert.equal(small.manifest, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(small.message)).payload, {
    left: shared,
    right: shared
  })
  /** The explicit binary SDK retains this same canonical frame failure instead of a shape wrapper. */
  await assert.rejects(
    prepareRpcBinary({ ...header(), options: {}, payload: 'x'.repeat(1025) } as IRpcEnvelope, {
      storage: RpcBinaryStorage.inline,
      limit: 1024
    }),
    { source: 'rpc.contract', code: 'FRAME_LIMIT_EXCEEDED' }
  )
})
