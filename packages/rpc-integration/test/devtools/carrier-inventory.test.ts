import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IRpcTransport } from '@migaia/rpc-core'
import { RpcProbeDirection, type IRpcCarrierProbe } from '@migaia/rpc-core/probe'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-core/remote'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport
} from '@migaia/rpc-core/adapters/message-port'
import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'
import {
  createIpcSendQueueFeature,
  createIpcSendQueueTransport
} from '@migaia/rpc-core/plugins/send-queue'
import {
  createRuntimeByteConnection,
  createRuntimeMessageConnection,
  createAdapterJsonRpcChannel
} from '@migaia/rpc-core/adapter/internal-advanced'
import { RpcPlatform, RpcTransportEncoding } from '@migaia/rpc-core/transport-constants'
import {
  createProcessTransport,
  createNativeProcessOffer,
  createProcessChannelClosedError,
  openProcessObjectChannel
} from '@migaia/rpc-process'
import type {
  IProcessByteChannel,
  IProcessByteOptions,
  IProcessMessageChannel
} from '@migaia/rpc-process'
import { createNodeThreadChannel, createWebThreadChannel } from '@migaia/rpc-threads'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'
import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'
import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'
import { createProcessJsonRpcChannel } from '@migaia/rpc-process'
import { ProcessChannelDiagnostics } from '../../../rpc-process/src/process/diagnostics.js'
import { bridgeFixture, request } from '../bridge/fixture.js'

/** Inventory counts public callable factories that return transports, pairs, or transport channels. */
type IInventoryEntry = Readonly<{
  entry: string
  symbol: string
  open(): IInventoryInstance | Promise<IInventoryInstance>
}>
/** Each construction retains its actual transports and its original physical cleanup. */
type IInventoryInstance = Readonly<{
  transports: readonly Pick<IRpcTransport, 'observe' | 'send' | 'encodedType'>[]
  close(): void | Promise<void>
}>
/** The four carrier owners have no explicit carrier exclusions. */
const packages = ['rpc-core', 'rpc-process', 'rpc-threads', 'rpc-browser'] as const
/** Repository root resolves package export metadata independently of the process working directory. */
const root = fileURLToPath(new URL('../../../../', import.meta.url))
/** Keep actual transport cleanup when a direct public factory returns only one transport. */
function transportInstance(
  transport: Pick<IRpcTransport, 'observe' | 'close' | 'send' | 'encodedType'>
): IInventoryInstance {
  return { transports: [transport], close: () => transport.close?.() }
}

/** Native-shaped EventTarget inputs require no browser globals for construction-only inventory. */
function webPort() {
  return {
    id: 'inventory-client',
    readyState: 'open',
    postMessage: (
      _value: unknown,
      _transferOrOrigin?: unknown,
      _transfer?: readonly Transferable[]
    ) => undefined,
    addEventListener: (_type: string, _listener: unknown) => undefined,
    removeEventListener: (_type: string, _listener: unknown) => undefined,
    send: (_value: string) => undefined,
    start: () => undefined,
    close: () => undefined
  }
}

/** Real EventEmitter behavior supplies the public Node port's cold lifetime operations. */
function nodePort() {
  return Object.assign(new EventEmitter(), {
    postMessage: (_value: unknown) => undefined,
    close: () => undefined
  })
}

/** Raw whole-message inputs expose the same static no-handshake path used by Electron. */
function messagePort(): IProcessMessageChannel {
  return {
    kind: 'message',
    send: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
    close: () => undefined
  }
}

/** Ordinary connection options provide diagnostics without claiming a completed agreement. */
function commonOptions() {
  return {
    peerId: 'inventory-peer',
    report: () => undefined,
    ipc: { connectionId: 'inventory', sessionId: 'inventory', log: () => undefined }
  }
}

/** Complete the genuine public byte handshake using two connected physical reader callbacks. */
async function byteInstance(
  factory: (
    io: IProcessByteChannel,
    options: IProcessByteOptions
  ) => Promise<IRuntimePeerSourceResult>
): Promise<IInventoryInstance> {
  /** Each side owns its original raw subscription; no production frame decoder is duplicated. */
  const readers: Array<((bytes: Uint8Array) => void) | undefined> = []
  /** Paired I/O delivers the unchanged framed bytes to the opposite real decoder. */
  const port = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(bytes) {
      await Promise.resolve()
      readers[1 - index]?.(bytes)
    },
    onData(listener) {
      readers[index] = listener
      return () => {
        readers[index] = undefined
      }
    },
    onClose: () => () => undefined,
    close: () => undefined
  })
  /** The requested constructor runs on both sides and receives actual negotiated control frames. */
  const channels = await Promise.all([
    factory(port(0), {
      ...commonOptions(),
      role: 'initiator',
      offer: createNativeProcessOffer({ peer: { id: 'inventory-left', runtime: 'node' } })
    }),
    factory(port(1), {
      ...commonOptions(),
      role: 'responder',
      offer: createNativeProcessOffer({ peer: { id: 'inventory-right', runtime: 'node' } }),
      auth: { mode: 'none' }
    })
  ])
  return {
    transports: channels.map((channel) => channel.transport),
    async close() {
      for (const channel of channels) await channel.close()
    }
  }
}

/** Channel construction retains the channel's own cleanup rather than replacing its transport. */
function channelInstance(channel: IRuntimePeerSourceResult): IInventoryInstance {
  return { transports: [channel.transport], close: () => channel.close() }
}

/** Core's advanced JSON-RPC constructor opens its actual held connection through the Process owner. */
async function advancedJsonRpcInstance(): Promise<IInventoryInstance> {
  /** Existing integration fixture supplies the canonical hello and foreign byte representation. */
  const fixture = bridgeFixture()
  /** Both public operations execute against the actually negotiated object connection. */
  const channel = await createAdapterJsonRpcChannel(fixture.options, {
    closedError: createProcessChannelClosedError,
    openConnection: (connection, options) => openProcessObjectChannel(connection, options)
  })
  return channelInstance(channel)
}

/** Explicit entries include public aliases and advanced channels, with no exclusions. */
const inventory: readonly IInventoryEntry[] = [
  {
    entry: '@migaia/rpc-core/adapters/memory',
    symbol: 'createMemoryTransportPair',
    open() {
      /** Both returned sides are independent transports and must support observe. */
      const pair = createMemoryTransportPair()
      return {
        transports: pair,
        async close() {
          for (const transport of pair) await transport.close?.()
        }
      }
    }
  },
  {
    entry: '@migaia/rpc-core/adapters/message-port',
    symbol: 'createBrowserMessagePortTransport',
    open: () => transportInstance(createBrowserMessagePortTransport(webPort()))
  },
  {
    entry: '@migaia/rpc-core/adapters/message-port',
    symbol: 'createNodeMessagePortTransport',
    open: () => transportInstance(createNodeMessagePortTransport(nodePort()))
  },
  {
    entry: '@migaia/rpc-core/adapters/web-worker',
    symbol: 'createWebWorkerTransport',
    open: () => transportInstance(createWebWorkerTransport(webPort()))
  },
  {
    entry: '@migaia/rpc-core/plugins/send-queue',
    symbol: 'createIpcSendQueueTransport',
    open() {
      /** The public IPC wrapper must preserve observation of its actual physical carrier. */
      const pair = createMemoryTransportPair()
      /** Existing gate construction preserves the wrapper's ordinary public ownership. */
      const queue = createIpcSendQueueFeature({ connectionId: 'inventory' })
      /** This is the actual frozen wrapper, never a copied test object. */
      const transport = createIpcSendQueueTransport(pair[0], queue.gate)
      return {
        transports: [transport],
        async close() {
          await transport.close?.()
          await pair[1].close?.()
        }
      }
    }
  },
  {
    entry: '@migaia/rpc-core/adapter/internal-advanced',
    symbol: 'createRuntimeByteConnection',
    open: () =>
      byteInstance((io, options) =>
        createRuntimeByteConnection(
          io,
          { ...options, platform: RpcPlatform.process, expectedStringText: 'inventory byte text' },
          ProcessChannelDiagnostics
        )
      )
  },
  {
    entry: '@migaia/rpc-core/adapter/internal-advanced',
    symbol: 'createRuntimeMessageConnection',
    async open() {
      return channelInstance(
        await createRuntimeMessageConnection(
          messagePort(),
          {
            ...commonOptions(),
            platform: RpcPlatform.process,
            expectedStringText: 'inventory message text',
            offer: []
          },
          ProcessChannelDiagnostics
        )
      )
    }
  },
  {
    entry: '@migaia/rpc-core/adapter/internal-advanced',
    symbol: 'createAdapterJsonRpcChannel',
    open: advancedJsonRpcInstance
  },
  {
    entry: '@migaia/rpc-process',
    symbol: 'createProcessTransport',
    open: () => byteInstance(createProcessTransport)
  },
  {
    entry: '@migaia/rpc-process',
    symbol: 'openProcessObjectChannel',
    open: advancedJsonRpcInstance
  },
  {
    entry: '@migaia/rpc-threads',
    symbol: 'createNodeThreadChannel',
    open: () =>
      channelInstance(
        createNodeThreadChannel(nodePort(), 'inventory-peer', { scheduler: systemScheduler })
      )
  },
  {
    entry: '@migaia/rpc-threads',
    symbol: 'createWebThreadChannel',
    open: () =>
      channelInstance(
        createWebThreadChannel(webPort(), 'inventory-peer', { scheduler: systemScheduler })
      )
  },
  {
    entry: '@migaia/rpc-browser/adapters/window',
    symbol: 'createWindowMessageTransport',
    open() {
      /**
       * The same target supplies explicit source identity and receiver registration for this
       * factory.
       */
      const port = webPort()
      return transportInstance(
        createWindowMessageTransport({
          target: port,
          receiver: port,
          targetOrigin: 'https://inventory.test'
        })
      )
    }
  },
  {
    entry: '@migaia/rpc-browser/adapters/shared-worker',
    symbol: 'createSharedWorkerTransport',
    open: () => transportInstance(createSharedWorkerTransport(webPort()))
  },
  {
    entry: '@migaia/rpc-browser/adapters/service-worker',
    symbol: 'createServiceWorkerTransport',
    open() {
      /** Explicit target and receiver construct the supported Service Worker public boundary. */
      const port = webPort()
      return transportInstance(createServiceWorkerTransport({ target: port, receiver: port }))
    }
  },
  {
    entry: '@migaia/rpc-browser/adapters/broadcast-channel',
    symbol: 'createBroadcastChannelTransport',
    open: () =>
      transportInstance(createBroadcastChannelTransport(webPort() as unknown as BroadcastChannel))
  },
  {
    entry: '@migaia/rpc-browser/adapters/rtc-data-channel',
    symbol: 'createRtcDataChannelTransport',
    open: () => transportInstance(createRtcDataChannelTransport(webPort()))
  },
  {
    entry: '@migaia/rpc-browser/adapters/web-transport',
    symbol: 'createWebTransportDatagramTransport',
    open: () =>
      transportInstance(
        createWebTransportDatagramTransport({
          readable: new ReadableStream<Uint8Array>(),
          writable: new WritableStream<Uint8Array>()
        })
      )
  },
  {
    entry: '@migaia/rpc-process',
    symbol: 'createProcessJsonRpcChannel',
    async open() {
      /** The existing foreign peer exercises the canonical Process presentation boundary. */
      const fixture = bridgeFixture()
      return channelInstance(await createProcessJsonRpcChannel(fixture.options))
    }
  }
]

/**
 * Type-level inventory predicate, checked by `bun check` against the public declarations. A
 * transport declares `send`, `subscribe` and `platform` (an index signature declares no property);
 * a factory returns (possibly awaited) a transport, a tuple holding one, or a channel whose
 * `transport` field is one. Up to four overloads are read; any overload returning a transport
 * counts. `any` is neither callable nor a transport, matching the compiler's own signature and
 * property lookup on `any`; a return type too deep to instantiate also degrades to `any` and is not
 * counted.
 */
const inventoryPredicate = `
type IIsAny<T> = 0 extends 1 & T ? true : false
type IDeclaredKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: 0
}
type IIsTransport<T> = IIsAny<T> extends true
  ? false
  : T extends unknown
  ? 'send' | 'subscribe' | 'platform' extends IDeclaredKeys<T> ? true : false
  : never
type IHoldsTransport<T> = IIsAny<T> extends true
  ? false
  : T extends unknown
  ? true extends IIsTransport<T>
    ? true
    : T extends readonly unknown[]
      ? true extends IIsTransport<T[number]> ? true : false
      : 'transport' extends IDeclaredKeys<T>
        ? true extends IIsTransport<T[keyof T & 'transport']> ? true : false
        : false
  : never
type IReturns<T> = T extends {
  (...args: infer _A1): infer R1
  (...args: infer _A2): infer R2
  (...args: infer _A3): infer R3
  (...args: infer _A4): infer R4
}
  ? R1 | R2 | R3 | R4
  : T extends (...args: infer _A) => infer R
    ? R
    : never
type IFactoryMark<THolds, TName> = IIsAny<THolds> extends true
  ? never
  : true extends THolds
    ? TName
    : never
type IProbe<T> = IIsAny<T> extends true ? never : IFactoryMark<IHoldsTransport<Awaited<IReturns<T>>>, 'factory'>
`

/** Discover callable constructors from all current public declaration entries to detect omissions. */
function exportedTransportFactories(): readonly string[] {
  /** Package metadata is the public-entry source of truth, including aliases and advanced entries. */
  const entries: Array<{ path: string; entry: string }> = []
  for (const owner of packages) {
    /** This fixed metadata shape belongs to these five real workspace package manifests. */
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'packages', owner, 'package.json'), 'utf8')
    ) as { name: string; exports: Record<string, { types: string }> }
    for (const [subpath, target] of Object.entries(manifest.exports))
      entries.push({
        path: resolve(root, 'packages', owner, target.types),
        entry: manifest.name + (subpath === '.' ? '' : subpath.slice(1))
      })
  }
  /** Scratch project holding only the generated probes; removed after the check. */
  const directory = mkdtempSync(join(tmpdir(), 'migaia-carrier-inventory-'))
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        noErrorTruncation: true,
        types: []
      },
      files: ['probe.ts']
    })
  )
  /**
   * Checks one generated probe; each `never` assignment that fails prints its value type. Returns
   * the failing diagnostics as `[line, message]`.
   */
  const check = (lines: readonly string[]): Array<[number, string]> => {
    writeFileSync(join(directory, 'probe.ts'), [inventoryPredicate, ...lines].join('\n'))
    /** Offset of the first generated line in the probe file. */
    const offset = inventoryPredicate.split('\n').length
    let output = ''
    try {
      output = execFileSync('bun', ['check', '-p', directory, '--no-pretty'], { encoding: 'utf8' })
    } catch (error) {
      output = String((error as { stdout?: unknown }).stdout ?? '')
    }
    return output.split('\n').flatMap((line) => {
      const match = /probe\.ts\((\d+),\d+\): error (TS\d+): (.*)$/u.exec(line)
      if (!match) return []
      /**
       * Only the `never` assignments may fail. A return type too deep to instantiate (TS2589)
       * degrades to `any`, which is not a transport; any other diagnostic is an inventory failure.
       */
      expect(['TS2322', 'TS2589'], line).toContain(match[2])
      return match[2] === 'TS2322'
        ? [[Number(match[1]) - offset - 1, match[3]!] as [number, string]]
        : []
    })
  }
  /** Import expression of one public declaration entry. */
  const moduleOf = (path: string): string =>
    `typeof import(${JSON.stringify(path.replace(/\.d\.ts$/u, '.js'))})`
  try {
    /** First pass: every entry's export names, printed as a string-literal union. */
    const names = new Map<number, string[]>()
    for (const [line, message] of check(
      entries.map(
        ({ path }, index) =>
          `export const names${index}: never = null as unknown as keyof ${moduleOf(path)} & string`
      )
    ))
      names.set(
        line,
        [...message.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!)
      )
    /** Second pass: one probe per callable export; a failing line marks a transport factory. */
    const probes = entries.flatMap(({ path, entry }, index) =>
      (names.get(index) ?? []).map((name) => ({ path, entry, name }))
    )
    /** Duplicated declarations do not duplicate a public entry/symbol identity. */
    const factories = new Set<string>()
    for (const [line, message] of check(
      probes.map(
        ({ path, name }, index) =>
          `export const probe${index}: never = null as unknown as IProbe<${moduleOf(path)}[${JSON.stringify(name)}]>`
      )
    ))
      if (message.includes('"factory"'))
        factories.add(`${probes[line]!.entry}#${probes[line]!.name}`)
    return [...factories].sort()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('carriers: complete public transport inventory', () => {
  it('lists every public transport, pair, and channel constructor with no exclusions', () => {
    expect(inventory.map((entry) => `${entry.entry}#${entry.symbol}`).sort()).toEqual(
      exportedTransportFactories()
    )
  })

  for (const entry of inventory) {
    it(`${entry.entry}#${entry.symbol} returns transports with direct observe`, async () => {
      /** Construct the factory's real returned object; capability stubs cannot satisfy this oracle. */
      const instance = await entry.open()
      try {
        expect(instance.transports.length).toBeGreaterThan(0)
        for (const transport of instance.transports) {
          expect(transport.observe).toBeTypeOf('function')
          /** Outbound observation must run inside send, before its original settlement is awaited. */
          let outbound = 0
          /** Direction filtering excludes physical responses from this constructor's send proof. */
          const probe: IRpcCarrierProbe = {
            capturing: false,
            emit(direction) {
              if (direction === RpcProbeDirection.outbound) outbound++
            }
          }
          /** Observe is exercised directly, and its real disposer must be callable and idempotent. */
          const dispose = transport.observe!(probe)
          expect(dispose).toBeTypeOf('function')
          /** The bridge receives its supported envelope; all other text/message ports accept it too. */
          const payload =
            transport.encodedType === RpcTransportEncoding.uint8Array
              ? new Uint8Array([1])
              : JSON.stringify(request('inventory-request'))
          const sending = transport.send(payload)
          expect(outbound, `${entry.symbol} synchronous send observation`).toBe(1)
          await sending
          dispose()
          dispose()
        }
      } finally {
        await instance.close()
      }
    })
  }
})
