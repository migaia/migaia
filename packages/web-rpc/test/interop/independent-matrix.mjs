import { readFileSync } from 'node:fs'
import { decode as decodeCbor, encode as encodeCbor } from 'cborg'
import { Elysia } from 'elysia'
import { pack, unpack } from 'msgpackr'
import * as protobuf from 'protobufjs'
import { RpcEnvelopeSchema } from '../../../serialize/test/fixtures/rpc-envelope-schema.js'

/** Produces the normative sorted-key JSON bytes without using the production codec. */
const canonicalizeJson = (value) =>
  Array.isArray(value)
    ? value.map(canonicalizeJson)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonicalizeJson(value[key])])
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
    webRpc: Object.freeze({
      profile: 'web-rpc.route.v1',
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
  new URL('../../../rpc-contract/schema/rpc-v1.proto', import.meta.url),
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
      endpoint: await import('../../dist/index.js'),
      codecMiddleware: await import('../../dist/middleware/codec.js'),
      connectMiddleware: await import('../../dist/middleware/connect.js'),
      framerMiddleware: await import('../../dist/middleware/framer.js'),
      framing: await import('../../../rpc-contract/dist/framing/index.js'),
      protocol: await import('../../../rpc-contract/dist/index.js'),
      json: await import('../../../serialize/dist/codecs/json.js'),
      messagePack: await import('../../../serialize/dist/codecs/message-pack.js'),
      cbor: await import('../../../serialize/dist/codecs/cbor.js'),
      protobuf: await import('../../../serialize/dist/codecs/protobuf.js'),
      rpcProtobufPayload: await import('./rpc-protobuf-payload.mjs')
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
    if (incoming.kind === 'request' && incoming.data?.webRpc?.type === 'request') {
      const route = incoming.data.webRpc
      return codec.encode({
        kind: 'response',
        ok: true,
        id: incoming.id,
        data: {
          webRpc: {
            profile: 'web-rpc.route.v1',
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
    if (incoming.kind === 'discovery' && incoming.data?.webRpc?.type === 'discovery-query') {
      const route = incoming.data.webRpc
      return codec.encode({
        kind: 'discovery',
        id: incoming.id,
        version: incoming.version,
        acceptVersions: incoming.acceptVersions,
        data: {
          webRpc: {
            profile: 'web-rpc.route.v1',
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
          webRpc: {
            profile: 'web-rpc.route.v1',
            type: 'response',
            applicationVersion: incoming.data.webRpc.applicationVersion,
            senderId: 'peer',
            targetId: incoming.data.webRpc.senderId,
            receiverId: incoming.data.webRpc.senderId,
            sentAt: Date.now(),
            method: incoming.data.webRpc.method
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

/** Creates a transport that exposes one independent Elysia peer to the production endpoint. */
const createProductionTransport = (app, codec, carrier) => {
  const listeners = new Set()
  const inboundObservers = new Set()
  let socket
  let socketReady
  let sseAbort
  let sseReady
  let sseReader
  let sseFailure
  let sseCapture
  const inboundCarriers = []
  const sentCarriers = []
  const emit = (data) => {
    inboundCarriers.push(data)
    for (const observer of Array.from(inboundObservers)) observer(data)
    for (const listener of Array.from(listeners)) listener({ data })
  }
  const openSocket = () => {
    if (socketReady) return socketReady
    socketReady = new Promise((resolve, reject) => {
      socket = new WebSocket(`ws://localhost:${app.port}/rpc`)
      socket.binaryType = 'arraybuffer'
      socket.onopen = resolve
      socket.onerror = () => reject(new Error('websocket cell failed'))
      socket.onmessage = async (event) => {
        emit(
          codec.id === 'json'
            ? new TextDecoder().decode(await toBytes(event.data))
            : await toBytes(event.data)
        )
      }
    })
    return socketReady
  }
  const openSse = () => {
    if (sseReady) return sseReady
    sseAbort = new AbortController()
    sseReady = fetch(`http://localhost:${app.port}/events`, { signal: sseAbort.signal }).then(
      (response) => {
        if (!response.ok || !response.body) throw new Error('SSE stream failed')
        sseReader = response.body.getReader()
        void (async () => {
          let buffered = ''
          while (true) {
            const { done, value } = await sseReader.read()
            if (done) return
            buffered += new TextDecoder().decode(value)
            const events = buffered.split('\n\n')
            buffered = events.pop() ?? ''
            for (const event of events) {
              const line = event.match(/^data:(.*)$/u)?.[1]
              if (line === undefined) continue
              const payload =
                codec.id === 'json' ? line : Uint8Array.from(Buffer.from(line, 'base64url'))
              sseCapture = { line, payload }
              emit(payload)
            }
          }
        })().catch((error) => {
          sseFailure = error
        })
      }
    )
    return sseReady
  }
  const sendPost = async (message) => {
    if (carrier === 'post-sse') await openSse()
    const response = await fetch(`http://localhost:${app.port}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': codec.id === 'json' ? 'application/json' : 'application/octet-stream'
      },
      body: message
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (carrier !== 'post-sse') {
      const body = new Uint8Array(await response.arrayBuffer())
      emit(codec.id === 'json' ? new TextDecoder().decode(body) : body)
    }
  }
  const assertCarrierBoundary = (expected, peerExpected) => {
    if (carrier !== 'post-sse') return
    if (sseFailure) throw sseFailure
    if (!sseCapture) throw new Error('SSE response event missing')
    if (codec.id === 'json') {
      const peerExpectedText =
        typeof peerExpected === 'string' ? peerExpected : new TextDecoder().decode(peerExpected)
      if (sseCapture.line !== expected || sseCapture.line !== peerExpectedText)
        throw new Error(
          `JSON SSE text changed at carrier boundary: ${sseCapture.line} !== ${expected}`
        )
      return
    }
    const expectedBytes = Buffer.from(peerExpected)
    const encoded = Buffer.from(sseCapture.line, 'base64url')
    if (encoded.toString('base64url') !== sseCapture.line)
      throw new Error('binary SSE payload was not canonical base64url')
    if (!encoded.equals(expectedBytes) || !Buffer.from(sseCapture.payload).equals(expectedBytes))
      throw new Error('binary SSE bytes changed at carrier boundary')
  }
  return {
    platform: 'MessagePort',
    topology: 'exclusive',
    ownership: 'owned',
    encodedType: 'any',
    send: async (message) => {
      if (carrier === 'websocket') {
        await openSocket()
        socket.send(typeof message === 'string' ? message : Buffer.from(message))
        sentCarriers.push(message)
      } else {
        await sendPost(message)
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: async () => {
      socket?.close()
      sseAbort?.abort()
      await sseReader?.cancel()
      socket = undefined
      socketReady = undefined
      sseAbort = undefined
      sseReady = undefined
      sseReader = undefined
      listeners.clear()
    },
    readInboundCarriers: () => [...inboundCarriers],
    readSentCarriers: () => [...sentCarriers],
    observeInboundCarrier: (observer) => {
      inboundObservers.add(observer)
      return () => inboundObservers.delete(observer)
    },
    assertCarrierBoundary
  }
}

/** Runs one production-endpoint request against the independently implemented peer. */
const runProductionCell = async (app, codecId, carrier) => {
  const codec = await createProductionCodec(codecId)
  const transport = createProductionTransport(app, codec, carrier)
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
          candidate.data?.webRpc?.type === 'response' &&
          candidate.data.webRpc.senderId === 'peer' &&
          candidate.data.webRpc.targetId === 'production' &&
          candidate.data.payload?.ack === peerVector.id
        )
          resolve(candidate)
      } catch {
        // The physical stream can contain unrelated or incomplete frames before the peer ack.
      }
    })
  })
  const endpoint = await modules.endpoint.createEndpoint({
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
  })
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
      responseEnvelope.data?.webRpc?.type !== 'response' ||
      responseEnvelope.data.webRpc.senderId !== 'peer' ||
      responseEnvelope.data.webRpc.targetId !== 'production' ||
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
