import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as remote from '@migaia/rpc-contract/remote'
import * as runtime from '@migaia/rpc-contract/runtime'
import * as jsonrpc from '@migaia/rpc-contract/framing/jsonrpc'
import * as framing from '@migaia/rpc-contract/framing'

/** Minimal valid provider isolates declaration failures. */
const contract = () => ({
  schemaVersion: 1,
  plugin: 'service',
  features: { api: { methods: { resize: { mode: 'request', idempotent: false } } } }
})
/** Minimal accepted directory isolates runtime field boundaries. */
const directory = (method: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  self: { name: 'service', instanceId: 'service-1' },
  methods: [{ name: 'resize', supportedModes: ['request'], modeSource: 'declared', ...method }]
})
/** Plain fixtures populate only the already-supported count boundaries. */
const table = (count: number, value: unknown) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`item${index}`, value]))

describe('remote wire shapes', () => {
  it('returns every registered diagnostic reason and captures original getter failures', () => {
    /** The original exception remains locally available without entering diagnostic text. */
    const original = new Error('GETTER_SENTINEL')
    /** Each entry reaches one registered semantic failure at a public shape boundary. */
    const results = [
      remote.checkRemoteContract(null),
      remote.checkRemoteContract({ ...contract(), unknown: 'FIELD_SENTINEL' }),
      remote.checkRemoteContract({ schemaVersion: 1, features: {} }),
      remote.checkRemoteContract({ ...contract(), plugin: '' }),
      remote.checkRemoteHostCatalog(table(65, contract())),
      remote.checkRemoteContract({ ...contract(), features: table(65, {}) }),
      remote.checkRemoteContract({ ...contract(), features: { api: { methods: table(129, {}) } } }),
      remote.checkRemoteHostCatalog({
        service: { ...contract(), features: table(33, { methods: table(128, {}) }) }
      }),
      remote.checkRemoteContract({ ...contract(), schemaVersion: 2 }),
      remote.checkRemoteContract({ ...contract(), features: {} }),
      remote.checkRemoteContract({
        ...contract(),
        features: { api: { methods: { resize: { mode: 'other', idempotent: false } } } }
      }),
      remote.checkRemoteContract({
        ...contract(),
        features: { api: { methods: { resize: { mode: 'request', idempotent: 'yes' } } } }
      }),
      remote.checkRemoteHostCatalog({ other: contract() }),
      remote.checkRemoteControlShape('hostUseResult', {
        name: 'service',
        state: 'other',
        revision: 0,
        features: []
      }),
      remote.checkRemoteControlShape('hostUseResult', {
        name: 'service',
        state: 'enabled',
        revision: -1,
        features: []
      }),
      remote.checkRemoteControlShape('hostUseResult', {
        name: 'service',
        state: 'enabled',
        revision: 0,
        features: null
      }),
      remote.checkRemoteControlShape('hostInspectParams', [1]),
      remote.checkRemoteContract({
        ...contract(),
        get features() {
          throw original
        }
      }),
      runtime.checkRuntimeDescription({ ...directory(), nodeId: 'invalid' }),
      runtime.checkRuntimeDescription({ ...directory(), methods: null }),
      runtime.checkRuntimeDescription({ ...directory(), self: { name: '', instanceId: 'a' } }),
      runtime.checkRuntimeDescription(directory({ forwardedVia: 'invalid.path' })),
      runtime.checkRuntimeDescription(directory({ name: 'invalid/path' })),
      runtime.checkRuntimeDescription(directory({ supportedModes: [] })),
      runtime.checkRuntimeDescription(directory({ modeSource: 'other' })),
      runtime.checkRuntimeDescription(directory({ idempotent: 1 })),
      runtime.checkRuntimeDescription(
        directory({ input: { $ref: 'https://REF_SENTINEL.invalid' } })
      ),
      jsonrpc.checkJsonRpcDescription(directory({ supportedModes: ['stream'] }))
    ]
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.path.length).toBeLessThanOrEqual(remote.RemoteCatalogLimit.detailPathChars)
        expect(`${result.path}:${result.reason}`).not.toMatch(/SENTINEL/u)
      }
    }
    expect(new Set(results.flatMap((result) => (result.ok ? [] : [result.reason])))).toEqual(
      new Set(Object.values(remote.RpcShapeReason))
    )
    expect(results[17]).toMatchObject({ cause: original })
    expect(remote.checkRemoteContract(contract())).toMatchObject({ ok: true, value: contract() })
  })

  it('exports all specified runtime symbols through actual subpaths with inward dependencies', () => {
    for (const key of [
      'RemoteCatalogLimit',
      'RemoteMethodMode',
      'REMOTE_NAME_PATTERN',
      'REMOTE_METHOD_MAX_LENGTH',
      'REMOTE_SCHEMA_VERSION',
      'REMOTE_METHOD_MODES',
      'RemoteMethodName',
      'RpcShapeReason',
      'checkRemoteContract',
      'checkRemoteHostCatalog',
      'checkRemoteControlShape',
      'sameRemoteContract'
    ])
      expect(remote).toHaveProperty(key)
    for (const key of [
      'RUNTIME_API_SCHEMA_VERSION',
      'RuntimeApiMode',
      'RuntimeApiModeSource',
      'RuntimeSourceKind',
      'RuntimeConnectionDirection',
      'RuntimeQueryStatus',
      'RuntimeQueryReason',
      'RuntimeResourceKind',
      'RuntimeMetricScope',
      'RuntimeMetricUnit',
      'RuntimeRecentKind',
      'RuntimeEventName',
      'RuntimeQueryClock',
      'checkRuntimeDescription',
      'rpcMessageCapabilityControl'
    ])
      expect(runtime).toHaveProperty(key)
    for (const key of [
      'JsonRpcProfile',
      'JSONRPC_REQUIRED_CAPABILITIES',
      'JSONRPC_ALLOWED_CAPABILITIES',
      'JSONRPC_REQUIRED_METHODS',
      'JsonRpcErrorNumber',
      'checkJsonRpcDescription'
    ])
      expect(jsonrpc).toHaveProperty(key)
    expect(framing.rpcByteRuntimeBootstrap).toBe(runtime.rpcByteRuntimeBootstrap)
    /** Package dependencies remain the two existing foundation packages. */
    const metadata = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { dependencies: Record<string, string> }
    /** Object keys are unique; exact Set equality retains missing and extra dependency checks. */
    expect(new Set(Object.keys(metadata.dependencies))).toEqual(
      new Set(['@migaia/serialize', '@migaia/utils'])
    )
  })

  it('normalizes provider schemas through contract, catalog and control without relaxing required fields', () => {
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
    expect(remote.checkRemoteContract(input)).toMatchObject({ ok: true, value: input })
    expect(remote.checkRemoteHostCatalog({ service: input })).toMatchObject({ ok: true })
    expect(remote.checkRemoteControlShape('describePlugin', input)).toMatchObject({ ok: true })
    expect(
      remote.checkRemoteControlShape('describeHost', {
        schemaVersion: 1,
        catalog: { service: input }
      })
    ).toMatchObject({ ok: true })
    expect(
      remote.checkRemoteContract({
        ...input,
        features: { api: { methods: { resize: { input: {} } } } }
      })
    ).toMatchObject({ ok: false, reason: remote.RpcShapeReason['missing-field'] })
  })

  it('round-trips input/output/yield while keeping old directories and unknown-field rejection', () => {
    /** Schema fields add data without changing the directory version or modes. */
    const fields = {
      input: { type: 'number' },
      output: { type: 'string' },
      yield: { type: 'integer' }
    }
    expect(runtime.checkRuntimeDescription(directory(fields))).toMatchObject({
      ok: true,
      value: { methods: [fields] }
    })
    expect(runtime.checkRuntimeDescription(directory())).toMatchObject({ ok: true })
    expect(runtime.checkRuntimeDescription(directory({ unsupported: {} }))).toMatchObject({
      ok: false,
      reason: remote.RpcShapeReason['unknown-field']
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
      expect(runtime.checkRuntimeDescription(directory({ input: schema }))).toMatchObject({
        ok: false,
        reason: remote.RpcShapeReason.schema,
        path: '$.schema'
      })
    }
  })

  it('accepts local escaped references without following cycles and rejects external or missing targets', () => {
    expect(
      runtime.checkRuntimeDescription(
        directory({ input: { $defs: { 'a/~b': {} }, $ref: '#/$defs/a~1~0b' } })
      )
    ).toMatchObject({ ok: true })
    expect(
      runtime.checkRuntimeDescription(
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
        runtime.checkRuntimeDescription(directory({ input: { $defs: { a: {} }, $ref } }))
      ).toMatchObject({ ok: false, reason: remote.RpcShapeReason.schema })
  })

  it('retains count-before-getter bounds and supportedModes original three index reads', () => {
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
    expect(remote.checkRemoteContract({ ...contract(), features })).toMatchObject({
      ok: false,
      reason: remote.RpcShapeReason['features-limit']
    })
    expect(reads).toBe(0)
    /** Set/some/spread intentionally retain their three original index reads. */
    const modes = ['request']
    Object.defineProperty(modes, '0', {
      enumerable: true,
      get() {
        reads++
        return 'request'
      }
    })
    expect(runtime.checkRuntimeDescription(directory({ supportedModes: modes }))).toMatchObject({
      ok: true
    })
    expect(reads).toBe(3)
  })

  it('captures schema getter failures once and rejects method accessors before reading them', () => {
    /** The checker preserves original local exceptions without embedding their messages. */
    const original = new TypeError('SCHEMA_GETTER_SENTINEL')
    /** Schema data uses the original portable owner exactly once. */
    let reads = 0
    expect(
      runtime.checkRuntimeDescription(
        directory({
          input: {
            get type() {
              reads++
              throw original
            }
          }
        })
      )
    ).toMatchObject({ ok: false, reason: remote.RpcShapeReason.schema })
    expect(reads).toBe(1)
    /** Remote method accessors remain rejected by descriptors before execution. */
    const method = {
      name: 'resize',
      supportedModes: ['request'],
      modeSource: 'declared',
      get input() {
        reads++
        throw original
      }
    }
    expect(runtime.checkRuntimeDescription({ ...directory(), methods: [method] })).toMatchObject({
      ok: false,
      reason: remote.RpcShapeReason.record
    })
    expect(reads).toBe(1)
    /** A prior public diagnostic is ordinary caller data when a later getter throws it. */
    const previous = remote.checkRemoteContract(null)
    /** The next invocation must retain the exact thrown object on its captured cause path. */
    const next = remote.checkRemoteContract({
      ...contract(),
      get features() {
        throw previous
      }
    })
    expect(next).toMatchObject({ ok: false, reason: remote.RpcShapeReason.portable })
    expect(!next.ok && next.cause).toBe(previous)
  })

  it('executes all shared schema cases and the JSON-RPC stream boundary', () => {
    /** Case IDs and full descriptions are shared with the three foreign selftests. */
    const vectors = JSON.parse(
      readFileSync(
        new URL('../../rpc-integration/schema/vectors/description-schema.json', import.meta.url),
        'utf8'
      )
    ) as { cases: { id: string; valid: boolean; value: unknown }[] }
    for (const vector of vectors.cases)
      expect(runtime.checkRuntimeDescription(vector.value).ok, vector.id).toBe(vector.valid)
    expect(jsonrpc.checkJsonRpcDescription(directory())).toMatchObject({ ok: true })
    expect(
      jsonrpc.checkJsonRpcDescription(directory({ supportedModes: ['stream'] }))
    ).toMatchObject({ ok: false, reason: remote.RpcShapeReason['jsonrpc-stream'] })
  })
})
