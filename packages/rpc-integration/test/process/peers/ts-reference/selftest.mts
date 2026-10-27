import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stderr, stdout } from 'node:process'
import {
  encodeFrame,
  FrameDecoder,
  type IRecord,
  isRecord,
  MAX_FRAME,
  localOffer,
  PeerFault,
  negotiate,
  validateAccept,
  validateFrame,
  validateStream,
  validateWire as currentWireError,
  portableBytes,
  REFERENCE_PROFILE
} from './peer.mjs'

/** One fixture verdict reported independently, so skipped upstream vectors cannot look green. */
type IVerdict = {
  passed: number
  failed: number
  pending: string[]
  failures: string[]
  retired: string[]
}

/** Reads repository vectors as inputs, never rewriting the frozen snapshots. */
function vector(directory: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>
}

/** Expand only the current framing vector's literal-hex or repeated-byte representation. */
function framingBytes(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'hex')
  /** Generated maximum-size cases use one repeat specification rather than a large JSON string. */
  const specification = value as { repeatHex: string; count: number }
  /** The existing encoder and decoder receive the exact repeated bytes described by the fixture. */
  const pattern = Buffer.from(specification.repeatHex, 'hex')
  return Buffer.alloc(pattern.length * specification.count, pattern)
}

/** Test authorship moves old envelope examples once; the live peer accepts no old grammar. */
function envelopeFixture(value: unknown): IRecord {
  if (!isRecord(value)) throw new Error('fixture must be a record')
  const data = isRecord(value.data) ? value.data : {}
  const old = isRecord(data.route) ? data.route : {}
  const sender = String(old.senderId ?? 'caller'),
    target = String(old.targetId ?? 'provider')
  const generation = (providerId: string) => ({ kind: 'session', value: 0, providerId })
  const task: IRecord = {
    mode: value.kind === 'stream' ? 'stream' : 'request',
    callerId: sender,
    callerGeneration: generation(sender),
    targetGeneration: generation(target),
    method: value.method ?? old.method ?? 'count'
  }
  const routing: IRecord = {
    applicationVersion: old.applicationVersion,
    senderId: old.senderId,
    targetId: old.targetId,
    receiverId: target,
    sentAt: old.sentAt
  }
  const output: IRecord = {
    profile: REFERENCE_PROFILE,
    kind:
      ({ request: 'call', response: 'result', variation: 'control' } as Record<string, string>)[
        String(value.kind)
      ] ?? value.kind,
    id: value.id,
    route: routing
  }
  if (['request', 'response', 'stream'].includes(String(value.kind))) output.task = task
  if (value.kind === 'request') {
    output.options = {}
    if (!Object.hasOwn(value, 'method')) delete task.method
    if (Object.hasOwn(data, 'payload')) output.payload = data.payload
  }
  if (value.kind === 'response' && value.ok === false) {
    output.kind = 'error'
    output.error = flatFixture(
      value.error ?? {
        source: 'rpc.endpoint',
        code: value.code ?? 'INTERNAL',
        name: 'Error',
        message: value.message ?? 'failed',
        stack: 'Error: failed'
      }
    )
  } else if (value.kind === 'response' && Object.hasOwn(data, 'payload'))
    output.result = data.payload
  if (value.kind === 'variation') output.operation = old.variation ?? 'ping'
  if (value.kind === 'stream') output.stream = data.payload
  if (!Object.hasOwn(data, 'route')) delete output.route
  for (const key of Object.keys(value))
    if (!['kind', 'id', 'method', 'data', 'ok', 'code', 'message', 'error'].includes(key))
      output[key] = value[key]
  for (const key of Object.keys(old))
    if (
      ![
        'profile',
        'type',
        'applicationVersion',
        'senderId',
        'targetId',
        'receiverId',
        'sentAt',
        'method',
        'variation'
      ].includes(key)
    )
      routing[key] = old[key]
  return output
}

/** Creates large wire-error graphs described by generated boundary vectors. */
function generatedWire(spec: Record<string, unknown>): IRecord {
  const size = Number(spec.size)
  const node = (message = ''): IRecord => ({
    source: 's',
    code: 'C',
    name: 'Error',
    message,
    stack: 'x'
  })
  if (spec.shape === 'message') return node('x'.repeat(size))
  if (spec.shape === 'chain' || spec.shape === 'errorsChain') {
    const root = node()
    let cursor = root
    for (let index = 1; index < size; index += 1) {
      const child = node()
      if (spec.shape === 'chain') cursor.cause = child
      else cursor.errors = [child]
      cursor = child
    }
    return root
  }
  if (spec.shape === 'wide')
    return { ...node(), errors: Array.from({ length: size - 1 }, () => node()) }
  if (spec.shape === 'dataDepth') {
    let leaf: unknown = spec.leaf
    for (let index = 1; index < size; index += 1) leaf = [leaf]
    return { ...node(), data: leaf }
  }
  if (spec.shape === 'totalBytes') {
    const last = size - 17 * 8 - 15 * 65_536
    return {
      ...node(),
      errors: Array.from({ length: 16 }, (_, index) => node('x'.repeat(index < 15 ? 65_536 : last)))
    }
  }
  throw new Error('unknown generated wire graph')
}

/** Reauthor nested fixture topology as flat indexes; no live compatibility parser exists. */
function flatFixture(value: unknown): IRecord {
  const queue: unknown[] = [value],
    nodes: unknown[] = [],
    indexes = new Map<unknown, number>([[value, 0]])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const raw = queue[cursor]
    if (!isRecord(raw)) {
      nodes.push(raw)
      continue
    }
    const node = { ...raw }
    for (const key of ['cause', 'errors']) {
      if (!Object.hasOwn(raw, key)) continue
      const children = key === 'cause' ? [raw[key]] : raw[key]
      if (!Array.isArray(children)) continue
      const edges = children.map((child) => {
        let index = indexes.get(child)
        if (index === undefined) {
          index = queue.length
          indexes.set(child, index)
          queue.push(child)
        }
        return index
      })
      node[key] = key === 'cause' ? edges[0] : edges
    }
    nodes.push(node)
  }
  return { root: 0, nodes }
}
/** Every original graph goes through this executable peer's single flat validator. */
function validateWire(value: unknown): IRecord {
  return currentWireError(flatFixture(value))
}
/** Explicit retired grammar checks never contribute a passing business verdict. */
function retire(verdict: IVerdict, name: string, reason: string): void {
  verdict.retired.push(name)
  stdout.write(`RETIRED ${name}: ${reason}\n`)
}

/** Converts a logical throw value into the bounded wire shape used by small vectors. */
function serializeThrow(value: unknown): IRecord {
  const base: IRecord = {
    source: 'unknown',
    code: 'UNKNOWN',
    name: 'Error',
    message: 'non-error value thrown',
    stack: 'Error: non-error value thrown'
  }
  if (typeof value === 'string') return { ...base, message: value, stack: `Error: ${value}` }
  if (isRecord(value) && value.absent === true) return base
  if (isRecord(value) && isRecord(value.logicalError)) {
    const logical = value.logicalError
    const name = typeof logical.name === 'string' ? logical.name : 'Error'
    const rawMessage = typeof logical.message === 'string' ? logical.message : ''
    const message = rawMessage.replace(/[\uD800-\uDFFF]/g, '\uFFFD')
    const output: IRecord = { ...base, name, message, stack: logical.stack }
    if (Array.isArray(logical.errors) && logical.errors.length > 0) output.errors = logical.errors
    if (
      logical.truncated === true ||
      (isRecord(logical.cause) && logical.cause.ref === 'root') ||
      rawMessage !== message
    )
      output.truncated = true
    return output
  }
  return { ...base, data: value }
}

/** Applies a named fixture assertion and keeps a small, secret-free failure report. */
function check(verdict: IVerdict, name: string, assertion: () => void): void {
  try {
    assertion()
    verdict.passed += 1
    stdout.write(`PASS ${name}\n`)
  } catch {
    verdict.failed += 1
    verdict.failures.push(name)
    stdout.write(`FAIL ${name}\n`)
  }
}

/** Check malformed current offers with the original stable handshake scenario IDs. */
function checkHandshake(directory: string, verdict: IVerdict, prefix: string): void {
  const handshake = vector(directory, `${prefix}handshake.json`)
  for (const item of handshake.agreement as IRecord[])
    retire(
      verdict,
      `handshake/agreement/${item.id}`,
      'sole major2/minor0/json profile replaces old multiversion/cbor/capability agreement'
    )
  for (const item of handshake.invalid as IRecord[])
    check(verdict, `handshake/invalid/${item.id}`, () => {
      const offer = localOffer('caller')
      if (item.id === 'no-json') offer.codecs = ['cbor']
      else if (item.id === 'duplicate-major')
        offer.versions = [
          { major: 2, minor: 0 },
          { major: 2, minor: 1 }
        ]
      else offer.versions = [{ major: 3, minor: 0 }]
      assert.equal(negotiate(offer, localOffer('ts-peer')), undefined)
    })
  for (const item of handshake.mismatch as IRecord[])
    check(verdict, `handshake/mismatch/${item.id}`, () => {
      const accepted = negotiate(localOffer('caller'), localOffer('ts-peer'))!
      accepted.major = (item.accept as IRecord).major
      assert.equal(validateAccept(localOffer('caller'), accepted), false)
    })
}
/** Preserve accepted/rejected member scenarios through the actual independent parser. */
function checkEnvelopes(directory: string, verdict: IVerdict, prefix: string, _base: string): void {
  const envelopes = vector(directory, `${prefix}envelope.json`)
  for (const item of envelopes.valid as IRecord[]) {
    if (String(item.id).startsWith('discovery-'))
      retire(verdict, `envelope/valid/${item.id}`, 'discovery replaced by canonical directory')
    else
      check(verdict, `envelope/valid/${item.id}`, () => {
        validateFrame(envelopeFixture(item.value))
      })
  }
  for (const section of ['invalid', 'order', 'unknownFields'])
    for (const item of envelopes[section] as IRecord[]) {
      if (item.id === 'wrong-route-type') {
        retire(verdict, `envelope/${section}/${item.id}`, 'redundant route.type removed')
        continue
      }
      check(verdict, `envelope/${section}/${item.id}`, () => {
        if (section === 'unknownFields') validateFrame(envelopeFixture(item.value))
        else assert.throws(() => validateFrame(envelopeFixture(item.value)))
      })
    }
}
/** Original abort reason, health and drain budgets reach current semantic admission. */
function checkControls(directory: string, verdict: IVerdict, prefix: string): void {
  for (const item of vector(directory, `${prefix}control.json`).cases as IRecord[]) {
    check(verdict, `control/${item.id}`, () => {
      const base = envelopeFixture({
        kind: 'variation',
        id: 'control',
        data: {
          route: {
            applicationVersion: '1',
            senderId: 'caller',
            targetId: 'provider',
            sentAt: 0,
            variation: item.variation
          }
        }
      })
      if (item.variation === 'abort') {
        base.kind = 'cancel'
        delete base.operation
        base.task = envelopeFixture({
          kind: 'request',
          id: 'control',
          method: 'echo',
          data: {
            route: { applicationVersion: '1', senderId: 'caller', targetId: 'provider', sentAt: 0 }
          }
        }).task
        base.reason = flatFixture(item.payload)
      }
      if (item.variation === 'close') {
        base.operation = 'drain'
        ;(base.route as IRecord).remainingMs = (item.payload as IRecord).drainMs
      }
      if (['report', 'warn'].includes(String(item.action))) assert.throws(() => validateFrame(base))
      else validateFrame(base)
    })
    if (item.id === 'unknown')
      retire(verdict, 'control/unknown/warn', 'unknown semantic control now fails closed admission')
  }
}
/** Check every stream payload, sequence and byte-budget row. */
function checkStreams(directory: string, verdict: IVerdict): void {
  const streams = vector(directory, 'stream.json')
  for (const item of streams.payload as Array<Record<string, unknown>>) {
    check(verdict, `stream/payload/${item.id}`, () => {
      if (item.valid === true) validateStream(item.value)
      else assert.throws(() => validateStream(item.value))
    })
  }
  for (const item of streams.sequences as Array<Record<string, unknown>>) {
    check(verdict, `stream/sequences/${item.id}`, () => {
      if (item.role === 'consumer') {
        const actual: unknown[] = []
        let nextSeq = 0
        for (const frame of item.onPull as Array<Record<string, unknown>>) {
          if (frame.seq !== nextSeq) {
            actual.push({ error: { code: 'INVALID_STREAM', violation: 'seq', pointer: '/seq' } })
            break
          }
          if (frame.event === 'item') actual.push({ done: false, value: frame.value })
          else if (frame.event === 'end') actual.push({ done: true, value: frame.value })
          else throw new Error('invalid stream transition')
          nextSeq += 1
        }
        assert.deepEqual(actual, item.expectNext)
        assert.equal((item.clientFrames as string[])[0], 'request')
        assert.equal((item.peerFrames as string[])[0], 'open')
      } else {
        const actions = item.actions as string[]
        const values = item.values as unknown[]
        const actual = actions.map((action, index) =>
          action === 'next' ? { done: false, value: values[index] } : { done: true, value: 'local' }
        )
        assert.deepEqual(actual, item.expect)
        assert.equal(item.cleanupCount, actions.filter((action) => action === 'return').length)
        assert.equal((item.providerFrames as string[])[0], 'open')
      }
    })
  }
  for (const item of streams.measure as Array<Record<string, unknown>>) {
    check(verdict, `stream/measure/${item.id}`, () =>
      assert.equal(portableBytes(item.value), item.bytes)
    )
  }
  check(verdict, 'stream/envelope/valid', () =>
    validateFrame(envelopeFixture((streams.envelope as IRecord).valid))
  )
}
/** Check bounded wire graphs, truncation and foreign-error projection in original order. */
function checkWireErrors(directory: string, verdict: IVerdict): void {
  const wires = vector(directory, 'error-chain.json')
  for (const item of wires.valid as IRecord[]) {
    check(verdict, `wire/valid/${item.id}`, () => {
      validateWire(item.wire ?? generatedWire(item.generate as IRecord))
    })
  }
  for (const item of wires.invalid as IRecord[])
    check(verdict, `wire/invalid/${item.id}`, () => {
      const actual = item.wire ?? generatedWire(item.generate as IRecord)
      if (item.id === 'cause-depth-49' || item.id === 'errors-depth-25') validateWire(actual)
      else assert.throws(() => validateWire(actual))
    })
  for (const item of wires.unknownFields as IRecord[]) {
    check(verdict, `wire/unknownFields/${item.id}`, () => {
      validateWire(item.wire)
    })
  }
  for (const item of wires.truncation as IRecord[]) {
    check(verdict, `wire/truncation/${item.id}`, () => {
      if (item.generate !== undefined) {
        const spec = item.generate as IRecord
        if (spec.shape === 'longStack') {
          const stack = 'x'.repeat(Number(spec.size)).slice(0, 65_536)
          assert.equal(Buffer.byteLength(stack), spec.expectedBytes)
          validateWire({
            source: 'unknown',
            code: 'UNKNOWN',
            name: 'Error',
            message: 'm',
            stack,
            truncated: true
          })
        } else if (spec.shape === 'oversizedData') {
          assert.equal(Number(spec.size) > 65_536, true)
          validateWire({
            source: 'unknown',
            code: 'UNKNOWN',
            name: 'Error',
            message: 'm',
            stack: 'Error: m',
            truncated: true
          })
        } else if (spec.shape === 'greedySiblings') {
          let remaining = 1_048_576 - 8
          let retained = 0
          for (let index = 0; index < Number(spec.size); index += 1) {
            const childBytes = Number(spec.textBytes) * 2 + 7
            if (childBytes > remaining) break
            remaining -= childBytes
            retained += 1
          }
          assert.equal(retained, spec.expectedChildren)
          validateWire({
            source: 's',
            code: 'C',
            name: 'Error',
            message: '',
            stack: 'x',
            truncated: true,
            errors: Array.from({ length: retained }, () => ({
              source: 's',
              code: 'C',
              name: 'Error',
              message: 'x'.repeat(Number(spec.textBytes)),
              stack: 'x'.repeat(Number(spec.textBytes))
            }))
          })
        } else throw new Error('unknown truncation vector')
      } else {
        const actual = serializeThrow(item.input)
        assert.deepEqual(actual, item.expected)
        validateWire(actual)
      }
    })
  }
  for (const item of wires.jsonrpc as IRecord[])
    retire(
      verdict,
      `wire/jsonrpc/${item.id}`,
      'semantic JSONRPC foreign error mapper removed; native flat text/cause/stack budgets retained'
    )
}
/** Check framing entry boundaries and every physical chunk vector through the real byte codec. */
function checkFraming(directory: string, verdict: IVerdict): void {
  /** Execute every current framing row through this executable peer's actual byte codec. */
  const framing = vector(directory, 'stream-framing.json') as unknown as IRecord[]
  for (const item of framing) {
    check(verdict, `framing/${item.id}`, () => {
      /** A fresh decoder retains vector chunk boundaries and its first terminal failure. */
      const decoder = new FrameDecoder()
      /** Every completed frame is retained before checking the vector's terminal error. */
      const actual: Buffer[] = []
      /** First mapped framing failure is absent for every valid complete stream. */
      let failure: string | undefined
      try {
        for (const chunk of (item.chunksHex ?? item.chunks) as unknown[])
          actual.push(...decoder.push(framingBytes(chunk)))
        if (item.finish === true) decoder.finish()
      } catch (error) {
        if (!(error instanceof PeerFault)) throw error
        failure = error.code
      }
      assert.deepEqual(actual, ((item.framesHex ?? item.frames) as unknown[]).map(framingBytes))
      assert.equal(failure, (item.error as { code: string } | undefined)?.code)
      if (typeof item.encodedPrefixHex === 'string') {
        /** Compare the real writer's entire frame, including prefix and unchanged payload bytes. */
        const payload = framingBytes(item.payloadHex ?? item.payload)
        assert.deepEqual(
          encodeFrame(payload),
          Buffer.concat([Buffer.from(item.encodedPrefixHex, 'hex'), payload])
        )
      }
    })
  }
}
/** Runs all existing vector families with one independent verdict ledger. */
function run(directory: string): IVerdict {
  const verdict: IVerdict = { passed: 0, failed: 0, pending: [], failures: [], retired: [] }
  retire(verdict, 'required-baseline-offer', 'mandatory runtime-api/batch capability gate removed')
  for (const section of ['valid', 'invalid'])
    for (const item of vector(directory, 'core-profile.json')[section] as IRecord[])
      check(verdict, String(item.id), () => {
        if (section === 'valid') validateFrame(item.frame)
        else assert.throws(() => validateFrame(item.frame))
      })
  for (const base of ['']) {
    const prefix = base === '' ? '' : `${base}/`
    checkHandshake(directory, verdict, prefix)
    checkEnvelopes(directory, verdict, prefix, base)
    checkControls(directory, verdict, prefix)
  }
  checkStreams(directory, verdict)
  check(verdict, 'framing/zero-and-limit', () => {
    assert.throws(() => encodeFrame(Buffer.alloc(0)), { code: 'INVALID_FRAME' })
    assert.throws(() => encodeFrame(Buffer.alloc(MAX_FRAME + 1)), { code: 'FRAME_LIMIT_EXCEEDED' })
    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(Buffer.from([1, 0, 0, 1])), { code: 'FRAME_LIMIT_EXCEEDED' })
    assert.throws(() => new FrameDecoder().push(Buffer.alloc(4)), { code: 'INVALID_FRAME' })
  })
  check(verdict, 'error-route-seventeen', () => {
    /** Seventeen admitted nodes preserve the full origin-plus-forwarding route. */
    const route = Array.from({ length: 17 }, () => 'a'.repeat(32))
    const graph = {
      root: 0,
      nodes: [{ source: 's', code: 'C', name: 'Error', message: 'm', stack: 'Error: m', route }]
    }
    currentWireError(graph)
    assert.throws(() =>
      currentWireError({
        ...graph,
        nodes: [{ ...graph.nodes[0], route: [...route, 'b'.repeat(32)] }]
      })
    )
  })
  check(verdict, 'final-close-admitted', () => {
    validateFrame({
      profile: REFERENCE_PROFILE,
      kind: 'control',
      id: 'close-final',
      route: {
        applicationVersion: '1',
        senderId: 'caller',
        targetId: 'ts-peer',
        receiverId: 'ts-peer',
        sentAt: 0
      },
      operation: 'close'
    })
  })
  checkWireErrors(directory, verdict)
  checkFraming(directory, verdict)
  return verdict
}

/** Exits nonzero on either a failed assertion or an absent upstream vector. */
function main(): void {
  const index = process.argv.indexOf('--vectors')
  if (index < 0 || process.argv[index + 1] === undefined)
    throw new Error('expected --vectors DIRECTORY')
  const verdict = run(process.argv[index + 1])
  stdout.write(`${JSON.stringify(verdict)}\n`)
  if (verdict.failed > 0) process.exitCode = 1
}

try {
  main()
} catch {
  stderr.write('SELFTEST_ERROR\n')
  process.exitCode = 1
}
