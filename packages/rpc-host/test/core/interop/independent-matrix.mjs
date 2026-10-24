import { orderStringKeys } from '@migaia/utils/string'
import { readFileSync } from 'node:fs'
import { decode as decodeCbor, encode as encodeCbor } from 'cborg'
import { Elysia } from 'elysia'
import { pack, unpack } from 'msgpackr'
import * as protobuf from 'protobufjs'
import { RpcEnvelopeSchema } from '../../../../serialize/test/fixtures/rpc-envelope-schema.js'

/** Produces the normative sorted-key JSON bytes without using the production codec. */
const canonicalizeJson = (value) =>
  Array.isArray(value)
    ? value.map(canonicalizeJson)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          orderStringKeys(Object.keys(value)).map((key) => [key, canonicalizeJson(value[key])])
        )
      : value
const canonicalJson = (value) => JSON.stringify(canonicalizeJson(value))

const codecs = [
  {
    id: 'json',
    encode: (value) => new TextEncoder().encode(canonicalJson(value)),
    decode: (bytes) => JSON.parse(new TextDecoder().decode(bytes))
  },
  {
    id: 'message-pack',
    encode: (value) => Uint8Array.from(pack(value)),
    decode: (bytes) => unpack(bytes)
  },
  {
    id: 'cbor',
    encode: (value) => Uint8Array.from(encodeCbor(value, { float64: true })),
    decode: (bytes) => decodeCbor(bytes)
  },
  {
    id: 'protobuf',
    encode: (value) =>
      Uint8Array.from(
        protobufType
          .encode(
            protobufType.create({
              kind: value.kind,
              id: value.id,
              payload: Buffer.from(
                JSON.stringify(
                  Object.fromEntries(
                    Object.entries(value).filter(([key]) => key !== 'kind' && key !== 'id')
                  )
                )
              )
            })
          )
          .finish()
      ),
    decode: (bytes) => {
      const value = protobufType.toObject(protobufType.decode(bytes), { arrays: true })
      return {
        kind: value.kind,
        id: value.id,
        ...JSON.parse(new TextDecoder().decode(value.payload ?? new Uint8Array()))
      }
    }
  }
]

const carriers = ['websocket', 'post', 'post-sse']
const vector = Object.freeze({
  kind: 'request',
  id: 'interop-vector',
  method: 'echo',
  data: Object.freeze({ payload: Object.freeze([0, 1, 255]) })
})
const peerVector = Object.freeze({
  kind: 'request',
  id: 'peer-vector',
  method: 'peer-initiated',
  data: Object.freeze({
    route: Object.freeze({
      profile: 'migaia.rpc.route',
      type: 'request',
      applicationVersion: '1.0.0',
      senderId: 'peer',
      targetId: 'production',
      receiverId: 'production',
      sentAt: 0
    }),
    payload: Object.freeze([3, 5, 8])
  })
})
const schema = readFileSync(
  new URL('../../../../rpc-contract/schema/rpc-v1.proto', import.meta.url),
  'utf8'
)
const protobufType = protobuf.parse(schema).root.lookupType('migaia.rpc.v1.RpcEnvelope')

const withTimeout = async (promise, label) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5_000)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

let productionModules

/** Loads production endpoint and codec factories only in the parent process. */
const loadProductionModules = async () => {
  if (!productionModules) {
    productionModules = {
      endpoint: await import('../../../dist/core/runtime-api-endpoint.js'),
      codecMiddleware: await import('../../../dist/core/middleware/codec.js'),
      connectMiddleware: await import('../../../dist/core/middleware/connect.js'),
      framerMiddleware: await import('../../../dist/core/middleware/framer.js'),
      framing: await import('@migaia/rpc-contract/framing'),
      protocol: await import('@migaia/rpc-contract'),
      json: await import('../../../../serialize/dist/codecs/json.js'),
      messagePack: await import('../../../../serialize/dist/codecs/message-pack.js'),
      cbor: await import('../../../../serialize/dist/codecs/cbor.js'),
      protobuf: await import('../../../../serialize/dist/codecs/protobuf.js'),
      rpcProtobufPayload:
        await import('../../../../rpc-contract/test/core/interop/rpc-protobuf-payload.mjs')
    }
  }
  return productionModules
}

/** Selects the production codec while leaving the peer codec implementation independent. */
const createProductionCodec = async (id) => {
  const modules = await loadProductionModules()
  if (id === 'json') return modules.json.defineJsonCodec({ version: 1 })
  if (id === 'message-pack') return modules.messagePack.defineMessagePackCodec({ version: 1 })
  if (id === 'cbor') return modules.cbor.defineCBORCodec({ version: 1 })
  const codec = modules.protobuf.defineProtobufCodec({
    version: 1,
    schema: { id: 'migaia.rpc.v1', version: 1 },
    binding: RpcEnvelopeSchema
  })
  const json = modules.json.defineJsonCodec({ version: 1 })
  return modules.rpcProtobufPayload.createRpcProtobufPayloadCodec({
    protobufCodec: codec,
    jsonCodec: json,
    normalize: modules.protocol.rpcProtocolV1.normalize
  })
}

const createPeerApp = (codec, carrier) => {
  const app = new Elysia()
  const sseControllers = new Set()
  const exchange = async (input) => {
    const incoming =
      codec.id === 'json' && typeof input === 'object' && input !== null
        ? input
        : codec.decode(input)
    if (incoming.kind === 'request' && incoming.data?.route?.type === 'request') {
      const route = incoming.data.route
      return codec.encode({
        kind: 'response',
        ok: true,
        id: incoming.id,
        data: {
          route: {
            profile: 'migaia.rpc.route',
            type: 'response',
            applicationVersion: route.applicationVersion,
            senderId: route.targetId,
            targetId: route.senderId,
            receiverId: route.senderId,
            sentAt: Date.now(),
            method: incoming.method
          },
          payload: incoming.data.payload
        }
      })
    }
    if (incoming.kind === 'discovery' && incoming.data?.route?.type === 'discovery-query') {
      const route = incoming.data.route
      return codec.encode({
        kind: 'discovery',
        id: incoming.id,
        version: incoming.version,
        acceptVersions: incoming.acceptVersions,
        data: {
          route: {
            profile: 'migaia.rpc.route',
            type: 'discovery-response',
            applicationVersion: route.applicationVersion,
            senderId: 'peer',
            targetId: route.senderId,
            resolvedTargetId: 'peer',
            receiverId: 'peer',
            accepted: true,
            sentAt: Date.now()
          }
        }
      })
    }
    if (incoming.kind === 'response' && incoming.id === peerVector.id)
      return codec.encode({
        kind: 'response',
        ok: true,
        id: 'peer-ack',
        data: {
          route: {
            profile: 'migaia.rpc.route',
            type: 'response',
            applicationVersion: incoming.data.route.applicationVersion,
            senderId: 'peer',
            targetId: incoming.data.route.senderId,
            receiverId: incoming.data.route.senderId,
            sentAt: Date.now(),
            method: incoming.data.route.method
          },
          payload: { ack: incoming.id }
        }
      })
    return codec.encode(incoming)
  }
  if (carrier === 'websocket') {
    app.ws('/rpc', {
      open: (socket) => {
        const request = codec.encode(peerVector)
        socket.send(codec.id === 'json' ? new TextDecoder().decode(request) : Buffer.from(request))
      },
      message: async (socket, message) => {
        const incoming =
          codec.id === 'json' && typeof message === 'object' && message !== null
            ? message
            : await toBytes(message)
        const response = await exchange(incoming)
        socket.send(
          codec.id === 'json' ? new TextDecoder().decode(response) : Buffer.from(response)
        )
      }
    })
  } else {
    app.get('/events', () => {
      let streamController
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller
          sseControllers.add(controller)
          controller.enqueue(new TextEncoder().encode(': ready\n\n'))
        },
        cancel() {
          if (streamController) sseControllers.delete(streamController)
        }
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    })
    app.all('/rpc', async ({ request, body }) => {
      if (codec.id === 'json' && body && typeof body === 'object') {
        const response = await exchange(body)
        const text = new TextDecoder().decode(response)
        if (carrier === 'post-sse') {
          const event = new TextEncoder().encode(`data:${text}\n\n`)
          for (const controller of Array.from(sseControllers)) controller.enqueue(event)
          return new Response(null, { status: 202 })
        }
        return new Response(text, {
          headers: { 'content-type': 'application/json' }
        })
      }
      const input =
        body === undefined ? new Uint8Array(await request.arrayBuffer()) : await toBytes(body)
      const response = await exchange(input)
      if (carrier === 'post-sse') {
        const encoded = Buffer.from(response).toString('base64url')
        const event = new TextEncoder().encode(`data:${encoded}\n\n`)
        for (const controller of Array.from(sseControllers)) controller.enqueue(event)
        return new Response(null, { status: 202 })
      }
      return new Response(Buffer.from(response), {
        headers: { 'content-type': 'application/octet-stream' }
      })
    })
  }
  app.get('/health', () => 'ok')
  return app
}

/** Starts a fresh independent peer process and waits for its health endpoint. */
const startFixture = async (codec, carrier) => {
  const port = 41_000 + Math.floor(Math.random() * 18_000)
  const child = Bun.spawn(
    [process.execPath, import.meta.path, '--peer', codec.id, carrier, `${port}`],
    {
      stdout: 'ignore',
      stderr: 'pipe'
    }
  )
  const ready = (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://localhost:${port}/health`)
        if (response.ok) return
      } catch {
        // The child may need a bounded amount of time to bind its isolated port.
      }
      await Bun.sleep(25)
    }
    throw new Error('peer readiness timed out')
  })()
  let started = false
  try {
    await withTimeout(ready, `${codec.id}/${carrier} peer readiness`)
    started = true
    return {
      port,
      stop: async () => {
        child.kill()
        await withTimeout(child.exited, `${codec.id}/${carrier} peer teardown`)
      }
    }
  } finally {
    if (!started) child.kill()
  }
}

const toBytes = async (value) => {
  const data = typeof value === 'object' && value !== null && 'data' in value ? value.data : value
  if (typeof data === 'string') return Uint8Array.from(Buffer.from(data, 'binary'))
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return Uint8Array.from(data)
}

/** Own the real socket/SSE subscriptions used by one independent peer comparison cell. */
class IndependentProductionTransport {
  /** The caller owns this already-started independent application and its address. */
  #app
  /** Only the independently selected codec identity decides text versus binary carrier handling. */
  #codec
  /** The case selects one of the original physical carriers before any I/O. */
  #carrier
  /** Canonical endpoint callbacks receive complete physical carrier values. */
  #listeners = new Set()
  /** Observers record exact inbound bytes before endpoint listeners receive them. */
  #inboundObservers = new Set()
  /** One native socket belongs to this cell until explicit transport close. */
  #socket
  /** Repeated sends join the original socket-opening Promise. */
  #socketReady
  /** The same native cancellation owner controls the held SSE response. */
  #sseAbort
  /** Repeated POSTs join the original event-stream opening Promise. */
  #sseReady
  /** This reader alone owns event-stream input and cancellation. */
  #sseReader
  /** An asynchronous SSE read failure stays visible to the original boundary assertion. */
  #sseFailure
  /** The most recent real event preserves both its exact text and decoded carrier bytes. */
  #sseCapture
  /** Exact received carriers remain available to the independent comparison oracle. */
  #inboundCarriers = []
  /** Exact socket writes remain available to the original sent-carrier oracle. */
  #sentCarriers = []
  /** Own enumerable transport methods preserve the original projection and detached-call behavior. */
  value

  /**
   * Hold one selected independent peer without opening its physical carrier.
   *
   * @param {{ port: number }} app Already-started independent application.
   * @param {{ id: string }} codec Codec identity used by the original carrier comparison.
   * @param {string} carrier Selected socket, POST, or POST/SSE case.
   */
  constructor(app, codec, carrier) {
    this.#app = app
    this.#codec = codec
    this.#carrier = carrier
    this.value = {
      platform: 'MessagePort',
      topology: 'exclusive',
      ownership: 'owned',
      encodedType: 'any',
      send: (message) => this.#send(message),
      subscribe: (listener) => {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
      },
      close: () => this.#close(),
      readInboundCarriers: () => [...this.#inboundCarriers],
      readSentCarriers: () => [...this.#sentCarriers],
      observeInboundCarrier: (observer) => {
        this.#inboundObservers.add(observer)
        return () => this.#inboundObservers.delete(observer)
      },
      assertCarrierBoundary: (expected, peerExpected) =>
        this.#assertCarrierBoundary(expected, peerExpected)
    }
  }

  /** Record and publish each complete carrier in the original observer-before-listener order. */
  #emit(data) {
    this.#inboundCarriers.push(data)
    for (const observer of Array.from(this.#inboundObservers)) observer(data)
    for (const listener of Array.from(this.#listeners)) listener({ data })
  }

  /** Open one real socket and preserve the exact cached native readiness Promise. */
  #openSocket() {
    if (this.#socketReady) return this.#socketReady
    this.#socketReady = new Promise((resolve, reject) => {
      this.#socket = new WebSocket(`ws://localhost:${this.#app.port}/rpc`)
      this.#socket.binaryType = 'arraybuffer'
      this.#socket.onopen = resolve
      this.#socket.onerror = () => reject(new Error('websocket cell failed'))
      this.#socket.onmessage = async (event) => {
        this.#emit(
          this.#codec.id === 'json'
            ? new TextDecoder().decode(await toBytes(event.data))
            : await toBytes(event.data)
        )
      }
    })
    return this.#socketReady
  }

  /** Open one event stream and start its original independently reported reader loop. */
  #openSse() {
    if (this.#sseReady) return this.#sseReady
    this.#sseAbort = new AbortController()
    this.#sseReady = fetch(`http://localhost:${this.#app.port}/events`, {
      signal: this.#sseAbort.signal
    }).then((response) => {
      if (!response.ok || !response.body) throw new Error('SSE stream failed')
      this.#sseReader = response.body.getReader()
      void this.#readSse().catch((error) => {
        this.#sseFailure = error
      })
    })
    return this.#sseReady
  }

  /** Decode every incoming chunk exactly as before, then scan each decoded character once. */
  async #readSse() {
    /** This original read loop alone owns its incomplete event, including close/reopen races. */
    let characters = []
    /** Two adjacent LF characters delimit one event, including a split chunk boundary. */
    let newline = false
    while (true) {
      const { done, value } = await this.#sseReader.read()
      if (done) return
      // Preserve the original per-chunk decoder behavior, including malformed split UTF-8 input.
      for (const character of new TextDecoder().decode(value)) {
        if (character === '\n' && newline) {
          characters.pop()
          /** This exact event is materialized once rather than rescanning the whole pending prefix. */
          const event = characters.join('')
          characters = []
          newline = false
          this.#acceptSseEvent(event)
        } else {
          characters.push(character)
          newline = character === '\n'
        }
      }
    }
  }

  /** Preserve the original one-line data grammar and canonical binary carrier comparison. */
  #acceptSseEvent(event) {
    /** The existing closed event selector ignores all non-data records. */
    const line = event.match(/^data:(.*)$/u)?.[1]
    if (line === undefined) return
    /** The independent peer uses original JSON text or canonical base64url bytes. */
    const payload =
      this.#codec.id === 'json' ? line : Uint8Array.from(Buffer.from(line, 'base64url'))
    this.#sseCapture = { line, payload }
    this.#emit(payload)
  }

  /** Send the original HTTP request; event-stream cases receive their answer on the held reader. */
  async #sendPost(message) {
    if (this.#carrier === 'post-sse') await this.#openSse()
    /** This request and content type remain the original independent physical carrier. */
    const response = await fetch(`http://localhost:${this.#app.port}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': this.#codec.id === 'json' ? 'application/json' : 'application/octet-stream'
      },
      body: message
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (this.#carrier !== 'post-sse') {
      /** Materialize the real response body once before the original text/binary emission. */
      const body = new Uint8Array(await response.arrayBuffer())
      this.#emit(this.#codec.id === 'json' ? new TextDecoder().decode(body) : body)
    }
  }

  /** Send only through this case's selected physical carrier and preserve socket trace order. */
  async #send(message) {
    if (this.#carrier === 'websocket') {
      await this.#openSocket()
      this.#socket.send(typeof message === 'string' ? message : Buffer.from(message))
      this.#sentCarriers.push(message)
    } else await this.#sendPost(message)
  }

  /** Keep the original exact text, byte and canonical-base64url assertions. */
  #assertCarrierBoundary(expected, peerExpected) {
    if (this.#carrier !== 'post-sse') return
    if (this.#sseFailure) throw this.#sseFailure
    if (!this.#sseCapture) throw new Error('SSE response event missing')
    if (this.#codec.id === 'json') {
      /** Compare the real peer's original text with both actual carrier observations. */
      const peerExpectedText =
        typeof peerExpected === 'string' ? peerExpected : new TextDecoder().decode(peerExpected)
      if (this.#sseCapture.line !== expected || this.#sseCapture.line !== peerExpectedText)
        throw new Error(
          `JSON SSE text changed at carrier boundary: ${this.#sseCapture.line} !== ${expected}`
        )
      return
    }
    /** Expected physical bytes come from the same independent peer oracle. */
    const expectedBytes = Buffer.from(peerExpected)
    /** Decode the actual event once before canonical round-trip and byte equality checks. */
    const encoded = Buffer.from(this.#sseCapture.line, 'base64url')
    if (encoded.toString('base64url') !== this.#sseCapture.line)
      throw new Error('binary SSE payload was not canonical base64url')
    if (
      !encoded.equals(expectedBytes) ||
      !Buffer.from(this.#sseCapture.payload).equals(expectedBytes)
    )
      throw new Error('binary SSE bytes changed at carrier boundary')
  }

  /** Close original native resources in order and clear exactly the original transport fields. */
  async #close() {
    this.#socket?.close()
    this.#sseAbort?.abort()
    await this.#sseReader?.cancel()
    this.#socket = undefined
    this.#socketReady = undefined
    this.#sseAbort = undefined
    this.#sseReady = undefined
    this.#sseReader = undefined
    this.#listeners.clear()
  }
}

/** Runs one production-endpoint request against the independently implemented peer. */
const runProductionCell = async (app, codecId, carrier) => {
  const codec = await createProductionCodec(codecId)
  const transport = new IndependentProductionTransport(app, codec, carrier).value
  const modules = await loadProductionModules()
  const selectedFramer =
    codecId === 'json' ? modules.framing.createStringFramer() : modules.framing.createBinaryFramer()
  let peerProviderCalls = 0
  let resolvePeerProvider
  const peerProvider = new Promise((resolve) => {
    resolvePeerProvider = resolve
  })
  let stopObservingPeerAck = () => undefined
  const peerAck = new Promise((resolve) => {
    stopObservingPeerAck = transport.observeInboundCarrier((carrierValue) => {
      try {
        const candidate = codec.decode(carrierValue)
        if (
          candidate.kind === 'response' &&
          candidate.ok === true &&
          candidate.id === 'peer-ack' &&
          candidate.data?.route?.type === 'response' &&
          candidate.data.route.senderId === 'peer' &&
          candidate.data.route.targetId === 'production' &&
          candidate.data.payload?.ack === peerVector.id
        )
          resolve(candidate)
      } catch {
        // The physical stream can contain unrelated or incomplete frames before the peer ack.
      }
    })
  })
  const endpoint = await modules.endpoint.createRuntimeEndpointComposition(
    {
      id: 'production',
      transport,
      provider: {
        'peer-initiated': (context) => {
          peerProviderCalls += 1
          resolvePeerProvider()
          return context.success(context.data)
        }
      },
      middlewares: [
        modules.codecMiddleware.codec(codec),
        modules.framerMiddleware.framer(selectedFramer),
        modules.connectMiddleware.connect({ transport })
      ]
    },
    { agreement: { capabilities: [] }, peerId: '' }
  ).installing
  try {
    const response = await endpoint.send('peer', vector.method, vector.data)
    if (JSON.stringify(response) !== JSON.stringify(vector.data)) throw new Error('vector mismatch')
    if (carrier === 'websocket') {
      await withTimeout(peerProvider, `${codecId}/${carrier} peer initiated provider`)
      if (peerProviderCalls !== 1) throw new Error('peer provider request was not exactly once')
      await withTimeout(peerAck, `${codecId}/${carrier} peer acknowledgement`)
    }
    const responseEnvelope = transport
      .readInboundCarriers()
      .map((carrierValue) => codec.decode(carrierValue))
      .find(
        (candidate) =>
          candidate.kind === 'response' &&
          candidate.ok === true &&
          JSON.stringify(candidate.data?.payload) === JSON.stringify(vector.data)
      )
    if (!responseEnvelope) throw new Error('peer response carrier missing')
    if (
      responseEnvelope.kind !== 'response' ||
      responseEnvelope.ok !== true ||
      responseEnvelope.data?.route?.type !== 'response' ||
      responseEnvelope.data.route.senderId !== 'peer' ||
      responseEnvelope.data.route.targetId !== 'production' ||
      JSON.stringify(responseEnvelope.data.payload) !== JSON.stringify(vector.data)
    )
      throw new Error('peer response routing-data mismatch')
    const peerCodec = codecs.find(({ id }) => id === codecId)
    transport.assertCarrierBoundary(
      codec.encode(responseEnvelope),
      peerCodec.encode(responseEnvelope)
    )
  } finally {
    stopObservingPeerAck()
    await endpoint.dispose()
  }
}

const run = async () => {
  const results = []
  for (const codec of codecs) {
    for (const carrier of carriers) {
      const app = await startFixture(codec, carrier)
      try {
        await withTimeout(runProductionCell(app, codec.id, carrier), `${codec.id}/${carrier}`)
        results.push({ codec: codec.id, carrier, result: 'PASS' })
        console.log(`PASS ${codec.id}/${carrier}`)
      } finally {
        await app.stop()
      }
    }
  }
  if (results.length !== 12 || results.some(({ result }) => result !== 'PASS'))
    throw new Error('interop matrix is not 12/12')
  console.log('INTEROP 12/12 PASS')
}

/** Runs the independent peer branch without loading production endpoint or codec modules. */
const runPeer = async () => {
  const [codecId, carrier, portText] = process.argv.slice(3)
  const codec = codecs.find(({ id }) => id === codecId)
  if (!codec || !carriers.includes(carrier) || !portText) throw new Error('invalid peer arguments')
  const app = createPeerApp(codec, carrier)
  app.listen(Number(portText))
}

if (process.argv[2] === '--peer') await runPeer()
else await run()
