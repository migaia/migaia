import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../schema/vectors/core-profile.json'
import { RpcBinaryStorage, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { encodeRpcStreamTextFrame } from '../../../rpc-host/dist/sdk/wire/physical-stream.js'
import { RpcAuthenticationFlow } from '../../../rpc-host/dist/features/auth/flow.js'
import { FlowPipeline } from '../../../rpc-host/dist/flow/pipeline.js'
import { joinRpcPreparedMetadata } from '../../../rpc-host/dist/sdk/carrier/prepared.js'
import * as bytes from '@migaia/utils/bytes'

/** A real native digest retains every original backing byte, including view-external bytes. */
const digest = async (value: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(value)).digest('hex')

/** String classes exercise actual JSON escaping and UTF-8 fallback without byte estimates. */
const textClasses = ['ASCII', '汉字', '\ud83d\ude42', '\ud83d'] as const

for (const storage of [RpcBinaryStorage.inline, RpcBinaryStorage.native]) {
  for (const text of textClasses) {
    for (const members of [2, 16]) {
      it(`${storage} ${JSON.stringify(text)} ${members} members keep codec and auth grammar`, async () => {
        /** The actual source graph shares one full backing across its business views. */
        const backing = new Uint8Array([9, 1, 2, 8]).buffer
        /** Canonical group metadata is the independent schema vector, not a new wire shape. */
        const template = vectors.valid.find((value) => value.frame.kind === 'group')!.frame
        /** Every group member drives the real binary producer and recursive restoration. */
        const envelope = {
          ...template,
          steps: Array.from({ length: members }, (_, index) => ({
            method: `echo-${index}`,
            payload: { text, bytes: new Uint8Array(backing, 1, 2) }
          }))
        } as IRpcEnvelope
        /** Only the actual necessary byte codec calls are counted. */
        const encode = vi.spyOn(bytes, 'bytesToBase64')
        const decode = vi.spyOn(bytes, 'base64ToBytes')
        try {
          /** The actual media codec owns the sole preparation and its retained restore cache. */
          const codec = new RpcJsonCarrierCodec({ digest })
          /** Native capability comes from the real codec context, independent from transfer lists. */
          const context = {
            codec: 'json',
            nativeBinary: storage === RpcBinaryStorage.native,
            maxFrameBytes: 1024 * 1024
          }
          /** Actual binary preparation runs once before either protected transport representation. */
          const prepared = await codec.prepare(envelope, context)
          /** Both complete physical representations pass the installed flow hooks and real parser. */
          for (const auth of [false, true]) {
            /** Each physical source owns its actual authentication nonce/window and cleanup signal. */
            const controller = new AbortController()
            /** The original preservation oracle protects bytes, without substituting cryptography. */
            const authentication = new RpcAuthenticationFlow(
              auth ? { sign: (value) => value, verify: (value) => value } : {},
              controller.signal
            )
            /** Production stage composition invokes the actual installed authentication handlers. */
            const flow = new FlowPipeline((error) => {
              throw error
            })
            flow.register({ name: 'auth', ...authentication.value })
            flow.start()
            try {
              /** The codec cache joins auth's integrity check and final semantic restoration. */
              const flowContext = {
                namespace: 'test',
                carrierId: 'physical',
                signal: controller.signal,
                report(error: unknown) {
                  throw error
                },
                restore: (value: Parameters<typeof codec.restore>[0]) =>
                  codec.restore(value, context)
              }
              const protectedValue = await flow.envelope(prepared, {
                ...flowContext,
                direction: 'outbound'
              })
              const wire = codec.encode(protectedValue, context)
              assert.equal(typeof wire.data, 'string')
              const framed = encodeRpcStreamTextFrame(wire.data as string, new TextEncoder())
              assert.ok(framed.byteLength - 4 <= 1024 * 1024)
              const decoded = codec.decode(wire, context)
              const inner = await flow.envelope(decoded, {
                ...flowContext,
                direction: 'inbound'
              })
              assert.equal(
                JSON.stringify(joinRpcPreparedMetadata(inner)),
                JSON.stringify(joinRpcPreparedMetadata(prepared)),
                'auth preserves complete signed representation'
              )
              const restored = await codec.restore(inner, context)
              assert.equal(restored.kind, 'group')
              if (!('steps' in restored)) assert.fail('actual group business must remain a group')
              assert.equal(restored.steps.length, members)
              for (const step of restored.steps) {
                const payload = step.payload as { text: string; bytes: Uint8Array }
                assert.equal(payload.text, text)
                assert.deepEqual(
                  [...payload.bytes],
                  [1, 2],
                  'business bytes before codec cost assertion'
                )
                if (storage === RpcBinaryStorage.native) assert.equal(payload.bytes.buffer, backing)
              }
            } finally {
              authentication.close()
              controller.abort()
            }
          }
          assert.equal(
            encode.mock.calls.length,
            storage === RpcBinaryStorage.inline ? members : 0,
            'inline each binary leaf encodes once; native never forces base64'
          )
          assert.equal(
            decode.mock.calls.length,
            storage === RpcBinaryStorage.inline ? members * 2 : 0,
            'each of two real restores decodes each inline leaf once'
          )
        } finally {
          encode.mockRestore()
          decode.mockRestore()
        }
      })
    }
  }
}
