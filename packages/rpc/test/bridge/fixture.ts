import { createManualScheduler } from '@migaia/utils/scheduler'
import { acceptRpcHandshake } from '../../src/contract/handshake.js'
import { normalizeRpcEnvelope } from '../../src/contract/v1/normalize.js'
import {
  createJsonRpcRemoteChannel,
  type IJsonRpcBridgeOptions
} from '../../src/bridge/jsonrpc/index.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IProcessByteChannel } from '../../src/process/types.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createOneWayFeature } from '../../src/core/features/one-way.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IOneWaySurface } from '../../src/core/features/one-way.js'
import type { IRemoteChannel } from '../../src/remote/types.js'

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

/** A raw peer controls drain and every incoming object without replacing the bridge transport. */
export function bridgeFixture(
  input: Readonly<{
    autoHello?: boolean
    responder?: (message: Record<string, unknown>) => unknown
    drain?: Promise<void>
  }> = {}
) {
  const scheduler = createManualScheduler()
  const writes: Uint8Array[] = []
  const messages: Record<string, unknown>[] = []
  const reports: unknown[] = []
  let data: ((chunk: Uint8Array) => void) | undefined
  let eof: ((reason?: unknown) => void) | undefined
  let closes = 0
  let removals = 0
  const deliver = (value: unknown): void => data?.(peerFrame(value))
  const raw: IProcessByteChannel = {
    kind: 'byte',
    async write(chunk) {
      writes.push(chunk)
      const text = Buffer.from(chunk).toString('utf8')
      const boundary = text.indexOf('\r\n\r\n')
      if (boundary < 0) throw new Error('fixture received a non-Content-Length frame')
      const physical = JSON.parse(text.slice(boundary + 4)) as
        | Record<string, unknown>
        | Record<string, unknown>[]
      messages.push(physical as Record<string, unknown>)
      const members = Array.isArray(physical) ? physical : [physical]
      const replies: unknown[] = []
      if (input.drain) await input.drain
      for (const message of members) {
        if (input.responder) {
          const answer = input.responder(message)
          if (answer !== undefined) replies.push(answer)
        } else if (message.method === 'migaia.hello' && input.autoHello !== false) {
          const hello = (message.params as { hello: string }).hello
          const result = acceptRpcHandshake(BRIDGE_PEER_OFFER, hello)
          replies.push({
            jsonrpc: '2.0',
            id: message.id,
            result: { reply: result.reply, methods: BRIDGE_METHODS }
          })
        }
      }
      if (replies.length > 0) deliver(Array.isArray(physical) ? replies : replies[0])
    },
    onData(listener) {
      data = listener
      return () => {
        data = undefined
        removals++
      }
    },
    onClose(listener) {
      eof = listener
      return () => {
        eof = undefined
        removals++
      }
    },
    close() {
      closes++
    }
  }
  const options: IJsonRpcBridgeOptions = {
    byte: raw,
    peerId: 'peer',
    target: { kind: 'plugin', contract: BRIDGE_CONTRACT },
    offer: {
      versions: [{ major: 1, minor: 1 }],
      capabilities: ['deadline@1', 'trace@1'],
      peer: { id: 'client', runtime: 'node' }
    },
    token: 'Q7X9Z3V5K8W2R6T4Y1N0',
    scheduler,
    wallClock: { timestamp: () => 123 },
    ipc: { connectionId: 'connection', sessionId: 'session', log: () => undefined },
    report: (error) => reports.push(error)
  }
  return {
    raw,
    options,
    scheduler,
    writes,
    messages,
    reports,
    deliver,
    bytes: (chunk: Uint8Array) => data?.(chunk),
    eof: (reason?: unknown) => eof?.(reason),
    open: (override: Partial<IJsonRpcBridgeOptions> = {}) =>
      createJsonRpcRemoteChannel({ ...options, ...override }),
    get closes() {
      return closes
    },
    get removals() {
      return removals
    }
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
