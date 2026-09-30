import { isDeepStrictEqual } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeRemoteContract,
  normalizeRemoteControlShape,
  normalizeRemoteHostCatalog,
  REMOTE_METHOD_MAX_LENGTH,
  REMOTE_METHOD_MODES,
  REMOTE_NAME_PATTERN
} from '../../src/remote/contract.js'
import { RpcRemoteLayerErrorCode } from '../../src/remote/error-code.js'

/** Narrow JSON Schema keyword set used by the checked protocol document. */
type ISchema = Record<string, unknown>

/** Schema and vectors are shipped protocol assets, not test-only fixtures. */
const schema = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../schema/remote-contract.schema.json'), 'utf8')
) as ISchema & { $defs: Record<string, ISchema> }
/** Application contract accept/reject examples. */
const contractVectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../schema/vectors/remote-contract.json'), 'utf8')
) as { contracts: { id: string; value: unknown; schemaValid: boolean; semanticValid: boolean }[] }
/** Host catalog and reserved control shape examples. */
const hostVectors = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../schema/vectors/remote-host-control.json'),
    'utf8'
  )
) as {
  catalogs: { id: string; value: unknown; schemaValid: boolean; semanticValid: boolean }[]
  controls: {
    id: string
    definition: Parameters<typeof normalizeRemoteControlShape>[0]
    value: unknown
    schemaValid: boolean
    semanticValid: boolean
  }[]
}

/** Evaluates only standard keywords present in the protocol schema, including local references. */
function accepts(rule: ISchema, value: unknown): boolean {
  if (typeof rule.$ref === 'string') {
    const name = rule.$ref.split('/').at(-1)
    return name !== undefined && accepts(schema.$defs[name]!, value)
  }
  if ('const' in rule && !isDeepStrictEqual(value, rule.const)) return false
  if (
    Array.isArray(rule.enum) &&
    !rule.enum.some((candidate) => isDeepStrictEqual(value, candidate))
  )
    return false
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((part) => accepts(part as ISchema, value)))
    return false
  if (
    Array.isArray(rule.oneOf) &&
    rule.oneOf.filter((part) => accepts(part as ISchema, value)).length !== 1
  )
    return false
  if (rule.not && accepts(rule.not as ISchema, value)) return false
  if (
    rule.if &&
    accepts(rule.if as ISchema, value) &&
    rule.then &&
    !accepts(rule.then as ISchema, value)
  )
    return false
  if (typeof rule.type === 'string') {
    const validType =
      rule.type === 'null'
        ? value === null
        : rule.type === 'array'
          ? Array.isArray(value)
          : rule.type === 'object'
            ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : rule.type === 'integer'
              ? Number.isInteger(value)
              : typeof value === rule.type
    if (!validType) return false
  }
  if (typeof value === 'string') {
    if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern, 'u').test(value)) return false
    if (typeof rule.maxLength === 'number' && [...value].length > rule.maxLength) return false
  }
  if (typeof value === 'number' && typeof rule.minimum === 'number' && value < rule.minimum)
    return false
  if (Array.isArray(value)) {
    if (typeof rule.minItems === 'number' && value.length < rule.minItems) return false
    if (typeof rule.maxItems === 'number' && value.length > rule.maxItems) return false
    if (Array.isArray(rule.prefixItems)) {
      for (const [index, part] of rule.prefixItems.entries())
        if (index < value.length && !accepts(part as ISchema, value[index])) return false
    }
    if (rule.items && value.some((entry) => !accepts(rule.items as ISchema, entry))) return false
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object)
    if (typeof rule.minProperties === 'number' && keys.length < rule.minProperties) return false
    if (Array.isArray(rule.required) && rule.required.some((key) => !Object.hasOwn(object, key)))
      return false
    const properties = (rule.properties ?? {}) as Record<string, ISchema>
    for (const key of keys) {
      if (rule.propertyNames && !accepts(rule.propertyNames as ISchema, key)) return false
      if (key in properties) {
        if (!accepts(properties[key]!, object[key])) return false
      } else if (rule.additionalProperties === false) return false
      else if (
        rule.additionalProperties &&
        !accepts(rule.additionalProperties as ISchema, object[key])
      )
        return false
    }
  }
  return true
}

/** Checks a semantic normalization without obscuring the native error code. */
function normalized(check: () => unknown): boolean {
  try {
    check()
    return true
  } catch (error) {
    expect((error as { code?: string }).code).toBe(RpcRemoteLayerErrorCode.contractInvalid)
    return false
  }
}

describe('A1 remote contract and Schema', () => {
  it('mirrors the stable name grammar and method declarations', () => {
    const definitions = schema.$defs
    expect((definitions.name as ISchema).pattern).toBe(REMOTE_NAME_PATTERN)
    expect((definitions.name as ISchema).maxLength).toBe(40)
    expect(
      ((definitions.method as ISchema).properties as Record<string, ISchema>).mode?.enum
    ).toEqual(REMOTE_METHOD_MODES)
    expect(REMOTE_METHOD_MAX_LENGTH).toBe(122)
  })

  it.each(contractVectors.contracts)('$id: contract schema and normalizer agree', (vector) => {
    expect(accepts(schema.$defs.contract!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteContract(vector.value))).toBe(vector.semanticValid)
  })

  it.each(hostVectors.catalogs)(
    '$id: catalog structure and semantic key check differ as specified',
    (vector) => {
      expect(accepts(schema.$defs.catalog!, vector.value)).toBe(vector.schemaValid)
      expect(normalized(() => normalizeRemoteHostCatalog(vector.value))).toBe(vector.semanticValid)
    }
  )

  it.each(hostVectors.controls)('$id: reserved control schema and semantic checks', (vector) => {
    expect(accepts(schema.$defs[vector.definition]!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteControlShape(vector.definition, vector.value))).toBe(
      vector.semanticValid
    )
  })
})
