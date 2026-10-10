import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../schema/vectors/runtime-api.json'
import { prepareRpcBinary, restoreRpcBinary } from '../../src/contract/runtime-api/binary.js'
import { RpcBinaryStorage } from '../../src/contract/runtime-api/binary-constants.js'
import { normalizeRuntimeEnvelope } from '../../src/contract/runtime-api/normalize.js'
import { assertRpcPhysicalFrameSize } from '../../src/contract/batch-frame.js'
import {
  wrapAuthenticationEnvelope,
  readAuthenticationEnvelope
} from '../../src/core/middleware/authentication-envelope.js'
import * as bytes from '@migaia/utils/bytes'

/**
 * H11 installs the unchanged A21 binary/profile portion; chunk and physical-batch cases belong to
 * C7.
 */
/** A real native digest retains every original backing byte, including view-external bytes. */
const digest = async (value: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(value)).digest('hex')
/** String classes exercise actual JSON escaping and UTF-8 fallback without byte estimates. */
const textClasses = ['ASCII', '汉字', '\ud83d\ude42', '\ud83d'] as const

for (const storage of [RpcBinaryStorage.inline, RpcBinaryStorage.native]) {
  for (const text of textClasses) {
    for (const members of [2, 16]) {
      it(`[A21] ${storage} ${JSON.stringify(text)} ${members} members keep codec and auth grammar`, async () => {
        /** The actual source graph shares one full backing across its business views. */
        const backing = new Uint8Array([9, 1, 2, 8]).buffer
        /** Canonical group metadata is the independent schema vector, not a new wire shape. */
        const template = vectors.valid.find((value) => value.kind === 'runtime-group')!
        /** Every group member drives the real binary producer and recursive restoration. */
        const envelope = normalizeRuntimeEnvelope({
          ...template,
          steps: Array.from({ length: members }, (_, index) => ({
            method: `echo-${index}`,
            payload: { text, bytes: new Uint8Array(backing, 1, 2) }
          }))
        })
        /** Only the actual necessary byte codec calls are counted. */
        const encode = vi.spyOn(bytes, 'bytesToBase64')
        const decode = vi.spyOn(bytes, 'base64ToBytes')
        try {
          /** Admission completes at the original owner before the actual codec awaits. */
          const prepared = await prepareRpcBinary(envelope, storage, 1024 * 1024, digest)
          /** Both signed representations must roundtrip their whole wrapper before restoration. */
          for (const auth of [false, true]) {
            const serialized = JSON.stringify(prepared.manifest)
            const protectedValue = auth
              ? wrapAuthenticationEnvelope(serialized, 'a'.repeat(32), 1n)
              : serialized
            const decodedValue = auth
              ? readAuthenticationEnvelope(protectedValue).payload
              : protectedValue
            assert.equal(
              decodedValue,
              serialized,
              '[A21] auth preserves complete signed representation'
            )
            assertRpcPhysicalFrameSize(protectedValue, 1024 * 1024)
            const restored = await restoreRpcBinary(
              JSON.parse(decodedValue as string),
              storage,
              prepared.sidecars,
              1024 * 1024,
              digest
            )
            assert.equal(restored.kind, 'runtime-group')
            if (!('steps' in restored))
              assert.fail('[A21] actual group business must remain a group')
            assert.equal(restored.steps.length, members)
            for (const step of restored.steps) {
              const payload = step.payload as { text: string; bytes: Uint8Array }
              assert.equal(payload.text, text)
              assert.deepEqual(
                [...payload.bytes],
                [1, 2],
                '[A21] business bytes before codec cost assertion'
              )
              if (storage === RpcBinaryStorage.native) assert.equal(payload.bytes.buffer, backing)
            }
          }
          assert.equal(
            encode.mock.calls.length,
            storage === RpcBinaryStorage.inline ? members : 0,
            '[A21] inline each binary leaf encodes once; native never forces base64'
          )
          assert.equal(
            decode.mock.calls.length,
            storage === RpcBinaryStorage.inline ? members * 2 : 0,
            '[A21] each of two real restores decodes each inline leaf once'
          )
        } finally {
          encode.mockRestore()
          decode.mockRestore()
        }
      })
    }
  }
}
