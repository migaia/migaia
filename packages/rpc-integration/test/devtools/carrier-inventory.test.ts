import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
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
  createAdapterChannel,
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
import { createJsonRpcAdapterChannel, createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
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
/** The five carrier owners have no explicit exclusions in carriers R2. */
const packages = [
  'rpc-core',
  'rpc-process',
  'rpc-threads',
  'rpc-browser',
  'rpc-bridge-jsonrpc'
] as const
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
    symbol: 'createAdapterChannel',
    open: () => byteInstance(createAdapterChannel)
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
    entry: '@migaia/rpc-bridge-jsonrpc',
    symbol: 'createJsonRpcAdapterChannel',
    async open() {
      /** Existing integration fixture drives this exact exported constructor, not its alias. */
      const fixture = bridgeFixture()
      return channelInstance(await createJsonRpcAdapterChannel(fixture.options))
    }
  },
  {
    entry: '@migaia/rpc-bridge-jsonrpc',
    symbol: 'createJsonRpcRemoteChannel',
    async open() {
      /** The same real fixture verifies the separate public convenience factory. */
      const fixture = bridgeFixture()
      return channelInstance(await createJsonRpcRemoteChannel(fixture.options))
    }
  }
]

/** Transport shape at this inventory boundary is the public physical send/subscribe/platform port. */
function isTransport(type: ts.Type): boolean {
  return (
    type.getProperty('send') !== undefined &&
    type.getProperty('subscribe') !== undefined &&
    type.getProperty('platform') !== undefined
  )
}

/** Unwrap only the public transport, pair, or channel result; no nested factory framework is built. */
function returnsTransport(checker: ts.TypeChecker, type: ts.Type): boolean {
  /** Async constructors produce the same transport capability after their real construction. */
  const result = checker.getAwaitedType(type) ?? type
  if (result.isUnion()) return result.types.some((member) => returnsTransport(checker, member))
  if (isTransport(result)) return true
  if (
    checker.isTupleType(result) &&
    checker.getTypeArguments(result as ts.TypeReference).some(isTransport)
  )
    return true
  /** Channel constructors expose their actual transport under the public transport field. */
  const transport = result.getProperty('transport')
  if (!transport) return false
  /** The declaration preserves alias and wrapper types rather than comparing printed type names. */
  const declaration = transport.valueDeclaration ?? transport.declarations?.[0]
  return (
    declaration !== undefined &&
    isTransport(checker.getTypeOfSymbolAtLocation(transport, declaration))
  )
}

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
  /** One declaration program resolves public return aliases without executing any factory. */
  const program = ts.createProgram(
    entries.map((entry) => entry.path),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true
    }
  )
  /** One checker follows reexports to their actual callable return signatures. */
  const checker = program.getTypeChecker()
  /** Duplicated declarations do not duplicate a public entry/symbol identity. */
  const factories = new Set<string>()
  for (const entry of entries) {
    /** Missing declaration entries are an inventory failure, never an exclusion. */
    const source = program.getSourceFile(entry.path)
    expect(source, entry.entry).toBeDefined()
    /** Every listed entry must remain a readable external module. */
    const module = checker.getSymbolAtLocation(source!)
    expect(module, entry.entry).toBeDefined()
    for (const exported of checker.getExportsOfModule(module!)) {
      /** Callable exported aliases retain their independent public entry identity. */
      const type = checker.getTypeOfSymbolAtLocation(exported, source!)
      if (
        type
          .getCallSignatures()
          .some((signature) =>
            returnsTransport(checker, checker.getReturnTypeOfSignature(signature))
          )
      )
        factories.add(`${entry.entry}#${exported.name}`)
    }
  }
  return [...factories].sort()
}

describe('carriers A2: complete public transport inventory', () => {
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
