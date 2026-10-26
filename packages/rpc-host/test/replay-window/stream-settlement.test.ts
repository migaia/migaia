/** Genuine Auth capacity retains a stream through its actual iterator and physical terminal work. */
import { createRpcHost } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/plugins/auth'
import { defineFlowFeature, RpcFlowPoint, type IRpcFlowStage } from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProviderRejectionReason } from '@migaia/rpc-contract/errors'
import { RpcStreamEvent, RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { RequestReplayLedger } from '../../dist/features/auth/request-replay.js'
import { coreMemoryServer } from '../host/core-fixture.js'
import type { MemoryCarrier } from '../fixtures/core-carrier.js'

it('retains legacy stream admission through next, return and terminal physical completion', async () => {
  /** Original business entry alone changes this count; rejection callbacks cannot increment it. */
  const state = { starts: 0, carrier: undefined as MemoryCarrier | undefined }
  /** The actual iterator independently holds its original next and return operations. */
  const next = deferred<IteratorResult<never>>()
  /** Iterator cleanup remains held even after the public consumer sends its real cancellation. */
  const returned = deferred<IteratorResult<never>>()
  /** Entry receipts observe genuine producer callbacks without executing another iterator. */
  const nextEntered = deferred<void>()
  /** Cancellation must reach the same original iterator before its cleanup is released. */
  const returnEntered = deferred<void>()
  /** A genuine outbound stage identifies the semantic terminal before Auth protects it. */
  const terminal = deferred<void>()
  /** Native refusal classification proves Auth capacity independently from the provider table. */
  const rejected: string[] = []
  /** Every public refusal remains observed while a prior real physical write is held. */
  const refusals: Promise<unknown>[] = []
  /** The original iterator owns both finite application waits. */
  const iterator: AsyncIterableIterator<never> = {
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      nextEntered.resolve()
      return next.promise
    },
    return() {
      returnEntered.resolve()
      return returned.promise
    }
  }
  /** This plaintext callback uses the existing native carrier gate, never decodes protected data. */
  const holdTerminal: IRpcFlowStage<'envelopeOutbound'> = (payload, continuation) => {
    /** The fixture's original identity codec lends this actual prepared semantic message. */
    const message = payload.prepared.message as IRpcSemanticFrame
    if (message.kind === RpcWireKind.stream && message.stream.event === RpcStreamEvent.cancelled) {
      state.carrier!.holdWrites()
      terminal.resolve()
    }
    return continuation(payload)
  }
  /** Native registration places this original callback before the authentic Auth transform. */
  const terminalGate = defineFlowFeature({
    name: 'stream-retention-physical-terminal',
    setup: () => ({ stages: { [RpcFlowPoint.envelopeOutbound]: holdTerminal } })
  })
  /** One genuine listener owns the original Session and its readonly physical identity. */
  const server = coreMemoryServer('server')
  /** Only the authentic bounded Auth ledger decides whether a fresh request is admitted. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      auth({
        sign: (value) => value,
        verify: (value) => value,
        retain: 310_000,
        maxReplayEntriesPerPeer: 1,
        onRejected: (rejection) => {
          rejected.push(rejection.reason)
        }
      }),
      terminalGate,
      server.transport
    ],
    provide: {
      held: () => {
        state.starts += 1
        return iterator
      },
      probe: () => ++state.starts
    }
  })
  /** The opposite public Host supplies every real opening, credit, cancellation and fresh id. */
  const client = await server.connect('peer', {
    plugins: [auth({ sign: (value) => value, verify: (value) => value })]
  })
  state.carrier = client.pair[0]
  /** The original native clock input is controlled only after both real handshakes have finished. */
  let now = Math.trunc(performance.now())
  /** This is deterministic expiry input, not wall-clock or performance evidence. */
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  /** Default passthrough observes actual terminal physical entry without another transport. */
  const writing = vi.spyOn(state.carrier, 'write')
  /** The same original ledger reports settlement only after all real producer work finishes. */
  const settled = vi.spyOn(RequestReplayLedger.prototype, 'settle')
  /** The public iterator remains responsible for its original opening and pull credit. */
  const stream = client.host.memory.streamTo('server', 'held')
  /** This pending original consumer operation remains observed during real cancellation. */
  const pulling = stream.next().catch((error: unknown) => error)
  /** Consumer cancellation remains observed independently from held provider cleanup. */
  let closing: Promise<unknown> | undefined
  try {
    await nextEntered.promise
    expect(state.starts).toBe(1)
    /** Fresh public ids cannot be rejected by duplicate-provider admission. */
    refusals.push(client.host.memory.send('server', 'probe').catch((error: unknown) => error))
    await vi.waitFor(() => expect(rejected).toHaveLength(1))
    expect(rejected[0]).toBe(RpcProviderRejectionReason.replayLedgerFull)
    expect(state.starts).toBe(1)
    closing = stream.return!().catch((error: unknown) => error)
    await returnEntered.promise
    refusals.push(client.host.memory.send('server', 'probe').catch((error: unknown) => error))
    await vi.waitFor(() => expect(rejected).toHaveLength(2))
    expect(rejected[1]).toBe(RpcProviderRejectionReason.replayLedgerFull)
    expect(state.starts).toBe(1)
    /** Return completion may start the original cancelled terminal while next is still held. */
    const beforeTerminal = writing.mock.calls.length
    returned.resolve({ done: true, value: undefined })
    await terminal.promise
    await vi.waitFor(() => expect(writing.mock.calls.length).toBeGreaterThan(beforeTerminal))
    expect(settled).not.toHaveBeenCalled()
    next.resolve({ done: true, value: undefined })
    now += 310_001
    refusals.push(client.host.memory.send('server', 'probe').catch((error: unknown) => error))
    await vi.waitFor(() => expect(rejected).toHaveLength(3))
    expect(rejected[2]).toBe(RpcProviderRejectionReason.replayLedgerFull)
    expect(state.starts).toBe(1)
    expect(settled).not.toHaveBeenCalled()
    /** Only original physical completion permits the existing ledger's settlement timestamp. */
    state.carrier.releaseWrites()
    await Promise.all([pulling, closing])
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
    refusals.push(client.host.memory.send('server', 'probe').catch((error: unknown) => error))
    await vi.waitFor(() => expect(rejected).toHaveLength(4))
    expect(rejected[3]).toBe(RpcProviderRejectionReason.replayLedgerFull)
    expect(state.starts).toBe(1)
    now += 310_001
    expect(await client.host.memory.send('server', 'probe')).toBe(2)
    expect(state.starts).toBe(2)
    for (const refusal of refusals)
      expect(await refusal).toMatchObject({ code: RpcCoreErrorCode.overloaded })
  } finally {
    next.resolve({ done: true, value: undefined })
    returned.resolve({ done: true, value: undefined })
    state.carrier.releaseWrites()
    clock.mockRestore()
    await Promise.all([client.host.close(), host.close()])
    await Promise.all([pulling, closing, ...refusals])
    writing.mockRestore()
    settled.mockRestore()
  }
})
