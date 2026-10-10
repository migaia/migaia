import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it, vi } from 'vitest'
import vectors from '../../schema/vectors/runtime-api.json'
import { prepareRpcBinary, restoreRpcBinary } from '../../src/contract/runtime-api/binary.js'
import { RpcBinaryStorage } from '../../src/contract/runtime-api/binary-constants.js'
import { normalizeRuntimeEnvelope } from '../../src/contract/runtime-api/normalize.js'
import { assertRpcPhysicalFrameSize } from '../../src/contract/batch-frame.js'
import {
  createBinaryFramer,
  createStringFramer
} from '../../src/contract/framing/message-framer.js'
import type { IRpcBinaryFrame } from '../../src/contract/types.js'
import {
  wrapAuthenticationEnvelope,
  readAuthenticationEnvelope
} from '../../src/core/middleware/authentication-envelope.js'
import * as bytes from '@migaia/utils/bytes'

/** H11 installs the unchanged A21 binary/profile portion; C7 retains its original chunk oracle. */
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

for (const chunks of [2, 4]) {
  it(`[A21] ${chunks} binary chunks preserve source order and copy each final byte once`, () => {
    /** The real framer owns buffer, terminal history and timer disposal. */
    const timers = new Map<number, () => void>()
    /** Timer tokens are fixture bookkeeping, never a second reassembler. */
    let token = 0
    /** One assembly slot makes the original buffer ownership observable. */
    const framer = createBinaryFramer({
      chunkBytes: 2,
      maxConcurrentMessages: 1,
      schedule: (task) => {
        timers.set(++token, task)
        return token
      },
      cancel: (timer) => {
        timers.delete(timer as number)
      }
    })
    /** Sender-side slices are completed before observing receiver-side copies. */
    const expected = Uint8Array.from({ length: chunks * 2 }, (_, index) => index + 1)
    /** The source and message identity remain part of the physical contract. */
    const context = { source: 'source-a', messageId: `copy-${chunks}` }
    /** Actual frames, not a second fixture reassembler, drive the production accept path. */
    const frames = framer.frame(expected, context)
    /** A copied byte is counted only at the real intrinsic set producer. */
    let copied = 0
    /** Keep the intrinsic receiver semantics while counting each copied source byte. */
    const originalSet = Uint8Array.prototype.set
    /** Observe the owning framer's final copies, not sender-side slicing. */
    const set = vi.spyOn(Uint8Array.prototype, 'set').mockImplementation(function (
      this: Uint8Array,
      value: ArrayLike<number>,
      offset?: number
    ) {
      copied += value.length
      return Reflect.apply(originalSet, this, [value, offset])
    })
    try {
      for (let index = 0; index < frames.length; index++) {
        /** Business success is checked before assigning any cost credit. */
        const result = framer.accept(frames[index]!, context)
        if (index < frames.length - 1) assert.equal(result.status, 'pending')
        else {
          assert.equal(
            result.status,
            'complete',
            '[A21] real reassembly succeeds before copy guard'
          )
          if (result.status === 'complete') assert.deepEqual([...result.value], [...expected])
        }
      }
      assert.equal(timers.size, 0, '[A21] complete owner releases its timer')
      /** A completed message stays terminal at its original source. */
      const late = framer.accept(frames[0]!, context)
      assert.equal(late.status, 'rejected')
      if (late.status === 'rejected') assert.equal(Reflect.get(late.error, 'code'), 'INVALID_FRAME')
      assert.equal(
        copied,
        expected.byteLength,
        '[A21] single-copy physical message; cumulative concat is a real cost RED'
      )
    } finally {
      set.mockRestore()
      framer.close()
    }
  })
}

for (const declared of [3, 5]) {
  it(`[A21] binary actual length4 versus declared${declared} retains INVALID_FRAME and exact cleanup`, () => {
    /** One real buffer slot makes release observable through the next accepted message. */
    const timers = new Map<number, () => void>()
    /** Native timer tokens stay separate from physical message IDs. */
    let token = 0
    /** Small limits expose release of both active slots and buffered bytes. */
    const framer = createBinaryFramer({
      chunkBytes: 2,
      maxConcurrentMessages: 1,
      maxBufferedBytes: 8,
      maxMessageBytes: 8,
      schedule: (task) => {
        timers.set(++token, task)
        return token
      },
      cancel: (timer) => {
        timers.delete(timer as number)
      }
    })
    /** Both under-declared and over-declared completion use the same original error. */
    const context = { source: 'source-a', messageId: `declared-${declared}` }
    /** Valid fragments provide independent payload bytes before corrupting metadata. */
    const parts = framer.frame(new Uint8Array([1, 2, 3, 4]), context) as IRpcBinaryFrame[]
    /** Every fragment advertises the same malformed total length. */
    const corrupt = parts.map((part) => ({ ...part, length: declared }))
    assert.equal(framer.accept(corrupt[0]!, context).status, 'pending')
    /** Capture the result to distinguish contract rejection from a native set exception. */
    let rejected: ReturnType<typeof framer.accept> | undefined
    assert.doesNotThrow(() => {
      rejected = framer.accept(corrupt[1]!, context)
    }, '[A21] declared length never replaces INVALID_FRAME with native RangeError')
    assert.ok(rejected)
    assert.equal(
      rejected.status,
      'rejected',
      '[A21] malformed complete bytes cannot become padded success or RangeError'
    )
    if (rejected.status === 'rejected') {
      assert.equal(Reflect.get(rejected.error, 'code'), 'INVALID_FRAME')
      assert.equal(rejected.error.name, 'RangeError')
    }
    assert.equal(timers.size, 0)
    /** A different source can reuse the released slot and global byte allowance. */
    const replacement = { source: 'source-b', messageId: 'same-id-after-release' }
    /** Unmodified replacement bytes establish cleanup through the public boundary. */
    const valid = framer.frame(new Uint8Array([5, 6, 7, 8]), replacement)
    assert.equal(
      framer.accept(valid[0]!, replacement).status,
      'pending',
      '[A21] both global bytes and active slot were released'
    )
    assert.equal(framer.accept(valid[1]!, replacement).status, 'complete')
    assert.equal(timers.size, 0)
    assert.equal(
      framer.accept(corrupt[0]!, context).status,
      'rejected',
      '[A21] original source remains terminal'
    )
    framer.close()
  })
}

it('[A21] terminal eviction remains source-qualified insertion order and expiration remains distinct', () => {
  /** Source/message tuple collisions are impossible because the original owner uses nested Maps. */
  const timers = new Map<number, () => void>()
  /** Each timer token identifies the real canonical assembly callback. */
  let token = 0
  /** A capacity of one fixes the recent-terminal history at two messages. */
  const framer = createBinaryFramer({
    chunkBytes: 1,
    maxConcurrentMessages: 1,
    schedule: (task) => {
      timers.set(++token, task)
      return token
    },
    cancel: (timer) => {
      timers.delete(timer as number)
    }
  })
  for (const source of ['a', 'b', 'c']) {
    /** Identical message IDs must not collapse distinct opaque sources. */
    const context = { source, messageId: 'same-message' }
    /** Original public fragmentation retains the source-qualified completion sequence. */
    const parts = framer.frame(new Uint8Array([1, 2]), context)
    assert.equal(framer.accept(parts[0]!, context).status, 'pending')
    assert.equal(framer.accept(parts[1]!, context).status, 'complete')
  }
  /** The first source is now the oldest terminal beyond the capacity of two. */
  const evicted = { source: 'a', messageId: 'same-message' }
  /** Eviction permits the original message identity to start a fresh assembly. */
  const restarted = framer.frame(new Uint8Array([3, 4]), evicted)
  assert.equal(
    framer.accept(restarted[0]!, evicted).status,
    'pending',
    '[A21] oldest of capacity2 terminals is evicted'
  )
  for (const task of timers.values()) task()
  /** Expiration stays distinct from ordinary terminal rejection. */
  const expired = framer.accept(restarted[1]!, evicted)
  assert.equal(expired.status, 'rejected')
  if (expired.status === 'rejected')
    assert.equal(Reflect.get(expired.error, 'code'), 'FRAME_ASSEMBLY_EXPIRED')
  /** Completing a fresh source does not evict the newest prior source. */
  const retained = { source: 'c', messageId: 'same-message' }
  assert.equal(
    framer.accept(framer.frame(new Uint8Array([3, 4]), retained)[0]!, retained).status,
    'rejected'
  )
  framer.close()
  assert.equal(timers.size, 0)
})

it('[A21] split surrogate strings use original joined lengthOf', () => {
  /** One UTF-16 unit per chunk splits the surrogate pair at the real framer boundary. */
  const framer = createStringFramer({ chunkBytes: 1 })
  /** String completion retains the original physical source and message ID. */
  const context = { source: 'string-source', messageId: 'surrogate' }
  /** Joined text, not a sum of independently encoded fragments, decides the original length. */
  const parts = framer.frame('🙂', context)
  assert.equal(parts.length, 2)
  assert.equal(framer.accept(parts[0]!, context).status, 'pending')
  /** The string result keeps the original lengthOf check after joining. */
  const joined = framer.accept(parts[1]!, context)
  assert.equal(joined.status, 'complete')
  if (joined.status === 'complete') assert.equal(joined.value, '🙂')
  framer.close()
})
