/** Preserve original outbound transfer custody through the public namespace and real SDK codec. */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { createRpcBackingDigest, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.ts'

it('snapshots transfer once and sends the owned list only on the unchunked frame', async () => {
  /** The original opaque transfer member becomes a valid native backing without changing count. */
  const backing = new ArrayBuffer(1)
  /** Caller reads and physical observations belong to this single explicit test operation. */
  const operation = {
    transferReads: 0,
    transferLengthReads: 0,
    sent: [] as Array<{ value: IRpcCarrierFrame; transfer?: readonly ArrayBuffer[] }>
  }
  /** Observe the original caller array's length reads without changing its native members. */
  const transfer = new Proxy([backing], {
    get(target, property, receiver) {
      if (property === 'length') operation.transferLengthReads += 1
      return Reflect.get(target, property, receiver)
    }
  })
  /** Both existing endpoints execute the actual SDK JSON capture and restore chain. */
  const fixture = await connectedCoreHosts({}, { note: () => undefined }, () => undefined, {
    create: () => new RpcJsonCarrierCodec({ digest: createRpcBackingDigest() }),
    nativeBinary: true
  })
  /** The physical spy is installed after readiness so bootstrap has no transfer observations. */
  const physical = { original: fixture.pair[0].write, operation }
  /** Delegate the original carrier operation, including its real native handoff callback. */
  const write = vi.spyOn(fixture.pair[0], 'write').mockImplementation((value, options) => {
    physical.operation.sent.push({ value, transfer: options?.transfer })
    return physical.original(value, options)
  })
  try {
    /** One public getter must be captured once before the codec or native write can suspend. */
    const options = {
      timeout: false as const,
      get transfer() {
        operation.transferReads += 1
        if (operation.transferReads > 1) throw new Error('transfer reread')
        return transfer
      }
    }
    await fixture.a.memory.request('note', backing, options)
    expect(operation.transferReads).toBe(1)
    expect(operation.transferLengthReads).toBe(1)
    expect(operation.sent[0]?.transfer).not.toBe(transfer)
    expect(operation.sent[0]?.transfer).toEqual([transfer[0]])
    expect(Object.isFrozen(operation.sent[0]?.transfer)).toBe(true)
  } finally {
    write.mockRestore()
    await fixture.close()
  }
})

it('keeps the owned transfer snapshot through caller mutation and exposes the physical failure cause', async () => {
  /** These two actual backings preserve the original distinct caller-owned member identities. */
  const firstTransferable = new ArrayBuffer(1)
  /** The second backing remains independently identifiable after caller array mutation. */
  const secondTransferable = new ArrayBuffer(2)
  /** This later native backing must never replace an already accepted transfer member. */
  const laterTransferable = new ArrayBuffer(3)
  /** The public call borrows this original mutable list before taking transfer custody. */
  const callerTransfer = [firstTransferable, secondTransferable]
  /** Keep the exact native rejection as the original direct transport cause oracle. */
  const physicalFailure = new Error('physical send failed')
  /** The genuine SDK codec captures both original backings on the existing physical pair. */
  const fixture = await connectedCoreHosts({}, { note: () => undefined }, () => undefined, {
    create: () => new RpcJsonCarrierCodec({ digest: createRpcBackingDigest() }),
    nativeBinary: true
  })
  /** Hold the real carrier write before native handoff, matching the original pending send. */
  const operation = {
    original: fixture.pair[0].write,
    entered: deferred<void>(),
    completion: deferred<void>(),
    sent: [] as Array<{ value: IRpcCarrierFrame; transfer?: readonly ArrayBuffer[] }>
  }
  /** Rejecting this real write never invokes onWriteStart or delivers a fabricated business frame. */
  const write = vi
    .spyOn(fixture.pair[0], 'write')
    .mockImplementationOnce(async (value, options) => {
      operation.sent.push({ value, transfer: options?.transfer })
      operation.entered.resolve()
      await operation.completion.promise
      await operation.original(value, options)
    })
  /** Attach rejection observation immediately, before releasing the held physical completion. */
  const pending = fixture.a.memory.request('note', [firstTransferable, secondTransferable], {
    transfer: callerTransfer,
    timeout: false
  })
  /** This original result projection does not replace the caller's operation or native write. */
  const outcome = pending.then(
    () => undefined,
    (error: unknown) => error
  )
  try {
    await operation.entered.promise
    await vi.waitFor(() => expect(operation.sent).toHaveLength(1))
    callerTransfer.splice(0, callerTransfer.length, laterTransferable)
    expect(operation.sent[0]?.transfer).toEqual([firstTransferable, secondTransferable])
    expect(operation.sent[0]?.transfer?.[0]).toBe(firstTransferable)
    expect(operation.sent[0]?.transfer?.[1]).toBe(secondTransferable)
    expect(Object.isFrozen(operation.sent[0]?.transfer)).toBe(true)
    operation.completion.reject(physicalFailure)
    /** Preserve the original public code and direct cause identity without traversing wrappers. */
    const failure = await outcome
    expect(failure).toMatchObject({ code: RpcCoreErrorCode.transport })
    expect((failure as { cause?: unknown }).cause).toBe(physicalFailure)
  } finally {
    operation.completion.reject(physicalFailure)
    await outcome
    write.mockRestore()
    await fixture.close()
  }
})
