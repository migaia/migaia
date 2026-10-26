/** Signed captured traffic cannot reconstruct a fresh source in the same installed Auth owner. */
import { createHmac } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { defineTransportPlugin, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrierFrame,
  IRpcCodecContext,
  IRpcPreparedMessage,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelopeCommon } from '@migaia/rpc-contract/protocol'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { createNodeThreadCarrier } from '../../../../rpc-plugin-thread/dist/threads/channel.js'
import { FlowRegistry } from '../../../dist/flow/registry.js'
import { setAuthenticationReplayCounter } from '../../../dist/features/auth/counter.js'
import { readAuthenticationEnvelope } from '../../../dist/features/auth/envelope.js'
import { AuthenticationRepresentation } from '../../../dist/features/auth/representation.js'
import { RpcAuthenticationEnvelope } from '../../../dist/features/auth/constants.js'
import { RpcAuthenticationText } from '../../../dist/features/auth/text.js'

/** Public test data signs complete Auth transform inputs; this is not a deployed credential. */
const signingKey = 'auth-source-freshness-public-fixture'

/** Capture the original JSON encoder's actual output without publishing bootstrap through probe. */
class CapturedJsonCodec extends RpcJsonCarrierCodec {
  /** Only the original caller endpoint lends physical frames to the replay fixture. */
  readonly #captured: IRpcCarrierFrame[] | undefined

  /** Borrow an optional output receipt; the same canonical codec performs the only encoding. */
  constructor(captured?: IRpcCarrierFrame[]) {
    super()
    this.#captured = captured
  }

  /** Retain the exact frame returned to Session; no second encoder or handshake is constructed. */
  override encode(message: IRpcPreparedMessage, context: IRpcCodecContext): IRpcCarrierFrame {
    /** This exact result is the one handed to the native carrier by the existing Session. */
    const frame = super.encode(message, context)
    this.#captured?.push(frame)
    return frame
  }
}

/** Real HMAC callbacks protect the existing Auth wrapper without parsing semantic or native frames. */
function authentication() {
  return auth({
    sign: (value) => ({
      value,
      signature: createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex')
    }),
    verify: (value) => {
      /** Only the real HMAC signer can produce the original protected input. */
      const signed = value as { value: unknown; signature: string }
      expect(signed.signature).toBe(
        createHmac('sha256', signingKey).update(JSON.stringify(signed.value)).digest('hex')
      )
      return signed.value
    }
  })
}

it('rejects a captured signed handshake and call after the original physical source retires', async () => {
  /** The existing fixture constructs exactly two codecs per pair, server first and caller second. */
  const capture = { ordinal: 0, frames: [] as IRpcCarrierFrame[] }
  /** All connections borrow the same installed receiver Auth and real selected JSON codec. */
  const server = coreMemoryServer('server', 'server', 'memory', [], [], {
    create: () => new CapturedJsonCodec(++capture.ordinal % 2 === 0 ? capture.frames : undefined),
    nativeBinary: false
  })
  /** Only genuine provider entry changes this observation. */
  let providerCalls = 0
  /** The public host owns its one Auth installation throughout retirement and reconstruction. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [authentication(), ...server.options.plugins],
    provide: {
      echo: (value) => {
        providerCalls += 1
        return value
      }
    }
  })
  /** Both genuine public callers are finally-owned even if their native opening rejects. */
  let first: Awaited<ReturnType<typeof server.connect>> | undefined
  /** A new native source can deliver only captured bytes; it has no signing callback or Host. */
  const receiver = new MemoryCarrier(
    'captured-receiver',
    undefined,
    new RpcJsonCarrierCodec(),
    false
  )
  const sender = new MemoryCarrier('captured-sender', undefined, new RpcJsonCarrierCodec(), false)
  receiver.link(sender)
  sender.link(receiver)
  /** A successful fresh control is retained only for normal final cleanup. */
  let fresh: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    /** The caller's original encoder capture is active before its first physical hello. */
    first = await server.connect('caller', {
      plugins: [authentication()]
    })
    expect(await first.host.memory.send('server', 'echo', 'original')).toBe('original')
    /** Retire the real accepted receipt before reconstructing the physical route. */
    const original = server.lookup('caller')!
    await first.host.close()
    await original.handle.closed
    /** The receiver creates its new local challenge inside the same real native attach. */
    const accepted = server.accept(receiver)
    /** Observe handshake rejection before replay delivery can reject the original ready promise. */
    const rejected = accepted.ready.catch((error: unknown) => error)
    for (const frame of capture.frames) await sender.write(frame)
    expect(await rejected).toMatchObject({ source: 'rpc.endpoint', code: 'AUTHENTICATION_FAILED' })
    expect(providerCalls).toBe(1)
    await accepted.closed
    /** Genuine new signing callbacks can answer the new receiver challenge on the same Host. */
    fresh = await server.connect('caller', { plugins: [authentication()] })
    expect(await fresh.host.memory.send('server', 'echo', 'fresh')).toBe('fresh')
    expect(providerCalls).toBe(2)
  } finally {
    await sender.close()
    await Promise.all([first?.host.close(), fresh?.host.close(), host.close()])
  }
})

it('publishes only an explicit authenticated principal on the actual accepted Session', async () => {
  /** One fixture owns credentials shared by the actual verifier and its two genuine clients. */
  const identity = {
    credential: 'principal-token',
    legacyCredential: 'legacy-token',
    principalId: 'verified-principal'
  }
  /** The verifier's original results are local trusted outputs, not peer names or wire claims. */
  const server = coreMemoryServer('principal-server')
  /** One Auth installation admits both an explicit identity and an old ignored string return. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      auth({
        verifyCredentials: (value) => {
          if (value === identity.credential) return { principalId: identity.principalId }
          if (value === identity.legacyCredential) return 'old-debug-return'
          throw new Error('unrecognized principal fixture credential')
        }
      }),
      ...server.options.plugins
    ],
    provide: { echo: (value) => value }
  })
  /** These actual public Hosts are owned by the same final cleanup regardless of assertion failure. */
  const clients: Awaited<ReturnType<typeof server.connect>>[] = []
  try {
    /** Native identity and authentication identity deliberately have distinct literal values. */
    const authenticated = await server.connect('wire-name', {
      plugins: [auth({ credentials: identity.credential })]
    })
    clients.push(authenticated)
    expect(server.lookup('wire-name')?.view.authentication).toEqual({
      principalId: identity.principalId,
      sessionId: authenticated.pair[0].id
    })
    expect(await authenticated.host.memory.send('principal-server', 'echo', 42)).toBe(42)
    /** A string return remains ignored and cannot silently grant a new principal. */
    const legacy = await server.connect('legacy-name', {
      plugins: [auth({ credentials: identity.legacyCredential })]
    })
    clients.push(legacy)
    expect(server.lookup('legacy-name')?.view.authentication).toBeUndefined()
    expect(await legacy.host.memory.send('principal-server', 'echo', 42)).toBe(42)
  } finally {
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})

/** One physical pair observes only the genuine native registration, codec and HMAC callbacks. */
class PhysicalAuthenticationPair {
  /** Native structured-clone resources retain their original caller-owned final cleanup. */
  readonly ports = new MessageChannel()
  /** Receiving diagnostics remain distinct from the caller's original outbound failures. */
  readonly inboundFailures: unknown[] = []
  /** Public call failures are retained without translating their original identity. */
  readonly outboundFailures: unknown[] = []
  /** Only genuine provider entry records business effects. */
  readonly providers: unknown[] = []
  /** Successful HMAC verification counts actual inputs, including captured physical replays. */
  verifies = 0
  /** Each host installs its own original opaque authentication factory result exactly once. */
  readonly clientFeature: ReturnType<typeof auth>
  /** Separate configuration identity constructs the receiver's independent replay owner. */
  readonly serverFeature: ReturnType<typeof auth>
  /** The ordinary SDK listener accepts the actual borrowed MessagePort carrier. */
  readonly server = coreMemoryServer('physical-server')
  /** Real Node carrier observations and native cloning remain below the unchanged JSON codec. */
  readonly serverCarrier = createNodeThreadCarrier(
    this.ports.port2,
    'physical-server-port',
    (error) => this.inboundFailures.push(error)
  )
  /** The caller uses the same genuine carrier constructor and original physical write owner. */
  readonly clientCarrier = createNodeThreadCarrier(
    this.ports.port1,
    'physical-client-port',
    (error) => this.outboundFailures.push(error)
  )
  /** Default spies retain actual original inputs/results without replacing codec execution. */
  readonly encoded = vi.spyOn(this.clientCarrier.codec, 'encode')
  /** The actual native wrapper supplies the exact installed entry; no second setup is executed. */
  readonly registered = vi.spyOn(FlowRegistry.prototype, 'prepareTransport')
  /** Public host handles retain their original shared close owner. */
  #serverHost: { close(): Promise<void> } | undefined
  /** Caller construction and final close remain owned by its public root. */
  #clientHost: { close(): Promise<void>; memory: IRpcNamespace } | undefined

  /** Sign the complete original authentication input without decoding semantic or media frames. */
  readonly #sign = (value: unknown) => ({ value, signature: this.#signature(value) })

  /** Validate HMAC before counting an accepted cryptographic input or returning its original value. */
  readonly #verify = (value: unknown): unknown => {
    /** Only this finite fixture's signer produces this exact protected callback representation. */
    const signed = value as { value: unknown; signature: string }
    expect(signed.signature).toBe(this.#signature(signed.value))
    this.verifies += 1
    return signed.value
  }

  /** Public fixture material is unrelated to any deployed credential. */
  #signature(value: unknown): string {
    return createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex')
  }

  /** Capture original callback methods only after this pair's owning state has initialized. */
  constructor() {
    this.clientFeature = auth({ sign: this.#sign, verify: this.#verify })
    this.serverFeature = auth({ sign: this.#sign, verify: this.#verify })
  }

  /** Admit both original endpoints before either native handshake can suspend waiting for its peer. */
  readonly #open = async (context: IRpcTransportContext) => {
    /** The installed listener owns the receiving endpoint's original attachment. */
    const accepted = this.server.accept(this.serverCarrier)
    /** The actual caller transport owns its independently attached local endpoint. */
    const connected = context.attach(this.clientCarrier)
    await Promise.all([accepted.ready, connected.ready])
    return { dispose: () => undefined }
  }

  /** Construct only ordinary public roots and the one real transport definition. */
  async open(): Promise<void> {
    this.#serverHost = await createRpcHost({
      ...this.server.options,
      plugins: [this.serverFeature, ...this.server.options.plugins],
      report: (error) => this.inboundFailures.push(error),
      provide: {
        echo: (value) => {
          this.providers.push(value)
          return value
        }
      }
    })
    this.#clientHost = await createRpcHost({
      self: { name: 'physical-client', instanceId: 'physical-client' },
      plugins: [
        defineTransportPlugin({
          name: 'physical-authentication-client',
          namespace: 'memory',
          features: [this.clientFeature],
          open: this.#open
        })
      ],
      report: (error) => this.outboundFailures.push(error)
    })
  }

  /** Calls cross the actual named namespace and original physical carrier pair. */
  send(value: string): Promise<unknown> {
    return this.#clientHost!.memory.send('physical-server', 'echo', value)
  }

  /** Borrow only the original Auth installation returned by genuine native group preparation. */
  async installation() {
    /** The local program retains the exact original opaque Auth handle. */
    const installed = new Set<Parameters<typeof setAuthenticationReplayCounter>[0]>()
    for (let index = 0; index < this.registered.mock.calls.length; index += 1) {
      /** Native preparation supplies the actual local Feature program, never a copied definition. */
      const [, program] = this.registered.mock.calls[index]!
      if (!Object.values(program.features).includes(this.clientFeature)) continue
      /** The original fulfilled preparation returns the same instances used by physical traffic. */
      const result = this.registered.mock.results[index]!
      expect(result.type).toBe('return')
      /** Await the actual setup result without invoking setup a second time. */
      const group = await result.value
      for (const entry of group.facts().selected) installed.add(entry)
    }
    expect(installed.size).toBe(1)
    return [...installed][0]!
  }

  /** Final cleanup releases both public roots before their original borrowed native ports. */
  async close(): Promise<void> {
    try {
      await Promise.all([this.#clientHost?.close(), this.#serverHost?.close()])
    } finally {
      this.encoded.mockRestore()
      this.registered.mockRestore()
      this.ports.port1.close()
      this.ports.port2.close()
    }
  }
}

it('protects all original binding fields on real MessagePorts and reports the same exhausted counter once', async () => {
  /** All observed state belongs to this one pair of genuine public roots and native carriers. */
  const pair = new PhysicalAuthenticationPair()
  try {
    await pair.open()
    expect(await pair.send('discovered')).toBe('discovered')
    expect(setAuthenticationReplayCounter(await pair.installation(), 0xfffffffffffffffen)).toBe(
      true
    )
    expect(await pair.send('last')).toBe('last')
    expect(pair.providers).toEqual(['discovered', 'last'])
    /** The original encode inputs are retained before any later physical injection changes them. */
    const [prepared, context] = pair.encoded.mock.calls.at(-1)!
    /** Actual JSON preparation selected the original authentication wrapper and signed text. */
    const outer = prepared.message as { payload: { value: unknown; signature: string } }
    /** Canonical Auth inspection is confined to constructing the six original hostile inputs. */
    const representation = new AuthenticationRepresentation('any')
    /** Signed metadata is inspected once without a second media decode or semantic restore. */
    const bound = readAuthenticationEnvelope(representation.plaintext(outer.payload.value))
    expect(bound.counter).toBe('18446744073709551615')
    /** The same existing Auth representation supplies the original signed semantic metadata. */
    const semantic = representation.metadata(bound.payload) as IRpcEnvelopeCommon
    for (const change of [
      { version: 2 },
      { nonce: '0'.repeat(32) },
      { counter: '1' },
      { payload: 'tampered' },
      {
        payload: JSON.stringify({
          ...semantic,
          route: { ...semantic.route, senderId: 'forged-sender' }
        })
      },
      {
        payload: JSON.stringify({
          ...semantic,
          route: { ...semantic.route, receiverId: 'forged-receiver' }
        })
      }
    ]) {
      /** Each distinct hostile input is encoded once by the actual already-owned media codec. */
      const frame = pair.clientCarrier.codec.encode(
        {
          ...prepared,
          message: {
            ...outer,
            payload: {
              ...outer.payload,
              value: RpcAuthenticationEnvelope.prefix + JSON.stringify({ ...bound, ...change })
            }
          }
        },
        context
      )
      /** The native report count is sampled before the real physical injection. */
      const before = pair.inboundFailures.length
      pair.ports.port1.postMessage(frame)
      for (let turn = 0; turn < 20 && pair.inboundFailures.length === before; turn++)
        await nextTurn()
      expect(pair.inboundFailures).toHaveLength(before + 1)
      expect(pair.inboundFailures.at(-1)).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      expect(pair.providers).toEqual(['discovered', 'last'])
    }
    /**
     * The public rejection and its original report must refer to the same exhausted allocator
     * error.
     */
    const failure = await pair.send('overflow').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      code: 'INVALID_CONFIG',
      message: RpcAuthenticationText.authenticationCounterExhausted
    })
    expect(pair.outboundFailures.filter((error) => error === failure)).toHaveLength(1)
    expect(pair.providers).toEqual(['discovered', 'last'])
  } finally {
    await pair.close()
  }
})

it.each([100, 310_001])(
  'rejects the captured signed native frame after a controlled clock offset of %s ms',
  async (elapsed) => {
    /** The replay remains the exact original native frame, without re-signing or re-encoding it. */
    const pair = new PhysicalAuthenticationPair()
    /** Restore the actual global clock before ordinary public-root final cleanup. */
    let clock: { mockRestore(): void } | undefined
    try {
      await pair.open()
      expect(await pair.send('original')).toBe('original')
      expect(pair.providers).toEqual(['original'])
      /** This exact result was handed to the original carrier after the original HMAC callback. */
      const replay = pair.encoded.mock.results.at(-1)!.value as IRpcCarrierFrame
      expect(replay).toBeTruthy()
      /** No public operation remains pending when the existing monotonic input is controlled. */
      const before = pair.verifies
      /** The original native clock method retains its actual platform receiver on every read. */
      const originalNow = performance.now
      /** An integer native sample keeps this controlled offset exact without claiming wall time. */
      let nativeSample = 0
      clock = vi.spyOn(performance, 'now').mockImplementation(() => {
        nativeSample = Math.trunc(Reflect.apply(originalNow, performance, []) as number)
        return nativeSample + elapsed
      })
      expect(performance.now() - nativeSample).toBe(elapsed)
      pair.ports.port1.postMessage(replay)
      for (let turn = 0; turn < 20 && pair.inboundFailures.length === 0; turn++) await nextTurn()
      expect(pair.verifies).toBe(before + 1)
      expect(pair.providers).toEqual(['original'])
      expect(pair.inboundFailures).toHaveLength(1)
      expect(pair.inboundFailures[0]).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    } finally {
      clock?.mockRestore()
      await pair.close()
    }
  }
)
