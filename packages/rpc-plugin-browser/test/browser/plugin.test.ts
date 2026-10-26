import { expect, it } from 'vitest'
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
/** The existing ordinary thread outlet accepts a registration and its remote method. */
type IOrdinaryOutlet = Readonly<{ request(method: string, data?: unknown): Promise<unknown> }>
import * as browser from '@migaia/rpc-plugin-browser'
import { windowPair, portPair, rtcChannel } from './message-fixture.js'

it('exports every cold carrier factory through the real browser root', () => {
  expect(
    [
      'windowPlugin',
      'dedicatedWorkerPlugin',
      'sharedWorkerPlugin',
      'rtcDataChannelPlugin',
      'broadcastChannelPlugin',
      'serviceWorkerPlugin',
      'webTransportPlugin'
    ].map((name) => typeof Reflect.get(browser, name))
  ).toEqual(Array(7).fill('function'))
})

/** A native MessageChannel supplies Worker-shaped EventTarget delivery without implementing RPC. */
function workers() {
  /** Both ports stay owned by the fixture after host retirement. */
  const pair = new MessageChannel()
  pair.port1.start()
  pair.port2.start()
  return pair
}

it('carries bidirectional Worker calls and streams while retaining borrowed native ports', async () => {
  /** The two hosts only borrow this real structured-clone pipe. */
  const pair = workers()
  /** Each side owns a separate actual provider table. */
  const hosts = await Promise.all([
    createRpcHost({
      plugins: [browser.dedicatedWorkerPlugin({ worker: pair.port1 })],
      provide: { left: () => 'left' }
    }),
    createRpcHost({
      plugins: [browser.dedicatedWorkerPlugin({ worker: pair.port2 })],
      provide: {
        right: () => 'right',
        values: async function* () {
          yield 3
          yield 4
        }
      }
    })
  ])
  try {
    expect(await hosts[0].worker.request('right')).toBe('right')
    expect(await hosts[1].worker.request('left')).toBe('left')
    /** The canonical stream owner supplies both yielded values. */
    const values: unknown[] = []
    for await (const value of hosts[0].worker.stream('values') as AsyncIterableIterator<unknown>)
      values.push(value)
    expect(values).toEqual([3, 4])
    await Promise.all(hosts.map((host) => host.close()))
    /** Native delivery still works after both borrowed logical connections have been retired. */
    /** A retired host's queued close control frame may still arrive first; wait for this probe. */
    const received = new Promise<unknown>((resolve) =>
      pair.port2.addEventListener('message', (event) => {
        if (event.data === 'still-borrowed') resolve(event.data)
      })
    )
    pair.port1.postMessage('still-borrowed')
    expect(await received).toBe('still-borrowed')
  } finally {
    await Promise.all(hosts.map((host) => host.close()))
    pair.port1.close()
    pair.port2.close()
  }
})

it('rejects invalid carrier combinations synchronously before native acquisition', () => {
  /** No factory may install this counter-only carrier while validating its arguments. */
  let registrations = 0
  /** Native shape is sufficient for cold configuration; handshake begins only at installation. */
  const target = {
    postMessage() {},
    addEventListener() {
      registrations++
    },
    removeEventListener() {}
  }
  expect(() => browser.windowPlugin({ window: target } as never)).toThrow(
    expect.objectContaining({ code: 'WINDOW_ORIGIN_REQUIRED' })
  )
  expect(() => browser.windowPlugin({ window: target, origin: '*' })).toThrow(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
  expect(() =>
    browser.sharedWorkerPlugin({ sharedWorker: { port: target }, listen: target } as never)
  ).toThrow(expect.objectContaining({ code: 'INVALID_PEER_SOURCE' }))
  expect(() => browser.dedicatedWorkerPlugin({} as never)).toThrow(
    expect.objectContaining({ code: 'INVALID_PEER_SOURCE' })
  )
  expect(() =>
    browser.windowPlugin({ window: target, origin: '*', allowUnsafeTargetOrigin: true })
  ).not.toThrow()
  expect(registrations).toBe(0)
})

it.each(['window', 'worker', 'shared', 'rtc'] as const)(
  'applies the same SDK handshake budget to a silent %s carrier',
  async (carrier) => {
    /** Native registrations expose timeout cleanup without simulating the identity protocol. */
    const listeners = new Map<string, Set<unknown>>()
    /** Every supported source deliberately stays silent during the real SDK identity exchange. */
    const target = {
      postMessage() {},
      send() {},
      readyState: 'open',
      ordered: true,
      maxRetransmits: null,
      maxPacketLifeTime: null,
      addEventListener(type: string, listener: unknown) {
        const current = listeners.get(type) ?? new Set()
        current.add(listener)
        listeners.set(type, current)
      },
      removeEventListener(type: string, listener: unknown) {
        listeners.get(type)?.delete(listener)
      }
    }
    /** Only the selected carrier reaches native resource preparation. */
    const plugin =
      carrier === 'window'
        ? browser.windowPlugin({
            window: target,
            origin: 'https://silent.test',
            receiver: target,
            connect: { timeoutMs: 5 }
          })
        : carrier === 'worker'
          ? browser.dedicatedWorkerPlugin({ worker: target, connect: { timeoutMs: 5 } })
          : carrier === 'shared'
            ? browser.sharedWorkerPlugin({
                sharedWorker: { port: target },
                connect: { timeoutMs: 5 }
              })
            : browser.rtcDataChannelPlugin({ rtcDataChannel: target, connect: { timeoutMs: 5 } })
    await expect(
      createRpcHost({ plugins: [plugin], report: () => undefined })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect([...listeners.values()].reduce((total, current) => total + current.size, 0)).toBe(0)
  }
)

it.each(['window', 'worker', 'shared', 'rtc'] as const)(
  'installs the same %s configuration on a native Host after createRpcHost releases it',
  async (carrier) => {
    /** The same original native objects outlive both installation styles. */
    const native = carrier === 'worker' ? workers() : undefined
    /** Original browser fixture carriers preserve actual source/origin and RTC string delivery. */
    const pair = carrier === 'worker' ? undefined : carrier === 'window' ? windowPair() : portPair()
    /** Explicit exposure is exercised through each exact frozen factory value. */
    const options = {
      namespace: 'browser' as const,
      name: 'borrowed-worker',
      expose: ['app.increment']
    }
    /** The same cold plugin is installed by both hosts without copying native metadata. */
    const plugin =
      carrier === 'worker'
        ? browser.dedicatedWorkerPlugin({ ...options, worker: native!.port1 })
        : carrier === 'window'
          ? browser.windowPlugin({
              ...options,
              window: pair!.right.target,
              receiver: pair!.left.target,
              origin: 'https://right.test'
            })
          : carrier === 'shared'
            ? browser.sharedWorkerPlugin({
                ...options,
                sharedWorker: { port: pair!.left.target }
              })
            : browser.rtcDataChannelPlugin({
                ...options,
                rtcDataChannel: rtcChannel(pair!.left)
              })
    /** The actual opposing resource supplies the remote endpoint for both installation styles. */
    const remotePlugin =
      carrier === 'worker'
        ? browser.dedicatedWorkerPlugin({ namespace: 'browser', worker: native!.port2 })
        : carrier === 'window'
          ? browser.windowPlugin({
              namespace: 'browser',
              window: pair!.left.target,
              receiver: pair!.right.target,
              origin: 'https://left.test'
            })
          : carrier === 'shared'
            ? browser.sharedWorkerPlugin({
                namespace: 'browser',
                sharedWorker: { port: pair!.right.target }
              })
            : browser.rtcDataChannelPlugin({
                namespace: 'browser',
                rtcDataChannel: rtcChannel(pair!.right)
              })
    /** First prove the same cold object through the primary public entry. */
    const first = await Promise.all([
      createRpcHost({ plugins: [plugin] }),
      createRpcHost({ plugins: [remotePlugin], provide: { value: () => 17 } })
    ])
    expect(await first[0].browser.request('value')).toBe(17)
    await Promise.all(first.map((host) => host.close()))
    /** Ordinary Host lifecycle remains the sole installation and disposal owner. */
    /** Lazy pipeline authority reads this case's own native host only at installation. */
    const rpc = rpcHostPipelines(
      () => host,
      (name, request) => host.pipeline(name, request)
    )
    const host = defineHost({
      ...rpc,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Explicit exposure resolves the existing native Feature output rather than another provider. */
    const app = definePlugin({
      name: 'app',
      features: { view: defineFeature(() => ({ increment: (value: number) => value + 1 })) },
      install: () => ({})
    })
    /** Commit exposed application Features before either realm starts its transport. */
    await host.use(app)
    /** Both transport openings participate concurrently after application preparation completes. */
    const opening = createRpcHost({ plugins: [remotePlugin], provide: { value: () => 23 } })
    try {
      await host.use(plugin)
      const remote = await opening
      expect(await (Reflect.get(host, 'browser') as IOrdinaryOutlet).request('value')).toBe(23)
      expect(await remote.browser.request('app.increment', 4)).toBe(5)
      await host.dispose()
      await remote.close()
    } finally {
      await host.dispose()
      await (await opening).close()
      native?.port1.close()
      native?.port2.close()
    }
  }
)

it.each(['window', 'shared', 'rtc'] as const)(
  'runs bidirectional scalar and stream calls over a borrowed %s source',
  async (carrier) => {
    /** Existing raw fixture delivery preserves native source/origin or ordered string semantics. */
    const pair = carrier === 'window' ? windowPair() : portPair()
    /** Every opening retains the original factory and shared SDK resource path. */
    const plugins =
      carrier === 'window'
        ? [
            browser.windowPlugin({
              namespace: 'browser',
              window: pair.right.target,
              receiver: pair.left.target,
              origin: 'https://right.test'
            }),
            browser.windowPlugin({
              namespace: 'browser',
              window: pair.left.target,
              receiver: pair.right.target,
              origin: 'https://left.test'
            })
          ]
        : carrier === 'shared'
          ? [
              browser.sharedWorkerPlugin({
                namespace: 'browser',
                sharedWorker: { port: pair.left.target }
              }),
              browser.sharedWorkerPlugin({
                namespace: 'browser',
                sharedWorker: { port: pair.right.target }
              })
            ]
          : [
              browser.rtcDataChannelPlugin({
                namespace: 'browser',
                rtcDataChannel: rtcChannel(pair.left)
              }),
              browser.rtcDataChannelPlugin({
                namespace: 'browser',
                rtcDataChannel: rtcChannel(pair.right)
              })
            ]
    /** Providers are independent on the two actual endpoint assemblies. */
    const hosts = await Promise.all(
      plugins.map((plugin, index) =>
        createRpcHost({
          plugins: [plugin],
          provide: {
            who: () => index,
            values: async function* () {
              yield index
              yield index + 10
            }
          }
        })
      )
    )
    try {
      expect(await hosts[0]!.browser.request('who')).toBe(1)
      expect(await hosts[1]!.browser.request('who')).toBe(0)
      for (const [index, host] of hosts.entries()) {
        /** Consumer iteration reaches the same opposing stream provider in each direction. */
        const values: unknown[] = []
        for await (const value of host.browser.stream('values') as AsyncIterableIterator<unknown>)
          values.push(value)
        expect(values).toEqual([1 - index, 11 - index])
      }
    } finally {
      /** Each actual Host retains its own original close completion before terminal cleanup. */
      const disposals = hosts.map((host) => host.close())
      hosts.forEach((host, index) => expect(host.close()).toBe(disposals[index]))
      await Promise.all(disposals)
      expect(pair.left.closeCalls).toBe(0)
      expect(pair.right.closeCalls).toBe(0)
      /** Terminal repeated close borrows that same Promise and cannot acquire native ownership. */
      hosts.forEach((host, index) => expect(host.close()).toBe(disposals[index]))
    }
    expect(pair.left.closeCalls).toBe(0)
    expect(pair.right.closeCalls).toBe(0)
  }
)
