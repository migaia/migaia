import { describe, expect, expectTypeOf, it } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { createRpcHost } from '@migaia/rpc-host'
import { type IRpcFanoutResult } from '../../../rpc-host/dist/core/index.js'
import {
  windowPlugin,
  sharedWorkerPlugin,
  rtcDataChannelPlugin,
  RPC_BROWSER_ERROR_SOURCE
} from '@migaia/rpc-plugin-browser'
import { messageTarget, windowPair, portPair, rtcChannel } from './message-fixture.js'

/** Remote application declarations keep scalar and generator calls separate. */
type IFixtureApi = {
  echo(value: string): string
  record(value: string): void
  recorded(): string[]
  values(value: number): AsyncIterableIterator<number>
  hold(): Promise<void>
}

/** Business providers expose observable notify and stream results through the public Peer only. */
function providers() {
  /** Notification order stays observable without relying on send completion as provider completion. */
  const recorded: string[] = []
  return {
    echo: (value: string) => value,
    record: (value: string) => {
      recorded.push(value)
    },
    recorded: () => [...recorded],
    values: async function* (value: number) {
      yield value
      yield value + 1
    },
    hold: () => new Promise<void>(() => undefined)
  }
}

describe('browser Runtime Peer', () => {
  it.each(['window', 'shared-worker'] as const)(
    'provides typed request, notify, stream, directory, group and outcome over %s',
    async (carrier) => {
      /** The selected pair supplies native messages; Core owns every protocol and method operation. */
      const pair = carrier === 'window' ? windowPair() : portPair()
      /** Both factories participate in the original message handshake concurrently. */
      const peers = await Promise.all([
        createRpcHost<IFixtureApi>({
          plugins: [
            carrier === 'window'
              ? windowPlugin({
                  window: pair.right.target,
                  origin: 'https://right.test',
                  receiver: pair.left.target
                })
              : sharedWorkerPlugin({ sharedWorker: { port: pair.left.target } })
          ],
          report: () => undefined
        }),
        createRpcHost({
          plugins: [
            carrier === 'window'
              ? windowPlugin({
                  window: pair.left.target,
                  origin: 'https://left.test',
                  receiver: pair.right.target
                })
              : sharedWorkerPlugin({ sharedWorker: { port: pair.right.target } })
          ],
          provide: providers(),
          report: () => undefined
        })
      ])
      try {
        /** Generic remote typing must preserve the application's concrete scalar return. */
        const result = peers[0].request('echo', 'browser-peer')
        expectTypeOf(result).toEqualTypeOf<Promise<string | IRpcFanoutResult<string>>>()
        expect(await result).toBe('browser-peer')
        await peers[0].notify('record', 'first')
        expect(await peers[0].request('recorded')).toEqual(['first'])
        /** Generator typing and actual yielded values must both survive the browser carrier. */
        const streamed = peers[0].stream('values', 3)
        const stream = streamed as AsyncIterableIterator<number>
        expectTypeOf(stream).toEqualTypeOf<AsyncIterableIterator<number>>()
        expect(await stream.next()).toEqual({ done: false, value: 3 })
        expect(await stream.next()).toEqual({ done: false, value: 4 })
        expect((await stream.next()).done).toBe(true)
        expect((await peers[0].describe()).connections).toHaveLength(1)
        expect(
          await peers[0].group([{ method: 'echo', payload: 'group' }], {
            idempotencyKey: `browser-${carrier}`
          })
        ).toMatchObject([{ state: 'success', result: 'group' }])
        expect(await peers[0].outcome(`browser-${carrier}`)).toMatchObject({ state: 'done' })
        /** This uncalled callback proves typo, payload and scalar/generator misuse rejection. */
        const checkTypes = () => {
          // @ts-expect-error Unknown methods are absent from the remote API.
          peers[0].request('missing')
          // @ts-expect-error The method payload remains string, not a caller-selected generic.
          peers[0].request('echo', 3)
          // @ts-expect-error Generators use stream rather than scalar request.
          peers[0].request('values', 3)
          // @ts-expect-error Scalar methods cannot be claimed as streams.
          peers[0].stream('echo', 'value')
        }
        void checkTypes
        /** Close and asyncDispose retain Core's exact cleanup function and settlement Promise. */
        const closing = peers[0].close()
        expect(peers[0].close()).toBe(closing)
        expect(peers[0][Symbol.asyncDispose]).toBe(peers[0].close)
        expect(peers[0][Symbol.asyncDispose]()).toBe(closing)
        await closing
        expect(pair.left.closeCalls).toBe(0)
        expect(pair.right.closeCalls).toBe(0)
        expect(pair.left.listeners.get('message')?.size ?? 0).toBe(0)
        /** Late native delivery cannot revive the retired Peer or re-register its listener. */
        pair.left.emit('message', pair.left.sent.at(-1), pair.right.target, 'https://right.test')
        expect(pair.left.listeners.get('message')?.size ?? 0).toBe(0)
      } finally {
        await Promise.all(peers.map((peer) => peer.close()))
      }
    }
  )

  it('ignores real request frames from wrong origin and another Window', async () => {
    /** Two concrete Window identities establish a genuine source-bound handshake. */
    const pair = windowPair()
    /** Accepted provider invocation remains independent from copied wire identities. */
    let calls = 0
    /** Both accepted factories retain original Core runtime method admission. */
    const peers = await Promise.all([
      createRpcHost<{ count(): number }>({
        plugins: [
          windowPlugin({
            window: pair.right.target,
            origin: 'https://right.test',
            receiver: pair.left.target
          })
        ],
        report: () => undefined
      }),
      createRpcHost({
        plugins: [
          windowPlugin({
            window: pair.left.target,
            origin: 'https://left.test',
            receiver: pair.right.target
          })
        ],
        provide: { count: () => ++calls },
        report: () => undefined
      })
    ])
    try {
      pair.right.setDeliver(false)
      /** The completed handshake's frame count is the baseline before this request is sent. */
      const previous = pair.right.sent.length
      /** The untouched real outbound request is replayed only with hostile native metadata first. */
      const pending = peers[0].request('count', undefined, { timeoutMs: 500 })
      await expect.poll(() => pair.right.sent.length).toBeGreaterThan(previous)
      /** The last actual outbound frame retains its complete request payload. */
      const frame = pair.right.sent.at(-1)
      pair.right.emit('message', frame, pair.left.target, 'https://wrong.test')
      pair.right.emit('message', frame, {}, 'https://left.test')
      await Promise.resolve()
      expect(calls).toBe(0)
      pair.right.emit('message', frame, pair.left.target, 'https://left.test')
      expect(await pending).toBe(1)
      expect(calls).toBe(1)
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
    }
  })

  it('requires explicit Window origin and preserves the existing wildcard escape', async () => {
    /** Invalid configuration must fail before allocating any inbound listener. */
    const fixture = messageTarget()
    expect(() => windowPlugin({ window: fixture.target } as never)).toThrow(
      expect.objectContaining({ source: RPC_BROWSER_ERROR_SOURCE, code: 'WINDOW_ORIGIN_REQUIRED' })
    )
    expect(() =>
      windowPlugin({
        window: fixture.target,
        origin: '*',
        receiver: fixture.target
      })
    ).toThrow(expect.objectContaining({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' }))
    expect(fixture.listeners.get('message')?.size ?? 0).toBe(0)
  })

  it('ignores hostile origin and sibling source before the real identity proposal is accepted', async () => {
    /** Ready frames continue normally while both actual identity proposals are held. */
    const pair = windowPair()
    /** Each held initial comes from its live Core resource's ordinary physical send operation. */
    let leftInitial: unknown
    /** The opposite proposal remains independent from the first resource's initial. */
    let rightInitial: unknown
    /** The second proposal's send releases the test before either identity exchange completes. */
    let release!: () => void
    /**
     * Proposal readiness is a test-local physical-delivery barrier, not another handshake
     * implementation.
     */
    const captured = new Promise<void>((resolve) => {
      release = resolve
    })
    pair.left.setSend((message, origin) => {
      if (origin !== 'https://left.test') return
      if (rpcMessageCapabilityControl.isInitial(message)) {
        leftInitial = message
        if (rightInitial !== undefined) release()
        return
      }
      queueMicrotask(() =>
        pair.left.emit('message', structuredClone(message), pair.right.target, 'https://right.test')
      )
    })
    pair.right.setSend((message, origin) => {
      if (origin !== 'https://right.test') return
      if (rpcMessageCapabilityControl.isInitial(message)) {
        rightInitial = message
        if (leftInitial !== undefined) release()
        return
      }
      queueMicrotask(() =>
        pair.right.emit('message', structuredClone(message), pair.left.target, 'https://left.test')
      )
    })
    /** No startup or cleanup diagnostic may be hidden by the source/origin admission fixture. */
    const reports: unknown[] = []
    /** Both factories supply independent local offers through their original Core capture owners. */
    const opening = [
      createRpcHost<{ echo(value: string): string }>({
        plugins: [
          windowPlugin({
            window: pair.right.target,
            origin: 'https://right.test',
            receiver: pair.left.target
          })
        ],
        report: (error) => reports.push(error)
      }),
      createRpcHost({
        plugins: [
          windowPlugin({
            window: pair.left.target,
            origin: 'https://left.test',
            receiver: pair.right.target
          })
        ],
        provide: { echo: (value: string) => value },
        report: (error) => reports.push(error)
      })
    ] as const
    /** Observe opening failures immediately while the test holds real initial-frame delivery. */
    const opened = Promise.all(opening)
    void opened.catch(() => undefined)
    /** Observe only the attacked endpoint, so its still-blocked counterpart cannot hide admission. */
    let leftSettled = false
    void opening[0].then(
      () => {
        leftSettled = true
      },
      () => {
        leftSettled = true
      }
    )
    await captured
    expect(rpcMessageCapabilityControl.isInitial(leftInitial)).toBe(true)
    expect(rpcMessageCapabilityControl.isInitial(rightInitial)).toBe(true)
    pair.left.emit('message', leftInitial, pair.right.target, 'https://wrong.test')
    await delay(0)
    expect(leftSettled).toBe(false)
    pair.left.emit('message', leftInitial, {}, 'https://right.test')
    await delay(0)
    expect(leftSettled).toBe(false)
    pair.left.emit('message', leftInitial, pair.right.target, 'https://right.test')
    pair.right.emit('message', rightInitial, pair.left.target, 'https://left.test')
    /** Only genuine source/origin metadata may complete either original identity exchange. */
    const peers = await opened
    try {
      expect(await peers[0].request('echo', 'after-real-initial')).toBe('after-real-initial')
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
    }
    expect(reports).toEqual([])
  })

  it.each([
    { connect: { window: null, origin: 'https://peer.test' } },
    { connect: { sharedWorker: null } },
    { connect: { sharedWorker: {} } }
  ])('classifies missing supported carrier resources as INVALID_PEER_SOURCE', async (options) => {
    expect(() =>
      'window' in options.connect
        ? windowPlugin(options.connect as never)
        : sharedWorkerPlugin(options.connect as never)
    ).toThrow(
      expect.objectContaining({
        source: RPC_BROWSER_ERROR_SOURCE,
        code: 'INVALID_PEER_SOURCE'
      })
    )
  })

  it('cancels an unfinished handshake and removes listeners without closing the borrowed Window', async () => {
    /** A silent native target keeps the real Core message handshake unfinished. */
    const fixture = messageTarget()
    /** Caller cancellation is the factory's only pre-ready cleanup control. */
    const controller = new AbortController()
    /** Observe failure immediately so cancellation cannot create an unhandled fixture rejection. */
    const pending = createRpcHost({
      plugins: [
        windowPlugin({
          window: fixture.target,
          origin: 'https://silent.test',
          receiver: fixture.target
        })
      ],
      signal: controller.signal,
      report: () => undefined
    }).catch((error: unknown) => error)
    await expect.poll(() => fixture.listeners.get('message')?.size ?? 0).toBeGreaterThan(0)
    controller.abort()
    expect(await pending).toBeInstanceOf(Error)
    expect(fixture.listeners.get('message')?.size ?? 0).toBe(0)
    expect(fixture.closeCalls).toBe(0)
  })

  it('listens once, isolates two accepted ports and keeps Core zero/one/many targeting', async () => {
    /** The SharedWorker scope owns native connect events; it carries no trusted Peer state. */
    const scope = messageTarget()
    /** Two pages own independent physical ports into the same SharedWorker listener. */
    const pairs = [portPair(), portPair()] as const
    /** Ready observations count actual accepted sessions without exposing internal membership. */
    const ready: string[] = []
    /** Failed clients remain independently available for final cleanup. */
    const clients: Awaited<ReturnType<typeof createRpcHost<{ echo(value: string): string }>>>[] = []
    /** A listener's direct API selects a session only when there is exactly one. */
    const server = await createRpcHost<{ identify(): string }>({
      plugins: [sharedWorkerPlugin({ listen: scope.target })],
      provide: { echo: (value: string) => value },
      report: () => undefined
    })
    server.on('ready', (event) => ready.push(String(event.instanceId)))
    try {
      expect(await server.request('identify')).toEqual({ fulfilled: {}, rejected: {} })
      await expect(
        createRpcHost({
          plugins: [sharedWorkerPlugin({ listen: scope.target })],
          report: () => undefined
        })
      ).rejects.toMatchObject({ source: RPC_BROWSER_ERROR_SOURCE, code: 'LISTENER_ALREADY_BOUND' })
      /** The page and connect event participate concurrently in the actual message handshake. */
      const first = createRpcHost<{ echo(value: string): string }>({
        plugins: [sharedWorkerPlugin({ sharedWorker: { port: pairs[0].left.target } })],
        self: { name: 'page-a', instanceId: 'page-a' },
        provide: { identify: () => 'page-a' },
        report: () => undefined
      })
      scope.connect(pairs[0].right.target)
      clients.push(await first)
      await expect.poll(() => ready.length).toBe(1)
      expect(await server.request('identify')).toBe('page-a')
      /** A second accepted port must neither replace nor reuse the first page's session. */
      const second = createRpcHost<{ echo(value: string): string }>({
        plugins: [sharedWorkerPlugin({ sharedWorker: { port: pairs[1].left.target } })],
        self: { name: 'page-b', instanceId: 'page-b' },
        provide: { identify: () => 'page-b' },
        report: () => undefined
      })
      scope.connect(pairs[1].right.target)
      clients.push(await second)
      await expect.poll(() => ready.length).toBe(2)
      expect(new Set(ready).size).toBe(2)
      expect((await server.describe()).connections).toHaveLength(2)
      expect(await server.request('identify')).toEqual({
        fulfilled: Object.fromEntries(
          Object.keys(server.peers).map((name, index) => [
            JSON.stringify(['target', name]),
            index === 0 ? 'page-a' : 'page-b'
          ])
        ),
        rejected: {}
      })
      expect(
        await Promise.all(clients.map((peer, index) => peer.request('echo', `page-${index}`)))
      ).toEqual(['page-0', 'page-1'])
      await clients[0]!.close()
      expect(await clients[1]!.request('echo', 'survivor')).toBe('survivor')
      /** Closing listener subscription and accepted Peers does not close any page-owned port. */
      const closing = server.close()
      expect(server.close()).toBe(closing)
      await closing
      expect(scope.listeners.get('connect')?.size ?? 0).toBe(0)
      for (const pair of pairs) {
        expect(pair.left.closeCalls).toBe(0)
        expect(pair.right.closeCalls).toBe(0)
      }
    } finally {
      await Promise.all(clients.map((peer) => peer.close()))
      await server.close()
    }
  })

  it.each([
    { ordered: false, maxRetransmits: null, maxPacketLifeTime: null },
    { ordered: true, maxRetransmits: 1, maxPacketLifeTime: null },
    { ordered: true, maxRetransmits: null, maxPacketLifeTime: 1 }
  ])('rejects RTC channels outside ordered reliable delivery: %j', async (configuration) => {
    /** Native RTC ordering and reliability settings are physical carrier contract inputs. */
    const fixture = messageTarget()
    expect(() =>
      rtcDataChannelPlugin({
        rtcDataChannel: { ...fixture.target, ...configuration, readyState: 'open', send() {} }
      })
    ).toThrow(
      expect.objectContaining({ source: RPC_BROWSER_ERROR_SOURCE, code: 'RTC_CHANNEL_UNRELIABLE' })
    )
    expect(fixture.closeCalls).toBe(0)
    expect(fixture.listeners.size).toBe(0)
  })

  it('carries request and stream over reliable RTC and retains malformed JSON as the original decoder cause', async () => {
    /** String encoding stays in the existing RTC transport; the double forwards only native data. */
    const pair = portPair()
    /** Carrier failures remain observable through Core's ordinary reporter and pending call failure. */
    const reports: unknown[] = []
    /** Both borrowed channels negotiate through the same Core ACK and directory owners. */
    const peers = await Promise.all([
      createRpcHost<IFixtureApi>({
        plugins: [rtcDataChannelPlugin({ rtcDataChannel: rtcChannel(pair.left) })],
        defaultTimeoutMs: 200,
        report: (error) => reports.push(error)
      }),
      createRpcHost({
        plugins: [rtcDataChannelPlugin({ rtcDataChannel: rtcChannel(pair.right) })],
        provide: providers(),
        report: (error) => reports.push(error)
      })
    ])
    try {
      expect(await peers[0].request('echo', 'rtc-peer')).toBe('rtc-peer')
      /** Yielded values prove the reliable accepted channel supports the complete stream path. */
      const stream = peers[0].stream('values', 7) as AsyncIterableIterator<number>
      expect(await stream.next()).toEqual({ done: false, value: 7 })
      expect(await stream.next()).toEqual({ done: false, value: 8 })
      expect((await stream.next()).done).toBe(true)
      /** Observe the pending operation before malformed input terminates or times it out. */
      const pending = peers[0].request('hold').catch((error: unknown) => error)
      pair.left.emit('message', '{malformed-json')
      reports.push(await pending)
      /**
       * Follow only original causes; summaries or reconstructed errors cannot satisfy this
       * assertion.
       */
      const causes: unknown[] = []
      for (const report of reports) {
        /** Core may wrap the carrier error but must retain the native decoder object in its chain. */
        let cause = report
        for (let depth = 0; depth < 8 && cause instanceof Error; depth += 1) {
          causes.push(cause)
          cause = cause.cause
        }
      }
      /** The package decoder error retains native TypeError and the native JSON parser cause. */
      const decoder = causes.find(
        (cause) => cause instanceof Error && Reflect.get(cause, 'code') === 'MESSAGE_DECODE_FAILED'
      ) as Error | undefined
      expect(decoder?.constructor).toBe(TypeError)
      expect(decoder).toMatchObject({
        source: RPC_BROWSER_ERROR_SOURCE,
        code: 'MESSAGE_DECODE_FAILED'
      })
      expect(decoder?.cause).toBeInstanceOf(SyntaxError)
      expect((decoder?.cause as Error | undefined)?.stack).toBeTruthy()
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      expect(pair.left.closeCalls).toBe(0)
      expect(pair.right.closeCalls).toBe(0)
    }
  })
})
