import assert from 'node:assert/strict'
import { it } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type { IRpcSemanticFrame, IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { header } from '../../../rpc-contract/test/fixtures/core-profile.js'
import { prepareRpcBinary, RpcBinaryStorage } from '../../dist/sdk/wire/binary.js'

it('A43 rejects depth64 repeated references during capture within the frame byte budget', async () => {
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
