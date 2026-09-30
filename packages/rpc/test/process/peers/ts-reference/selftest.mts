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
  negotiate,
  validateAccept,
  validateHello
} from './peer.mjs'

/** One fixture verdict reported independently, so skipped upstream vectors cannot look green. */
type IVerdict = { passed: number; failed: number; pending: string[]; failures: string[] }

/** Reads repository vectors as inputs, never rewriting the frozen snapshots. */
function vector(directory: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>
}

/** Checks an envelope's first error so 1.0 and 1.1 classify unknown stream differently. */
function envelope(value: unknown, streamKnown: boolean): [string, string] | undefined {
  if (!isRecord(value)) return ['type', '']
  const known = [
    'request',
    'response',
    'discovery',
    'variation',
    ...(streamKnown ? ['stream'] : [])
  ]
  if (!known.includes(String(value.kind))) return ['unknownKind', '/kind']
  if (typeof value.id !== 'string') return ['required', '/id']
  if (!isRecord(value.data) || !isRecord(value.data.route)) return ['required', '/data/route']
  const route = value.data.route
  if (
    route.profile !== 'migaia.rpc.route' ||
    (route.type !== value.kind &&
      !(
        value.kind === 'discovery' &&
        ['discovery-query', 'discovery-response'].includes(String(route.type))
      ))
  )
    return ['route', '/data/route/type']
  return undefined
}

/** Classifies stream event payloads independently of the fixture's expected flag. */
function streamPayload(value: unknown): [string, string] | undefined {
  if (
    !isRecord(value) ||
    !['open', 'item', 'end', 'pull', 'cancel', 'cancelled', 'fail'].includes(String(value.event))
  )
    return ['event', '/event']
  if (!Number.isSafeInteger(value.seq) || Number(value.seq) < 0) return ['field', '/seq']
  if (value.event === 'item' && !Object.hasOwn(value, 'value')) return ['field', '/value']
  return undefined
}

/** Computes codec-independent stream budget units, including conservative number cost. */
function portableBytes(value: unknown): number {
  if (value === null) return 4
  if (typeof value === 'number') return 24
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (Array.isArray(value))
    return (
      2 + Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + portableBytes(item), 0)
    )
  if (isRecord(value))
    return (
      2 +
      Math.max(0, Object.keys(value).length - 1) +
      Object.entries(value).reduce(
        (sum, [key, item]) => sum + portableBytes(key) + 1 + portableBytes(item),
        0
      )
    )
  throw new Error('invalid portable value')
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

/** Validates portable data nesting and bytes marker without using the package under test. */
function validatePortable(value: unknown, depth = 1): void {
  if (depth > 48) throw new WireViolation('dataPortable', '/data')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value === 'string' && !/[\uD800-\uDFFF]/.test(value)) return
  if (Array.isArray(value)) {
    for (const item of value) validatePortable(item, depth + 1)
    return
  }
  if (isRecord(value)) {
    if (Object.hasOwn(value, '$rpc')) {
      if (
        Object.keys(value).sort().join(',') === '$rpc,base64url' &&
        value.$rpc === 'bytes' &&
        typeof value.base64url === 'string' &&
        /^[A-Za-z0-9_-]*$/.test(value.base64url)
      )
        return
      throw new WireViolation('dataPortable', '/data')
    }
    for (const item of Object.values(value)) validatePortable(item, depth + 1)
    return
  }
  throw new WireViolation('dataPortable', '/data')
}

/** A pair of canonical wire-error violation and JSON Pointer. */
class WireViolation extends Error {
  readonly violation: string
  readonly pointer: string

  constructor(violation: string, pointer: string) {
    super(violation)
    this.violation = violation
    this.pointer = pointer
  }
}

/** Checks wire-error graph budgets, traversal order, unknown fields, and portable data. */
function validateWire(
  value: unknown,
  ignoreUnknown = false,
  reports: Array<{ pointer: string; field: string }> = []
): IRecord {
  const fields = new Set([
    'source',
    'code',
    'name',
    'message',
    'stack',
    'cause',
    'errors',
    'data',
    'truncated'
  ])
  let totalBytes = 0
  let nodes = 0
  const visit = (input: unknown, path: string, depth: number): IRecord => {
    if (depth > 48) throw new WireViolation('depth', path)
    nodes += 1
    if (nodes > 1024) throw new WireViolation('nodes', path)
    if (!isRecord(input)) throw new WireViolation('type', path)
    const unknown = Object.keys(input)
      .filter((key) => !fields.has(key))
      .sort()
    if (unknown.length > 0 && !ignoreUnknown) throw new WireViolation('unknownField', path)
    for (const field of unknown) reports.push({ pointer: path, field })
    const clean: IRecord = Object.fromEntries(
      Object.entries(input).filter(([key]) => fields.has(key))
    )
    for (const field of ['source', 'code', 'name', 'message', 'stack']) {
      const item = clean[field]
      if (item === undefined) throw new WireViolation('required', `${path}/${field}`)
      if (typeof item !== 'string' || (field !== 'message' && item.length === 0))
        throw new WireViolation('type', `${path}/${field}`)
      if (/[\uD800-\uDFFF]/.test(item)) throw new WireViolation('surrogate', `${path}/${field}`)
      const amount = Buffer.byteLength(item, 'utf8')
      if (amount > 65_536) throw new WireViolation('stringBytes', `${path}/${field}`)
      totalBytes += amount
      if (totalBytes > 1_048_576) throw new WireViolation('totalBytes', `${path}/${field}`)
    }
    if (clean.truncated !== undefined && clean.truncated !== true)
      throw new WireViolation('truncatedValue', `${path}/truncated`)
    if (clean.data !== undefined) validatePortable(clean.data)
    if (clean.cause !== undefined) clean.cause = visit(clean.cause, `${path}/cause`, depth + 1)
    if (clean.errors !== undefined) {
      if (!Array.isArray(clean.errors)) throw new WireViolation('type', `${path}/errors`)
      if (clean.errors.length === 0) throw new WireViolation('emptyErrors', `${path}/errors`)
      clean.errors = clean.errors.map((child, index) =>
        visit(child, `${path}/errors/${index}`, depth + 2)
      )
    }
    return clean
  }
  return visit(value, '', 1)
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
  } catch {
    verdict.failed += 1
    verdict.failures.push(name)
  }
}

/** Runs the frozen and current fixture rows without using an RPC implementation package. */
function run(directory: string): IVerdict {
  const verdict: IVerdict = { passed: 0, failed: 0, pending: [], failures: [] }
  for (const base of ['frozen/1.0', '']) {
    const prefix = base === '' ? '' : `${base}/`
    const handshake = vector(directory, `${prefix}handshake.json`)
    for (const item of handshake.agreement as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}handshake/agreement/${item.id}`, () => {
        assert.deepEqual(
          negotiate(
            item.initiator as Record<string, unknown>,
            item.responder as Record<string, unknown>
          ),
          item.expected
        )
      })
    }
    for (const item of handshake.invalid as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}handshake/invalid/${item.id}`, () => {
        if (item.value !== undefined) assert.equal(validateHello(item.value), item.violation)
        else
          assert.equal(
            negotiate(
              item.initiator as Record<string, unknown>,
              item.responder as Record<string, unknown>
            ),
            undefined
          )
      })
    }
    for (const item of handshake.mismatch as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}handshake/mismatch/${item.id}`, () => {
        const offer = (handshake.agreement as Array<Record<string, unknown>>)[0]
          .initiator as Record<string, unknown>
        assert.equal(validateAccept(offer, item.accept), false)
      })
    }
    const envelopes = vector(directory, `${prefix}envelope.json`)
    for (const item of envelopes.valid as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}envelope/valid/${item.id}`, () =>
        assert.equal(envelope(item.value, base === ''), undefined)
      )
    }
    for (const item of envelopes.invalid as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}envelope/invalid/${item.id}`, () => {
        assert.deepEqual(envelope(item.value, false), [item.violation, item.pointer])
      })
    }
    const unknown = envelopes.unknownFields as Array<Record<string, unknown>>
    for (const item of unknown) {
      check(verdict, `${prefix}envelope/unknownFields/${item.id}`, () => {
        const value = item.value as Record<string, unknown>
        const route = (value.data as Record<string, unknown>).route as Record<string, unknown>
        const actual = [
          ...Object.keys(value)
            .filter((key) => !['kind', 'id', 'method', 'data'].includes(key))
            .sort()
            .map((key) => ['', key]),
          ...Object.keys(route)
            .filter(
              (key) =>
                ![
                  'profile',
                  'type',
                  'applicationVersion',
                  'senderId',
                  'targetId',
                  'sentAt'
                ].includes(key)
            )
            .sort()
            .map((key) => ['/data/route', key])
        ]
        assert.deepEqual(actual, item.expected)
      })
    }
    for (const item of envelopes.order as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}envelope/order/${item.id}`, () =>
        assert.deepEqual(envelope(item.value, base === ''), [item.violation, item.pointer])
      )
    }
    const control = vector(directory, `${prefix}control.json`)
    for (const item of control.cases as Array<Record<string, unknown>>) {
      check(verdict, `${prefix}control/${item.id}`, () => {
        const action =
          item.variation === 'close' &&
          (!isRecord(item.payload) ||
            !Number.isSafeInteger(item.payload.drainMs) ||
            Number(item.payload.drainMs) < 0)
            ? 'report'
            : ((
                { abort: 'abort', ping: 'ping', pong: 'pong', close: 'close' } as Record<
                  string,
                  string
                >
              )[String(item.variation)] ?? 'warn')
        assert.equal(action, item.action)
      })
    }
  }
  const streams = vector(directory, 'stream.json')
  for (const item of streams.payload as Array<Record<string, unknown>>) {
    check(verdict, `stream/payload/${item.id}`, () => {
      const actual = streamPayload(item.value)
      if (item.valid === true) assert.equal(actual, undefined)
      else assert.deepEqual(actual, [item.violation, item.pointer])
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
    assert.equal(envelope((streams.envelope as Record<string, unknown>).valid, true), undefined)
  )
  check(verdict, 'stream/envelope/reclassified', () => {
    const frozen = vector(directory, 'frozen/1.0/envelope.json')
    const old = (frozen.invalid as Array<Record<string, unknown>>).find(
      (item) => item.id === 'unknown-kind'
    )!
    const expected = (streams.envelope as Record<string, unknown>).reclassified as Record<
      string,
      unknown
    >
    assert.deepEqual(envelope(old.value, true), [expected.violation, expected.pointer])
    assert.deepEqual(envelope(old.value, false), [old.violation, old.pointer])
  })
  check(verdict, 'stream/handshake/compatibility', () => {
    const item = streams.handshake as Record<string, unknown>
    assert.equal(
      Math.min(
        (item.newVersion as Record<string, number>).minor,
        (item.oldVersion as Record<string, number>).minor
      ),
      item.negotiatedMinor
    )
    assert.equal((item.capabilities as string[]).includes('stream@1'), true)
  })
  check(verdict, 'framing/zero-and-limit', () => {
    assert.throws(() => encodeFrame(Buffer.alloc(0)), { code: 'INVALID_FRAME' })
    assert.throws(() => encodeFrame(Buffer.alloc(MAX_FRAME + 1)), { code: 'FRAME_LIMIT_EXCEEDED' })
    const decoder = new FrameDecoder()
    assert.throws(() => decoder.push(Buffer.from([1, 0, 0, 1])), { code: 'FRAME_LIMIT_EXCEEDED' })
    assert.throws(() => new FrameDecoder().push(Buffer.alloc(4)), { code: 'INVALID_FRAME' })
  })
  const wires = vector(directory, 'error-chain.json')
  for (const item of wires.valid as IRecord[]) {
    check(verdict, `wire/valid/${item.id}`, () => {
      validateWire(item.wire ?? generatedWire(item.generate as IRecord))
    })
  }
  for (const item of wires.invalid as IRecord[]) {
    check(verdict, `wire/invalid/${item.id}`, () => {
      assert.throws(
        () => validateWire(item.wire ?? generatedWire(item.generate as IRecord)),
        (error: unknown) =>
          error instanceof WireViolation &&
          error.violation === item.violation &&
          error.pointer === item.pointer
      )
    })
  }
  for (const item of wires.unknownFields as IRecord[]) {
    check(verdict, `wire/unknownFields/${item.id}`, () => {
      const reject = item.reject as IRecord
      assert.throws(
        () => validateWire(item.wire),
        (error: unknown) =>
          error instanceof WireViolation &&
          error.violation === reject.violation &&
          error.pointer === reject.pointer
      )
      const reports: Array<{ pointer: string; field: string }> = []
      assert.deepEqual(validateWire(item.wire, true, reports), item.ignoreExpected)
      assert.deepEqual(reports, item.ignoreReports)
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
        } else throw new Error('unknown truncation vector')
      } else {
        const actual = serializeThrow(item.input)
        assert.deepEqual(actual, item.expected)
        validateWire(actual)
      }
    })
  }
  for (const item of wires.jsonrpc as IRecord[]) {
    check(verdict, `wire/jsonrpc/${item.id}`, () => {
      if (item.generate !== undefined) {
        const spec = item.generate as IRecord
        assert.equal(spec.shape, 'foreignLongMessage')
        assert.equal(spec.expectedStackBytes, 65_536)
      } else {
        const input = item.input as IRecord
        const expected = item.expected as IRecord
        validateWire(expected)
        assert.equal(expected.source, 'jsonrpc-2.0')
        assert.equal(expected.code, String(input.code))
        assert.equal(expected.message, input.message)
      }
    })
  }
  for (const name of ['stream-framing.json', 'remote-host-control.json']) {
    try {
      vector(directory, name)
      verdict.pending.push(`${name}: semantic mapping pending`)
      verdict.failed += 1
      verdict.failures.push(`unmapped/${name}`)
    } catch {
      verdict.pending.push(name)
      verdict.failed += 1
      verdict.failures.push(`missing/${name}`)
    }
  }
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
