import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import { RemoteMethodName } from './constants.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'

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

/** Error detail identifies the first invalid description field without echoing its value. */
function invalid(path: string, cause?: unknown): Error {
  return createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, cause, { path })
}

/** A record is a portable object rather than an array or byte descriptor. */
function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(path)
  return value as Readonly<Record<string, unknown>>
}

/** Reject unknown required semantics instead of silently accepting them. */
function exactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string
): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw invalid(`${path}.${key}`)
  for (const key of allowed) if (!Object.hasOwn(record, key)) throw invalid(`${path}.${key}`)
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
    portable = normalizePortable(input)
  } catch (cause) {
    throw invalid('$', cause)
  }
  const root = asRecord(portable, '$')
  exactKeys(root, ['schemaVersion', 'plugin', 'features'], '$')
  if (root.schemaVersion !== REMOTE_SCHEMA_VERSION) throw invalid('$.schemaVersion')
  assertName(root.plugin, '$.plugin')
  const features = asRecord(root.features, '$.features')
  if (Object.keys(features).length === 0) throw invalid('$.features')
  /** Each feature and method is copied into a frozen, sorted record. */
  const featureEntries: [string, IRemoteFeatureContract][] = []
  for (const [featureName, featureValue] of Object.entries(features)) {
    assertName(featureName, `$.features.${featureName}`)
    const feature = asRecord(featureValue, `$.features.${featureName}`)
    exactKeys(feature, ['methods'], `$.features.${featureName}`)
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
  /** Normalize the outer map too, so getters and prototype objects cannot bypass contract checks. */
  let portable: IRpcPortableValue
  try {
    portable = normalizePortable(input)
  } catch (cause) {
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
        if (key !== 'policy' && key !== 'dryRun') throw invalid(`$[1].${key}`)
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
