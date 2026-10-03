import { describe, expect, it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import {
  normalizeRpcEnvelope,
  rpcProtocolV1,
  RpcRouteProfile,
  type IRpcEnvelope
} from '../../../src/contract/index.js'
import { RpcContractErrorCode } from '../../../src/contract/error-code.js'
import { messageFramerV1 } from '../../../src/contract/framing/message-framer.js'
import { RpcCoreErrorCode, RpcTransportError } from '../../../src/core/errors.js'
import { RpcOutboundSender } from '../../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../../src/core/internal/endpoint-options.js'
import { createIpcSendQueueFeature } from '../../../src/core/plugins/send-queue.js'

/** Canonical components preserve real encoding, sizing and gate settlement ownership. */
const components: IRpcSelectedComponents = {
  protocol: rpcProtocolV1,
  codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
  framer: messageFramerV1,
  ingressPrepare: (frame) => ({ frame, messageId: 'whole' }),
  shadowed: []
}

/** Ordinary requests retain their semantic identities inside a physical batch. */
function request(id: string, payload: unknown = id): IRpcEnvelope {
  return normalizeRpcEnvelope({
    kind: 'request',
    id,
    method: 'echo',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        receiverId: 'b',
        sentAt: 0
      },
      payload
    }
  })
}

describe('custody physical sender settlements', () => {
  it('[A26] failed queued authentication rejects only its group and continues the next physical boundary', async () => {
    /** Genuine protection completion is independent of the initial held host write. */
    let release!: () => void
    /** The first physical write makes later semantic messages queue before protection. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Protection invocation order identifies the failed group and the following boundary. */
    let protects = 0
    /** The exact user-transform failure must remain reachable through authentication classification. */
    const cause = new Error('fixture queued protection failure')
    /** Actual frames exclude the failed group while preserving later invocation order. */
    const frames: IRpcEnvelope[] = []
    /** The canonical authenticated sender uses its original framing and group drain owners. */
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send(value) {
          frames.push(value as IRpcEnvelope)
          if (frames.length === 1) return held
        }
      },
      'a',
      components,
      {
        enabled: true,
        encodedType: 'any',
        protect(value) {
          protects += 1
          return protects === 2 ? Promise.reject(cause) : value
        },
        unprotect: (value) => value
      },
      'Memory',
      undefined,
      undefined,
      false,
      true
    )
    /** Initial protection must reach the real host writer before subsequent messages are queued. */
    const first = sender.send(request('first'))
    await vi.waitFor(() => expect(frames).toHaveLength(1))
    /** Both members share the failed protection, but keep separate logical settlements. */
    const one = Promise.resolve(sender.send(request('one'))).catch((error: unknown) => error)
    /** The second member must reject with the same group failure identity. */
    const two = Promise.resolve(sender.send(request('two'))).catch((error: unknown) => error)
    /** Opaque variation is a real physical boundary following the failed ordinary group. */
    const boundary = normalizeRpcEnvelope({
      kind: 'variation',
      id: 'boundary',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'variation',
          variation: 'ping',
          applicationVersion: '1',
          senderId: 'a',
          targetId: 'b',
          receiverId: 'b',
          sentAt: 0
        }
      }
    })
    /** Later preparation must continue even though no host write exists for the failed group. */
    const survivor = sender.send(boundary)
    release()
    await Promise.all([first, survivor])
    /** Error identity and cause are asserted before recovery can create another transform result. */
    const failures = await Promise.all([one, two])
    expect(failures[0]).toBe(failures[1])
    expect(failures[0]).toMatchObject({ code: 'AUTHENTICATION_FAILED', cause })
    expect(frames.map((frame) => frame.id)).toEqual(['first', 'boundary'])
    expect(protects).toBe(3)
    await sender.send(request('recovered'))
    expect(frames.map((frame) => frame.id)).toEqual(['first', 'boundary', 'recovered'])
  })
  it('[A26/A27] rejects an oversized queued singleton with its native cause and sends its survivor', async () => {
    /** Hold only the initial physical write so subsequent requests really enter the sender queue. */
    let release!: () => void
    /** The first accepted host write remains live independently of queued sizing failure. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Actual host frames prove the oversized member never reaches transport. */
    const frames: IRpcEnvelope[] = []
    /**
     * A small internal physical cap reaches the same production split boundary without large
     * fixtures.
     */
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send(value) {
          frames.push(value as IRpcEnvelope)
          if (frames.length === 1) return held
        }
      },
      'a',
      components,
      undefined,
      'Memory',
      undefined,
      undefined,
      true,
      true,
      512
    )
    /** Queue a genuine oversized singleton alongside an independently valid survivor. */
    const first = sender.send(request('first'))
    /** Captures the queued rejection before the held write releases. */
    const oversized = Promise.resolve(sender.send(request('oversized', 'x'.repeat(1_024)))).catch(
      (error: unknown) => error
    )
    /** Keeps the valid sibling's settlement independently observable. */
    const survivor = sender.send(request('survivor'))
    expect(frames.map((frame) => frame.id)).toEqual(['first'])
    release()
    await Promise.all([first, survivor])
    /** Existing transport classification must preserve the contract owner's original RangeError. */
    const failure = await oversized
    expect(failure).toBeInstanceOf(RpcTransportError)
    expect(failure).toMatchObject({
      code: RpcCoreErrorCode.transport,
      cause: { code: RpcContractErrorCode.frameLimitExceeded }
    })
    expect((failure as Error).cause).toBeInstanceOf(RangeError)
    expect(frames.map((frame) => frame.id)).toEqual(['first', 'survivor'])
  })

  it('[A26] a failed physical batch settles all members and keeps whenIdle pending until drain', async () => {
    /** Each physical write has independent completion ownership. */
    let releaseFirst!: () => void
    /** Rejects the held second host invocation with the original cause. */
    let rejectBatch!: (reason: unknown) => void
    /** The first write creates real busy state; the second contains both queued members. */
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    /** Keeps both grouped logical members pending through one physical write. */
    const batch = new Promise<void>((_resolve, reject) => {
      rejectBatch = reject
    })
    /** Frame identities distinguish grouped invocation from logical completion. */
    const frames: unknown[] = []
    /** The existing gate must count unsettled logical members while physical work is grouped. */
    const { gate } = createIpcSendQueueFeature({ connectionId: 'custody-batch-failure' })
    /** The exact host rejection must remain reachable through each member's original wrapper. */
    const cause = new Error('fixture batch write failure')
    /** Exercises canonical admission, encoding and physical write settlement. */
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send(value) {
          frames.push(value)
          if (frames.length === 1) return held
          if (frames.length === 2) return batch
        }
      },
      'a',
      components,
      undefined,
      'Memory',
      gate,
      undefined,
      true,
      true
    )
    /** Tracks the initial accepted write independently of queued work. */
    const first = sender.send(request('first'))
    /** Observes the first grouped member's transport rejection. */
    const one = Promise.resolve(sender.send(request('one'))).catch((error: unknown) => error)
    /** Observes the second grouped member's transport rejection. */
    const two = Promise.resolve(sender.send(request('two'))).catch((error: unknown) => error)
    /** Idle is requested while coalesced members are still awaiting actual physical settlement. */
    let idle = false
    /** Records the gate's completion only after all logical members settle. */
    const drained = gate.whenIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle).toBe(false)
    releaseFirst()
    await first
    expect(frames).toHaveLength(2)
    expect(frames[1]).toMatchObject({ kind: 'batch', envelopes: [{ id: 'one' }, { id: 'two' }] })
    expect(idle).toBe(false)
    rejectBatch(cause)
    for (const failure of await Promise.all([one, two])) {
      expect(failure).toBeInstanceOf(RpcTransportError)
      expect(failure).toMatchObject({ code: RpcCoreErrorCode.transport, cause })
    }
    await drained
    expect(idle).toBe(true)
    await sender.send(request('recovered'))
    expect((frames[2] as IRpcEnvelope).id).toBe('recovered')
    await gate.whenIdle()
    gate.close()
  })

  it('[A25] fast gated sending rechecks admission immediately before its started callback and write', async () => {
    /** Observable ordering protects admission from moving after the physical host invocation. */
    const order: string[] = []
    const { gate } = createIpcSendQueueFeature({ connectionId: 'custody-fast-admission' })
    /** Exercises canonical admission, encoding and physical write settlement. */
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send() {
          order.push('write')
        }
      },
      'a',
      components,
      undefined,
      'Memory',
      gate,
      undefined,
      true
    )
    await sender.send(
      request('fast'),
      undefined,
      {
        signals: [],
        assertCanSend() {
          order.push('admission')
        }
      },
      undefined,
      () => {
        order.push('started')
      }
    )
    expect(order.at(-1)).toBe('write')
    expect(order.slice(-3)).toEqual(['admission', 'started', 'write'])
    expect(order.filter((event) => event === 'started')).toHaveLength(1)
    expect(order.filter((event) => event === 'write')).toHaveLength(1)
    gate.close()
  })
})
