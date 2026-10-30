/** Same-id producer isolation uses real public Hosts, native Sessions and original stream owners. */
import { createRpcHost } from '@migaia/rpc-host'
import type { IRpcCarrierCodec, IRpcCodecContext } from '@migaia/rpc-contract/interfaces'
import {
  RpcWireKind,
  RpcStreamEvent,
  type IRpcEnvelope,
  type IRpcPortableValue,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { assert, expect, it, vi } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { StreamChannel } from '../../dist/stream/channel.js'
import { ProviderDispatcher } from '../../dist/dispatch/dispatcher.js'
import { MemoryCarrier } from '../fixtures/core-carrier.ts'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** Actual encoded replies retain their original route and provider-produced value. */
type IStreamItem = Readonly<{ targetId: string; value: unknown }>

/** Existing owner calls supply the arrival barrier without a second receiver or task table. */
type IIntruderDelivery = Readonly<{
  streamCalls: readonly Parameters<StreamChannel['accept']>[]
  providerCalls: readonly Parameters<ProviderDispatcher['accept']>[]
  carrierId: string
  id: string
}>

/** Each invoked provider returns its own original one-value iterator. */
function* oneValue(value: string): Generator<string> {
  yield value
}

/** Observe only already-prepared metadata, then delegate the one original encode unchanged. */
function observeItems(codec: IRpcCarrierCodec, items: IStreamItem[]) {
  /** The original receiver is required by RpcJsonCarrierCodec's private state. */
  const encode = codec.encode
  return vi.spyOn(codec, 'encode').mockImplementation((prepared, context) => {
    /** This genuine codec's prepared message is borrowed without decode or restore. */
    const message = prepared.message as IRpcSemanticFrame
    if (message.kind === RpcWireKind.stream && message.stream.event === RpcStreamEvent.item)
      items.push({ targetId: message.route.targetId, value: message.stream.value })
    return Reflect.apply(encode, codec, [prepared, context]) as ReturnType<
      IRpcCarrierCodec['encode']
    >
  })
}

/** Inject one current wire stimulus through the actual carrier's one prepare/encode pair. */
async function writeEncoded(
  carrier: MemoryCarrier,
  envelope: IRpcEnvelope,
  context: IRpcCodecContext
): Promise<void> {
  /** Only the canonical installed codec prepares this new ingress stimulus. */
  const prepared = await carrier.codec.prepare(envelope, context)
  /** The same actual codec owns its sole physical encoding. */
  const frame = await carrier.codec.encode(prepared, context)
  await carrier.write(frame)
}

/** Wait for both actual source-qualified owners while the legitimate streams remain unpulled. */
async function waitForIntruder(input: IIntruderDelivery): Promise<void> {
  await vi.waitFor(() => {
    /** Each flag reflects a real original-owner call, never a synthetic dispatch result. */
    const received = { pull: false, cancel: false }
    for (const [carrierId, frame] of input.streamCalls)
      if (
        carrierId === input.carrierId &&
        frame.id === input.id &&
        frame.kind === RpcWireKind.stream &&
        frame.stream.event === RpcStreamEvent.pull
      )
        received.pull = true
    for (const [source, frame] of input.providerCalls)
      if (
        source.carrierId === input.carrierId &&
        frame.id === input.id &&
        frame.kind === RpcWireKind.cancel
      )
        received.cancel = true
    expect(received).toEqual({ pull: true, cancel: true })
  })
}

// Exact produced2 and beta2/alpha1 order survive a real intruder.
it('isolates same-id producers by actual admitted sender before intruder pull and cancellation', async () => {
  /** Only genuine provider entry increments this original execution count. */
  const production = { calls: 0 }
  /** Actual server reply metadata supplies the unchanged target/value oracle. */
  const items: IStreamItem[] = []
  /** This existing listener admits three separate physical source pairs. */
  const listener = coreMemoryServer('server', 'server', 'memory', {}, [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** One real provider factory captures its value before either iterator receives credit. */
  const server = await createRpcHost({
    ...listener.options,
    provide: { count: () => oneValue(String(++production.calls)) }
  })
  /** Existing consumer owners are observed only when public namespace.stream creates them. */
  const owners: StreamChannel[] = []
  /** The original method remains the only iterator constructor. */
  const originalOpen = StreamChannel.prototype.open
  /** Real relay preparation can open these original iterators without pulling their first item. */
  const open = vi.spyOn(StreamChannel.prototype, 'open').mockImplementation(function (
    this: StreamChannel,
    ...args: Parameters<StreamChannel['open']>
  ) {
    owners.push(this)
    return Reflect.apply(originalOpen, this, args) as ReturnType<StreamChannel['open']>
  })
  /** Both pass-through spies observe actual processed source/task identities. */
  const receiving = vi.spyOn(StreamChannel.prototype, 'accept')
  /** Cancellation reaches the original provider table rather than a test callback. */
  const cancellation = vi.spyOn(ProviderDispatcher.prototype, 'accept')
  /** Each acquired caller keeps its original Host available for partial-construction cleanup. */
  let alpha: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** Beta is a distinct real Host, not another alias for alpha's stream owner. */
  let beta: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** The intruder retains its own accepted source and normal independent native entropy. */
  let intruder: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** Original public iterators are also the ones lent to the real prepare/ready seam. */
  let first: AsyncIterableIterator<IRpcPortableValue> | undefined
  /** The second source remains independently controllable until its own cleanup. */
  let second: AsyncIterableIterator<IRpcPortableValue> | undefined
  /** Passive codec spies are restored only after their original iterators terminate. */
  const spies: Array<{ mockRestore(): void }> = []
  try {
    /** Only the two CallIdAllocator construction nonces coincide; randomUUID is untouched. */
    const entropy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      assert(array)
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7)
      return array
    })
    try {
      alpha = await listener.connect('alpha')
      beta = await listener.connect('beta')
    } finally {
      entropy.mockRestore()
    }
    intruder = await listener.connect('intruder')
    /** Actual semantic open inputs provide task/generation metadata and the negotiated codec facts. */
    const alphaPreparing = vi.spyOn(alpha.pair[1].codec, 'prepare')
    /** Beta's own first allocation must independently produce the same actual opaque id. */
    const betaPreparing = vi.spyOn(beta.pair[1].codec, 'prepare')
    spies.push(alphaPreparing, betaPreparing)
    spies.push(observeItems(alpha.pair[0].codec, items), observeItems(beta.pair[0].codec, items))
    first = alpha.host.memory!.streamTo('server', 'count', null, {
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    second = beta.host.memory!.streamTo('server', 'count', null, {
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    expect(owners).toHaveLength(2)
    expect(owners[0]).not.toBe(owners[1])
    await owners[0]!.prepare(first)
    await owners[1]!.prepare(second)
    /** Read actual prepare calls; no observer codec restoration creates these inputs. */
    const alphaRequest = alphaPreparing.mock.calls.find(
      ([frame]) => frame.kind === RpcWireKind.call && frame.task.mode === 'stream'
    )
    /** This second real source has a separate original caller/generation tuple. */
    const betaRequest = betaPreparing.mock.calls.find(
      ([frame]) => frame.kind === RpcWireKind.call && frame.task.mode === 'stream'
    )
    assert(alphaRequest && betaRequest)
    /** The exact original codec context is sufficient for the identical native JSON medium. */
    const [alphaOpen, codecContext] = alphaRequest
    /** Native collision is calibrated from both actual executed CallIdAllocators. */
    const [betaOpen] = betaRequest
    assert(alphaOpen.kind === RpcWireKind.call && betaOpen.kind === RpcWireKind.call)
    expect(alphaOpen.id).toBe(betaOpen.id)
    expect(alphaOpen.task.callerId).toBe('alpha')
    expect(betaOpen.task.callerId).toBe('beta')
    expect(alpha.pair[0].id).not.toBe(beta.pair[0].id)
    /** The original task is replayed only from the intruder's own authenticated physical source. */
    const route = { ...alphaOpen.route, senderId: intruder.host.self.instanceId }
    /** A wrong-source pull must not grant credit to either same-id producer. */
    const pull: IRpcEnvelope = {
      profile: alphaOpen.profile,
      kind: RpcWireKind.stream,
      id: alphaOpen.id,
      route,
      task: alphaOpen.task,
      stream: { event: RpcStreamEvent.pull, seq: 0 }
    }
    /** Current cancellation uses its core frame while retaining the same original task metadata. */
    const cancel: IRpcEnvelope = {
      profile: alphaOpen.profile,
      kind: RpcWireKind.cancel,
      id: alphaOpen.id,
      route,
      task: alphaOpen.task
    }
    await writeEncoded(intruder.pair[1], pull, codecContext)
    await writeEncoded(intruder.pair[1], cancel, codecContext)
    await waitForIntruder({
      streamCalls: receiving.mock.calls,
      providerCalls: cancellation.mock.calls,
      carrierId: intruder.pair[0].id,
      id: alphaOpen.id
    })
    expect(production.calls).toBe(2)
    expect(await second.next()).toEqual({ done: false, value: '2' })
    expect(await first.next()).toEqual({ done: false, value: '1' })
    expect(items).toEqual([
      { targetId: 'beta', value: '2' },
      { targetId: 'alpha', value: '1' }
    ])
  } finally {
    await Promise.all([first?.return?.(), second?.return?.()])
    for (const spy of spies) spy.mockRestore()
    receiving.mockRestore()
    cancellation.mockRestore()
    open.mockRestore()
    await Promise.all([
      alpha?.host.close(),
      beta?.host.close(),
      intruder?.host.close(),
      server.close()
    ])
  }
})

/** Hold only the provider's original first business value, without synthetic credit or frames. */
async function* heldValue(value: string, release: Promise<void>): AsyncGenerator<string> {
  await release
  yield value
}

/** One real source/event/id tuple supplies an arrival barrier without a new receive path. */
type IObservedStreamDelivery = Readonly<{
  calls: readonly Parameters<StreamChannel['accept']>[]
  carrierId: string
  id: string
  event: typeof RpcStreamEvent.pull | typeof RpcStreamEvent.item
}>

/** Wait only for the original owner to process the specified actual wire stimulus. */
async function waitForStreamDelivery(input: IObservedStreamDelivery): Promise<void> {
  await vi.waitFor(() => {
    /** The original owner sees the exact physical source before any consumer task lookup. */
    let received = false
    for (const [carrierId, frame] of input.calls)
      if (
        carrierId === input.carrierId &&
        frame.id === input.id &&
        frame.kind === RpcWireKind.stream &&
        frame.stream.event === input.event
      )
        received = true
    expect(received).toBe(true)
  })
}

/** Preserve the original actual alpha-then-beta credit order before any value is released. */
async function waitForCreditOrder(
  calls: readonly Parameters<StreamChannel['accept']>[]
): Promise<void> {
  await vi.waitFor(() => {
    /** One pass reads the original incoming credits in their observed processing order. */
    const targets: string[] = []
    for (const [, frame] of calls)
      if (frame.kind === RpcWireKind.stream && frame.stream.event === RpcStreamEvent.pull)
        targets.push(frame.route.targetId)
    expect(targets).toEqual(['alpha', 'beta'])
  })
}

// Genuine distinct ids retain the original target/payload isolation.
it('isolates a pending consumer from another actual target replaying its original task id', async () => {
  /** Each real provider waits independently while both original consumers are ready. */
  const alphaRelease = deferred<void>()
  /** Beta can deliver before alpha without reordering any native receive or credit path. */
  const betaRelease = deferred<void>()
  /** The public caller owns one allocator and two genuinely distinct native source bindings. */
  const listener = coreMemoryServer('client', 'client', 'memory', {}, [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** This real listener Host owns both public stream iterators and their one StreamChannel. */
  const client = await createRpcHost(listener.options)
  /** Actual public opens lend their exact owner to the existing relay-ready seam. */
  const owners: StreamChannel[] = []
  /** The original method remains the only iterator constructor for this case. */
  const originalOpen = StreamChannel.prototype.open
  /** Passthrough observation never substitutes the returned consumer or its task. */
  const open = vi.spyOn(StreamChannel.prototype, 'open').mockImplementation(function (
    this: StreamChannel,
    ...args: Parameters<StreamChannel['open']>
  ) {
    owners.push(this)
    return Reflect.apply(originalOpen, this, args) as ReturnType<StreamChannel['open']>
  })
  /** One actual receive owner observes both outbound credit arrival and the wrong-source item. */
  const receiving = vi.spyOn(StreamChannel.prototype, 'accept')
  /** Each real provider remains available to the original partial-construction cleanup. */
  let alpha: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** Beta has a different physical Session even though its stimulus references alpha's task. */
  let beta: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** These are the original public iterators, never facade or copied iterator objects. */
  let first: AsyncIterableIterator<IRpcPortableValue> | undefined
  /** The second consumer must still settle from its own beta provider. */
  let second: AsyncIterableIterator<IRpcPortableValue> | undefined
  /** Canonical codec inputs remain passive observations after each original prepare call. */
  const spies: Array<{ mockRestore(): void }> = []
  try {
    alpha = await listener.connect('alpha', {
      provide: { count: () => heldValue('a', alphaRelease.promise) }
    })
    beta = await listener.connect('beta', {
      provide: { count: () => heldValue('b', betaRelease.promise) }
    })
    /** Both selected calls originate from this one real client and its shared id allocator. */
    const alphaPreparing = vi.spyOn(alpha.pair[0].codec, 'prepare')
    /** Each actual binding supplies its own negotiated codec context and call frame. */
    const betaPreparing = vi.spyOn(beta.pair[0].codec, 'prepare')
    spies.push(alphaPreparing, betaPreparing)
    first = client.memory!.streamTo('alpha', 'count', null, {
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    second = client.memory!.streamTo('beta', 'count', null, {
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    expect(owners).toHaveLength(2)
    expect(owners[0]).toBe(owners[1])
    await owners[0]!.prepare(first)
    await owners[1]!.prepare(second)
    /** These executed current opens replace only the old removed deterministic-id input shape. */
    const opens: Parameters<IRpcCarrierCodec['prepare']>[] = []
    // Exactly two native bindings are fixed by this case; every recorded call is visited once.
    for (const spy of [alphaPreparing, betaPreparing])
      for (const args of spy.mock.calls) if (args[0].kind === RpcWireKind.call) opens.push(args)
    expect(opens).toHaveLength(2)
    /** The first actual native call is the victim task borrowed by the wrong-source stimulus. */
    const [alphaOpen] = opens[0]!
    /** Beta's own genuine call remains independently allocated and targeted. */
    const [betaOpen, codecContext] = opens[1]!
    assert(alphaOpen.kind === RpcWireKind.call && betaOpen.kind === RpcWireKind.call)
    expect(alphaOpen.id).not.toBe(betaOpen.id)
    expect([alphaOpen.route.targetId, betaOpen.route.targetId]).toEqual(['alpha', 'beta'])
    /** First demand is held in the real producer until its original value is released. */
    const firstNext = first.next()
    await waitForStreamDelivery({
      calls: receiving.mock.calls,
      carrierId: alpha.pair[1].id,
      id: alphaOpen.id,
      event: RpcStreamEvent.pull
    })
    /** Beta demand follows the first actual alpha credit, preserving the original target order. */
    const secondNext = second.next()
    await waitForCreditOrder(receiving.mock.calls)
    /** The legitimate beta source cannot drive alpha by borrowing its complete task and id. */
    const wrong: IRpcEnvelope = {
      profile: alphaOpen.profile,
      kind: RpcWireKind.stream,
      id: alphaOpen.id,
      task: alphaOpen.task,
      route: {
        ...alphaOpen.route,
        senderId: beta.host.self.instanceId,
        receiverId: client.self.instanceId,
        targetId: client.self.instanceId
      },
      stream: { event: RpcStreamEvent.item, seq: 0, value: 'wrong' }
    }
    await writeEncoded(beta.pair[1], wrong, codecContext)
    await waitForStreamDelivery({
      calls: receiving.mock.calls,
      carrierId: beta.pair[0].id,
      id: alphaOpen.id,
      event: RpcStreamEvent.item
    })
    betaRelease.resolve()
    expect(await secondNext).toEqual({ done: false, value: 'b' })
    alphaRelease.resolve()
    expect(await firstNext).toEqual({ done: false, value: 'a' })
  } finally {
    alphaRelease.resolve()
    betaRelease.resolve()
    await Promise.all([first?.return?.(), second?.return?.()])
    for (const spy of spies) spy.mockRestore()
    receiving.mockRestore()
    open.mockRestore()
    await Promise.all([alpha?.host.close(), beta?.host.close(), client.close()])
  }
})
