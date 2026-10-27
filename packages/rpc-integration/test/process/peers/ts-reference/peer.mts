import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { stdin, stderr, stdout, pid } from 'node:process'
import type { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

/** Largest native frame payload accepted by stream-framing@1. */
export const MAX_FRAME = 16_777_216

/** The reference authors this sole profile independently of production code. */
export const REFERENCE_PROFILE = 'migaia.rpc/2'
/** Original actual business names remain the directory's only invocation authority. */
const ReferenceMethod = {
  echo: 'echo',
  receipts: 'peer.receipts',
  trace: 'peer.trace',
  wait: 'peer.wait',
  error: 'peer.error',
  finish: 'peer.finish'
} as const
/** Reference provider identity is independent from every harness caller. */
const REFERENCE_IDENTITY = {
  name: 'ts-reference',
  instanceId: 'ts-peer',
  generation: { kind: 'session', value: 0, providerId: 'ts-peer' }
} as const
/** Only installed scalar methods are advertised; no implicit stream or group capability exists. */
const REFERENCE_DESCRIPTION = {
  schemaVersion: 3,
  self: REFERENCE_IDENTITY,
  methods: Object.values(ReferenceMethod).map((name) => ({
    name,
    supportedModes: name === ReferenceMethod.echo ? ['request', 'notify'] : ['request'],
    modeSource: 'declared'
  }))
} as const

/** Existing core provider refusal keeps one stable registered message across fixture routes. */
const PROVIDER_NOT_FOUND_MESSAGE = 'Runtime method is not provided by this peer'

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
  /** A malformed later frame is reported after earlier complete frames are consumed. */
  #deferredFault: PeerFault | undefined

  throwDeferredFault(): void {
    if (this.#deferredFault !== undefined) throw this.#deferredFault
  }

  push(chunk: Uint8Array): Buffer[] {
    this.throwDeferredFault()
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
        if (length === 0 || length > MAX_FRAME) {
          const fault = new PeerFault(length === 0 ? 'INVALID_FRAME' : 'FRAME_LIMIT_EXCEEDED')
          if (frames.length === 0) throw fault
          this.#deferredFault = fault
          return frames
        }
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
    this.throwDeferredFault()
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
      this.#decoder.throwDeferredFault()
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

/** Check required known fields; profile2 ignores unknown metadata for each active variant. */
function requiredFields(value: unknown, required: readonly string[]): IRecord {
  if (!isRecord(value) || required.some((key) => !Object.hasOwn(value, key)))
    throw new PeerFault('PROTOCOL_INVALID')
  return value
}
/** Metadata identifiers retain the actual UTF-16 domain of the former public TS owner. */
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128
}
/** Native execution generations are data until their full source/task tuple is matched. */
function generation(value: unknown): IRecord {
  const input = requiredFields(value, ['kind', 'value', 'providerId'])
  if (
    !['session', 'restart'].includes(String(input.kind)) ||
    !Number.isSafeInteger(input.value) ||
    Number(input.value) < 0 ||
    !identifier(input.providerId)
  )
    throw new PeerFault('PROTOCOL_INVALID')
  return input
}
/** Method names retain original qualified provider segments. */
function method(value: unknown): value is string {
  return (
    identifier(value) &&
    /^[A-Za-z][A-Za-z0-9_-]{0,39}(?:\.[A-Za-z][A-Za-z0-9_-]{0,39})*$/.test(value)
  )
}
/** Scalars are charged as actual UTF-8 without accepting unpaired surrogates. */
function textBytes(value: unknown): number {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new PeerFault('PROTOCOL_INVALID')
  return Buffer.byteLength(value)
}
/** Canonical inline bytes have one marker, URL alphabet and zero unused bits. */
function bytesTag(value: IRecord): boolean {
  const encoded = value.base64url
  if (
    Object.keys(value).length !== 2 ||
    value.$rpc !== 'bytes' ||
    typeof encoded !== 'string' ||
    !/^[A-Za-z0-9_-]*$/.test(encoded) ||
    encoded.length % 4 === 1
  )
    return false
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(
    encoded.at(-1) ?? 'A'
  )
  return (
    encoded.length % 4 === 0 ||
    (encoded.length % 4 === 2 && (last & 15) === 0) ||
    (encoded.length % 4 === 3 && (last & 3) === 0)
  )
}
/** Validate and measure portable stream data in one walk; there is no projection or copy. */
export function portableBytes(value: unknown, depth = 0): number {
  if (depth > 64) throw new PeerFault('PROTOCOL_INVALID')
  if (value === null) return 4
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number' && Number.isFinite(value)) return 24
  if (typeof value === 'string') {
    textBytes(value)
    return Buffer.byteLength(JSON.stringify(value))
  }
  if (Array.isArray(value))
    return (
      2 +
      Math.max(0, value.length - 1) +
      value.reduce((total, item) => total + portableBytes(item, depth + 1), 0)
    )
  if (isRecord(value)) {
    if (Object.hasOwn(value, '$rpc') && !bytesTag(value)) throw new PeerFault('PROTOCOL_INVALID')
    return (
      2 +
      Math.max(0, Object.keys(value).length - 1) +
      Object.entries(value).reduce(
        (total, [key, item]) =>
          total + portableBytes(key, depth + 1) + 1 + portableBytes(item, depth + 1),
        0
      )
    )
  }
  throw new PeerFault('PROTOCOL_INVALID')
}
/** Flat error data has the original 48-level and 64KiB text domain. */
function errorDataBytes(value: unknown, depth = 17): number {
  if (depth > 64) throw new PeerFault('PROTOCOL_INVALID')
  if (typeof value === 'string') return textBytes(value)
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return 0
  if (Array.isArray(value))
    return value.reduce((total, item) => total + errorDataBytes(item, depth + 1), 0)
  if (isRecord(value)) {
    if (Object.hasOwn(value, '$rpc')) {
      if (!bytesTag(value)) throw new PeerFault('PROTOCOL_INVALID')
      return (
        textBytes('$rpc') +
        textBytes(value.$rpc) +
        textBytes('base64url') +
        textBytes(value.base64url)
      )
    }
    return Object.entries(value).reduce(
      (total, [key, item]) => total + textBytes(key) + errorDataBytes(item, depth + 1),
      0
    )
  }
  throw new PeerFault('PROTOCOL_INVALID')
}
/** Validate bounded flat indexes without following graph edges or restoring a second error tree. */
export function validateWire(value: unknown): IRecord {
  const graph = requiredFields(value, ['root', 'nodes'])
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length < 1 ||
    graph.nodes.length > 1024 ||
    !Number.isSafeInteger(graph.root) ||
    Number(graph.root) < 0 ||
    Number(graph.root) >= graph.nodes.length
  )
    throw new PeerFault('PROTOCOL_INVALID')
  let total = 0
  for (const raw of graph.nodes) {
    const node = requiredFields(raw, ['source', 'code', 'name', 'message', 'stack'])
    for (const key of ['source', 'code', 'name', 'message', 'stack']) {
      const size = textBytes(node[key])
      if (size > 65536 || (key !== 'message' && size === 0)) throw new PeerFault('PROTOCOL_INVALID')
      total += size
    }
    if (Object.hasOwn(node, 'truncated') && node.truncated !== true)
      throw new PeerFault('PROTOCOL_INVALID')
    if (
      Object.hasOwn(node, 'cause') &&
      (!Number.isSafeInteger(node.cause) ||
        Number(node.cause) < 0 ||
        Number(node.cause) >= graph.nodes.length)
    )
      throw new PeerFault('PROTOCOL_INVALID')
    if (
      Object.hasOwn(node, 'errors') &&
      (!Array.isArray(node.errors) ||
        node.errors.length === 0 ||
        node.errors.some(
          (index) =>
            !Number.isSafeInteger(index) || index < 0 || index >= (graph.nodes as unknown[]).length
        ))
    )
      throw new PeerFault('PROTOCOL_INVALID')
    if (Object.hasOwn(node, 'route')) {
      if (
        !Array.isArray(node.route) ||
        node.route.length < 1 ||
        node.route.length > 17 ||
        node.route.some((item) => typeof item !== 'string' || !/^[0-9a-f]{32}$/.test(item))
      )
        throw new PeerFault('PROTOCOL_INVALID')
      total += node.route.length * 32
    }
    if (Object.hasOwn(node, 'data')) {
      if (errorDataBytes(node.data) > 65536) throw new PeerFault('PROTOCOL_INVALID')
      total += Buffer.byteLength(JSON.stringify(node.data))
    }
    if (total > 1048576) throw new PeerFault('PROTOCOL_INVALID')
  }
  return graph
}
/** Admit the schema3 provider directory independently, before publishing any callable route. */
export function validateDirectory(value: unknown): IRecord {
  const input = requiredFields(value, ['schemaVersion', 'self', 'methods'])
  const self = requiredFields(input.self, ['name', 'instanceId', 'generation'])
  if (
    input.schemaVersion !== 3 ||
    !identifier(self.name) ||
    !identifier(self.instanceId) ||
    !Array.isArray(input.methods) ||
    input.methods.length > 4096
  )
    throw new PeerFault('PROTOCOL_INVALID')
  generation(self.generation)
  if (
    Object.hasOwn(input, 'nodeId') &&
    (typeof input.nodeId !== 'string' || !/^[0-9a-f]{32}$/.test(input.nodeId))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  const names = new Set<string>()
  for (const raw of input.methods) {
    const entry = requiredFields(raw, ['name', 'supportedModes', 'modeSource'])
    if (
      !method(entry.name) ||
      names.has(entry.name) ||
      !Array.isArray(entry.supportedModes) ||
      entry.supportedModes.length === 0 ||
      entry.supportedModes.some((mode) => !['request', 'notify', 'stream'].includes(mode)) ||
      new Set(entry.supportedModes).size !== entry.supportedModes.length ||
      !['declared', 'generated-routes'].includes(String(entry.modeSource)) ||
      (Object.hasOwn(entry, 'idempotent') && typeof entry.idempotent !== 'boolean')
    )
      throw new PeerFault('PROTOCOL_INVALID')
    if (
      Object.hasOwn(entry, 'forwardedVia') &&
      (typeof entry.forwardedVia !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(entry.forwardedVia))
    )
      throw new PeerFault('PROTOCOL_INVALID')
    names.add(entry.name)
    for (const key of ['input', 'output', 'yield'])
      if (Object.hasOwn(entry, key)) portableBytes(entry[key], 3)
  }
  return input
}
/** Returns the sole independent offer; installed business inventory is carried by the actual hello. */
export function localOffer(peerId: string): IRecord {
  const self =
    peerId === REFERENCE_IDENTITY.instanceId
      ? REFERENCE_IDENTITY
      : {
          name: peerId,
          instanceId: peerId,
          generation: { kind: 'session', value: 0, providerId: peerId }
        }
  return {
    profile: REFERENCE_PROFILE,
    kind: 'handshake',
    step: 'hello',
    versions: [{ major: 2, minor: 0 }],
    codecs: ['json'],
    extensions: [],
    peer: { id: peerId, runtime: 'node' },
    directory: { ...REFERENCE_DESCRIPTION, self }
  }
}
/** Admit known hello/accept/reject/pending fields without importing production validators. */
export function validateHandshake(value: unknown): IRecord {
  if (!isRecord(value) || value.profile !== REFERENCE_PROFILE || value.kind !== 'handshake')
    throw new PeerFault('HANDSHAKE_INVALID')
  if (value.step === 'reject') {
    requiredFields(value, ['profile', 'kind', 'step', 'error'])
    validateWire(value.error)
    return value
  }
  if (value.step === 'pending') {
    requiredFields(value, ['profile', 'kind', 'step', 'peer', 'remainingMs'])
    /** Pending admission identifies the same remote peer without announcing a directory. */
    const peer = requiredFields(value.peer, ['id', 'runtime'])
    if (
      !identifier(peer.id) ||
      typeof peer.runtime !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(peer.runtime) ||
      typeof value.remainingMs !== 'number' ||
      !Number.isFinite(value.remainingMs) ||
      value.remainingMs < 0 ||
      value.remainingMs > 2147483647
    )
      throw new PeerFault('HANDSHAKE_INVALID')
    if (Object.hasOwn(value, 'auth')) portableBytes(value.auth)
    return value
  }
  if (value.step !== 'hello' && value.step !== 'accept') throw new PeerFault('HANDSHAKE_INVALID')
  requiredFields(value, [
    'profile',
    'kind',
    'step',
    'peer',
    'directory',
    'extensions',
    ...(value.step === 'hello' ? ['versions', 'codecs'] : ['major', 'minor', 'codec'])
  ])
  const peer = requiredFields(value.peer, ['id', 'runtime'])
  const directory = validateDirectory(value.directory)
  if (
    !identifier(peer.id) ||
    typeof peer.runtime !== 'string' ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(peer.runtime) ||
    (directory.self as IRecord).instanceId !== peer.id
  )
    throw new PeerFault('HANDSHAKE_INVALID')
  if (Object.hasOwn(peer, 'runtimeVersion') && typeof peer.runtimeVersion !== 'string')
    throw new PeerFault('HANDSHAKE_INVALID')
  if (Object.hasOwn(peer, 'implementation')) {
    const implementation = requiredFields(peer.implementation, ['name', 'version'])
    if (typeof implementation.name !== 'string' || typeof implementation.version !== 'string')
      throw new PeerFault('HANDSHAKE_INVALID')
  }
  for (const key of ['extensions', 'requiredExtensions', 'codecs'])
    if (Object.hasOwn(value, key)) {
      const items = value[key]
      if (
        !Array.isArray(items) ||
        items.length > (key === 'codecs' ? 16 : 64) ||
        items.some(
          (item) =>
            typeof item !== 'string' ||
            !(key === 'codecs' ? /^[a-z][a-z0-9.-]{0,31}$/ : /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/).test(
              item
            )
        ) ||
        new Set(items).size !== items.length
      )
        throw new PeerFault('HANDSHAKE_INVALID')
    }
  if (value.step === 'hello') {
    if (
      !Array.isArray(value.versions) ||
      value.versions.length < 1 ||
      value.versions.length > 8 ||
      !(value.codecs as string[]).includes('json')
    )
      throw new PeerFault('HANDSHAKE_INVALID')
    const majors = new Set<number>()
    for (const raw of value.versions) {
      const version = requiredFields(raw, ['major', 'minor'])
      if (
        !Number.isSafeInteger(version.major) ||
        Number(version.major) < 1 ||
        !Number.isSafeInteger(version.minor) ||
        Number(version.minor) < 0 ||
        majors.has(Number(version.major))
      )
        throw new PeerFault('HANDSHAKE_INVALID')
      majors.add(Number(version.major))
    }
    if (
      ((value.requiredExtensions ?? []) as string[]).some(
        (item) => !(value.extensions as string[]).includes(item)
      )
    )
      throw new PeerFault('HANDSHAKE_INVALID')
  } else if (value.major !== 2 || value.minor !== 0 || value.codec !== 'json')
    throw new PeerFault('HANDSHAKE_INVALID')
  if (Object.hasOwn(value, 'auth')) portableBytes(value.auth)
  return value
}
/** Preserve the existing selftest entry while validating only the current hello grammar. */
export function validateHello(value: unknown): string | undefined {
  try {
    return validateHandshake(value).step === 'hello' ? undefined : 'step'
  } catch {
    return 'type'
  }
}
/** Select the sole supported version/json and the initiating offer's common extension order. */
export function negotiate(initiator: IRecord, responder: IRecord): IRecord | undefined {
  if (
    validateHello(initiator) !== undefined ||
    validateHello(responder) !== undefined ||
    !(initiator.versions as IRecord[]).some((version) => version.major === 2) ||
    !(responder.versions as IRecord[]).some((version) => version.major === 2)
  )
    return undefined
  const extensions = (initiator.extensions as string[]).filter((extension) =>
    (responder.extensions as string[]).includes(extension)
  )
  if (
    [
      ...((initiator.requiredExtensions ?? []) as string[]),
      ...((responder.requiredExtensions ?? []) as string[])
    ].some((extension) => !extensions.includes(extension))
  )
    return undefined
  return {
    profile: REFERENCE_PROFILE,
    kind: 'handshake',
    step: 'accept',
    major: 2,
    minor: 0,
    codec: 'json',
    extensions,
    peer: responder.peer,
    directory: responder.directory
  }
}
/** The initiator fences accepted choices and exact remote hello identity/directory. */
export function validateAccept(offer: IRecord, accepted: unknown): boolean {
  try {
    const value = validateHandshake(accepted)
    return (
      value.step === 'accept' &&
      (offer.versions as IRecord[]).some((version) => version.major === value.major) &&
      (value.extensions as string[]).every((item) =>
        (offer.extensions as string[]).includes(item)
      ) &&
      ((offer.requiredExtensions ?? []) as string[]).every((item) =>
        (value.extensions as string[]).includes(item)
      )
    )
  } catch {
    return false
  }
}
/** Construct only the original fixed diagnostic, in the actual flat graph shape. */
function wireError(code: string): IRecord {
  const message =
    code === 'PROVIDER_NOT_FOUND'
      ? PROVIDER_NOT_FOUND_MESSAGE
      : code === 'CAPABILITY_UNSUPPORTED'
        ? 'Runtime operation capability is unavailable'
        : code === 'HANDSHAKE_INCOMPATIBLE'
          ? 'rpc handshake incompatible'
          : code === 'ENDPOINT_DISPOSED'
            ? 'Endpoint disposed'
            : 'peer request failed'
  return {
    root: 0,
    nodes: [
      {
        source: code === 'HANDSHAKE_INCOMPATIBLE' ? 'rpc.contract' : 'rpc.endpoint',
        code,
        name: 'Error',
        message,
        stack: `Error: ${message}`
      }
    ]
  }
}
/** Direct responses borrow no payload-derived identity or routing privilege. */
function route(senderId: string, targetId: string, trace?: unknown): IRecord {
  return {
    applicationVersion: '1',
    senderId,
    targetId,
    receiverId: targetId,
    sentAt: 0,
    ...(trace === undefined ? {} : { trace })
  }
}
/** Stream field ownership and semantic byte budgets are part of the sole live parser. */
export function validateStream(value: unknown): void {
  const input = requiredFields(value, ['event', 'seq'])
  const fields: Record<string, string | undefined> = {
    open: undefined,
    pull: undefined,
    item: 'value',
    end: 'value',
    fail: 'error',
    cancelled: 'error',
    'finish-without-items': 'reason'
  }
  const field = fields[String(input.event)]
  if (
    !Object.hasOwn(fields, String(input.event)) ||
    !Number.isSafeInteger(input.seq) ||
    Number(input.seq) < 0 ||
    (input.event === 'open' && input.seq !== 0)
  )
    throw new PeerFault('PROTOCOL_INVALID')
  requiredFields(input, [
    'event',
    'seq',
    ...(['item', 'fail'].includes(String(input.event)) ? [field!] : [])
  ])
  if (field && Object.hasOwn(input, field)) {
    if (field === 'value') {
      if (portableBytes(input.value) > 16384) throw new PeerFault('PROTOCOL_INVALID')
    } else validateWire(input[field])
  }
}
/** Group reports retain failure-stop ordering rather than legacy independent batch semantics. */
function validateGroup(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) throw new PeerFault('PROTOCOL_INVALID')
  let failed = false
  for (const raw of value) {
    const item = raw as IRecord
    if (item?.state === 'success' && !failed) {
      requiredFields(item, ['state'])
      if (Object.hasOwn(item, 'result')) portableBytes(item.result)
    } else if (item?.state === 'failure' && !failed) {
      requiredFields(item, ['state', 'error'])
      validateWire(item.error)
      failed = true
    } else if (item?.state === 'not-executed' && failed) requiredFields(item, ['state'])
    else throw new PeerFault('PROTOCOL_INVALID')
  }
}
/** One independent parser admits the actual canonical semantic frame. */
export function validateFrame(value: unknown): IRecord {
  if (!isRecord(value) || value.profile !== REFERENCE_PROFILE)
    throw new PeerFault('PROTOCOL_INVALID')
  if (value.kind === 'handshake') return validateHandshake(value)
  const fields: Record<string, [string[], string[]]> = {
    call: [
      ['task', 'options'],
      ['payload', 'extensions']
    ],
    group: [['task', 'options', 'steps'], ['extensions']],
    result: [['task'], ['result', 'extensions']],
    error: [['task', 'error'], ['extensions']],
    cancel: [['task'], ['reason', 'extensions']],
    stream: [['task', 'stream'], ['extensions']],
    control: [['operation'], ['reason']],
    directory: [['directory'], []],
    outcome: [
      ['task', 'operation'],
      ['idempotencyKey', 'state', 'store', 'outcome', 'extensions']
    ]
  }
  const shape = fields[String(value.kind)]
  if (!shape) throw new PeerFault('PROTOCOL_INVALID')
  requiredFields(value, ['profile', 'kind', 'id', 'route', ...shape[0]])
  const routing = requiredFields(value.route, [
    'applicationVersion',
    'senderId',
    'targetId',
    'receiverId',
    'sentAt'
  ])
  if (
    !identifier(value.id) ||
    ['applicationVersion', 'senderId', 'targetId', 'receiverId'].some(
      (key) => !identifier(routing[key])
    ) ||
    typeof routing.sentAt !== 'number' ||
    !Number.isFinite(routing.sentAt) ||
    routing.sentAt < 0 ||
    (Object.hasOwn(routing, 'remainingMs') &&
      (typeof routing.remainingMs !== 'number' ||
        !Number.isFinite(routing.remainingMs) ||
        routing.remainingMs < 0 ||
        routing.remainingMs > 2147483647))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  if (
    Object.hasOwn(routing, 'trace') &&
    (typeof routing.trace !== 'string' || !/^[ -~]{1,256}$/.test(routing.trace))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  if (
    Object.hasOwn(routing, 'forwardRoute') &&
    (!Array.isArray(routing.forwardRoute) ||
      routing.forwardRoute.length > 17 ||
      routing.forwardRoute.some((item) => typeof item !== 'string' || !/^[0-9a-f]{32}$/.test(item)))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  const task = Object.hasOwn(value, 'task')
    ? requiredFields(value.task, ['mode', 'callerId', 'callerGeneration', 'targetGeneration'])
    : undefined
  if (task) {
    if (
      !['request', 'notify', 'stream', 'group', 'outcome'].includes(String(task.mode)) ||
      !identifier(task.callerId)
    )
      throw new PeerFault('PROTOCOL_INVALID')
    generation(task.callerGeneration)
    generation(task.targetGeneration)
    if (['request', 'notify', 'stream'].includes(String(task.mode)) ? !method(task.method) : false)
      throw new PeerFault('PROTOCOL_INVALID')
  }
  if (value.kind === 'error') validateWire(value.error)
  if ((value.kind === 'cancel' || value.kind === 'control') && Object.hasOwn(value, 'reason'))
    validateWire(value.reason)
  if (Object.hasOwn(value, 'payload')) portableBytes(value.payload)
  if (Object.hasOwn(value, 'extensions')) {
    if (!isRecord(value.extensions)) throw new PeerFault('PROTOCOL_INVALID')
    portableBytes(value.extensions)
  }
  if (value.kind === 'call' || value.kind === 'group') {
    const options = requiredFields(value.options, [])
    if (
      ['orderKey', 'idempotencyKey'].some(
        (key) => Object.hasOwn(options, key) && !identifier(options[key])
      ) ||
      (Object.hasOwn(options, 'cancel') && options.cancel !== 'before-start') ||
      (task!.mode === 'notify' &&
        Object.hasOwn(options, 'idempotencyKey') &&
        options.cancel !== 'before-start')
    )
      throw new PeerFault('PROTOCOL_INVALID')
    if (
      value.kind === 'call'
        ? !['request', 'notify', 'stream'].includes(String(task!.mode))
        : task!.mode !== 'group'
    )
      throw new PeerFault('PROTOCOL_INVALID')
  }
  if (value.kind === 'group') {
    if (!Array.isArray(value.steps) || value.steps.length === 0)
      throw new PeerFault('PROTOCOL_INVALID')
    for (const raw of value.steps) {
      const step = requiredFields(raw, ['method'])
      if (!method(step.method)) throw new PeerFault('PROTOCOL_INVALID')
      if (Object.hasOwn(step, 'payload')) portableBytes(step.payload)
    }
  }
  if (value.kind === 'result') {
    if (task!.mode === 'group') validateGroup(value.result)
    else if (Object.hasOwn(value, 'result')) portableBytes(value.result)
  }
  if (value.kind === 'stream') {
    if (task!.mode !== 'stream') throw new PeerFault('PROTOCOL_INVALID')
    validateStream(value.stream)
  }
  if (
    value.kind === 'control' &&
    !['ping', 'pong', 'drain', 'close'].includes(String(value.operation))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  if (value.kind === 'directory') validateDirectory(value.directory)
  if (value.kind === 'outcome') validateOutcome(value)
  return value
}
/** The independent oracle admits status metadata without inventing an outcome storage owner. */
function validateOutcome(value: IRecord): void {
  if ((value.task as IRecord).mode !== 'outcome') throw new PeerFault('PROTOCOL_INVALID')
  if (value.operation === 'lookup') {
    requiredFields(value, ['profile', 'kind', 'id', 'route', 'task', 'operation', 'idempotencyKey'])
    if (!identifier(value.idempotencyKey)) throw new PeerFault('PROTOCOL_INVALID')
    return
  }
  requiredFields(value, ['profile', 'kind', 'id', 'route', 'task', 'operation', 'state', 'store'])
  const store = value.store as IRecord
  if (store?.kind === 'unavailable') {
    requiredFields(store, ['kind', 'continuity'])
    if (store.continuity !== 'unavailable') throw new PeerFault('PROTOCOL_INVALID')
  } else {
    requiredFields(store, ['kind', 'epoch', 'continuity'])
    if (
      !['memory', 'external'].includes(String(store.kind)) ||
      !identifier(store.epoch) ||
      !['retained', 'lost-since-restart'].includes(String(store.continuity))
    )
      throw new PeerFault('PROTOCOL_INVALID')
  }
  if (
    value.operation !== 'result' ||
    !['unknown', 'pending', 'done'].includes(String(value.state)) ||
    (value.state === 'done' && !Object.hasOwn(value, 'outcome'))
  )
    throw new PeerFault('PROTOCOL_INVALID')
  if (value.state === 'done') {
    const outcome = requiredFields(value.outcome, ['mode', 'targetGeneration', 'completion'])
    generation(outcome.targetGeneration)
    const completion = requiredFields(outcome.completion, ['ok'])
    if (
      !['request', 'notify', 'stream', 'group'].includes(String(outcome.mode)) ||
      typeof completion.ok !== 'boolean'
    )
      throw new PeerFault('PROTOCOL_INVALID')
    if (completion.ok) {
      requiredFields(completion, ['ok'])
      if (outcome.mode === 'group') validateGroup(completion.result)
      else if (Object.hasOwn(completion, 'result')) portableBytes(completion.result)
    } else {
      requiredFields(completion, ['ok', 'error'])
      validateWire(completion.error)
    }
  }
}
/** Exact equality is confined to admitted primitive generation facts. */
function sameGeneration(left: IRecord, right: IRecord): boolean {
  return (
    left.kind === right.kind && left.value === right.value && left.providerId === right.providerId
  )
}
/** Bilateral hello reuses the original framed reader and physical writer. */
async function handshake(reader: FrameReader, destination: Writable): Promise<IRecord> {
  const local = localOffer('ts-peer')
  await writeJson(destination, local)
  let remoteHello: IRecord | undefined
  /** Only the first accepting agreement is retained while waiting for reciprocal admission. */
  let selected: IRecord | undefined
  while (true) {
    let incoming: IRecord
    try {
      incoming = validateHandshake(await readJson(reader, 65536))
    } catch (error) {
      // After the remote hello, a broken physical frame remains a framing failure.
      if (remoteHello !== undefined) throw error
      throw new PeerFault('HANDSHAKE_INVALID')
    }
    if (incoming.step === 'pending') {
      if (!remoteHello || JSON.stringify(remoteHello.peer) !== JSON.stringify(incoming.peer))
        throw new PeerFault('HANDSHAKE_INVALID')
      continue
    }
    if (incoming.step === 'reject' || (incoming.peer as IRecord).id === 'ts-peer')
      throw new PeerFault('HANDSHAKE_INVALID')
    if (incoming.step === 'hello') {
      if ('ts-peer' > String((incoming.peer as IRecord).id)) {
        const accepted = negotiate(incoming, local)
        if (!accepted) {
          await writeJson(destination, {
            profile: REFERENCE_PROFILE,
            kind: 'handshake',
            step: 'reject',
            error: wireError('HANDSHAKE_INCOMPATIBLE')
          })
          throw new PeerFault('HANDSHAKE_INCOMPATIBLE')
        }
        if (local.auth !== undefined) accepted.auth = local.auth
        await writeJson(destination, accepted)
        remoteHello = incoming
        selected = accepted
        continue
      }
      remoteHello = incoming
    } else {
      if (selected) {
        if (
          ['major', 'minor', 'codec', 'extensions'].some(
            (key) => JSON.stringify(selected![key]) !== JSON.stringify(incoming[key])
          ) ||
          JSON.stringify(remoteHello!.peer) !== JSON.stringify(incoming.peer) ||
          JSON.stringify(remoteHello!.directory) !== JSON.stringify(incoming.directory)
        )
          throw new PeerFault('HANDSHAKE_INVALID')
        return remoteHello!
      }
      if (
        !validateAccept(local, incoming) ||
        'ts-peer' > String((incoming.peer as IRecord).id) ||
        (remoteHello &&
          (JSON.stringify(remoteHello.peer) !== JSON.stringify(incoming.peer) ||
            JSON.stringify(remoteHello.directory) !== JSON.stringify(incoming.directory)))
      )
        throw new PeerFault('HANDSHAKE_INVALID')
      await writeJson(destination, {
        profile: REFERENCE_PROFILE,
        kind: 'handshake',
        step: 'accept',
        major: incoming.major,
        minor: incoming.minor,
        codec: incoming.codec,
        extensions: incoming.extensions,
        peer: local.peer,
        directory: local.directory,
        ...(local.auth === undefined ? {} : { auth: local.auth })
      })
      return incoming
    }
  }
}
/** Compact original pending metadata contains no options or business payload. */
type IReferenceHeader = { id: string; route: IRecord; task: IRecord }
/** Responses preserve the original task and actual inbound source identity. */
function response(value: IReferenceHeader, result: unknown = null, error?: IRecord): IRecord {
  return {
    profile: REFERENCE_PROFILE,
    kind: error ? 'error' : 'result',
    id: value.id,
    route: route('ts-peer', String(value.route.senderId), value.route.trace),
    task: value.task,
    ...(error ? { error } : { result })
  }
}
/** Same full primitive task tuple prevents cancellation of a reused id or another method. */
function sameTask(left: IRecord, right: IRecord): boolean {
  return (
    left.mode === right.mode &&
    left.method === right.method &&
    left.callerId === right.callerId &&
    sameGeneration(left.callerGeneration as IRecord, right.callerGeneration as IRecord) &&
    sameGeneration(left.targetGeneration as IRecord, right.targetGeneration as IRecord)
  )
}
/** One existing wait owns its original timer, completion and header until finish/cancel/EOF. */
class ReferencePending {
  /** Metadata-only original request is needed for its eventual response. */
  readonly header: IReferenceHeader
  /** Existing loop drain joins this original wait completion. */
  readonly done: Promise<void>
  /** Original native writer remains borrowed. */
  readonly #destination: Writable
  /** Owner removes only this actual pending id on timer/finish/cancel. */
  readonly #remove: () => void
  /** Timer is released before any terminal response is written. */
  readonly #timer: NodeJS.Timeout
  /** Resolve the same drain completion once. */
  #resolve!: () => void
  /** Timer and explicit finish cannot send two responses for the same original wait. */
  #finished = false
  constructor(header: IReferenceHeader, destination: Writable, remove: () => void) {
    this.header = header
    this.#destination = destination
    this.#remove = remove
    this.done = new Promise((resolve) => {
      this.#resolve = resolve
    })
    this.#timer = setTimeout(() => {
      void this.finish(true)
    }, 30000)
  }
  /** Explicit cancel/EOF suppresses replies, while finish/timer preserves the original null result. */
  async finish(reply: boolean): Promise<void> {
    if (this.#finished) return
    this.#finished = true
    clearTimeout(this.#timer)
    this.#remove()
    try {
      if (reply) await writeJson(this.#destination, response(this.header))
    } catch {
      stderr.write('PEER_ERROR WRITE_FAILED\n')
    } finally {
      this.#resolve()
    }
  }
}
/** The original independent responder owns only receipt counts, pending timers and physical drain. */
class ReferenceResponder {
  /** Connection retains its actual framed byte source. */
  readonly #reader: FrameReader
  /** The only native writer is supplied by the caller. */
  readonly #destination: Writable
  /** Canonical hello binds every source/task before any business action. */
  #remote!: IRecord
  /** Only actually accepted echo notifications increment this original counter. */
  #oneWayCount = 0
  /** Original pending wait ownership remains one id-indexed map. */
  readonly #pending = new Map<string, ReferencePending>()
  /** Drain fences new work while the original reader can still accept cancel. */
  #closing = false
  /** A received final close suppresses a close echo and retires local waits immediately. */
  #closeReceived = false
  /** The admitted drain or close graph survives unchanged until native teardown. */
  #closeReason: IRecord | undefined
  /** Original bounded drain deadline races the native reader. */
  #drain: Promise<void> | undefined
  /** Exactly the actual drain timer is cancelled at loop retirement. */
  #drainTimer: NodeJS.Timeout | undefined
  constructor(source: Readable, destination: Writable) {
    this.#reader = new FrameReader(source)
    this.#destination = destination
  }
  /** Full admitted source/task equality precedes provider execution and cancellation. */
  #admit(value: IRecord): boolean {
    const routing = value.route as IRecord
    const remote = (this.#remote.directory as IRecord).self as IRecord
    if (
      routing.senderId !== remote.instanceId ||
      routing.receiverId !== 'ts-peer' ||
      routing.targetId !== 'ts-peer'
    )
      return false
    const task = value.task as IRecord | undefined
    return (
      !task ||
      (task.callerId === remote.instanceId &&
        sameGeneration(task.callerGeneration as IRecord, remote.generation as IRecord) &&
        sameGeneration(task.targetGeneration as IRecord, REFERENCE_IDENTITY.generation))
    )
  }
  /** Native loop remains responsive while provider waits own their independent completion. */
  async run(): Promise<void> {
    this.#remote = await handshake(this.#reader, this.#destination)
    try {
      while (true) {
        if (this.#closing && this.#pending.size === 0) break
        const value =
          this.#closing && this.#drain
            ? await Promise.race([
                readJson(this.#reader),
                this.#drain.then(() => undefined),
                Promise.all([...this.#pending.values()].map((task) => task.done)).then(
                  () => undefined
                )
              ])
            : await readJson(this.#reader)
        if (value === undefined) break
        let envelope: IRecord
        try {
          envelope = validateFrame(value)
        } catch {
          stderr.write('PEER_ERROR PROTOCOL_INVALID\n')
          continue
        }
        if (!this.#admit(envelope)) continue
        if (envelope.kind === 'control') {
          await this.#control(envelope)
          continue
        }
        if (envelope.kind === 'cancel') {
          const pending = this.#pending.get(String(envelope.id))
          if (pending && sameTask(pending.header.task, envelope.task as IRecord)) {
            if (this.#closing) stderr.write('PEER_EVENT ABORT_DURING_DRAIN\n')
            await pending.finish(false)
          }
          continue
        }
        if (envelope.kind === 'call') await this.#request(envelope)
      }
    } finally {
      if (this.#drainTimer !== undefined) clearTimeout(this.#drainTimer)
      await Promise.all([...this.#pending.values()].map((task) => task.finish(false)))
    }
    if (!this.#closeReceived)
      await writeJson(this.#destination, {
        profile: REFERENCE_PROFILE,
        kind: 'control',
        id: 'close',
        route: route('ts-peer', String((this.#remote.peer as IRecord).id)),
        operation: 'close',
        reason: this.#closeReason ?? wireError('ENDPOINT_DISPOSED')
      })
  }
  /** Health and drain keep the original physical lifecycle; no ACK or capability bridge exists. */
  async #control(value: IRecord): Promise<void> {
    if (value.operation === 'ping')
      await writeJson(this.#destination, {
        profile: REFERENCE_PROFILE,
        kind: 'control',
        id: value.id,
        route: route('ts-peer', String((value.route as IRecord).senderId)),
        operation: 'pong'
      })
    else if (value.operation === 'close') {
      this.#closeReceived = true
      this.#closing = true
      this.#closeReason = value.reason as IRecord | undefined
      await Promise.all([...this.#pending.values()].map((task) => task.finish(false)))
    } else if (value.operation === 'drain' && !this.#closing) {
      this.#closeReason = value.reason as IRecord | undefined
      this.#closing = true
      this.#drain = new Promise((resolve) => {
        this.#drainTimer = setTimeout(resolve, Number((value.route as IRecord).remainingMs ?? 0))
      })
    }
  }
  /** Invoke only advertised original providers; notify refusal never replies or mutates receipts. */
  async #request(value: IRecord): Promise<void> {
    if (this.#closing) return
    const task = value.task as IRecord
    const name = String(task.method)
    const entry = REFERENCE_DESCRIPTION.methods.find((item) => item.name === name)
    const header = { id: String(value.id), route: value.route as IRecord, task }
    const failure = !entry
      ? 'PROVIDER_NOT_FOUND'
      : !entry.supportedModes.includes(String(task.mode))
        ? 'CAPABILITY_UNSUPPORTED'
        : undefined
    if (failure) {
      if (task.mode === 'notify') stderr.write(`PEER_ERROR ${failure}\n`)
      else await writeJson(this.#destination, response(header, undefined, wireError(failure)))
      return
    }
    if (task.mode === 'notify') {
      this.#oneWayCount += 1
      return
    }
    if (name === ReferenceMethod.wait) {
      this.#pending.set(
        header.id,
        new ReferencePending(header, this.#destination, () => {
          this.#pending.delete(header.id)
        })
      )
      return
    }
    if (name === ReferenceMethod.finish) {
      for (const pending of this.#pending.values()) await pending.finish(true)
      await writeJson(this.#destination, response(header))
      return
    }
    if (name === ReferenceMethod.error) {
      await writeJson(this.#destination, response(header, undefined, wireError('INTERNAL')))
      return
    }
    await writeJson(
      this.#destination,
      response(
        header,
        name === ReferenceMethod.receipts
          ? this.#oneWayCount
          : name === ReferenceMethod.trace
            ? (header.route.trace ?? null)
            : (value.payload ?? null)
      )
    )
  }
}
/** Borrow native streams without a second transport, host, codec or receive subscription. */
async function respond(source: Readable, destination: Writable): Promise<void> {
  await new ReferenceResponder(source, destination).run()
}
/** Original native pair success now uses the accepted directory and one canonical task. */
async function initiate(source: Readable, destination: Writable): Promise<void> {
  const reader = new FrameReader(source)
  const accepted = await handshake(reader, destination)
  const target = (accepted.peer as IRecord).id as string
  const self = (accepted.directory as IRecord).self as IRecord
  const task = {
    mode: 'request',
    method: ReferenceMethod.echo,
    callerId: 'ts-peer',
    callerGeneration: REFERENCE_IDENTITY.generation,
    targetGeneration: self.generation
  }
  const sent = { value: 'cross-language-echo' }
  await writeJson(destination, {
    profile: REFERENCE_PROFILE,
    kind: 'call',
    id: 'peer-interop-1',
    route: route('ts-peer', target),
    task,
    options: {},
    payload: sent
  })
  const answer = validateFrame(await readJson(reader))
  if (
    answer.kind !== 'result' ||
    answer.id !== 'peer-interop-1' ||
    !sameTask(answer.task as IRecord, task) ||
    !isRecord(answer.result) ||
    answer.result.value !== sent.value
  )
    throw new PeerFault('INTEROP_FAILED')
  const closing = route('ts-peer', target)
  closing.remainingMs = 0
  await writeJson(destination, {
    profile: REFERENCE_PROFILE,
    kind: 'control',
    id: 'peer-close-1',
    route: closing,
    operation: 'drain'
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
    stderr.write(`PEER_FAIL ${code}\n`)
    process.exitCode = 1
  })
}
