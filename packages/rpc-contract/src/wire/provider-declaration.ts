/**
 * Admits bounded advanced provider declarations and produces frozen catalogs with canonical key
 * order and schema diagnostics. Declarations remain inert data; provider compilation, dispatch and
 * replay policy belong to Host and installed plugins.
 */
import { orderStringKeys } from '@migaia/utils/string'
import { normalizePortable, type IRpcPortableValue } from '../portable/index.js'
import { readMethodSchema } from './method-schema.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import {
  inspectShape,
  rejectShape,
  isShapeFailure,
  RpcShapeReason,
  type IShapeInspection,
  type IRpcShapeCheck
} from './schema-diagnostics.js'
import { RPC_INVALID_DECLARATION_SEGMENT, REMOTE_NAME_PATTERN } from './limits.js'
/** Local advanced provider declarations are inert data, independent from the one wire profile. */
import type { IRpcMethodSchema } from './method-schema.js'
import { RPC_DIRECTORY_METHOD_LIMIT, REMOTE_SHAPE_DETAIL_PATH_CHARS } from './limits.js'

/**
 * Remote description admission bounds anchor existing wire/admission limits: 64
 * capabilities/connections, 128 per-peer admissions, 4096 replay entries, and the 256-character
 * trace limit. The schema mirrors the structural bounds.
 */
export const RpcProviderDeclarationLimit = {
  /** Maximum declared plugins in one Host description. */
  pluginsPerCatalog: 64,
  /** Maximum features in one plugin contract. */
  featuresPerContract: 64,
  /** Maximum methods in one feature table. */
  methodsPerFeature: 128,
  /** Aggregate method budget across all contracts in a Host catalog. */
  methodsPerCatalog: RPC_DIRECTORY_METHOD_LIMIT,
  /** Diagnostic paths cannot exceed the existing trace-character budget. */
  detailPathChars: REMOTE_SHAPE_DETAIL_PATH_CHARS
} as const

/** The single method-mode domain used by TypeScript and the schema mirror. */
export const RpcProviderMode = {
  /** Scalar call requiring a returned result. */ request: 'request',
  /** Physical notification with no provider completion reply. */ oneWay: 'one-way',
  /** Declared synchronous generator served through the stream owner. */ generator: 'generator',
  /** Declared asynchronous generator served through the stream owner. */ asyncGenerator:
    'async-generator'
} as const

/** Declared scalar, one-way or generator method execution mode. */
export type RpcProviderMode = (typeof RpcProviderMode)[keyof typeof RpcProviderMode]

/** A three-segment method must remain within this protocol limit. */
export const RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS = 122

/** Current description version; new required semantics need another version. */
export const RPC_PROVIDER_DECLARATION_VERSION = 1

/** The four accepted method modes, also mirrored by the JSON Schema. */
export const RPC_PROVIDER_MODES: readonly RpcProviderMode[] = Object.freeze(
  Object.values(RpcProviderMode)
)

/** One explicitly declared remote method. */
export type IRpcProviderMethodDeclaration = Readonly<{
  /** Declared request, one-way, generator or async-generator execution mode. */
  mode: RpcProviderMode
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
export type IRpcProviderFeatureDeclaration = Readonly<{
  /** Nonempty validated method-name table for this declared Feature. */
  methods: Readonly<Record<string, IRpcProviderMethodDeclaration>>
}>

/** Portable application-level method description. */
export type IRpcProviderDeclaration = Readonly<{
  /** Description grammar version; this advanced contract requires 1. */
  schemaVersion: 1
  /** Validated plugin name that prefixes declared remote methods. */
  plugin: string
  /** Validated Feature-name table defining the callable method whitelist. */
  features: Readonly<Record<string, IRpcProviderFeatureDeclaration>>
}>

/** Keep the existing limit-to-diagnostic mapping without constructing package errors. */
const limitReasons = {
  pluginsPerCatalog: RpcShapeReason['plugins-limit'],
  featuresPerContract: RpcShapeReason['features-limit'],
  methodsPerFeature: RpcShapeReason['methods-limit'],
  methodsPerCatalog: RpcShapeReason['catalog-methods-limit'],
  detailPathChars: RpcShapeReason.record
} as const

/** Stop at the original failure position with a bounded, non-reflecting diagnostic. */
export function invalid(
  inspection: IShapeInspection,
  path: string,
  cause?: unknown,
  limit?: keyof typeof RpcProviderDeclarationLimit,
  reason: RpcShapeReason = RpcShapeReason.record
): never {
  return rejectShape(inspection, limit === undefined ? reason : limitReasons[limit], path, cause)
}

/** Untrusted keys enter diagnostics only after passing the existing segment grammar. */
export function pathKey(key: string): string {
  return new RegExp(REMOTE_NAME_PATTERN, 'u').test(key) ? key : RPC_INVALID_DECLARATION_SEGMENT
}

/** Count a table before reading any entry values. */
export function boundedKeys(
  inspection: IShapeInspection,
  record: Readonly<Record<string, unknown>>,
  path: string,
  limit: keyof typeof RpcProviderDeclarationLimit
): string[] {
  /** Names are counted before any getter in the table runs. */
  const keys = Object.keys(record)
  if (keys.length > RpcProviderDeclarationLimit[limit])
    throw invalid(inspection, path, undefined, limit)
  return keys
}

/** Snapshot one bounded description, reading each original property once before normalization. */
export function snapshotContract(
  inspection: IShapeInspection,
  input: unknown,
  totals?: { methods: number }
): unknown {
  /** The original root is read exactly once into a portable snapshot. */
  const root = asRecord(inspection, input, '$')
  exactKeys(inspection, root, ['schemaVersion', 'plugin', 'features'], '$')
  /** Feature-table size is checked before reading feature values. */
  const features = asRecord(inspection, root.features, '$.features')
  /** Only admitted feature keys enter the bounded traversal. */
  const featureKeys = boundedKeys(inspection, features, '$.features', 'featuresPerContract')
  /** A plain snapshot keeps getters out of the subsequent portable normalization pass. */
  /** Only bounded, validated catalog entries enter portable normalization. */
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const featureName of featureKeys) {
    /** Only a validated name or the fixed placeholder reaches diagnostics. */
    const path = `$.features.${pathKey(featureName)}`
    assertName(inspection, featureName, path)
    /** One original feature read preserves getter failure identity. */
    const feature = asRecord(inspection, features[featureName], path)
    exactKeys(inspection, feature, ['methods'], path)
    /** Method-table size is checked before reading method values. */
    const methods = asRecord(inspection, feature.methods, `${path}.methods`)
    /** These admitted method names contribute to the catalog-wide budget. */
    const methodKeys = boundedKeys(inspection, methods, `${path}.methods`, 'methodsPerFeature')
    if (totals) {
      totals.methods += methodKeys.length
      if (totals.methods > RpcProviderDeclarationLimit.methodsPerCatalog)
        throw invalid(inspection, '$.catalog', undefined, 'methodsPerCatalog')
    }
    /** Method objects remain original until the one portable normalization pass. */
    const table: Record<string, unknown> = Object.create(null)
    for (const methodName of methodKeys) {
      assertName(inspection, methodName, `${path}.methods.${pathKey(methodName)}`)
      table[methodName] = methods[methodName]
    }
    snapshot[featureName] = { methods: table }
  }
  return { schemaVersion: root.schemaVersion, plugin: root.plugin, features: snapshot }
}

/** A record is a portable object rather than an array or byte descriptor. */
export function asRecord(
  inspection: IShapeInspection,
  value: unknown,
  path: string
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw invalid(inspection, path)
  /** Keep the existing portable plain-object restriction while snapshotting. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw invalid(inspection, path)
  return value as Readonly<Record<string, unknown>>
}

/** Reject unknown required semantics instead of silently accepting them. */
export function exactKeys(
  inspection: IShapeInspection,
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key) && !optional.includes(key))
      throw invalid(
        inspection,
        `${path}.${pathKey(key)}`,
        undefined,
        undefined,
        RpcShapeReason['unknown-field']
      )
  for (const key of allowed)
    if (!Object.hasOwn(record, key))
      throw invalid(
        inspection,
        `${path}.${pathKey(key)}`,
        undefined,
        undefined,
        RpcShapeReason['missing-field']
      )
}

/** Method and feature segments share one ASCII grammar. */
export function assertName(
  inspection: IShapeInspection,
  value: unknown,
  path: string
): asserts value is string {
  if (typeof value !== 'string' || !new RegExp(REMOTE_NAME_PATTERN, 'u').test(value))
    throw invalid(inspection, path, undefined, undefined, RpcShapeReason.name)
}

/** Freezes a normalized record with keys in Unicode code-point order. */
export function sortedRecord<T>(
  entries: readonly (readonly [string, T])[]
): Readonly<Record<string, T>> {
  /** Null prototype prevents declared keys such as constructor from changing the record shape. */
  const output: Record<string, T> = Object.create(null) as Record<string, T>
  /** Index the original values once; stable code-unit ordering belongs to utils. */
  const values = new Map(entries)
  for (const key of orderStringKeys(Array.from(values.keys()))) output[key] = values.get(key)!
  return Object.freeze(output)
}

/** Normalizes an untrusted contract before any feature or frame is published. */
export function readRpcProviderDeclaration(
  inspection: IShapeInspection,
  input: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcProviderDeclaration {
  /** Portable normalization rejects cycles, callbacks, platform objects, and unsafe property reads. */
  let portable: IRpcPortableValue
  try {
    portable = normalizePortable(snapshotContract(inspection, input), 0, undefined, false, metadata)
  } catch (cause) {
    if (isShapeFailure(inspection, cause)) throw cause
    throw invalid(inspection, '$', cause, undefined, RpcShapeReason.portable)
  }
  /** The original root is read exactly once into a portable snapshot. */
  const root = asRecord(inspection, portable, '$')
  exactKeys(inspection, root, ['schemaVersion', 'plugin', 'features'], '$')
  if (root.schemaVersion !== RPC_PROVIDER_DECLARATION_VERSION)
    throw invalid(inspection, '$.schemaVersion', undefined, undefined, RpcShapeReason.version)
  assertName(inspection, root.plugin, '$.plugin')
  /** Feature-table size is checked before reading feature values. */
  const features = asRecord(inspection, root.features, '$.features')
  if (Object.keys(features).length === 0)
    throw invalid(inspection, '$.features', undefined, undefined, RpcShapeReason['empty-table'])
  /** Each feature and method is copied into a frozen, sorted record. */
  const featureEntries: [string, IRpcProviderFeatureDeclaration][] = []
  for (const [featureName, featureValue] of Object.entries(features)) {
    assertName(inspection, featureName, `$.features.${featureName}`)
    /** One original feature read preserves getter failure identity. */
    const feature = asRecord(inspection, featureValue, `$.features.${featureName}`)
    exactKeys(inspection, feature, ['methods'], `$.features.${featureName}`)
    /** Method-table size is checked before reading method values. */
    const methods = asRecord(inspection, feature.methods, `$.features.${featureName}.methods`)
    if (Object.keys(methods).length === 0)
      throw invalid(
        inspection,
        `$.features.${featureName}.methods`,
        undefined,
        undefined,
        RpcShapeReason['empty-table']
      )
    /** A method's mode and retry declaration are mandatory, even for one-way and streams. */
    const methodEntries: [string, IRpcProviderMethodDeclaration][] = []
    for (const [methodName, methodValue] of Object.entries(methods)) {
      /** Only a validated name or the fixed placeholder reaches diagnostics. */
      const path = `$.features.${featureName}.methods.${methodName}`
      assertName(inspection, methodName, path)
      const fullName = `${root.plugin}.${featureName}.${methodName}`
      if (fullName.length > RPC_PROVIDER_DECLARATION_METHOD_MAX_CHARS)
        throw invalid(inspection, path, undefined, undefined, RpcShapeReason.name)
      const method = asRecord(inspection, methodValue, path)
      exactKeys(inspection, method, ['mode', 'idempotent'], path, ['input', 'output', 'yield'])
      if (!RPC_PROVIDER_MODES.includes(method.mode as RpcProviderMode))
        throw invalid(
          inspection,
          `${path}.mode`,
          undefined,
          undefined,
          RpcShapeReason['method-mode']
        )
      if (typeof method.idempotent !== 'boolean')
        throw invalid(
          inspection,
          `${path}.idempotent`,
          undefined,
          undefined,
          RpcShapeReason.idempotency
        )
      if (method.mode !== RpcProviderMode.request && method.idempotent)
        throw invalid(
          inspection,
          `${path}.idempotent`,
          undefined,
          undefined,
          RpcShapeReason.idempotency
        )
      /** Schema callbacks borrow this operation without retaining three lexical collaborators. */
      const schemaContext = { method, inspection, metadata }
      methodEntries.push([
        methodName,
        Object.freeze({
          mode: method.mode as RpcProviderMode,
          idempotent: method.idempotent,
          ...Object.fromEntries(
            ['input', 'output', 'yield']
              .filter((key) => Object.hasOwn(schemaContext.method, key))
              .map((key) => [
                key,
                readMethodSchema(
                  schemaContext.method[key],
                  schemaContext.inspection,
                  schemaContext.metadata
                )
              ])
          )
        })
      ])
    }
    featureEntries.push([featureName, Object.freeze({ methods: sortedRecord(methodEntries) })])
  }
  return Object.freeze({
    schemaVersion: RPC_PROVIDER_DECLARATION_VERSION,
    plugin: root.plugin,
    features: sortedRecord(featureEntries)
  })
}

/** Check one provider declaration and return its original normalized snapshot or diagnostic. */
export function checkRpcProviderDeclaration(
  input: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcShapeCheck<IRpcProviderDeclaration> {
  return inspectShape((inspection) => readRpcProviderDeclaration(inspection, input, metadata))
}
