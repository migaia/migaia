import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { it } from 'vitest'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { RpcStreamLimit } from '@migaia/rpc-contract/protocol'
import { prepareRpcBinary, restoreRpcBinary, RpcBinaryStorage } from '../../dist/sdk/wire/binary.js'
import { RpcPortableCapture, hasRpcPortableBinary } from '../../dist/sdk/wire/portable.js'

/** Real new-profile task metadata keeps the original codec oracles independent of legacy grammar. */
function envelope(payload: unknown): IRpcEnvelope {
  return {
    profile: 'migaia.rpc/2',
    kind: 'call',
    id: 'binary-owner',
    route: { applicationVersion: '1', senderId: 'a', targetId: 'b', receiverId: 'b', sentAt: 0 },
    task: {
      mode: 'request',
      callerId: 'a',
      callerGeneration: { kind: 'session', value: 1, providerId: 'a' },
      targetGeneration: { kind: 'session', value: 1, providerId: 'b' },
      method: 'echo'
    },
    options: {},
    payload
  } as IRpcEnvelope
}

/** Actual whole-backing SHA-256 observes bytes outside a referenced view as the original codec did. */
async function digest(backing: ArrayBuffer): Promise<string> {
  return createHash('sha256').update(new Uint8Array(backing)).digest('hex')
}

it('C2-B01 captures inline bytes before returning and preserves view offset and own-key order', async () => {
  /** Prefix and suffix distinguish visible-byte capture from copying the complete backing. */
  const source = new Uint8Array([9, 1, 2, 8])
  /** The original business record order must survive both tag construction and restoration. */
  const payload = { z: new Uint8Array(source.buffer, 1, 2), a: ['buffer', 0] }
  /** Preparation captures inline input before its first Promise yield. */
  const pending = prepareRpcBinary(envelope(payload), { storage: RpcBinaryStorage.inline })
  source.fill(7)
  /** JSON serialization is the actual inline physical representation, not an alternate decoder. */
  const prepared = await pending
  assert.deepEqual(prepared.sidecars, [])
  /** The same original decoder restores exactly the captured bytes and insertion order. */
  const restored = await restoreRpcBinary(JSON.parse(JSON.stringify(prepared.manifest)), {
    storage: RpcBinaryStorage.inline
  })
  assert.ok('payload' in restored)
  /** Native visible boundaries and collision-shaped ordinary arrays remain separate. */
  const value = restored.payload as typeof payload
  assert.deepEqual(Object.keys(value), ['z', 'a'])
  assert.equal(value.z.byteOffset, 1)
  assert.deepEqual([...new Uint8Array(value.z.buffer)], [0, 1, 2])
  assert.deepEqual(value.a, ['buffer', 0])
  assert.ok(hasRpcPortableBinary(value))
})

it('C2-B02 retains original native backing aliases and checks invisible bytes with full digest', async () => {
  /** Only one original complete backing is physically eligible for transfer. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  /** Multiple supported views deliberately share that exact original backing. */
  const prepared = await prepareRpcBinary(
    envelope({
      buffer: backing,
      first: new Uint8Array(backing, 1, 2),
      second: new Uint8Array(backing, 2, 1)
    }),
    { storage: RpcBinaryStorage.native, limit: 1024, digest }
  )
  assert.equal(prepared.sidecars.length, 1)
  assert.equal(prepared.sidecars[0], backing)
  assert.equal(prepared.backingBytes, 4)
  /** Restore borrows the supplied original buffers rather than making transfer copies. */
  const restored = await restoreRpcBinary(prepared.manifest, {
    storage: RpcBinaryStorage.native,
    sidecars: prepared.sidecars,
    limit: 1024,
    digest
  })
  assert.ok('payload' in restored)
  /** Exact backing identity matters independently of byte equality. */
  const value = restored.payload as { buffer: ArrayBuffer; first: Uint8Array; second: Uint8Array }
  assert.equal(value.buffer, backing)
  assert.equal(value.first.buffer, value.second.buffer)
  assert.equal(value.first.byteOffset, 1)
  new Uint8Array(backing)[0] = 7
  await assert.rejects(
    restoreRpcBinary(prepared.manifest, {
      storage: RpcBinaryStorage.native,
      sidecars: prepared.sidecars,
      limit: 1024,
      digest
    }),
    { code: 'INVALID_ENVELOPE' }
  )
})

it('C2-B03 starts prehash and the first original digest synchronously, then hashes in backing order', async () => {
  /** Distinct original storage proves the digest order without a second transport fixture. */
  const first = new Uint8Array([3, 4]).buffer
  /** The later hash must wait for the original first Promise. */
  const second = new Uint8Array([5, 6]).buffer
  /** One explicit observation context holds only this operation's digest order and release. */
  const observed: { order: ArrayBuffer[]; release?: (value: string) => void } = { order: [] }
  /** Prehash must run once before the digest can detach or suspend the original buffers. */
  let before = 0
  /** The real codec owns synchronous capture and asynchronous completion together. */
  const pending = prepareRpcBinary(envelope({ first, second }), {
    storage: RpcBinaryStorage.native,
    digest: (backing) => {
      observed.order.push(backing)
      return backing === first
        ? new Promise<string>((resolve) => {
            observed.release = resolve
          })
        : digest(backing)
    },
    beforeDigest: () => {
      before++
      assert.equal(observed.order.length, 0)
    }
  })
  assert.equal(before, 1)
  assert.deepEqual(observed.order, [first])
  observed.release!(await digest(first))
  await pending
  assert.deepEqual(observed.order, [first, second])
})

it('C2-B04 rejects whole-backing overflow before any digest and never executes business accessors', async () => {
  /** A tiny visible view cannot hide a complete over-budget backing. */
  const backing = new ArrayBuffer(1025)
  /** Original expensive hash work is forbidden before the full graph is admitted. */
  let hashes = 0
  await assert.rejects(
    prepareRpcBinary(envelope(new Uint8Array(backing, 100, 1)), {
      storage: RpcBinaryStorage.native,
      limit: 1024,
      digest: (value) => {
        hashes++
        return digest(value)
      }
    }),
    { code: 'INVALID_ENVELOPE' }
  )
  assert.equal(hashes, 0)
  /** Own-data admission must reject this supported malformed boundary without calling its getter. */
  let reads = 0
  await assert.rejects(
    prepareRpcBinary(
      envelope({
        get bytes() {
          reads++
          return new Uint8Array([1])
        }
      }),
      {
        storage: RpcBinaryStorage.inline
      }
    ),
    { code: 'INVALID_ENVELOPE' }
  )
  assert.equal(reads, 0)
})

it('C2-B05 measures original stream bytes in the same codec walk, independently of base64 tuple size', async () => {
  /** This native value fits exactly even though its inline tagged/base64 spelling is larger. */
  const value = new Uint8Array(RpcStreamLimit.maxItemValueBytes)
  /** A real stream item uses the same task/route admission as an ordinary call. */
  const call = envelope(null)
  /** The canonical new event selects the existing stream item byte ceiling. */
  const frame = {
    profile: call.profile,
    kind: 'stream',
    id: call.id,
    route: call.route,
    task: { ...call.task, mode: 'stream' },
    stream: { event: 'item', seq: 0, value }
  } as IRpcEnvelope
  /** Successful inline restoration must use semantic value bytes, not the encoded tag graph. */
  const prepared = await prepareRpcBinary(frame, { storage: RpcBinaryStorage.inline })
  await restoreRpcBinary(prepared.manifest, { storage: RpcBinaryStorage.inline })
  await assert.rejects(
    prepareRpcBinary(
      {
        ...frame,
        stream: {
          event: 'item',
          seq: 0,
          value: new Uint8Array(value.length + 1)
        }
      } as IRpcEnvelope,
      { storage: RpcBinaryStorage.inline }
    ),
    { code: 'INVALID_ENVELOPE' }
  )
})

it('C2-B06 SDK proof is produced by the original serialize walker finish hook without copying backings', () => {
  /** Native leaf identity is borrowed while only its containing records/arrays are snapshotted. */
  const bytes = new Uint8Array([1, 2])
  /** Held SDK state owns the canonical executing walker and its actual binary proof. */
  const codec = new RpcPortableCapture()
  /** One original walker visit produces both normalized output and descendant proof. */
  const value = codec.normalize({ z: [bytes], a: 1 }) as { z: Uint8Array[]; a: number }
  assert.equal(value.z[0], bytes)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.z))
  assert.ok(hasRpcPortableBinary(value))
  assert.ok(hasRpcPortableBinary(value.z))
  assert.ok(hasRpcPortableBinary(bytes))
  assert.equal(hasRpcPortableBinary({ z: bytes }), false)
})
