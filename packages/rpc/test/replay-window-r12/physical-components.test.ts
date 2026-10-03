import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { describe, it } from 'vitest'
import { authentication } from '../../src/core/middleware/authentication.js'
import { bindAuthenticationReplayContext } from '../../src/core/internal/authentication-replay.js'
import { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext
} from '../../src/core/typing.js'
import { installPlugin } from '../core/middleware/helpers.js'

/**
 * Optional baseline replaces only the original authentication owner; production modules stay
 * untouched.
 */
const authenticationOwner = process.env.RPC_REPLAY_BASE
  ? (
      (await import(/* @vite-ignore */ process.env.RPC_REPLAY_BASE)) as {
        authentication: typeof authentication
      }
    ).authentication
  : authentication

/** Installs the canonical plugin port; no substitute replay implementation enters the fixture. */
function capability(config: Parameters<typeof authentication>[0]): IRpcAuthenticationCapability {
  return installPlugin(authenticationOwner(config)).get(
    'authenticationCapability'
  ) as IRpcAuthenticationCapability
}

/** Executes protection through real ports while keeping each async receive independently observable. */
function physical(receiver: IRpcAuthenticationCapability) {
  /** Session partition is tied to this exact physical receiving resource. */
  const { port1, port2 } = new MessageChannel()
  /** Retirement invalidates verification that was already awaiting a user transform. */
  let closed = false
  /** Arrival order associates original completion Promises; verification completion may reverse it. */
  const waiters: Array<{ resolve(value: unknown): void; reject(error: unknown): void }> = []
  port2.on('message', (frame: unknown) => {
    /** Each physical delivery owns a fresh transform context and the original session identity. */
    const context: IRpcAuthenticationContext = {
      direction: 'inbound',
      endpointId: 'component-receiver',
      platform: 'MessagePort'
    }
    /** FIFO physical receive consumes exactly one original delivery completion. */
    const waiter = waiters.shift()!
    bindAuthenticationReplayContext(context, port2, () => !closed)
    void Promise.resolve(receiver.unprotect(frame, context)).then(waiter.resolve, waiter.reject)
  })
  return {
    /** Delivers the captured protected value, rather than invoking unprotect directly. */
    deliver(frame: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject })
        port1.postMessage(frame)
      })
    },
    /** Each case owns both ports and releases them even after an expected assertion failure. */
    close(): void {
      closed = true
      port1.close()
      port2.close()
    }
  }
}

describe('replay-window r12 physical authentication components', () => {
  it('[A7/A19] rejects verification completing after the actual physical session closes', async () => {
    /** Arrival and completion are separately controlled without mocking the physical port. */
    let arrived!: () => void
    let release!: () => void
    /** The awaited transform models supported asynchronous signature verification. */
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const sender = capability({ sign: (value) => value, verify: (value) => value })
    const receiver = capability({
      sign: (value) => value,
      verify: async (value) => {
        arrived()
        await waiting
        return value
      }
    })
    const channel = physical(receiver)
    try {
      const frame = await sender.protect(
        { value: 'late' },
        {
          direction: 'outbound',
          endpointId: 'component-sender',
          platform: 'MessagePort'
        }
      )
      const completed = channel.deliver(frame)
      const rejected = assert.rejects(
        completed,
        { code: 'AUTHENTICATION_FAILED' },
        '[A19] a retired physical session cannot accept late verification'
      )
      await started
      channel.close()
      release()
      await rejected
    } finally {
      release()
      channel.close()
    }
  })
  it('[A16/A18] accepts actual verify completion [2,1] and rejects the already accepted counter', async () => {
    /** First verification waits for the second physical callback without serializing receivers. */
    let releaseFirst!: () => void
    /** Deferred transform supplies a reachable asynchronous verification inversion. */
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    /** Completion order is measured dynamically, independent of message arrival order. */
    const order: number[] = []
    /** Protect allocates the original signed sequence before either receive starts. */
    const sender = capability({ sign: (value) => value, verify: (value) => value })
    /** Both current wrapper and original baseline carry the same one-off semantic fixture index. */
    const receiver = capability({
      sign: (value) => value,
      verify: async (value) => {
        /** This fixture-only selector does not grant production session or counter authority. */
        const wrapped = value as { index?: number; payload?: { index: number } }
        /** Supported old/new transform values select the same controlled verification delay. */
        const index = wrapped.index ?? wrapped.payload!.index
        if (index === 1 && order.length === 0) await first
        else if (index === 2) releaseFirst()
        order.push(index)
        return value
      }
    })
    /** Both frames traverse the same real session with independent verification Promises. */
    const channel = physical(receiver)
    /** Outbound contexts preserve the unchanged public callback signature. */
    const context: IRpcAuthenticationContext = {
      direction: 'outbound',
      endpointId: 'component-sender',
      platform: 'MessagePort'
    }
    try {
      /** Sequence one is allocated synchronously before sequence two. */
      const one = await sender.protect({ index: 1 }, context)
      /** This frame is reused verbatim for the final duplicate assertion. */
      const two = await sender.protect({ index: 2 }, context)
      assert.deepEqual(await Promise.all([channel.deliver(one), channel.deliver(two)]), [
        { index: 1 },
        { index: 2 }
      ])
      assert.deepEqual(
        order,
        [2, 1],
        '[A16] verification completion reverses actual physical arrival order'
      )
      await assert.rejects(
        channel.deliver(two),
        { code: 'AUTHENTICATION_FAILED' },
        '[A18] seen counter must fail'
      )
    } finally {
      channel.close()
    }
  })

  it('[A27] authenticates a physical batch once and rejects its replay before component dispatch', async () => {
    /** Counts physical signing independently of the two logical member admissions. */
    let signs = 0
    /** Replaying the captured frame still verifies its signature, then fails the counter guard. */
    let verifies = 0
    /** A single capability owns outgoing sequence; receiver has its own session bitmap. */
    const sender = capability({
      sign: (value) => {
        signs += 1
        return value
      },
      verify: (value) => value
    })
    /**
     * These are canonical auth/ledger components, deliberately not a full provider integration
     * claim.
     */
    const receiver = capability({
      sign: (value) => value,
      verify: (value) => {
        verifies += 1
        return value
      }
    })
    /** The physical receiver is a real MessagePort and shares one private session across deliveries. */
    const channel = physical(receiver)
    /** Released L entries permit a fresh business ID; authentication must stop old physical frames. */
    const ledger = new RequestReplayLedger(4096, 1024, 310_000, undefined, () => true)
    /** Member dispatch is counted separately from transport or transform calls. */
    const dispatched = [0, 0]
    /** Physical batch representation is component data; protocol registration belongs to I26. */
    const batch = { kind: 'batch', envelopes: [{ id: 'one' }, { id: 'two' }] }
    /** Each admitted member is fully settled before the captured physical replay is attempted. */
    const dispatch = (value: unknown): void => {
      for (const [index, member] of (value as typeof batch).envelopes.entries()) {
        if (!ledger.admit(member.id, 'component-peer', 0)) continue
        dispatched[index]! += 1
        ledger.releaseActive(member.id, 0)
      }
    }
    try {
      /** Binding and transform cover both members as a single physical object. */
      const frame = await sender.protect(batch, {
        direction: 'outbound',
        endpointId: 'component-sender',
        platform: 'MessagePort'
      })
      dispatch(await channel.deliver(frame))
      assert.deepEqual(dispatched, [1, 1])
      assert.equal(signs, 1, '[A27] two members consume one physical signature')
      assert.equal(verifies, 1, '[A27] first physical frame verifies once')
      await assert.rejects(
        async () => dispatch(await channel.deliver(frame)),
        { code: 'AUTHENTICATION_FAILED' },
        '[A27] captured physical replay fails before member dispatch'
      )
      assert.deepEqual(
        dispatched,
        [1, 1],
        '[A27] settled L entries do not permit signed-frame replay'
      )
      assert.equal(verifies, 2)
    } finally {
      channel.close()
      ledger.clear()
    }
  })
})
