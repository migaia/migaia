import { describe, expect, it } from 'vitest'
import {
  attachErrorIdentity,
  deserializeErrorChain,
  type IErrorChainStrategy,
  normalizeSerializedErrorChain,
  reachErrorChain,
  sanitizeErrorText,
  serializeErrorChain
} from '../src/error.js'

/** RPC's existing limits are copied as oracle data; utils has no RPC dependency. */
const oracleStrategy: IErrorChainStrategy = {
  limits: {
    maxNesting: 48,
    maxNodes: 1024,
    maxBytes: 1_048_576,
    maxStringBytes: 65_536,
    maxObjects: 4096
  }
}

/** Minimal remote record copied from rpc-core/test/error-format/deserializer.test.ts. */
function wire(name = 'Error'): {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: unknown
  errors?: unknown[]
  truncated?: boolean
} {
  return {
    source: 'remote',
    code: 'REMOTE',
    name,
    message: 'message',
    stack: `${name}: remote stack`
  }
}

/** Count the copied serializer oracle's cause path without native-class assumptions. */
function chainLength(root: { readonly cause?: unknown }): number {
  /** The cursor follows only cause; aggregate paths have their own nesting cost. */
  let current: unknown = root
  /** The copied oracle counts the root as the first node. */
  let count = 0
  while (current && typeof current === 'object') {
    count += 1
    current = (current as { readonly cause?: unknown }).cause
  }
  return count
}

describe('generic error-chain capability', () => {
  it('keeps cause, ordered aggregate children, and cleanup children distinct', () => {
    /** Fixed graph data copied from the RPC serializer oracle. */
    const primary = new Error('root', { cause: new TypeError('cause') }) as Error & {
      errors?: Error[]
      cleanupErrors?: { resource: string; error: Error }[]
    }
    primary.errors = [new RangeError('a'), new SyntaxError('b')]
    primary.cleanupErrors = [{ resource: 'r', error: new Error('cleanup') }]
    /** Projection must own its immutable child lists. */
    const projected = serializeErrorChain(primary, oracleStrategy)
    expect(projected.cause?.message).toBe('cause')
    expect(projected.errors?.map((child) => child.message)).toEqual(['a', 'b', 'cleanup'])
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(projected.errors)).toBe(true)
    expect(Object.isFrozen(projected.errors?.[0])).toBe(true)
    expect(normalizeSerializedErrorChain(projected, oracleStrategy)).toEqual(projected)
    expect(structuredClone(projected)).toEqual(projected)
  })

  it('keeps JSON field order and remote identity bytes through native restoration', () => {
    /** Remote fixtures are copied, never obtained by invoking the RPC package. */
    const original = wire('AggregateError')
    original.cause = wire('TypeError')
    original.errors = [wire('RangeError')]
    /** Native restoration must preserve all five presentation fields at every node. */
    const restored = deserializeErrorChain(original, oracleStrategy)
    expect(JSON.stringify(serializeErrorChain(restored, oracleStrategy))).toBe(
      JSON.stringify(original)
    )
    expect(restored.stack).toBe('AggregateError: remote stack')
    expect((restored.cause as Error).stack).toBe('TypeError: remote stack')
    expect((restored as AggregateError).errors[0].stack).toBe('RangeError: remote stack')
  })

  it('omits cycles while duplicating a shared subtree at its distinct edges', () => {
    /** A self-edge is omitted rather than emitted as a non-JSON reference. */
    const cyclic = new Error('cycle') as Error & { cause?: unknown }
    cyclic.cause = cyclic
    /** These are the copied cycle assertions from RPC's serializer oracle. */
    const projectedCycle = serializeErrorChain(cyclic, oracleStrategy)
    expect(projectedCycle.cause).toBeUndefined()
    expect(projectedCycle.truncated).toBe(true)
    /** Shared objects are legal on different ancestor paths. */
    const shared = new Error('shared')
    /** The same original child is reachable both as cause and as an aggregate entry. */
    const primary = new Error('root', { cause: shared }) as Error & { errors?: Error[] }
    primary.errors = [shared]
    /** Each edge gets a fresh record while preserving identical child content. */
    const projected = serializeErrorChain(primary, oracleStrategy)
    expect(projected.cause).toEqual(projected.errors?.[0])
    expect(projected.cause).not.toBe(projected.errors?.[0])
  })

  it('keeps the copied cause, aggregate nesting, and node-count limits', () => {
    /** Sixty cause nodes exercise the oracle's 48-level JSON limit. */
    let cause: Error = new Error('last')
    for (let index = 0; index < 59; index += 1) cause = new Error('next', { cause })
    /** Serialization counts cause edges as one JSON level. */
    const projectedCause = serializeErrorChain(cause, oracleStrategy)
    expect(chainLength(projectedCause)).toBe(48)
    /** Follow the retained prefix to its truncation marker. */
    let terminal = projectedCause
    while (terminal.cause) terminal = terminal.cause
    expect(terminal.truncated).toBe(true)
    /** The copied 32-node errors path consumes two JSON levels per edge. */
    let aggregate: Error = new Error('last')
    for (let index = 0; index < 31; index += 1) {
      /** Each parent preserves the same single-child path shape as the RPC oracle. */
      const parent = new Error('next') as Error & { errors?: Error[] }
      parent.errors = [aggregate]
      aggregate = parent
    }
    /** Count retained aggregate nodes independently from cause edges. */
    let projectedAggregate = serializeErrorChain(aggregate, oracleStrategy)
    /** The root contributes the first retained node. */
    let count = 1
    while (projectedAggregate.errors) {
      count += 1
      projectedAggregate = projectedAggregate.errors[0]!
    }
    expect(count).toBe(24)
    expect(projectedAggregate.truncated).toBe(true)
    expect(Object.hasOwn(projectedAggregate, 'errors')).toBe(false)
    /** Fixed one-byte stacks isolate the node-count limit from text budgets. */
    const wide = new Error('wide') as Error & { errors?: Error[] }
    wide.errors = Array.from({ length: 1100 }, (_, index) => {
      /** Each child consumes one occurrence in the output tree. */
      const child = new Error(String(index))
      child.stack = 'x'
      return child
    })
    /** The root plus 1023 children exhausts the copied 1024-node budget. */
    const projectedWide = serializeErrorChain(wide, oracleStrategy)
    expect(projectedWide.errors).toHaveLength(1023)
    expect(projectedWide.truncated).toBe(true)
  })

  it('truncates text only on scalar boundaries and replaces lone surrogates', () => {
    /** Fixed astral text copied from RPC's serializer budget oracle. */
    const original = new Error('long')
    original.stack = '😀'.repeat(20_000)
    /** A two-code-unit scalar must fit wholly within the UTF-8 byte budget. */
    const projected = serializeErrorChain(original, oracleStrategy)
    expect(new TextEncoder().encode(projected.stack).length).toBe(65_536)
    expect(projected.truncated).toBe(true)
    expect(projected.stack.endsWith('😀')).toBe(true)
    expect(sanitizeErrorText('\ud800x\udc00', 65_536)).toEqual({
      value: '\ufffdx\ufffd',
      bytes: 7,
      changed: true
    })
    expect(sanitizeErrorText('😀😀', 5)).toEqual({ value: '😀', bytes: 4, changed: true })
  })

  it('restores native classes and remote stacks without replacing identity descriptors', () => {
    for (const [name, constructor] of [
      ['TypeError', TypeError],
      ['RangeError', RangeError],
      ['SyntaxError', SyntaxError],
      ['ReferenceError', ReferenceError],
      ['URIError', URIError],
      ['EvalError', EvalError],
      ['AggregateError', AggregateError]
    ] as const) {
      /** Native-class fixtures and exact stacks are copied from the RPC deserializer oracle. */
      const restored = deserializeErrorChain(wire(name))
      expect(restored, name).toBeInstanceOf(constructor)
      expect(restored.stack).toBe(`${name}: remote stack`)
      expect(restored).toMatchObject({ source: 'remote', code: 'REMOTE' })
      expect(Object.getOwnPropertyDescriptor(restored, 'source')).toMatchObject({
        enumerable: true,
        writable: false,
        configurable: false
      })
      expect(Object.getOwnPropertyDescriptor(restored, 'code')).toMatchObject({
        enumerable: true,
        writable: false,
        configurable: false
      })
    }
    /** Supported hosts restore cancellation with the native DOMException class. */
    const abort = deserializeErrorChain(wire('AbortError'))
    expect(abort).toBeInstanceOf(DOMException)
    expect(abort.name).toBe('AbortError')
    expect(abort.stack).toBe('AbortError: remote stack')
    /** Unknown names keep their presentation while using the generic native Error. */
    const foreign = deserializeErrorChain(wire('ForeignError'))
    expect(foreign).toBeInstanceOf(Error)
    expect(foreign.name).toBe('ForeignError')
  })

  it('reaches original cause and cleanup identities beyond serialization depth', () => {
    /** Fixed 61-node cause chain copied from RPC's reachability oracle. */
    let deep: Error = new Error('last')
    /** Save the exact original for identity assertions after traversal. */
    const last = deep
    for (let index = 0; index < 60; index += 1) deep = new Error('next', { cause: deep })
    /** Cleanup errors share the canonical errors graph rather than a separate walker. */
    const root = deep as Error & { cleanupErrors?: { error: Error }[] }
    /** The caller retains the exact cleanup error after local traversal. */
    const cleanup = new Error('cleanup')
    root.cleanupErrors = [{ error: cleanup }]
    /** Reachability has a separate object limit and does not truncate at wire depth. */
    const reached = [...reachErrorChain(root, oracleStrategy)]
    expect(reached).toHaveLength(62)
    expect(reached).toContain(last)
    expect(reached).toContain(cleanup)
    /** A repeated original is yielded once even when aggregate and cause paths share it. */
    const aggregate = new AggregateError([root, cleanup], 'aggregate', { cause: root })
    expect([...reachErrorChain(aggregate, oracleStrategy)]).toEqual([aggregate, ...reached])
  })

  it('rejects prototype fields and preserves malformed input or getter failures as cause', () => {
    /** An inherited required stack must never satisfy the owned record contract. */
    const inherited = Object.assign(Object.create({ stack: 'inherited secret' }), {
      source: 'remote',
      code: 'REMOTE',
      name: 'Error',
      message: 'message'
    }) as Record<string, unknown>
    expect(() => normalizeSerializedErrorChain(inherited)).toThrow(
      expect.objectContaining({ violation: 'required', pointer: '/stack', cause: inherited })
    )
    /** JSON creates an own prototype-looking key rather than changing a live prototype. */
    const polluted = JSON.parse(
      '{"source":"remote","code":"REMOTE","name":"Error","message":"message","stack":"Error: remote stack","__proto__":{"polluted":true}}'
    ) as unknown
    expect(() => normalizeSerializedErrorChain(polluted)).toThrow(
      expect.objectContaining({ violation: 'unknownField', cause: polluted })
    )
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    /** Absent extensions must never restore inherited prototype properties as admitted data. */
    const restored = deserializeErrorChain(wire(), {
      extensions: [{ field: '__proto__', normalize: () => ({ value: null, bytes: 0 }) }]
    })
    expect(Object.hasOwn(restored, '__proto__')).toBe(false)
    /** Malformed cause data is copied from the RPC deserializer oracle. */
    const missing = wire()
    missing.cause = { source: 's', code: 'C', name: 'Error', message: 'm' }
    expect(() => deserializeErrorChain(missing)).toThrow(
      expect.objectContaining({ violation: 'required', pointer: '/cause/stack', cause: missing })
    )
    /** A trapped property read must retain its exact thrown value. */
    const failure = new Error('getter')
    /** The hostile cause fixture is copied from the same deserializer oracle. */
    const hostile = {
      ...wire(),
      get cause(): never {
        throw failure
      }
    }
    expect(() => normalizeSerializedErrorChain(hostile)).toThrow(
      expect.objectContaining({ violation: 'read', pointer: '/cause', cause: failure })
    )
  })

  it('keeps conservative default data and unknown-field handling caller-visible', () => {
    /** Extra error properties are outside the default presentation allow-list. */
    const original = new Error('public') as Error & { token?: string; data?: unknown }
    original.token = 'TOKEN'
    expect(JSON.stringify(serializeErrorChain(original))).not.toContain('TOKEN')
    original.data = () => 'TOKEN'
    expect(() => serializeErrorChain(original)).toThrow(
      expect.objectContaining({ pointer: '/data', violation: 'dataPortable' })
    )
    /** A caller explicitly opting into reporting may retain a safe truncated projection. */
    const reports: unknown[] = []
    /** Unsupported data is omitted after its original failure reaches the caller. */
    const projected = serializeErrorChain(original, undefined, {
      report: (event) => reports.push(event)
    })
    expect(projected.data).toBeUndefined()
    expect(projected.truncated).toBe(true)
    expect(reports).toHaveLength(1)
    /** Unknown fields are rejected before their secret-bearing getter runs. */
    let reads = 0
    /** An unknown incoming field cannot enter the default restored error. */
    const incoming = {
      ...wire(),
      get token(): string {
        reads += 1
        return 'TOKEN'
      }
    }
    expect(() => normalizeSerializedErrorChain(incoming)).toThrow(
      expect.objectContaining({ violation: 'unknownField', cause: incoming })
    )
    expect(reads).toBe(0)
    expect(normalizeSerializedErrorChain(incoming, undefined, { unknownFields: 'ignore' })).toEqual(
      wire()
    )
    expect(reads).toBe(0)
  })

  it('uses the field whitelist for both optional reads and unknown-field handling', () => {
    /** This boundary deliberately admits only the five mandatory diagnostic fields. */
    const strategy: IErrorChainStrategy = {
      fields: ['source', 'code', 'name', 'message', 'stack']
    }
    /** A hidden data getter must never run when data is outside the admitted field set. */
    let reads = 0
    /** The error-like fixture keeps deterministic text while exposing a secret-bearing getter. */
    const original = {
      ...wire(),
      get data(): never {
        reads += 1
        throw new Error('private data')
      },
      cause: wire('TypeError')
    }
    expect(serializeErrorChain(original, strategy)).toEqual(wire())
    expect(reads).toBe(0)
    expect(normalizeSerializedErrorChain(original, strategy, { unknownFields: 'ignore' })).toEqual(
      wire()
    )
    expect(reads).toBe(0)
  })

  it('applies caller redaction to text and leaves exact-object privacy to the strategy', () => {
    /** The explicit data field contains the same secret in keys and values. */
    const original = new Error('TOKEN message') as Error & { data?: unknown }
    original.stack = 'Error: TOKEN stack'
    original.data = { TOKEN: 'TOKEN data' }
    /** Redaction is consumer policy; the generic core supplies scalar-safe limits afterward. */
    const strategy: IErrorChainStrategy = {
      sanitizeText: (value, truncate) => {
        /** Replace only the caller's known sensitive token. */
        const redacted = value.replaceAll('TOKEN', '[redacted]')
        /** Preserve scalar-safe byte accounting and signal text changes to the projection. */
        const text = sanitizeErrorText(redacted, 4096, truncate)
        return { ...text, changed: text.changed || redacted !== value }
      }
    }
    /** Every serialized text position, including data keys, uses the same redaction hook. */
    const projected = serializeErrorChain(original, strategy)
    expect(projected.message).toBe('[redacted] message')
    expect(projected.stack).toBe('Error: [redacted] stack')
    expect(projected.data).toEqual({ '[redacted]': '[redacted] data' })
    expect(projected.truncated).toBe(true)
    expect(JSON.stringify(projected)).not.toContain('TOKEN')
    /** Exact local ownership can hide descendants while keeping a fixed public summary. */
    const privateRoot = new Error('public', { cause: new Error('TOKEN') }) as Error & {
      data?: unknown
    }
    privateRoot.data = { secret: 'TOKEN' }
    /** Only the exact local error receives this privacy decision. */
    const summarized = serializeErrorChain(privateRoot, {
      presentation: (input) =>
        input === privateRoot ? { code: 'SAFE', message: 'public summary' } : undefined
    })
    expect(summarized.message).toBe('public summary')
    expect(summarized.code).toBe('SAFE')
    expect(summarized.cause).toBeUndefined()
    expect(summarized.data).toBeUndefined()
    expect(JSON.stringify(summarized)).not.toContain('TOKEN')
    expect(privateRoot.cause).toBeInstanceOf(Error)
  })

  it('lets the consumer restore native identity without regenerating the remote stack', () => {
    /** This exact native instance proves restoration hooks do not replace the caller's object. */
    const target = new TypeError('consumer-created')
    /** The strategy owns native class construction and diagnostic identity attachment. */
    const strategy: IErrorChainStrategy = {
      createError: (value, children) => {
        expect(value.name).toBe('TypeError')
        expect(children).toEqual([])
        return target
      },
      attachIdentity: (error, value) => {
        expect(error).toBe(target)
        attachErrorIdentity(error, { source: value.source, code: value.code })
      }
    }
    /** Remote source/code remains presentation data selected by the consumer's callback. */
    const restored = deserializeErrorChain(wire('TypeError'), strategy)
    expect(restored).toBe(target)
    expect(restored).toBeInstanceOf(TypeError)
    expect(restored).toMatchObject({ source: 'remote', code: 'REMOTE' })
    expect(restored.stack).toBe('TypeError: remote stack')
  })
})
