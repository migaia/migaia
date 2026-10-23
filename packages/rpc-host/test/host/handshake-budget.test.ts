import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import {
  createAdapterMessageHandshakeBudget,
  createEventEmitterMessageResource
} from '../../dist/runtime-adapter/message/resource.js'
import type { IAdapterEventEmitterMessagePort } from '../../dist/runtime-adapter/message/types.js'

/** Keep the real resource parser, native listener ownership, and original monotonic timer. */
function physicalMessage() {
  /** A native event owner delivers raw startup records synchronously. */
  const events = new EventEmitter()
  /** Actual control writes are observed without synthesizing an acknowledgement. */
  const postMessage = vi.fn((_message: unknown) => undefined)
  /** The raw port exposes only native operations; it cannot supply an accepted agreement. */
  const port: IAdapterEventEmitterMessagePort = {
    postMessage,
    on: (event, listener) => {
      events.on(event, listener)
    },
    off: (event, listener) => {
      events.off(event, listener)
    }
  }
  return { events, postMessage, resource: createEventEmitterMessageResource(port) }
}

it('bounds unknown-address initial capture with the configured handshake clock', async () => {
  /** This connection has one fifty millisecond budget before any startup read. */
  const scheduler = createManualScheduler()
  /** The resource remains silent for this actual no-initial-message path. */
  const physical = physicalMessage()
  /** The same preparation record is passed to the real resource, without allocating a timer. */
  const budget = createAdapterMessageHandshakeBudget(scheduler, 50)
  /** Observe rejection immediately so the original capture owns its failure. */
  const opening = physical.resource.exchangeIdentity(
    { self: { name: 'local', instanceId: 'local-1' }, capabilities: [RpcCapability.batch] },
    undefined,
    budget
  )
  /** The expected startup diagnostic remains the native resource's established failure. */
  const failure = expect(opening).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  scheduler.advance(49)
  expect(physical.events.listenerCount('message')).toBe(1)
  scheduler.advance(1)
  await failure
  expect(physical.events.listenerCount('message')).toBe(0)
  await physical.resource.close()
})

it.each([0, 35])(
  'uses only the remaining budget for absent ACK after %i ms preparation',
  async (elapsed) => {
    /** Initial preparation and ACK negotiation read one monotonic clock. */
    const scheduler = createManualScheduler()
    /** This known-address resource receives no peer ACK. */
    const physical = physicalMessage()
    /** Capturing a deadline consumes no timer or physical operation. */
    const budget = createAdapterMessageHandshakeBudget(scheduler, 50)
    scheduler.advance(elapsed)
    /** The existing ACK owner starts its only timer with the remaining preparation budget. */
    const opening = physical.resource.open({
      peerId: 'remote-1',
      scheduler,
      offer: [RpcCapability.batch],
      control: rpcMessageCapabilityControl,
      handshakeBudget: budget
    })
    /** A completed attempt is observed without waiting for a second full timeout. */
    const failure = expect(opening).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    scheduler.advance(49 - elapsed)
    expect(physical.events.listenerCount('message')).toBe(1)
    scheduler.advance(1)
    await failure
    expect(scheduler.now()).toBe(50)
    expect(physical.events.listenerCount('message')).toBe(0)
    await physical.resource.close()
  }
)

it('accepts the existing initial capability exchange without waiting for a redundant ACK', async () => {
  /** The actual first frame arrives after part of the configured budget was consumed. */
  const scheduler = createManualScheduler()
  /** Both identity and capabilities are parsed by the canonical initial-record owner. */
  const physical = physicalMessage()
  /** Both operations hold the exact same preparation deadline. */
  const budget = createAdapterMessageHandshakeBudget(scheduler, 50)
  /** The real resource sends readiness, then waits for the peer's actual initial record. */
  const identity = physical.resource.exchangeIdentity(
    { self: { name: 'local', instanceId: 'local-1' }, capabilities: [RpcCapability.batch] },
    undefined,
    budget
  )
  scheduler.advance(35)
  physical.events.emit('message', {
    kind: rpcMessageCapabilityControl.data,
    peerId: 'remote-1',
    runtimeApi: {
      version: rpcMessageCapabilityControl.version,
      self: { name: 'remote', instanceId: 'remote-1' },
      parent: { name: 'remote', instanceId: 'remote-1' },
      capabilities: [RpcCapability.batch]
    }
  })
  expect(await identity).toBe('remote-1')
  /** Initial control already carries the independent peer offer; no second ACK is required. */
  const channel = await physical.resource.open({
    peerId: 'remote-1',
    scheduler,
    offer: [RpcCapability.batch],
    control: rpcMessageCapabilityControl,
    handshakeBudget: budget
  })
  expect(channel.agreement.capabilities).toEqual([RpcCapability.batch])
  expect(scheduler.now()).toBe(35)
  expect(
    physical.postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)
  ).toEqual([rpcMessageCapabilityControl.ready, rpcMessageCapabilityControl.data])
  expect(scheduler.pendingCount).toBe(0)
  scheduler.advance(15)
  expect(channel.transport.closed).not.toBe(true)
  await physical.resource.close()
})
