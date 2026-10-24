import { createManualScheduler } from '@migaia/utils/testing'
import { acceptRpcHandshake } from '@migaia/rpc-contract'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createProcessJsonRpcChannel } from '../../../rpc-plugin-process/dist/process/jsonrpc-channel.js'
import type { IProcessJsonRpcChannelOptions } from '../../../rpc-plugin-process/dist/process/jsonrpc-channel.js'
import type { IRemoteContract } from '@migaia/rpc-host/plugin'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import { createComposedEndpoint } from '../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../../rpc-host/dist/core/stream/index.js'
import { createOutboundFeature } from '../../../rpc-host/dist/core/features/outbound.js'
import { createOneWayFeature } from '../../../rpc-host/dist/core/features/one-way.js'
import { codec } from '../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../rpc-host/dist/core/middleware/framer.js'
import { abort } from '../../../rpc-host/dist/core/middleware/abort.js'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import type { IOneWaySurface } from '../../../rpc-host/dist/core/features/one-way.js'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'

/** Declared request and notification methods keep the fixture strictly inside the bridge profile. */
export const BRIDGE_CONTRACT: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: true },
        plain: { mode: 'request', idempotent: false },
        oneWay: { mode: 'one-way', idempotent: false }
      }
    }
  }
}
/** Hand-written peer offer is independent of the native offer's ping/close/stream policy. */
export const BRIDGE_PEER_OFFER = {
  versions: [{ major: 1, minor: 1 }],
  codecs: ['json'],
  capabilities: [
    'runtime-api@1',
    'batch@1',
    'jsonrpc-bridge@1',
    'abort@1',
    'wire-error@1',
    'deadline@1',
    'trace@1',
    'idempotency@1'
  ],
  peer: { id: 'foreign-diagnostic-id', runtime: 'python' }
}
/** Required methods are fixture payload, allowing tests to mutate peer advertisements. */
export const BRIDGE_METHODS = ['migaia.hello', 'migaia.describe', 'migaia.invoke', 'migaia.cancel']

/** Independent byte encoder checks product framing without sharing its implementation. */
export function peerFrame(value: unknown): Uint8Array {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** Original independent peer behavior is configured once for this controlled byte source. */
type IBridgeFixtureInput = Readonly<{
  autoHello?: boolean
  responder?: (message: Record<string, unknown>) => unknown
  drain?: Promise<void>
}>

/** One raw peer owns its subscriptions, physical write observations and channel close counts. */
export class BridgeFixture {
  /** The current byte reader receives independently encoded fixture replies. */
  #data: ((chunk: Uint8Array) => void) | undefined
  /** The current terminal reader belongs only to this controlled byte connection. */
  #onEof: ((reason?: unknown) => void) | undefined
  /** Physical close observations prove the bridge never silently substitutes a source. */
  #closes = 0
  /** Subscription teardown observations remain independent from physical close. */
  #removals = 0
  /** Caller-provided response/drain behavior keeps the same original object reference. */
  #input: IBridgeFixtureInput
  /** The canonical scheduler owns deadlines; this fixture only exposes it for assertions. */
  readonly scheduler = createManualScheduler()
  /** Physical chunks remain available byte-for-byte for framing assertions. */
  readonly writes: Uint8Array[] = []
  /** Parsed physical objects preserve batch versus single-member distinctions. */
  readonly messages: Record<string, unknown>[] = []
  /** Original product reports keep exact error identity here. */
  readonly reports: unknown[] = []
  /** The raw source is stable for the fixture's whole lifetime. */
  readonly raw: IProcessByteChannel = {
    kind: 'byte',
    /** Decode the original independent frame and deliver its complete response cohort. */
    write: async (chunk) => {
      this.writes.push(chunk)
      const text = Buffer.from(chunk).toString('utf8')
      const boundary = text.indexOf('\r\n\r\n')
      if (boundary < 0) throw new Error('fixture received a non-Content-Length frame')
      const physical = JSON.parse(text.slice(boundary + 4)) as
        | Record<string, unknown>
        | Record<string, unknown>[]
      this.messages.push(physical as Record<string, unknown>)
      const members = Array.isArray(physical) ? physical : [physical]
      const replies: unknown[] = []
      if (this.#input.drain) await this.#input.drain
      for (const message of members) {
        if (this.#input.responder) {
          const answer = this.#input.responder(message)
          if (answer !== undefined) replies.push(answer)
        } else if (message.method === 'migaia.hello' && this.#input.autoHello !== false) {
          const hello = (message.params as { hello: string }).hello
          const result = acceptRpcHandshake(BRIDGE_PEER_OFFER, hello)
          replies.push({
            jsonrpc: '2.0',
            id: message.id,
            result: { reply: result.reply, methods: BRIDGE_METHODS }
          })
        }
      }
      if (replies.length > 0) this.deliver(Array.isArray(physical) ? replies : replies[0])
    },
    onData: (listener) => {
      this.#data = listener
      return () => {
        this.#data = undefined
        this.#removals += 1
      }
    },
    onClose: (listener) => {
      this.#onEof = listener
      return () => {
        this.#onEof = undefined
        this.#removals += 1
      }
    },
    close: () => {
      this.#closes += 1
    }
  }
  /** Original channel options remain directly mutable by the hostile-input tests. */
  readonly options: IProcessJsonRpcChannelOptions

  /** Configure the same actual JSON-RPC channel defaults over this fixture's raw byte identity. */
  constructor(input: IBridgeFixtureInput = {}) {
    this.#input = input
    this.options = {
      byte: this.raw,
      peerId: 'peer',
      target: { kind: 'plugin', contract: BRIDGE_CONTRACT },
      offer: {
        versions: [{ major: 1, minor: 1 }],
        capabilities: ['deadline@1', 'trace@1'],
        peer: { id: 'client', runtime: 'node' }
      },
      token: 'Q7X9Z3V5K8W2R6T4Y1N0',
      scheduler: this.scheduler,
      wallClock: { timestamp: () => 123 },
      ipc: { connectionId: 'connection', sessionId: 'session', log: () => undefined },
      report: (error) => this.reports.push(error)
    }
  }

  /** Encode an independent physical reply before entering the product's original byte reader. */
  deliver = (value: unknown): void => {
    this.#data?.(peerFrame(value))
  }

  /** Inject raw hostile or segmented bytes without normalizing them through the product. */
  bytes = (chunk: Uint8Array): void => {
    this.#data?.(chunk)
  }

  /** Publish the actual fixture terminal event to its original subscriber. */
  eof = (reason?: unknown): void => {
    this.#onEof?.(reason)
  }

  /** Construct the original channel with only the caller's explicit option overrides. */
  open = (override: Partial<IProcessJsonRpcChannelOptions> = {}) =>
    createProcessJsonRpcChannel({ ...this.options, ...override })

  /** Return original physical close count. */
  get closes(): number {
    return this.#closes
  }

  /** Return original subscription teardown count. */
  get removals(): number {
    return this.#removals
  }
}

/** Build a contract-owned request snapshot without invoking any endpoint convenience wrapper. */
export function request(
  id: string,
  method = 'p.f.request',
  route: Record<string, unknown> = {},
  payload: unknown = []
) {
  return normalizeRpcEnvelope({
    kind: 'request',
    id,
    method,
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'request',
        applicationVersion: 'app',
        senderId: 'client',
        targetId: 'peer',
        sentAt: 0,
        ...route
      },
      payload
    }
  })
}

/** Compose the same canonical owners as a production remote endpoint factory. */
export async function bridgeEndpoint(channel: IRemoteChannel) {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const endpoint = await createComposedEndpoint(
    {
      id: 'client',
      transport: channel.transport,
      scheduler: channel.scheduler,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport })
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-one-way': createOneWayFeature(outbound),
      'channel-ipc-queue': channel.features[0]!,
      'channel-ipc-log': channel.features[1]!
    }
  )
  return endpoint as unknown as IRpcEndpoint & IOneWaySurface
}

/** Drain Promise jobs until all synchronous fixture writes and receive callbacks finish. */
export async function flush(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}
