import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { stdin, stderr, stdout, pid } from 'node:process'
import type { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

/** Largest native frame payload accepted by stream-framing@1. */
export const MAX_FRAME = 16_777_216

/** A JSON object after parsing an untrusted native frame. */
export type IRecord = Record<string, unknown>

/** A fixed-code failure; input text and authentication data never enter its message. */
export class PeerFault extends Error {
  /** Stable protocol failure category. */
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** Checks an untrusted JSON value without invoking any caller supplied behavior. */
export function isRecord(value: unknown): value is IRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Incrementally decodes frames, checking the announced length before payload allocation. */
export class FrameDecoder {
  /** Partially received fixed header. */
  #header = Buffer.alloc(4)
  /** Number of header bytes already copied. */
  #headerRead = 0
  /** Payload allocated only after a valid length header. */
  #payload: Buffer | undefined
  /** Number of payload bytes already copied. */
  #payloadRead = 0

  push(chunk: Uint8Array): Buffer[] {
    /** Completed payloads delivered by this push. */
    const frames: Buffer[] = []
    /** Current position in the caller's reusable chunk. */
    let offset = 0
    while (offset < chunk.length) {
      if (this.#payload === undefined) {
        const take = Math.min(4 - this.#headerRead, chunk.length - offset)
        this.#header.set(chunk.subarray(offset, offset + take), this.#headerRead)
        this.#headerRead += take
        offset += take
        if (this.#headerRead < 4) continue
        const length = this.#header.readUInt32BE(0)
        if (length === 0) throw new PeerFault('INVALID_FRAME')
        if (length > MAX_FRAME) throw new PeerFault('FRAME_LIMIT_EXCEEDED')
        this.#payload = Buffer.allocUnsafe(length)
        this.#payloadRead = 0
      }
      const payload = this.#payload
      const take = Math.min(payload.length - this.#payloadRead, chunk.length - offset)
      payload.set(chunk.subarray(offset, offset + take), this.#payloadRead)
      this.#payloadRead += take
      offset += take
      if (this.#payloadRead === payload.length) {
        frames.push(payload)
        this.#payload = undefined
        this.#payloadRead = 0
        this.#headerRead = 0
      }
    }
    return frames
  }

  finish(): void {
    if (this.#headerRead !== 0 || this.#payload !== undefined) throw new PeerFault('INVALID_FRAME')
  }
}

/** Encodes one complete payload using the native four-byte length prefix. */
export function encodeFrame(payload: Uint8Array): Buffer {
  if (payload.length === 0) throw new PeerFault('INVALID_FRAME')
  if (payload.length > MAX_FRAME) throw new PeerFault('FRAME_LIMIT_EXCEEDED')
  const frame = Buffer.allocUnsafe(4 + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  frame.set(payload, 4)
  return frame
}

/** Iterates framed messages from one byte stream while preserving coalesced frames. */
class FrameReader {
  /** Decoder is owned by this connection. */
  #decoder = new FrameDecoder()
  /** Completed frames not yet consumed by the protocol loop. */
  #queued: Buffer[] = []
  /** Source iterator supports stdio and Unix sockets alike. */
  #source: AsyncIterator<Uint8Array>

  constructor(source: Readable) {
    this.#source = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>
  }

  async read(): Promise<Buffer | undefined> {
    while (this.#queued.length === 0) {
      const next = await this.#source.next()
      if (next.done) {
        this.#decoder.finish()
        return undefined
      }
      this.#queued.push(...this.#decoder.push(next.value))
    }
    return this.#queued.shift()
  }
}

/** Writes one JSON value as a bounded UTF-8 native frame. */
async function writeJson(destination: Writable, value: unknown): Promise<void> {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const frame = encodeFrame(body)
  if (!destination.write(frame)) await once(destination, 'drain')
}

/** Reads and parses one framed JSON value without exposing malformed input in errors. */
async function readJson(reader: FrameReader, maxBytes = MAX_FRAME): Promise<unknown> {
  const frame = await reader.read()
  if (frame === undefined) return undefined
  if (frame.length > maxBytes) throw new PeerFault('HANDSHAKE_INVALID')
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame)) as unknown
  } catch {
    throw new PeerFault('INVALID_FRAME')
  }
}

/** Returns the peer's default offer; the baseline json codec is always present. */
export function localOffer(peerId: string): IRecord {
  return {
    kind: 'handshake',
    step: 'hello',
    protocol: 'migaia.rpc',
    versions: [{ major: 1, minor: 1 }],
    codecs: ['json'],
    capabilities: ['abort@1', 'ping@1', 'close@1', 'wire-error@1'],
    peer: { id: peerId, runtime: 'node' }
  }
}

/** Reports the first handshake shape violation needed by the native profile. */
export function validateHello(input: unknown): string | undefined {
  if (!isRecord(input) || input.kind !== 'handshake' || typeof input.protocol !== 'string')
    return 'required'
  if (input.step !== 'hello') return 'step'
  if (!Array.isArray(input.versions) || input.versions.length === 0 || input.versions.length > 8)
    return 'type'
  const majors = new Set<number>()
  for (const item of input.versions) {
    if (
      !isRecord(item) ||
      !Number.isSafeInteger(item.major) ||
      Number(item.major) < 1 ||
      !Number.isSafeInteger(item.minor) ||
      Number(item.minor) < 0
    )
      return 'type'
    const major = Number(item.major)
    if (majors.has(major)) return 'duplicate'
    majors.add(major)
  }
  if (
    !Array.isArray(input.codecs) ||
    input.codecs.length === 0 ||
    input.codecs.length > 16 ||
    !input.codecs.every(
      (codec) => typeof codec === 'string' && /^[a-z][a-z0-9.-]{0,31}$/.test(codec)
    )
  )
    return 'type'
  if (new Set(input.codecs).size !== input.codecs.length) return 'duplicate'
  if (!input.codecs.includes('json')) return 'baseline'
  if (
    !Array.isArray(input.capabilities) ||
    input.capabilities.length > 64 ||
    !input.capabilities.every(
      (cap) => typeof cap === 'string' && /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/.test(cap)
    )
  )
    return 'type'
  if (new Set(input.capabilities).size !== input.capabilities.length) return 'duplicate'
  if (
    !isRecord(input.peer) ||
    typeof input.peer.id !== 'string' ||
    input.peer.id.length < 1 ||
    input.peer.id.length > 128 ||
    typeof input.peer.runtime !== 'string' ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(input.peer.runtime)
  )
    return 'type'
  return undefined
}

/** Negotiates the highest shared major, minimum minor, initiator codec order and capability order. */
export function negotiate(initiator: IRecord, responder: IRecord): IRecord | undefined {
  if (validateHello(initiator) !== undefined || validateHello(responder) !== undefined)
    return undefined
  if (initiator.protocol !== responder.protocol) return undefined
  const versions = initiator.versions as Array<{ major: number; minor: number }>
  const offered = responder.versions as Array<{ major: number; minor: number }>
  const common = versions
    .filter((version) => offered.some((candidate) => candidate.major === version.major))
    .sort((a, b) => b.major - a.major)[0]
  if (common === undefined) return undefined
  const chosen = offered.find((candidate) => candidate.major === common.major)!
  const codec = (initiator.codecs as string[]).find((value) =>
    (responder.codecs as string[]).includes(value)
  )
  if (codec === undefined) return undefined
  return {
    major: common.major,
    minor: Math.min(common.minor, chosen.minor),
    codec,
    capabilities: (initiator.capabilities as string[]).filter((value) =>
      (responder.capabilities as string[]).includes(value)
    )
  }
}

/** Rejects an accept that exceeds the initiator's offer or changes its codec/capability set. */
export function validateAccept(offer: IRecord, accept: unknown): boolean {
  if (
    validateHello(offer) !== undefined ||
    !isRecord(accept) ||
    accept.kind !== 'handshake' ||
    accept.step !== 'accept' ||
    accept.protocol !== 'migaia.rpc' ||
    !Number.isSafeInteger(accept.major) ||
    !Number.isSafeInteger(accept.minor) ||
    typeof accept.codec !== 'string' ||
    !Array.isArray(accept.capabilities) ||
    !accept.capabilities.every((cap) => typeof cap === 'string') ||
    !isRecord(accept.peer)
  )
    return false
  const version = (offer.versions as Array<{ major: number; minor: number }>).find(
    (value) => value.major === accept.major
  )
  return (
    version !== undefined &&
    Number(accept.minor) <= version.minor &&
    Number(accept.minor) >= 0 &&
    (offer.codecs as string[]).includes(accept.codec) &&
    (accept.capabilities as string[]).every((cap) => (offer.capabilities as string[]).includes(cap))
  )
}

/** Constructs an ordinary wire-error node with fixed text and no input-derived fields. */
function wireError(code: 'INTERNAL' | 'CANCELLED'): IRecord {
  const message = code === 'CANCELLED' ? 'peer request cancelled' : 'peer request failed'
  const name = code === 'CANCELLED' ? 'RangeError' : 'Error'
  return { source: '@migaia/rpc/core', code, name, message, stack: `${name}: ${message}` }
}

/** Builds the route metadata required by control/envelope-v1. */
function route(
  type: 'request' | 'response' | 'variation',
  senderId: string,
  targetId: string,
  method?: string,
  variation?: string
): IRecord {
  return {
    profile: 'migaia.rpc.route',
    type,
    applicationVersion: '1',
    senderId,
    targetId,
    sentAt: 0,
    ...(method === undefined ? {} : { method }),
    ...(variation === undefined ? {} : { variation })
  }
}

/** Serves one authenticated native connection with no child process or secret logging. */
async function respond(source: Readable, destination: Writable): Promise<void> {
  const reader = new FrameReader(source)
  const first = await readJson(reader, 65_536)
  const violation = validateHello(first)
  if (violation !== undefined) return
  const hello = first as IRecord
  const agreement = negotiate(hello, localOffer('ts-peer'))
  if (agreement === undefined) {
    await writeJson(destination, {
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: {
        source: '@migaia/rpc/contract',
        code: 'HANDSHAKE_INCOMPATIBLE',
        name: 'Error',
        message: 'rpc handshake incompatible',
        stack: 'Error: rpc handshake incompatible'
      }
    })
    return
  }
  await writeJson(destination, {
    kind: 'handshake',
    step: 'accept',
    protocol: 'migaia.rpc',
    ...agreement,
    peer: { id: 'ts-peer', runtime: 'node' }
  })
  /** One-way receipt count is independently queryable by a later request. */
  let oneWayCount = 0
  /** Cancelable deferred calls keyed by their request id. */
  const pending = new Map<
    string,
    { timer: NodeJS.Timeout; done: Promise<void>; finish: () => void }
  >()
  /** Abort ids that may arrive before their matching request. */
  const cancelledIds = new Set<string>()
  while (true) {
    const value = await readJson(reader)
    if (value === undefined) break
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      !isRecord(value.data) ||
      !isRecord(value.data.route)
    )
      throw new PeerFault('INVALID_ENVELOPE')
    const inboundRoute = value.data.route
    const sender = typeof inboundRoute.senderId === 'string' ? inboundRoute.senderId : 'caller'
    if (value.kind === 'variation') {
      if (
        inboundRoute.variation === 'ping' &&
        (agreement.capabilities as string[]).includes('ping@1')
      ) {
        await writeJson(destination, {
          kind: 'variation',
          id: value.id,
          data: { route: route('variation', 'ts-peer', sender, undefined, 'pong') }
        })
      } else if (inboundRoute.variation === 'abort') {
        cancelledIds.add(value.id)
        const task = pending.get(value.id)
        if (task !== undefined) {
          clearTimeout(task.timer)
          pending.delete(value.id)
          task.finish()
        }
      } else if (inboundRoute.variation === 'close') {
        const payload = value.data.payload
        if (
          !isRecord(payload) ||
          !Number.isSafeInteger(payload.drainMs) ||
          Number(payload.drainMs) < 0
        ) {
          stderr.write('PEER_ERROR PROTOCOL_INVALID\n')
          continue
        }
        const drainMs = Number(payload.drainMs)
        let deadline: NodeJS.Timeout | undefined
        await Promise.race([
          Promise.all([...pending.values()].map((task) => task.done)),
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, drainMs)
          })
        ])
        if (deadline !== undefined) clearTimeout(deadline)
        break
      }
      continue
    }
    if (value.kind !== 'request' || typeof value.method !== 'string')
      throw new PeerFault('INVALID_ENVELOPE')
    if (cancelledIds.delete(value.id)) continue
    if (inboundRoute.dispatchOnly === true) {
      oneWayCount += 1
      continue
    }
    if (value.method === 'peer.wait') {
      const id = value.id
      const method = value.method
      let finish!: () => void
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const timer = setTimeout(() => {
        pending.delete(id)
        void writeJson(destination, {
          kind: 'response',
          id,
          ok: true,
          data: { route: route('response', 'ts-peer', sender, method), payload: null }
        })
          .catch(() => {
            stderr.write('PEER_ERROR WRITE_FAILED\n')
          })
          .finally(finish)
      }, 30_000)
      pending.set(id, { timer, done, finish })
      continue
    }
    if (value.method === 'peer.error') {
      const error = wireError('INTERNAL')
      await writeJson(destination, {
        kind: 'response',
        id: value.id,
        ok: false,
        code: error.code,
        message: error.message,
        error,
        data: { route: route('response', 'ts-peer', sender, value.method) }
      })
      continue
    }
    const payload =
      value.method === 'peer.receipts'
        ? oneWayCount
        : value.method === 'peer.trace'
          ? (inboundRoute.trace ?? null)
          : (value.data.payload ?? null)
    await writeJson(destination, {
      kind: 'response',
      id: value.id,
      ok: true,
      data: { route: route('response', 'ts-peer', sender, value.method), payload }
    })
  }
  for (const task of pending.values()) {
    clearTimeout(task.timer)
    task.finish()
  }
}

/** Initiates one framed handshake and request for pairwise language interop. */
async function initiate(source: Readable, destination: Writable): Promise<void> {
  const reader = new FrameReader(source)
  const offer = localOffer('ts-peer')
  await writeJson(destination, offer)
  const accepted = await readJson(reader, 65_536)
  if (!validateAccept(offer, accepted) || !isRecord(accepted) || accepted.codec !== 'json')
    throw new PeerFault('HANDSHAKE_INVALID')
  const sent = { value: 'cross-language-echo' }
  await writeJson(destination, {
    kind: 'request',
    id: 'peer-interop-1',
    method: 'echo',
    data: { route: route('request', 'ts-peer', 'remote-peer'), payload: sent }
  })
  const reply = await readJson(reader)
  if (
    !isRecord(reply) ||
    reply.kind !== 'response' ||
    reply.id !== 'peer-interop-1' ||
    reply.ok !== true ||
    !isRecord(reply.data) ||
    !isRecord(reply.data.payload) ||
    reply.data.payload.value !== sent.value
  )
    throw new PeerFault('INTEROP_FAILED')
  await writeJson(destination, {
    kind: 'variation',
    id: 'peer-close-1',
    data: {
      route: route('variation', 'ts-peer', 'remote-peer', undefined, 'close'),
      payload: { drainMs: 0 }
    }
  })
  stderr.write('RESULT ok\n')
}

/** Parses the fixture's command line without accepting secrets in arguments. */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const roleIndex = args.indexOf('--role')
  const role = roleIndex < 0 ? 'responder' : args[roleIndex + 1]
  if (role !== 'responder' && role !== 'initiator') throw new PeerFault('INVALID_OPTION')
  const socketIndex = args.indexOf('--listen-unix')
  if (socketIndex >= 0) {
    if (role !== 'responder' || typeof args[socketIndex + 1] !== 'string')
      throw new PeerFault('INVALID_OPTION')
    const address = args[socketIndex + 1]
    const server = createServer((socket) => {
      void respond(socket, socket).then(
        () => socket.end(),
        () => socket.destroy()
      )
    })
    server.listen(address)
    await once(server, 'listening')
    stderr.write(`READY pid=${pid}\n`)
    await once(server, 'close')
    return
  }
  if (!args.includes('--stdio')) throw new PeerFault('INVALID_OPTION')
  stderr.write(`READY pid=${pid}\n`)
  if (role === 'initiator') await initiate(stdin, stdout)
  else await respond(stdin, stdout)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    const code = error instanceof PeerFault ? error.code : 'PEER_FAILED'
    stderr.write(`PEER_ERROR ${code}\n`)
    process.exitCode = 1
  })
}
