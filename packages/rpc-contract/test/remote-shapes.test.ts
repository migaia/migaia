import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as protocol from '@migaia/rpc-contract/protocol'

/** Minimal valid provider isolates declaration failures. */
const contract = () => ({
  schemaVersion: 1,
  plugin: 'service',
  features: { api: { methods: { resize: { mode: 'request', idempotent: false } } } }
})
/** Minimal accepted directory isolates runtime field boundaries. */
const directory = (method: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  nodeId: 'a'.repeat(32),
  self: {
    generation: { kind: 'session', value: 0, providerId: 'service-1' },
    name: 'service',
    instanceId: 'service-1'
  },
  methods: [{ name: 'resize', supportedModes: ['request'], modeSource: 'declared', ...method }]
})
/** Plain fixtures populate only the already-supported count boundaries. */
const table = (count: number, value: unknown) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`item${index}`, value]))

describe('remote wire shapes', () => {
  it('returns supported declaration/directory diagnostics and captures original getter failures', () => {
    /** The original exception remains locally available without entering diagnostic text. */
    const original = new Error('GETTER_SENTINEL')
    /** Each entry reaches one registered semantic failure at a public shape boundary. */
    const results = [
      protocol.checkRpcProviderDeclaration(null),
      protocol.checkRpcProviderDeclaration({ ...contract(), unknown: 'FIELD_SENTINEL' }),
      protocol.checkRpcProviderDeclaration({ schemaVersion: 1, features: {} }),
      protocol.checkRpcProviderDeclaration({ ...contract(), plugin: '' }),
      protocol.checkRpcProviderDeclaration({ ...contract(), features: table(65, {}) }),
      protocol.checkRpcProviderDeclaration({
        ...contract(),
        features: { api: { methods: table(129, {}) } }
      }),
      protocol.checkRpcProviderDeclaration({ ...contract(), schemaVersion: 2 }),
      protocol.checkRpcProviderDeclaration({ ...contract(), features: {} }),
      protocol.checkRpcProviderDeclaration({
        ...contract(),
        features: { api: { methods: { resize: { mode: 'other', idempotent: false } } } }
      }),
      protocol.checkRpcProviderDeclaration({
        ...contract(),
        features: { api: { methods: { resize: { mode: 'request', idempotent: 'yes' } } } }
      }),
      protocol.checkRpcProviderDeclaration({
        ...contract(),
        get features() {
          throw original
        }
      }),
      protocol.checkRpcDirectory({ ...directory(), nodeId: 'invalid' }),
      protocol.checkRpcDirectory({ ...directory(), methods: null }),
      protocol.checkRpcDirectory({ ...directory(), self: { ...directory().self, name: '' } }),
      protocol.checkRpcDirectory(directory({ forwardedVia: 'invalid.path' })),
      protocol.checkRpcDirectory(directory({ name: 'invalid/path' })),
      protocol.checkRpcDirectory(directory({ supportedModes: [] })),
      protocol.checkRpcDirectory(directory({ modeSource: 'other' })),
      protocol.checkRpcDirectory(directory({ idempotent: 1 })),
      protocol.checkRpcDirectory(directory({ input: { $ref: 'https://REF_SENTINEL.invalid' } }))
    ]
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path.length).toBeLessThanOrEqual(
          protocol.RpcProviderDeclarationLimit.detailPathChars
        )
        expect(`${result.path}:${result.reason}`).not.toMatch(/SENTINEL/u)
      }
    }
    expect(new Set(results.flatMap((result) => (result.ok ? [] : [result.reason])))).toEqual(
      new Set([
        'record',
        'unknown-field',
        'missing-field',
        'name',
        'features-limit',
        'methods-limit',
        'version',
        'empty-table',
        'method-mode',
        'idempotency',
        'portable',
        'runtime-node',
        'runtime-methods',
        'runtime-identity',
        'runtime-forward',
        'runtime-method',
        'runtime-modes',
        'runtime-mode-source',
        'runtime-idempotency',
        'schema'
      ])
    )
    expect(results[10]).toMatchObject({ cause: original })
    expect(protocol.checkRpcProviderDeclaration(contract())).toMatchObject({
      ok: true,
      value: contract()
    })
  })

  it('exports all specified runtime symbols through actual subpaths with inward dependencies', () => {
    for (const key of [
      'RpcProviderDeclarationLimit',
      'RpcProviderMode',
      'REMOTE_NAME_PATTERN',
      'RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS',
      'RPC_PROVIDER_DECLARATION_VERSION',
      'RPC_PROVIDER_MODES',
      'RpcShapeReason',
      'checkRpcProviderDeclaration',
      'RpcWireDirectoryVersion',
      'RuntimeApiMode',
      'RuntimeApiModeSource',
      'checkRpcDirectory',
      'normalizeRpcFrame',
      'normalizeRpcHandshake'
    ])
      expect(protocol).toHaveProperty(key)
    /** Package dependencies remain the two existing foundation packages. */
    const metadata = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { dependencies: Record<string, string> }
    /** Object keys are unique; exact Set equality retains missing and extra dependency checks. */
    expect(new Set(Object.keys(metadata.dependencies))).toEqual(
      new Set(['@migaia/serialize', '@migaia/utils'])
    )
  })

  it('normalizes local provider schema declarations without relaxing required fields', () => {
    /** All three declaration schemas share one recursive boundary. */
    const fields = {
      input: { type: 'number' },
      output: { type: 'string' },
      yield: { type: 'integer' }
    }
    /** The advanced declaration retains mandatory mode and replay policy. */
    const input = {
      ...contract(),
      features: { api: { methods: { resize: { mode: 'request', idempotent: false, ...fields } } } }
    }
    expect(protocol.checkRpcProviderDeclaration(input)).toMatchObject({ ok: true, value: input })
    expect(
      protocol.checkRpcProviderDeclaration({
        ...input,
        features: { api: { methods: { resize: { input: {} } } } }
      })
    ).toMatchObject({ ok: false, reason: protocol.RpcShapeReason['missing-field'] })
  })

  it('round-trips input/output/yield in schema3 directories and ignores unknown metadata', () => {
    /** Schema fields add data without changing the directory version or modes. */
    const fields = {
      input: { type: 'number' },
      output: { type: 'string' },
      yield: { type: 'integer' }
    }
    expect(protocol.checkRpcDirectory(directory(fields))).toMatchObject({
      ok: true,
      value: { methods: [fields] }
    })
    expect(protocol.checkRpcDirectory(directory())).toMatchObject({ ok: true })
    expect(protocol.checkRpcDirectory(directory({ unsupported: {} }))).toMatchObject({
      ok: true
    })
  })

  it('rejects malformed keyword shapes without reflecting untrusted schema keys and values', () => {
    for (const schema of [
      { type: 'TYPE_SENTINEL' },
      { properties: [] },
      { properties: { PROPERTY_SENTINEL: false } },
      { required: [1] },
      { required: ['a', 'a'] },
      { items: false },
      { enum: [] },
      { enum: ['ENUM_SENTINEL', 'ENUM_SENTINEL'] },
      { const: () => 'CONST_SENTINEL' },
      { anyOf: [] },
      { anyOf: [false] },
      { $defs: [] },
      { $defs: { DEF_SENTINEL: false } },
      { unsupported: 'KEYWORD_SENTINEL' }
    ]) {
      expect(protocol.checkRpcDirectory(directory({ input: schema }))).toMatchObject({
        ok: false,
        reason: protocol.RpcShapeReason.schema,
        path: '$.schema'
      })
    }
  })

  it('accepts local escaped references without following cycles and rejects external or missing targets', () => {
    expect(
      protocol.checkRpcDirectory(
        directory({ input: { $defs: { 'a/~b': {} }, $ref: '#/$defs/a~1~0b' } })
      )
    ).toMatchObject({ ok: true })
    expect(
      protocol.checkRpcDirectory(
        directory({ input: { $defs: { node: { $ref: '#/$defs/node' } }, $ref: '#/$defs/node' } })
      )
    ).toMatchObject({ ok: true })
    for (const $ref of [
      'https://REF_SENTINEL.invalid/value',
      'file:///REF_SENTINEL',
      '#/$defs/missing',
      '#/$defs/a~2'
    ])
      expect(
        protocol.checkRpcDirectory(directory({ input: { $defs: { a: {} }, $ref } }))
      ).toMatchObject({ ok: false, reason: protocol.RpcShapeReason.schema })
  })

  it('retains count-before-getter bounds and supportedModes direct index validation', () => {
    /** Over-limit tables must not execute an entry getter. */
    const features = table(65, {})
    /** The same counter measures the later accepted modes getter. */
    let reads = 0
    Object.defineProperty(features, 'item0', {
      enumerable: true,
      get() {
        reads++
        return {}
      }
    })
    expect(protocol.checkRpcProviderDeclaration({ ...contract(), features })).toMatchObject({
      ok: false,
      reason: protocol.RpcShapeReason['features-limit']
    })
    expect(reads).toBe(0)
    /** Set and some validate the same original modes without copying the array. */
    const modes = ['request']
    Object.defineProperty(modes, '0', {
      enumerable: true,
      get() {
        reads++
        return 'request'
      }
    })
    expect(protocol.checkRpcDirectory(directory({ supportedModes: modes }))).toMatchObject({
      ok: true
    })
    expect(reads).toBe(2)
  })

  it('captures schema and known method-field getter failures through their actual readers', () => {
    /** The checker preserves original local exceptions without embedding their messages. */
    const original = new TypeError('SCHEMA_GETTER_SENTINEL')
    /** Schema data uses the original portable owner exactly once. */
    let reads = 0
    expect(
      protocol.checkRpcDirectory(
        directory({
          input: {
            get type() {
              reads++
              throw original
            }
          }
        })
      )
    ).toMatchObject({ ok: false, reason: protocol.RpcShapeReason.schema })
    expect(reads).toBe(1)
    /** BC9 reads this known method field directly and retains its original thrown cause. */
    const method = {
      name: 'resize',
      supportedModes: ['request'],
      modeSource: 'declared',
      get input() {
        reads++
        throw original
      }
    }
    expect(protocol.checkRpcDirectory({ ...directory(), methods: [method] })).toMatchObject({
      ok: false,
      reason: protocol.RpcShapeReason.portable,
      cause: original
    })
    expect(reads).toBe(2)
    /** A prior public diagnostic is ordinary caller data when a later getter throws it. */
    const previous = protocol.checkRpcProviderDeclaration(null)
    /** The next invocation must retain the exact thrown object on its captured cause path. */
    const next = protocol.checkRpcProviderDeclaration({
      ...contract(),
      get features() {
        throw previous
      }
    })
    expect(next).toMatchObject({ ok: false, reason: protocol.RpcShapeReason.portable })
    expect(!next.ok && next.cause).toBe(previous)
  })
})
