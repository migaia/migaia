/** Same-id producer isolation uses real public Hosts, native Sessions and original stream owners. */
import { createRpcHost } from '@migaia/rpc-host'
import type { IRpcCarrierCodec, IRpcCodecContext } from '@migaia/rpc-contract/interfaces'
import type {
  IRpcEnvelope,
  IRpcPortableValue,
  IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { assert, expect, it, vi } from 'vitest'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { StreamChannel } from '../../dist/stream/channel.js'
import { ProviderDispatcher } from '../../dist/dispatch/dispatcher.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from '../host/core-fixture.js'

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
    if (message.kind === 'stream' && message.stream.event === 'item')
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
        frame.kind === 'stream' &&
        frame.stream.event === 'pull'
      )
        received.pull = true
    for (const [source, frame] of input.providerCalls)
      if (source.carrierId === input.carrierId && frame.id === input.id && frame.kind === 'cancel')
        received.cancel = true
    expect(received).toEqual({ pull: true, cancel: true })
  })
}

// RPC-TEST-F23B99228CD7-C002: exact produced2 and beta2/alpha1 order survive a real intruder.
it('isolates same-id producers by actual admitted sender before intruder pull and cancellation', async () => {
  /** Only genuine provider entry increments this original execution count. */
  const production = { calls: 0 }
  /** Actual server reply metadata supplies the unchanged target/value oracle. */
  const items: IStreamItem[] = []
  /** This existing listener admits three separate physical source pairs. */
  const listener = coreMemoryServer('server', 'server', 'memory', [], [], {
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
    first = alpha.host.memory!.stream('count', null, {
      targetId: 'server',
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    second = beta.host.memory!.stream('count', null, {
      targetId: 'server',
      timeout: false
    }) as AsyncIterableIterator<IRpcPortableValue>
    expect(owners).toHaveLength(2)
    expect(owners[0]).not.toBe(owners[1])
    await owners[0]!.prepare(first)
    await owners[1]!.prepare(second)
    /** Read actual prepare calls; no observer codec restoration creates these inputs. */
    const alphaRequest = alphaPreparing.mock.calls.find(
      ([frame]) => frame.kind === 'call' && frame.task.mode === 'stream'
    )
    /** This second real source has a separate original caller/generation tuple. */
    const betaRequest = betaPreparing.mock.calls.find(
      ([frame]) => frame.kind === 'call' && frame.task.mode === 'stream'
    )
    assert(alphaRequest && betaRequest)
    /** The exact original codec context is sufficient for the identical native JSON medium. */
    const [alphaOpen, codecContext] = alphaRequest
    /** Native collision is calibrated from both actual executed CallIdAllocators. */
    const [betaOpen] = betaRequest
    assert(alphaOpen.kind === 'call' && betaOpen.kind === 'call')
    expect(alphaOpen.id).toBe(betaOpen.id)
    expect(alphaOpen.task.callerId).toBe('alpha')
    expect(betaOpen.task.callerId).toBe('beta')
    expect(alpha.pair[0].id).not.toBe(beta.pair[0].id)
    /** The original task is replayed only from the intruder's own authenticated physical source. */
    const route = { ...alphaOpen.route, senderId: intruder.host.self.instanceId }
    /** A wrong-source pull must not grant credit to either same-id producer. */
    const pull: IRpcEnvelope = {
      profile: alphaOpen.profile,
      kind: 'stream',
      id: alphaOpen.id,
      route,
      task: alphaOpen.task,
      stream: { event: 'pull', seq: 0 }
    }
    /** Current cancellation uses its core frame while retaining the same original task metadata. */
    const cancel: IRpcEnvelope = {
      profile: alphaOpen.profile,
      kind: 'cancel',
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
