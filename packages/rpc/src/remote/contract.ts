import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import { RemoteMethodName } from './constants.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import { RemoteCatalogLimit } from './contract-limits.js'

/** The single method-mode domain used by TypeScript and the schema mirror. */
export const RemoteMethodMode = {
  request: 'request',
  oneWay: 'one-way',
  generator: 'generator',
  asyncGenerator: 'async-generator'
} as const

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
  mode: RemoteMethodMode
  idempotent: boolean
}>

/** One feature's nonempty declared method table. */
export type IRemoteFeatureContract = Readonly<{
  methods: Readonly<Record<string, IRemoteMethodContract>>
}>

/** Portable application-level method description. */
export type IRemoteContract = Readonly<{
  schemaVersion: 1
  plugin: string
  features: Readonly<Record<string, IRemoteFeatureContract>>
}>

/** Host catalog contains exactly one normalized description per plugin name. */
export type IRemoteHostCatalog = Readonly<Record<string, IRemoteContract>>

/** Local parser errors retain their bounded details without trusting user-supplied identities. */
const contractErrors = new WeakSet<Error>()

/** Error detail identifies the first invalid description field without echoing its value. */
function invalid(path: string, cause?: unknown, limit?: keyof typeof RemoteCatalogLimit): Error {
  /** Construct one local failure with a bounded, non-reflecting path. */
  const error = createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, cause, {
    path: path.slice(0, RemoteCatalogLimit.detailPathChars),
    ...(limit === undefined ? {} : { limit, max: RemoteCatalogLimit[limit] })
  })
  contractErrors.add(error)
  return error
}

/** Untrusted keys enter diagnostics only after passing the existing segment grammar. */
function pathKey(key: string): string {
  return new RegExp(REMOTE_NAME_PATTERN, 'u').test(key)
    ? key
    : RpcRemoteLayerErrorText.invalidPathSegment
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

/** Recognizes only this normalizer's tagged contract failures so original causes remain reachable. */
function isRemoteContractError(error: unknown): boolean {
  return error instanceof Error && contractErrors.has(error)
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
  path: string
): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) throw invalid(`${path}.${pathKey(key)}`)
  for (const key of allowed)
    if (!Object.hasOwn(record, key)) throw invalid(`${path}.${pathKey(key)}`)
}

/** Method and feature segments share one ASCII grammar. */
function assertName(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !new RegExp(REMOTE_NAME_PATTERN, 'u').test(value))
    throw invalid(path)
}

/** Freezes a normalized record with keys in Unicode code-point order. */
function sortedRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  /** Null prototype prevents declared keys such as constructor from changing the record shape. */
  const output: Record<string, T> = Object.create(null) as Record<string, T>
  for (const [key, value] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    output[key] = value
  return Object.freeze(output)
}

/** Normalizes an untrusted contract before any feature or frame is published. */
export function normalizeRemoteContract(input: unknown): IRemoteContract {
  /** Portable normalization rejects cycles, callbacks, platform objects, and unsafe property reads. */
  let portable: IRpcPortableValue
  try {
    portable = normalizePortable(snapshotContract(input))
  } catch (cause) {
    if (isRemoteContractError(cause)) throw cause
    throw invalid('$', cause)
  }
  const root = asRecord(portable, '$')
  exactKeys(root, ['schemaVersion', 'plugin', 'features'], '$')
  if (root.schemaVersion !== REMOTE_SCHEMA_VERSION) throw invalid('$.schemaVersion')
  assertName(root.plugin, '$.plugin')
  /** Feature-table size is checked before reading feature values. */
  const features = asRecord(root.features, '$.features')
  if (Object.keys(features).length === 0) throw invalid('$.features')
  /** Each feature and method is copied into a frozen, sorted record. */
  const featureEntries: [string, IRemoteFeatureContract][] = []
  for (const [featureName, featureValue] of Object.entries(features)) {
    assertName(featureName, `$.features.${featureName}`)
    const feature = asRecord(featureValue, `$.features.${featureName}`)
    exactKeys(feature, ['methods'], `$.features.${featureName}`)
    /** Method-table size is checked before reading method values. */
    const methods = asRecord(feature.methods, `$.features.${featureName}.methods`)
    if (Object.keys(methods).length === 0) throw invalid(`$.features.${featureName}.methods`)
    /** A method's mode and retry declaration are mandatory, even for one-way and streams. */
    const methodEntries: [string, IRemoteMethodContract][] = []
    for (const [methodName, methodValue] of Object.entries(methods)) {
      const path = `$.features.${featureName}.methods.${methodName}`
      assertName(methodName, path)
      const fullName = `${root.plugin}.${featureName}.${methodName}`
      if (
        fullName.length > REMOTE_METHOD_MAX_LENGTH ||
        Object.values(RemoteMethodName).includes(
          fullName as (typeof RemoteMethodName)[keyof typeof RemoteMethodName]
        )
      )
        throw invalid(path)
      const method = asRecord(methodValue, path)
      exactKeys(method, ['mode', 'idempotent'], path)
      if (!REMOTE_METHOD_MODES.includes(method.mode as RemoteMethodMode))
        throw invalid(`${path}.mode`)
      if (typeof method.idempotent !== 'boolean') throw invalid(`${path}.idempotent`)
      if (method.mode !== RemoteMethodMode.request && method.idempotent)
        throw invalid(`${path}.idempotent`)
      methodEntries.push([
        methodName,
        Object.freeze({ mode: method.mode as RemoteMethodMode, idempotent: method.idempotent })
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
export function normalizeRemoteHostCatalog(input: unknown): IRemoteHostCatalog {
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
    if (isRemoteContractError(cause)) throw cause
    throw invalid('$.catalog', cause)
  }
  const source = asRecord(portable, '$.catalog')
  if (Object.keys(source).length === 0) throw invalid('$.catalog')
  /** Catalog keys determine the only names that Host control methods may accept. */
  const entries: [string, IRemoteContract][] = []
  for (const [name, value] of Object.entries(source)) {
    assertName(name, `$.catalog.${name}`)
    const contract = normalizeRemoteContract(value)
    if (contract.plugin !== name) throw invalid(`$.catalog.${name}.plugin`)
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
  if (entry.state !== 'enabled' && entry.state !== 'disabled') throw invalid(`${path}.state`)
  if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0)
    throw invalid(`${path}.revision`)
  if (!Array.isArray(entry.features)) throw invalid(`${path}.features`)
  for (const feature of entry.features) assertName(feature, `${path}.features`)
}

/** Validates the reserved control shape after portable data normalization. */
export function normalizeRemoteControlShape(
  definition: IRemoteControlDefinition,
  input: unknown
): IRpcPortableValue {
  let value: IRpcPortableValue
  try {
    value = normalizePortable(input)
  } catch (cause) {
    throw invalid('$', cause)
  }
  if (definition === 'describePlugin')
    return normalizeRemoteContract(value) as unknown as IRpcPortableValue
  if (definition === 'describeHost') {
    const description = asRecord(value, '$')
    exactKeys(description, ['schemaVersion', 'catalog'], '$')
    if (description.schemaVersion !== REMOTE_SCHEMA_VERSION) throw invalid('$.schemaVersion')
    normalizeRemoteHostCatalog(description.catalog)
    return value
  }
  if (definition === 'hostUseParams' || definition === 'hostUnUseParams') {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw invalid('$')
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
        throw invalid('$[1].policy')
      if (Object.hasOwn(options, 'dryRun') && typeof options.dryRun !== 'boolean')
        throw invalid('$[1].dryRun')
    }
    return value
  }
  if (definition === 'hostInspectParams') {
    if (!Array.isArray(value) || value.length !== 0) throw invalid('$')
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
      throw invalid('$.revision')
    if (!Array.isArray(result.plugins)) throw invalid('$.plugins')
    let previous = ''
    for (const [index, entry] of result.plugins.entries()) {
      inspectEntry(entry, `$.plugins[${index}]`)
      const name = (entry as { name: string }).name
      if (name <= previous) throw invalid(`$.plugins[${index}].name`)
      previous = name
    }
    return value
  }
  const result = asRecord(value, '$')
  if (result.dryRun === true) {
    exactKeys(result, ['dryRun', 'policy', 'order', 'steps', 'edges'], '$')
    if (result.policy !== 'reject' && result.policy !== 'suspend') throw invalid('$.policy')
    if (
      !Array.isArray(result.order) ||
      !Array.isArray(result.steps) ||
      !Array.isArray(result.edges)
    )
      throw invalid('$')
    for (const name of result.order) assertName(name, '$.order')
    for (const step of result.steps) asRecord(step, '$.steps')
    for (const edge of result.edges) asRecord(edge, '$.edges')
  } else if (result.ok === true) exactKeys(result, ['ok'], '$')
  else if (result.ok === false) {
    exactKeys(result, ['ok', 'errors'], '$')
    if (!Array.isArray(result.errors)) throw invalid('$.errors')
    for (const error of result.errors) asRecord(error, '$.errors')
  } else throw invalid('$')
  return value
}
