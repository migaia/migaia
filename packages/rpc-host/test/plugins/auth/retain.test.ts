/** Public Auth requests distinguish active duplicate suppression from completed-ID retention. */
import { expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { auth, type IRpcAuthenticationOptions } from '@migaia/rpc-host/plugins/auth'
import { defineFlowFeature, defineTransportPlugin, type IRpcFlowStage } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import type {
  IRpcAuthenticationRetain,
  IRpcPreparedMessage,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import {
  RequestReplayLedger,
  type IRequestReplayEntry
} from '../../../dist/features/auth/request-replay.js'
import { ProviderDispatcher } from '../../../dist/dispatch/dispatcher.js'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'

/** Preserve an actual plaintext request so a later public notification can reissue its exact ID. */
class ReissuedRequest {
  /** Only the first actual request is retained; Auth still signs every later traversal itself. */
  #prepared: IRpcPreparedMessage | undefined
  /** A single public notification consumes this explicit one-shot replay request. */
  #reissue = false
  /** The ordinary native Feature owns this sole plaintext stage and its original continuation. */
  readonly feature = defineFlowFeature({
    name: 'a30-reissue-original-request',
    setup: () => ({ stages: { envelopeOutbound: this.#outbound } })
  })

  /** Select one original prepared message; never call the single-continuation point twice. */
  readonly #outbound: IRpcFlowStage<'envelopeOutbound'> = (payload, next) => {
    if (this.#reissue) {
      this.#reissue = false
      expect(this.#prepared).toBeDefined()
      return next({ ...payload, prepared: this.#prepared! })
    }
    /** Only real calls are saved; bootstrap and directory traffic keep their original path. */
    const message = payload.prepared.message as IRpcSemanticFrame
    if (message.kind === 'call' && !this.#prepared) this.#prepared = payload.prepared
    return next(payload)
  }

  /** The next genuine public notification drives a fresh Auth traversal of the saved request. */
  arm(): void {
    this.#reissue = true
  }
}

/** Own only public Host handles, the existing memory listener and actual provider observations. */
class PublicRetentionPair {
  /** One ordinary accepted transport supplies the actual source and Session lifetime. */
  readonly listener = coreMemoryServer('retain-server')
  /** Real provider entry, rather than a replay callback, records every business execution. */
  readonly delivered: string[] = []
  /** Both original roots preserve uncaught failures, including any reissued late reply. */
  readonly reports: unknown[] = []
  /** The first held request exposes actual in-flight work to duplicate and window assertions. */
  readonly entered = deferred<void>()
  /** Only the original provider decides when that actual first request finishes. */
  readonly released = deferred<void>()
  /** Every reissue goes through this ordinary public native Feature. */
  readonly replay = new ReissuedRequest()
  /** Server construction and cleanup remain owned by the original public Host. */
  #server: IRpcHost | undefined
  /** The opposite public root owns the genuine connecting transport and call records. */
  #client: IRpcHost | undefined

  /** Install independent authentic Auth owners before opening the existing carrier pair. */
  async open(options: IRpcAuthenticationOptions): Promise<void> {
    this.#server = await createRpcHost({
      ...this.listener.options,
      plugins: [auth(options), this.listener.transport],
      report: (error) => this.reports.push(error),
      provide: { echo: this.#echo }
    })
    this.#client = (
      await this.listener.connect('retain-client', {
        plugins: [this.replay.feature, auth({ sign: (value) => value, verify: (value) => value })],
        report: (error) => this.reports.push(error)
      })
    ).host
  }

  /** Returning the held promise keeps the original provider completion and Auth entry active. */
  readonly #echo = async (value: string): Promise<string> => {
    this.delivered.push(value)
    if (value === 'held' && this.delivered.length === 1) {
      this.entered.resolve()
      await this.released.promise
    }
    return value
  }

  /** Public requests allocate normal call records and traverse the actual physical Session. */
  send(value: string): Promise<unknown> {
    return this.#client!.memory.send('retain-server', 'echo', value)
  }

  /** One real public notification replaces its prepared data with the captured original request. */
  async reissue(): Promise<void> {
    this.replay.arm()
    await this.#client!.memory.notify('echo', 'reissue', { targetId: 'retain-server' })
  }

  /** Release actual provider work before closing the original public roots. */
  async close(): Promise<void> {
    this.released.resolve()
    await Promise.all([this.#client?.close(), this.#server?.close()])
  }
}

/** Real native endpoints expose the SDK's public transport-level connection configuration. */
class RetentionConnection {
  /** The listener and genuine connecting transport each own one original endpoint. */
  readonly pair = [
    new MemoryCarrier('retain-override-server'),
    new MemoryCarrier('retain-override-client')
  ] as const
  /** This cold native definition carries the exact per-connection override to actual attachment. */
  readonly transport
  /** The existing memory listener alone supplies receiving admission authority. */
  readonly #listener: ReturnType<typeof coreMemoryServer>

  /** Invalid values deliberately exercise the public JavaScript configuration boundary. */
  constructor(listener: ReturnType<typeof coreMemoryServer>, retain: unknown) {
    this.#listener = listener
    this.pair[0].link(this.pair[1])
    this.pair[1].link(this.pair[0])
    this.transport = defineTransportPlugin({
      name: 'retain-override',
      namespace: 'memory',
      connect: { retain: retain as IRpcAuthenticationRetain },
      open: this.#open
    })
  }

  /** Actual attachment owns both handshakes; rejected config still observes remote rollback. */
  readonly #open = async (context: IRpcTransportContext) => {
    /** Observe the original accepted ready rejection before opposite attachment can reject config. */
    const accepted = this.#listener.accept(this.pair[0]).ready.then(
      () => ({ ready: true }) as const,
      (error: unknown) => ({ error })
    )
    /** No ready result or accepted view is fabricated for this genuine connecting Session. */
    const connected = context.attach(this.pair[1])
    /** A valid peer must finish its genuine receiving handshake, not merely the client side. */
    const [result] = await Promise.all([accepted, connected.ready])
    if ('error' in result) throw result.error
    return { dispose() {} }
  }

  /** Release the original physical endpoints after each independent public construction. */
  async close(): Promise<void> {
    await Promise.all(this.pair.map((carrier) => carrier.close()))
  }
}

it('A30 completes 5000 sequential requests and releases every actual default replay entry', async () => {
  /** One peer deliberately has a numeric-mode capacity below the number of sequential requests. */
  const pair = new PublicRetentionPair()
  /** The genuine original owner performs each settlement before its actual state is inspected. */
  const original = RequestReplayLedger.prototype.settle
  /** No fixture counter substitutes for real ledger membership or source cleanup membership. */
  const settled = vi
    .spyOn(RequestReplayLedger.prototype, 'settle')
    .mockImplementation(function (this: RequestReplayLedger, key, entry, now) {
      Reflect.apply(original, this, [key, entry, now])
      expect(this.has(key, now)).toBe(false)
      expect(entry.source.replayKeys.size).toBe(0)
    })
  try {
    await pair.open({
      sign: (value) => value,
      verify: (value) => value,
      maxReplayEntriesPerPeer: 1
    })
    for (let index = 0; index < 5_000; index++)
      expect(await pair.send(String(index))).toBe(String(index))
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(5_000))
    for (const result of settled.mock.results) expect(result.type).toBe('return')
    expect(pair.delivered).toHaveLength(5_000)
    expect(pair.reports).toEqual([])
  } finally {
    await pair.close()
    settled.mockRestore()
  }
})

it('A30 silently drops an in-flight request ID while executing its provider exactly once', async () => {
  /** The original public request stays active while a newly signed duplicate enters the same source. */
  const pair = new PublicRetentionPair()
  /** Actual Auth admission supplies the original active identity and its canonical ledger owner. */
  const admitted = vi.spyOn(RequestReplayLedger.prototype, 'admit')
  /**
   * Native active-correlation admission receives both verified frames before any second Auth
   * dispatch.
   */
  const accepted = vi.spyOn(ProviderDispatcher.prototype, 'accept')
  /** Observe the pending public request immediately during the genuine provider wait. */
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined
  try {
    await pair.open({ sign: (value) => value, verify: (value) => value })
    pending = Promise.allSettled([pair.send('held')])
    await pair.entered.promise
    /** These exact owner/key observations come from the original live Auth admission. */
    const key = admitted.mock.calls[0]![2]
    const ledger = admitted.mock.contexts[0]!
    if (!(ledger instanceof RequestReplayLedger)) expect.fail('expected actual Auth ledger owner')
    expect(ledger.has(key, performance.now())).toBe(true)
    /** The second traversal has a fresh signed counter but the exact same original request ID. */
    const before = accepted.mock.calls.length
    await pair.reissue()
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(before + 1))
    expect(accepted.mock.calls[before]![1].id).toBe(accepted.mock.calls[0]![1].id)
    expect(accepted.mock.results[before]?.value).toBe(accepted.mock.results[0]?.value)
    expect(ledger.has(key, performance.now())).toBe(true)
    expect(pair.delivered).toEqual(['held'])
    pair.released.resolve()
    expect(await pending).toEqual([{ status: 'fulfilled', value: 'held' }])
  } finally {
    pair.released.resolve()
    await pair.close()
    await pending
    admitted.mockRestore()
    accepted.mockRestore()
  }
})

it('A30 retains numeric IDs for 1000ms, rejects numeric capacity and executes after expiry', async () => {
  /** A deterministic monotonic input drives expiry without measuring elapsed wall time. */
  let now = performance.now()
  /** The public pair remains responsible for all original physical work and cleanup. */
  const pair = new PublicRetentionPair()
  /** Actual duplicate checks remain passthrough observations of the installed Auth owner. */
  const checked = vi.spyOn(RequestReplayLedger.prototype, 'has')
  /**
   * The real completion establishes the start of numeric retention, independently from reply
   * delivery.
   */
  const settled = vi.spyOn(RequestReplayLedger.prototype, 'settle')
  /** The configured retention clock is installed only after native handshake completes. */
  let clock: { mockRestore(): void } | undefined
  try {
    await pair.open({
      sign: (value) => value,
      verify: (value) => value,
      retain: 1_000,
      maxReplayEntriesPerPeer: 1
    })
    clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(await pair.send('original')).toBe('original')
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
    /** At 999ms the original completed ID still exists and is silently discarded. */
    now += 999
    const before = checked.mock.calls.length
    await pair.reissue()
    await vi.waitFor(() => expect(checked.mock.calls.length).toBeGreaterThan(before))
    expect(checked.mock.results.at(-1)?.value).toBe(true)
    expect(pair.delivered).toEqual(['original'])
    await expect(pair.send('numeric-full')).rejects.toMatchObject({ code: 'OVERLOADED' })
    /** Expiry releases that exact historical identity, allowing the same request to execute again. */
    now += 2
    await pair.reissue()
    await vi.waitFor(() => expect(pair.delivered).toEqual(['original', 'original']))
  } finally {
    clock?.mockRestore()
    await pair.close()
    checked.mockRestore()
    settled.mockRestore()
  }
})

it('A30 advances the real signed window without releasing active requests or accumulating history', async () => {
  /** The first request stays active while 64 genuine signed requests move the source counter. */
  const pair = new PublicRetentionPair()
  /** Exact original entries expose source membership, not a fixture-maintained occupancy count. */
  const settled = vi.spyOn(RequestReplayLedger.prototype, 'settle')
  /** The native dispatcher receives verified duplicates before reusing the active business promise. */
  const accepted = vi.spyOn(ProviderDispatcher.prototype, 'accept')
  /**
   * Original admission preserves the exact held ID and real ledger instance before any window
   * advance.
   */
  const admitted = vi.spyOn(RequestReplayLedger.prototype, 'admit')
  /** Observe the original pending public request while the actual provider remains held. */
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined
  try {
    await pair.open({
      sign: (value) => value,
      verify: (value) => value,
      retain: 'window',
      maxReplayEntriesPerPeer: 1
    })
    pending = Promise.allSettled([pair.send('held')])
    await pair.entered.promise
    /**
     * These are the actual accepted entry and its canonical owner, not a fixture-generated
     * identity.
     */
    const activeKey = admitted.mock.calls[0]![2]
    const ledger = admitted.mock.contexts[0]!
    if (!(ledger instanceof RequestReplayLedger)) expect.fail('expected actual Auth ledger owner')
    for (let index = 0; index < 64; index++)
      expect(await pair.send(String(index))).toBe(String(index))
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(64))
    /** Every completed request belongs to the same real source, alongside its one active ID. */
    const source = settled.mock.calls[0]![1].source
    /** The first completed request remains within the current 64-slot signed window. */
    const completedKey = settled.mock.calls[0]![0]
    expect(ledger.has(completedKey, performance.now())).toBe(true)
    expect(source.replayKeys.size).toBeLessThanOrEqual(65)
    const before = accepted.mock.calls.length
    await pair.reissue()
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(before + 1))
    expect(accepted.mock.calls[before]![1].id).toBe(accepted.mock.calls[0]![1].id)
    expect(accepted.mock.results[before]?.value).toBe(accepted.mock.results[0]?.value)
    expect(ledger.has(activeKey, performance.now())).toBe(true)
    expect(ledger.has(completedKey, performance.now())).toBe(false)
    expect(pair.delivered.filter((value) => value === 'held')).toHaveLength(1)
    pair.released.resolve()
    expect(await pending).toEqual([{ status: 'fulfilled', value: 'held' }])
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(65))
    /** The settled original is already outside the authentic counter window and must be released. */
    expect(ledger.has(activeKey, performance.now())).toBe(false)
    expect(source.replayKeys.has(activeKey)).toBe(false)
    await pair.reissue()
    await vi.waitFor(() =>
      expect(pair.delivered.filter((value) => value === 'held')).toHaveLength(2)
    )
    expect(source.replayKeys.size).toBeLessThanOrEqual(64)
  } finally {
    pair.released.resolve()
    await pair.close()
    await pending
    settled.mockRestore()
    accepted.mockRestore()
    admitted.mockRestore()
  }
})

it('A30 advances only expired completed counters with many active identities', () => {
  /** Counter movement is deterministic business state, not elapsed-time measurement. */
  let high = 0n
  /** This existing source getter observes which completed counter boundaries advancement inspects. */
  let windowReads = 0
  /** Original cleanup membership also contains active IDs that advancement must never traverse. */
  const source = {
    replayKeys: new Set<string>(),
    window: {
      get high() {
        windowReads += 1
        return high
      }
    }
  }
  /** Window mode does not reserve this deliberately tiny numeric retention capacity. */
  const ledger = new RequestReplayLedger(1)
  for (let index = 1; index <= 512; index++) {
    high = BigInt(index)
    ledger.admit(source, 'window-peer', `active-${index}`, 0, 'window', high)
  }
  /** Each completed correlation retains its exact original entry while completion order differs. */
  const completions = new Map<bigint, Readonly<{ key: string; entry: IRequestReplayEntry }>>()
  for (const counter of [513n, 514n, 515n, 516n]) {
    high = counter
    /** These actual admissions use current counters, before their providers finish out of order. */
    const key = `completed-${counter}`
    completions.set(counter, {
      key,
      entry: ledger.admit(source, 'window-peer', key, 0, 'window', counter)!
    })
  }
  for (const counter of [515n, 513n, 516n, 514n]) {
    /** A fast later provider must not keep an expired earlier counter behind it. */
    const completed = completions.get(counter)!
    ledger.settle(completed.key, completed.entry, 0)
  }
  /** These public Set observations never read or replace private ledger tables. */
  const iterations = vi.spyOn(source.replayKeys, Symbol.iterator)
  /** Exact removal order proves expired heads are consumed in counter order. */
  const removed = vi.spyOn(source.replayKeys, 'delete')
  try {
    high = 578n
    windowReads = 0
    ledger.advanceWindow(source)
    expect(iterations).not.toHaveBeenCalled()
    expect(removed.mock.calls).toEqual([['completed-513'], ['completed-514']])
    expect(windowReads).toBeLessThanOrEqual(3)
    expect(ledger.has('completed-513', 0)).toBe(false)
    expect(ledger.has('completed-514', 0)).toBe(false)
    expect(ledger.has('completed-515', 0)).toBe(true)
    expect(ledger.has('completed-516', 0)).toBe(true)
    expect(ledger.has('active-1', 0)).toBe(true)
    expect(source.replayKeys.size).toBe(514)
  } finally {
    iterations.mockRestore()
    removed.mockRestore()
    ledger.retire(source)
  }
})

it('A30 gives the public transport connection retain precedence over its installed Auth option', async () => {
  /** The original listener owns the opposite physical source; no accepted Session is fabricated. */
  const listener = coreMemoryServer('retain-origin')
  /** Server requests can reissue exact original metadata through the real plaintext stage. */
  const replay = new ReissuedRequest()
  /** Actual client provider calls are the observable retention result. */
  const delivered: string[] = []
  /** The real client transport configuration supplies the per-connection override. */
  const connection = new RetentionConnection(listener, false)
  /** Each side installs only genuine native Features and one original transport. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      replay.feature,
      auth({ sign: (value) => value, verify: (value) => value }),
      listener.transport
    ]
  })
  /** Even a completed-ID-retaining Auth owner must honor the connection's explicit false. */
  let client: Pick<IRpcHost, 'close'> | undefined
  try {
    client = await createRpcHost({
      self: { name: 'retain-override-client', instanceId: 'retain-override-client' },
      plugins: [
        auth({ sign: (value) => value, verify: (value) => value, retain: 1_000 }),
        connection.transport
      ],
      provide: {
        echo: (value: string) => {
          delivered.push(value)
          return value
        }
      },
      report: () => undefined
    })
    expect(await server.memory.send('retain-override-client', 'echo', 'same-request')).toBe(
      'same-request'
    )
    replay.arm()
    await server.memory.notify('echo', 'reissue', { targetId: 'retain-override-client' })
    await vi.waitFor(() => expect(delivered).toEqual(['same-request', 'same-request']))
  } finally {
    await Promise.all([client?.close(), server.close()])
    await connection.close()
  }
})

it('A30 rejects unsigned window retention and every illegal numeric retention category', () => {
  /**
   * Zero, negative, fractional, nonfinite and unsafe values cover the declared invalid number
   * domain.
   */
  const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]
  for (const retain of invalid)
    expect(() => auth({ sign: (value) => value, verify: (value) => value, retain })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  expect(() => auth({ credentials: 'public-retain-fixture', retain: 'window' })).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
})

it('A30 rejects invalid public connection numbers, null and unsigned window as configuration', async () => {
  /** Each invalid supported category enters the actual public transport configuration path. */
  const invalid = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    'window'
  ]
  /** The same original unsigned Auth owner accepts each independent actual physical attempt. */
  const listener = coreMemoryServer('invalid-retain-server')
  /** Rollback failures remain observable independently from the primary configuration rejection. */
  const reports: unknown[] = []
  /** No signature callback can disguise the missing-signature window configuration failure. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [auth({ verifyCredentials: () => undefined }), listener.transport],
    report: (error) => reports.push(error)
  })
  try {
    for (const retain of invalid) {
      /** A separate original carrier pair keeps rejected configuration attempts independent. */
      const connection = new RetentionConnection(listener, retain)
      try {
        await expect(
          createRpcHost({
            self: { name: 'invalid-retain-client', instanceId: 'invalid-retain-client' },
            plugins: [auth({ credentials: 'public-retain-fixture' }), connection.transport],
            report: (error) => reports.push(error)
          })
        ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      } finally {
        await connection.close()
      }
    }
  } finally {
    await server.close()
  }
})
