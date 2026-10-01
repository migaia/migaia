import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acceptsSchema } from '../fixtures/schema-accepts.js'
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
    expect(acceptsSchema(schema.$defs.contract!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteContract(vector.value))).toBe(vector.semanticValid)
  })

  it.each(hostVectors.catalogs)(
    '$id: catalog structure and semantic key check differ as specified',
    (vector) => {
      expect(acceptsSchema(schema.$defs.catalog!, vector.value)).toBe(vector.schemaValid)
      expect(normalized(() => normalizeRemoteHostCatalog(vector.value))).toBe(vector.semanticValid)
    }
  )

  it.each(hostVectors.controls)('$id: reserved control schema and semantic checks', (vector) => {
    expect(acceptsSchema(schema.$defs[vector.definition]!, vector.value)).toBe(vector.schemaValid)
    expect(normalized(() => normalizeRemoteControlShape(vector.definition, vector.value))).toBe(
      vector.semanticValid
    )
  })
})
