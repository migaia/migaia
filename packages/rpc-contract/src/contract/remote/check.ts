import { orderStringKeys } from '@migaia/utils/string'
import { normalizePortable, type IRpcPortableValue } from '../portable-index.js'
import {
  RemoteMethodName,
  REMOTE_SHAPE_DETAIL_PATH_CHARS,
  REMOTE_INVALID_PATH_SEGMENT
} from './constants.js'
import { normalizeMethodSchema, type IRpcMethodSchema } from './schema.js'
import {
  RpcShapeReason,
  inspectShape,
  rejectShape,
  isShapeFailure,
  type IRpcShapeCheck
} from './check-result.js'

/**
 * Remote description admission bounds anchor existing wire/admission limits: 64
 * capabilities/connections, 128 per-peer admissions, 4096 replay entries, and the 256-character
 * trace limit. The schema mirrors the structural bounds.
 */
export const RemoteCatalogLimit = {
  /** Maximum declared plugins in one Host description. */
  pluginsPerCatalog: 64,
  /** Maximum features in one plugin contract. */
  featuresPerContract: 64,
  /** Maximum methods in one feature table. */
  methodsPerFeature: 128,
  /** Aggregate method budget across all contracts in a Host catalog. */
  methodsPerCatalog: 4096,
  /** Diagnostic paths cannot exceed the existing trace-character budget. */
  detailPathChars: REMOTE_SHAPE_DETAIL_PATH_CHARS
} as const

/** The single method-mode domain used by TypeScript and the schema mirror. */
export const RemoteMethodMode = {
  /** Scalar call requiring a returned result. */ request: 'request',
  /** Physical notification with no provider completion reply. */ oneWay: 'one-way',
  /** Declared synchronous generator served through the stream owner. */ generator: 'generator',
  /** Declared asynchronous generator served through the stream owner. */ asyncGenerator:
    'async-generator'
} as const

/** Declared scalar, one-way or generator method execution mode. */
export type RemoteMethodMode = (typeof RemoteMethodMode)[keyof typeof RemoteMethodMode]

/** Stable grammar for plugin, feature, and method segments. */
export const REMOTE_NAME_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,39}$'

/** A three-segment method must remain within this protocol limit. */
export const REMOTE_METHOD_MAX_LENGTH = 122

/** Current description version; new required semantics need another version. */
export const REMOTE_SCHEMA_VERSION = 1

/** The four accepted method modes, also mirrored by the JSON Schema. */
export const REMOTE_METHOD_MODES: readonly RemoteMethodMode[] = Object.freeze(
  Object.values(RemoteMethodMode)
)

/** One explicitly declared remote method. */
export type IRemoteMethodContract = Readonly<{
  /** Declared request, one-way, generator or async-generator execution mode. */
  mode: RemoteMethodMode
  /**
   * Whether request replay after a lost generation is permitted; other modes cannot claim request
   * replay.
   */
  idempotent: boolean
  /** Optional portable input schema shared with the runtime directory. */
  input?: IRpcMethodSchema
  /** Optional portable result schema shared with the runtime directory. */
  output?: IRpcMethodSchema
  /** Optional portable stream element schema shared with the runtime directory. */
  yield?: IRpcMethodSchema
}>

/** One feature's nonempty declared method table. */
export type IRemoteFeatureContract = Readonly<{
  /** Nonempty validated method-name table for this declared Feature. */
  methods: Readonly<Record<string, IRemoteMethodContract>>
}>

/** Portable application-level method description. */
export type IRemoteContract = Readonly<{
  /** Description grammar version; this advanced contract requires 1. */
  schemaVersion: 1
  /** Validated plugin name that prefixes declared remote methods. */
  plugin: string
  /** Validated Feature-name table defining the callable method whitelist. */
  features: Readonly<Record<string, IRemoteFeatureContract>>
}>

/** Host catalog contains exactly one normalized description per plugin name. */
export type IRemoteHostCatalog = Readonly<Record<string, IRemoteContract>>

/** Keep the existing limit-to-diagnostic mapping without constructing package errors. */
const limitReasons = {
  pluginsPerCatalog: RpcShapeReason['plugins-limit'],
  featuresPerContract: RpcShapeReason['features-limit'],
  methodsPerFeature: RpcShapeReason['methods-limit'],
  methodsPerCatalog: RpcShapeReason['catalog-methods-limit'],
  detailPathChars: RpcShapeReason.record
} as const

/** Stop at the original failure position with a bounded, non-reflecting diagnostic. */
function invalid(
  path: string,
  cause?: unknown,
  limit?: keyof typeof RemoteCatalogLimit,
  reason: RpcShapeReason = RpcShapeReason.record
): never {
  return rejectShape(limit === undefined ? reason : limitReasons[limit], path, cause)
}

/** Untrusted keys enter diagnostics only after passing the existing segment grammar. */
function pathKey(key: string): string {
  return new RegExp(REMOTE_NAME_PATTERN, 'u').test(key) ? key : REMOTE_INVALID_PATH_SEGMENT
}

/** Count a table before reading any entry values. */
function boundedKeys(
  record: Readonly<Record<string, unknown>>,
  path: string,
  limit: keyof typeof RemoteCatalogLimit
): string[] {
  /** Names are counted before any getter in the table runs. */
  const keys = Object.keys(record)
  if (keys.length > RemoteCatalogLimit[limit]) throw invalid(path, undefined, limit)
  return keys
}

/** Snapshot one bounded description, reading each original property once before normalization. */
function snapshotContract(input: unknown, totals?: { methods: number }): unknown {
  /** The original root is read exactly once into a portable snapshot. */
  const root = asRecord(input, '$')
  exactKeys(root, ['schemaVersion', 'plugin', 'features'], '$')
  /** Feature-table size is checked before reading feature values. */
  const features = asRecord(root.features, '$.features')
  /** Only admitted feature keys enter the bounded traversal. */
  const featureKeys = boundedKeys(features, '$.features', 'featuresPerContract')
  /** A plain snapshot keeps getters out of the subsequent portable normalization pass. */
  /** Only bounded, validated catalog entries enter portable normalization. */
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const featureName of featureKeys) {
    /** Only a validated name or the fixed placeholder reaches diagnostics. */
    const path = `$.features.${pathKey(featureName)}`
    assertName(featureName, path)
    /** One original feature read preserves getter failure identity. */
    const feature = asRecord(features[featureName], path)
    exactKeys(feature, ['methods'], path)
    /** Method-table size is checked before reading method values. */
    const methods = asRecord(feature.methods, `${path}.methods`)
    /** These admitted method names contribute to the catalog-wide budget. */
    const methodKeys = boundedKeys(methods, `${path}.methods`, 'methodsPerFeature')
    if (totals) {
      totals.methods += methodKeys.length
      if (totals.methods > RemoteCatalogLimit.methodsPerCatalog)
        throw invalid('$.catalog', undefined, 'methodsPerCatalog')
    }
    /** Method objects remain original until the one portable normalization pass. */
    const table: Record<string, unknown> = Object.create(null)
    for (const methodName of methodKeys) {
      assertName(methodName, `${path}.methods.${pathKey(methodName)}`)
      table[methodName] = methods[methodName]
    }
    snapshot[featureName] = { methods: table }
  }
  return { schemaVersion: root.schemaVersion, plugin: root.plugin, features: snapshot }
}

/** A record is a portable object rather than an array or byte descriptor. */
function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(path)
  /** Keep the existing portable plain-object restriction while snapshotting. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw invalid(path)
  return value as Readonly<Record<string, unknown>>
}

/** Reject unknown required semantics instead of silently accepting them. */
function exactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key) && !optional.includes(key))
      throw invalid(
        `${path}.${pathKey(key)}`,
        undefined,
        undefined,
        RpcShapeReason['unknown-field']
      )
  for (const key of allowed)
    if (!Object.hasOwn(record, key))
      throw invalid(
        `${path}.${pathKey(key)}`,
        undefined,
        undefined,
        RpcShapeReason['missing-field']
      )
}

/** Method and feature segments share one ASCII grammar. */
function assertName(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !new RegExp(REMOTE_NAME_PATTERN, 'u').test(value))
    throw invalid(path, undefined, undefined, RpcShapeReason.name)
}

/** Freezes a normalized record with keys in Unicode code-point order. */
function sortedRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  /** Null prototype prevents declared keys such as constructor from changing the record shape. */
  const output: Record<string, T> = Object.create(null) as Record<string, T>
  /** Index the original values once; stable code-unit ordering belongs to utils. */
  const values = new Map(entries)
  for (const key of orderStringKeys(Array.from(values.keys()))) output[key] = values.get(key)!
  return Object.freeze(output)
}

/** Normalizes an untrusted contract before any feature or frame is published. */
function readRemoteContract(input: unknown): IRemoteContract {
  /** Portable normalization rejects cycles, callbacks, platform objects, and unsafe property reads. */
  let portable: IRpcPortableValue
  try {
    portable = normalizePortable(snapshotContract(input))
  } catch (cause) {
    if (isShapeFailure(cause)) throw cause
    throw invalid('$', cause, undefined, RpcShapeReason.portable)
  }
  /** The original root is read exactly once into a portable snapshot. */
  const root = asRecord(portable, '$')
  exactKeys(root, ['schemaVersion', 'plugin', 'features'], '$')
  if (root.schemaVersion !== REMOTE_SCHEMA_VERSION)
    throw invalid('$.schemaVersion', undefined, undefined, RpcShapeReason.version)
  assertName(root.plugin, '$.plugin')
  /** Feature-table size is checked before reading feature values. */
  const features = asRecord(root.features, '$.features')
  if (Object.keys(features).length === 0)
    throw invalid('$.features', undefined, undefined, RpcShapeReason['empty-table'])
  /** Each feature and method is copied into a frozen, sorted record. */
  const featureEntries: [string, IRemoteFeatureContract][] = []
  for (const [featureName, featureValue] of Object.entries(features)) {
    assertName(featureName, `$.features.${featureName}`)
    /** One original feature read preserves getter failure identity. */
    const feature = asRecord(featureValue, `$.features.${featureName}`)
    exactKeys(feature, ['methods'], `$.features.${featureName}`)
    /** Method-table size is checked before reading method values. */
    const methods = asRecord(feature.methods, `$.features.${featureName}.methods`)
    if (Object.keys(methods).length === 0)
      throw invalid(
        `$.features.${featureName}.methods`,
        undefined,
        undefined,
        RpcShapeReason['empty-table']
      )
    /** A method's mode and retry declaration are mandatory, even for one-way and streams. */
    const methodEntries: [string, IRemoteMethodContract][] = []
    for (const [methodName, methodValue] of Object.entries(methods)) {
      /** Only a validated name or the fixed placeholder reaches diagnostics. */
      const path = `$.features.${featureName}.methods.${methodName}`
      assertName(methodName, path)
      const fullName = `${root.plugin}.${featureName}.${methodName}`
      if (
        fullName.length > REMOTE_METHOD_MAX_LENGTH ||
        Object.values(RemoteMethodName).includes(
          fullName as (typeof RemoteMethodName)[keyof typeof RemoteMethodName]
        )
      )
        throw invalid(path, undefined, undefined, RpcShapeReason.name)
      const method = asRecord(methodValue, path)
      exactKeys(method, ['mode', 'idempotent'], path, ['input', 'output', 'yield'])
      if (!REMOTE_METHOD_MODES.includes(method.mode as RemoteMethodMode))
        throw invalid(`${path}.mode`, undefined, undefined, RpcShapeReason['method-mode'])
      if (typeof method.idempotent !== 'boolean')
        throw invalid(`${path}.idempotent`, undefined, undefined, RpcShapeReason.idempotency)
      if (method.mode !== RemoteMethodMode.request && method.idempotent)
        throw invalid(`${path}.idempotent`, undefined, undefined, RpcShapeReason.idempotency)
      methodEntries.push([
        methodName,
        Object.freeze({
          mode: method.mode as RemoteMethodMode,
          idempotent: method.idempotent,
          ...Object.fromEntries(
            ['input', 'output', 'yield']
              .filter((key) => Object.hasOwn(method, key))
              .map((key) => [key, normalizeMethodSchema(method[key])])
          )
        })
      ])
    }
    featureEntries.push([featureName, Object.freeze({ methods: sortedRecord(methodEntries) })])
  }
  return Object.freeze({
    schemaVersion: REMOTE_SCHEMA_VERSION,
    plugin: root.plugin,
    features: sortedRecord(featureEntries)
  })
}

/** Normalizes a host catalog with the same contract parser used by Plugin mode. */
function readRemoteHostCatalog(input: unknown): IRemoteHostCatalog {
  /** Count catalog keys before touching values; one shared counter bounds all nested methods. */
  let portable: IRpcPortableValue
  try {
    /** The outer catalog is inspected before its entries are read. */
    const source = asRecord(input, '$.catalog')
    /** Plugin-table size determines whether entry values may be read. */
    const keys = boundedKeys(source, '$.catalog', 'pluginsPerCatalog')
    /** One counter spans every plugin in this catalog. */
    const totals = { methods: 0 }
    /** Only bounded, validated catalog entries enter portable normalization. */
    const snapshot: Record<string, unknown> = Object.create(null)
    for (const name of keys) {
      assertName(name, `$.catalog.${pathKey(name)}`)
      snapshot[name] = snapshotContract(source[name], totals)
    }
    portable = normalizePortable(snapshot)
  } catch (cause) {
    if (isShapeFailure(cause)) throw cause
    throw invalid('$.catalog', cause, undefined, RpcShapeReason.portable)
  }
  /** The outer catalog is inspected before its entries are read. */
  const source = asRecord(portable, '$.catalog')
  if (Object.keys(source).length === 0)
    throw invalid('$.catalog', undefined, undefined, RpcShapeReason['empty-table'])
  /** Catalog keys determine the only names that Host control methods may accept. */
  const entries: [string, IRemoteContract][] = []
  for (const [name, value] of Object.entries(source)) {
    assertName(name, `$.catalog.${name}`)
    const contract = readRemoteContract(value)
    if (contract.plugin !== name)
      throw invalid(
        `$.catalog.${name}.plugin`,
        undefined,
        undefined,
        RpcShapeReason['catalog-plugin']
      )
    entries.push([name, contract])
  }
  return sortedRecord(entries)
}

/** Compares two normalized descriptions without depending on object insertion order. */
export function sameRemoteContract(a: IRemoteContract, b: IRemoteContract): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Schema definition names used by the reserved Host request and response methods. */
export type IRemoteControlDefinition =
  | 'describePlugin'
  | 'describeHost'
  | 'hostUseParams'
  | 'hostUseResult'
  | 'hostUnUseParams'
  | 'hostUnUseResult'
  | 'hostInspectParams'
  | 'hostInspectResult'

/** Validates an inspect entry without accepting undeclared methods or local objects. */
function inspectEntry(value: unknown, path: string): void {
  const entry = asRecord(value, path)
  exactKeys(entry, ['name', 'state', 'revision', 'features'], path)
  assertName(entry.name, `${path}.name`)
  if (entry.state !== 'enabled' && entry.state !== 'disabled')
    throw invalid(`${path}.state`, undefined, undefined, RpcShapeReason['control-state'])
  if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0)
    throw invalid(`${path}.revision`, undefined, undefined, RpcShapeReason['control-revision'])
  if (!Array.isArray(entry.features))
    throw invalid(`${path}.features`, undefined, undefined, RpcShapeReason['control-features'])
  for (const feature of entry.features) assertName(feature, `${path}.features`)
}

/** Validates the reserved control shape after portable data normalization. */
function readRemoteControlShape(
  definition: IRemoteControlDefinition,
  input: unknown
): IRpcPortableValue {
  let value: IRpcPortableValue
  try {
    value = normalizePortable(input)
  } catch (cause) {
    throw invalid('$', cause, undefined, RpcShapeReason.portable)
  }
  if (definition === 'describePlugin')
    return readRemoteContract(value) as unknown as IRpcPortableValue
  if (definition === 'describeHost') {
    const description = asRecord(value, '$')
    exactKeys(description, ['schemaVersion', 'catalog'], '$')
    if (description.schemaVersion !== REMOTE_SCHEMA_VERSION)
      throw invalid('$.schemaVersion', undefined, undefined, RpcShapeReason.version)
    readRemoteHostCatalog(description.catalog)
    return value
  }
  if (definition === 'hostUseParams' || definition === 'hostUnUseParams') {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2)
      throw invalid('$', undefined, undefined, RpcShapeReason.control)
    assertName(value[0], '$[0]')
    if (definition === 'hostUnUseParams' && value.length === 2) {
      const options = asRecord(value[1], '$[1]')
      for (const key of Object.keys(options))
        if (key !== 'policy' && key !== 'dryRun') throw invalid(`$[1].${pathKey(key)}`)
      if (
        Object.hasOwn(options, 'policy') &&
        options.policy !== 'reject' &&
        options.policy !== 'suspend'
      )
        throw invalid('$[1].policy', undefined, undefined, RpcShapeReason.control)
      if (Object.hasOwn(options, 'dryRun') && typeof options.dryRun !== 'boolean')
        throw invalid('$[1].dryRun', undefined, undefined, RpcShapeReason.control)
    }
    return value
  }
  if (definition === 'hostInspectParams') {
    if (!Array.isArray(value) || value.length !== 0)
      throw invalid('$', undefined, undefined, RpcShapeReason.control)
    return value
  }
  if (definition === 'hostUseResult') {
    inspectEntry(value, '$')
    return value
  }
  if (definition === 'hostInspectResult') {
    const result = asRecord(value, '$')
    exactKeys(result, ['revision', 'plugins'], '$')
    if (!Number.isSafeInteger(result.revision) || (result.revision as number) < 0)
      throw invalid('$.revision', undefined, undefined, RpcShapeReason.control)
    if (!Array.isArray(result.plugins))
      throw invalid('$.plugins', undefined, undefined, RpcShapeReason.control)
    let previous = ''
    for (const [index, entry] of result.plugins.entries()) {
      inspectEntry(entry, `$.plugins[${index}]`)
      const name = (entry as { name: string }).name
      if (name <= previous)
        throw invalid(`$.plugins[${index}].name`, undefined, undefined, RpcShapeReason.control)
      previous = name
    }
    return value
  }
  const result = asRecord(value, '$')
  if (result.dryRun === true) {
    exactKeys(result, ['dryRun', 'policy', 'order', 'steps', 'edges'], '$')
    if (result.policy !== 'reject' && result.policy !== 'suspend')
      throw invalid('$.policy', undefined, undefined, RpcShapeReason.control)
    if (
      !Array.isArray(result.order) ||
      !Array.isArray(result.steps) ||
      !Array.isArray(result.edges)
    )
      throw invalid('$', undefined, undefined, RpcShapeReason.control)
    for (const name of result.order) assertName(name, '$.order')
    for (const step of result.steps) asRecord(step, '$.steps')
    for (const edge of result.edges) asRecord(edge, '$.edges')
  } else if (result.ok === true) exactKeys(result, ['ok'], '$')
  else if (result.ok === false) {
    exactKeys(result, ['ok', 'errors'], '$')
    if (!Array.isArray(result.errors))
      throw invalid('$.errors', undefined, undefined, RpcShapeReason.control)
    for (const error of result.errors) asRecord(error, '$.errors')
  } else throw invalid('$', undefined, undefined, RpcShapeReason.control)
  return value
}

/** Check one provider declaration and return its original normalized snapshot or diagnostic. */
export function checkRemoteContract(input: unknown): IRpcShapeCheck<IRemoteContract> {
  return inspectShape(() => readRemoteContract(input))
}

/** Check the bounded Host catalog without reading entries before their admitted counts. */
export function checkRemoteHostCatalog(input: unknown): IRpcShapeCheck<IRemoteHostCatalog> {
  return inspectShape(() => readRemoteHostCatalog(input), '$.catalog')
}

/** Check one reserved control payload while leaving error construction with its host owner. */
export function checkRemoteControlShape(
  definition: IRemoteControlDefinition,
  input: unknown
): IRpcShapeCheck<IRpcPortableValue> {
  return inspectShape(() => readRemoteControlShape(definition, input))
}
