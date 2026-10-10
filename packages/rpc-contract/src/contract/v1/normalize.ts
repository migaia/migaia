import { normalizeRpcSerializedError } from '../error.js'
import { normalizePortable } from '../normalize.js'
import type { IRpcEnvelopeOptions } from '../types.js'
import {
  RpcEnvelopeKind,
  RpcEnvelopeViolation,
  RpcRouteType,
  type RpcRouteType as IRpcRouteType
} from '../wire-constants.js'
import {
  compareRpcFieldNames,
  invalidRpcEnvelope,
  normalizeRpcRoute,
  snapshotRpcRecord
} from './route.js'
import type { IRpcEnvelope } from './types.js'

/** Scalar domains are checked in the order listed by each envelope shape. */
type IRpcTopLevelScalar = readonly [field: string, domain: 'string' | 'boolean' | 'stringArray']

/** A kind's required and optional top-level fields also define its output snapshot. */
type IRpcTopLevelShape = Readonly<{
  required: readonly string[]
  optional?: readonly string[]
  scalars: readonly IRpcTopLevelScalar[]
  wireErrorField?: string
}>

/** Some kinds select a top-level shape using a scalar discriminant. */
type IRpcShapeSelector = Readonly<{
  field: string
  equals: unknown
  match: IRpcTopLevelShape
  otherwise: IRpcTopLevelShape
}>

/** A single row owns all envelope decisions that vary by kind. */
type IRpcEnvelopeKindFields = Readonly<{
  shape: IRpcTopLevelShape | IRpcShapeSelector
  routeTypes: readonly IRpcRouteType[]
  payload: 'portable' | 'opaque'
}>

/** The extension point for future kinds; normalization never branches on a kind name. */
const TOP_LEVEL_FIELDS = {
  [RpcEnvelopeKind.request]: {
    shape: {
      required: ['kind', 'id', 'method', 'data'],
      scalars: [
        ['id', 'string'],
        ['method', 'string']
      ]
    },
    routeTypes: [RpcRouteType.request],
    payload: 'portable'
  },
  [RpcEnvelopeKind.response]: {
    shape: {
      field: 'ok',
      equals: true,
      match: {
        required: ['kind', 'ok', 'id', 'data'],
        scalars: [
          ['id', 'string'],
          ['ok', 'boolean']
        ]
      },
      otherwise: {
        required: ['kind', 'ok', 'id', 'code', 'message', 'data'],
        optional: ['error'],
        scalars: [
          ['id', 'string'],
          ['ok', 'boolean'],
          ['code', 'string'],
          ['message', 'string']
        ],
        wireErrorField: 'error'
      }
    },
    routeTypes: [RpcRouteType.response],
    payload: 'portable'
  },
  [RpcEnvelopeKind.discovery]: {
    shape: {
      required: ['kind', 'id', 'version', 'acceptVersions', 'data'],
      scalars: [
        ['id', 'string'],
        ['version', 'string'],
        ['acceptVersions', 'stringArray']
      ]
    },
    routeTypes: [RpcRouteType.discoveryQuery, RpcRouteType.discoveryResponse],
    payload: 'portable'
  },
  [RpcEnvelopeKind.variation]: {
    shape: {
      required: ['kind', 'id', 'data'],
      scalars: [['id', 'string']]
    },
    routeTypes: [RpcRouteType.variation],
    payload: 'opaque'
  },
  [RpcEnvelopeKind.stream]: {
    shape: { required: ['kind', 'id', 'data'], scalars: [['id', 'string']] },
    routeTypes: [RpcRouteType.stream],
    payload: 'portable'
  }
} as const satisfies Readonly<Record<RpcEnvelopeKind, IRpcEnvelopeKindFields>>

/** Resolve an ordinary or discriminated row without requiring kind-specific code. */
function resolveTopLevelShape(
  shape: IRpcTopLevelShape | IRpcShapeSelector,
  record: Record<string, unknown>
): IRpcTopLevelShape {
  return 'field' in shape
    ? record[shape.field] === shape.equals
      ? shape.match
      : shape.otherwise
    : shape
}

/** Validate a top-level scalar while preserving the V4 field order. */
function validateTopLevelScalar(
  record: Record<string, unknown>,
  [field, domain]: IRpcTopLevelScalar
): void {
  const value = record[field]
  const valid =
    domain === 'string'
      ? typeof value === 'string'
      : domain === 'boolean'
        ? typeof value === 'boolean'
        : Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
  if (!valid) throw invalidRpcEnvelope(RpcEnvelopeViolation.type, `/${field}`)
}

/** Normalize a V1 envelope in the frozen V1–V7 first-failure order. */
export function normalizeRpcEnvelope(value: unknown, options?: IRpcEnvelopeOptions): IRpcEnvelope {
  const record = snapshotRpcRecord(value, '', RpcEnvelopeViolation.type)
  const kind = record.kind
  if (typeof kind !== 'string' || !Object.hasOwn(TOP_LEVEL_FIELDS, kind)) {
    const error = invalidRpcEnvelope(RpcEnvelopeViolation.unknownKind, '/kind')
    Object.defineProperty(error, 'unknownKindValue', { value: kind })
    throw error
  }
  const kindFields: IRpcEnvelopeKindFields = TOP_LEVEL_FIELDS[kind as RpcEnvelopeKind]
  const shape = resolveTopLevelShape(kindFields.shape, record)
  for (const field of shape.required) {
    if (!Object.hasOwn(record, field))
      throw invalidRpcEnvelope(RpcEnvelopeViolation.required, `/${field}`)
  }
  const allowed = new Set<string>([...shape.required, ...(shape.optional ?? [])])
  for (const field of Object.keys(record)
    .filter((key) => !allowed.has(key))
    .sort(compareRpcFieldNames))
    options?.onUnknownField?.('', field)
  for (const scalar of shape.scalars) validateTopLevelScalar(record, scalar)
  const data = snapshotRpcRecord(record.data, '/data', RpcEnvelopeViolation.route)
  if (!Object.hasOwn(data, 'route'))
    throw invalidRpcEnvelope(RpcEnvelopeViolation.required, '/data/route')
  const route = normalizeRpcRoute(data.route, kindFields.routeTypes, options)
  for (const field of Object.keys(data)
    .filter((key) => key !== 'route' && key !== 'payload')
    .sort(compareRpcFieldNames))
    options?.onUnknownField?.('/data', field)
  const normalizedData: Record<string, unknown> = { route }
  if (Object.hasOwn(data, 'payload')) {
    if (kindFields.payload === 'opaque') normalizedData.payload = data.payload
    else {
      try {
        normalizedData.payload = normalizePortable(data.payload, 2)
      } catch (cause) {
        throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, '/data/payload', cause)
      }
    }
  }
  const normalized: Record<string, unknown> = { kind }
  for (const field of shape.required) {
    if (field === 'kind' || field === 'data') continue
    const current = record[field]
    normalized[field] = Array.isArray(current) ? Object.freeze([...current]) : current
  }
  normalized.data = Object.freeze(normalizedData)
  if (shape.wireErrorField && Object.hasOwn(record, shape.wireErrorField)) {
    try {
      normalized[shape.wireErrorField] = normalizeRpcSerializedError(record[shape.wireErrorField], {
        unknownFields: 'ignore',
        onUnknownField: (pointer, field) =>
          options?.onUnknownField?.(`/${shape.wireErrorField}${pointer}`, field)
      })
    } catch (cause) {
      throw invalidRpcEnvelope(RpcEnvelopeViolation.error, `/${shape.wireErrorField}`, cause)
    }
  }
  return Object.freeze(normalized) as IRpcEnvelope
}
