import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodecValue } from '@migaia/serialize/codec'
import { encodeOrderedStorageKey } from '@migaia/storage-host/sdk'
import { QdrantText } from './constants.js'
import { invalidArgument, qdrantError } from './errors.js'
import { QdrantErrorCode } from './error-code.js'
/** The canonical portable codec owns all payload escaping, reserved tags and value admission. */
const codec = defineJsonCodec({ version: 1 })
/**
 * Native field names encode an already canonical path; dots and hostile property names cannot
 * collide.
 */
export function projectedPath(path: readonly string[]): string {
  return (
    QdrantText.fields +
    '.p' +
    Array.from(encodeOrderedStorageKey(path, QdrantText.backend), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  )
}
/**
 * Canonical scalar strings are JSON text, preserving lone UTF-16 surrogates through native UTF-8
 * JSON.
 */
export function projectedScalar(value: string | number | boolean): string | number | boolean {
  return typeof value === 'string' ? codec.encode(value) : value
}
/** Every own path retains its presence and scalar domain, including null and containers. */
function project(payload: ICodecValue | undefined): Record<string, unknown> {
  const fields: Record<string, unknown> = Object.create(null)
  const visit = (value: ICodecValue, path: readonly string[]) => {
    const name = path.length ? projectedPath(path).slice(QdrantText.fields.length + 1) : undefined,
      kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    if (name !== undefined)
      fields[name] = {
        kind,
        ...(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? { value: projectedScalar(value) }
          : Array.isArray(value)
            ? {
                value: value
                  .filter((item) => item !== null && typeof item !== 'object')
                  .map((item) => projectedScalar(item as string | number | boolean))
              }
            : {})
      }
    if (value !== null && typeof value === 'object')
      for (const key of Object.keys(value)) visit(Reflect.get(value, key), [...path, key])
  }
  if (payload !== undefined) visit(payload, [])
  return fields
}
/**
 * Reject caller attempts to replace native organization or deadline fields before pipeline
 * admission.
 */
export function assertPointPayload(payload: ICodecValue | undefined): void {
  if (
    payload !== undefined &&
    payload !== null &&
    typeof payload === 'object' &&
    (Object.hasOwn(payload, QdrantText.org) || Object.hasOwn(payload, QdrantText.expiresAt))
  )
    throw invalidArgument()
}
/** Physical reserved fields never take values directly from a caller payload. */
export function encodePointPayload(
  orgId: string,
  id: string,
  payload: ICodecValue | undefined,
  expiresAt?: string
): Record<string, unknown> {
  assertPointPayload(payload)
  return {
    [QdrantText.org]: orgId,
    [QdrantText.envelope]: codec.encode([
      QdrantText.version,
      id,
      payload === undefined ? 0 : 1,
      payload ?? null
    ]),
    [QdrantText.fields]: project(payload),
    ...(expiresAt === undefined ? {} : { [QdrantText.expiresAt]: expiresAt })
  }
}
/** Malformed remote envelopes are protocol failures, retaining the codec's original cause. */
export function decodePointPayload(
  value: unknown,
  orgId: string
): { id: string; payload?: ICodecValue; expiresAt?: number } {
  try {
    if (value === null || typeof value !== 'object' || Reflect.get(value, QdrantText.org) !== orgId)
      throw qdrantError(QdrantErrorCode.responseInvalid)
    const text = Reflect.get(value, QdrantText.envelope),
      expiry = Reflect.get(value, QdrantText.expiresAt)
    if (
      typeof text !== 'string' ||
      (expiry !== undefined && (typeof expiry !== 'string' || !Number.isFinite(Date.parse(expiry))))
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    const result = codec.decode(text)
    if (
      !Array.isArray(result) ||
      result.length !== 4 ||
      result[0] !== QdrantText.version ||
      typeof result[1] !== 'string' ||
      (result[2] !== 0 && result[2] !== 1) ||
      codec.encode(result) !== text ||
      (result[2] === 0 && result[3] !== null)
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    return {
      id: result[1],
      ...(result[2] === 1 ? { payload: result[3] } : {}),
      ...(expiry === undefined ? {} : { expiresAt: Date.parse(expiry) })
    }
  } catch (cause) {
    throw qdrantError(QdrantErrorCode.responseInvalid, cause)
  }
}
